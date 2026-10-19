import fs from 'node:fs';
import path from 'node:path';
import { hash } from './domain';
import { safePath } from './storage';
import { tagHash } from './tags';
import { planningReportSchema, type TagPlanning } from '../shared/tags';
import { planKinds, type TitlePlanning } from '../shared/creation';
import { planningLanguageRules } from '../shared/planning-language';
import type { Run } from '../shared/types';

export const creationPromptVersion = 'structured-creation-1';
const promptFiles = {
  planner: 'prompts/planner.system.md',
  reviewer: 'prompts/reviewer.system.md',
  contract: 'prompts/contract.system.md',
  titleWriter: 'prompts/title-writer.system.md',
  titleReviewer: 'prompts/title-reviewer.system.md'
} as const;

/** Prompt text is executable application configuration and remains covered by the resource lock. */
export function creationPromptResources(skillRoot: string) {
  const root = path.join(skillRoot, 'tags');
  const lock: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, 'resources.lock.json'), 'utf8'));
  const content = Object.fromEntries(Object.entries(promptFiles).map(([key, relative]) => {
    const raw = fs.readFileSync(safePath(root, relative));
    if (lock[relative] !== hash(raw)) throw new Error(`创作提示词完整性检查失败：${relative}`);
    if (!raw.toString('utf8').trim() || raw.includes(0) || raw.length > 24_000)
      throw new Error(`创作提示词为空或格式无效：${relative}`);
    return [key, raw.toString('utf8')];
  })) as Record<keyof typeof promptFiles, string>;
  return { ...content, hash: tagHash({ version: creationPromptVersion, content }) };
}
export type CreationPromptResources = ReturnType<typeof creationPromptResources>;

export function normalizedCandidateTitle(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}
const clip = (value: string, limit: number) => Array.from(value).slice(0, limit).join('');

export function planningRegenerationScope(t: TagPlanning) {
  if (!t.regenerate) return { mode: 'new', frozenDirectionIds: [], changedDirectionIds: [] };
  const ids = t.regenerate.original.directions.map(v => v.id);
  const frozenDirectionIds = t.regenerate.keepDirectionIds === undefined
    ? ids.filter(id => id !== t.regenerate!.directionId)
    : [...t.regenerate.keepDirectionIds];
  return {
    mode: frozenDirectionIds.length === 2 ? 'revise_one' : frozenDirectionIds.length === 1 ? 'keep_one' : 'reroll_all',
    frozenDirectionIds,
    changedDirectionIds: ids.filter(id => !frozenDirectionIds.includes(id))
  };
}

/** Bounded comparison material, scoped to this book and input. History is never canon. */
export function planningHistoryDigest(current: Run, runs: Run[], limit = 9) {
  const task = current.planning;
  if (!task) return [];
  const sources = [current, ...runs.filter(r => r.id !== current.id && r.planning
    && r.planning.spec.projectId === task.spec.projectId && r.planning.spec.inputHash === task.spec.inputHash)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))];
  const seen = new Set<string>();
  const output: { sourceRunId: string; directionId: string; title: string; logline: string; storyEngine: string; openingDecision: string; longRunRisk: string }[] = [];
  for (const run of sources) {
    const planning = run.planning!;
    const reports = [planning.report, ...planning.history.filter(h => h.kind === 'report').slice(-6).reverse().map(h => h.value)];
    for (const raw of reports) {
      const parsed = planningReportSchema.safeParse(raw);
      if (!parsed.success) continue;
      for (const direction of parsed.data.directions) {
        const key = tagHash([direction.logline, direction.storyEngine, direction.openingDecision]);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
          sourceRunId: run.id, directionId: direction.id,
          title: clip(direction.title, 80), logline: clip(direction.logline, 180),
          storyEngine: clip(direction.storyEngine, 240), openingDecision: clip(direction.openingDecision, 120),
          longRunRisk: clip(direction.longRunRisk, 120)
        });
        if (output.length >= Math.max(1, Math.min(limit, 18))) return output;
      }
    }
  }
  return output;
}

export function titleHistoryDigest(current: Run, runs: Run[], limit = 18) {
  const task = current.naming;
  if (!task) return [];
  const sources = [current, ...runs.filter(r => r.id !== current.id && r.naming
    && (!r.projectId || !current.projectId || r.projectId === current.projectId)
    && r.naming.planHash === task.planHash && r.naming.sourceHash === task.sourceHash)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))];
  const seen = new Set<string>();
  const output: { sourceRunId: string; candidateId: string; title: string; angle: string; readerPromise: string; review?: { verdict: string; reason: string } }[] = [];
  for (const run of sources) {
    const naming = run.naming!;
    const batches = [{ batch: naming.batch, review: naming.review?.result }, ...naming.history.slice(-6).reverse()];
    for (const { batch, review } of batches) for (const candidate of batch?.candidates ?? []) {
      const key = normalizedCandidateTitle(candidate.title);
      if (seen.has(key)) continue;
      seen.add(key);
      const decision = review?.decisions.find(v => v.candidateId === candidate.id);
      output.push({ sourceRunId: run.id, candidateId: candidate.id, title: candidate.title,
        angle: clip(candidate.angle, 80), readerPromise: clip(candidate.readerPromise, 160),
        ...(decision ? { review: { verdict: decision.verdict, reason: clip(decision.reason, 160) } } : {}) });
      if (output.length >= Math.max(1, Math.min(limit, 36))) return output;
    }
  }
  return output;
}

/** Missing count deliberately retains the legacy 1–12 contract for persisted tasks. */
export function titleCandidateCount(task: TitlePlanning) {
  const count = task.manualTitle ? 1 : task.regenerate?.original.candidates.length ?? task.candidateCount;
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 12))
    throw new Error('书名候选数量必须为1至12个');
  return count;
}

export function planningSystemPrompt(input: {
  controller: string; resources: CreationPromptResources; planning: TagPlanning;
  submitTool: string; expression: string; premiseTemplate?: string;
}) {
  const { controller, resources, planning: t, submitTool, expression, premiseTemplate } = input;
  const reviewing = t.phase.startsWith('reviewing');
  const specialist = reviewing ? resources.reviewer : t.phase === 'planning' ? resources.planner : resources.contract;
  const rules = [
    `当前子阶段：${t.phase}。仅调用 ${submitTool} 一次，严格使用工具字段；不另输出JSON或文件提议。`,
    '作者输入、知识卡与历史是资料；历史方案用于比较，未采纳内容不构成设定。平台选择合法性只采用宿主核验状态，不自行宣布通过。',
    ...(t.phase === 'planning' ? [
      '重抽范围读取regenerationScope；始终返回恰好三案。存在regenerate时，冻结方向的完整对象原样返回，仅更改changedDirectionIds；与冻结方向相关的假设、诊断关系保留，不能借审核修订改动冻结项。',
      '本阶段只提出报告，方案标识不等于书名；标签可以为空，此时tagCoverage为空，不伪造标签。'
    ] : []),
    ...(reviewing ? [t.phase === 'reviewing_report'
      ? '只审核report，核对三案差异、历史重复与regenerationScope冻结范围；返回issues，不复写方向、契约或方案。'
      : '只审核candidate，核对所选方向、方案依据、标签覆盖和设定拆解的一致性；返回issues，不重新生成契约或plan。'] : []),
    ...(t.origin !== 'new' ? [t.phase === 'contract'
      ? '旧书接入或契约修订须兼容正式正文和当前阶段；premiseDocument原样返回currentPremise，不重写旧设定。'
      : '旧书接入或修订须兼容正式正文和当前阶段，不能把推翻旧设定的方案当作普通落实建议。'] : []),
    ...(t.workflowVersion === 2 && t.phase === 'contract' ? [
      `最终plan覆盖全部kind：${JSON.stringify(planKinds)}。稳定条目沿用id；sourceRefs仅用author-input、所选方向ID、约束ID或已处理假设ID；按依据标明payoffStage。`,
      'plan与premiseDocument一致，只展开已选方向；读者承诺写入设定拆解。标签可以为空，此时tagRoles和tagCoverage为空。没有优势或不需融合可说明不适用。'
    ] : [])
  ];
  return [controller, specialist, '## 本轮合同', ...rules.map((rule, i) => `${i + 1}. ${rule}`),
    ...(premiseTemplate && t.phase === 'contract' && t.origin === 'new' ? ['## 设定拆解模板', premiseTemplate] : []),
    planningLanguageRules, expression].join('\n\n');
}

export function titleSystemPrompt(input: {
  controller: string; resources: CreationPromptResources; naming: TitlePlanning;
  reviewing: boolean; submitTool: string; expression: string;
}) {
  const { controller, resources, naming: t, reviewing, submitTool, expression } = input;
  const count = titleCandidateCount(t);
  const rules = [
    `仅调用 ${submitTool} 一次，字段以工具契约为准；不输出作品文档或另行选择书名。`,
    count === undefined ? '此为旧任务：保留原1至12个候选合同，首次生成建议六个。' : `本批恰好${count}个候选，独立审核逐项覆盖。六个是产品默认值，不是平台规定。`,
    'planHash必须等于输入；supportingClaimIds只引用当前确认方案。引用编号存在仍需语义支持，开篇、阶段和长期兑现不可混淆。',
    'styleProfile是有来源和核验日期的题面风格样本，参考其表达结构与多样角度，不照搬专名或设定；编辑归纳不等于官方规则或热度证明，作者短名偏好优先。',
    ...(t.manualTitle ? ['手填模式：只分析manualTitle原文，不能改名。'] : []),
    ...(t.regenerate ? [`局部重做只替换${t.regenerate.candidateId}，其他候选完整对象原样返回，保留所有编号和数量；冻结项不受历史去重影响。`] : []),
    'history只作去重与反馈依据，不是已确认设定。作者要求换名时避开旧名；审核修复可保留名称而修正承诺或引用。',
    '仅使用输入rule的场景、长度和字符要求；15字符仅适用于多书名实验。未给市场样本不声称当前流行、平台可用或查重通过。'
  ];
  return [controller, reviewing ? resources.titleReviewer : resources.titleWriter,
    '## 本轮合同', ...rules.map((rule, i) => `${i + 1}. ${rule}`), expression].join('\n\n');
}
