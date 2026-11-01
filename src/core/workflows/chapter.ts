import { ApplicationError } from '../../shared/errors';
import {
  NarrativeDecoder,
  decodeNarrativeResponse,
  narrativeStreamInstruction
} from '../../shared/narrative-events';
import { withTaskReasoning } from '../../shared/reasoning';
import { type ProjectState, type Run, type SecretProfile, type ToolDefinition } from '../../shared/types';
import { assertControllerRules, automaticRepairLimit, modelTaskEnvelope } from '../agent-control';
import { countInput } from '../context-budget';
import { contextChanged, contextPayload, fitContext } from '../context-compiler';
import {
  countWords,
  detailPath,
  hash,
  id,
  memoryPaths,
  prosePath,
  qualityPath,
  stageOutputs
} from '../domain';
import { bindExpressionRules, expressionFingerprint, expressionPack } from '../expression-rules';
import { assembleContext } from '../memory';
import { memoryCompletionHash } from '../memory-review';
import { type NamingRules } from '../naming';
import { saveNarrativeEvents } from '../narrative-curves';
import { attachEditorial, chapterEditorial } from '../prose-editorial-context';
import { RequestError } from '../provider';
import type { AgentRunner } from '../runner';
import { compatibleRunBase } from '../runtime-settings';
import { repairContext } from '../runtime/candidate-repair';
import { preloadOutputTargets } from '../runtime/context-preload';
import { callModel } from '../runtime/model-gateway';
import { sharedRuleBlock } from '../runtime/prompt-cache';
import { setRunStatus } from '../runtime/run-state';
import { sourceReuseInstructions } from '../runtime/source-reuse';
import { runTaskLoop } from '../runtime/task-loop';
import { systemPrompt } from '../skill';
import { fileHash, safePath } from '../storage';
import { recordUsage, requestGuard, syncUsage } from '../telemetry';
import { validateCandidate } from '../validation';
import { chapterCoverageInstruction, requiredCharacterCoverage } from '../chapter-memory';
import { alignChapterTitle, chapterNamingContext, chapterTitleIssues } from '../chapter-naming';
import { writeScopedScenes } from './scene-draft';
import { proseTask } from '../prose-task';

export type ChapterWorkflowHost = Pick<
  AgentRunner,
  | 'profiles'
  | 'skillRoot'
  | 'chapterRulesHash'
  | 'contextResident'
  | 'store'
  | 'enrichContext'
  | 'save'
  | 'telemetry'
  | 'caller'
  | 'cacheOptions'
  | 'activity'
  | 'emit'
  | 'toolsFor'
  | 'execute'
  | 'completedToolBatch'
  | 'redirectProseRepair'
  | 'check'
  | 'queueRepair'
  | 'auditMemory'
  | 'event'
>;

export async function driveChapterWorkflow(
  host: ChapterWorkflowHost,
  r: Run,
  p: ProjectState,
  fallback: SecretProfile,
  signal: AbortSignal,
  naming: NamingRules
) {
  const pipeline = r.pipeline!;
  const select = (role: 'writing' | 'extraction' | 'review') => {
    const key =
      p.config.modelRouting[role] ||
      (role === 'writing' ? r.profileId : p.config.modelRouting.writing || r.profileId);
    const profile = host.profiles().find((x) => x.id === key);
    if (!profile) throw new Error('所选分工模型已移除，请重新选择');
    if (!profile.apiKey || !profile.enabled) throw new Error('分工模型不可用');
    const binding = r.modelBindings?.[role];
    if (binding && (binding.id !== profile.id || binding.version !== profile.version))
      throw new Error('分工模型配置已改变，请重新建立任务');
    (r.modelBindings ??= {})[role] = { id: profile.id, version: profile.version };
    return withTaskReasoning(profile, r);
  };
  const expressionVersion = expressionFingerprint(host.skillRoot, p.config);
  const lock = host.chapterRulesHash(p, naming, r.chapterNaming?.version);
  if (r.skillHash && r.skillHash !== lock) throw new Error('任务规则或工具契约发生变化，请重新组装上下文');
  r.skillHash = lock;
  const writer = select('writing'),
    reviewer = select('review'),
    extractor = select('extraction');
  const { resident } = host.contextResident(r, p, naming);
  const reviewReferences = r.pipeline?.phase !== 'prose' ? r.manifest?.referenceSources : undefined;
  r.manifest = assembleContext(host.store, p, 'S10', r.request, writer, false, { resident, scope: r.taskScope?.memory });
  // Keep a completed review's evidence through memory extraction and approval;
  // only a new prose draft can replace that review and its source versions.
  r.manifest.referenceSources = [...new Map([...(r.manifest.referenceSources ?? []), ...(reviewReferences ?? [])].map(source => [source.path, source])).values()];
  await host.enrichContext(r, p, writer);
  fitContext(r.manifest, writer, resident, 0, true, p);
  const context = {
    ...modelTaskEnvelope(host.store, host.skillRoot, r, 'prose'),
    ...chapterNamingContext(r),
    task: '生成本章正文，审阅与记忆由对应子任务处理。',
    authorRequest: r.request,
    authorPremise: r.manifest.scope?.viewpoint === 'character' ? undefined : host.store.db.get('premise'),
    ...contextPayload(r.manifest, p, 'prose'),
    chapter: p.chapter,
    batch: r.batch
  };
  setRunStatus(r, 'running');
  host.save(r);
  const call = async (
    profile: SecretProfile,
    system: string,
    messages: Run['messages'],
    tools: ToolDefinition[],
    delta?: (text: string) => void,
    purpose: string = pipeline.phase
  ) => {
    if (signal.aborted) throw new RequestError('作者已停止执行', false);
    assertControllerRules(host.skillRoot, r.agentRulesHash!);
    if (r.rounds >= p.config.maxRounds)
      throw new ApplicationError('ROUND_LIMIT', '已达到本任务轮数上限。可审阅内容或在设置提高上限后继续。');
    if (expressionFingerprint(host.skillRoot, host.store.db.project().config) !== expressionVersion)
      throw new Error('表达规则已改变，请重新组装上下文');
    if (host.profiles().find((v) => v.id === profile.id)?.version !== profile.version)
      throw new Error('模型配置在运行期间改变');
    if (!compatibleRunBase(host.store, r) || contextChanged(host.store, r.manifest!))
      throw new Error('任务依据已改变');
    syncUsage(host.store, r);
    host.telemetry.foregroundReserved = requestGuard(
      profile,
      system,
      messages,
      tools,
      r,
      p.config.stageBudget,
      host.telemetry.reserved
    );
    r.rounds++;
    host.store.db.set(`inflight:${r.id}`, true);
    host.save(r);
    const result = await callModel(
      host.store,
      r,
      purpose,
      host.caller,
      profile,
      system,
      messages,
      tools,
      signal,
      delta,
      { ...host.cacheOptions(r, profile), onActivity: (phase) => host.activity(r, phase) }
    ).finally(() => {
      host.telemetry.foregroundReserved = 0;
    });
    host.store.db.set(`inflight:${r.id}`, false);
    recordUsage(host.store, r, result.usage, {
      phase: pipeline.phase,
      profileId: profile.id,
      profileVersion: profile.version,
      usage: result.usage
    });
    assertControllerRules(host.skillRoot, r.agentRulesHash!);
    if (signal.aborted) throw new RequestError('作者已停止执行', false);
    if (result.stop === 'length' || result.stop === 'filtered') throw new Error('输出未完成，候选已保留');
    return result;
  };
  if (pipeline.phase === 'prose') {
    if (p.config.preview.enabled && !(r.steps ?? []).some((s) => s.phase === 'assessment:plan'))
      await host.telemetry.final(
        r,
        host.store.readAccepted(detailPath(r.chapter)).content,
        reviewer,
        'plan',
        detailPath(r.chapter)
      );
    const file = prosePath(r.chapter);
    let draft = '',
      lastFlush = 0;
    const expression = expressionPack(host.skillRoot, p.config, 'prose');
    bindExpressionRules(r, expression.binding);
    const system = `${systemPrompt(host.skillRoot, p, 'S10', naming, undefined, { outputMode: 'prose', chapterNamingVersion: r.chapterNaming?.version })}\n正文候选由宿主保存，再安排独立校验。${expression.prompt}\n${narrativeStreamInstruction}`;
    let written = false;
    await runTaskLoop({
      executorId: r.executorId,
      signal,
      event: (event) => {
        if (event.type === 'turn_end')
          host.store.db.event(r.id, 'pi-turn', '正文候选已保存', { phase: 'prose', round: r.rounds });
      },
      next: async () => {
        if (written) return;
        const repair = r.repairAttempts?.prose ?? 0;
        draft = '';
        let decoded: ReturnType<typeof decodeNarrativeResponse> | undefined,
          activated = false;
        const activate = () => {
          if (activated) return;
          activated = true;
          pipeline.epoch = id();
          pipeline.version++;
          pipeline.narrative = { version: 1, epoch: pipeline.epoch, events: [] };
        };
        const emitNodes = () =>
          host.emit({
            type: 'narrative-event',
            resource: 'runs',
            runId: r.id,
            epoch: pipeline.epoch,
            draftVersion: pipeline.version,
            data: pipeline.narrative
          });
        const messages: Run['messages'] = [
          {
            role: 'user',
            content: JSON.stringify({
              ...context,
              ...proseTask(r)
            })
          }
        ];
        return {
          profile: writer,
          system,
          messages,
          tools: [],
          request: async (delta) => {
            const decoder = new NarrativeDecoder(
              (text) => {
                activate();
                delta(text);
                draft += text;
                pipeline.version++;
                const c = {
                  path: file,
                  content: draft,
                  baseHash: host.store.db.document(file)?.hash ?? null
                };
                r.changes = [...r.changes.filter((x) => x.path !== file), c];
                host.emit({
                  type: 'prose-delta',
                  resource: 'runs',
                  runId: r.id,
                  projectId: p.id,
                  snapshotId: r.baseSnapshotId,
                  epoch: pipeline.epoch,
                  draftVersion: pipeline.version,
                  text,
                  textOffset: draft.length - text.length
                });
                if (p.config.preview.enabled) host.telemetry.checkpoint(r, draft, reviewer);
                if (Date.now() - lastFlush > 800) {
                  host.store.db.saveRun(r);
                  lastFlush = Date.now();
                }
              },
              (event) => {
                pipeline.narrative!.events = [...pipeline.narrative!.events, event];
                emitNodes();
                host.store.db.saveRun(r);
              }
            );
            try {
              const result = p.config.proseMode === 'scene'
                ? await writeScopedScenes({ store: host.store, root: host.skillRoot, run: r, project: p, signal,
                    send: (purpose, rule, input) => call(writer, rule, [{ role: 'user', content: JSON.stringify(input) }], [], undefined, purpose),
                    onText: text => decoder.push(text) })
                : await call(writer, system, messages, [], (text) => decoder.push(text));
              decoded = decodeNarrativeResponse(result.text);
              return { ...result, text: decoded.text };
            } finally {
              decoder.finish();
            }
          },
          received: async (result) => {
            if (result.calls.length) throw new Error('正文子调用返回了工具内容，未作为正文保存');
            activate();
            draft = alignChapterTitle(r, { path: file, content: result.text, baseHash: null }).content;
            pipeline.version++;
            const events = (decoded?.events ?? []).flatMap(event => {
              const start = draft.indexOf(event.anchor), end = start + event.anchor.length;
              if (start < 0 || draft.indexOf(event.anchor, start + 1) >= 0) return [];
              return [{ ...event, id: `event:${start}:${end}:${event.kind}`, start, end }];
            });
            pipeline.narrative = { version: 1, epoch: pipeline.epoch, events };
            emitNodes();
            host.store.putObject(draft);
            r.changes = [
              ...r.changes.filter((x) => x.path !== file),
              { path: file, content: draft, baseHash: host.store.db.document(file)?.hash ?? null }
            ];
            r.issues = validateCandidate('S10', p, r.changes, host.skillRoot, 'revision').filter(
              (i) => i.path === file
            );
            r.issues.push(...chapterTitleIssues(host.store, r));
            host.save(r);
            return true;
          },
          execute: async () => {
            throw new Error('正文子调用不允许工具');
          },
          finish: async () => {
            if (!r.issues.some((i) => i.severity === 'error')) {
              written = true;
              return false;
            }
            host.save(r);
            if (repair >= automaticRepairLimit) {
              setRunStatus(r, 'needs_repair');
              host.save(r);
              return false;
            }
            (r.repairAttempts ??= {}).prose = repair + 1;
            host.save(r);
            return true;
          }
        };
      }
    });
    if (!written) return;
    pipeline.proseHash = hash(draft);
    r.chapterCoverage = undefined;
    try {
      saveNarrativeEvents(host.store, r, draft);
    } catch {
      /* Optional node indexing cannot block the manuscript. */
    }
    r.sourceProseHash = pipeline.proseHash;
    pipeline.phase = 'review';
    r.messages = [];
    host.save(r);
  }
  const prose = r.changes.find((c) => c.path === prosePath(r.chapter));
  if (!prose || hash(prose.content) !== pipeline.proseHash) throw new Error('候选正文与核对版本不一致');
  for (const phase of ['review', 'memory'] as const) {
    if (pipeline.phase !== phase) continue;
    const stage = phase === 'memory' ? 'S11' : 'S10',
      profile = phase === 'memory' ? extractor : reviewer;
    const skillId = phase === 'memory' ? 'webnovel-memory-extractor' : 'webnovel-chapter-reviewer';
    const expression = expressionPack(host.skillRoot, p.config, phase === 'memory' ? 'record' : 'review');
    bindExpressionRules(r, expression.binding);
    const system = `${systemPrompt(host.skillRoot, p, stage, naming, skillId, { outputMode: phase })}\n本阶段为 ${phase}。${phase === 'memory' ? '记忆与正文一起待作者确认。证据 hash 使用候选哈希；同步字段填待提交。' : `质量报告路径：${qualityPath(r.chapter)}。`}实际字数 ${countWords(prose.content)}；候选哈希 ${pipeline.proseHash}。${expression.prompt}${phase === 'memory' ? sharedRuleBlock('source-reuse', sourceReuseInstructions) : ''}`;
    if (!r.messages.length) {
      if (phase === 'memory') {
        // The Skill requires current ledgers before updating them. Supply each
        // exact full version once instead of forcing a model round to re-read
        // excerpts, and bind these sources to the same external-change guard.
        for (const file of memoryPaths) {
          const doc = host.store.readAccepted(file);
          if (fileHash(safePath(host.store.root, file)) !== doc.hash)
            throw new Error(`记忆资料有未确认的外部变化：${file}`);
          r.manifest!.sources = r.manifest!.sources.filter((source) => source.path !== file);
          r.manifest!.sources.push({
            path: file,
            hash: doc.hash,
            content: doc.content,
            ranges: [{ start: 0, end: Array.from(doc.content).length }],
            mode: 'full',
            required: true,
            reason: '章后提取必读的完整当前记忆，未变内容须保留',
            layer: 'summary',
            category: 'derived_summary',
            sourceSnapshotId: r.manifest!.snapshotId
          });
        }
        r.manifest!.estimatedTokens = countInput(profile, contextPayload(r.manifest!)).tokens;
        host.save(r);
      }
      preloadOutputTargets(host.store, r, p, r.manifest!);
      const input = {
        authorPremise: context.authorPremise, authorRequest: r.request,
        chapter: p.chapter, batch: r.batch,
        ...chapterNamingContext(r),
        ...modelTaskEnvelope(host.store, host.skillRoot, r, phase),
        ...contextPayload(r.manifest!, p, phase),
        task: phase === 'review' ? '独立审阅当前正文，只提交质量报告。' : '依据最终正文提取记忆，只提交必要资料变化与事实。',
        prose: { ...prose, hash: pipeline.proseHash },
        ...(phase === 'memory' && pipeline.coverageVersion === 1
          ? {
              coverageInstruction: chapterCoverageInstruction,
              knownCharactersToCheck: requiredCharacterCoverage(host.store, r)
            }
          : {}),
        existingCandidates: r.changes.filter(
          (c) => c.path !== prose.path && (phase !== 'memory' || c.path !== qualityPath(r.chapter))
        ),
        repairScope: repairContext(r),
        expectedOutputs: phase === 'memory' ? stageOutputs('S11', p) : [qualityPath(r.chapter)]
      };
      if (phase === 'review') {
        const report = chapterEditorial(host.store, p, r.manifest!, { ...prose, hash: pipeline.proseHash! });
        const attached = attachEditorial(input, report, (value) => {
          try {
            requestGuard(
              profile,
              system,
              [{ role: 'user', content: JSON.stringify(value) }],
              host.toolsFor(r),
              r,
              p.config.stageBudget,
              host.telemetry.reserved
            );
            return true;
          } catch (error) {
            if (
              error instanceof ApplicationError &&
              ['MODEL_CONFIGURATION', 'BUDGET_EXCEEDED', 'BUDGET_UNCONFIRMED'].includes(error.code)
            )
              return false;
            throw error;
          }
        });
        r.manifest!.referenceSources = attached.references;
        r.messages.push({ role: 'user', content: JSON.stringify(attached.input) });
        host.store.db.event(r.id, 'editorial-evidence', '本地正文线索已交给本次审稿判断', {
          ...report,
          included: attached.included,
          omitted: attached.omitted,
          modelRequests: 0
        });
      } else r.messages.push({ role: 'user', content: JSON.stringify(input) });
    }
    const lastAssistant = [...r.messages].reverse().find((m) => m.role === 'assistant');
    for (const tool of lastAssistant?.calls ?? [])
      if (!r.messages.some((m) => m.role === 'tool' && m.callId === tool.id))
        if (!(await host.execute(r, p, tool, signal, naming))) return;
    let completed = false;
    const locallySubmitted = () => {
      const last = r.messages.at(-1);
      const completedExtraction = phase === 'memory' && r.memoryCompletionHash === memoryCompletionHash(r);
      // Older saved runs may already contain the redundant final assistant
      // message. The bound extraction receipt still permits local validation;
      // queued user repairs and unacknowledged tool batches must reach the model.
      if (
        !host.completedToolBatch(r, ['propose_changes', 'propose_memory']) &&
        !(completedExtraction && last?.role === 'assistant' && !last.calls?.length)
      )
        return false;
      // Files alone never prove that extraction is complete. The explicit final
      // fact submission is bound to every file and fact, including an empty set.
      if (phase === 'memory' && !completedExtraction) return false;
      return true;
    };
    let redirected = false;
    await runTaskLoop({
      executorId: r.executorId,
      signal,
      event: (event) => {
        if (event.type === 'turn_end')
          host.store.db.event(r.id, 'pi-turn', '章节子阶段回执已保存', { phase, round: r.rounds });
      },
      next: async () => {
        if (host.redirectProseRepair(r, p)) {
          redirected = true;
          return;
        }
        if (locallySubmitted()) {
          host.check(r, p);
          const localIssues = r.issues.filter(
            (issue) =>
              issue.code !== 'pipeline_pending' &&
              (phase === 'memory' ? issue.code !== 'memory_review' : issue.path === qualityPath(r.chapter))
          );
          // A completed submission with a local error needs precise repair
          // feedback, never an otherwise empty "finish" request or a stale audit.
          const repair = host.queueRepair(r, p, localIssues, phase);
          if (!repair && localIssues.some((issue) => issue.severity === 'error')) {
            setRunStatus(r, 'needs_repair');
            host.save(r);
            return;
          }
          if (!repair) {
            if (phase === 'memory') await host.auditMemory(r, p, reviewer, signal);
            host.check(r, p);
            const issues = r.issues.filter(
              (issue) =>
                issue.code !== 'pipeline_pending' &&
                (phase === 'memory' || issue.path === qualityPath(r.chapter))
            );
            const auditRepair = host.queueRepair(r, p, issues, phase);
            if (!auditRepair && issues.some((issue) => issue.severity === 'error')) {
              setRunStatus(r, 'needs_repair');
              host.save(r);
              return;
            }
            if (!auditRepair) {
              host.event(
                r,
                'local-phase-complete',
                `${phase === 'memory' ? '记忆提取及独立证据审核' : '独立正文审稿'}已完成，省去模型结束说明轮`
              );
              completed = true;
              return;
            }
          }
        }
        return {
          profile,
          system,
          messages: r.messages,
          tools: host.toolsFor(r),
          request: (delta) => call(profile, system, r.messages, host.toolsFor(r), delta),
          received: async (result) => {
            r.messages.push({
              role: 'assistant',
              content: result.text,
              calls: result.calls,
              native: result.native
            });
            host.save(r);
            return true;
          },
          execute: async (tool) => ({
            proceed: await host.execute(r, p, tool, signal, naming),
            content:
              r.messages.findLast((message) => message.role === 'tool' && message.callId === tool.id)
                ?.content ?? ''
          }),
          finish: async (result) => {
            if (!result.calls.length) {
              if (phase === 'memory') await host.auditMemory(r, p, reviewer, signal);
              host.check(r, p);
              if (host.redirectProseRepair(r, p)) {
                redirected = true;
                return false;
              }
              const issues = r.issues.filter(
                (issue) =>
                  issue.code !== 'pipeline_pending' &&
                  (phase === 'memory' || issue.path === qualityPath(r.chapter))
              );
              if (host.queueRepair(r, p, issues, phase)) return true;
              if (issues.some((issue) => issue.severity === 'error')) {
                setRunStatus(r, 'needs_repair');
                host.save(r);
                return false;
              }
              completed = true;
              return false;
            }
            host.save(r);
            return true;
          }
        };
      }
    });
    if (redirected) {
      if (r.pipeline!.phase === 'prose') await driveChapterWorkflow(host, r, p, fallback, signal, naming);
      return;
    }
    if (r.status !== 'running') return;
    if (!completed) throw new Error('本阶段达到调用上限，候选已保留');
    if (phase === 'review') {
      if (p.config.preview.enabled) await host.telemetry.final(r, prose.content, reviewer);
      pipeline.phase = 'memory';
      r.messages = [];
    } else {
      pipeline.phase = 'ready';
    }
    host.save(r);
  }
  host.check(r, p);
  setRunStatus(r, r.issues.some((i) => i.severity === 'error') ? 'needs_repair' : 'awaiting_review');
  host.save(r);
}
