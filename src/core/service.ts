import { compileContext, contextChanged } from './context-compiler';
import { needsNewChapterCandidate } from '../shared/task-revision';
import { readNarrativeData } from './narrative-curves';
import { candidateChangesForCurrentSettings, compatibleRunBase, compatibleSettingsSnapshot } from './runtime-settings';
import { planningRulesHash, hasSavedDirectionCheckpoint } from './tag-planning';
import { captureReasoning } from '../shared/reasoning';
import { ProseIndexer } from './prose-index';
import { setRunStatus } from './runtime/run-state';
import fs from 'node:fs';
import { assertControllerRules } from './agent-control';
import {
  tagBundle,
  makeBookSpec,
  makeCreationSpec,
  compileTags,
  planningBinding,
  planningFingerprint,
  tagHash,
  validateReport,
  contractPath,
  approveTags,
  tagImpact,
  renderContract,
  validateApprovedTags,
  selectedIds,
  planCandidateHash,
  assertPlanApproval
} from './tags';
import { approvedCreation, type TitleSelection } from '../shared/creation';
import { upgradesVolumeNaming } from './volume-market-research';
import { titleSource, namingBinding, namingRulesHash, validateBookTitle, assertTitleSelection, titlePath, renderTitle } from './title-naming';
import { loadTitleStyleProfile } from './title-style';
import { tagInputSchema, type BookSpec } from '../shared/tags';
import { brand } from '../shared/brand';
import { CreationTimings } from './creation-timing';
import { buildVersion } from '../shared/build';
import { assertProjectVersion } from './compatibility';
import { commandContracts, isCommand, parseInput, parseOutput, type CommandOutput } from '../shared/contracts';
import { ApplicationError } from '../shared/errors';
import { newProjectLocationError } from '../shared/project-location';
import { Operations } from './runtime/operations';
import { recoverAttempts } from './runtime/model-gateway';
import { ProjectCommitService } from './runtime/commit-kernel';
import { ResourceScheduler } from './runtime/scheduler';
import { callExternal, callModel, estimatedUnits } from './runtime/model-gateway';
import { garbageCollectionPreview, verifyObjects } from './integrity';
import { ProjectWatcher } from './project-watcher';
import { chooseExecutor } from './runtime/executor';
import { ExecutorRouter } from './runtime/executor-router';
import { piExecutorVersion } from './runtime/task-loop';
import { ExecutionRecords } from './runtime/execution-records';
import path from 'node:path';
import { z } from 'zod';
import {
  configSchema,
  type AppEvent,
  type Command,
  type Run,
  type SecretProfile,
  type Snapshot,
  type Change,
  type ProjectState
} from '../shared/types';
import { FileStore, safePath, fileHash, proposalHash } from './storage';
import { retrieveMemory, traceSource, characterState, syncEntities } from './memory-studio';
import { readManuscriptView } from './manuscript-view';
import {
  memoryScopeSchema,
  embeddingSettingsSchema,
  type Assessment,
  type DraftIdentity,
  type StudioState
} from '../shared/studio';
import { SemanticIndex, CompatibleEmbeddings } from './embeddings';
import { SkillRegistry, stageSkills } from './skill-registry';
import { expressionLibrary, validateExpressionSelection } from './expression-rules';
import { recoverUsage } from './telemetry';
import {
  id,
  now,
  hash,
  newProject,
  activeBatch,
  advance,
  stageNames,
  paths,
  renderProgress,
  parseConfig,
  updateConfigDocument,
  reconfigure,
  prosePath,
  detailPath,
  archivePath
} from './domain';
import { initialFiles, renderIndex } from './skill';
import { materializeAftermathStatus, batchSummaryProgress } from './aftermath-status';
import { confirmedAlignedPlans } from './future-plan-review';
import { AgentRunner, type Caller } from './runner';
import {
  rebuildMemory,
  searchMemory,
  decodeFacts,
  encodeFacts,
  primaryPath,
  validateEvidence
} from './memory';
import { createBackup, restoreBackup, importDocument, exportDocument } from './documents';
import { checkPublication } from './manuscript-check';
import { invokeModel } from './provider';
import { retryNeedsConfirmation, documentPreviewText } from '../shared/run-presentation';
import { recoveryDecision } from '../shared/recovery';
import { prepareRunRecovery, prepareAuthorRevision } from './runtime/run-recovery';
import { taskRunHash } from './task-discussion';
import { prepareMemoryRepair, memoryRepairScope } from './memory-repair';
import { sameStoryText } from './memory-source';
import { changedStoryStates, futurePlanTargets, makeStoryImpact, nextUnwrittenChapter, resolveStoryImpacts } from './story-impact';
import { generateCover, saveCover } from './cover';
import { importLegacy, previewLegacy } from './migration';
import { ProjectRecycleBin, isRecyclePath, samePath } from './recycle-bin';
import { ConversationRunner, type AssistantRuntime } from './conversation-runner';
import { builtInRoles } from './assistant-settings';
import { searchSettingsSchema } from '../shared/assistant';
import { PublicSearch } from './search';
import { nativeServerLimit, usesNativeSearch } from '../shared/web-search';
import { nativeSearchSources } from './native-web-search';
const str = (v: unknown) => z.string().min(1).parse(v);
function finishImpactReview(p: ProjectState) {
  if (p.stale.length) return;
  for (const [chapter, state] of Object.entries(p.chapterStatesBeforeReview ?? {})) {
    if (p.chapters[chapter] === 'stale') p.chapters[chapter] = state;
  }
  delete p.chapterStatesBeforeReview;
}
export class Service {
  projectSessionId = id();
  private draining = false;
  private jobs = new Set<Promise<unknown>>();
  private requests = new Set<Promise<unknown>>();
  readonly operations = new Operations();
  readonly scheduler = new ResourceScheduler();
  requestJournal: FileStore | null = null;
  private creationTimings = new CreationTimings();
  private watcher: ProjectWatcher | null = null;
  private managementController = new AbortController();
  index: SemanticIndex | null = null;
  private eventSeq = 0;
  private eventEpoch = id();
  readonly emit: (event: AppEvent) => void;
  store: FileStore | null = null;
  private proseIndexer: ProseIndexer | null = null;
  runner: AgentRunner | null = null;
  chat: ConversationRunner | null = null;
  executor: ExecutorRouter | null = null;
  assistant: AssistantRuntime = {
    roles: builtInRoles(),
    search: searchSettingsSchema.parse({}),
    searchKey: ''
  };
  profiles: SecretProfile[] = [];
  recent: { title: string; root: string }[] = [];
  backingUp = false;
  coverController: AbortController | null = null;
  recycleBin: ProjectRecycleBin | null = null;
  constructor(
    readonly skillRoot: string,
    emit: (event: AppEvent) => void,
    readonly caller?: Caller,
    readonly importFile: (file: string, signal: AbortSignal) => Promise<ReturnType<typeof importDocument>> = async (file) => importDocument(file)
  ) {
    this.emit = (event) => {
      try { emit({
        ...event,
        projectSessionId: this.projectSessionId,
        projectId: event.projectId ?? this.store?.db.project()?.id,
        snapshotId: event.snapshotId ?? this.store?.db.get<string>('headSnapshot'),
        streamEpoch: this.eventEpoch,
        seq: ++this.eventSeq,
        epoch: event.epoch ?? this.eventEpoch
      }); } catch {}
    };
  }
  private track<T>(promise: Promise<T>) {
    this.jobs.add(promise);
    void promise.finally(() => this.jobs.delete(promise)).catch(() => {});
    return promise;
  }
  async drain() {
    this.draining = true;
    this.scheduler.stop();
    this.runner?.stop();
    this.chat?.stop();
    this.index?.stop();
    this.coverController?.abort();
    this.proseIndexer?.stop();
    this.managementController.abort();
    await this.runner?.telemetry.stop();
    await Promise.allSettled([...this.requests, ...this.jobs]);
    this.store?.materialize();
    this.close();
    this.requestJournal?.close();
    this.requestJournal = null;
  }
  private assertCanClose() {
    if (this.index?.controller) throw new Error('请先停止语义索引更新');
    if (this.chat?.controller) throw new Error('请先停止当前聊天任务');
    if (this.coverController) throw new Error('封面请求尚未结束，请先停止或等待结果');
    if (this.runner?.controller) throw new Error('请先停止当前任务');
    if (this.runner?.telemetry.busy) throw new Error('评估尚未结束，请先停止或等待结果');
  }
  close() {
    this.assertCanClose();
    this.proseIndexer?.stop();
    this.proseIndexer = null;
    this.watcher?.close();
    this.watcher = null;
    this.store?.close();
    this.store = null;
    this.runner = null;
    this.chat = null;
    this.executor = null;
    this.index = null;
    this.projectSessionId = id();
    this.eventEpoch = id();
    this.eventSeq = 0;
  }
  snapshot(): Snapshot {
    const store = this.store;
    if (this.recycleBin) this.recent = this.recycleBin.reconcileRecent(this.recent);
    return {
      eventSeq: this.eventSeq,
      projectSessionId: this.projectSessionId,
      epoch: this.eventEpoch,
      studio: store ? this.studio() : undefined,
      conversations: this.chat?.records.all('conversations') ?? [],
      chatBusy: !!this.chat?.controller,
      purgedDrafts: this.recycleBin?.purgedDrafts(this.recent) ?? [],
      project: store?.db.project() ?? null,
      tagDraft: store?.db.get<BookSpec>('tagDraft'),
      documents: store?.documentListing() ?? [],
      runs: (store?.db.runs() ?? []).map((r) => this.presentRun(r)),
      events: store?.db.events() ?? [],
      profiles: this.profiles.map(({ apiKey, ...p }) => p),
      recent: this.recent,
      facts: store?.db.facts() ?? [],
      issues: (store?.db.get<string[]>('memoryIssues') ?? []).map((message) => ({
        code: 'memory',
        severity: 'error',
        message
      }))
    };
  }
  private presentRun(run: Run, full = false): Run {
    const store = this.store!;
    return { ...run, creationTiming: this.creationTimings.view(run), basisRevision: compatibleRunBase(store, run) ? store.db.project().revision : null,
      ...(full ? {} : { messages: [], toolResults: {} }) };
  }
  studio(): StudioState {
    const store = this.store!;
    const head = store.db.headRef();
    return {
      snapshot: head
        ? { id: head.id, projectId: head.projectId, revision: head.revision, createdAt: head.createdAt }
        : null,
      snapshots: store.db.snapshots(),
      recoveryConflicts: store.recoveryConflicts(),
      outbox: store.db.sql
        .prepare("SELECT id,status,error FROM materialization_outbox WHERE status<>'complete'")
        .all() as StudioState['outbox'],
      assessments: (
        store.db.sql.prepare('SELECT data FROM assessments ORDER BY rowid DESC LIMIT 500').all() as {
          data: string;
        }[]
      ).map((x) => {
        const a = JSON.parse(x.data) as Assessment;
        const identity = store.db.get<DraftIdentity | null>(`candidateIdentity:${a.draftId}`);
        return {
          ...a,
          stale:
            a.track === 'accepted' || a.track === 'plan'
              ? a.evidence.length
                ? a.evidence.some((e) => store.db.document(e.path)?.hash !== e.hash)
                : store.db.document(a.track === 'plan' ? detailPath(a.chapter) : prosePath(a.chapter))
                    ?.hash !== a.hash
              : (a.snapshotId !== head?.id && !compatibleSettingsSnapshot(store, a.snapshotId)) ||
                !identity ||
                identity.hash !== a.hash ||
                identity.epoch !== a.epoch ||
                identity.draftVersion !== a.draftVersion
        };
      }),
      index: store.db.get('vectorIndex') ?? null,
      reviewQueue: store.db.sql
        .prepare("SELECT * FROM review_queue WHERE status='pending' LIMIT 500")
        .all() as StudioState['reviewQueue']
    };
  }
  async open(root: string) {
    if (isRecyclePath(root)) throw new Error('请先从客户端回收站恢复作品，再打开编辑');
    this.assertCanClose();
    if (!fs.existsSync(path.join(root, '.novelclient/state.sqlite')))
      throw new Error(`此目录不是${brand.name}项目；请新建作品后导入文档`);
    this.close();
    const store = new FileStore(root);
    this.store = store;
    try {
      verifyObjects(store.root, store.db.sql);
      store.recover();
      recoverAttempts(store);
      new ExecutionRecords(store.db).recover();
      const p = store.db.project();
      if (!p) throw new Error(`此目录不是${brand.name}项目；请新建作品后导入文档`);
      assertProjectVersion(p);
      p.root = store.root;
      p.config = configSchema.parse(p.config);
      const creation = approvedCreation(p);
      if (creation) validateApprovedTags(creation, p.id);
      if (p.creation && p.tags) throw new Error('作品存在重复的正式方案记录，请恢复最近的完整备份');
      if (p.creation && !p.creation.contract.plan || p.creationWorkflow === 2 && p.stage !== 'S01' && !p.creation)
        throw new Error('正式作品方案记录缺失，请从完整备份恢复');
      if (p.titleBinding && (p.title !== p.titleBinding.candidate.title || !p.titleReviewRequired && p.titleBinding.planHash !== creation?.contract.planHash))
        throw new Error('正式书名与方案绑定不一致，请从完整备份恢复');
      store.db.set('project', p);
      this.runner = new AgentRunner(store, this.skillRoot, () => this.profiles, this.emit, this.caller);
      this.runner.searchSettings = () => this.assistant.search;
      this.runner.telemetry.schedule = (execute) => this.track(this.scheduler.run(id(), ['assessment'], 2, execute));
      this.index = new SemanticIndex(
        store,
        () => ({
          settings: embeddingSettingsSchema.parse(this.assistant.embedding ?? {}),
          apiKey: this.assistant.embeddingKey ?? ''
        }),
        () => this.emit({ type: 'snapshot' })
      );
      this.runner.retrieve = (query, scope, budget) => this.index!.retrieve(query, scope, 12, budget);
      this.runner.research = (signal, run) =>
        new PublicSearch(this.assistant.search, this.assistant.searchKey, true, signal, { store, owner: run });
      this.chat = new ConversationRunner(
        store,
        this.skillRoot,
        () => this.profiles,
        () => this.assistant,
        this.emit,
        this.caller
      );
      this.executor = new ExecutorRouter(store, this.runner, this.chat);
      this.chat.records.recover();
      if (!this.chat.records.all('conversations').length)
        this.chat.records.create('创作讨论', this.assistant.search.enabled);
      for (const r of store.db.allRuns())
        if (r.status === 'running' || r.status === 'committing') {
          setRunStatus(r, store.db.get(`inflight:${r.id}`) ? 'unknown' : 'paused');
          r.error = '上次执行中断，恢复前将核对输入和未完成请求';
          store.db.saveRun(r);
        }
      recoverUsage(store);
      for (const r of store.db.allRuns()) {
        if (r.accepted || ['discarded', 'stale'].includes(r.status)) continue;
        if (!r.baseSnapshotId && r.baseRevision === p.revision) {
          r.baseSnapshotId = store.db.head()!.id;
          if (r.stage === 'S10' && r.mode === 'stage' && !r.pipeline) {
            const prose = r.changes.find((c) => c.path === prosePath(r.chapter));
            r.pipeline = {
              phase: prose ? 'review' : 'prose',
              proseHash: prose ? hash(prose.content) : undefined,
              epoch: id(),
              version: 1,
              previewCalls: 0
            };
            r.changes = prose ? [prose] : [];
            r.facts = [];
            r.messages = [];
            r.skillHash = undefined;
            setRunStatus(r, 'paused');
            r.error = '候选已保留，继续后核对正文与记忆';
          }
          store.db.saveRun(r);
        }
      }
      rebuildMemory(store);
      syncEntities(store);
      for (const run of store.db.runs()) this.runner.recoverReadyCandidate(run, p, 'restore');
      const proseIndexer = this.proseIndexer = new ProseIndexer(store);
      setImmediate(() => { if (this.proseIndexer === proseIndexer) void this.track(proseIndexer.rebuild()).catch(() => {}); });
      this.watcher = new ProjectWatcher(store, () => this.emit({ type: 'snapshot', resource: 'documents' }), () => {});
      this.recent = [{ title: p.title, root: p.root }, ...this.recent.filter((x) => x.root !== p.root)].slice(
        0,
        20
      );
    } catch (e) {
      store.close();
      this.store = null;
      throw e;
    }
    return this.snapshot();
  }
  require() {
    if (!this.store || !this.runner) throw new Error('请先打开作品');
    return { s: this.store, p: this.store.db.project(), runner: this.runner };
  }
  makeRun(mode: Run['mode'], request: string, profileId?: string): Run {
    const { p } = this.require(),
      profile = this.profiles.find(
        (v) => v.id === (profileId || p.config.stageProfiles[p.stage] || p.config.defaultProfileId)
      );
    const run: Run = {
      id: id(),
      projectId: p.id,
      operationId: this.operations.currentId(),
      executorId: chooseExecutor('pi'),
      executorVersion: piExecutorVersion,
      checkpointVersion: 1,
      candidateFormat: 2,
      baseSnapshotId: this.store!.db.get<string>('headSnapshot'),
      skillId: mode === 'revision' ? 'webnovel-revision-cascade' : stageSkills[p.stage],
      pipeline:
        mode === 'stage' && p.stage === 'S10'
          ? { phase: 'prose', epoch: id(), version: 0, previewCalls: 0 }
          : undefined,
      stage: p.stage,
      ...(mode === 'stage' && p.stage === 'S05' ? { volumeNaming: { version: 1 as const } } : {}),
      chapter: p.chapter,
      batch: activeBatch(p),
      mode,
      request,
      status: 'awaiting_review',
      profileId: profile?.id ?? '',
      profileVersion: profile?.version ?? 0,
      reasoningEfforts: captureReasoning(this.profiles),
      createdAt: now(),
      updatedAt: now(),
      baseRevision: p.revision,
      manifest: null,
      changes: [],
      facts: [],
      issues: [],
      messages: [],
      responseText: '',
      rounds: 0,
      toolCount: 0,
      usage: { input: 0, output: 0, cost: 0, currency: profile?.currency ?? 'USD' },
      accepted: false,
      toolResults: {}
    };
    const creation = approvedCreation(p);
    if (creation)
      run.tagBinding = {
        inputHash: creation.spec.inputHash,
        contractRevision: creation.contract.revision,
        knowledgeVersion: creation.knowledge.version
      };
    if (mode === 'stage' && p.stage === 'S01' && (p.tagEnabled || p.creationWorkflow === 2)) this.initializePlanning(run, 'new');
    return run;
  }
  initializePlanning(run: Run, origin: 'new' | 'adoption' | 'revision', unified?: boolean) {
    const { s, p } = this.require();
    const draft = s.db.get<BookSpec>('tagDraft');
    if (!draft) throw new Error('请先在标签与策划中保存合法标签');
    const current = {
      targetWords: p.config.targetWords,
      pov: p.config.pov,
      style: p.config.style,
      constraints: p.config.constraints
    };
    if (tagHash(current) !== tagHash(draft.preferences))
      throw new Error('项目参数已改变，请重新保存标签输入');
    run.planning = {
      ...((unified ?? p.creationWorkflow === 2) ? { workflowVersion: 2 as const } : {}),
      directionFormatVersion: 1,
      binding: '',
      promptHashes: {},
      spec: structuredClone(draft),
      knowledge: compileTags(draft, this.skillRoot),
      phase: 'planning',
      resolutions: {},
      semanticRevisions: 0,
      formatRepairs: 0,
      origin,
      history: []
    };
    run.planning.binding = planningFingerprint(run);
  }
  launch(r: Run, receipt: unknown = r.id) {
    const { s, runner } = this.require();
    if (runner.controller || this.chat?.controller || this.coverController)
      throw new Error('本书已有运行中的模型任务');
    s.db.transaction(() => {
      const execution = new ExecutionRecords(s.db).create(r.id, r.executorId ?? 'legacy', r.executorVersion ?? '1', r.executionId);
      r.executionId = execution.id;
      s.db.saveRun(r);
      this.operations.complete(receipt);
    });
    void this.track(this.scheduler.run(r.id, ['foreground'], 10, async () => {
      const timingStore = (this.requestJournal ?? s).db;
      // Optional timing telemetry must never prevent generation or alter its result.
      try { this.creationTimings.begin(r, s.db.project(), this.profiles, timingStore); } catch {}
      try {
        return await this.executor!.execute({ id: r.id, kind: 'run' });
      } finally {
        try { this.creationTimings.finish(s.db.run(r.id), timingStore); } catch {}
      }
    })).catch((e) => {
      const latest = s.db.run(r.id);
      if (['complete', 'discarded', 'stale'].includes(latest.status)) return;
      setRunStatus(latest, latest.status === 'failed' ? 'failed' : 'paused');
      latest.error = (e as Error).message;
      s.db.saveRun(latest);
      this.emit({ type: 'snapshot' });
    });
    return r.id;
  }
  rebuildRun(old: Run, profileId: string, instruction = '', authorRevision = false) {
    const { s, p, runner } = this.require();
    if (runner.controller || this.chat?.controller || this.coverController) throw new Error('请先停止当前任务');
    if (old.accepted || ['discarded', 'running', 'committing'].includes(old.status)) throw new Error('此任务不能重建上下文');
    if (old.mode === 'stage' && (old.stage !== p.stage || old.chapter !== p.chapter)) throw new Error('作品已进入其他阶段，请从当前阶段继续，旧任务保留供查阅');
    const r = this.makeRun(old.mode, `${old.request}\n\n作者要求：${instruction || '继续当前任务'}\n按当前规则与正式资料重新核对已有候选后继续。候选尚未接受，不能据此跳过确认。之前错误：${old.error ?? '无'}。`, profileId);
    r.skillId = old.skillId;
    r.volumeNaming = upgradesVolumeNaming(old, instruction)
      ? { version: 1, authorRevision: true } : structuredClone(old.volumeNaming);
    r.parentRunId = old.parentRunId ?? old.id;
    r.executionId = old.executionId;
    r.rounds = old.rounds;
    r.toolCount = old.toolCount;
    r.usage = structuredClone(old.usage);
    r.steps = structuredClone(old.steps);
    r.repairAttempts = structuredClone(old.repairAttempts);
    r.repairScope = structuredClone(old.repairScope);
    r.proseReviewFeedback = structuredClone(old.proseReviewFeedback);
    r.networkRetries = old.networkRetries;
    r.candidateWrites = structuredClone(old.candidateWrites);
    r.documentDrafts = structuredClone(old.documentDrafts);
    r.changes = candidateChangesForCurrentSettings(s, old);
    r.facts = structuredClone(old.facts);
    r.factRetractions = structuredClone(old.factRetractions);
    r.continuity = structuredClone(old.continuity);
    if (old.memoryRepair) {
      const compatible = compatibleRunBase(s, old);
      r.memoryRepair = compatible ? structuredClone(old.memoryRepair) : prepareMemoryRepair(s);
      r.continuity = memoryRepairScope(r.memoryRepair);
      if (compatible) {
        r.baseRevision = old.baseRevision;
        r.baseSnapshotId = old.baseSnapshotId;
        r.changes = structuredClone(old.changes);
        r.memoryReview = structuredClone(old.memoryReview);
        r.memoryCompletionHash = old.memoryCompletionHash;
        r.futurePlanReview = structuredClone(old.futurePlanReview);
      } else {
        r.changes = [];
        r.facts = [];
        r.factRetractions = [];
      }
    }
    if (old.pipeline?.proseHash && r.pipeline) {
      const prose = old.changes.find(change => change.path === prosePath(old.chapter));
      if (prose && hash(prose.content) === old.pipeline.proseHash) {
        r.pipeline = { ...old.pipeline, phase: 'review', epoch: id(), version: old.pipeline.version + 1 };
        if (old.pipeline.narrative?.epoch === old.pipeline.epoch)
          r.pipeline.narrative = { ...structuredClone(old.pipeline.narrative), epoch: r.pipeline.epoch };
        else r.pipeline.narrative = undefined;
        r.changes = [structuredClone(prose)];
        r.facts = [];
        r.sourceProseHash = old.pipeline.proseHash;
      }
    }
    if (old.planning) {
      planningBinding(s, old);
      // The report and the author's approval bind the original immutable input, not this handoff's ID.
      r.baseRevision = old.baseRevision;
      r.baseSnapshotId = old.baseSnapshotId;
      r.planning = structuredClone(old.planning);
      r.planning.promptHashes = {};
      if (old.skillHash && old.skillHash !== planningRulesHash(this.skillRoot, p, old.planning)) {
        r.planning.phase = 'reviewing_report';
        r.planning.reportReview = undefined;
        r.planning.contractReview = undefined;
        r.planning.planApproval = undefined;
        r.planning.titleSelection = undefined;
      }
    }
    if (old.naming) {
      namingBinding(s, old);
      r.baseRevision = old.baseRevision;
      r.baseSnapshotId = old.baseSnapshotId;
      r.naming = structuredClone(old.naming);
      if (old.skillHash && old.skillHash !== namingRulesHash(this.skillRoot, p, r.naming) && r.naming.batch) {
        r.naming.phase = 'reviewing';
        r.naming.review = undefined;
      }
    }
    if (authorRevision) {
      // A confirmed new candidate gets its own execution limit, while its old
      // candidate, attempts and shared monetary budget remain in the lineage.
      if (!needsNewChapterCandidate(old, p.config)) throw new Error('当前任务无需建立新的章节候选');
      r.executionId = undefined;
      r.rounds = 0;
      r.toolCount = 0;
      r.networkRetries = 0;
      r.steps = [];
      r.request = `${old.request}\n\n作者要求生成新的章节候选：${instruction}`;
      prepareAuthorRevision(r, '');
    }
    const namingChildren = r.planning?.planApproval
      ? [...s.db.allRuns()].filter(child => child.naming?.sourceRunId === old.id && !child.accepted && !['discarded', 'stale'].includes(child.status))
      : [];
    s.db.transaction(() => {
      s.db.saveRun(r);
      for (const child of namingChildren) {
        child.naming!.sourceRunId = r.id;
        s.db.saveRun(child);
        s.db.event(child.id, 'source-handoff', '已接续同一份已确认方案，保留书名候选与审核记录', { from: old.id, to: r.id });
      }
      if (r.naming?.sourceRunId) {
        const parent = s.db.run(r.naming.sourceRunId);
        if (parent.planning?.titleSelection?.batchRunId === old.id) {
          if (r.naming.phase === 'ready') parent.planning.titleSelection.batchRunId = r.id;
          else parent.planning.titleSelection = undefined;
          s.db.saveRun(parent);
        }
      }
      setRunStatus(old, 'discarded');
      old.error = `已交接至 ${r.id}，原始任务和请求记录保留`;
      s.db.saveRun(old);
      if (authorRevision) s.db.event(r.id, 'candidate-restarted', '按作者要求生成新一版，原候选与请求记录已保留', {
        previousRunId: old.id, previousRounds: old.rounds, previousTools: old.toolCount,
        maxRounds: p.config.maxRounds, maxTools: p.config.maxTools, monetaryBudgetRetained: true
      });
      for (const conversation of this.chat!.records.all('conversations').filter(item => item.runId === old.id)) {
        this.chat!.records.save('conversations', { ...conversation, runId: r.id });
        for (const proposal of this.chat!.records.all('action_proposals', conversation.id).filter(item => item.status === 'pending'))
          this.chat!.records.save('action_proposals', { ...proposal, status: 'stale' });
      }
    });
    return r;
  }
  change(relative: string, content: string): Change {
    const { s } = this.require();
    return { path: relative, content, baseHash: s.db.document(relative)?.hash ?? null };
  }
  private needsMemoryRepair(request: string, profileId?: string) {
    const { s, p } = this.require();
    if (p.stale.length) return true;
    if (!(s.db.get<string[]>('memoryIssues') ?? []).length) return false;
    const profile = this.profiles.find(item => item.id === (profileId || p.config.stageProfiles[p.stage] || p.config.defaultProfileId));
    if (!profile) return true;
    let blocked = true;
    try {
      compileContext(s, p, p.stage, request, profile, { allowConflicts: true, deferBudgetCheck: true,
        onMemoryDiagnostics: result => { blocked = result.blocking.length > 0; } });
    } catch { return true; }
    return blocked;
  }
  startMemoryRepair(profileId?: string, receipt?: { count: number; issues: string[] }) {
    const { s } = this.require();
    const existing = s.db.runs().find(run => run.memoryRepair && !run.accepted && !['discarded', 'stale', 'failed'].includes(run.status) && compatibleRunBase(s, run));
    if (existing) return existing.id;
    const run = this.makeRun('revision', '核对并同步前文修改影响的记忆与后续资料，保留无关内容，汇总为一次审阅。', profileId);
    run.memoryRepair = prepareMemoryRepair(s);
    run.continuity = memoryRepairScope(run.memoryRepair);
    if (!run.memoryRepair.paths.length) throw new Error('没有需要同步的记忆或资料');
    if (!this.profiles.some(profile => profile.id === run.profileId && profile.apiKey)) throw new Error('请先选择可用模型，再核对并同步记忆');
    return this.launch(run, receipt ? { ...receipt, runId: run.id } : run.id);
  }
  async invoke<C extends Command>(command: C, args: unknown = {}, options: { operationId?: string; projectSessionId?: string } = {}): Promise<CommandOutput<C>> {
    if (!isCommand(command)) throw new ApplicationError('VALIDATION_ERROR', '不支持此操作');
    if (this.draining) throw new ApplicationError('WORKER_UNAVAILABLE', '执行内核正在安全关闭');
    if (options.projectSessionId && options.projectSessionId !== this.projectSessionId)
      throw new ApplicationError('PROJECT_SESSION_STALE', '作品会话已改变，请刷新后操作', ['refresh']);
    const input = parseInput(command, args);
    const action = async () => parseOutput(command, await this.dispatch(command, input));
    const request = options.operationId && this.store && commandContracts[command].access !== 'read' && commandContracts[command].scope === 'project'
      ? this.operations.perform(this.store.db, options.operationId, command, input, action) : action();
    this.requests.add(request);
    try { return await request; } finally { this.requests.delete(request); }
  }
  private async dispatch(command: Command, a: Record<string, unknown>): Promise<unknown> {
    if (
      this.backingUp &&
      commandContracts[command].access !== 'read' &&
      !['run.cancel', 'terminal.cancel', 'chat.stop', 'embedding.cancel', 'cover.cancel'].includes(command)
    )
      throw new Error('正在建立一致备份，请稍后再进行写入或切换项目');
    if (command === 'app.snapshot') return this.snapshot();
    if (command === 'resource.read') {
      const { s } = this.require();
      const resources = a.resources as string[];
      return { projectSessionId: this.projectSessionId, eventSeq: this.eventSeq,
        ...(resources.includes('runs') ? { runs: s.db.runs().map((run) => this.presentRun(run)), events: s.db.events() } : {}),
        ...(resources.includes('chat') ? { conversations: this.chat!.records.all('conversations'), chatBusy: !!this.chat?.controller } : {}),
        ...(resources.includes('documents') ? { documents: s.documentListing() } : {}),
        ...(resources.includes('studio') ? { studio: this.studio() } : {}) };
    }
    if (command === 'operation.query') return this.operations.read(this.require().s.db, str(a.id));
    if (command === 'history.preview') { const { s } = this.require(); return garbageCollectionPreview(s.root, s.db.sql); }
    if (command === 'tags.catalog') return tagBundle(this.skillRoot).taxonomy;
    if (command === 'titles.styleProfile') return loadTitleStyleProfile(this.skillRoot);
    if (command === 'tags.validate') {
      const input = tagInputSchema.parse(a.input);
      return compileTags(
        makeBookSpec(
          { id: 'preview', config: configSchema.parse({}) } as ProjectState,
          input,
          0,
          tagBundle(this.skillRoot).taxonomy
        ),
        this.skillRoot
      );
    }
    if (command === 'expression.catalog') return expressionLibrary(this.skillRoot).catalog;
    if (command === 'embedding.test') {
      const settings = embeddingSettingsSchema.parse(this.assistant.embedding ?? {});
      const journal = this.requestJournal ?? this.store;
      if (!journal) throw new Error('请求账本未初始化');
      const owner = { id: id(), usage: { input: 0, output: 0, cost: 0, currency: settings.currency } };
      const result = await callExternal(journal, owner, 'management-embedding-test', {
        provider: 'embeddings', model: settings.model, version: 1, identity: settings,
        pricing: settings.price, currency: settings.currency
      }, ['连接测试'], settings.price === null ? null : estimatedUnits(32, 0, settings.price, 0), this.managementController.signal,
      () => new CompatibleEmbeddings(settings, this.assistant.embeddingKey ?? '').embed(['连接测试'], this.managementController.signal),
      (result) => ({ input: result.tokens, output: 0, cost: result.tokens === null || settings.price === null ? null : result.tokens * settings.price / 1e6, currency: settings.currency }));
      return { ok: true, dimensions: result.vectors[0].length, tokens: result.tokens };
    }
    if (command === 'skills.list')
      return new SkillRegistry(this.skillRoot).entries.map((e) => ({
        ...e,
        host: new SkillRegistry(this.skillRoot).get(e.id).host
      }));
    if (command === 'search.test') {
      const journal = this.requestJournal ?? this.store;
      if (!journal) throw new Error('请求账本未初始化');
      const profile = this.profiles.find(profile => a.profileId ? profile.id === a.profileId : profile.protocol === 'responses' && profile.enabled);
      if (profile && usesNativeSearch(profile, this.assistant.search)) {
        if (!profile.apiKey) throw new Error('请先为测试模型配置 API Key');
        const owner = { id: id(), usage: { input: 0, output: 0, cost: 0, currency: profile.currency } };
        const query = 'OpenAI 官方 Responses API web_search 文档';
        const result = await callModel(journal, owner, 'management-native-search-test', this.caller ?? invokeModel,
          { ...profile, stream: false, outputLimit: Math.min(profile.outputLimit, 1024) },
          '请执行一次联网搜索，查找 OpenAI 官方 web_search 文档，简短回答并引用来源。',
          [{ role: 'user', content: query }], [], this.managementController.signal, () => {},
          { webSearch: { maxCalls: 1, required: true, serverLimit: nativeServerLimit(profile, this.assistant.search) } });
        const sources = nativeSearchSources(result.webSearch ?? { calls: [], citations: [] });
        if (!result.webSearch?.calls.some(call => call.status === 'completed') || !sources.length)
          throw new Error('模型服务未返回已完成的原生搜索与可核对来源，请检查模型或中转是否支持 web_search');
        return { ok: true, query, at: now(), message: 'OpenAI 原生搜索与来源返回正常', credits: null,
          results: sources.map(source => ({ title: source.title, url: source.url, content: result.text.slice(0, 6000) })) };
      }
      if (this.assistant.search.provider === 'openai') throw new Error('请先配置支持工具调用的 Responses 模型，再测试 OpenAI 原生搜索');
      const result = await new PublicSearch(
        { ...this.assistant.search, enabled: true },
        this.assistant.searchKey,
        true,
        this.managementController.signal,
        { store: journal, owner: { id: id(), usage: { input: 0, output: 0, cost: 0, currency: 'USD' } } }
      ).search('Tavily API documentation');
      return { ok: true, ...result };
    }
    if (command === 'project.listTrash') {
      if (!this.recycleBin) throw new Error('回收站尚未初始化');
      this.recycleBin.sweep();
      return this.recycleBin.list();
    }
    if (command === 'project.restoreTrash') {
      if (!this.recycleBin) throw new Error('回收站尚未初始化');
      const restored = this.recycleBin.restore(str(a.id), a.parent ? str(a.parent) : undefined);
      this.recent = [restored, ...this.recent.filter((r) => !samePath(r.root, restored.root))].slice(0, 20);
      return this.snapshot();
    }
    if (command === 'project.restoreBackup') return restoreBackup(str(a.source), str(a.parent));
    if (command === 'project.preview') {
      const p = newProject(typeof a.title === 'string' ? a.title : '待定', 'preview', a.config ?? {});
      return Object.keys(initialFiles(p, this.skillRoot, typeof a.premise === 'string' ? a.premise : ''));
    }
    if (command === 'project.importLegacy') {
      if (a.preview === true) return previewLegacy(str(a.source));
      const root = importLegacy(a);
      return this.open(root);
    }
    if (command === 'project.create') {
      const args = z
        .object({
          parent: z.string(),
          title: z.string().max(80).optional(),
          premise: z.string(),
          tagInput: tagInputSchema.optional(),
          creationInput: tagInputSchema.optional(),
          config: configSchema.optional()
        })
        .parse(a);
      if (args.tagInput && args.creationInput) throw new Error('请只提交一份开书输入');
      if (!args.tagInput && !args.creationInput && !args.premise.trim()) throw new Error('原有创建方式需要填写原始设定');
      if (args.creationInput) makeCreationSpec({ id: 'preview', config: configSchema.parse(args.config ?? {}) } as ProjectState,
        args.creationInput, 1, tagBundle(this.skillRoot).taxonomy);
      if (args.tagInput)
        makeBookSpec(
          { id: 'preview', config: configSchema.parse(args.config ?? {}) } as ProjectState,
          args.tagInput,
          1,
          tagBundle(this.skillRoot).taxonomy
        );
      const suppliedTitle = args.title?.trim();
      if (args.creationInput && suppliedTitle) throw new Error('统一开书流程请先确认作品方案，再确定书名');
      const title = suppliedTitle || `待定书名-${id().slice(0, 8)}`;
      validateExpressionSelection(this.skillRoot, configSchema.parse(args.config ?? {}));
      const locationError = newProjectLocationError(path.resolve(args.parent));
      if (locationError) throw new ApplicationError('VALIDATION_ERROR', locationError);
      if (/[<>:"/\\|?*\x00-\x1f]/.test(title) || /[. ]$/.test(title))
        throw new Error('作品名称包含无效路径字符');
      this.close();
      const root = path.join(args.parent, `《${title}》创作档案`);
      if (fs.existsSync(root)) throw new Error('同名作品目录已存在，请改名或打开');
      fs.mkdirSync(root, { recursive: true });
      const s = new FileStore(root);
      this.store = s;
      const p = newProject(title, root, args.config ?? {});
      if (!suppliedTitle) p.titlePending = true;
      p.revision = 1;
      if (args.tagInput) {
        p.tagEnabled = true;
        p.schemaVersion = 2;
        s.db.set('tagDraft', makeBookSpec(p, args.tagInput, 1, tagBundle(this.skillRoot).taxonomy));
      }
      if (args.creationInput) {
        p.creationWorkflow = 2;
        p.schemaVersion = 3;
        p.tagEnabled = !!args.creationInput.selection.reading.main;
        s.db.set('tagDraft', makeCreationSpec(p, args.creationInput, 1, tagBundle(this.skillRoot).taxonomy));
      }
      const premise = args.creationInput?.premise ?? args.tagInput?.premise ?? args.premise;
      const files = initialFiles(p, this.skillRoot, premise);
      new ProjectCommitService(s).commit(
        Object.entries(files).map(([path, content]) => ({ path, content, baseHash: null })),
        p
      );
      s.db.set('premise', premise);
      s.close();
      this.store = null;
      return this.open(root);
    }
    if (command === 'project.open') return this.open(str(a.root));
    if (command === 'project.close') {
      this.close();
      return this.snapshot();
    }
    if (command === 'project.trash') {
      if (!this.recycleBin) throw new Error('回收站尚未初始化');
      const root = str(a.root);
      const entry = this.recent.find((r) => samePath(r.root, root));
      if (!entry) throw new Error('此作品已不在最近列表中，请刷新后重试');
      if (this.store && samePath(this.store.root, root)) this.close();
      try {
        this.recycleBin.trash(entry.root, entry.title);
        this.recent = this.recent.filter((r) => !samePath(r.root, root));
        return this.snapshot();
      } catch (e) {
        this.recycleBin.sweep();
        throw e;
      } finally {
        this.emit({ type: 'snapshot' });
      }
    }
    if (command === 'profiles.test') {
      if (this.runner?.controller || this.chat?.controller || this.coverController)
        throw new Error('请等当前模型任务结束再测试连接');
      const profile = this.profiles.find((p) => p.id === str(a.id));
      if (!profile) throw new Error('模型配置不存在');
      const toolTest = a.tools === true;
      const journal = this.requestJournal ?? this.store;
      if (!journal) throw new Error('请求账本未初始化');
      const owner = { id: id(), usage: { input: 0, output: 0, cost: 0, currency: profile.currency } };
      const tools = toolTest
        ? [
            {
              name: 'probe',
              description: 'Call this tool with value ping',
              parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
                additionalProperties: false
              }
            }
          ]
        : [];
      const result = await callModel(journal, owner, 'management-profile-test', invokeModel,
        profile,
        'Protocol connectivity test.',
        [
          {
            role: 'user',
            content: toolTest
              ? 'Call probe with value ping, then after its result reply pong.'
              : 'Reply exactly pong.'
          }
        ],
        tools,
        this.managementController.signal
      );
      if (toolTest) {
        if (!result.calls.length) throw new Error('文字返回正常，但模型未执行工具调用');
        const end = await callModel(journal, owner, 'management-profile-tool-test', invokeModel,
          profile,
          'Protocol connectivity test.',
          [
            { role: 'user', content: 'Call probe then reply pong.' },
            { role: 'assistant', content: result.text, calls: result.calls, native: result.native },
            ...result.calls.map((c) => ({ role: 'tool' as const, callId: c.id, content: 'ping received' }))
          ],
          tools,
          this.managementController.signal
        );
        if (end.stop !== 'complete' || !end.text) throw new Error('工具结果续轮未完成');
        return { ok: true, text: end.text };
      }
      return { ok: true, text: result.text };
    }
    const { s, p, runner } = this.require();
    const chat = this.chat!,
      records = chat.records;
    const idle = () => {
      if (runner.controller || chat.controller || this.coverController)
        throw new Error('同一本书同时只能运行一个模型任务，请等待或停止当前任务');
    };
    if (command === 'run.page') {
      const page = s.db.runPage(typeof a.before === 'number' ? a.before : undefined, typeof a.watermark === 'number' ? a.watermark : undefined, typeof a.limit === 'number' ? a.limit : 100);
      return { ...page, items: page.items.map(run => this.presentRun(run, true)) };
    }
    if (command === 'run.events')
      return s.db.runEvents(
        str(a.id),
        z
          .number()
          .int()
          .nonnegative()
          .parse(a.afterSeq ?? 0),
        z
          .number()
          .int()
          .min(1)
          .max(500)
          .parse(a.limit ?? 100)
      );
    if (command === 'tags.saveDraft' || command === 'creation.saveDraft') {
      idle();
      const prior = s.db.get<BookSpec>('tagDraft');
      if (a.expectedRevision !== (prior?.revision ?? 0))
        throw new Error('标签输入已由另一个窗口修改，请刷新');
      const draft = (command === 'creation.saveDraft' || p.creationWorkflow === 2 ? makeCreationSpec : makeBookSpec)(p, a.input, (prior?.revision ?? 0) + 1, tagBundle(this.skillRoot).taxonomy);
      s.db.set('tagDraft', draft);
      for (const r of s.db.runs())
        if ((r.planning || r.naming?.sourceRunId) && !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status)) {
          setRunStatus(r, 'stale');
          r.error = '标签或作者输入已更新，旧报告保留为历史';
          s.db.saveRun(r);
        }
      return draft;
    }
    if (command === 'tags.start' || command === 'creation.start') {
      const draft = s.db.get<BookSpec>('tagDraft');
      if (!draft || draft.inputHash !== a.inputHash) throw new Error('标签输入已改变，请刷新后开始');
      const requestId = z.string().min(1).max(100).parse(a.requestId);
      const fingerprint = tagHash({
        inputHash: draft.inputHash,
        profileId: a.profileId ?? '',
        request: a.request ?? ''
      });
      const old = s.db.get<{ id: string; fingerprint: string }>(`tagRequest:${requestId}`);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new Error('请求编号被用于不同输入');
        return old.id;
      }
      idle();
      if (
        s.db
          .runs()
          .some(
            (r) =>
              !r.accepted &&
              (r.planning || r.mode === 'stage') &&
              !['discarded', 'stale', 'failed'].includes(r.status)
          )
      )
        throw new Error('请先继续或放弃已有策划/阶段候选');
      const origin = approvedCreation(p) ? 'revision' : p.stage === 'S01' ? 'new' : 'adoption';
      const r = this.makeRun(
        origin === 'new' ? 'stage' : 'revision',
        typeof a.request === 'string' ? a.request : '依据标签和作者意图完成策划；旧书保持已接受内容',
        typeof a.profileId === 'string' ? a.profileId : undefined
      );
      this.initializePlanning(r, origin, command === 'creation.start' || p.creationWorkflow === 2);
      s.db.saveRun(r);
      s.db.set(`tagRequest:${requestId}`, { id: r.id, fingerprint });
      return this.launch(r);
    }
    if (command === 'creation.confirmPlan') {
      idle();
      const r = s.db.run(str(a.id));
      planningBinding(s, r);
      if (r.accepted || ['discarded', 'stale'].includes(r.status) || r.planning?.workflowVersion !== 2) throw new Error('不是当前待确认作品方案');
      runner.check(r, p);
      if (r.issues.some(v => v.severity === 'error')) throw new Error('请先完成方案校验与独立审核');
      if (a.proposalHash !== proposalHash(r)) throw new Error('作品方案已改变，请重新查看');
      r.planning.planApproval = { hash: planCandidateHash(r), planHash: tagHash(r.planning.candidate!.plan), binding: r.planning.binding, at: now() };
      if (a.warningReason) s.db.event(r.id, 'plan-warning-review', String(a.warningReason));
      r.responseText = '作品方案已选定。选好书名后即可保存；已有书名的作品可以直接保存。';
      s.db.saveRun(r);
      return true;
    }
    if (command === 'creation.revisePlan') {
      idle();
      const r = s.db.run(str(a.id));
      planningBinding(s, r);
      const t = r.planning!;
      if (r.accepted || !['awaiting_review', 'needs_repair'].includes(r.status) || !t.candidate || !['ready', 'reviewing_contract'].includes(t.phase)) throw new Error('请等待当前作品方案生成完成后再修改');
      if (a.proposalHash !== proposalHash(r)) throw new Error('作品方案已改变，请查看最新结果后再修改');
      if (retryNeedsConfirmation(r)) throw new Error('上次请求结果与费用未知，请先核对这次请求');
      if (r.rounds >= p.config.maxRounds || r.toolCount >= p.config.maxTools) throw new Error('已达到当前任务调用上限，请先在运行设置中调整限额');
      t.history.push({ kind: 'author-revision', value: { candidate: structuredClone(t.candidate), instruction: str(a.instruction) } });
      t.authorRevision = { instruction: str(a.instruction), original: structuredClone(t.candidate) };
      t.phase = 'contract';
      t.planApproval = undefined;
      t.titleSelection = undefined;
      t.contractReview = undefined;
      t.promptHashes = {};
      t.repair = undefined;
      t.semanticRevisions = 0;
      t.consecutiveFormatFailures = 0;
      r.messages = [];
      r.candidateWrites = {};
      s.db.event(r.id, 'author-revision', '按作者意见修改当前作品方案，完成后自动检查', { instruction: a.instruction });
      s.db.saveRun(r);
      return this.launch(r);
    }
    if (command === 'titles.restoreProjection') {
      idle();
      if (!p.titleBinding) throw new Error('本书尚无正式命名记录');
      const actual = fileHash(safePath(s.root, titlePath));
      if (a.baseHash !== actual) throw new Error('书名展示文件再次改变，请刷新后恢复');
      const next = structuredClone(p);
      next.revision++;
      new ProjectCommitService(s).commit([{ path: titlePath, content: renderTitle(p.titleBinding), baseHash: actual }], next);
      this.emit({ type: 'snapshot' });
      return true;
    }
    if (command === 'titles.start') {
      idle();
      const sourceRunId = typeof a.sourceRunId === 'string' ? a.sourceRunId : undefined;
      const source = titleSource(s, sourceRunId);
      const planHash = tagHash(source.plan);
      if (a.planHash !== planHash) throw new Error('作品方案已改变，请刷新后命名');
      const rule = a.rule === 'fanqie_experiment' ? 'fanqie_experiment' : 'local';
      const manualTitle = typeof a.manualTitle === 'string' ? validateBookTitle(a.manualTitle, rule) : undefined;
      const fingerprint = tagHash({ sourceHash: source.sourceHash, profileId: a.profileId ?? '', rule, manualTitle, instruction: a.instruction ?? '' });
      const requestId = str(a.requestId), old = s.db.get<{ id: string; fingerprint: string }>(`titleRequest:${requestId}`);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new Error('请求编号被用于不同命名输入');
        return old.id;
      }
      const r = this.makeRun('analysis', manualTitle ? '核对作者填写的书名与作品方案' : '依据已确认作品方案生成不同卖点的书名', typeof a.profileId === 'string' ? a.profileId : undefined);
      r.parentRunId = sourceRunId;
      r.naming = { sourceRunId, planHash, sourceHash: source.sourceHash, inputHash: source.inputHash,
        contractRevision: source.contractRevision, rule, manualTitle, instruction: String(a.instruction ?? ''),
        candidateCount: manualTitle ? 1 : 6, marketResearchVersion: 1, editorialVersion: 2,
        phase: 'generating', history: [], formatRepairs: 0, semanticRevisions: 0 };
      s.db.saveRun(r);
      s.db.set(`titleRequest:${requestId}`, { id: r.id, fingerprint });
      return this.launch(r);
    }
    if (command === 'titles.regenerate') {
      idle();
      const r = s.db.run(str(a.id));
      namingBinding(s, r);
      const t = r.naming!;
      if (r.accepted || ['stale', 'discarded'].includes(r.status) || t.phase !== 'ready' || a.batchHash !== tagHash(t.batch)) throw new Error('书名候选已改变或尚未完成审核');
      const candidateId = str(a.candidateId);
      if (!t.batch!.candidates.some(v => v.id === candidateId)) throw new Error('书名候选不存在');
      t.history.push({ batch: structuredClone(t.batch!), review: t.review?.result });
      t.regenerate = { candidateId, instruction: str(a.instruction), original: structuredClone(t.batch!) };
      t.candidateCount = t.batch!.candidates.length;
      t.manualTitle = undefined;
      if (!t.marketResearchVersion) { t.marketResearchVersion = 1; r.skillHash = undefined; }
      if (t.editorialVersion !== 2) { t.editorialVersion = 2; r.skillHash = undefined; }
      t.phase = 'generating';
      t.review = undefined;
      r.messages = [];
      r.error = undefined;
      if (t.sourceRunId) {
        const parent = s.db.run(t.sourceRunId);
        if (parent.planning?.titleSelection?.batchRunId === r.id) { parent.planning.titleSelection = undefined; s.db.saveRun(parent); }
      }
      return this.launch(r);
    }
    if (command === 'titles.select') {
      idle();
      const r = s.db.run(str(a.id)), t = r.naming;
      if (!t?.batch || a.batchHash !== tagHash(t.batch)) throw new Error('书名候选已改变');
      const candidate = t.batch.candidates.find(v => v.id === a.candidateId);
      if (!candidate) throw new Error('书名候选不存在');
      if (r.accepted && p.titleBinding?.batchRunId === r.id && p.titleBinding.candidate.id === candidate.id && p.titleBinding.batchHash === a.batchHash)
        return { selected: true };
      const selection: TitleSelection = { candidate: structuredClone(candidate), batchRunId: r.id, batchHash: tagHash(t.batch),
        planHash: t.planHash, sourceHash: t.sourceHash, rule: t.rule, at: now() };
      assertTitleSelection(s, selection, t.sourceRunId, this.skillRoot);
      if (t.sourceRunId) {
        const parent = s.db.run(t.sourceRunId);
        const chosen = parent.planning!.titleSelection;
        if (chosen?.batchRunId === r.id && chosen.batchHash === selection.batchHash && chosen.candidate.id === candidate.id)
          return { selected: true, parentRunId: parent.id };
        parent.planning!.titleSelection = selection;
        parent.responseText = '方案与书名均已准备好，请统一采纳本阶段结果。';
        s.db.saveRun(parent);
        return { selected: true, parentRunId: parent.id };
      }
      const next = structuredClone(p);
      next.title = candidate.title;
      next.titlePending = false;
      next.titleBinding = { ...selection, needsReview: false };
      next.titleReviewRequired = false;
      next.revision++;
      next.stale = next.stale.filter(file => file !== titlePath);
      resolveStoryImpacts(next, [titlePath]);
      const changes = [this.change(titlePath, renderTitle(next.titleBinding)),
        this.change(paths.config, updateConfigDocument(s.readAccepted(paths.config).content, next)),
        this.change(paths.progress, renderProgress(next)),
        this.change(paths.index, renderIndex(next, [...new Set([...s.db.acceptedDocuments().map(d => d.path), titlePath])]))];
      r.changes = changes;
      s.db.saveRun(r);
      r.accepted = true;
      setRunStatus(r, 'complete');
      new ProjectCommitService(s).commit(changes, next, r);
      this.recent = this.recent.map(item => samePath(item.root, next.root) ? { ...item, title: next.title } : item);
      this.emit({ type: 'snapshot' });
      return { selected: true };
    }
    if (command === 'tags.reroll') {
      idle();
      const r = s.db.run(str(a.id));
      planningBinding(s, r);
      const t = r.planning!;
      if (r.accepted || ['discarded', 'stale'].includes(r.status) || t.phase !== 'awaiting_direction' ||
          !t.report || a.reportHash !== tagHash(t.report) || t.reportHash !== tagHash(t.report))
        throw new Error('三个方向已改变或尚未生成完成，请刷新后再生成');
      validateReport(t.report, t);
      const keepDirectionIds = z.array(z.string().min(1)).max(1).parse(a.keepDirectionIds);
      if (keepDirectionIds.some(value => !t.report!.directions.some(direction => direction.id === value)))
        throw new Error('要保留的方向不存在');
      const instruction = String(a.instruction ?? '').trim() || (keepDirectionIds.length
        ? '完整保留指定方向，重新设计另外两个机制不同的方案。'
        : '保留作者的必须保留项与禁区，重新设计三个机制不同的方案。');
      t.history.push({ kind: 'report', value: structuredClone(t.report) });
      t.history.push({ kind: 'reroll_request', value: { keepDirectionIds, instruction, promptHashes: { ...t.promptHashes } } });
      t.promptHashes = {};
      t.regenerate = { directionId: keepDirectionIds[0] ?? '', keepDirectionIds, instruction, original: structuredClone(t.report) };
      t.phase = 'planning';
      t.planApproval = undefined;
      t.titleSelection = undefined;
      t.selectedDirectionId = undefined;
      t.candidate = undefined;
      t.contractReview = undefined;
      t.reportReview = undefined;
      t.resolutions = {};
      t.formatRepairs = 0;
      t.semanticRevisions = 0;
      t.repair = undefined;
      r.messages = [];
      r.changes = [];
      r.error = undefined;
      r.issues = [];
      return this.launch(r);
    }
    if (command === 'tags.selectDirection' || command === 'tags.reviseDirection') {
      idle();
      const r = s.db.run(str(a.id));
      planningBinding(s, r);
      const t = r.planning!;
      if (
        r.accepted ||
        ['discarded', 'stale'].includes(r.status) ||
        t.phase !== 'awaiting_direction' ||
        !t.report ||
        t.reportHash !== tagHash(t.report)
      )
        throw new Error('三个方向已改变或尚未生成完成，请刷新后再选择');
      if (a.reportHash !== tagHash(t.report)) throw new Error('策划报告已改变，请重新查看');
      validateReport(t.report, t);
      const directionId = str(a.directionId);
      if (!t.report.directions.some((d) => d.id === directionId)) throw new Error('方向不存在');
      t.planApproval = undefined;
      t.titleSelection = undefined;
      if (command === 'tags.reviseDirection') {
        const instruction = z.string().trim().min(1).max(6000).parse(a.instruction);
        t.history.push({ kind: 'report', value: structuredClone(t.report) });
        t.history.push({ kind: 'reroll_request', value: { directionId, instruction, promptHashes: { ...t.promptHashes } } });
        t.promptHashes = {};
        t.regenerate = { directionId, instruction, original: structuredClone(t.report) };
        t.phase = 'planning';
      } else {
        const resolutions = z
          .record(z.string(), z.string().trim().min(1).max(4000))
          .parse(a.resolutions ?? {});
        if (Object.keys(resolutions).some((id) => !t.report!.assumptions.some((v) => v.id === id)))
          throw new Error('确认意见引用了未知假设');
        if (a.acceptAssumptions === true)
          for (const assumption of t.report.assumptions)
            if (!assumption.directionIds.length || assumption.directionIds.includes(directionId))
              resolutions[assumption.id] ??= '作者已确认采用此设定';
        for (const v of t.report.assumptions)
          if (
            v.critical &&
            (!v.directionIds.length || v.directionIds.includes(directionId)) &&
            !resolutions[v.id]
          )
            throw new Error('请处理关键假设：' + v.text);
        t.selectedDirectionId = directionId;
        t.resolutions = resolutions;
        t.phase = 'contract';
      }
      // Author selection starts a new subphase. Its first repair must not be
      // consumed by the earlier directions; total model/tool budgets stay intact.
      t.semanticRevisions = 0;
      t.repair = undefined;
      r.messages = [];
      r.changes = [];
      r.error = undefined;
      r.issues = [];
      return this.launch(r);
    }
    if (command === 'tags.diff') {
      const r = s.db.run(str(a.id));
      if (!r.planning) throw new Error('不是标签策划任务');
      return { before: approvedCreation(p) ?? null, after: r.planning.candidate ?? null, ...tagImpact(s, r.planning) };
    }
    if (command === 'tags.restoreProjection') {
      idle();
      const creation = approvedCreation(p);
      if (!creation) throw new Error('本书尚无正式作品契约');
      const actual = fileHash(safePath(s.root, contractPath));
      if (a.baseHash !== actual) throw new Error('展示文件已再次改变，请刷新后恢复');
      const content = renderContract(creation.spec, creation.contract);
      if (actual === hash(content)) return true;
      const next = structuredClone(p);
      next.revision++;
      new ProjectCommitService(s).commit([{ path: contractPath, content, baseHash: actual }], next);
      this.emit({ type: 'snapshot' });
      return true;
    }
    if (command === 'manuscript.read') return readManuscriptView(s, p.chapter, typeof a.runId === 'string' ? a.runId : undefined, a.includeDraft !== false);
    if (command === 'studio.read') return { ...this.studio(), entities: syncEntities(s) };
    if (command === 'embedding.reindex') {
      void this.track(this.scheduler.run(id(), ['index'], 1, () => this.index!.rebuild())).catch((e) => this.emit({ type: 'error', text: (e as Error).message }));
      return true;
    }
    if (command === 'embedding.cancel') {
      this.index?.stop();
      return true;
    }
    if (command === 'snapshot.list') return s.db.snapshots();
    if (command === 'snapshot.page') return s.db.snapshotPage(typeof a.before === 'number' ? a.before : undefined, typeof a.watermark === 'number' ? a.watermark : undefined, typeof a.limit === 'number' ? a.limit : 100);
    if (command === 'outbox.retry') {
      s.materialize();
      return this.studio();
    }
    if (command === 'recovery.preview') return s.recoveryPreview(str(a.transactionId), str(a.path));
    if (command === 'recovery.retry' || command === 'recovery.abandon') {
      idle();
      if (command === 'recovery.retry') s.retryRecovery(str(a.transactionId));
      else s.abandonRecovery(str(a.transactionId));
      s.scan();
      this.emit({ type: 'snapshot' });
      return this.studio();
    }
    if (command === 'memory.list') {
      const browse = z
        .object({
          category: z
            .enum(['all', 'character', 'injury', 'item', 'hook', 'knowledge', 'obligations'])
            .default('all'),
          offset: z.number().int().min(0).default(0),
          pageSize: z.number().int().min(1).max(100).default(60)
        })
        .parse(a);
      return retrieveMemory(s, '', a.scope ?? { chapter: p.chapter }, 20, browse);
    }
    if (command === 'memory.retrieve')
      return this.index!.retrieve(
        typeof a.query === 'string' ? a.query : '',
        memoryScopeSchema.parse(a.scope ?? { chapter: p.chapter })
      );
    if (command === 'memory.trace')
      return traceSource(
        s,
        z
          .object({
            path: z.string(),
            hash: z.string(),
            quote: z.string(),
            start: z.number().optional(),
            end: z.number().optional()
          })
          .parse(a)
      );
    if (command === 'state.getCharacter')
      return characterState(s, str(a.entityId), a.scope ?? { chapter: p.chapter });
    if (command === 'state.proposeCorrection') {
      idle();
      const v = z
        .object({
          kind: z.enum(['extraction', 'plan', 'story', 'assessment']),
          factId: z.string().optional(),
          fromChapter: z.number().int().min(1).optional(),
          request: z.string().min(1)
        })
        .parse(a);
      const r = this.makeRun(
        v.kind === 'assessment' ? 'analysis' : 'revision',
        `${({ plan: '调整后续计划，保留已有正文', story: '修订已有故事及其关联内容', extraction: '依据原文纠正记忆提取', assessment: '核对评估判断' })[v.kind]}${v.factId ? `；关联记录：${v.factId}` : ''}。\n${v.request}`
      );
      r.skillId =
        v.kind === 'assessment'
          ? 'webnovel-narrative-telemetry'
          : 'webnovel-revision-cascade';
      if (v.kind !== 'assessment') {
        const fromChapter = v.fromChapter ?? (v.kind === 'plan' ? nextUnwrittenChapter(p) : 1);
        if (v.kind === 'plan' && fromChapter < nextUnwrittenChapter(p))
          throw new Error('调整后续不能覆盖已有正文，请选择故事修订以追溯修改。');
        r.continuity = { mode: v.kind === 'plan' ? 'forward' : v.kind === 'story' ? 'retcon' : 'extraction', fromChapter };
      }
      return this.launch(r);
    }
    if (command === 'skill.run') {
      idle();
      const entry = new SkillRegistry(this.skillRoot).get(str(a.skillId));
      if (entry.host) {
        if (entry.id === 'webnovel-project-bootstrap')
          return this.invoke('project.repair', { preview: true });
        if (entry.id === 'webnovel-project-validator')
          return { documents: s.scan(), issues: rebuildMemory(s).issues };
        if (entry.id === 'webnovel-memory-audit')
          return { ...retrieveMemory(s, '', { chapter: p.chapter }), entities: syncEntities(s) };
        if (entry.id === 'webnovel-context-retriever') return this.invoke('context.preview', { profileId: a.profileId, request: a.request });
        return { batch: activeBatch(p), chapter: p.chapter, complete: p.chapters[p.chapter] === 'complete' };
      }
      const mode =
        entry.id === stageSkills[p.stage]
          ? 'stage'
          : [
                'webnovel-market-research',
                'webnovel-packaging',
                'webnovel-reader-feedback',
                'webnovel-narrative-telemetry',
                'webnovel-continuity-audit'
              ].includes(entry.id)
            ? 'analysis'
            : 'revision';
      let request = str(a.request);
      if (entry.id === 'webnovel-reader-feedback') {
        const feedback = z
          .object({
            source: z.string().min(1),
            window: z.string().min(1),
            sampleSize: z.number().int().nonnegative(),
            synthetic: z.boolean()
          })
          .parse(a.feedback);
        request += `\n反馈资料：${JSON.stringify(feedback)}。${feedback.synthetic ? '此为模拟读者意见，不得表述为真实读者数据。' : '样本仅代表作者提供的采集范围。'}请区分原始反馈、分析推断和建议，不扩大样本结论。`;
      }
      const r = this.makeRun(mode, request, typeof a.profileId === 'string' ? a.profileId : undefined);
      r.skillId = entry.id;
      return this.launch(r);
    }
    if (command === 'draft.checkpoint' || command === 'assessment.refresh') {
      if (runner.controller) throw new Error('正文生成中，请等待任务完成');
      const r = s.db.run(str(a.id));
      if (!compatibleRunBase(s, r) || r.accepted || ['discarded', 'stale'].includes(r.status))
        throw new Error('候选版本已改变');
      const content =
        typeof a.content === 'string'
          ? z.string().max(1000000).parse(a.content)
          : r.changes.find((c) => c.path === prosePath(r.chapter))?.content;
      if (!content) throw new Error('没有可评估正文');
      const profile = this.profiles.find(
        (x) => x.id === (p.config.modelRouting.review || p.config.modelRouting.writing || r.profileId)
      );
      if (!profile) throw new Error('请先选择评估模型');
      const previous = s.db.get<{ hash: string; version: number }>(`draftObservation:${r.id}`);
      const version =
        previous?.hash === hash(content)
          ? previous.version
          : Math.max(previous?.version ?? 0, r.pipeline?.version ?? 0) + 1;
      s.db.set(`draftObservation:${r.id}`, { hash: hash(content), version });
      if (r.pipeline) r.pipeline.version = version;
      if (command === 'draft.checkpoint') {
        runner.telemetry.checkpoint(r, content, profile);
        this.emit({ type: 'snapshot' });
        return true;
      }
      idle();
      const assessment = await runner.telemetry.final(
        r,
        content,
        profile,
        a.track === 'plan' ? 'plan' : 'candidate'
      );
      return assessment;
    }
    if (command === 'chat.list') return records.all('conversations');
    if (command === 'chat.create')
      return records.create(
        typeof a.title === 'string' ? a.title : '创作讨论',
        this.assistant.search.enabled
      );
    if (command === 'chat.update') {
      const c = records.get('conversations', str(a.id));
      if (typeof a.title === 'string') c.title = z.string().trim().min(1).max(80).parse(a.title);
      if (typeof a.archived === 'boolean') c.archived = a.archived;
      if (typeof a.online === 'boolean') c.online = a.online;
      c.updatedAt = now();
      return records.save('conversations', c);
    }
    if (command === 'chat.read') {
      const key = str(a.id);
      return {
        conversation: records.get('conversations', key),
        messages: records.all('conversation_messages', key),
        turns: records.all('conversation_turns', key).map((t) => ({ ...t, messages: [] })),
        proposals: records.all('action_proposals', key)
      };
    }
    if (command === 'chat.page') return records.page(str(a.id), typeof a.before === 'number' ? a.before : undefined, typeof a.watermark === 'number' ? a.watermark : undefined, typeof a.limit === 'number' ? a.limit : 100);
    if (command === 'chat.stop') {
      chat.stop();
      return true;
    }
    if (command === 'chat.send' || command === 'chat.retry' || command === 'run.discuss') {
      idle();
      const old = command === 'chat.retry' ? records.get('conversation_turns', str(a.id)) : undefined;
      if (old && ['running', 'complete'].includes(old.status)) throw new Error('此消息无需重发');
      if (old && a.confirmRetry !== true) throw new Error('需要明确确认重新请求，可能产生新的费用');
      if (old?.kind === 'draft') throw new Error('试写重试需要重新建立任务卡');
      const allowed = z
        .array(z.string())
        .max(10)
        .parse(a.referenceChats ?? []);
      for (const key of allowed) records.get('conversations', key);
      let conversationId = old?.conversationId ?? (typeof a.conversationId === 'string' ? a.conversationId : '');
      if (command === 'run.discuss') {
        const task = s.db.run(str(a.id));
        z.string().trim().min(1).parse(a.text);
        chat.profile(typeof a.profileId === 'string' ? a.profileId : p.config.defaultProfileId, false);
        conversationId = (records.all('conversations').find(conversation => conversation.runId === task.id && !conversation.archived) ?? records.create(`${stageNames[task.stage]} · 任务对话`, false, task.id)).id;
      }
      const turn = chat.prepare(
        conversationId,
        old?.request ?? str(a.text),
        typeof a.profileId === 'string' ? a.profileId : (old?.profileId ?? p.config.defaultProfileId),
        'discussion', undefined, (prepared) => {
          prepared.displayedError = old?.displayedError ?? (typeof a.displayedError === 'string' ? a.displayedError : undefined);
          if (command === 'run.discuss' && a.allowCandidateEdits === true || old?.candidateEdit) {
            const task = s.db.run(old?.candidateEdit?.runId ?? str(a.id));
            if ((!old?.candidateEdit || old.candidateEdit.runHash === taskRunHash(task)) && !task.accepted && !task.planning && !task.naming && !task.memoryRepair && ['stage', 'revision'].includes(task.mode) && ['awaiting_review', 'needs_repair'].includes(task.status) && !retryNeedsConfirmation(task))
              prepared.candidateEdit = { runId: task.id, runHash: taskRunHash(task) };
          }
          records.save('conversation_turns', prepared);
          this.operations.complete(prepared.id);
        }
      );
      const session = this.projectSessionId;
      void this.track(this.scheduler.run(turn.id, ['foreground'], 10, () => this.executor!.execute({ id: turn.id, kind: 'conversation', referenceChats: allowed })).then(async () => {
        if (this.store !== s || this.projectSessionId !== session || this.draining) return;
        const finished = records.get('conversation_turns', turn.id);
        if (finished.status !== 'complete' || !finished.candidateEdit) return;
        const proposed = records.all('action_proposals', turn.conversationId).filter(proposal => proposal.turnId === turn.id && proposal.executionSource === 'author_message' && proposal.status === 'pending');
        if (proposed.length !== 1) return;
        const proposal = proposed[0];
        try {
          // Separate idempotency receipt: never replace the conversation's operation result.
          await this.invoke('proposal.confirm', { id: proposal.id, version: proposal.version }, { operationId: `candidate-edit:${turn.id}`, projectSessionId: session });
        } catch (error) {
          const current = records.get('action_proposals', proposal.id);
          current.executionError = (error as Error).message;
          records.save('action_proposals', current);
          this.emit({ type: 'snapshot', resource: 'chat', resourceId: turn.conversationId });
        }
      }));
      return turn.id;
    }
    if (command === 'proposal.create')
      return chat.propose(str(a.conversationId), '', str(a.profileId), a.proposal);
    if (command === 'proposal.cancel') {
      const proposal = records.get('action_proposals', str(a.id));
      if (proposal.status === 'executed') throw new Error('任务已执行，请在运行记录中停止或放弃');
      proposal.status = 'cancelled';
      return records.save('action_proposals', proposal);
    }
    if (command === 'proposal.refresh') {
      const old = records.get('action_proposals', str(a.id));
      if (old.status === 'executed' || old.status === 'cancelled')
        throw new Error('已执行或取消的任务不能刷新');
      const next = chat.propose(
        old.conversationId,
        old.turnId,
        typeof a.profileId === 'string' ? a.profileId : old.profileId,
        { ...old, ...(a.proposal && typeof a.proposal === 'object' ? a.proposal : {}) }
      );
      old.status = 'cancelled';
      records.save('action_proposals', old);
      return next;
    }
    if (command === 'proposal.confirm') {
      const proposal = records.get('action_proposals', str(a.id));
      if (proposal.status === 'executed' && proposal.version === a.version)
        return { kind: proposal.kind, id: proposal.executionId, alreadyExecuted: true };
      idle();
      chat.verify(proposal, str(a.version));
      if (proposal.resumeRunId) {
        let current = s.db.run(proposal.resumeRunId);
        if (current.accepted || current.planning || !['awaiting_review', 'needs_repair', 'paused', 'unknown', 'failed'].includes(current.status)) throw new Error('任务状态已变化，请重新讨论修复方案');
        if (retryNeedsConfirmation(current) && a.retryUnknown !== true) throw new Error('上次请求结果与费用未知，需明确选择重新请求');
        this.executor!.restore({ runId: current.id, executorId: current.executorId ?? 'legacy', executorVersion: current.executorVersion ?? '1', checkpointVersion: current.checkpointVersion ?? 1 });
        const newCandidate = needsNewChapterCandidate(current, p.config);
        if (!newCandidate && (current.rounds >= p.config.maxRounds || current.toolCount >= p.config.maxTools)) throw new Error('已达到当前任务调用上限，请先在运行设置中调整限额');
        const instruction = `${proposal.request}\n范围：${proposal.scope}`;
        records.transaction(() => {
          if (newCandidate) current = this.rebuildRun(current, proposal.profileId, instruction, true);
          else if (runner.needsFreshContext(current) || upgradesVolumeNaming(current, instruction)) {
            current = this.rebuildRun(current, proposal.profileId, instruction);
            prepareAuthorRevision(current, '');
          } else prepareAuthorRevision(current, instruction);
          s.db.saveRun(current);
          proposal.status = 'executed';
          proposal.executionId = current.id;
          records.save('action_proposals', proposal);
          this.operations.complete({ kind: proposal.kind, id: current.id });
        });
        this.launch(current, { kind: proposal.kind, id: current.id });
        return { kind: proposal.kind, id: current.id };
      }
      if (proposal.kind === 'draft') {
        const turn = chat.prepare(
          proposal.conversationId,
          `${proposal.goal}\n范围：${proposal.scope}\n${proposal.request}`,
          proposal.profileId,
          'draft',
          proposal.id,
          (prepared) => {
            proposal.status = 'executed';
            proposal.executionId = prepared.id;
            records.save('action_proposals', proposal);
            this.operations.complete({ kind: 'draft', id: prepared.id });
          }
        );
        void this.track(this.scheduler.run(turn.id, ['foreground'], 10, () => this.executor!.execute({ id: turn.id, kind: 'conversation' })));
        return { kind: 'draft', id: turn.id };
      }
      // Existing workflow guards remain the single authority for formal stage execution.
      if (p.finished && proposal.kind === 'stage') throw new Error('全书计划已完成');
      if (
        s.db
          .runs()
          .some(
            (r) => r.mode === 'stage' && !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status)
          )
      )
        throw new Error('已有阶段任务，请先审阅、恢复或放弃');
      const r = this.makeRun(
        proposal.kind,
        `${proposal.request}\n范围：${proposal.scope}`,
        proposal.profileId
      );
      r.conversationId = proposal.conversationId;
      records.transaction(() => {
        s.db.saveRun(r);
        proposal.status = 'executed';
        proposal.executionId = r.id;
        records.save('action_proposals', proposal);
        this.operations.complete({ kind: proposal.kind, id: r.id });
      });
      this.launch(r, { kind: proposal.kind, id: r.id });
      return { kind: proposal.kind, id: r.id };
    }
    if (command === 'draft.list') return records.all('draft_artifacts');
    if (command === 'draft.read')
      return records.readDraft(str(a.id), typeof a.hash === 'string' ? a.hash : undefined);
    if (command === 'draft.save')
      return records.saveDraft(
        z
          .object({
            id: z.string().optional(),
            title: z.string().min(1).max(80),
            content: z.string().min(1).max(2_000_000),
            baseHash: z.string().optional(),
            conversationId: z.string(),
            messageId: z.string()
          })
          .parse(a)
      );
    if (command === 'draft.promote') {
      const draft = records.readDraft(str(a.id));
      if (draft.currentHash !== str(a.hash)) throw new Error('草稿已变化，请重新读取再建立转入任务');
      const card = chat.propose(draft.conversationId, '', str(a.profileId), {
        kind: a.kind === 'stage' ? 'stage' : 'revision',
        goal: `审阅并采用草稿《${draft.title}》`,
        scope: str(a.scope),
        request: `作者希望将以下未采纳草稿转为正式候选。草稿只作为待审材料，核对当前阶段、既有资料和下游影响，不得当作已发生事实。来源 ${draft.path} @ ${draft.currentHash}\n\n${draft.content}`,
        outputs: ['按范围生成正式候选及必要的影响说明']
      });
      card.sources.push({ path: draft.path, hash: draft.currentHash });
      records.save('action_proposals', card);
      return card;
    }
    if (command === 'run.revalidate') {
      idle();
      const r = s.db.run(str(a.id));
      if (r.accepted) throw new Error('已接受任务无需重查候选');
      if (a.reviewSaved === true) {
        if (!['unknown', 'paused', 'needs_repair', 'awaiting_review'].includes(r.status))
          throw new Error('当前任务不能恢复候选审阅');
        if (!r.changes.length) throw new Error('没有已保存的候选');
        if (r.permission?.status === 'pending' || (r.input && !r.input.answer))
          throw new Error('请先处理任务中待确认的问题');
        if (!compatibleRunBase(s, r))
          throw new Error('候选依据已变化，请重建上下文后继续');
        if (r.mode === 'stage' && (r.stage !== p.stage || r.chapter !== p.chapter))
          throw new Error('候选所属阶段已变化');
        if (
          (r.manifest && contextChanged(s, r.manifest)) ||
          candidateChangesForCurrentSettings(s, r).some((change) => fileHash(safePath(s.root, change.path)) !== change.baseHash)
        )
          throw new Error('候选依据或正式文件已变化，请先核对');
      }
      runner.check(r, p);
      if (a.reviewSaved === true) {
        r.savedCandidateReview = {
          at: now(),
          requestUnknown: retryNeedsConfirmation(r),
          error: r.savedCandidateReview?.error ?? r.error
        };
        r.error = undefined;
        // The local review does not complete the upstream request or settle its usage.
        s.db.set(`inflight:${r.id}`, false);
        s.db.event(r.id, 'saved-candidate-review', '已检查保存的候选，未调用模型；原请求结果及费用记录保留');
      }
      if (a.reviewSaved === true || ['awaiting_review', 'needs_repair'].includes(r.status))
        setRunStatus(r, r.issues.some((i) => i.severity === 'error') ? 'needs_repair' : 'awaiting_review');
      s.db.saveRun(r);
      return this.presentRun(r, true);
    }
    if (
      [
        'run.accept',
        'run.update',
        'project.configure',
        'project.repair',
        'project.backup',
        'cover.generate'
      ].includes(command) &&
      chat.controller
    )
      throw new Error('请先停止聊天任务，再修改正式资料或开始其他模型任务');
    if (command === 'cover.generate') idle();
    if (command === 'project.repair') {
      if (runner.controller) throw new Error('请先停止任务');
      const files = initialFiles(p, this.skillRoot, s.db.get<string>('premise') ?? ''),
        changes = Object.entries(files)
          .filter(([file]) => fileHash(safePath(s.root, file)) === null)
          .map(([path, content]) => ({ path, content, baseHash: null }) as Change);
      const at = changes.findIndex((c) => c.path === paths.index);
      if (at >= 0) changes.splice(at, 1);
      if (a.indexOnly === true) changes.length = 0;
      changes.push(
        this.change(
          paths.index,
          renderIndex(p, [
            ...new Set([
              ...s
                .scan()
                .filter((d) => d.status !== 'missing')
                .map((d) => d.path),
              ...changes.map((c) => c.path)
            ])
          ])
        )
      );
      if (a.preview === true) return changes.map((c) => c.path);
      const r = this.makeRun('import', '修复缺失模板与索引');
      r.changes = changes;
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'cover.list') {
      const folder = safePath(s.root, '10_封面');
      return fs.existsSync(folder)
        ? fs
            .readdirSync(folder)
            .filter((f) => f.endsWith('.json'))
            .map((f) => `10_封面/${f}`)
        : [];
    }
    if (command === 'cover.load') {
      const file = str(a.path);
      if (!/^10_封面\/[^/]+\.json$/.test(file)) throw new Error('非法封面配置路径');
      return JSON.parse(fs.readFileSync(safePath(s.root, file), 'utf8'));
    }
    if (command === 'diagnostics.export') {
      const report = {
        version: buildVersion,
        project: { title: p.title, revision: p.revision, stage: p.stage, chapter: p.chapter },
        runs: s.db
          .runs()
          .map((r) => ({ id: r.id, operationId: r.operationId, executorId: r.executorId ?? 'legacy', stateVersion: r.stateVersion, candidateFingerprint: r.proposalHash, stage: r.stage, status: r.status, usage: r.usage, hasError: !!r.error })),
        events: s.db.events().map(({ data, ...e }) => ({
          ...e,
          text: '内容已省略'
        })),
        issues: (s.db.get<unknown[]>('memoryIssues') ?? []).length,
        schemaVersion: Number(s.db.sql.prepare('PRAGMA user_version').get()!.user_version),
        projectSessionId: this.projectSessionId,
        scheduler: { running: this.scheduler.running, queued: this.scheduler.pending },
        operations: s.db.sql.prepare('SELECT id,kind FROM operation_receipts ORDER BY rowid DESC LIMIT 100').all(),
        attempts: s.db.sql.prepare(`SELECT id,run_id AS runId,status,
          json_extract(data,'$.purpose') AS purpose,json_extract(data,'$.usageState') AS usageState,
          json_extract(data,'$.requestHash') AS requestHash,json_extract(data,'$.createdAt') AS createdAt,
          json_extract(data,'$.completedAt') AS completedAt,json_extract(data,'$.failure.source') AS failureSource,
          json_extract(data,'$.failure.code') AS failureCode,json_extract(data,'$.failure.requestId') AS upstreamRequestId,
          json_extract(data,'$.failure.elapsedMs') AS elapsedMs
          FROM model_attempts ORDER BY rowid DESC LIMIT 100`).all(),
        commits: s.db.sql.prepare('SELECT * FROM candidate_commits ORDER BY rowid DESC LIMIT 100').all(),
        outbox: s.db.sql.prepare('SELECT id,status FROM materialization_outbox ORDER BY rowid DESC LIMIT 100').all()
      };
      let output = JSON.stringify(report, null, 2);
      for (const secret of [...this.profiles.map((profile) => profile.apiKey), this.assistant.searchKey, this.assistant.embeddingKey])
        if (secret) output = output.replaceAll(secret, '[密钥已隐藏]');
      return output;
    }
    if (command === 'cover.generate') {
      if (this.coverController) throw new Error('已有封面请求正在执行');
      const profile = this.profiles.find((x) => x.id === str(a.profileId));
      if (!profile) throw new Error('图像配置不存在');
      this.coverController = new AbortController();
      const requestId = id();
      s.db.event(
        requestId,
        'cover-request',
        `作者确认封面生成：${profile.name}，模型 ${profile.model}，配置版本 ${profile.version}`
      );
      try {
        const signal = this.coverController.signal;
        const result = await callExternal(s, { id: requestId, usage: { input: 0, output: 0, cost: 0, currency: profile.currency } }, 'cover-generation', {
          provider: 'images', model: profile.model, version: profile.version,
          identity: { id: profile.id, version: profile.version, baseUrl: profile.baseUrl, imageSize: profile.imageSize, imageQuality: profile.imageQuality },
          pricing: null, currency: profile.currency
        }, { prompt: str(a.prompt) }, null, signal, () => generateCover(profile, str(a.prompt), signal),
        () => ({ input: null, output: null, cost: null, currency: profile.currency }));
        s.db.event(requestId, 'cover-result', '图像已返回，等待作者保存；实际费用请核对服务商账单');
        return result;
      } catch (e) {
        s.db.event(requestId, 'cover-error', (e as Error).message);
        throw e;
      } finally {
        this.coverController = null;
      }
    }
    if (command === 'cover.cancel') {
      this.coverController?.abort();
      return true;
    }
    if (command === 'cover.save') return saveCover(s, str(a.dataUrl), a.metadata);
    if (command === 'project.scan') { s.scan(); return this.snapshot(); }
    if (command === 'narrative.read') return readNarrativeData(s, Number(a.chapter), typeof a.runId === 'string' ? a.runId : undefined, a.scope === 'book' ? 'book' : 'batch');
    if (command === 'document.read')
      return typeof a.hash === 'string'
        ? s.read(str(a.path), a.hash)
        : a.disk === true
          ? s.read(str(a.path))
          : s.readAccepted(str(a.path));
    if (command === 'document.history') return s.db.history(str(a.path));
    if (command === 'document.historyPage') return s.db.historyPage(str(a.path), typeof a.before === 'number' ? a.before : undefined, typeof a.watermark === 'number' ? a.watermark : undefined, typeof a.limit === 'number' ? a.limit : 100);
    if (command === 'document.save' || command === 'document.restore') {
      const relative = str(a.path);
      if (relative === contractPath) throw new Error('请在作品方案中修订契约；此文档是结构化记录的展示');
      if (relative === titlePath) throw new Error('请通过独立命名修改书名；此文档是正式命名记录的展示');
      safePath(s.root, relative);
      if (!relative.endsWith('.md')) throw new Error('请使用 Markdown 文档');
      if (runner.controller) throw new Error('运行期间请先停止任务再提出修订');
      const content =
        command === 'document.restore' ? s.read(relative, str(a.hash)).content : z.string().parse(a.content);
      const r = this.makeRun('manual', command === 'document.restore' ? '恢复历史版本' : '手动修改');
      r.changes = [{ path: relative, content, baseHash: z.string().nullable().parse(a.baseHash) }];
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'project.importAccept') {
      if (a.path === contractPath) throw new Error('契约外部改动不能直接接受，请在标签与策划中修订');
      if (a.path === titlePath) throw new Error('书名展示外部改动不能直接接受，请使用独立命名');
      const relative = str(a.path),
        read = s.read(relative);
      const r = this.makeRun('manual', '接受外部改稿');
      r.changes = [{ path: relative, content: read.content, baseHash: read.hash }];
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'project.configure') {
      if (runner.controller) throw new Error('请先停止任务再修改项目设置');
      if (s.read(paths.config).hash !== s.db.document(paths.config)?.hash)
        throw new Error('配置文件存在外部改动，请先比较并接受，不能用旧设置覆盖');
      const cfg = configSchema.parse(a.config);
      if (tagHash(cfg) === tagHash(p.config)) return this.snapshot();
      if (approvedCreation(p)?.knowledge.options.some(o => o.group === 'reading.main') && cfg.genre !== p.config.genre)
        throw new Error('本书题材由正式标签契约确定，请在标签与策划中修订主分类');
      validateExpressionSelection(this.skillRoot, cfg);
      const next = reconfigure(p, cfg);
      new ProjectCommitService(s).commit(
        [
          this.change(paths.config, updateConfigDocument(s.read(paths.config).content, next)),
          this.change(paths.progress, renderProgress(next))
        ],
        next
      );
      for (const run of s.db.runs()) runner.recoverReadyCandidate(run, next, 'settings');
      return this.snapshot();
    }
    if (command === 'run.start') {
      if (p.finished && a.mode !== 'revision') throw new Error('当前全书计划已完成');
      if (a.mode !== 'revision' && this.needsMemoryRepair(str(a.request), typeof a.profileId === 'string' ? a.profileId : undefined))
        return this.startMemoryRepair(typeof a.profileId === 'string' ? a.profileId : undefined);
      if (
        s.db
          .runs()
          .some(
            (r) => r.mode === 'stage' && !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status)
          )
      )
        throw new Error('已有阶段任务，请继续、审阅或放弃后再开始');
      const r = this.makeRun(
        a.mode === 'revision' ? 'revision' : 'stage',
        str(a.request),
        typeof a.profileId === 'string' ? a.profileId : undefined
      );
      return this.launch(r);
    }
    if (command === 'run.cancel' || command === 'terminal.cancel') {
      const active = s.db.runs().find((run) => run.status === 'running');
      if (active) this.executor!.requestControl(active.id, 'cancel');
      else runner.stop();
      return true;
    }
    if (command === 'run.recover') {
      if (runner.controller || this.chat?.controller || this.coverController) throw new Error('请先停止当前任务');
      let r = s.db.run(str(a.id));
      this.executor!.restore({ runId: r.id, executorId: r.executorId ?? 'legacy', executorVersion: r.executorVersion ?? '1', checkpointVersion: r.checkpointVersion ?? 1 });
      if (r.accepted || !['paused', 'unknown', 'needs_repair', 'awaiting_review', 'failed', 'stale'].includes(r.status)) throw new Error('当前任务不需要恢复，请处理当前待确认事项');
      const decision = recoveryDecision(r);
      if (decision.confirmation && a.retryUnknown !== true) throw new ApplicationError('REMOTE_RESULT_UNKNOWN', '上次请求结果与费用未知，核对后确认才能重新请求', ['authorize_attempt']);
      if (decision.kind === 'inspect' || decision.kind === 'author') throw new ApplicationError(decision.code, decision.detail, ['refresh']);
      const instruction = typeof a.instruction === 'string' ? a.instruction.trim() : '';
      if (r.planning && instruction) throw new ApplicationError('VALIDATION_ERROR', '修改策划想法请使用方案页；恢复任务继续当前已确认的输入');
      if (!instruction && runner.recoverReadyCandidate(r, p, 'continue')) return r.id;
      // Completing an old direction-review checkpoint needs no model/tool call.
      // The executor still validates the saved report and current source binding.
      if (!hasSavedDirectionCheckpoint(r)) {
        if (r.rounds >= p.config.maxRounds) throw new ApplicationError('ROUND_LIMIT', '已达到模型调用上限，请在运行配置中提高上限后恢复');
        if (r.toolCount >= p.config.maxTools) throw new ApplicationError('TOOL_LIMIT', '已达到工具调用上限，请在运行配置中提高上限后恢复');
      }
      const profileId = typeof a.profileId === 'string' && a.profileId ? a.profileId : r.profileId;
      if (profileId !== r.profileId || runner.needsFreshContext(r) || upgradesVolumeNaming(r, instruction)) {
        r = this.rebuildRun(r, profileId, instruction);
        if (instruction) prepareAuthorRevision(r, '');
      }
      else if (instruction) prepareAuthorRevision(r, instruction);
      runner.check(r, p);
      if (!instruction) prepareRunRecovery(r);
      s.db.event(r.id, 'recovery-requested', '已检查恢复条件，将沿用已保存内容继续当前步骤', { code: decision.code, profileId, repairPaths: r.repairScope?.paths ?? [], confirmedUnknown: decision.confirmation });
      s.db.saveRun(r);
      return this.launch(r);
    }
    if (command === 'run.handoff') {
      if (runner.controller) throw new Error('请先停止任务');
      const old = s.db.run(str(a.id));
      if (old.accepted || old.status === 'discarded') throw new Error('此任务不能交接');
      if (retryNeedsConfirmation(old) && a.retryUnknown !== true)
        throw new Error('上次请求结果未知，须先核对收费请求');
      const r = this.rebuildRun(old, str(a.profileId), typeof a.instruction === 'string' ? a.instruction : '');
      return this.launch(r);
    }
    if (command === 'run.resume' || command === 'run.answer' || command === 'run.permission') {
      const r = s.db.run(str(a.id));
      this.executor!.restore({ runId: r.id, executorId: r.executorId ?? 'legacy', executorVersion: r.executorVersion ?? '1', checkpointVersion: r.checkpointVersion ?? 1 });
      if (r.accepted || r.status === 'discarded') throw new Error('此任务不能恢复');
      if (retryNeedsConfirmation(r) && a.retryUnknown !== true)
        throw new Error('上次请求结果与费用未知，需明确选择重新请求');
      if (r.planning && typeof a.instruction === 'string' && a.instruction.trim())
        throw new Error('策划输入变更请在标签与策划中保存，或使用方向局部重做；恢复只继续已绑定的输入');
      if (command === 'run.resume') {
        if (!['paused', 'unknown', 'needs_repair', 'awaiting_review', 'failed', 'stale'].includes(r.status)) throw new Error('请先处理当前待回答或待授权的事项');
        if (!String(a.instruction ?? '').trim() && runner.recoverReadyCandidate(r, p, 'continue')) return r.id;
        if (runner.needsFreshContext(r) || upgradesVolumeNaming(r, String(a.instruction ?? '')))
          return this.launch(this.rebuildRun(r, r.profileId, typeof a.instruction === 'string' ? a.instruction : ''));
      }
      if (command === 'run.answer') {
        if (!r.input) throw new Error('任务没有待回答问题');
        r.input.answer = str(a.answer);
        if (runner.needsFreshContext(r)) {
          s.db.saveRun(r);
          return this.launch(this.rebuildRun(r, r.profileId, `作者已回答待确认问题：${r.input.question}\n回答：${r.input.answer}`));
        }
      }
      if (command === 'run.permission') {
        if (!r.permission) throw new Error('没有待批准动作');
        r.permission.status = a.approved === true ? 'approved' : 'denied';
        if (runner.needsFreshContext(r)) {
          s.db.saveRun(r);
          return this.launch(this.rebuildRun(r, r.profileId, `先前待确认动作：${JSON.stringify(r.permission)}。上下文已改变，不能直接执行旧动作；如仍需执行，提出当前具体动作重新确认。`));
        }
      }
      if (typeof a.instruction === 'string' && a.instruction.trim()) {
        if (r.messages.length) r.messages.push({ role: 'user', content: a.instruction });
        else r.request += `\n\n作者补充：${a.instruction}`;
        r.candidateWrites = {};
      }
      return this.launch(r);
    }
    if (command === 'run.discard') {
      const r = s.db.run(str(a.id));
      if (r.accepted || runner.controller) throw new Error('请先停止，已接受的版本请通过修订恢复');
      setRunStatus(r, 'discarded');
      s.db.saveRun(r);
      return true;
    }
    if (command === 'run.update') {
      const r = s.db.run(str(a.id));
      if (r.accepted || runner.controller) throw new Error('此时不能修改候选');
      if (r.planning) throw new Error('结构化策划候选需在标签与策划中修改输入后重新审核');
      const at = r.changes.findIndex((c) => c.path === str(a.path));
      if (at < 0) throw new Error('候选不存在');
      r.changes[at].content = z.string().parse(a.content);
      if (r.pipeline && r.changes[at].path === prosePath(r.chapter)) {
        const previousProseHash = r.pipeline.proseHash;
        const previousRepairAttempts = structuredClone(r.repairAttempts);
        runner.telemetry.invalidate(r.id);
        r.pipeline.phase = 'review';
        r.pipeline.proseHash = hash(r.changes[at].content);
        r.pipeline.version++;
        r.sourceProseHash = r.pipeline.proseHash;
        r.messages = [];
        r.facts = [];
        r.candidateWrites = {};
        r.repairScope = undefined;
        r.memoryReview = undefined;
        r.memoryCompletionHash = undefined;
        r.futurePlanReview = undefined;
        r.proseReviewFeedback = undefined;
        // The author supplied a new prose version, so old per-version repair
        // scopes/receipts no longer apply. Task-wide rounds, tools and usage stay.
        for (const phase of ['prose', 'review', 'memory']) if (r.repairAttempts) delete r.repairAttempts[phase];
        r.changes = [r.changes[at]];
        s.db.event(r.id, 'candidate-prose-edited', '作者修改正文候选；旧审核与章后证据失效，保留累计轮数、工具数及用量，重新审核当前稿。', {
          previousProseHash, proseHash: r.pipeline.proseHash, previousRepairAttempts,
          rounds: r.rounds, toolCount: r.toolCount
        });
      }
      runner.check(r, p);
      setRunStatus(r, r.issues.some((i) => i.severity === 'error') ? 'needs_repair' : 'awaiting_review');
      s.db.saveRun(r);
      return this.presentRun(r, true);
    }
    if (command === 'run.accept') {
      if (runner.controller) throw new Error('任务还在运行');
      const r = s.db.run(str(a.id));
      if (r.naming) throw new Error('请在独立命名中选择已审核书名；命名不推进创作阶段');
      if (r.accepted) {
        if (a.title !== undefined && String(a.title).trim() !== p.title)
          throw new Error('此方向已经确认书名，请刷新查看已保存的结果');
        if (a.proposalHash !== undefined && a.proposalHash !== proposalHash(r))
          throw new Error('提交编号与候选内容不匹配');
        return { alreadyAccepted: true };
      }
      if (str(a.proposalHash) !== proposalHash(r)) throw new Error('候选内容已改变，请重新打开审阅');
      runner.recoverReadyCandidate(r, p, 'accept');
      if (!compatibleRunBase(s, r))
        throw new Error('生成候选后，作品内容或创作要求已改变。候选已保留，请点击“继续当前任务”核对新资料后再采纳。');
      if (!['awaiting_review', 'needs_repair'].includes(r.status))
        throw new Error('请先完成任务并进入候选审阅');
      if (r.agentRulesHash) assertControllerRules(this.skillRoot, r.agentRulesHash);
      if (r.planning) planningBinding(s, r);
      if ((p.tagEnabled || p.creationWorkflow === 2) && r.stage === 'S01' && r.mode === 'stage' && !r.planning)
        throw new Error('请先完成标签策划与契约审核');
      if ((r.manifest && contextChanged(s, r.manifest)))
        throw new Error('候选所依赖的资料已被外部修改；请先核对资料并重新建立任务，旧批准不能沿用');
      if (r.mode === 'stage' && (p.stage !== r.stage || p.chapter !== r.chapter))
        throw new Error('阶段已经改变');
      const confirmsTitle = p.titlePending === true && r.mode === 'stage' && r.stage === 'S01';
      let confirmedTitle: string | undefined;
      const unified = r.planning?.workflowVersion === 2;
      if (unified) {
        assertPlanApproval(r);
        const selection = r.planning!.titleSelection;
        if (confirmsTitle && !selection) throw new Error('请在方案确认后独立生成或核对书名，再统一采纳');
        if (selection) { assertTitleSelection(s, selection, r.id, this.skillRoot); confirmedTitle = selection.candidate.title; }
        if (a.title !== undefined && a.title !== confirmedTitle) throw new Error('请通过独立命名核对并选择书名');
      } else if (confirmsTitle) {
        confirmedTitle = typeof a.title === 'string' ? a.title.trim() : '';
        if (!confirmedTitle) throw new Error('故事方向确认后，请填写书名再保存本阶段');
        if (/[<>:"/\\|?*\x00-\x1f]/.test(confirmedTitle) || /[. ]$/.test(confirmedTitle) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(confirmedTitle))
          throw new Error('书名包含无效字符或 Windows 保留名称');
      } else if (a.title !== undefined && String(a.title).trim() !== p.title) {
        throw new Error('只能在首次确认故事方向时确定书名');
      }
      runner.check(r, p);
      if (r.issues.some((i) => i.severity === 'error')) {
        s.db.saveRun(r);
        throw new Error('候选存在阻断问题，请先修改');
      }
      if (r.status === 'needs_repair') {
        setRunStatus(r, 'awaiting_review');
        s.db.saveRun(r);
      }
      if (!r.changes.length) throw new Error('没有可接受的候选文件');
      if (a.warningReason) s.db.event(r.id, 'warning-review', String(a.warningReason));
      let next = r.mode === 'stage' ? advance(p, r.id) : structuredClone(p);
      if (r.pipeline) next = advance(next, r.id);
      next.revision++;
      let changes = candidateChangesForCurrentSettings(s, r);
      // S02's reviewed creative settings must also become the settings shown by
      // the client. Otherwise saving a later budget change restores the old
      // constraints/style over the accepted configuration document.
      const creativeConfig = r.mode === 'stage' && r.stage === 'S02'
        ? changes.find(change => change.path === paths.config)
        : undefined;
      if (creativeConfig) {
        const reviewed = parseConfig(creativeConfig.content, p.config);
        for (const key of ['pov', 'genre', 'style', 'constraints'] as const)
          next.config[key] = reviewed[key];
      }
      const substantiveChanges = changes.filter(change => {
        const previous = s.db.document(change.path)?.hash;
        return !previous || !sameStoryText(s.object(previous).toString('utf8'), change.content);
      }).map(change => change.path);
      if (r.planning) {
        const creation = approveTags(r, approvedCreation(p), str(a.proposalHash), r.planning.origin === 'new' ? 1 : nextUnwrittenChapter(p));
        if (unified) {
          next.creation = creation;
          delete next.tags;
          next.creationWorkflow = 2;
          next.schemaVersion = 3;
        } else { next.tags = creation; next.schemaVersion = 2; }
        next.tagEnabled = selectedIds(r.planning.spec).length > 0;
        next.config.genre = r.planning.knowledge.options.find((o) => o.group === 'reading.main')?.label ?? next.config.genre;
        const configured = updateConfigDocument(s.readAccepted(paths.config).content, next);
        if (changes.find((c) => c.path === paths.config)?.content !== configured)
          throw new Error('项目配置候选与标签主分类映射不一致，请重新生成契约');
      }
      if (confirmedTitle) {
        next.title = confirmedTitle;
        next.titlePending = false;
        if (r.planning?.titleSelection) {
          next.titleBinding = { ...structuredClone(r.planning.titleSelection), needsReview: false };
          next.titleReviewRequired = false;
          changes.push(this.change(titlePath, renderTitle(next.titleBinding)));
        }
        const configChange = changes.find(change => change.path === paths.config);
        const content = updateConfigDocument(configChange?.content ?? s.readAccepted(paths.config).content, next);
        if (configChange) configChange.content = content;
        else changes.push(this.change(paths.config, content));
      }
      // Merge authoritative evidence records even when a model replaces a whole human-readable ledger.
      let facts = s.db.facts().map((f) => structuredClone(f));
      const rebasedFiles = new Set<string>();
      for (const fact of facts) {
        if (fact.reviewStatus !== 'accepted') continue;
        for (const evidence of fact.evidence) {
          const change = changes.find(change => change.path === evidence.path);
          if (!change || evidence.hash !== s.db.document(evidence.path)?.hash || substantiveChanges.includes(evidence.path)) continue;
          const offset = change.content.indexOf(evidence.quote);
          if (offset < 0 || change.content.indexOf(evidence.quote, offset + 1) >= 0) continue;
          evidence.hash = hash(change.content);
          evidence.start = Array.from(change.content.slice(0, offset)).length;
          evidence.end = evidence.start + Array.from(evidence.quote).length;
          rebasedFiles.add(primaryPath(fact));
        }
      }
      if (r.mode === 'manual')
        for (const change of changes.filter((c) => c.path.startsWith('04_'))) {
          const old = facts.filter((f) => primaryPath(f) === change.path);
          const supplied = decodeFacts(change.content);
          if (old.length && !change.content.includes('<!-- wenxu-facts:v1 -->'))
            throw new Error('此文档含结构化记忆，请保留事实记录并显式修订或撤回，不能静默删除');
          for (const fact of supplied)
            if (fact.reviewStatus === 'accepted') {
              const issues = validateEvidence(s, fact, p.chapter);
              if (issues.length) throw new Error(issues.join('；'));
            }
          facts = [...facts.filter((f) => primaryPath(f) !== change.path), ...supplied];
        }
      for (const raw of r.facts) {
        const f = { ...raw, reviewStatus: 'accepted' as const, acceptedAt: now(), acceptedRunId: r.id };
        const errors = validateEvidence(s, f, p.chapter, r.pipeline || r.mode === 'revision' ? r.changes : [], r.memoryRepair?.paths);
        if (errors.length) throw new Error(errors.join('；'));
        if (facts.some((x) => x.id === f.id))
          throw new Error(`记忆编号已存在，请新建编号并引用 supersedes：${f.id}`);
        if (f.supersedes) {
          const old = facts.find((x) => x.id === f.supersedes);
          if (!old) throw new Error('被替代记忆不存在');
          if (!f.replacementReason) throw new Error('替代既有事实必须说明依据和原因');
          old.state = 'superseded';
          if (f.fromChapter <= old.fromChapter) {
            old.reviewStatus = 'retracted';
            old.toChapter = old.fromChapter;
          } else old.toChapter = f.fromChapter - 1;
        }
        facts.push(f);
      }
      for (const retirement of r.factRetractions ?? []) {
        if (!r.memoryRepair) throw new Error('撤回事实必须经过记忆同步核对');
        const fact = facts.find(fact => fact.id === retirement.id);
        if (!fact || !retirement.reason.trim()) throw new Error('撤回记录缺少有效依据');
        fact.reviewStatus = 'retracted';
        fact.state = 'superseded';
        fact.replacementReason = retirement.reason;
        fact.acceptedAt = now();
        fact.acceptedRunId = r.id;
      }
      const factFiles = new Set([
        ...facts.map(primaryPath),
        ...changes.filter((c) => c.path.startsWith('04_')).map((c) => c.path)
      ]);
      for (const relative of factFiles) {
        const fileFacts = facts.filter((f) => primaryPath(f) === relative);
        const c = changes.find((c) => c.path === relative);
        if (c) c.content = encodeFacts(c.content, fileFacts);
        else if (
          rebasedFiles.has(relative) || (r.factRetractions ?? []).some(item => facts.some(fact => fact.id === item.id && primaryPath(fact) === relative)) || r.facts.some(
            (f) =>
              primaryPath(f) === relative ||
              (f.supersedes && facts.find((x) => x.id === f.supersedes && primaryPath(x) === relative))
          )
        )
          changes.push(this.change(relative, encodeFacts(s.read(relative).content, fileFacts)));
      }
      if (r.mode === 'stage' && (r.stage === 'S11' || r.pipeline) && p.chapter === activeBatch(p).end) {
        const batch = activeBatch(p),
          behavior = changes.find((c) => c.path === paths.behavior)!,
          summary = changes.find((c) => c.path === paths.summary)!;
        const sources = Array.from({ length: batch.end - batch.start + 1 }, (_, i) => {
          const file = prosePath(batch.start + i);
          return {
            path: file,
            hash: changes.find((c) => c.path === file)
              ? hash(changes.find((c) => c.path === file)!.content)
              : (s.db.document(file)?.hash ?? null)
          };
        });
        summary.content += `\n\n## 摘要覆盖回执\n\n- 来源：${sources.map((v) => `${v.path} @ ${v.hash}`).join('；')}\n- 未解决事项：${
          facts
            .filter((f) => f.mandatory && f.state === 'active')
            .map((f) => f.id)
            .join('、') || '无已登记事项'
        }\n- 重要遗漏：摘要可能省略细节；须经作者语义审阅，完整行为日志与原文保留。\n`;
        changes.push(this.change(archivePath(batch), encodeFacts(behavior.content, [])));
        behavior.content = encodeFacts(
          `# 情绪与行为记忆\n\n## 下一批起点\n\n${summary.content}\n`,
          facts.filter((f) => primaryPath(f) === paths.behavior)
        );
      }
      const storyStates = changedStoryStates(s.db.facts(), facts);
      if (r.memoryRepair) {
        if (r.memoryRepair.completed.some(item => s.db.document(item.path)?.hash !== item.hash))
          throw new Error('核对期间原文版本改变，请重新同步');
        next.stale = next.stale.filter(file => !r.memoryRepair!.paths.includes(file));
        resolveStoryImpacts(next, r.memoryRepair.paths);
        for (const chapter of Object.keys(next.chapterStatesBeforeReview ?? {}))
          if (r.memoryRepair.paths.includes(prosePath(Number(chapter)))) {
            next.chapters[chapter] = next.chapterStatesBeforeReview![chapter];
            delete next.chapterStatesBeforeReview![chapter];
          }
        finishImpactReview(next);
      } else if (r.continuity?.mode === 'forward' || r.continuity?.mode === 'extraction' ||
        r.mode === 'stage' && (r.stage === 'S11' || r.pipeline) && storyStates.length && !next.finished) {
        const fromChapter = r.continuity?.mode === 'forward' ? r.continuity.fromChapter : nextUnwrittenChapter(next);
        const changed = changes.filter(change => !s.db.document(change.path)?.hash ||
          !sameStoryText(s.readAccepted(change.path).content, change.content));
        const aligned = r.mode === 'stage' && (r.stage === 'S11' || r.pipeline) ? confirmedAlignedPlans(s, r) : new Set<string>();
        const targets = futurePlanTargets(s, fromChapter, changed.map(change => change.path), storyStates,
          changed.map(change => change.path), initialFiles(p, this.skillRoot, '')).filter(target => !aligned.has(target.path));
        if (aligned.size) s.db.event(r.id, 'future-plans-aligned', '独立核对确认以下后续计划仍可执行，无需重复生成', { paths: [...aligned], fingerprint: r.futurePlanReview?.fingerprint });
        resolveStoryImpacts(next, changed.map(change => change.path));
        next.stale = next.stale.filter(file => !changed.some(change => change.path === file));
        if (targets.length && (changed.length || storyStates.length)) {
          const impact = makeStoryImpact(next, r, changed, storyStates, targets, { mode: 'forward', fromChapter });
          (next.storyImpacts ??= []).push(impact);
          next.stale = [...new Set([...next.stale, ...targets.map(target => target.path)])];
          const record = `\n\n## ${now()} 后续计划待同步\n\n- 生效范围：第 ${fromChapter} 章起；已有正文保持不变\n- 来源任务：${r.id}\n- 起因：${r.request}\n${storyStates.map(state => `- ${state.subject} · ${state.predicate}：${state.before ?? '尚无记录'} → ${state.after}`).join('\n')}\n- 待核对：${targets.map(target => target.path).join('、')}\n`;
          const current = changes.find(change => change.path === paths.impact)?.content ?? s.readAccepted(paths.impact).content;
          changes = changes.filter(change => change.path !== paths.impact);
          changes.push(this.change(paths.impact, current + record));
        }
      } else if (unified && r.planning!.origin !== 'new') {
        const delta = tagImpact(s, r.planning!);
        const changed = changes.map(v => v.path);
        const fromChapter = nextUnwrittenChapter(next);
        const placeholders = initialFiles(p, this.skillRoot, '');
        const targets = delta.planChanged || delta.authorChanged || delta.changedConstraintIds.length || delta.changedOptionIds.length
          ? futurePlanTargets(s, fromChapter, [contractPath], [], changed, placeholders) : [];
        for (const doc of s.db.acceptedDocuments().filter(d => /^(03_|04_)/.test(d.path) || d.path.startsWith('11_') && /书名|简介|开篇|包装/.test(d.path))) {
          if (changed.includes(doc.path) || targets.some(v => v.path === doc.path) || s.readAccepted(doc.path).content === placeholders[doc.path]) continue;
          if (delta.planChanged || delta.authorChanged || delta.changedConstraintIds.length || delta.changedOptionIds.length)
            targets.push({ path: doc.path, reason: '作品方案或创作边界改变，需对照新契约核对；已有正文保持不变', via: [contractPath] });
        }
        if (!confirmedTitle && (delta.planChanged || delta.authorChanged || delta.changedConstraintIds.length)) {
          next.titleReviewRequired = true;
          if (next.titleBinding) {
            next.titleBinding.needsReview = true;
            next.titleBinding.reason = '作品方案或约束已改变，请重新核对书名承诺';
            changes.push(this.change(titlePath, renderTitle(next.titleBinding)));
          }
        }
        resolveStoryImpacts(next, changed);
        next.stale = [...new Set([...next.stale.filter(file => !changed.includes(file)), ...targets.map(v => v.path)])];
        if (targets.length) {
          const impact = makeStoryImpact(next, r, changes, [], targets, { mode: 'forward', fromChapter });
          impact.creationChange = { changedClaimIds: delta.changedClaimIds, changedConstraintIds: delta.changedConstraintIds };
          (next.storyImpacts ??= []).push(impact);
        }
        const record = `\n\n## ${now()} 作品方案变更\n\n- 来源任务：${r.id}\n- 变化条目：${delta.changedClaimIds.join('、') || '无'}\n- 后续生效：第 ${fromChapter} 章起；保留当前阶段、写作位置与已有正文\n- 待核对：${targets.map(v => v.path).join('、') || '无'}\n- 书名：${next.titleReviewRequired ? '需在独立命名中核对' : '已核对'}\n`;
        changes.push(this.change(paths.impact, s.readAccepted(paths.impact).content + record));
      } else if (r.mode !== 'stage' && r.mode !== 'analysis' && substantiveChanges.length) {
        const changed = substantiveChanges,
          earliest = Math.min(...changed.map((f) => Number(f.match(/^07_.*第(\d+)章/)?.[1] ?? Infinity)));
        const placeholders = initialFiles(p, this.skillRoot, '');
        const affected = s.db
          .acceptedDocuments()
          .map((d) => d.path)
          .filter(
            (f) =>
              !changed.includes(f) &&
              (!placeholders[f] || s.read(f).content !== placeholders[f]) &&
              !['00_', '09_'].some((v) => f.startsWith(v)) &&
              f !== paths.index &&
              (Number.isFinite(earliest)
                ? f.startsWith('04_') ||
                  f.startsWith('05_') ||
                  f.startsWith('06_') ||
                  f.startsWith('08_') ||
                  (f.startsWith('07_') && Number(f.match(/第(\d+)章/)?.[1]) > earliest)
                : f.startsWith('04_') ||
                  f.startsWith('05_') ||
                  f.startsWith('06_') ||
                  f.startsWith('07_') ||
                  f.startsWith('08_'))
          );
        if (r.planning)
          affected.push(
            ...tagImpact(s, r.planning)
              .affected.map((d) => d.path)
              .filter(
                (f) =>
                  !changed.includes(f) &&
                  !affected.includes(f) &&
                  (!placeholders[f] || s.readAccepted(f).content !== placeholders[f])
              )
          );
        next.stale = [...new Set([...p.stale.filter((f) => !changed.includes(f)), ...affected])];
        resolveStoryImpacts(next, changed);
        if (affected.length) (next.storyImpacts ??= []).push(makeStoryImpact(next, r,
          changes.filter(change => changed.includes(change.path)), storyStates,
          affected.map(file => ({ path: file, reason: '既有设定或正文发生修订，需核对关联影响', via: changed })),
          r.continuity ?? { mode: 'retcon', fromChapter: Number.isFinite(earliest) ? earliest : 1 }));
        for (const n of Object.keys(next.chapters))
          if (!Number.isFinite(earliest) || Number(n) >= earliest) {
            const state = next.chapters[n];
            if (state !== 'stale') (next.chapterStatesBeforeReview ??= {})[n] = state;
            next.chapters[n] = 'stale';
          }
        finishImpactReview(next);
        const record = `\n\n## ${now()} ${r.request}\n\n- 起因：${r.request}\n- 修改章节或规则：${changed.join('、')}\n- 旧事实：以本次基础版本原文为准；${changes.map((c) => `${c.path} @ ${c.baseHash ?? '新文件'}`).join('；')}\n- 新事实：见本次已接受候选；来源任务 ${r.id}\n- 影响起点：${Number.isFinite(earliest) ? `第${earliest}章` : '涉及设定与后续资料'}\n- 已检查文件：${changed.join('、')}\n- 已同步文件：${changed.join('、')}\n- 无需修改及原因：待逐项核对后填写\n- 待核对：${next.stale.join('、') || '无'}\n- 状态：${next.stale.length ? '处理中' : '已闭环'}\n`;
        changes = changes.filter((c) => c.path !== paths.impact);
        changes.push(this.change(paths.impact, s.read(paths.impact).content + record));
      }
      const all = [
        ...new Set([...s.db.acceptedDocuments().map((d) => d.path), ...changes.map((c) => c.path)])
      ];
      changes = changes.filter((c) => c.path !== paths.progress && c.path !== paths.index);
      changes.push(
        this.change(paths.progress, renderProgress(next)),
        this.change(paths.index, renderIndex(next, all))
      );
      if (r.mode === 'stage' && (r.stage === 'S11' || r.pipeline)) {
        const statusFields = materializeAftermathStatus(changes, p);
        if (p.chapter < activeBatch(p).end) {
          const summary = changes.find(change => change.path === paths.summary);
          if (summary) summary.content = batchSummaryProgress(summary.content, p);
          else changes.push(this.change(paths.summary, batchSummaryProgress(s.readAccepted(paths.summary).content, p)));
        }
        s.db.event(r.id, 'aftermath-status-materialized', '本次批准事务将同步章后状态；故事内容和审核结论保持不变', { fields: statusFields });
      }
      r.accepted = true;
      setRunStatus(r, 'complete');
      r.updatedAt = now();
      new ProjectCommitService(s).commit(changes, next, r);
      this.recent = this.recent.map(item => samePath(item.root, next.root) ? { ...item, title: next.title } : item);
      rebuildMemory(s);
      syncEntities(s);
      for (const row of s.db.sql.prepare('SELECT id,data FROM assessments').all() as {
        id: string;
        data: string;
      }[]) {
        const value = JSON.parse(row.data) as Assessment;
        if (value.track === 'candidate' && value.draftId === r.id && value.hash === r.pipeline?.proseHash) {
          const accepted = { ...value, id: id(), track: 'accepted', snapshotId: s.db.get('headSnapshot') };
          s.db.sql.prepare('INSERT INTO assessments VALUES(?,?)').run(accepted.id, JSON.stringify(accepted));
        }
      }
      s.db.event(r.id, 'accepted', '作者接受结果，已提交正式文件');
      if (next.config.backupDirectory) {
        this.backingUp = true;
        try {
          await this.scheduler.run(id(), ['foreground', 'index', 'assessment', 'maintenance'], 20, () => createBackup(s, next.config.backupDirectory, this.managementController.signal));
        } catch (e) {
          s.db.event(r.id, 'backup-error', `正式文件已提交，但备份失败：${(e as Error).message}`);
        } finally {
          this.backingUp = false;
        }
      }
      const titleResult = confirmedTitle && confirmedTitle !== p.title ? { titleChanged: true } : {};
      if (a.startNext === true && (r.mode === 'stage' || r.memoryRepair) && !next.finished) {
        try {
          if (this.needsMemoryRepair(`完成 ${stageNames[next.stage]}。沿用已接受要求，开始前复核全部必读资料。`, next.config.stageProfiles[next.stage] || next.config.defaultProfileId || r.profileId))
            return { accepted: true, nextRun: this.startMemoryRepair(next.config.defaultProfileId || r.profileId), ...titleResult };
          const nextRun = this.makeRun(
              'stage',
              `完成 ${stageNames[next.stage]}。沿用已接受要求，开始前复核全部必读资料。`,
              next.config.stageProfiles[next.stage] || next.config.defaultProfileId || r.profileId
            );
          const result = { accepted: true, nextRun: nextRun.id, ...titleResult };
          this.launch(nextRun, result);
          return result;
        } catch (error) {
          const nextError = `本阶段已保存，下一阶段未能开始：${(error as Error).message}`;
          s.db.event(r.id, 'next-stage-error', nextError);
          return { accepted: true, nextError, ...titleResult };
        }
      }
      return { accepted: true, ...titleResult };
    }
    if (command === 'memory.search')
      return searchMemory(
        s,
        typeof a.query === 'string' ? a.query : '',
        typeof a.chapter === 'number' ? a.chapter : p.chapter
      );
    if (command === 'memory.rebuild') {
      idle();
      const result = rebuildMemory(s);
      if (result.issues.length || p.stale.length)
        return { ...result, runId: this.startMemoryRepair(typeof a.profileId === 'string' ? a.profileId : undefined, result) };
      return result;
    }
    if (command === 'context.preview') {
      const profile = this.profiles.find((x) => x.id === (a.profileId ?? p.config.defaultProfileId));
      if (!profile) throw new Error('先选择模型配置');
      return runner.previewContext(this.makeRun('stage', typeof a.request === 'string' ? a.request : '', profile.id), profile);
    }
    if (command === 'impact.review') {
      if (runner.controller) throw new Error('请先停止任务');
      const relative = str(a.path),
        reason = str(a.reason);
      if (!p.stale.includes(relative)) throw new Error('不在待核对范围内');
      if (fileHash(safePath(s.root, relative)) !== s.db.document(relative)?.hash)
        throw new Error('先处理外部改动');
      p.stale = p.stale.filter((f) => f !== relative);
      resolveStoryImpacts(p, [relative]);
      finishImpactReview(p);
      p.revision++;
      new ProjectCommitService(s).commit(
        [
          this.change(
            paths.impact,
            s.read(paths.impact).content + `\n- ${relative}：${reason}（作者核对，${now()}）\n`
          ),
          this.change(paths.progress, renderProgress(p))
        ],
        p
      );
      return true;
    }
    if (command === 'project.backup') {
      if (runner.controller) throw new Error('请先停止运行以建立一致备份');
      this.backingUp = true;
      try {
        return await this.scheduler.run(id(), ['foreground', 'index', 'assessment', 'maintenance'], 20, () => createBackup(s, str(a.directory ?? p.config.backupDirectory), this.managementController.signal));
      } finally {
        this.backingUp = false;
      }
    }
    if (command === 'project.importDocument')
      return this.scheduler.run(id(), ['document-import'], 5, () => this.importFile(str(a.file), this.managementController.signal));
    if (command === 'project.export') {
      const selected = [...new Set(z.array(z.string()).min(1).parse(a.paths))];
      const documents = selected
        .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
        .map((f) => {
          const d = s.db.document(f);
          if (!d?.hash) throw new Error('只能导出正式接受的版本');
          const current = s.inspect(f);
          if (current?.status !== 'accepted') throw new Error(`文件有未确认的外部变化，请先核对再导出：${f}`);
          return s.readAccepted(f);
        });
      const issues = checkPublication(p, documents);
      if (issues.length) throw new Error(`正式文稿尚未准备好：\n${issues.map(issue => `${issue.path}：${issue.message}`).join('\n')}`);
      const content = documents.map(doc => doc.path.startsWith('07_') ? doc.content : documentPreviewText(doc.content)).join('\n\n');
      return exportDocument(content, str(a.target));
    }
    throw new Error(`尚未实现命令：${command}`);
  }
}
