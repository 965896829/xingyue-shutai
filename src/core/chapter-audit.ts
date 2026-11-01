import type { Profile, Issue } from '../shared/types';
import { countInput, contextAllowance } from './context-budget';
import { memoryReviewInput, parseMemoryDecisions, memoryDecisionIssues } from './memory-review';
import { futurePlanReviewInput, parseFuturePlanReview } from './future-plan-review';

export const memoryAuditInstruction = '你独立检查最终正文、本轮结构化事实、人物覆盖及实际修改的人物卡、关系和行为记录。核对主体、否定、伤势、世界、知情、事实类别及有效故事位置，结论须由当前版本原文支持，不只检查引文存在。action=retract 检查撤回理由；action=review_document 将该资料、previous 修改前文本与最终正文及 relatedFacts 对照，声明无需修改也须核对。当前痊愈不能仍写断臂；旧状态在原有效位置仍成立，被撤回的错误记录不能复活。信念、计划、推测、比喻与客观事实分开。无变化、仅提及、依据不足的人物覆盖可以通过，不为填满字段新增事实。scope.mode=forward 只调整生效位置后的未写计划，impacts 含 creationChange 时依明确生效范围核对，保留已有正文与历史。不修改正文，不扩大范围，不为提取结果辩护。事实本身证据不足判 unclear，矛盾判 contradicted。逐条返回 {"decisions":[{"id":"原编号","verdict":"supported|contradicted|unclear","reason":"判断依据","evidence":[{"path":"来源路径","quote":"准确原文"}]}]}。';
export const planAuditInstruction = '你独立核对本章实际正文与未写的后续计划是否相容。新事实得到实现不等于偏离计划；对照人物状态、物品归属、伤势、知情、时限、规则与章末承接，逐份判断。consistent表示原计划仍可执行，needs_review表示存在具体冲突或缺少足够依据；不要因文句不同、正常细化或新增事实就机械判冲突。未来计划不是已发生事件；不修改正文或计划。每份必须同时引用计划和正文各一段连续准确原文，并说明相容的理由或具体需同步之处。只返回 {"decisions":[{"path":"计划路径","verdict":"consistent|needs_review","reason":"具体依据","planQuote":"计划准确原文","proseQuote":"当前正文准确原文"}]}。';
export const chapterAuditInstruction = `本次独立章后核对包含两个检查，共享原文资料，不互相替代。\n记忆检查：${memoryAuditInstruction}\n计划检查：${planAuditInstruction}\n完整原文仅在 sources 中出现一次；prose 与 plans 是指向相同 path/hash 的索引。items 中的事实全为待核对结论，不能当作独立证明。逐条审查所有 items、逐份审查所有 plans，分别保留原格式，统一返回 {"memory":{"decisions":[...]},"plans":{"decisions":[...]}}，不得省略任何一项。`;
export const compactAuditInstruction = '\n回执去重：每条事实仍必须独立给出 id、verdict、reason。若采用该条 fact.evidence 中已有引文，优先用 evidenceRefs:[0] 引用其从0开始的序号，替代重复的 evidence 路径及引文；先回原文核实含义，编号不是通过依据。需要另一段证据时可同时补充完整 evidence，仅填写新增引文。通过项的 reason 写一句具体判断，不复述整条事实和引文；有矛盾或证据不足仍完整说明问题。计划仍逐份给出准确的 planQuote/proseQuote，只引能证明判断的连续片段，不重复长段正文。不得省略项目、仅给总评或默认通过。';

type MemoryInput = ReturnType<typeof memoryReviewInput>;
type PlanInput = ReturnType<typeof futurePlanReviewInput>;

export function chapterAuditInput(memory: MemoryInput, plans: PlanInput) {
  const sources = new Map<string, MemoryInput['sources'][number]>();
  for (const source of [...memory.sources, plans.prose, ...plans.plans]) {
    const prior = sources.get(source.path);
    if (prior && (prior.hash !== source.hash || prior.content !== source.content))
      throw new Error(`章后核对的原文版本不一致：${source.path}`);
    sources.set(source.path, { ...prior, ...source });
  }
  return { chapter: plans.chapter, fromChapter: plans.fromChapter,
    items: memory.items, scope: memory.scope, impacts: memory.impacts, relatedFacts: memory.relatedFacts,
    prose: { path: plans.prose.path, hash: plans.prose.hash },
    plans: plans.plans.map(({ path, hash }) => ({ path, hash })), sources: [...sources.values()] };
}

/** Small output budgets and large repairs retain the existing paged audit.
 * Input and output capacity are both checked before choosing the shared call. */
export function canCombineChapterAudit(profile: Profile, input: ReturnType<typeof chapterAuditInput>, resident: string) {
  const outputNeeded = 2048 + 512 * (input.items.length + input.plans.length);
  return input.items.length <= 32 && profile.outputLimit >= Math.max(8192, outputNeeded) &&
    countInput(profile, { system: resident + chapterAuditInstruction, input }).tokens + 2048 <= contextAllowance(profile).availableInput;
}

export function parseChapterAudit(raw: string, memory: MemoryInput, plans: PlanInput) {
  const result = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  // Parse both completely before returning either receipt. A truncated plan
  // decision must not mark the facts reviewed or permit a partially checked save.
  // Validate against exactly the sources sent to this combined reviewer. A plan
  // may supplement a prose quote (for example, bind an unnamed actor to a card),
  // but parseMemoryReview still requires the fact's own primary source.
  const shared = chapterAuditInput(memory, plans);
  const targets: Issue[] = [];
  const memoryDecisions = parseMemoryDecisions(JSON.stringify(result.memory), memory.items, shared.sources);
  const issues = memoryDecisionIssues(memoryDecisions, memory.items, issue => targets.push(issue));
  const futurePlanReview = parseFuturePlanReview(JSON.stringify(result.plans), plans);
  const sources = shared.sources.filter(source => !memory.sources.some(s => s.path === source.path))
    .map(({ path, hash }) => ({ path, hash }));
  return { memoryReview: { fingerprint: memory.fingerprint, issues, targets, sources }, futurePlanReview, memoryDecisions };
}
