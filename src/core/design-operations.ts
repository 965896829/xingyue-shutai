import fs from 'node:fs';
import path from 'node:path';
import { designInputSchema, type DesignBinding } from '../shared/design';
import type { Run, StageId } from '../shared/types';
import type { FileStore } from './storage';
import { safePath } from './storage';
import { hash, paths, qualityPath, stageOutputs } from './domain';
import { pendingSource } from './memory-source';
import { readWorldModel, growthSystemsInstruction } from './world-model';
import { SkillRegistry } from './skill-registry';
import { revisedVolumeNaming } from './volume-naming';
import { chapterNamingStages, makeChapterNaming } from './chapter-naming';
import { bindTaskScope, projectForRun } from './task-scope';
import { focusInstruction, creativeConfig } from './prompt-profile';
import { tagContext } from './tags';
import { scopedRead } from './memory-studio';
import { creationPolicy, conditionalCreationPolicy } from './creation-policy';

type Spec = {
  skill: string;
  stage?: StageId;
  report?: boolean;
  targets?: string[];
  selected?: boolean;
  adapter?: 'planning' | 'title' | 'revision-core';
};
const specs: Record<string, Spec> = {
  'concept-forge.create': { skill: 'webnovel-premise-lab', adapter: 'planning' },
  'concept-forge.regenerate': { skill: 'webnovel-premise-lab', adapter: 'planning' },
  'story-contract.build': { skill: 'webnovel-premise-lab', adapter: 'planning' },
  'story-contract.review': { skill: 'webnovel-premise-lab', adapter: 'planning' },
  'story-contract.configure': { skill: 'webnovel-project-config', stage: 'S02' },
  'co-creation.discuss': { skill: 'webnovel-continuity-audit', report: true },
  'co-creation.compare': { skill: 'webnovel-continuity-audit', report: true },
  'co-creation.propose': { skill: 'webnovel-revision-cascade', selected: true },
  'world-design.create': { skill: 'webnovel-world-engine', stage: 'S03' },
  'world-design.profile': { skill: 'webnovel-world-engine', stage: 'S03' },
  'world-design.inherit': { skill: 'webnovel-world-engine', stage: 'S03' },
  'world-design.stress-test': { skill: 'webnovel-continuity-audit', report: true },
  'character-design.create': { skill: 'webnovel-character-engine', stage: 'S04' },
  'rolling-outline.book': { skill: 'webnovel-volume-architect', stage: 'S05' },
  'rolling-outline.volume': { skill: 'webnovel-volume-architect', stage: 'S05' },
  'rolling-outline.roadmap': { skill: 'webnovel-chapter-roadmap', stage: 'S06' },
  'rolling-outline.rhythm': { skill: 'webnovel-rhythm-designer', stage: 'S07' },
  'rolling-outline.batch': { skill: 'webnovel-batch-outline', stage: 'S08' },
  'scene-contract.plan': { skill: 'webnovel-chapter-planner', stage: 'S09' },
  'voice-calibration.extract': { skill: 'webnovel-voice-profile', targets: [paths.style] },
  'voice-calibration.calibrate': { skill: 'webnovel-voice-profile', targets: [paths.style] },
  'voice-calibration.update': { skill: 'webnovel-voice-profile', targets: [paths.style] },
  'chapter-draft.draft': { skill: 'webnovel-chapter-drafter', stage: 'S10' },
  'chapter-review.review': { skill: 'webnovel-chapter-reviewer', report: true },
  'revision.voice': { skill: 'webnovel-prose-polisher', selected: true },
  'revision.local': { skill: 'webnovel-revision-cascade', selected: true },
  'revision.story': { skill: 'webnovel-revision-cascade', selected: true },
  'memory-delta.extract': { skill: 'webnovel-memory-extractor', adapter: 'revision-core' },
  'memory-review.review': { skill: 'webnovel-memory-extractor', adapter: 'revision-core' },
  'memory-query.answer': { skill: 'webnovel-continuity-audit', report: true },
  'character-reflection.reflect': {
    skill: 'webnovel-character-engine',
    targets: [paths.roles, paths.behavior]
  },
  'canon-audit.continuity': { skill: 'webnovel-continuity-audit', report: true },
  'canon-audit.impact': { skill: 'webnovel-revision-cascade', report: true },
  'canon-audit.promise': { skill: 'webnovel-continuity-audit', report: true },
  'canon-audit.ending': { skill: 'webnovel-continuity-audit', report: true },
  'market-evidence.research': { skill: 'webnovel-market-research', report: true },
  'packaging.entity-name': { skill: 'webnovel-name-governance', selected: true },
  'packaging.title': { skill: 'webnovel-packaging', adapter: 'title' },
  'packaging.blurb': { skill: 'webnovel-packaging', report: true },
  'packaging.review': { skill: 'webnovel-packaging', report: true },
  'reader-feedback.analyze': { skill: 'webnovel-reader-feedback', report: true }
};
export function designSpec(id: string) {
  const spec = specs[id];
  if (!spec) throw new Error('未登记的创作操作');
  return spec;
}
export function designResource(root: string, id: string) {
  designSpec(id);
  return creationPolicy(root, id);
}
export function designCatalog(root: string) {
  const file = path.join(root, 'design-v7/catalog.json'),
    content = fs.readFileSync(file, 'utf8');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'design-v7/resources.lock.json'), 'utf8'));
  if (hash(content) !== lock['catalog.json']) throw new Error('创作操作目录完整性检查失败');
  return (JSON.parse(content) as { id: string; title: string; group: string }[]).map((entry) => {
    const spec = designSpec(entry.id);
    return {
      ...entry,
      adapter: spec.adapter ?? ('scoped-task' as const),
      targetSelection: !!spec.selected,
      targetKind: entry.id === 'packaging.review',
      feedback: entry.id === 'reader-feedback.analyze'
    };
  });
}
export function bindDesign(store: FileStore, root: string, run: Run, raw: unknown) {
  const input = designInputSchema.parse(raw),
    spec = designSpec(input.id),
    project = store.db.project();
  if (spec.adapter) throw new Error('此操作需要对应的领域流程');
  if (input.id === 'packaging.review' && !input.targetKind) throw new Error('请选择核验的题面类型');
  if (input.id === 'reader-feedback.analyze' && !input.feedback) throw new Error('请填写反馈来源与采集范围');
  if (input.chapter) {
    run.chapter = input.chapter;
  }
  if (spec.stage) run.stage = spec.stage;
  bindTaskScope(store, run);
  const targets = spec.report
    ? [`11_创作研究/${input.id}-${run.id}.md`]
    : spec.selected
      ? input.targets
      : (spec.targets ??
        stageOutputs(spec.stage!, projectForRun(project, run)).filter(
          (file) => file !== qualityPath(run.chapter)
        ));
  if (!targets.length) throw new Error('请选择本次允许修改的文稿');
  if (input.id === 'revision.voice' && targets.some((file) => !/^07_正文章节\/第\d+章\.md$/.test(file)))
    throw new Error('表达修订只允许选择正文');
  if (input.id === 'packaging.entity-name' && targets.some((file) => !/^(03_|04_|06_|07_)/.test(file)))
    throw new Error('命名修改超出人物与故事范围');
  const read = (file: string) => {
    safePath(store.root, file);
    const doc = store.db.document(file);
    if (pendingSource(project, file) || (doc?.hash && store.inspect(file)?.status !== 'accepted'))
      throw new Error('所选资料尚未保存或需要核对');
    return { path: file, hash: doc?.hash ?? null };
  };
  const sourcePaths = [
    ...new Set([...input.sources, ...targets.filter((file) => store.db.document(file)?.hash)])
  ];
  const sources = sourcePaths.map(read);
  if (sources.some((s) => !s.hash)) throw new Error('参考资料不存在');
  run.skillId = spec.skill;
  run.mode = spec.report ? 'analysis' : 'revision';
  run.revisionCoreRequired = 1;
  run.design = {
    version: 1,
    input,
    promptHash: designResource(root, input.id).hash,
    targets: targets.map(read),
    sources: sources as DesignBinding['sources']
  };
  if (spec.stage === 'S03') run.worldContract = 2;
  if (spec.stage === 'S05') run.volumeNaming = revisedVolumeNaming(undefined, input.request, store.db.document(paths.volumes)?.hash ? store.read(paths.volumes).content : undefined, run);
  if (spec.stage && chapterNamingStages.includes(spec.stage)) run.chapterNaming = makeChapterNaming(store, run, input.request);
  return run;
}
export function assertDesign(store: FileStore, run: Run, changes = run.changes) {
  if (!run.design) return;
  const binding = run.design;
  if (binding.version !== 1) throw new Error('创作操作版本不受支持');
  const project = store.db.project();
  for (const source of [...binding.sources, ...binding.targets]) {
    if (
      (store.db.document(source.path)?.hash ?? null) !== source.hash ||
      pendingSource(project, source.path) ||
      (source.hash && store.inspect(source.path)?.status !== 'accepted')
    )
      throw new Error('创作操作所依据的文稿已改变');
  }
  if (
    changes.some(
      (change) => !binding.targets.some((t) => t.path === change.path && t.hash === change.baseHash)
    )
  )
    throw new Error('候选超出作者指定的修改范围');
  if (run.facts.length && binding.targets.every((t) => !t.path.startsWith('04_')))
    throw new Error('此创作操作没有新增正式记忆的权限');
}
export function designPrompt(store: FileStore, root: string, run: Run) {
  const binding = run.design!;
  assertDesign(store, run);
  const resource = designResource(root, binding.input.id);
  if (resource.hash !== binding.promptHash) throw new Error('操作规则已变化，请创建新任务');
  if (run.worldContract === 2) resource.content += `\n\n${growthSystemsInstruction}`;
  const registry = new SkillRegistry(root);
  resource.content = registry.controller().content + `\n--- 当前专项技能：${binding.input.id} ---\n` + resource.content
    + '\n' + focusInstruction(binding.input.id, registry.get(designSpec(binding.input.id).skill).description);
  if (['rolling-outline.book', 'rolling-outline.volume'].includes(binding.input.id)) resource.content += `\n\n${registry.read('references/volume-naming-commercial.md')}`;
  if (['rolling-outline.batch', 'scene-contract.plan', 'chapter-draft.draft'].includes(binding.input.id) && !run.chapterNaming?.source)
    resource.content += `\n\n${registry.read('references/chapter-naming-commercial.md')}`;
  const project = projectForRun(store.db.project(), run);
  const conditionStage = binding.input.id.startsWith('world-design.') ? 'S03' : run.stage;
  resource.content += '\n' + conditionalCreationPolicy(root, conditionStage,
    [binding.input.request, project.config.constraints, store.db.get<string>('premise'),
      ...(['S01', 'S03'].includes(conditionStage) ? binding.sources.map(source => store.read(source.path, source.hash).content) : [])].join('\n'));
  return `${resource.content}\n\n宿主执行合同\n只完成当前操作。使用提供的工具提交完整候选，所有文稿只允许写入下列路径：${JSON.stringify(binding.targets.map((t) => t.path))}。保持原模板必要字段；报告可无问题，不为凑数量虚构缺陷。正文修改必须另经同版审阅和核心记忆核对才可采纳。禁止直接修改作品、配置或任务状态。\n创作配置：${JSON.stringify(creativeConfig(project.config, run.stage))}\n${tagContext(project, run.stage, { focused: true })}${run.worldContract ? '\n世界候选必须保留 source、original、已有模块标识与锁定项；采用 # 世界模块 及单个 json 代码块保存完整 version:1 模型。profile 仅调整模块启用建议，不为未知内容虚构设定，内容未知时保持 undecided。' : ''}`;
}

export function designContext(store: FileStore, run: Run) {
  if (!run.design) return {};
  const documents = run.design.sources.flatMap(source => {
    const supplied = run.manifest?.sources.find(s => s.path === source.path && s.hash === source.hash);
    if (supplied?.mode === 'full') return [];
    const scope = run.manifest?.scope;
    const content = scope && scope.viewpoint !== 'author'
      ? supplied?.content ?? scopedRead(store, source.path, scope).content
      : store.read(source.path, source.hash).content;
    return [{ ...source, content }];
  });
  return { designInput: run.design.input, selectedSources: run.design.sources,
    selectedDocuments: documents,
    ...(run.worldContract ? { currentWorldModules: readWorldModel(store) } : {}) };
}
