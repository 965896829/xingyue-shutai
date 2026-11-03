import type { ContextManifest, ContextSource, Fact } from '../shared/types';
import type { FileStore } from './storage';
import { readQuality } from './quality';
import type { WritingMaterials } from '../shared/scene-material';
import { updatePath } from './domain';
import { pendingSource } from './memory-source';

const fields = {
  sceneFunction: '场景功能', focalCharacter: '焦点人物', concern: '当前关切', personalMeaning: '个人意义',
  interpretation: '主观判断', attention: '注意线索', experience: '可用经验', dialogueIntent: '对话意图',
  addressees: '交流对象', relationship: '当前关系', narration: '叙述处理', voice: '声音依据', additions: '重要新增',
  goal: '目标', pressure: '压力', actions: '动作', result: '结果'
} as const;

/** Optional fields live in the existing scene outline; missing fields remain absent. */
export function sceneMaterials(sources: ContextSource[]) {
  return sources.filter(s => /第\d+章细纲\.md$/.test(s.path)).flatMap(source =>
    source.content.split(/(?=^## 场面\s*\d+[：:])/m).filter(block => /^## 场面/.test(block)).map(block => {
      const values: Partial<Record<keyof typeof fields, string>> = {};
      for (const [key, label] of Object.entries(fields)) {
        const value = block.match(new RegExp(`^[-*][ \\t]+${label}[：:][ \\t]*([^\\r\\n]+)`, 'm'))?.[1].trim();
        if (value && !/^(无|未知|不适用|待填写)[。.]?$/.test(value)) values[key as keyof typeof fields] = value;
      }
      return { scene: block.split('\n')[0].replace(/^## /, '').trim(), kind: 'plan' as const,
        ...values, source: { path: source.path, hash: source.hash } };
    }));
}

export function writingMaterials(store: FileStore, manifest: ContextManifest): WritingMaterials {
  const scenes = sceneMaterials(manifest.sources);
  const facts = [...manifest.retrievedFacts ?? [], ...manifest.hardConstraints ?? []];
  const ids = (predicate: (fact: Fact) => boolean) => facts.filter(predicate).map(f => f.id);
  let savedPatterns: ReturnType<typeof readQuality>['patterns'] = [];
  try { savedPatterns = readQuality(store).patterns; } catch { /* Optional learning data never replaces canonical facts. */ }
  const patterns = manifest.scope?.viewpoint === 'author' ? savedPatterns.filter(pattern =>
    pattern.state === 'ready' && pattern.chapter < manifest.chapter && pattern.sources.every(source =>
      store.db.document(source.path)?.hash === source.hash && store.object(source.hash).toString('utf8').includes(source.quote)))
    .sort((a, b) => b.chapter - a.chapter).slice(0, 6) : [];
  const historicalMechanisms: WritingMaterials['historicalMechanisms'] = patterns.map(({ chapter, scene, conflict, strategy, response, solution, change, reward, protectedRepetition, sources }) =>
    ({ chapter, scene, conflict, strategy, response, solution, change, reward, protectedRepetition, sources, category: 'model_judgment' }));
  if (manifest.scope?.viewpoint === 'author') for (let chapter = manifest.chapter - 1; chapter >= Math.max(1, manifest.chapter - 12) && historicalMechanisms.length < 6; chapter--) {
    if (historicalMechanisms.some(p => p.chapter === chapter)) continue;
    const file = updatePath(chapter);
    if (!store.db.document(file)?.hash || pendingSource(store.db.project(), file) || store.inspect(file)?.status !== 'accepted') continue;
    const doc = store.readAccepted(file);
    const entry = { chapter, scene: `第${chapter}章`, conflict: '', strategy: '', response: '', solution: '', change: '', reward: '', cost: '', protectedRepetition: '', sources: [] as WritingMaterials['historicalMechanisms'][number]['sources'], category: 'accepted_memory_summary' as const };
    for (const [key, label] of Object.entries({ conflict: '冲突来源', strategy: '主角策略', response: '对手反制', solution: '解法', change: '局面变化', reward: '阅读回报', cost: '付出与损失', protectedRepetition: '有意复现' })) {
      const match = doc.content.match(new RegExp(`^[-*][ \\t]*${label}[：:][ \\t]*([^\\r\\n]+)`, 'm'));
      if (!match || /^(?:未知|暂无|待填写|具体事件与原因)/.test(match[1])) continue;
      entry[key as 'conflict'] = match[1].trim();
      entry.sources.push({ path: file, hash: doc.hash, quote: match[0] });
    }
    if (!entry.sources.length) continue;
    historicalMechanisms.push(entry);
    (manifest.referenceSources ??= []).push({ path: file, hash: doc.hash, reason: 'mechanism-comparison' });
  }
  return {
    version: 1, authorPreferences: 'voicePreferences 中的已确认适用偏好',
    narrator: { instruction: '作者当前明确要求优先，继承已确认声音；人物所知和表达指导分别使用。', scenes: scenes.map(({ scene, narration }) => ({ scene, narration })) },
    focalExperience: { scenes, currentStateIds: ids(f => f.kind === 'state' || ['injury', 'item', 'relation'].includes(f.category) && f.kind === 'event'),
      experienceIds: ids(f => f.kind === 'event'), beliefIds: ids(f => f.kind === 'belief') },
    dialogueIntent: scenes.filter(s => s.dialogueIntent).map(s => ({ scene: s.scene, character: s.focalCharacter, to: s.addressees, relationship: s.relationship, intent: s.dialogueIntent })),
    historicalMechanisms,
    boundary: '场景体验是计划，只有最终正文证明已经发生。表达样例不提供本书事实。整章生成可见本章后续规划，不承诺逐时刻知情隔离。历史解法用于具体比较，允许有意回响、能力复用及伏笔兑现，不计算原创度分数。'
  };
}
