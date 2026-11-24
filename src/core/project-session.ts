import { brand } from '../shared/brand';
import { approvedCreation } from '../shared/creation';
import { retryNeedsConfirmation } from '../shared/run-presentation';
import { embeddingSettingsSchema } from '../shared/studio';
import { configSchema, type AppEvent, type ProjectState, type SecretProfile } from '../shared/types';
import { assertProjectVersion } from './compatibility';
import { ConversationRunner, type AssistantRuntime } from './conversation-runner';
import { hash, id, prosePath } from './domain';
import { SemanticIndex } from './embeddings';
import { verifyObjects } from './integrity';
import { rebuildMemory } from './memory';
import { syncEntities } from './memory-studio';
import { ProjectWatcher } from './project-watcher';
import { ProseIndexer } from './prose-index';
import { AgentRunner, type Caller } from './runner';
import { ExecutionRecords } from './runtime/execution-records';
import { ExecutorRouter } from './runtime/executor-router';
import { recoverAttempts } from './runtime/model-gateway';
import { restoreProseTail } from './runtime/prose-checkpoint';
import { parkQueuedExecution } from './runtime/queued-execution';
import { setRunStatus } from './runtime/run-state';
import { PublicSearch } from './search';
import type { FileStore } from './storage';
import { validateApprovedTags } from './tags';
import { recoverUsage } from './telemetry';

interface ProjectRuntime {
  skillRoot: string;
  profiles(): SecretProfile[];
  assistant(): AssistantRuntime;
  caller?: Caller;
  emit(store: FileStore, event: AppEvent): void;
  scheduleAssessment<T>(execute: () => Promise<T>): Promise<T>;
}

function recoverProjectState(store: FileStore) {
  verifyObjects(store.root, store.db.sql);
  store.recover();
  recoverAttempts(store);
  new ExecutionRecords(store.db).recover();

  const project = store.db.project();
  if (!project) throw new Error(`此目录不是${brand.name}项目；请新建作品后导入文档`);
  assertProjectVersion(project);
  project.root = store.root;
  project.config = configSchema.parse(project.config);
  const creation = approvedCreation(project);
  if (creation) validateApprovedTags(creation, project.id);
  if (project.creation && project.tags) throw new Error('作品存在重复的正式方案记录，请恢复最近的完整备份');
  if ((project.creation && !project.creation.contract.plan) ||
      (project.creationWorkflow === 2 && project.stage !== 'S01' && !project.creation))
    throw new Error('正式作品方案记录缺失，请从完整备份恢复');
  if (project.titleBinding && (project.title !== project.titleBinding.candidate.title ||
      (!project.titleReviewRequired && project.titleBinding.planHash !== creation?.contract.planHash)))
    throw new Error('正式书名与方案绑定不一致，请从完整备份恢复');
  store.db.set('project', project);
  return project;
}

function recoverProjectRuns(store: FileStore, project: ProjectState, runner: AgentRunner) {
  for (const run of store.db.allRuns()) {
    if (run.status !== 'running' && run.status !== 'committing') continue;
    if (run.pipeline?.phase === 'prose') restoreProseTail(store, run);
    setRunStatus(run, store.db.get(`inflight:${run.id}`) ? 'unknown' : 'paused');
    run.error = '上次执行中断，恢复前将核对输入和未完成请求';
    store.db.saveRun(run);
  }
  recoverUsage(store);

  for (const run of store.db.allRuns()) {
    if (run.accepted || ['discarded', 'stale'].includes(run.status) || run.baseSnapshotId ||
        run.baseRevision !== project.revision) continue;
    const head = store.db.headRef();
    if (!head) {
      if (!['failed', 'complete'].includes(run.status)) setRunStatus(run, 'stale');
      run.error = '任务缺少可核验的作品版本，候选已保留，请重新建立任务';
      store.db.saveRun(run);
      continue;
    }
    run.baseSnapshotId = head.id;
    if (run.stage === 'S10' && run.mode === 'stage' && !run.pipeline) {
      const prose = run.changes.find(change => change.path === prosePath(run.chapter));
      run.pipeline = {
        phase: prose ? 'review' : 'prose', proseHash: prose ? hash(prose.content) : undefined,
        epoch: id(), version: 1, previewCalls: 0
      };
      run.changes = prose ? [prose] : [];
      run.facts = [];
      run.messages = [];
      run.skillHash = undefined;
      setRunStatus(run, 'paused');
      run.error = '候选已保留，继续后核对正文与记忆';
    }
    store.db.saveRun(run);
  }

  rebuildMemory(store);
  syncEntities(store);
  for (const run of store.db.runs()) {
    if (!run.accepted && run.status === 'awaiting_review' && run.planning?.phase === 'ready' &&
        !retryNeedsConfirmation(run) && !store.db.get(`inflight:${run.id}`)) {
      runner.check(run, project);
      store.db.saveRun(run);
    }
    runner.recoverReadyCandidate(run, project, 'restore');
  }
}

/** Takes ownership of the opened store, including cleanup if recovery fails. */
export function prepareProjectSession(store: FileStore, runtime: ProjectRuntime) {
  try {
    const project = recoverProjectState(store);
    const emit = (event: AppEvent) => runtime.emit(store, event);
    const runner = new AgentRunner(store, runtime.skillRoot, runtime.profiles, emit, runtime.caller);
    runner.searchSettings = () => runtime.assistant().search;
    runner.telemetry.schedule = runtime.scheduleAssessment;
    const index = new SemanticIndex(store, () => {
      const assistant = runtime.assistant();
      return { settings: embeddingSettingsSchema.parse(assistant.embedding ?? {}), apiKey: assistant.embeddingKey ?? '' };
    }, () => emit({ type: 'snapshot' }));
    runner.retrieve = (query, scope, budget) => index.retrieve(query, scope, 12, budget);
    runner.research = (signal, run) => {
      const assistant = runtime.assistant();
      return new PublicSearch(assistant.search, assistant.searchKey, true, signal, { store, owner: run });
    };
    const chat = new ConversationRunner(store, runtime.skillRoot, runtime.profiles, runtime.assistant, emit, runtime.caller);
    const executor = new ExecutorRouter(store, runner, chat);
    parkQueuedExecution(store, chat.records);
    chat.records.recover();
    if (!chat.records.all('conversations').length) chat.records.create('创作讨论', runtime.assistant().search.enabled);
    recoverProjectRuns(store, project, runner);

    const proseIndexer = new ProseIndexer(store);
    const watcher = new ProjectWatcher(store, () => emit({ type: 'snapshot', resource: 'documents' }), () => {});
    return {
      store, runner, chat, executor, index, proseIndexer,
      close() {
        proseIndexer.stop();
        try { watcher.close(); } finally { store.close(); }
      }
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
