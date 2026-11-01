import type { ModelResult, ProjectState, Run } from '../../shared/types';
import { memoryScopeSchema } from '../../shared/studio';
import { decodeNarrativeResponse, narrativeStreamInstruction } from '../../shared/narrative-events';
import type { FileStore } from '../storage';
import { detailPath, hash } from '../domain';
import { retrieveMemory } from '../memory-studio';
import { sceneMaterials } from '../scene-material';
import { taskVoicePreferences } from '../quality';
import { controllerRules } from '../agent-control';
import { creationPolicy } from '../creation-policy';
import { compatibleRunBase } from '../runtime-settings';
import { contextChanged } from '../context-compiler';
import { validatedResponse } from '../runtime/validated-response';

/** Opt-in, one focal character. Every scene has a fresh, scope-bound wire input. */
export async function writeScopedScenes(options: {
  store: FileStore; root: string; run: Run; project: ProjectState; signal: AbortSignal;
  send: (purpose: string, system: string, input: object) => Promise<ModelResult>;
  onText: (raw: string) => void;
}): Promise<ModelResult> {
  const { store, root, run, project, signal } = options;
  const character = run.taskScope?.memory.characterId ?? project.config.viewpointCharacterId;
  if (!character) throw new Error('逐场生成需要先选择视角人物');
  const source = store.readAccepted(detailPath(run.chapter));
  const scenes = source.content.split(/(?=^## 场面\s*\d+[：:])/m).filter(s => /^## 场面/.test(s));
  const numbers = scenes.map(s => Number(s.match(/^## 场面\s*(\d+)/)![1]));
  if (!scenes.length || new Set(numbers).size !== scenes.length || numbers.some((n, i) => i > 0 && n <= numbers[i - 1]))
    throw new Error('逐场生成需要按故事顺序编号的场面细纲，请先整理本章细纲');
  const names = new Set([character, ...store.db.facts().filter(f => f.entityIds.includes(character)).flatMap(f => [f.subject, ...f.aliases])]);
  const system = `${controllerRules(root).content}\n${creationPolicy(root, 'chapter-draft.draft').content}\n本轮采用逐场生成，仅写当前场面，不写章节标题、不提前进入后续场面。只使用本轮事实与所知；未知保持未知。此前场面是同一焦点人物的候选经历，尚未成为正式记忆。\n${narrativeStreamInstruction}`;
  const rawParts: string[] = [];
  const proseParts: string[] = [];
  const title = run.chapterNaming?.source?.title;
  const heading = `# 第${String(run.chapter).padStart(3, '0')}章${title ? `：${title}` : ''}\n\n`;
  options.onText(heading);
  for (const [index, scene] of scenes.entries()) {
    const scope = memoryScopeSchema.parse({ ...run.taskScope?.memory, projectId: project.id, chapter: run.chapter,
      viewpoint: 'character', characterId: character, position: { chapter: run.chapter, scene: numbers[index] } });
    const material = sceneMaterials([{ path: detailPath(run.chapter), hash: source.hash, content: scene } as NonNullable<Run['manifest']>['sources'][number]])[0];
    if (material?.focalCharacter && !names.has(material.focalCharacter))
      throw new Error('逐场生成暂支持同一视角人物；本场焦点人物与所选人物不同');
    const recalled = retrieveMemory(store, character, scope);
    if (recalled.issues.length) throw new Error(`本场人物资料需要核对：${recalled.issues.join('；')}`);
    const input = {
      scope, scene: scene.replace(/^.*下一章.*(?:\r?\n|$)/gm, ''),
      authority: '本场细纲是获准展开的计划，未发生前不作为事实；表达指导不提供人物经历。未提供未来场面、原始设定全文或其他视角历史。',
      targetWords: Math.max(100, Math.round(project.config.chapterWords / scenes.length)),
      authorRequest: run.request, authorConstraints: project.config.constraints,
      narrator: { pov: project.config.pov, style: project.config.style },
      expressionGuidance: taskVoicePreferences(store, { entityIds: [character], sceneIds: [material.scene],
        sceneFunctions: material.sceneFunction ? [material.sceneFunction] : [],
        addresseeIds: material.addressees?.split(/[、,，]/), relationshipIds: material.relationship ? [material.relationship] : [] }),
      facts: recalled.facts.filter(({ fact }) => fact.kind !== 'expression_sample').map(({ fact }) => ({
        id: fact.id, kind: fact.kind, subject: fact.subject, predicate: fact.predicate, value: fact.value,
        sources: fact.evidence.map(e => ({ path: e.path, hash: e.hash }))
      })),
      previousScenes: proseParts,
      draftAttempt: run.repairAttempts?.prose ?? 0
    };
    const raw = await validatedResponse({ store, run, phase: `scene-prose:${run.chapter}:${numbers[index]}`,
      instruction: system, input, signal, decode: value => value,
      assertCurrent: () => {
        if (!compatibleRunBase(store, run) || (run.manifest && contextChanged(store, run.manifest)) || store.readAccepted(detailPath(run.chapter)).hash !== source.hash)
          throw new Error('逐场生成依据已变化，已完成场面保留于原请求记录');
      },
      send: async (purpose, rule, payload) => {
        const result = await options.send(purpose, rule, payload);
        if (result.stop !== 'complete' || result.calls.length) throw new Error('本场输出不完整，原请求保留，未推进后续场面');
        return result.text;
      },
      validate: value => {
        if (typeof value !== 'string') throw new Error('本场必须返回正文流');
        const prose = decodeNarrativeResponse(value).text.trim();
        if (!prose || /^(?:```|\{\s*")/.test(prose) || /^#{1,2}\s*第\d+章/m.test(prose)) throw new Error('本场需要非空正文，不含 JSON、代码围栏或章节标题');
        return value;
      }
    });
    const prefix = index ? '\n\n' : '';
    rawParts.push(prefix + raw);
    proseParts.push(decodeNarrativeResponse(raw).text);
    options.onText(prefix + raw);
    store.db.event(run.id, 'scene-draft', `第 ${numbers[index]} 场候选已生成`, { scene: numbers[index], hash: hash(raw), scope });
  }
  return { text: heading + rawParts.join(''), calls: [], stop: 'complete', native: null,
    usage: { input: 0, output: 0, cost: 0, currency: run.usage.currency } };
}
