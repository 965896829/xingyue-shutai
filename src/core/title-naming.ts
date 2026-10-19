import { z } from 'zod';
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
import { tagHash, planningBinding, assertPlanApproval } from './tags';
import { controllerRules, assertControllerRules, taskEnvelope } from './agent-control';
import { expressionPack, bindExpressionRules, expressionFingerprint } from './expression-rules';
import { SkillRegistry } from './skill-registry';
import { callModel } from './runtime/model-gateway';
import { beginTool, finishTool, stopOnToolFailure, type ToolTicket } from './runtime/tool-gateway';
import { setRunStatus } from './runtime/run-state';
import { requestGuard, recordUsage, syncUsage } from './telemetry';
import { RequestError } from './provider';
import { loadTitleStyleProfile } from './title-style';
import {
  creationPromptResources,
  normalizedCandidateTitle,
  titleCandidateCount,
  titleHistoryDigest,
  titleSystemPrompt
} from './creation-prompts';

export const titlePath = '02_项目配置/书名与入口承诺.md';
export function validateBookTitle(title: string, rule: keyof typeof titleRules = 'local') {
  const clean = title.trim();
  if (!clean || Array.from(clean).length > titleRules[rule].maxCharacters)
    throw new Error(`书名须为1至${titleRules[rule].maxCharacters}字符（${titleRules[rule].label}）`);
  if (
    /[<>:"/\\|?*\x00-\x1f]/.test(clean) ||
    /[. ]$/.test(clean) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)
  )
    throw new Error('书名包含本地保存不支持的字符或 Windows 保留名称');
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
    p = store.db.project(),
    source = titleSource(store, t.sourceRunId);
  if (
    r.baseRevision !== p.revision ||
    r.baseSnapshotId !== store.db.get('headSnapshot') ||
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
    if (
      new Set(candidate.supportingClaimIds).size !== candidate.supportingClaimIds.length ||
      candidate.supportingClaimIds.some((id) => !claimIds.includes(id))
    )
      throw new Error('书名引用了不存在或重复的已确认方案条目');
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
  if (child.skillHash !== namingRulesHash(root, store.db.project()))
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
export function namingRulesHash(root: string, p: ProjectState) {
  return tagHash({
    skill: new SkillRegistry(root).load('webnovel-packaging').hash,
    prompts: creationPromptResources(root).hash,
    styleProfile: tagHash(loadTitleStyleProfile(root)),
    expression: expressionFingerprint(root, p.config),
    titleRules,
    version: 3
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
}) {
  const { store, root, run: r, project: p, writer, profiles, caller, signal, save, event } = args;
  const t = r.naming!,
    rules = controllerRules(root),
    promptResources = creationPromptResources(root),
    styleProfile = loadTitleStyleProfile(root);
  const skillHash = namingRulesHash(root, p);
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
  while (t.phase !== 'ready') {
    const source = namingBinding(store, r);
    assertControllerRules(root, rules.hash);
    if (namingRulesHash(root, store.db.project()) !== skillHash) throw new Error('命名规则已更新');
    if (signal.aborted) throw new RequestError('作者已停止命名', false);
    if (r.rounds >= p.config.maxRounds || r.toolCount >= p.config.maxTools)
      throw new Error('命名与审核预算已用完，已有候选已保留');
    const reviewing = t.phase === 'reviewing',
      profile = reviewing ? reviewer : writer;
    if (profiles().find((v) => v.id === profile.id)?.version !== profile.version)
      throw new Error('模型配置已改变');
    const name = reviewing ? 'submit_title_review' : 'submit_title_candidates';
    const expectedCount = titleCandidateCount(t);
    const batchSchema = expectedCount === undefined ? titleBatchSchema
      : titleBatchSchema.extend({ candidates: z.array(titleCandidateSchema).length(expectedCount) });
    const tools: ToolDefinition[] = [
      {
        name,
        description: '提交书名候选或独立审核；不修改作品、不发布。',
        parameters: z.toJSONSchema(reviewing ? titleReviewSchema : batchSchema) as Record<
          string,
          unknown
        >
      }
    ];
    const expression = expressionPack(root, p.config, reviewing ? 'review' : 'planning');
    bindExpressionRules(r, expression.binding);
    const system = titleSystemPrompt({
      controller: rules.content,
      resources: promptResources,
      naming: t,
      reviewing,
      submitTool: name,
      expression: expression.prompt
    });
    const history = titleHistoryDigest(r, store.db.runs());
    if (!r.messages.length)
      r.messages = [
        {
          role: 'user',
          content: JSON.stringify({
            ...taskEnvelope(store, root, r, 'planning'),
            confirmedPlan: source,
            planHash: t.planHash,
            rule: titleRules[t.rule],
            styleProfile,
            manualTitle: t.manualTitle,
            instruction: t.instruction,
            batch: t.batch,
            reviewFeedback: t.review?.result,
            regenerate: t.regenerate,
            candidateCount: expectedCount,
            history
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
    const result = await callModel(
      store,
      r,
      'titles:' + t.phase,
      caller,
      profile,
      system,
      r.messages,
      tools,
      signal,
      () => {}
    );
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
    let ticket: ToolTicket | undefined;
    try {
      if (result.calls.length !== 1 || result.calls[0].name !== name)
        throw new Error('请只调用当前提交工具一次');
      if (r.toolCount > p.config.maxTools) throw new Error('已达到工具调用总上限');
      ticket = beginTool(store, r.id, result.calls[0], tools, signal);
      if (ticket.status === 'complete') throw new Error('当前命名步骤已经完成，请恢复状态');
      const value = JSON.parse(result.calls[0].arguments);
      if (!reviewing) {
        t.batch = validateTitleBatch(value, r, source, history);
        t.review = undefined;
        t.phase = 'reviewing';
      } else {
        const review = titleReviewSchema.parse(value),
          expected = t.batch!.candidates.map((v) => v.id);
        if (
          new Set(review.decisions.map((v) => v.candidateId)).size !== expected.length ||
          review.decisions.length !== expected.length ||
          review.decisions.some((v) => !expected.includes(v.candidateId))
        )
          throw new Error('命名审核必须覆盖每个候选且不能引用未知编号');
        t.review = { hash: tagHash(t.batch), result: review };
        if (!review.decisions.some((v) => v.verdict === 'keep') && t.semanticRevisions < 1) {
          t.semanticRevisions++;
          t.history.push({ batch: structuredClone(t.batch!), review });
          t.phase = 'generating';
        } else t.phase = 'ready';
      }
      r.messages = [];
      r.error = undefined;
      save();
    } catch (e) {
      stopOnToolFailure(e);
      t.formatRepairs++;
      for (const call of result.calls)
        r.messages.push({
          role: 'tool',
          callId: call.id,
          content: JSON.stringify({ ok: false, error: (e as Error).message })
        });
      if (!result.calls.length) r.messages.push({ role: 'user', content: '请使用当前结构化工具提交。' });
      save();
      if (t.formatRepairs > 2) throw new Error('命名结构校验连续失败：' + (e as Error).message);
    }
    if (ticket)
      finishTool(store, ticket, JSON.stringify({ phase: t.phase, hash: tagHash(t.batch) }), () =>
        store.db.saveRun(r)
      );
  }
  setRunStatus(r, 'awaiting_review');
  r.responseText = '书名候选已审核，请在作品方案的独立命名中选择；选择不会自动推进阶段。';
  save();
}
