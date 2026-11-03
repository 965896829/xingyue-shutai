import fs from 'node:fs';
import { WritingStyleRecommender } from './writing-style';
import { writingStyleRequestSchema } from '../shared/writing-style';
import { proposalHash } from './storage';
import { readQuality, mutateQuality, qualityStatistics, blindPresentation, voiceDocument, voicePath } from './quality';
import { readWorldModel, renderWorldModel } from './world-model';
import { bindWorkflow } from './runtime/workflow-contract';
import { compileCreative, rehearsalCharacters } from './creative-context';
import { creativeOperations } from '../shared/creative';
import { designCatalog, designResource, assertDesign } from './design-operations';
import { runDesign } from './commands/design';
import { readExperience } from './experience';
import path from 'node:path';
import { z } from 'zod';
import { bindTaskScope } from './task-scope';
import { searchSettingsSchema } from '../shared/assistant';
import { brand } from '../shared/brand';
import { buildVersion } from '../shared/build';
import { commandContracts,isCommand,parseInput,parseOutput,type CommandOutput } from '../shared/contracts';
import { approvedCreation } from '../shared/creation';
import { ApplicationError } from '../shared/errors';
import { newProjectLocationError } from '../shared/project-location';
import { captureReasoning } from '../shared/reasoning';
import { recoveryDecision } from '../shared/recovery';
import { documentPreviewText,retryNeedsConfirmation } from '../shared/run-presentation';
import {
embeddingSettingsSchema,
memoryScopeSchema,
type Assessment,
type DraftIdentity,
type StudioState
} from '../shared/studio';
import { tagInputSchema,type BookSpec } from '../shared/tags';
import { needsNewChapterCandidate } from '../shared/task-revision';
import {
configSchema,
type AppEvent,
type Change,
type Command,
type ProjectState,
type Run,
type SecretProfile,
type Snapshot
} from '../shared/types';
import { nativeServerLimit,usesNativeSearch } from '../shared/web-search';
import { builtInRoles } from './assistant-settings';
import { adoptionCommands,handleAdoptionCommand } from './commands/adoption';
import { creationCommands,handleCreationCommand } from './commands/creation';
import { discussionCommands,handleDiscussionCommand } from './commands/discussion';
import { assertProjectVersion } from './compatibility';
import { compileContext,contextChanged } from './context-compiler';
import { ConversationRunner,type AssistantRuntime } from './conversation-runner';
import { generateCover,saveCover } from './cover';
import { CreationTimings } from './creation-timing';
import { createBackup,exportDocument,importDocument,restoreBackup } from './documents';
import {
activeBatch,
detailPath,
hash,
id,
newProject,
now,
paths,
prosePath,
reconfigure,
renderProgress,
updateConfigDocument
} from './domain';
import { CompatibleEmbeddings,SemanticIndex } from './embeddings';
import { expressionLibrary,validateExpressionSelection } from './expression-rules';
import { garbageCollectionPreview,verifyObjects } from './integrity';
import { checkPublication } from './manuscript-check';
import { readManuscriptView } from './manuscript-view';
import { exportReviewPage, importReviewFeedback } from './blind-review';
import { workbenchCommands, handleWorkbenchCommand } from './commands/workbench';
import { bindWorkbenchCandidate } from './workbench-candidates';
import { bookProfilePath, readBookProfile, renderBookProfile, resolveBookProfile, refreshPublishingCatalog, verifyPublishingSnapshot } from './publishing';
import { bookProfileSchema, type PublishingSnapshot } from '../shared/publishing';
import { storageFileName } from '../shared/file-names';
import { collectMarketEvidence, marketCacheKey } from './market-evidence';
import { marketRequestSchema, type MarketEvidence } from '../shared/market-evidence';
import { validateBookTitle } from './title-naming';
import {
rebuildMemory,
searchMemory
} from './memory';
import { memoryRepairScope,prepareMemoryRepair } from './memory-repair';
import { characterState,retrieveMemory,syncEntities,traceSource } from './memory-studio';
import { importLegacy,previewLegacy } from './migration';
import { readNarrativeData } from './narrative-curves';
import { nativeSearchSources } from './native-web-search';
import { ProjectWatcher } from './project-watcher';
import { ProseIndexer } from './prose-index';
import { invokeModel } from './provider';
import { ProjectRecycleBin,isRecyclePath,samePath } from './recycle-bin';
import { AgentRunner,type Caller } from './runner';
import { candidateChangesForCurrentSettings,compatibleRunBase,compatibleSettingsSnapshot } from './runtime-settings';
import { ProjectCommitService } from './runtime/commit-kernel';
import { ExecutionRecords } from './runtime/execution-records';
import { chooseExecutor } from './runtime/executor';
import { ExecutorRouter } from './runtime/executor-router';
import { authorizeUnknownAttempts,callExternal,callModel,estimatedUnits,recoverAttempts } from './runtime/model-gateway';
import { Operations } from './runtime/operations';
import { prepareAuthorRevision,prepareRunRecovery } from './runtime/run-recovery';
import { setRunStatus } from './runtime/run-state';
import { ResourceScheduler } from './runtime/scheduler';
import { piExecutorVersion } from './runtime/task-loop';
import { PublicSearch } from './search';
import { initialFiles,renderIndex } from './skill';
import { SkillRegistry,stageSkills } from './skill-registry';
import { FileStore,fileHash,safePath } from './storage';
import { nextUnwrittenChapter,resolveStoryImpacts } from './story-impact';
import { hasSavedDirectionCheckpoint,planningRulesHash } from './tag-planning';
import {
compileTags,
currentCreationDraft,
contractPath,
makeBookSpec,
makeCreationSpec,
planningBinding,
planningFingerprint,
tagBundle,
tagHash,
validateApprovedTags
} from './tags';
import { recoverUsage } from './telemetry';
import { namingBinding,namingRulesHash,titlePath } from './title-naming';
import { loadTitleStyleProfile } from './title-style';
import { upgradesVolumeNaming } from './volume-market-research';
import { revisedVolumeNaming } from './volume-naming';
import { chapterNamingStages, makeChapterNaming, upgradesChapterNaming } from './chapter-naming';
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
  draining = false;
  private jobs = new Set<Promise<unknown>>();
  private requests = new Set<Promise<unknown>>();
  readonly operations = new Operations();
  readonly scheduler = new ResourceScheduler();
  requestJournal: FileStore | null = null;
  readonly writingStyles = new WritingStyleRecommender();
  private publishingSnapshots: PublishingSnapshot[] = [];
  private marketSnapshots: Record<string, MarketEvidence> = {};
  tagCatalog() {
    const catalog = tagBundle(this.skillRoot).taxonomy;
    const cached = this.requestJournal?.db.get<PublishingSnapshot[]>('publishingCatalogs') ?? this.publishingSnapshots;
    const draft = this.store?.db.get<BookSpec>('tagDraft');
    const pinned = this.store?.db.document(bookProfilePath)?.hash ? readBookProfile(this.store).catalog : null;
    catalog.publishingSnapshots = [...new Map([
      ...(catalog.publishingSnapshots ?? []), ...cached, ...(draft?.publishingCatalog ? [draft.publishingCatalog] : []), ...(pinned ? [pinned] : [])
    ].map(c => [c.id, verifyPublishingSnapshot(c)])).values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    return catalog;
  }
  private creationTimings = new CreationTimings();
  private watcher: ProjectWatcher | null = null;
  managementController = new AbortController();
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
    roles: [],
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
    this.assistant.roles = builtInRoles(skillRoot);
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
  track<T>(promise: Promise<T>) {
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
    this.writingStyles.cancel();
    await this.runner?.telemetry.stop();
    await Promise.allSettled([...this.requests, ...this.jobs]);
    this.store?.materialize();
    this.close();
    this.requestJournal?.close();
    this.requestJournal = null;
  }
  private assertCanClose() {
    if (this.writingStyles.busy) throw new Error('请先停止风格推荐或等待结果');
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
    const tagDraft = store ? currentCreationDraft(store) : undefined;
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
      tagDraft,
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
          const head = store.db.headRef();
          if (!head) {
            if (!['failed', 'complete'].includes(r.status)) setRunStatus(r, 'stale');
            r.error = '任务缺少可核验的作品版本，候选已保留，请重新建立任务'; store.db.saveRun(r);
            continue;
          }
          r.baseSnapshotId = head.id;
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
      for (const run of store.db.runs()) {
        if (!run.accepted && run.status === 'awaiting_review' && run.planning?.phase === 'ready' &&
          !retryNeedsConfirmation(run) && !store.db.get(`inflight:${run.id}`)) {
          this.runner.check(run, p);
          store.db.saveRun(run);
        }
        this.runner.recoverReadyCandidate(run, p, 'restore');
      }
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
      ...(['manual', 'revision'].includes(mode) ? { revisionCoreRequired: 1 as const } : {}),
      baseSnapshotId: this.store!.db.get<string>('headSnapshot'),
      skillId: mode === 'revision' ? 'webnovel-revision-cascade' : stageSkills[p.stage],
      pipeline:
        mode === 'stage' && p.stage === 'S10'
          ? { phase: 'prose', epoch: id(), version: 0, previewCalls: 0, coverageVersion: 1 }
          : undefined,
      stage: p.stage,
      ...(mode === 'stage' && p.stage === 'S03' ? { worldContract: 2 as const } : {}),
      ...(mode === 'stage' && p.stage === 'S05' ? { volumeNaming: { version: 2 as const } } : {}),
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
    bindTaskScope(this.store!, run);
    if (mode === 'stage' && chapterNamingStages.includes(run.stage)) run.chapterNaming = makeChapterNaming(this.store!, run, request);
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
    const draft = currentCreationDraft(s);
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
      directionFormatVersion: draft.bookProfile ? 2 : 1,
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
    if (runner.controller || this.chat?.controller || this.coverController || this.writingStyles.busy)
      throw new Error('本书已有运行中的模型任务');
    r.workflowVersion ??= 1;
    bindWorkflow(r);
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
    if (old.workbench && old.workbench.snapshotId !== s.db.headRef()?.id) throw new Error('画布候选所属版本已变化，请回到共创画布重新建立候选');
    if (old.mode === 'stage' && (old.stage !== p.stage || old.chapter !== p.chapter)) throw new Error('作品已进入其他阶段，请从当前阶段继续，旧任务保留供查阅');
    const r = this.makeRun(old.mode, `${old.request}\n\n作者要求：${instruction || '继续当前任务'}\n按当前规则与正式资料重新核对已有候选后继续。候选尚未接受，不能据此跳过确认。之前错误：${old.error ?? '无'}。`, profileId);
    r.skillId = old.skillId;
    if (old.design) {
      assertDesign(s, old);
      r.design = structuredClone(old.design);
      r.design.promptHash = designResource(this.skillRoot, old.design.input.id).hash;
      r.stage = old.stage; r.chapter = old.chapter; r.batch = structuredClone(old.batch);
      bindTaskScope(this.store!, r);
      r.worldContract = old.worldContract; r.revisionCoreRequired = old.revisionCoreRequired;
    }
    r.volumeNaming = upgradesVolumeNaming(old, instruction)
      ? revisedVolumeNaming(old.volumeNaming, instruction, old.changes.find(change => change.path === paths.volumes)?.content ?? (s.db.document(paths.volumes)?.hash ? s.read(paths.volumes).content : undefined), old)
      : structuredClone(old.volumeNaming);
    r.chapterNaming = upgradesChapterNaming(old, instruction)
      ? makeChapterNaming(s, { ...r, facts: old.facts, factRetractions: old.factRetractions }, instruction, old.changes)
      : old.chapterNaming?.source ? makeChapterNaming(s, r) : structuredClone(old.chapterNaming);
    r.parentRunId = old.parentRunId ?? old.id;
    r.executionId = old.executionId;
    r.rounds = old.rounds;
    r.toolCount = old.toolCount;
    r.usage = structuredClone(old.usage);
    if (old.creative) {
      if (instruction.trim()) throw new Error('范围或输入变更请从创作工具建立新任务');
      r.creative = compileCreative(s, this.skillRoot, old.creative.input, r.id).binding;
      r.skillId = `creative:${old.creative.input.operation}`;
      r.tagBinding = undefined;
      return r;
    }
    r.steps = structuredClone(old.steps);
    r.repairAttempts = structuredClone(old.repairAttempts);
    r.repairScope = structuredClone(old.repairScope);
    r.proseReviewFeedback = structuredClone(old.proseReviewFeedback);
    r.proseIntent = old.proseIntent;
    r.networkRetries = old.networkRetries;
    r.candidateWrites = structuredClone(old.candidateWrites);
    r.documentDrafts = structuredClone(old.documentDrafts);
    r.changes = candidateChangesForCurrentSettings(s, old);
    r.facts = structuredClone(old.facts);
    r.factRetractions = structuredClone(old.factRetractions);
    r.continuity = structuredClone(old.continuity);
    r.workbench = structuredClone(old.workbench);
    if (old.revisionCore && !instruction.trim()) r.revisionCore = structuredClone(old.revisionCore);
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
  needsMemoryRepair(request: string, profileId?: string) {
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
      !['run.cancel', 'terminal.cancel', 'chat.stop', 'embedding.cancel', 'cover.cancel', 'style.cancel'].includes(command)
    )
      throw new Error('正在建立一致备份，请稍后再进行写入或切换项目');
    if (command === 'app.snapshot') return this.snapshot();
    if (command === 'style.cancel') { this.writingStyles.cancel(str(a.requestId)); return true; }
    if (command === 'style.recommend') {
      const input = writingStyleRequestSchema.parse(a);
      if (input.projectSessionId && (input.projectSessionId !== this.projectSessionId || !this.store)) throw new Error('作品已切换，请重新打开风格设置');
      if (this.runner?.controller || this.chat?.controller || this.coverController) throw new Error('请等当前任务结束，再推荐风格');
      const journal = input.projectSessionId ? this.store : this.requestJournal;
      if (!journal) throw new Error('请求账本未初始化');
      const profile = this.profiles.find(item => item.id === input.profileId && item.enabled && item.protocol !== 'images');
      if (!profile?.apiKey) throw new Error('请先选择并配置可用的创作模型');
      return this.writingStyles.recommend(journal, input, profile, this.tagCatalog(), this.caller ?? invokeModel,
        this.managementController.signal, input.projectSessionId ? this.store! : undefined);
    }
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
    if (command === 'tags.catalog') return this.tagCatalog();
    if (command === 'publishing.refresh') {
      const prior = this.tagCatalog().publishingSnapshots?.[0];
      if (!prior) throw new Error('未安装番茄分类目录');
      try {
        const catalog = await refreshPublishingCatalog(prior, this.managementController.signal);
        this.publishingSnapshots = [catalog, ...(this.tagCatalog().publishingSnapshots ?? []).filter(s => s.id !== catalog.id)].slice(0, 20);
        this.requestJournal?.db.set('publishingCatalogs', this.publishingSnapshots);
        return { updated: true, catalog, message: '已取得完整分类目录，作品仍保留原有选择。' };
      } catch (error) {
        return { updated: false, catalog: prior, message: `目录更新未完成，已保留原目录。${error instanceof Error ? error.message : '请稍后重试'}` };
      }
    }
    if (command === 'publishing.market') {
      const request = marketRequestSchema.parse(a), catalog = this.tagCatalog().publishingSnapshots?.find(c => c.id === request.catalogId);
      if (!catalog) throw new Error('分类目录已改变，请刷新');
      const cache = this.requestJournal?.db.get<Record<string, MarketEvidence>>('marketSnapshots') ?? this.marketSnapshots;
      const key = marketCacheKey(request), result = await collectMarketEvidence(request, catalog, this.managementController.signal, { cached: cache[key] });
      if (['ready', 'partial'].includes(result.status) && result.samples.some(s => s.title)) {
        const entries = Object.entries({ ...cache, [key]: result }).sort((a, b) => b[1].observedAt.localeCompare(a[1].observedAt)).slice(0, 40);
        this.marketSnapshots = Object.fromEntries(entries); this.requestJournal?.db.set('marketSnapshots', this.marketSnapshots);
      }
      return result;
    }
    if (command === 'publishing.read') return readBookProfile(this.require().s);
    if (command === 'titles.styleProfile') return loadTitleStyleProfile(this.skillRoot);
    if (command === 'tags.validate') {
      const input = tagInputSchema.parse(a.input);
      return compileTags(
        makeBookSpec(
          { id: 'preview', config: configSchema.parse({}) } as ProjectState,
          input,
          0,
          this.tagCatalog()
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
    if (command === 'skills.list') {
      const registry = new SkillRegistry(this.skillRoot);
      return registry.entries.map(entry => registry.get(entry.id));
    }
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
          bookProfile: bookProfileSchema.optional(),
          config: configSchema.optional()
        })
        .parse(a);
      if (args.tagInput && args.creationInput) throw new Error('请只提交一份开书输入');
      if (args.bookProfile && (args.creationInput?.bookProfile || args.tagInput?.bookProfile)) throw new Error('请只提交一份创作与发布分类');
      if (!args.tagInput && !args.creationInput && !args.premise.trim()) throw new Error('原有创建方式需要填写原始设定');
      const creationCatalog = this.tagCatalog();
      const rawBookProfile = args.bookProfile ?? args.creationInput?.bookProfile ?? args.tagInput?.bookProfile;
      const bookProfile = rawBookProfile ? resolveBookProfile(rawBookProfile, creationCatalog.publishingSnapshots ?? []) : null;
      if (args.creationInput) makeCreationSpec({ id: 'preview', config: configSchema.parse(args.config ?? {}) } as ProjectState,
        args.creationInput, 1, creationCatalog);
      if (args.tagInput)
        makeBookSpec(
          { id: 'preview', config: configSchema.parse(args.config ?? {}) } as ProjectState,
          args.tagInput,
          1,
          creationCatalog
        );
      const suppliedTitle = args.title?.trim();
      if (args.creationInput && suppliedTitle) throw new Error('统一开书流程请先确认作品方案，再确定书名');
      const title = suppliedTitle || `待定书名-${id().slice(0, 8)}`;
      validateExpressionSelection(this.skillRoot, configSchema.parse(args.config ?? {}));
      const locationError = newProjectLocationError(path.resolve(args.parent));
      if (locationError) throw new ApplicationError('VALIDATION_ERROR', locationError);
      validateBookTitle(title);
      this.close();
      const controlledName = path.join(args.parent, `《${storageFileName(title)}》创作档案`);
      const root = fs.existsSync(controlledName) ? path.join(args.parent, `《${storageFileName(title)}》-${id().slice(0, 8)}创作档案`) : controlledName;
      if (fs.existsSync(root)) throw new Error('同名作品目录已存在，请改名或打开');
      fs.mkdirSync(root, { recursive: true });
      const s = new FileStore(root);
      this.store = s;
      const p = newProject(title, root, args.config ?? {});
      if (bookProfile) p.config.genre = bookProfile.profile.creativeGenres.join('、') || '未限定';
      if (!suppliedTitle) p.titlePending = true;
      p.revision = 1;
      if (args.tagInput) {
        p.tagEnabled = true;
        p.schemaVersion = 2;
        s.db.set('tagDraft', makeBookSpec(p, args.tagInput, 1, creationCatalog));
      }
      if (args.creationInput) {
        p.creationWorkflow = 2;
        p.schemaVersion = 3;
        p.tagEnabled = !!args.creationInput.selection.reading.main || !!args.creationInput.bookProfile?.publishing;
        s.db.set('tagDraft', makeCreationSpec(p, args.creationInput, 1, creationCatalog));
      }
      const premise = args.creationInput?.premise ?? args.tagInput?.premise ?? args.premise;
      const files = initialFiles(p, this.skillRoot, premise);
      if (bookProfile) files[bookProfilePath] = renderBookProfile(bookProfile.profile, bookProfile.catalog);
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
    const chat = this.chat!;
    const idle = () => {
      if (runner.controller || chat.controller || this.coverController || this.writingStyles.busy)
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
    if (creationCommands.has(command)) return handleCreationCommand(this, command, a, idle);
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
    if (command === 'quality.read') return readQuality(s);
    if (workbenchCommands.has(command)) return handleWorkbenchCommand(this, command, a, idle);
    if (command === 'publishing.propose') {
      idle();
      const { s } = this.require();
      const current = readBookProfile(s);
      if (current.baseHash !== a.baseHash || s.db.headRef()?.id !== a.snapshotId) throw new Error('作品或分类资料已改变，请刷新后再修改');
      const resolved = resolveBookProfile(a.profile, this.tagCatalog().publishingSnapshots ?? []);
      const run = this.makeRun('manual', '修改创作题材与发布分类');
      run.changes = [{ path: bookProfilePath, content: renderBookProfile(resolved.profile, resolved.catalog), baseHash: current.baseHash }];
      if (JSON.stringify(resolved.profile.creativeGenres) !== JSON.stringify(current.profile.creativeGenres)) {
        const next = structuredClone(p);
        next.config.genre = resolved.profile.creativeGenres.join('、') || '未限定';
        run.changes.push(this.change(paths.config, updateConfigDocument(s.readAccepted(paths.config).content, next)));
      }
      bindWorkbenchCandidate(s, run, 'field', ['book:publishing']);
      s.db.saveRun(run);
      return run.id;
    }
    if (command === 'quality.exportReview') { idle(); return exportReviewPage(s, z.array(z.string()).parse(a.experimentIds)); }
    if (command === 'quality.importReview') { idle(); return importReviewFeedback(s, Number(a.expectedRevision), a.feedback); }
    if (command === 'design.list') return designCatalog(this.skillRoot);
    if (command === 'experience.read') return readExperience(s, Number(a.throughChapter));
    if (command === 'design.run') return runDesign(this, a.input, typeof a.profileId === 'string' ? a.profileId : undefined, idle);
    if (command === 'run.reviewProse') {
      idle();
      const source = s.db.run(str(a.id));
      if (source.accepted || proposalHash(source) !== a.proposalHash || !compatibleRunBase(s, source)) throw new Error('修订候选已变化，请重新读取');
      const prose = source.changes.filter(c => /^07_正文章节\/第\d+章\.md$/.test(c.path));
      if (!prose.length) throw new Error('没有需要核对的正文候选');
      const r = this.makeRun('revision', '保留作者最终正文，批量核对人物覆盖及核心记忆，统一采纳修订。', str(a.profileId));
      const chapters = prose.map(c => Number(c.path.match(/第(\d+)章/)![1])).sort((a, b) => a - b);
      r.changes = structuredClone(source.changes); r.facts = structuredClone(source.facts);
      r.workbench = source.workbench ? structuredClone(source.workbench) : undefined;
      r.revisionCore = { version: 1, sourceRunId: source.id, chapters, proseHashes: Object.fromEntries(chapters.map(chapter => [chapter, hash(prose.find(c => c.path === prosePath(chapter))!.content)])), coverage: {}, reports: {}, phase: 'extract' };
      r.continuity = { mode: 'retcon', fromChapter: chapters[0] };
      return this.launch(r);
    }
    if (command === 'quality.mutate') { idle(); return mutateQuality(s, Number(a.expectedRevision), a.mutation); }
    if (command === 'quality.statistics') return qualityStatistics(s, str(a.experimentId));
    if (command === 'quality.presentation') return blindPresentation(s, str(a.id));
    if (command === 'quality.voice') {
      idle();
      const r = this.makeRun('manual', '应用声音偏好');
      r.changes = [{ path: voicePath, content: voiceDocument(s, z.array(z.string()).parse(a.ids)), baseHash: s.db.document(voicePath)?.hash ?? null }];
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'world.read') return { model: readWorldModel(s), baseHash: s.db.document(paths.world)?.hash ?? null };
    if (command === 'world.propose') {
      idle();
      if ((s.db.document(paths.world)?.hash ?? null) !== a.baseHash) throw new Error('世界设定已更新，请刷新后重试');
      const content = renderWorldModel(a.model), original = readWorldModel(s), next = readWorldModel(s);
      Object.assign(next, a.model);
      if (next.original !== original.original || JSON.stringify(next.source) !== JSON.stringify(original.source)) throw new Error('沿用的原文与来源不能被覆盖');
      const r = this.makeRun('manual', '更新世界模块');
      r.changes = [{ path: paths.world, content, baseHash: a.baseHash as string | null }];
      bindWorkbenchCandidate(s, r, 'world', next.modules.map(m => `world:${m.id}`));
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'creative.characters') return rehearsalCharacters(s, z.number().int().positive().parse(a.chapter));
    if (command === 'creative.run') {
      idle();
      const r = this.makeRun('analysis', '独立创作工具', typeof a.profileId === 'string' ? a.profileId : undefined);
      const compiled = compileCreative(s, this.skillRoot, a.input, r.id);
      r.creative = compiled.binding;
      r.skillId = `creative:${compiled.binding.input.operation}`;
      r.request = creativeOperations.find(operation => operation.id === compiled.binding.input.operation)!.title;
      r.tagBinding = undefined;
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
    if (discussionCommands.has(command)) return handleDiscussionCommand(this, command, a, idle);
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
      if (runner.controller || this.writingStyles.busy) throw new Error('请先停止任务再修改项目设置');
      if (s.read(paths.config).hash !== s.db.document(paths.config)?.hash)
        throw new Error('配置文件存在外部改动，请先比较并接受，不能用旧设置覆盖');
      const cfg = configSchema.parse(a.config);
      if (tagHash(cfg) === tagHash(p.config)) return this.snapshot();
      if (s.db.document(bookProfilePath)?.hash && cfg.genre !== p.config.genre)
        throw new Error('请在题材与发布分类中修改创作题材');
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
      if (decision.confirmation && a.retryUnknown === true) authorizeUnknownAttempts(s, r);
      const instruction = typeof a.instruction === 'string' ? a.instruction.trim() : '';
      if (r.creative) {
        if (instruction) throw new Error('创作工具恢复只继续原范围，修改范围请从创作工具建立新任务');
        const profileId = typeof a.profileId === 'string' && a.profileId ? a.profileId : r.profileId;
        const completed = s.db.sql.prepare("SELECT 1 FROM model_attempts WHERE run_id=? AND status='complete'").get(r.id);
        if (profileId !== r.profileId || !compatibleRunBase(s, r) || decision.confirmation && !completed)
          r = this.rebuildRun(r, profileId);
        return this.launch(r);
      }
      if (r.planning && instruction) throw new ApplicationError('VALIDATION_ERROR', '修改策划想法请使用方案页；恢复任务继续当前已确认的输入');
      if (!instruction && runner.recoverReadyCandidate(r, p, 'continue')) return r.id;
      // Completing an old direction-review checkpoint needs no model/tool call.
      // The executor still validates the saved report and current source binding.
      if (!hasSavedDirectionCheckpoint(r)) {
        if (r.rounds >= p.config.maxRounds) throw new ApplicationError('ROUND_LIMIT', '已达到模型调用上限，请在运行配置中提高上限后恢复');
        if (r.toolCount >= p.config.maxTools) throw new ApplicationError('TOOL_LIMIT', '已达到工具调用上限，请在运行配置中提高上限后恢复');
      }
      const profileId = typeof a.profileId === 'string' && a.profileId ? a.profileId : r.profileId;
      if (profileId !== r.profileId || runner.needsFreshContext(r) || upgradesVolumeNaming(r, instruction) || upgradesChapterNaming(r, instruction)) {
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
      if (retryNeedsConfirmation(old) && a.retryUnknown === true) authorizeUnknownAttempts(s, old);
      const r = this.rebuildRun(old, str(a.profileId), typeof a.instruction === 'string' ? a.instruction : '');
      return this.launch(r);
    }
    if (command === 'run.resume' || command === 'run.answer' || command === 'run.permission') {
      const r = s.db.run(str(a.id));
      this.executor!.restore({ runId: r.id, executorId: r.executorId ?? 'legacy', executorVersion: r.executorVersion ?? '1', checkpointVersion: r.checkpointVersion ?? 1 });
      if (r.accepted || r.status === 'discarded') throw new Error('此任务不能恢复');
      if (retryNeedsConfirmation(r) && a.retryUnknown !== true)
        throw new Error('上次请求结果与费用未知，需明确选择重新请求');
      if (retryNeedsConfirmation(r) && a.retryUnknown === true) authorizeUnknownAttempts(s, r);
      if (r.creative && typeof a.instruction === 'string' && a.instruction.trim())
        throw new Error('创作工具恢复只继续原阅读范围和输入，修改范围请建立新任务');
      if (r.creative && a.retryUnknown === true && retryNeedsConfirmation(r) &&
          !s.db.sql.prepare("SELECT 1 FROM model_attempts WHERE run_id=? AND status='complete'").get(r.id))
        return this.launch(this.rebuildRun(r, r.profileId));
      if (r.planning && typeof a.instruction === 'string' && a.instruction.trim())
        throw new Error('策划输入变更请在标签与策划中保存，或使用方向局部重做；恢复只继续已绑定的输入');
      if (command === 'run.resume') {
        if (!['paused', 'unknown', 'needs_repair', 'awaiting_review', 'failed', 'stale'].includes(r.status)) throw new Error('请先处理当前待回答或待授权的事项');
        if (!String(a.instruction ?? '').trim() && runner.recoverReadyCandidate(r, p, 'continue')) return r.id;
        if (runner.needsFreshContext(r) || upgradesVolumeNaming(r, String(a.instruction ?? '')) || upgradesChapterNaming(r, String(a.instruction ?? '')))
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
        r.chapterCoverage = undefined;
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
    if (adoptionCommands.has(command)) return handleAdoptionCommand(this, command, a, idle);
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
