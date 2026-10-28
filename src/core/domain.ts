import { createHash, randomUUID } from 'node:crypto';
import { extractProseBody } from './prose-body';
import {
  configSchema,
  stageIds,
  type Batch,
  type ProjectConfig,
  type ProjectState,
  type StageId
} from '../shared/types';

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const chapterNumber = (n: number) => String(n).padStart(3, '0');
export const chapterTag = (n: number) => `第${chapterNumber(n)}章`;
export const batchTag = (b: Batch) => `第${chapterNumber(b.start)}-${chapterNumber(b.end)}章`;
export const estimatedChapters = (c: ProjectConfig) => Math.ceil(c.targetWords / c.chapterWords);
export const countWords = (text: string) =>
  Array.from(extractProseBody(text).replace(/\s/gu, '')).length;
export function makeBatch(start: number, c: ProjectConfig): Batch {
  return {
    id: id(),
    start,
    end: Math.min(estimatedChapters(c), start + c.batchSize - 1),
    sizeAtCreation: c.batchSize
  };
}
export const activeBatch = (p: ProjectState) =>
  p.batches.find((b) => p.chapter >= b.start && p.chapter <= b.end) ?? p.batches.at(-1)!;
export function stageKey(stage: StageId, chapter: number, b: Batch) {
  return `${stage}:${stage < 'S06' ? 'global' : stage < 'S09' ? b.id : chapter}`;
}
export const stageNames: Record<StageId, string> = {
  S01: '设定拆解',
  S02: '项目配置与文风',
  S03: '世界规则与卖点',
  S04: '人物与连续性',
  S05: '分卷大纲',
  S06: '章节总纲',
  S07: '批次节奏',
  S08: '批量细纲',
  S09: '单章设计',
  S10: '正文生成',
  S11: '章后更新'
};
export const paths = {
  seed: '01_设定拆解/设定拆解.md',
  config: '02_项目配置/项目配置.md',
  style: '02_项目配置/文风样本与规则.md',
  world: '03_世界规则与卖点/世界规则与卖点.md',
  roles: '04_人物记忆库/角色卡.md',
  relations: '04_人物记忆库/人物关系.md',
  behavior: '04_人物记忆库/情绪与行为记忆.md',
  summary: '04_人物记忆库/批次人物摘要.md',
  timeline: '04_连续性记忆库/时间线.md',
  hooks: '04_连续性记忆库/伏笔台账.md',
  items: '04_连续性记忆库/物品与伤势.md',
  terms: '04_连续性记忆库/规则术语表.md',
  knowledge: '04_连续性记忆库/知情边界.md',
  volumes: '05_长篇大纲/分卷大纲.md',
  outline: '05_长篇大纲/章节总纲.md',
  progress: '09_续写状态/当前进度.md',
  impact: '09_续写状态/改动影响记录.md',
  index: '阶段索引.md'
} as const;
export const prosePath = (n: number) => `07_正文章节/${chapterTag(n)}.md`;
export const taskPath = (n: number) => `06_章节设计/${chapterTag(n)}任务清单.md`;
export const detailPath = (n: number) => `06_章节设计/${chapterTag(n)}细纲.md`;
export const updatePath = (n: number) => `08_章后更新/${chapterTag(n)}记忆更新.md`;
export const qualityPath = (n: number) => `08_章后更新/${chapterTag(n)}质量评分.md`;
export const rhythmPath = (b: Batch) => `05_长篇大纲/${batchTag(b)}节奏.md`;
export const batchPath = (b: Batch) => `06_章节设计/${batchTag(b)}细纲.md`;
export const archivePath = (b: Batch) => `04_人物记忆库/历史归档/${batchTag(b)}情绪与行为.md`;
export const memoryPaths = [
  paths.roles,
  paths.relations,
  paths.behavior,
  paths.summary,
  paths.timeline,
  paths.hooks,
  paths.items,
  paths.terms,
  paths.knowledge
];
export const worldRequiredFields = ['世界底层规则', '主角金手指', '金手指限制', '使用代价', '信息差', '敌人反制方式', '体系升级空间', '中后期防重复机制'] as const;
export const chapterTypes = ['强冲突', '推进', '结算', '日常', '情绪', '转场'] as const;
export const behaviorRequiredFields = ['本章情绪', '情绪变化原因', '本章行动', '行动方式是否符合做事风格', '对主角态度变化', '新增压力', '新增秘密或误会', '下次出场必须承接'] as const;
export function stageOutputs(stage: StageId, p: ProjectState): string[] {
  const b = activeBatch(p),
    n = p.chapter;
  return {
    S01: [paths.seed],
    S02: [paths.config, paths.style],
    S03: [paths.world],
    S04: memoryPaths,
    S05: [paths.volumes],
    S06: [paths.outline],
    S07: [rhythmPath(b)],
    S08: [batchPath(b)],
    S09: [taskPath(n), detailPath(n)],
    S10: [prosePath(n), qualityPath(n)],
    S11: [updatePath(n), ...memoryPaths]
  }[stage];
}
export function requiredInputs(stage: StageId, p: ProjectState): string[] {
  const b = activeBatch(p),
    n = p.chapter;
  const base = [paths.config, paths.style, paths.progress, paths.impact];
  if (stage === 'S01') return base;
  const early: string[] = [paths.seed];
  if (stage > 'S03') early.push(paths.world);
  if (stage > 'S04') early.push(...memoryPaths);
  if (stage > 'S05') early.push(paths.volumes);
  if (stage > 'S06') early.push(paths.outline);
  if (stage > 'S07') early.push(rhythmPath(b));
  if (stage > 'S08') early.push(batchPath(b));
  if (stage >= 'S09' && n > 1) early.push(prosePath(n - 1));
  if (stage >= 'S10') early.push(taskPath(n), detailPath(n));
  if (stage === 'S11') early.push(prosePath(n));
  return [...new Set([...base, ...early])];
}
export function newProject(title: string, root: string, config: unknown): ProjectState {
  const c = configSchema.parse(config);
  return {
    id: id(),
    title,
    root,
    schemaVersion: 1,
    revision: 0,
    createdAt: now(),
    config: c,
    stage: 'S01',
    chapter: 1,
    batches: [makeBatch(1, c)],
    completed: {},
    chapters: {},
    finished: false,
    stale: [],
    acceptedImport: true
  };
}
export function advance(p: ProjectState, runId: string): ProjectState {
  const next = structuredClone(p),
    b = activeBatch(next),
    s = next.stage;
  next.completed[stageKey(s, next.chapter, b)] = runId;
  if (s === 'S10') next.chapters[next.chapter] = 'prose_accepted_pending_aftermath';
  if (s === 'S11') {
    next.chapters[next.chapter] = 'complete';
    if (next.chapter >= estimatedChapters(next.config)) {
      next.finished = true;
      return next;
    }
    next.chapter++;
    if (next.chapter > b.end) {
      next.batches.push(makeBatch(next.chapter, next.config));
      next.stage = 'S06';
    } else next.stage = 'S09';
  } else next.stage = stageIds[stageIds.indexOf(s) + 1];
  return next;
}
export function renderConfig(p: ProjectState): string {
  const c = p.config;
  return `# 项目配置\n\n- 项目：${p.title}\n- 目标总字数：${c.targetWords}\n- 单章目标字数：${c.chapterWords}\n- 最少字数：${c.minWords}\n- 最多字数：${c.maxWords}\n- 每批章数：${c.batchSize}\n- 预计总章数：${estimatedChapters(c)}\n- 视角：${c.pov}\n- 题材：${c.genre}\n- 风格：${c.style}\n- 用户硬约束：${c.constraints || '暂无额外约束'}\n\n## 客户端设置\n\`\`\`json wenxu-config\n${JSON.stringify(c, null, 2)}\n\`\`\`\n`;
}
export function parseConfig(text: string, existing: ProjectConfig): ProjectConfig {
  const raw = text.match(/```json wenxu-config\s*\n([\s\S]*?)\n```/);
  const value = { ...existing, ...(raw ? JSON.parse(raw[1]) : {}) };
  // Original Skill fields are authoritative too; a hidden client block is not
  // required for a reviewed creative configuration to become effective.
  const visible = text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '');
  const field = (label: string) => visible.match(new RegExp(`^ {0,3}[-*+][ \\t]+(?:\\*\\*)?${label}(?:\\*\\*)?[：:][ \\t]*(?:\\*\\*)?([^\\r\\n]+)`, 'm'))?.[1].trim();
  const words = (s: string | undefined) => {
    const match = s?.match(/^(\d+(?:\.\d+)?)\s*(万)?\s*(?:字|章)?$/);
    return match ? Number(match[1]) * (match[2] ? 10000 : 1) : undefined;
  };
  for (const [label, key] of [
    ['目标总字数', 'targetWords'],
    ['单章目标字数', 'chapterWords'],
    ['单章字数', 'chapterWords'],
    ['最少字数', 'minWords'],
    ['最多字数', 'maxWords'],
    ['每批章数', 'batchSize']
  ] as const) {
    const count = words(field(label));
    if (count !== undefined) value[key] = count;
  }
  const range = field('字数允许范围')?.match(/^(\d+)\s*字?\s*[-—–～~至]\s*(\d+)\s*字?$/);
  if (range) { value.minWords = Number(range[1]); value.maxWords = Number(range[2]); }
  for (const [label, key] of [['视角', 'pov'], ['题材', 'genre'], ['风格', 'style'], ['用户硬约束', 'constraints']] as const) {
    const content = field(label);
    if (content) value[key] = content;
  }
  return configSchema.parse(value);
}
export function renderProgress(p: ProjectState): string {
  const b = activeBatch(p),
    done = Object.entries(p.chapters)
      .filter(([, s]) => s === 'complete')
      .map(([n]) => Number(n));
  return `# 当前进度\n\n- 工作流版本：2.0\n- 项目版本：${p.revision}\n- 已完成章数：${done.length}\n- 最新完整章节：${done.length ? chapterTag(Math.max(...done)) : '暂无'}\n- 当前章节：${chapterTag(p.chapter)}\n- 当前阶段：${p.stage} ${stageNames[p.stage]}\n- 活动批次：${batchTag(b)}\n- 当前批次进度：${done.filter((n) => n >= b.start && n <= b.end).length}/${b.end - b.start + 1}\n- 下一步：${p.finished ? '全书计划已完成' : stageNames[p.stage]}\n- 未闭环改动：${p.stale.length ? p.stale.join('、') : '无'}\n`;
}
export function updateConfigDocument(text: string, p: ProjectState): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n',
    c = p.config;
  const values: Record<string, string | number> = {
    项目: p.title,
    工作流版本: '2.0',
    目标总字数: c.targetWords,
    单章目标字数: c.chapterWords,
    单章字数: c.chapterWords,
    最少字数: c.minWords,
    最多字数: c.maxWords,
    字数允许范围: `${c.minWords}—${c.maxWords}`,
    每批章数: c.batchSize,
    预计总章数: estimatedChapters(c),
    视角: c.pov,
    题材: c.genre,
    风格: c.style,
    用户硬约束: c.constraints || '暂无额外约束'
  };
  const additions: string[] = [];
  for (const [label, value] of Object.entries(values)) {
    const expression = new RegExp(`^- ${label}[：:][^\\r\\n]*`, 'gm');
    if (expression.test(text)) text = text.replace(expression, () => `- ${label}：${value}`);
    // Execution controls and legacy aliases stay in the managed block. Do not
    // append a second public configuration schema after the original template.
    else if (['工作流版本', '目标总字数', '单章字数', '字数允许范围', '视角', '风格', '用户硬约束'].includes(label)) additions.push(`- ${label}：${value}`);
  }
  const pattern = /```json wenxu-config\s*\r?\n([\s\S]*?)\r?\n```/,
    match = text.match(pattern);
  const managed = { ...(match ? JSON.parse(match[1]) : {}), ...c };
  const block =
    '```json wenxu-config' +
    newline +
    JSON.stringify(managed, null, 2).replaceAll('\n', newline) +
    newline +
    '```';
  text = match
    ? text.replace(pattern, () => block)
    : text + newline + newline + '## 客户端设置' + newline + block + newline;
  if (additions.length) {
    const firstSection = text.search(/^## /m);
    const at = firstSection < 0 ? text.length : firstSection;
    text = text.slice(0, at) + additions.join(newline) + newline + newline + text.slice(at);
  }
  return text;
}
export function reconfigure(p: ProjectState, config: ProjectConfig): ProjectState {
  const next = structuredClone(p),
    b = activeBatch(next);
  const planned =
    next.chapter > b.start ||
    !!next.completed[stageKey('S06', next.chapter, b)] ||
    !!next.completed[stageKey('S08', next.chapter, b)];
  if (estimatedChapters(config) < p.chapter) throw new Error('新目标章数小于当前写作位置，请先完成修订规划');
  if (planned && estimatedChapters(config) < b.end)
    throw new Error('新目标章数不能截断已经批准的批次，请先完成修订规划');
  next.config = config;
  if (!planned) {
    const changed = makeBatch(b.start, config);
    Object.assign(b, changed, { id: b.id });
  }
  next.revision++;
  return next;
}
