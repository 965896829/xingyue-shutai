import { runTaskLoop } from './runtime/task-loop';
import type { ModelResult } from '../shared/types';
import { setRunStatus } from './runtime/run-state';
import { callModel } from './runtime/model-gateway';
import { withTaskReasoning } from '../shared/reasoning';
import { beginTool, finishTool, stopOnToolFailure, type ToolTicket } from './runtime/tool-gateway';
import { z } from 'zod';
import {
  legacyPlanningReportSchema,
  concisePlanningReportSchema,
  modularPlanningReportSchema,
  contractCandidateSchema,
  planningReviewSchema,
  planningPhaseNames
} from '../shared/tags';
import type { Run, ProjectState, SecretProfile, ToolDefinition } from '../shared/types';
import {
  planningBinding,
  planningFingerprint,
  validateReport,
  validateContract,
  validatePlanningReview,
  tagHash,
  contractPath,
  renderContract
} from './tags';
import { creationGenre, modelBookSpec } from './tags';
import { bookProfilePath, renderBookProfile } from './publishing';
import { fileHash, safePath, type FileStore } from './storage';
import { paths, updateConfigDocument } from './domain';
import { assembleContext } from './memory';
import { templates } from './skill';
import { requestGuard, recordUsage, syncUsage } from './telemetry';
import { expressionPack, bindExpressionRules, expressionFingerprint } from './expression-rules';
import { controllerRules, assertControllerRules, taskEnvelope } from './agent-control';
import { SkillRegistry } from './skill-registry';
import { RequestError } from './provider';
import type { Caller } from './runner';
import { validateCandidate } from './validation';
import { planningLanguageRules } from '../shared/planning-language';
import { checkPlanningReportLanguage, checkPlanningContractLanguage, checkPlanningReviewLanguage, normalizePlanningLanguage } from './planning-language';
import { approvedCreation, creationPlanSchema } from '../shared/creation';
import { creationPromptResources, directionPromptResources, planningHistoryDigest, planningRegenerationScope, planningReportContext, planningSystemPrompt } from './creation-prompts';
import { ApplicationError } from '../shared/errors';
import { classifyFailure } from './failures';
import { setFailure } from '../shared/recovery';
import { assertStructuredRepair, planningRepairPointers } from './runtime/candidate-repair';
import { normalizeCandidate } from './output-normalization';
import { templateFields } from './validation';

export function planningRulesHash(root: string, p: ProjectState, task?: Run['planning']) {
  return tagHash({ skill: new SkillRegistry(root).load('webnovel-premise-lab').hash, prompts: creationPromptResources(root).hash, expression: expressionFingerprint(root, p.config), language: planningLanguageRules, version: 4,
    ...(task?.directionFormatVersion ? { directionFormatVersion: task.directionFormatVersion, directions: directionPromptResources(root).hash } : {}) });
}

export function hasSavedDirectionCheckpoint(run: Run) {
  const t = run.planning;
  return !!t?.report && (['reviewing_report', 'awaiting_direction'].includes(t.phase) || t.phase === 'planning' && t.repair?.phase === 'planning');
}

/** Uses the existing provider and usage ledger. No second model runtime or commit path. */
export async function driveTagPlanning(args: {
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
}) {
  const { store, root, run: r, project: p, writer, profiles, caller, signal, save, event } = args;
  const t = r.planning!;
  const rules = controllerRules(root);
  const promptResources = creationPromptResources(root);
  const skillHash = planningRulesHash(root, p, t);
  if (r.skillHash && r.skillHash !== skillHash) throw new Error('策划规则已更新，请继续任务以重新加载');
  r.skillHash = skillHash;
  planningBinding(store, r);
  if (r.status !== 'running') { setRunStatus(r, 'running'); save(); }
  r.manifest = assembleContext(store, p, r.stage, r.request, writer, r.mode === 'revision');
  // A rule-upgrade checkpoint may name the old review phase before any report
  // was produced. Start its missing generation, never submit a contract instead.
  if (t.phase === 'reviewing_report' && !t.report) {
    t.phase = 'planning';
    t.reportReview = undefined;
    t.repair = undefined;
    r.messages = [];
  }
  // Older checkpoints may be parked in the retired direction-review loop.
  // Reuse the complete candidate after local validation; never invent a review
  // receipt or spend another request reviewing/repairing exploratory directions.
  if (hasSavedDirectionCheckpoint(r)) {
    if (signal.aborted) throw new RequestError('作者已停止策划', false);
    const report = validateReport(t.report, t);
    checkPlanningReportLanguage(report, t);
    t.report = report;
    t.reportHash = tagHash(report);
    t.phase = 'awaiting_direction';
    t.repair = undefined;
    r.messages = [];
    r.error = undefined;
    event('三个方向已准备好');
    save();
  }
  await runTaskLoop({ executorId: r.executorId, signal,
    event: e => { if (e.type === 'turn_end') store.db.event(r.id, 'pi-turn', '当前子阶段回执已保存', { phase: t.phase, round: r.rounds }); },
    next: async () => {
    if (['awaiting_direction', 'ready'].includes(t.phase)) return;
    assertControllerRules(root, rules.hash);
    if (planningRulesHash(root, store.db.project(), t) !== skillHash) throw new Error('策划规则已更新，请继续任务以重新加载');
    planningBinding(store, r);
    if (signal.aborted) throw new RequestError('作者已停止策划', false);
    if (r.rounds >= p.config.maxRounds || r.toolCount >= p.config.maxTools)
      throw new ApplicationError(r.rounds >= p.config.maxRounds ? 'ROUND_LIMIT' : 'TOOL_LIMIT', '策划、审核和修订共用的任务预算已用完，候选已保留');
    if (r.manifest!.sources.some((s) => fileHash(safePath(store.root, s.path)) !== s.hash))
      throw new Error('策划依赖资料已在外部改变');
    const reviewing = t.phase === 'reviewing_contract';
    const selectedProfile = reviewing
      ? profiles().find(v => v.id === (p.config.modelRouting.review || writer.id))
      : writer;
    if (!selectedProfile?.apiKey || !selectedProfile.enabled || !selectedProfile.tools)
      throw new Error(reviewing ? '请配置可用的策划审核模型' : '请配置可用的策划生成模型');
    const role = reviewing ? 'tag_reviewer' : 'tag_writer';
    const prior = r.modelBindings?.[role];
    if (prior && (prior.id !== selectedProfile.id || prior.version !== selectedProfile.version))
      throw new Error('策划分工模型已改变，请交接任务');
    (r.modelBindings ??= {})[role] = { id: selectedProfile.id, version: selectedProfile.version };
    const profile = withTaskReasoning(selectedProfile, r);
    if (profiles().find((v) => v.id === profile.id)?.version !== profile.version)
      throw new Error('模型配置已改变');
    const schema = reviewing
      ? planningReviewSchema
      : t.phase === 'planning'
        ? t.directionFormatVersion === 2 ? modularPlanningReportSchema : t.directionFormatVersion === 1 ? concisePlanningReportSchema : legacyPlanningReportSchema
        : t.workflowVersion === 2 ? contractCandidateSchema.extend({ plan: creationPlanSchema }) : contractCandidateSchema;
    const name = reviewing
      ? 'submit_planning_review'
      : t.phase === 'planning'
        ? 'submit_planning_report'
        : 'submit_creation_contract';
    const tools: ToolDefinition[] = [
      {
        name,
        description: '提交当前子阶段的结构化候选；不会批准或写入正式设定。',
        parameters: z.toJSONSchema(schema) as Record<string, unknown>
      }
    ];
    const expression = expressionPack(root, p.config, reviewing ? 'review' : 'planning');
    bindExpressionRules(r, expression.binding);
    const system = planningSystemPrompt({
      controller: rules.content,
      resources: promptResources,
      ...(t.directionFormatVersion ? { directionResources: directionPromptResources(root) } : {}),
      planning: t,
      submitTool: name,
      expression: expression.prompt,
      premiseTemplate: t.phase === 'contract' && t.origin === 'new' ? templates(root)['设定拆解'] : undefined
    });
    const promptHash = tagHash({ system, tools });
    if (t.promptHashes[t.phase] && t.promptHashes[t.phase] !== promptHash)
      throw new Error('策划规则已改变，请基于新规则重新建立任务');
    t.promptHashes[t.phase] = promptHash;
    if (!r.messages.length)
      r.messages = [
        {
          role: 'user',
          content: JSON.stringify({
            ...taskEnvelope(store, root, r, 'planning'),
            input: modelBookSpec(t.spec),
            knowledge: t.knowledge,
            task: r.request,
            approved: approvedCreation(p) ? { ...approvedCreation(p)!, spec: modelBookSpec(approvedCreation(p)!.spec) } : undefined,
            context: r.manifest!.sources,
            currentPremise: store.readAccepted(paths.seed).content,
            // The reroll already carries its original report. Do not send it twice.
            report: !!t.directionFormatVersion && t.phase === 'planning' && t.regenerate ? undefined : planningReportContext(t),
            selectedDirectionId: t.selectedDirectionId,
            resolutions: t.resolutions,
            candidate: t.candidate,
            authorRevision: t.authorRevision,
            reviewFeedback: !reviewing && t.phase === 'contract' ? t.contractReview : undefined,
            regenerate: t.phase === 'planning' ? t.regenerate : undefined,
            repairScope: !reviewing && t.repair ? { allowedPointers: t.repair.pointers, instruction: '原候选即本轮的report或candidate。仅修改允许的位置，同步同一事实在约束、计划与设定文稿中的表述；其他内容逐项原样保留。提交完整结构，不重新生成未涉及的方向或方案条目。' } : undefined,
            regenerationScope: t.phase === 'planning' ? planningRegenerationScope(t) : undefined,
            history: t.phase === 'planning' ? planningHistoryDigest(r, store.db.runs()) : undefined
          })
        }
      ];
    syncUsage(store, r);
    requestGuard(profile, system, r.messages, tools, r, p.config.stageBudget);
    r.rounds++;
    setRunStatus(r, 'running');
    event(planningPhaseNames[t.phase]);
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
        throw new Error('必须仅调用当前提交工具一次');
      if (r.toolCount > p.config.maxTools) throw new ApplicationError('TOOL_LIMIT', '已达到工具调用总上限');
      const value = JSON.parse(result.calls[0].arguments);
      let submittedCall = result.calls[0];
      if (t.phase === 'planning' && t.directionFormatVersion) {
        // Some providers still emit the known legacy bookkeeping. Preserve it in
        // the stored report, validate core content, and adapt only the tool wire
        // shape locally. The original model response remains in the request log.
        const { diagnosis, marketClaims, unresolvedQuestions, ...report } = validateReport(value, t);
        const submission = { ...report, directions: report.directions.map(({ tagCoverage, ...direction }) => direction) };
        submittedCall = { ...submittedCall, arguments: JSON.stringify(submission) };
      }
      ticket = beginTool(store, r.id, submittedCall, tools, signal);
      if (ticket.status === 'complete') throw new Error('当前策划步骤已经完成，请恢复已保存状态');
      if (t.phase === 'contract' && t.origin === 'new' && typeof value.premiseDocument === 'string') {
        const normalized = normalizeCandidate({ path: paths.seed, content: value.premiseDocument, baseHash: null }, Object.values(templateFields(root)).flat());
        value.premiseDocument = normalized.change.content;
        if (normalized.edits.length) store.db.event(r.id, 'format-normalized', '已规范设定拆解字段格式', { fields: normalized.edits });
      }
      if (!reviewing && t.repair?.phase === t.phase) assertStructuredRepair(t.repair.original, value, t.repair.pointers);
      if (t.phase === 'planning') {
        const report = validateReport(value, t);
        if (normalizePlanningLanguage(report, t)) store.db.event(r.id, 'format-normalized', '已将已知内部引用转换为中文说明，未追加模型请求');
        checkPlanningReportLanguage(report, t);
        t.report = report;
        t.reportHash = tagHash(t.report);
        t.reportReview = undefined;
        t.repair = undefined;
        t.phase = 'awaiting_direction';
      } else if (t.phase === 'contract') {
        const c = validateContract(value, t);
        if (normalizePlanningLanguage(c, t)) store.db.event(r.id, 'format-normalized', '已规范方案中的内部引用，创作约束与条目编号保持原样');
        checkPlanningContractLanguage(c, t);
        if (t.origin === 'new') {
          const errors = validateCandidate(
            'S01',
            p,
            [
              {
                path: paths.seed,
                content: c.premiseDocument,
                baseHash: store.db.document(paths.seed)?.hash ?? null
              }
            ],
            root
          ).filter((i) => i.severity === 'error');
          if (errors.length) throw new Error(errors.map((i) => i.message).join('；'));
        } else if (c.premiseDocument !== store.readAccepted(paths.seed).content)
          throw new Error('旧书接入不能改写已接受设定');
        t.candidate = c;
        t.phase = 'reviewing_contract';
        const boundReviewer = r.modelBindings?.tag_reviewer;
        const currentReviewer = profiles().find(v => v.id === (p.config.modelRouting.review || writer.id));
        if (t.repair?.phase === 'contract' && t.contractReview?.hash === tagHash(c) &&
            t.contractReview.binding === t.binding && currentReviewer?.enabled && currentReviewer.tools &&
            boundReviewer?.id === currentReviewer.id && boundReviewer.version === currentReviewer.version &&
            t.contractReview.result.issues.some(issue => issue.severity !== 'minor')) {
          // No-op automatic rewrites cannot erase the existing independent
          // finding, and sending the identical candidate again cannot fix it.
          setRunStatus(r, 'needs_repair');
          setFailure(r, classifyFailure(new ApplicationError('REPAIR_EXHAUSTED', '本轮修改未改变方案，原问题仍然保留。可针对具体问题补充修改意见。')));
          event('方案未发生变化，保留原检查结果，跳过重复检查');
          r.messages = [];
          if (ticket) finishTool(store, ticket, JSON.stringify({ phase: t.phase, review: t.contractReview }), () => store.db.saveRun(r));
          save();
          return;
        }
      } else {
        const review = validatePlanningReview(value, t.candidate, 'candidate');
        if (normalizePlanningLanguage(review, t)) store.db.event(r.id, 'format-normalized', '已规范检查说明，原问题级别、定位和判断保持原样');
        checkPlanningReviewLanguage(review, t);
        const receipt = {
          hash: tagHash(t.candidate),
          binding: t.binding,
          result: review
        };
        t.contractReview = receipt;
        if (review.issues.some((i) => i.severity !== 'minor')) {
          if (t.semanticRevisions >= 1) {
            setRunStatus(r, 'needs_repair');
            setFailure(r, classifyFailure(new ApplicationError('REPAIR_EXHAUSTED', '本轮局部修复后仍有待核对事项。候选已保留，可查看具体问题后恢复修复，或调整想法。')));
            r.messages = [];
            if (ticket) finishTool(store, ticket, JSON.stringify({ phase: t.phase, review: receipt }), () => store.db.saveRun(r));
            save();
            return;
          }
          t.semanticRevisions++;
          t.history.push({
            kind: 'contract',
            value: t.candidate
          });
          t.repair = { phase: 'contract', original: structuredClone(t.candidate!), pointers: planningRepairPointers(t, false) };
          store.db.event(r.id, 'local-repair-scope', '只修复独立审核标出的内容', { pointers: t.repair.pointers });
          t.phase = 'contract';
        } else { t.phase = 'ready'; t.repair = undefined; }
      }
      t.consecutiveFormatFailures = 0;
      r.messages = [];
      r.error = undefined;
      save();
    } catch (e) {
      stopOnToolFailure(e);
      toolError = (e as Error).message;
      store.db.event(r.id, 'format-repair', '方案提交未通过本地检查', { phase: t.phase, error: toolError });
      t.formatRepairs++;
      t.consecutiveFormatFailures = (t.consecutiveFormatFailures ?? 0) + 1;
      for (const call of result.calls)
        r.messages.push({
          role: 'tool',
          callId: call.id,
          content: JSON.stringify({ ok: false, error: (e as Error).message })
        });
      if (!result.calls.length) r.messages.push({ role: 'user', content: '请使用提供的结构化提交工具。' });
      save();
      if (ticket) {
        finishTool(store, ticket, JSON.stringify({ ok: false, error: toolError }), () => store.db.saveRun(r));
        ticket = undefined;
      }
      if (t.consecutiveFormatFailures > 2) throw new ApplicationError('FORMAT_INVALID', '结构化输出校验连续失败：' + (e as Error).message);
    }
    if (ticket) finishTool(store, ticket, JSON.stringify(toolError ? { ok: false, error: toolError } : { phase: t.phase, fingerprint: planningFingerprint(r) }), () => store.db.saveRun(r));
    };
    return { profile, system, messages: r.messages, tools,
      request: delta => callModel(store, r, 'tags:' + t.phase, caller, profile, system, r.messages, tools, signal, delta, { onActivity: args.onActivity }),
      received: async result => {
    recordUsage(store, r, result.usage, {
      phase: 'tags:' + t.phase,
      profileId: profile.id,
      profileVersion: profile.version,
      usage: result.usage
    });
    store.db.set(`inflight:${r.id}`, false);
    assertControllerRules(root, rules.hash);
    if (signal.aborted) {
      save();
      throw new RequestError('请求返回时策划已停止，未采纳返回内容', false);
    }
    planningBinding(store, r);
    if (result.stop === 'length' || result.stop === 'filtered')
      throw new Error('策划输出未完成，已有候选已保留');
    r.messages.push({ role: 'assistant', content: result.text, calls: result.calls, native: result.native });
    r.toolCount += result.calls.length;

        response = result; save(); return true;
      },
      execute: async () => { await submit(); return { proceed: r.status === 'running', content: JSON.stringify({ phase: t.phase }) }; },
      finish: async () => { await submit(); return r.status === 'running' && !(['awaiting_direction', 'ready'].includes(t.phase)); }
    };
  } });
  if (!(['awaiting_direction', 'ready'].includes(t.phase))) return;
  if (t.phase === 'awaiting_direction') {
    // Recovery may have checked S01's final contract before a direction was
    // selected. Those pending-output findings do not belong to valid directions;
    // selection and eventual acceptance revalidate their own stage and binding.
    r.issues = [];
    setRunStatus(r, 'awaiting_input');
    r.responseText = '方向方案已准备好。可直接确认推荐方向，或选择其他方向；只有需要调整的设定才填写修改意见。';
  } else {
    r.changes = [
      {
        path: contractPath,
        content: renderContract(t.spec, t.candidate!),
        baseHash: store.db.document(contractPath)?.hash ?? null
      }
    ];
    const configured = structuredClone(p);
    configured.config.genre = creationGenre(t.spec, t.knowledge, configured.config.genre);
    if (t.spec.bookProfile) r.changes.push({ path: bookProfilePath,
      content: renderBookProfile(t.spec.bookProfile, t.spec.publishingCatalog ?? null), baseHash: store.db.document(bookProfilePath)?.hash ?? null });
    r.changes.push({
      path: paths.config,
      content: updateConfigDocument(store.readAccepted(paths.config).content, configured),
      baseHash: store.db.document(paths.config)?.hash ?? null
    });
    if (t.origin === 'new')
      r.changes.push({
        path: paths.seed,
        content: t.candidate!.premiseDocument,
        baseHash: store.db.document(paths.seed)?.hash ?? null
      });
    setRunStatus(r, 'awaiting_review');
    r.responseText = t.origin === 'new'
      ? '作品方案已准备好。满意就继续选择书名；不满意，直接填写修改意见。'
      : '调整后的作品方案已准备好。满意即可保存，不满意可以继续修改。';
  }
  save();
}
