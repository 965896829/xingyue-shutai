import { setRunStatus } from './runtime/run-state';
import { callModel } from './runtime/model-gateway';
import { beginTool, finishTool, stopOnToolFailure, type ToolTicket } from './runtime/tool-gateway';
import { z } from 'zod';
import {
  planningReportSchema,
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
import { checkPlanningReportLanguage, checkPlanningContractLanguage, checkPlanningReviewLanguage } from './planning-language';
import { approvedCreation, creationPlanSchema } from '../shared/creation';
import { creationPromptResources, planningHistoryDigest, planningRegenerationScope, planningSystemPrompt } from './creation-prompts';

export function planningRulesHash(root: string, p: ProjectState) {
  return tagHash({ skill: new SkillRegistry(root).load('webnovel-premise-lab').hash, prompts: creationPromptResources(root).hash, expression: expressionFingerprint(root, p.config), language: planningLanguageRules, version: 4 });
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
}) {
  const { store, root, run: r, project: p, writer, profiles, caller, signal, save, event } = args;
  const t = r.planning!;
  const rules = controllerRules(root);
  const promptResources = creationPromptResources(root);
  const skillHash = planningRulesHash(root, p);
  if (r.skillHash && r.skillHash !== skillHash) throw new Error('策划规则已更新，请继续任务以重新加载');
  r.skillHash = skillHash;
  planningBinding(store, r);
  r.manifest = assembleContext(store, p, r.stage, r.request, writer, r.mode === 'revision');
  const reviewer = profiles().find((v) => v.id === (p.config.modelRouting.review || writer.id));
  if (!reviewer?.apiKey || !reviewer.enabled || !reviewer.tools) throw new Error('请配置可用的策划审核模型');
  for (const [role, profile] of [
    ['tag_writer', writer],
    ['tag_reviewer', reviewer]
  ] as const) {
    const prior = r.modelBindings?.[role];
    if (prior && (prior.id !== profile.id || prior.version !== profile.version))
      throw new Error('策划分工模型已改变，请交接任务');
    (r.modelBindings ??= {})[role] = { id: profile.id, version: profile.version };
  }
  while (!['awaiting_direction', 'ready'].includes(t.phase)) {
    assertControllerRules(root, rules.hash);
    if (planningRulesHash(root, store.db.project()) !== skillHash) throw new Error('策划规则已更新，请继续任务以重新加载');
    planningBinding(store, r);
    if (signal.aborted) throw new RequestError('作者已停止策划', false);
    if (r.rounds >= p.config.maxRounds || r.toolCount >= p.config.maxTools)
      throw new Error('策划、审核和修订共用的任务预算已用完，候选已保留');
    if (r.manifest.sources.some((s) => fileHash(safePath(store.root, s.path)) !== s.hash))
      throw new Error('策划依赖资料已在外部改变');
    const reviewing = t.phase.startsWith('reviewing'),
      profile = reviewing ? reviewer : writer;
    if (profiles().find((v) => v.id === profile.id)?.version !== profile.version)
      throw new Error('模型配置已改变');
    const schema = reviewing
      ? planningReviewSchema
      : t.phase === 'planning'
        ? planningReportSchema
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
            input: t.spec,
            knowledge: t.knowledge,
            task: r.request,
            approved: approvedCreation(p),
            context: r.manifest.sources,
            currentPremise: store.readAccepted(paths.seed).content,
            report: t.report,
            selectedDirectionId: t.selectedDirectionId,
            resolutions: t.resolutions,
            candidate: t.candidate,
            reviewFeedback: reviewing
              ? undefined
              : t.phase === 'planning'
                ? t.reportReview
                : t.contractReview,
            regenerate: t.regenerate,
            regenerationScope: planningRegenerationScope(t),
            history: planningHistoryDigest(r, store.db.runs())
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
    const result = await callModel(store, r, 'tags:' + t.phase, caller, profile, system, r.messages, tools, signal, () => {});
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
    let ticket: ToolTicket | undefined;
    try {
      if (result.calls.length !== 1 || result.calls[0].name !== name)
        throw new Error('必须仅调用当前提交工具一次');
      if (r.toolCount > p.config.maxTools) throw new Error('已达到工具调用总上限');
      ticket = beginTool(store, r.id, result.calls[0], tools, signal);
      if (ticket.status === 'complete') throw new Error('当前策划步骤已经完成，请恢复已保存状态');
      const value = JSON.parse(result.calls[0].arguments);
      if (t.phase === 'planning') {
        const report = validateReport(value, t);
        checkPlanningReportLanguage(report, t);
        t.report = report;
        t.reportHash = tagHash(t.report);
        t.phase = 'reviewing_report';
      } else if (t.phase === 'contract') {
        const c = validateContract(value, t);
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
      } else {
        const reportPhase = t.phase === 'reviewing_report',
          review = validatePlanningReview(value, reportPhase ? t.report : t.candidate);
        checkPlanningReviewLanguage(review, t);
        const receipt = {
          hash: tagHash(reportPhase ? t.report : t.candidate),
          binding: t.binding,
          result: review
        };
        if (reportPhase) t.reportReview = receipt;
        else t.contractReview = receipt;
        if (review.issues.some((i) => i.severity !== 'minor')) {
          if (t.semanticRevisions >= 1) {
            setRunStatus(r, 'needs_repair');
            r.error = '独立审核仍有重要问题，候选已保留；请调整输入后重新策划';
            r.messages = [];
            save();
            return;
          }
          t.semanticRevisions++;
          t.history.push({
            kind: reportPhase ? 'report' : 'contract',
            value: reportPhase ? t.report : t.candidate
          });
          t.phase = reportPhase ? 'planning' : 'contract';
        } else t.phase = reportPhase ? 'awaiting_direction' : 'ready';
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
      if (!result.calls.length) r.messages.push({ role: 'user', content: '请使用提供的结构化提交工具。' });
      save();
      if (t.formatRepairs > 2) throw new Error('结构化输出校验连续失败：' + (e as Error).message);
    }
    if (ticket) finishTool(store, ticket, JSON.stringify({ phase: t.phase, fingerprint: planningFingerprint(r) }), () => store.db.saveRun(r));
  }
  if (t.phase === 'awaiting_direction') {
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
    configured.config.genre = t.knowledge.options.find((o) => o.group === 'reading.main')?.label ?? configured.config.genre;
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
      ? '设定拆解已准备好。审阅结果后，点击“确认并继续”即可保存并开始项目与文风阶段。'
      : '调整后的创作约定已准备好。确认后保存，作品保持当前阶段。';
  }
  save();
}
