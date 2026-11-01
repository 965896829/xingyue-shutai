import { runTaskLoop } from './runtime/task-loop';
import type { ModelResult } from '../shared/types';
import { z } from 'zod';
import { compatibleRunBase } from './runtime-settings';
import {
  approvedCreation,
  titleBatchSchema,
  titleCandidateSchema,
  titleReviewSchema,
  titleRules,
  payoffStages,
  type TitleSelection
} from '../shared/creation';
import type { Run, ProjectState, SecretProfile, ToolDefinition } from '../shared/types';
import type { FileStore } from './storage';
import type { Caller } from './runner';
import { tagHash, planningBinding, assertPlanApproval, modelBookSpec } from './tags';
import { publishingResearchSpec } from './publishing';
import { controllerRules, assertControllerRules, taskEnvelope } from './agent-control';
import { expressionPack, bindExpressionRules, expressionFingerprint } from './expression-rules';
import { SkillRegistry } from './skill-registry';
import { callModel } from './runtime/model-gateway';
import { withTaskReasoning } from '../shared/reasoning';
import { beginTool, finishTool, stopOnToolFailure, type ToolTicket } from './runtime/tool-gateway';
import { setRunStatus } from './runtime/run-state';
import { ApplicationError } from '../shared/errors';
import { assertStructuredRepair } from './runtime/candidate-repair';
import { requestGuard, recordUsage, syncUsage } from './telemetry';
import { RequestError } from './provider';
import { loadTitleStyleProfile } from './title-style';
import { prepareTitleMarketResearch } from './title-market-research';
import { searchSettingsSchema, type SearchSettings } from '../shared/assistant';
import type { PublicSearch } from './search';
import {
  creationPromptResources,
  normalizedCandidateTitle,
  titleCandidateCount,
  titleHistoryDigest,
  titleSystemPrompt,
  titleEditorialResources
} from './creation-prompts';

export const titlePath = '02_项目配置/书名与入口承诺.md';
export function validateBookTitle(title: string, rule: keyof typeof titleRules = 'local') {
  const clean = title.trim();
  if (!clean || Array.from(clean).length > titleRules[rule].maxCharacters)
    throw new Error(`书名须为1至${titleRules[rule].maxCharacters}字符（${titleRules[rule].label}）`);
  if (/[\x00-\x1f]/.test(clean)) throw new Error('书名不能包含换行或控制字符');
  return clean;
}
export const normalizedTitle = normalizedCandidateTitle;

export function titleSource(store: FileStore, sourceRunId?: string) {
  const p = store.db.project();
  const currentPreferences = {
    genre: p.config.genre,
    pov: p.config.pov,
    style: p.config.style,
    constraints: p.config.constraints
  };
  if (sourceRunId) {
    const parent = store.db.run(sourceRunId);
    if (
      parent.accepted ||
      ['stale', 'discarded'].includes(parent.status) ||
      parent.planning?.phase !== 'ready'
    )
      throw new Error('来源策划不再是当前待采纳方案');
    planningBinding(store, parent);
    assertPlanApproval(parent);
    const t = parent.planning!;
    return {
      plan: t.candidate!.plan!,
      sourceHash: t.planApproval!.hash,
      inputHash: t.spec.inputHash,
      spec: t.spec,
      constraints: t.candidate!.constraints,
      currentPreferences
    };
  }
  const creation = approvedCreation(p);
  if (!creation?.contract.plan) throw new Error('请先在作品方案中补全并确认结构化方案，再生成书名');
  return {
    plan: creation.contract.plan,
    sourceHash: tagHash(creation),
    inputHash: creation.spec.inputHash,
    spec: creation.spec,
    constraints: creation.contract.constraints,
    contractRevision: creation.contract.revision,
    currentPreferences
  };
}
export function namingBinding(store: FileStore, r: Run) {
  if (!r.naming) throw new Error('不是独立命名任务');
  const t = r.naming,
    source = titleSource(store, t.sourceRunId);
  if (
    !compatibleRunBase(store, r) ||
    t.planHash !== tagHash(source.plan) ||
    t.sourceHash !== source.sourceHash ||
    t.inputHash !== source.inputHash ||
    t.contractRevision !== source.contractRevision
  )
    throw new Error('命名依据的方案或正式版本已改变，请重新生成书名');
  return source;
}
export function validateTitleBatch(raw: unknown, r: Run, source: ReturnType<typeof titleSource>, history: ReturnType<typeof titleHistoryDigest> = []) {
  const batch = titleBatchSchema.parse(raw),
    t = r.naming!;
  if (batch.planHash !== t.planHash) throw new Error('书名候选引用的方案指纹不一致');
  const expectedCount = titleCandidateCount(t);
  if (expectedCount !== undefined && batch.candidates.length !== expectedCount)
    throw new Error(`本批必须恰好${expectedCount}个书名候选`);
  const candidateIds = batch.candidates.map((v) => v.id);
  if (new Set(candidateIds).size !== candidateIds.length) throw new Error('书名候选编号重复');
  if (new Set(batch.candidates.map((v) => normalizedTitle(v.title))).size !== batch.candidates.length)
    throw new Error('书名候选存在文字重复');
  const claimIds = source.plan.statements.map((v) => v.id);
  for (const candidate of batch.candidates) {
    validateBookTitle(candidate.title, t.rule);
    if (!t.manualTitle && (!t.regenerate || candidate.id === t.regenerate.candidateId) &&
      t.marketResearch?.status === 'ready' && t.marketResearch.sources.some(sample => normalizedTitle(sample.title) === normalizedTitle(candidate.title)))
      throw new Error(`书名“${candidate.title}”与本批参考作品同名。保留故事承诺，换成本书自己的表达；这不是全站查重。`);
    const unknown = candidate.supportingClaimIds.filter(id => !claimIds.includes(id));
    if (unknown.length || new Set(candidate.supportingClaimIds).size !== candidate.supportingClaimIds.length)
      throw new Error(`书名“${candidate.title}”引用了不存在或重复的已确认方案条目${unknown.length ? '：' + unknown.join('、') : ''}。只能引用 plan.statements.id：${claimIds.join('、')}；约束编号不能填入 supportingClaimIds。保留书名与有效内容，仅修正引用。`);
    const claims = source.plan.statements.filter((v) => candidate.supportingClaimIds.includes(v.id));
    if (
      candidate.payoffStage === 'opening' &&
      claims.every((v) => v.payoffStage === 'long_term' || v.payoffStage === 'stage')
    )
      throw new Error('不能把仅有阶段或长期依据的承诺标为开篇事实');
  }
  if (
    new Set(batch.recommendedIds).size !== batch.recommendedIds.length ||
    batch.recommendedIds.some((id) => !candidateIds.includes(id))
  )
    throw new Error('推荐书名引用无效');
  if (t.manualTitle && (batch.candidates.length !== 1 || batch.candidates[0].title !== t.manualTitle))
    throw new Error('手填书名校验不能改写作者输入');
  if (t.regenerate) {
    if (!candidateIds.includes(t.regenerate.candidateId)) throw new Error('局部重做丢失原候选编号');
    for (const old of t.regenerate.original.candidates)
      if (
        old.id !== t.regenerate.candidateId &&
        tagHash(old) !== tagHash(batch.candidates.find((v) => v.id === old.id))
      )
        throw new Error('局部重做修改了其他书名');
    if (candidateIds.length !== t.regenerate.original.candidates.length)
      throw new Error('局部重做改变了候选数量');
  }
  // An explicit new batch or reroll must change its titles. An audit repair may keep a
  // title while correcting its promise or citations, and frozen slots are exempt.
  if (!t.manualTitle && !t.review) {
    const prior = new Set(history.map(v => normalizedTitle(v.title)));
    for (const candidate of batch.candidates) {
      if (t.regenerate && candidate.id !== t.regenerate.candidateId) continue;
      if (prior.has(normalizedTitle(candidate.title))) throw new Error('重新生成的书名与当前方案历史候选重复，请换一个名称');
    }
  }
  return batch;
}
export function assertTitleSelection(
  store: FileStore,
  selection: TitleSelection,
  sourceRunId: string | undefined,
  root: string
) {
  const child = store.db.run(selection.batchRunId),
    t = child.naming;
  const source = namingBinding(store, child);
  if (child.agentRulesHash) assertControllerRules(root, child.agentRulesHash);
  if (child.skillHash !== namingRulesHash(root, store.db.project(), t))
    throw new Error('命名规则已改变，请重新核对候选');
  if (
    !t ||
    t.phase !== 'ready' ||
    ['discarded', 'stale', 'unknown', 'paused', 'failed'].includes(child.status) ||
    t.sourceRunId !== sourceRunId ||
    selection.planHash !== t.planHash ||
    selection.sourceHash !== t.sourceHash ||
    selection.batchHash !== tagHash(t.batch) ||
    t.rule !== selection.rule ||
    t.review?.hash !== tagHash(t.batch) ||
    t.review.result.decisions.find((v) => v.candidateId === selection.candidate.id)?.verdict !== 'keep' ||
    tagHash(t.batch?.candidates.find((v) => v.id === selection.candidate.id)) !== tagHash(selection.candidate)
  )
    throw new Error('书名尚未通过当前方案的审核或候选已改变');
  validateTitleBatch(t.batch, child, source);
}
export function renderTitle(selection: ProjectState['titleBinding']) {
  if (!selection) throw new Error('缺少正式书名记录');
  const c = selection.candidate;
  return `# 书名与入口承诺\n\n此文件由正式记录生成，修改请使用“独立命名”。\n\n- 书名：${c.title}\n- 命名角度：${c.angle}\n- 方案指纹：${selection.planHash}\n- 候选任务：${selection.batchRunId}\n- 规则：${titleRules[selection.rule].label}\n- 规则核验日期：${titleRules[selection.rule].checkedAt}\n- 查重状态：未查重（本地候选去重不代表平台查重）\n- 状态：${selection.needsReview ? '待核对：' + selection.reason : '作者已确认'}\n\n## 阅读承诺\n${c.readerPromise}\n\n## 已确认方案依据\n${c.supportingClaimIds.map((id) => '- ' + id).join('\n')}\n\n## 预计兑现阶段\n${payoffStages[c.payoffStage]}\n\n## 风险提醒\n${c.riskNotes.map((v) => '- ' + v).join('\n') || '无额外提醒'}\n`;
}
export function namingRulesHash(root: string, p: ProjectState, naming?: Run['naming']) {
  return tagHash({
    skill: new SkillRegistry(root).load('webnovel-packaging').hash,
    prompts: creationPromptResources(root).hash,
    styleProfile: tagHash(loadTitleStyleProfile(root)),
    expression: expressionFingerprint(root, p.config),
    titleRules,
    version: 4,
    editorial: titleEditorialResources(root).hash,
    editorialVersion: naming?.editorialVersion,
    ...(naming?.marketResearchVersion ? { marketResearchVersion: naming.marketResearchVersion } : {})
  });
}

/** Independent persisted child task; generation and review never commit or advance stages. */
export async function driveTitleNaming(args: {
  store: FileStore;
  root: string;
  run: Run;
  project: ProjectState;
  writer: SecretProfile;
  profiles: () => SecretProfile[];
  caller: Caller;
  signal: AbortSignal;
  save: () => void;
  event: (text: string) => void;
  onActivity?: (phase: import('../shared/generation').GenerationPhase) => void;
  searchSettings?: SearchSettings;
  search?: PublicSearch | null;
}) {
  const { store, root, run: r, project: p, writer, profiles, caller, signal, save, event } = args;
  const t = r.naming!,
    rules = controllerRules(root),
    promptResources = creationPromptResources(root),
    styleProfile = loadTitleStyleProfile(root);
  const skillHash = namingRulesHash(root, p, t);
  if (r.skillHash && r.skillHash !== skillHash) throw new Error('命名规则已更新，请交接后继续');
  r.skillHash = skillHash;
  const reviewer = profiles().find((v) => v.id === (p.config.modelRouting.review || writer.id));
  if (!reviewer?.apiKey || !reviewer.enabled || !reviewer.tools) throw new Error('请配置可用的命名审核模型');
  for (const [role, profile] of [
    ['title_writer', writer],
    ['title_reviewer', reviewer]
  ] as const) {
    const prior = r.modelBindings?.[role];
    if (prior && (prior.id !== profile.id || prior.version !== profile.version))
      throw new Error('命名分工模型已改变，请交接任务');
    (r.modelBindings ??= {})[role] = { id: profile.id, version: profile.version };
  }
  await runTaskLoop({ executorId: r.executorId, signal,
    event: e => { if (e.type === 'turn_end') store.db.event(r.id, 'pi-turn', '当前子阶段回执已保存', { phase: t.phase, round: r.rounds }); },
    next: async () => {
    if (t.phase === 'ready') return;
    const source = namingBinding(store, r);
    assertControllerRules(root, rules.hash);
    if (namingRulesHash(root, store.db.project(), t) !== skillHash) throw new Error('命名规则已更新');
    if (signal.aborted) throw new RequestError('作者已停止命名', false);
    if (r.rounds >= p.config.maxRounds || r.toolCount >= p.config.maxTools)
      throw new ApplicationError(r.rounds >= p.config.maxRounds ? 'ROUND_LIMIT' : 'TOOL_LIMIT', '命名与审核预算已用完，已有候选已保留');
    const reviewing = t.phase === 'reviewing',
      profile = withTaskReasoning(reviewing ? reviewer : writer, r);
    if (profiles().find((v) => v.id === profile.id)?.version !== profile.version)
      throw new Error('模型配置已改变');
    if (!reviewing) {
      await prepareTitleMarketResearch({ store, root, run: r, project: p, profile, spec: t.sourceRunId ? source.spec : publishingResearchSpec(store, source.spec),
        genre: source.currentPreferences.genre, plan: source.plan, settings: args.searchSettings ?? searchSettingsSchema.parse({}),
        search: args.search, caller, signal, save, event, onActivity: args.onActivity });
      namingBinding(store, r);
      if (signal.aborted) throw new RequestError('作者已停止命名', false);
      if (r.rounds >= p.config.maxRounds || r.toolCount >= p.config.maxTools)
        throw new ApplicationError(r.rounds >= p.config.maxRounds ? 'ROUND_LIMIT' : 'TOOL_LIMIT', '命名预算已用完，已保存联网资料');
    }
    const name = reviewing ? 'submit_title_review' : 'submit_title_candidates';
    const expectedCount = titleCandidateCount(t);
    const candidateSchema = titleCandidateSchema.extend({ supportingClaimIds: z.array(z.enum(source.plan.statements.map(v => v.id))).min(1).max(40) });
    const candidates = z.array(candidateSchema).min(1).max(12);
    const batchSchema = titleBatchSchema.extend({ candidates: expectedCount === undefined ? candidates : candidates.length(expectedCount) });
    const marketEdition = t.editorialVersion === 2;
    const reviewSchema = marketEdition
      ? titleReviewSchema.extend({ recommendedIds: z.array(z.string().min(1).max(100)).max(3) })
      : titleReviewSchema.omit({ recommendedIds: true });
    const tools: ToolDefinition[] = [
      {
        name,
        description: '提交书名候选或独立审核；不修改作品、不发布。',
        parameters: z.toJSONSchema(reviewing ? reviewSchema : batchSchema) as Record<
          string,
          unknown
        >
      }
    ];
    const expression = expressionPack(root, p.config, 'title_market');
    bindExpressionRules(r, expression.binding);
    const system = titleSystemPrompt({
      controller: rules.content,
      resources: promptResources,
      naming: t,
      reviewing,
      submitTool: name,
      expression: expression.prompt,
      editorial: titleEditorialResources(root)
    });
    const history = titleHistoryDigest(r, store.db.runs());
    if (!r.messages.length)
      r.messages = [
        {
          role: 'user',
          content: JSON.stringify({
            ...taskEnvelope(store, root, r, 'planning'),
            confirmedPlan: { ...source, spec: modelBookSpec(source.spec) },
            planHash: t.planHash,
            rule: titleRules[t.rule],
            marketTarget: { platform: 'fanqie', genre: t.marketResearch?.genre ?? source.currentPreferences.genre,
              tags: t.marketResearch?.tags ?? [] },
            ...(t.marketResearch?.status === 'ready' ? {} : { styleProfile }),
            ...(t.marketResearch ? { marketResearch: t.marketResearch } : {}),
            manualTitle: t.manualTitle,
            instruction: t.instruction,
            batch: t.batch,
            reviewFeedback: reviewing ? undefined : t.review?.result,
            regenerate: reviewing && t.regenerate ? { candidateId: t.regenerate.candidateId, instruction: t.regenerate.instruction } : t.regenerate,
            repairScope: !reviewing && t.repair ? { pointers: t.repair.pointers, instruction: '原候选即本轮batch。只修复审核未通过的候选，其他候选原样保留。不得改写作者手填书名。' } : undefined,
            candidateCount: expectedCount,
            history: reviewing ? undefined : marketEdition ? history.map(({ sourceRunId, candidateId, title }) => ({ sourceRunId, candidateId, title })) : history
          })
        }
      ];
    syncUsage(store, r);
    requestGuard(profile, system, r.messages, tools, r, p.config.stageBudget);
    r.rounds++;
    setRunStatus(r, 'running');
    event(reviewing ? '正在审核书名承诺与方案依据' : '正在按不同卖点生成书名');
    store.db.set(`inflight:${r.id}`, true);
    save();

    let response!: ModelResult, handled = false;
    const submit = async () => {
      if (handled) return;
      handled = true;
      const result = response;
    let ticket: ToolTicket | undefined;
    let toolError: string | undefined;
    try {
      if (result.calls.length !== 1 || result.calls[0].name !== name)
        throw new Error('请只调用当前提交工具一次');
      if (r.toolCount > p.config.maxTools) throw new ApplicationError('TOOL_LIMIT', '已达到工具调用总上限');
      ticket = beginTool(store, r.id, result.calls[0], tools, signal);
      if (ticket.status === 'complete') throw new Error('当前命名步骤已经完成，请恢复状态');
      const value = JSON.parse(result.calls[0].arguments);
      if (!reviewing) {
        if (t.repair) assertStructuredRepair(t.repair.original, value, t.repair.pointers);
        t.batch = validateTitleBatch(value, r, source, history);
        if (t.repair && t.review?.hash === tagHash(t.batch)) {
          // An automatic correction that changed nothing retains its negative
          // verdict. Never ask the reviewer to reconsider identical candidates.
          t.phase = 'ready';
          t.repair = undefined;
          event('候选未发生变化，保留已有检查结果');
        } else {
          t.review = undefined;
          t.phase = 'reviewing';
        }
      } else {
        const review = titleReviewSchema.parse(value),
          expected = t.batch!.candidates.map((v) => v.id);
        if (
          new Set(review.decisions.map((v) => v.candidateId)).size !== expected.length ||
          review.decisions.length !== expected.length ||
          review.decisions.some((v) => !expected.includes(v.candidateId))
        )
          throw new Error('命名审核必须覆盖每个候选且不能引用未知编号');
        // Recommendation is editorial advice: discard stale/unsupported IDs without starting another model request.
        if (marketEdition) {
          const supported = new Set(review.decisions.filter(decision => decision.verdict === 'keep').map(decision => decision.candidateId));
          review.recommendedIds = [...new Set(review.recommendedIds ?? [])].filter(id => supported.has(id) && expected.includes(id)).slice(0, 3);
        }
        t.review = { hash: tagHash(t.batch), result: review };
        const rejected = review.decisions.filter(v => v.verdict !== 'keep').map(v => v.candidateId);
        const repairable = rejected.filter(id => !t.regenerate || id === t.regenerate.candidateId);
        const usable = review.decisions.some(v => v.verdict === 'keep' && (!t.regenerate || v.candidateId === t.regenerate.candidateId));
        // Deliver usable options immediately. Repair only when the requested
        // scope has no valid choice; rejected candidates remain unselectable.
        if (!usable && repairable.length && !t.manualTitle && t.semanticRevisions < 1) {
          t.semanticRevisions++;
          t.history.push({ batch: structuredClone(t.batch!), review });
          t.repair = { original: structuredClone(t.batch!), pointers: [...t.batch!.candidates.flatMap((v, index) => repairable.includes(v.id) ? [`/candidates/${index}`] : []), '/recommendedIds'] };
          store.db.event(r.id, 'local-repair-scope', '保留通过审核的书名，只修复其余候选', { candidateIds: repairable });
          t.phase = 'generating';
        } else { t.phase = 'ready'; t.repair = undefined; }
      }
      t.consecutiveFormatFailures = 0;
      r.messages = [];
      r.error = undefined;
      save();
    } catch (e) {
      stopOnToolFailure(e);
      toolError = (e as Error).message;
      store.db.event(r.id, 'format-repair', '书名提交未通过本地检查', { phase: t.phase, error: toolError });
      t.formatRepairs++;
      t.consecutiveFormatFailures = (t.consecutiveFormatFailures ?? 0) + 1;
      for (const call of result.calls)
        r.messages.push({
          role: 'tool',
          callId: call.id,
          content: JSON.stringify({ ok: false, error: (e as Error).message })
        });
      if (!result.calls.length) r.messages.push({ role: 'user', content: '请使用当前结构化工具提交。' });
      save();
      if (ticket) {
        finishTool(store, ticket, JSON.stringify({ ok: false, error: toolError }), () => store.db.saveRun(r));
        ticket = undefined;
      }
      if (t.consecutiveFormatFailures > 2) throw new ApplicationError('FORMAT_INVALID', '命名结构校验连续失败：' + (e as Error).message);
    }
    if (ticket)
      finishTool(store, ticket, JSON.stringify(toolError ? { ok: false, error: toolError } : { phase: t.phase, hash: tagHash(t.batch) }), () =>
        store.db.saveRun(r)
      );
    };
    return { profile, system, messages: r.messages, tools,
      request: delta => callModel(
      store,
      r,
      'titles:' + t.phase,
      caller,
      profile,
      system,
      r.messages,
      tools,
      signal,
      delta,
      { onActivity: args.onActivity }
    ),
      received: async result => {
    recordUsage(store, r, result.usage, {
      phase: 'titles:' + t.phase,
      profileId: profile.id,
      profileVersion: profile.version,
      usage: result.usage
    });
    store.db.set(`inflight:${r.id}`, false);
    assertControllerRules(root, rules.hash);
    if (signal.aborted) {
      save();
      throw new RequestError('返回时命名已停止，未自动选择或采纳', false);
    }
    namingBinding(store, r);
    if (result.stop === 'length' || result.stop === 'filtered') throw new Error('命名输出未完成，候选已保留');
    r.messages.push({ role: 'assistant', content: result.text, calls: result.calls, native: result.native });
    r.toolCount += result.calls.length;

        response = result; save(); return true;
      },
      execute: async () => { await submit(); return { proceed: r.status === 'running', content: JSON.stringify({ phase: t.phase }) }; },
      finish: async () => { await submit(); return r.status === 'running' && !(t.phase === 'ready'); }
    };
  } });
  if (!(t.phase === 'ready')) return;
  setRunStatus(r, 'awaiting_review');
  r.responseText = '书名候选已审核，请在作品方案的独立命名中选择；选择不会自动推进阶段。';
  save();
}
