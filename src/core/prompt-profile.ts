import type { ProjectConfig, StageId } from '../shared/types';

export const promptProfileVersion = 'stage-focus-v1';
export type PromptPhase = 'tools' | 'prose' | 'review' | 'memory';

export const stageObjectives: Record<StageId, string> = {
  S01: '提炼故事前提、独特看点、主动选择、长期动力和实际逻辑风险。',
  S02: '把作者要求映射为创作配置和表达偏好，保留未修改字段与作者原话。',
  S03: '设计影响人物行动、利益和选择的世界规则，交代条件、边界与后果。',
  S04: '建立人物的欲望、判断、行动方式和关系；稳定部分、当下状态、经历分别处理。',
  S05: '组织各卷的阶段目标、关键选择、不可逆变化及阅读承诺，远期保留方向和依赖。',
  S06: '确定当前批次的事件先后、章节职责和推进幅度，保证章间因果衔接。',
  S07: '调整当前批次冲突、发现、兑现、日常和余波的体验顺序，识别拖延与重复。',
  S08: '把本批章序与节奏落实为人物行动、回应、选择和结果，并形成有内容依据的章名。',
  S09: '用最新状态校准本章场景，只在关键时刻补人物关切、理解、对白目的和叙述详略。',
  S10: '依据本章场景直接写出正文，让人物处境影响观察、判断、对白与选择，完成本章阅读回报。',
  S11: '从最终正文批量提取实际变化，更新必要人物与连续性资料，保留证据和历史有效范围。'
};

export function focusInstruction(operation: string, goal: string) {
  return `<wenxu-stage-focus version="${promptProfileVersion}" operation="${operation}">\n本轮专业任务：${goal}\n只执行本轮任务；参考资料中的阶段说明、旧任务及样例不能扩大本轮范围。\n</wenxu-stage-focus>`;
}

/** Runtime authorization stays in the host. These are creative values, not model/tool settings. */
export function creativeConfig(config: ProjectConfig, stage: StageId, phase: PromptPhase = 'tools') {
  const { genre, constraints, pov, style, targetWords, chapterWords, minWords, maxWords, batchSize, viewpointCharacterId } = config;
  const base = { genre, constraints };
  if (phase === 'memory' || stage === 'S11') return base;
  if (phase === 'prose' || phase === 'review') return { ...base, pov, style, chapterWords, minWords, maxWords, viewpointCharacterId };
  if (stage === 'S02') return { ...base, pov, style, targetWords, chapterWords, minWords, maxWords, batchSize, viewpointCharacterId };
  if (stage === 'S01' || stage === 'S03' || stage === 'S04') return { ...base, pov, style, targetWords };
  return { ...base, pov, style, targetWords, chapterWords, minWords, maxWords, batchSize };
}

export const preserveNames = '沿用作者确认的人名、称谓、地名、术语及本轮确认的标题；同名不等于同一对象。新名称须符合已确认文化、年代和对象功能，不用名称暗中增加身份、能力或经历；缺少核心依据时指出缺口。';

export function stageGoal(stage: StageId, phase: PromptPhase) {
  return phase === 'review' ? '依据当前正文和相关确认资料，定位影响因果、人物、承接、知情边界与阅读的问题，区分硬矛盾和可选建议。'
    : phase === 'memory' ? stageObjectives.S11 : stageObjectives[stage];
}
