import fs from 'node:fs';
import { validateWorkbenchLocks } from './workbench-locks';
import { validatePlotChanges } from './workbench-plot';
import { validateMediaChanges } from './workbench-media';
import { captureCommittedEdit } from './quality';
import { syncGeneration } from '../shared/generation';
import { syncRunFailure } from '../shared/recovery';
import { contractPath, renderContract, tagHash } from './tags';
import { approvedCreation } from '../shared/creation';
import { titlePath, renderTitle } from './title-naming';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkDatabaseCompatibility, databaseVersion } from './compatibility';
import { decodeSnapshot, encodeSnapshot, type StoredSnapshot } from './snapshot-codec';
import { indexProse } from './prose-index';
import { updateFactIndex } from './fact-index';
import { assertRunTransition } from './runtime/run-state';
import { ApplicationError } from '../shared/errors';
import { fingerprint } from './runtime/canonical';
import { MaterializationConflict, preserveAndMaterialize } from './materialization';
import { pendingSource } from './memory-source';
import { contextDependencies } from './context-dependencies';
import { hash, id, now } from './domain';
import { assertProjectLockInactive, parseProjectLock, processStartedAt } from './project-lock';
import {
  factSchema,
  type Change,
  type DocumentInfo,
  type Fact,
  type ProjectState,
  type Run,
  type RunEvent
} from '../shared/types';
import type { CanonicalSnapshot, ChangeSet, CommitRecoveryConflict, SnapshotRef } from '../shared/studio';
export type { CommitRecoveryConflict } from '../shared/studio';

export const proposalHash = (run: Run) => {
  const payload = {
      project: run.baseSnapshotId ?? run.baseRevision,
      stage: run.stage,
      chapter: run.chapter,
      changes: run.changes,
      ...(run.documentDrafts?.length ? { documentDrafts: run.documentDrafts } : {}),
      facts: run.facts,
      ...(run.memoryReview ? { memoryReview: run.memoryReview } : {}),
      ...(run.factRetractions?.length ? { factRetractions: run.factRetractions } : {}),
      ...(run.memoryRepair ? { memoryRepair: run.memoryRepair } : {}),
      ...(run.continuity ? { continuity: run.continuity } : {}),
      dependencies: run.manifest?.sources.map((s) => [s.path, s.hash]),
      ...(run.manifest?.selectedBy === 'context-compiler-v1' ? { compiledContext: fingerprint(run.manifest) } : {}),
      pipeline: run.pipeline,
      planning: run.planning,
      ...(run.naming ? { naming: run.naming } : {}),
      ...(run.volumeNaming?.version === 2 ? { volumeNaming: run.volumeNaming } : {}),
      ...(run.chapterNaming ? { chapterNaming: run.chapterNaming } : {}),
      tagBinding: run.tagBinding,
      skill: run.skillHash,
      ...(run.workflowBinding ? { workflowBinding: run.workflowBinding } : {}),
      ...(run.chapterCoverage ? { chapterCoverage: run.chapterCoverage } : {})
      ,...(run.revisionCore ? { revisionCore: run.revisionCore } : {})
      ,...(run.revisionCoreRequired ? { revisionCoreRequired: run.revisionCoreRequired } : {})
      ,...(run.worldContract ? { worldContract: run.worldContract } : {})
      ,...(run.design ? { design: run.design } : {})
      ,...(run.workbench ? { workbench: run.workbench } : {})
    };
  return run.candidateFormat === 2 ? fingerprint({ format: 2, runId: run.id, projectId: run.projectId, ...payload }) : hash(JSON.stringify(payload));
};

export function safePath(root: string, relative: string, internal = false): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\0') || relative.includes(':'))
    throw new Error('文件路径必须是项目内相对路径');
  const normalized = relative.replaceAll('\\', '/');
  if (
    normalized
      .split('/')
      .some(
        (s) =>
          !s ||
          s === '..' ||
          s === '.' ||
          /[. ]$/.test(s) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)
      )
  )
    throw new Error('路径包含非法目录或 Windows 保留名称');
  if (!internal && normalized.split('/')[0].toLowerCase() === '.novelclient')
    throw new Error('此操作不能修改客户端控制记录');
  const target = path.resolve(root, normalized),
    rel = path.relative(path.resolve(root), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径超出作品目录');
  let cursor = path.resolve(root);
  for (const segment of ['', ...normalized.split('/')]) {
    if (segment) cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`禁止通过符号链接或目录联接访问：${relative}`);
  }
  return target;
}
export function durableCreate(file: string, data: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function atomicWrite(file: string, data: string | Buffer) {
  const tmp = `${file}.${id()}.tmp`;
  durableCreate(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw e;
  }
}
export function fileHash(file: string): string | null {
  return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
}
export function readUtf8(file: string): string {
  const raw = fs.readFileSync(file);
  return new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/, '');
}
export class Database {
  readonly sql: DatabaseSync;
  private snapshotCache?: { id: string; raw: string; value: CanonicalSnapshot };
  constructor(readonly filename: string) {
    this.sql = new DatabaseSync(filename);
    const schema = (this.sql.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (schema > databaseVersion) {
      this.sql.close();
      throw new Error(`数据库版本 ${schema} 高于本客户端支持版本，已停止打开且未修改原数据库`);
    }
    try {
      checkDatabaseCompatibility(this.sql);
      // VACUUM INTO captures WAL contents too; never copy a live SQLite main file alone.
      if (schema > 0 && schema < databaseVersion) {
        const backup = `${filename}.before-v${databaseVersion}-${id()}.bak`;
        this.sql.prepare('VACUUM INTO ?').run(backup);
        const control = path.dirname(filename),
          destination = `${control}.before-v${databaseVersion}-${id()}`;
        fs.mkdirSync(destination);
        const savedControl = path.join(destination, '.novelclient');
        fs.mkdirSync(savedControl);
        fs.copyFileSync(backup, path.join(savedControl, 'state.sqlite'));
        for (const name of ['objects', 'transactions']) {
          const source = path.join(control, name);
          if (fs.existsSync(source))
            fs.cpSync(source, path.join(savedControl, name), { recursive: true, dereference: false });
        }
        const copyProjectFiles = (directory: string, relative = '') => {
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (
              entry.isSymbolicLink() ||
              entry.name.startsWith('.novelclient') ||
              ['node_modules', '.git'].includes(entry.name)
            )
              continue;
            const rel = relative + entry.name,
              source = path.join(directory, entry.name);
            if (entry.isDirectory()) copyProjectFiles(source, rel + '/');
            else if (entry.isFile()) atomicWrite(path.join(destination, rel), fs.readFileSync(source));
          }
        };
        if (path.basename(control) === '.novelclient') copyProjectFiles(path.dirname(control));
        const manifest: { path: string; hash: string }[] = [];
        const collect = (directory: string, relative = '') => {
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const rel = relative + entry.name,
              source = path.join(directory, entry.name);
            if (entry.isDirectory()) collect(source, rel + '/');
            else manifest.push({ path: rel, hash: hash(fs.readFileSync(source)) });
          }
        };
        collect(destination);
        atomicWrite(
          path.join(destination, 'wenxu-backup.json'),
          JSON.stringify({ schema: 1, createdAt: now(), manifest }, null, 2)
        );
      }
      this.sql
        .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,hash TEXT,bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(document_id TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,tx TEXT NOT NULL,PRIMARY KEY(document_id,hash));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,at TEXT NOT NULL,data TEXT);
      CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,data TEXT NOT NULL,source_hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS fact_world_timeline ON facts(json_extract(data,'$.worldId'),json_extract(data,'$.timelineId'));
      CREATE TABLE IF NOT EXISTS fact_ledgers(id TEXT PRIMARY KEY,path TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS fact_ledger_path ON fact_ledgers(path);
      CREATE TABLE IF NOT EXISTS fact_ledger_versions(path TEXT PRIMARY KEY,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fact_source_index(fact_id TEXT NOT NULL REFERENCES fact_ledgers(id) ON DELETE CASCADE,path TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(fact_id,path,hash));
      CREATE INDEX IF NOT EXISTS fact_source_path ON fact_source_index(path);
      CREATE TABLE IF NOT EXISTS applied_transactions(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(path UNINDEXED,content,tokenize='trigram');
      CREATE TABLE IF NOT EXISTS document_fts_rows(path TEXT PRIMARY KEY,hash TEXT NOT NULL,fts_rowid INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS prose_search_versions(id INTEGER PRIMARY KEY,path TEXT NOT NULL,hash TEXT NOT NULL,content TEXT NOT NULL,UNIQUE(path,hash));
      CREATE VIRTUAL TABLE IF NOT EXISTS prose_search_terms USING fts5(terms,tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_conversation ON conversation_messages(conversation_id);
      CREATE TABLE IF NOT EXISTS conversation_turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS action_proposals(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draft_artifacts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshot_project ON snapshots(project_id,revision);
      CREATE TABLE IF NOT EXISTS changesets(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS materialization_outbox(id TEXT PRIMARY KEY,status TEXT NOT NULL,data TEXT NOT NULL,error TEXT);
      CREATE TABLE IF NOT EXISTS dependencies(source_path TEXT NOT NULL,source_hash TEXT NOT NULL,dependent TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(source_path,source_hash,dependent,kind));
      CREATE TABLE IF NOT EXISTS review_queue(id TEXT PRIMARY KEY,source TEXT NOT NULL,dependent TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vector_chunks(id TEXT PRIMARY KEY,generation TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,chapter INTEGER NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,text TEXT NOT NULL,vector TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS vector_generation ON vector_chunks(generation,path,hash);
      CREATE TABLE IF NOT EXISTS assessments(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operation_receipts(id TEXT PRIMARY KEY,kind TEXT NOT NULL,input_hash TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_attempts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS attempt_run ON model_attempts(run_id);
      CREATE TABLE IF NOT EXISTS tool_executions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,args_hash TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidate_versions(run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,fingerprint));
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidate_commits(run_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,transaction_id TEXT UNIQUE NOT NULL,approval_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS execution_checkpoints(run_id TEXT NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,sequence));
      CREATE TABLE IF NOT EXISTS execution_records(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,data TEXT NOT NULL);
      PRAGMA user_version=${databaseVersion}; COMMIT;`);
    } catch (error) {
      try {
        this.sql.exec('ROLLBACK');
      } catch {}
      this.sql.close();
      throw error;
    }
  }
  get<T>(key: string): T | undefined {
    const r = this.sql.prepare('SELECT value FROM kv WHERE key=?').get(key) as { value: string } | undefined;
    return r ? JSON.parse(r.value) : undefined;
  }
  set(key: string, value: unknown) {
    this.sql
      .prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }
  project() {
    return this.get<ProjectState>('project')!;
  }
  private withUsage(run: Run) {
    const ledger = this.get<Pick<Run, 'usage' | 'steps'>>(`chapterUsage:${run.id}`);
    if (ledger) {
      run.usage = ledger.usage;
      run.steps = ledger.steps;
    }
    return run;
  }
  saveRun(run: Run) {
    syncGeneration(run);
    syncRunFailure(run);
    this.withUsage(run);
    const candidateHash = proposalHash(run);
    let version = run.stateVersion ?? 0;
    this.transaction(() => {
      const row = this.sql.prepare('SELECT data FROM runs WHERE id=?').get(run.id);
      const previous = row ? JSON.parse(String(row.data)) as Run : undefined;
      if (previous && (run.stateVersion ?? 0) !== (previous.stateVersion ?? 0))
        throw new ApplicationError('VERSION_CONFLICT', '任务状态已改变，请重新读取', ['refresh']);
      if (previous) assertRunTransition(previous.status, run.status);
      const changed = !previous || previous.status !== run.status;
      version = (previous?.stateVersion ?? 0) + 1;
      const data = JSON.stringify({ ...run, stateVersion: version, proposalHash: candidateHash });
      this.sql.prepare('INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id, data);
      if (['awaiting_review', 'needs_repair'].includes(run.status) && run.changes.length)
        this.sql.prepare('INSERT OR IGNORE INTO candidate_versions VALUES(?,?,?)').run(run.id, candidateHash, data);
      if (changed) {
        this.event(run.id, 'state-transition', `${previous?.status ?? 'new'} → ${run.status}`, { stateVersion: version });
        this.sql.prepare('INSERT INTO execution_checkpoints VALUES(?,?,?)').run(run.id, version, JSON.stringify({ version: 1, status: run.status, proposalHash: candidateHash, at: now() }));
      }
    });
    run.stateVersion = version;
    run.proposalHash = candidateHash;
  }
  transaction<T>(action: () => T): T {
    const savepoint = 'p' + id().replaceAll('-', '');
    this.sql.exec(`SAVEPOINT ${savepoint}`);
    try { const result = action(); this.sql.exec(`RELEASE ${savepoint}`); return result; }
    catch (error) { this.sql.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
  }
  run(runId: string): Run {
    const r = this.sql.prepare('SELECT data FROM runs WHERE id=?').get(runId) as { data: string } | undefined;
    if (!r) throw new Error('运行记录不存在');
    return this.withUsage(JSON.parse(r.data));
  }
  runs(): Run[] {
    return (
      this.sql.prepare('SELECT data FROM runs ORDER BY rowid DESC LIMIT 100').all() as { data: string }[]
    ).map((r) => this.withUsage(JSON.parse(r.data)));
  }
  runPage(before?: number, watermark?: number, limit = 100) {
    const boundary = watermark ?? Number(this.sql.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM runs').get()!.n);
    const rows = this.sql.prepare('SELECT rowid AS cursor,data FROM runs WHERE rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(boundary, before ?? boundary + 1, limit + 1);
    return { items: rows.slice(0, limit).map(row => ({ ...this.withUsage(JSON.parse(String(row.data))), messages: [], toolResults: {} })), watermark: boundary, nextBefore: rows.length > limit ? Number(rows[limit - 1].cursor) : null };
  }
  *allRuns(): Generator<Run> {
    let before = Number.MAX_SAFE_INTEGER;
    while (true) {
      const rows = this.sql.prepare('SELECT rowid AS cursor,data FROM runs WHERE rowid<? ORDER BY rowid DESC LIMIT 100').all(before);
      if (!rows.length) return;
      for (const row of rows) yield this.withUsage(JSON.parse(String(row.data)));
      before = Number(rows.at(-1)!.cursor);
    }
  }
  event(runId: string, kind: string, text: string, data?: unknown): RunEvent {
    const at = now();
    const r = this.sql
      .prepare('INSERT INTO events(run_id,kind,text,at,data) VALUES(?,?,?,?,?)')
      .run(runId, kind, text, at, data === undefined ? null : JSON.stringify(data));
    return { seq: Number(r.lastInsertRowid), runId, kind, text, at, data };
  }
  events(): RunEvent[] {
    return (
      this.sql
        .prepare('SELECT seq,run_id AS runId,kind,text,at,data FROM events ORDER BY seq DESC LIMIT 250')
        .all() as unknown as (RunEvent & { data: string | null })[]
    )
      .reverse()
      .map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : undefined }));
  }
  runEvents(runId: string, afterSeq: number, limit: number): RunEvent[] {
    this.run(runId);
    return (
      this.sql
        .prepare(
          'SELECT seq,run_id AS runId,kind,text,at,data FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?'
        )
        .all(runId, afterSeq, limit) as unknown as (RunEvent & { data: string | null })[]
    ).map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : undefined }));
  }
  acceptedDocuments(): { id: string; path: string; hash: string | null; bytes: number }[] {
    return this.sql.prepare('SELECT * FROM documents ORDER BY path').all() as never;
  }
  document(relative: string) {
    return this.sql.prepare('SELECT * FROM documents WHERE path=?').get(relative) as
      { id: string; path: string; hash: string | null; bytes: number } | undefined;
  }
  history(relative: string) {
    return this.sql
      .prepare(
        'SELECT r.hash,r.created_at AS createdAt,r.tx FROM revisions r JOIN documents d ON d.id=r.document_id WHERE d.path=? ORDER BY r.created_at DESC'
      )
      .all(relative);
  }
  historyPage(relative: string, before?: number, watermark?: number, limit = 100) {
    const boundary = watermark ?? Number(this.sql.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM revisions').get()!.n);
    const rows = this.sql.prepare('SELECT r.rowid AS cursor,r.hash,r.created_at AS createdAt,r.tx FROM revisions r JOIN documents d ON d.id=r.document_id WHERE d.path=? AND r.rowid<=? AND r.rowid<? ORDER BY r.rowid DESC LIMIT ?').all(relative, boundary, before ?? boundary + 1, limit + 1);
    return { items: rows.slice(0, limit).map(row => ({ hash: String(row.hash), createdAt: String(row.createdAt), tx: String(row.tx) })), watermark: boundary, nextBefore: rows.length > limit ? Number(rows[limit - 1].cursor) : null };
  }
  replaceFacts(facts: Fact[], revision: number) {
    this.sql.exec('DELETE FROM facts');
    const insert = this.sql.prepare('INSERT INTO facts VALUES(?,?,?)');
    for (const f of facts) insert.run(f.id, JSON.stringify(f), f.evidence.map((e) => e.hash).join(','));
    this.set('indexRevision', revision);
    this.set('factLedgerIndexValid', false);
  }
  facts(scope?: { worldId: string; timelineId: string }): Fact[] {
    const rows = scope
      ? this.sql.prepare("SELECT data FROM facts WHERE json_extract(data,'$.worldId')=? AND json_extract(data,'$.timelineId')=? ORDER BY rowid").all(scope.worldId, scope.timelineId)
      : this.sql.prepare('SELECT data FROM facts').all();
    return (rows as { data: string }[]).map((r) =>
      JSON.parse(r.data)
    );
  }
  head(): CanonicalSnapshot | null {
    const key = this.get<string>('headSnapshot');
    return key ? this.snapshot(key) : null;
  }
  snapshot(key: string): CanonicalSnapshot {
    return structuredClone(this.cachedSnapshot(key));
  }
  snapshotInfo(key: string): Omit<CanonicalSnapshot, 'facts'> {
    const { facts: _, ...snapshot } = this.cachedSnapshot(key);
    return structuredClone(snapshot);
  }
  snapshotDocument(key: string, relative: string) {
    return this.cachedSnapshot(key).documents[relative];
  }
  headRef(): SnapshotRef | null {
    const key = this.get<string>('headSnapshot');
    return key ? this.sql.prepare('SELECT id,project_id AS projectId,revision,created_at AS createdAt FROM snapshots WHERE id=?').get(key) as unknown as SnapshotRef : null;
  }
  private cachedSnapshot(key: string): CanonicalSnapshot {
    const row = this.sql.prepare('SELECT data FROM snapshots WHERE id=?').get(key) as
      { data: string } | undefined;
    if (!row) throw new Error('此历史快照不可用');
    if (this.snapshotCache?.id === key && this.snapshotCache.raw === row.data) return this.snapshotCache.value;
    const value = decodeSnapshot(JSON.parse(row.data) as StoredSnapshot, parent => {
      const source = this.sql.prepare('SELECT data FROM snapshots WHERE id=?').get(parent);
      if (!source) throw new Error('历史快照的基础版本缺失');
      return JSON.parse(String(source.data));
    });
    value.facts = value.facts.map((f) => factSchema.parse(f));
    if (value.projectId !== this.project()?.id) throw new Error('快照不属于当前作品');
    this.snapshotCache = { id: key, raw: row.data, value };
    return value;
  }
  snapshots(): SnapshotRef[] {
    return this.sql
      .prepare(
        'SELECT id, project_id AS projectId, revision, created_at AS createdAt FROM snapshots ORDER BY rowid DESC LIMIT 1000'
      )
      .all() as unknown as SnapshotRef[];
  }
  snapshotPage(before?: number, watermark?: number, limit = 100) {
    const boundary = watermark ?? Number(this.sql.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM snapshots').get()!.n);
    const rows = this.sql.prepare('SELECT rowid AS cursor,id,project_id AS projectId,revision,created_at AS createdAt FROM snapshots WHERE rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(boundary, before ?? boundary + 1, limit + 1);
    return { items: rows.slice(0, limit).map(row => ({ id: String(row.id), projectId: String(row.projectId), revision: Number(row.revision), createdAt: String(row.createdAt) })), watermark: boundary, nextBefore: rows.length > limit ? Number(rows[limit - 1].cursor) : null };
  }
  captureSnapshot(snapshotId: string = id()) {
    const project = this.project();
    if (!project) return;
    const snapshot: CanonicalSnapshot = {
      id: snapshotId,
      projectId: project.id,
      revision: project.revision,
      createdAt: now(),
      parentId: this.get<string>('headSnapshot') ?? null,
      project,
      documents: Object.fromEntries(
        this.acceptedDocuments()
          .filter((d) => d.hash)
          .map((d) => [d.path, d.hash!])
      ),
      facts: this.facts()
    };
    const previous = snapshot.parentId ? this.cachedSnapshot(snapshot.parentId) : null;
    const previousRaw = snapshot.parentId ? this.sql.prepare('SELECT data FROM snapshots WHERE id=?').get(snapshot.parentId) : undefined;
    const depth = previousRaw ? Number(JSON.parse(String(previousRaw.data)).depth ?? 0) : 0;
    const raw = JSON.stringify(encodeSnapshot(snapshot, previous, depth));
    this.sql
      .prepare('INSERT INTO snapshots VALUES(?,?,?,?,?)')
      .run(snapshotId, project.id, project.revision, snapshot.createdAt, raw);
    this.snapshotCache = { id: snapshot.id, raw, value: snapshot };
    this.set('headSnapshot', snapshotId);
  }
  close() {
    this.sql.close();
  }
}
interface Journal {
  approvalId?: string;
  id: string;
  state: 'prepared' | 'committed';
  createdAt: string;
  changes: { path: string; baseHash: string | null; newHash: string }[];
  project: ProjectState;
  run?: Run;
  baseSnapshotId?: string | null;
  payloadHash?: string;
  facts?: Fact[];
}
interface CommitRecoveryRecord extends CommitRecoveryConflict {
  status: 'blocked' | 'abandoned' | 'resolved';
  journalHash: string;
  resolvedAt?: string;
  actor?: 'local-author';
}
class PendingCommitConflict extends ApplicationError {
  constructor(readonly reason: CommitRecoveryConflict['reason'], message: string) {
    super(reason === 'approval_changed' ? 'APPROVAL_STALE' : 'VERSION_CONFLICT', message, ['refresh']);
  }
}
const recoveryKey = (transactionId: string) => `commitRecovery:${transactionId}`;
function completedJournal(journal: Journal) {
  const { project, run, facts, ...record } = journal;
  return JSON.stringify({ ...record, state: 'committed' }, null, 2);
}
export class FileStore {
  readonly root: string;
  readonly control: string;
  readonly db: Database;
  private lockOwned = false;
  private readonly lockNonce = id();
  private fingerprints = new Map<string, { signature: string; hash: string; bytes: number }>();
  private readonly pathOrder = new Intl.Collator('zh-CN', { numeric: true });
  private listing?: DocumentInfo[];
  constructor(root: string) {
    this.root = path.resolve(root);
    if (!fs.existsSync(this.root) || fs.lstatSync(this.root).isSymbolicLink())
      throw new Error('作品目录不存在或为目录联接');
    this.control = safePath(this.root, '.novelclient', true);
    fs.mkdirSync(this.control, { recursive: true });
    this.acquireLock();
    try {
      this.db = new Database(safePath(this.root, '.novelclient/state.sqlite', true));
    } catch (e) {
      this.releaseLock();
      throw e;
    }
  }
  private acquireLock() {
    const lock = path.join(this.control, 'write-lock.json');
    const ownerStartedAt = processStartedAt(process.pid);
    if (fs.existsSync(lock)) {
      const original = readUtf8(lock);
      assertProjectLockInactive(parseProjectLock(original));
      if (readUtf8(lock) !== original) throw new Error('作品占用状态刚刚发生变化，请重试');
      fs.unlinkSync(lock);
    }
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: this.lockNonce, startedAt: performance.timeOrigin,
      processStartedAt: ownerStartedAt, createdAt: now() }), { flag: 'wx' });
    this.lockOwned = true;
  }
  private releaseLock() {
    if (this.lockOwned) {
      const f = path.join(this.control, 'write-lock.json');
      if (fs.existsSync(f) && JSON.parse(readUtf8(f)).nonce === this.lockNonce) fs.unlinkSync(f);
      this.lockOwned = false;
    }
  }
  close() {
    try {
      this.db.close();
    } finally {
      this.releaseLock();
    }
  }
  putObject(data: string | Buffer): string {
    const h = hash(data),
      file = safePath(this.root, `.novelclient/objects/${h}`, true);
    if (!fs.existsSync(file)) atomicWrite(file, data);
    else if (fileHash(file) !== h) throw new Error('历史对象完整性错误');
    return h;
  }
  object(h: string): Buffer {
    if (!/^[a-f0-9]{64}$/.test(h)) throw new Error('无效版本编号');
    const raw = fs.readFileSync(safePath(this.root, `.novelclient/objects/${h}`, true));
    if (hash(raw) !== h) throw new Error('历史对象校验失败');
    return raw;
  }
  read(relative: string, revision?: string): { path: string; content: string; hash: string } {
    if (revision) {
      const d = this.db.document(relative);
      if (
        !d ||
        !this.db.sql.prepare('SELECT 1 FROM revisions WHERE document_id=? AND hash=?').get(d.id, revision)
      )
        throw new Error('该版本不属于此文档');
      return {
        path: relative,
        content: new TextDecoder('utf-8', { fatal: true }).decode(this.object(revision)),
        hash: revision
      };
    }
    const file = safePath(this.root, relative);
    const raw = fs.readFileSync(file);
    return {
      path: relative,
      content: new TextDecoder('utf-8', { fatal: true }).decode(raw),
      hash: hash(raw)
    };
  }
  readAccepted(relative: string, snapshotId?: string) {
    safePath(this.root, relative);
    const version = snapshotId
      ? this.db.snapshotDocument(snapshotId, relative)
      : this.db.document(relative)?.hash;
    if (!version) throw new Error(`没有已接受版本：${relative}`);
    return {
      path: relative,
      hash: version,
      content: new TextDecoder('utf-8', { fatal: true }).decode(this.object(version))
    };
  }
  inspect(relative: string): DocumentInfo | undefined {
    const file = safePath(this.root, relative), accepted = this.db.document(relative);
    const stat = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
    if (!stat) { this.invalidateListing(); return accepted ? { ...accepted, acceptedHash: accepted.hash, hash: null, status: 'missing' } : undefined; }
    if (!stat.isFile()) return undefined;
    const signature = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
    let cached = this.fingerprints.get(relative);
    if (!cached || cached.signature !== signature) {
      this.invalidateListing();
      const raw = fs.readFileSync(file);
      cached = { signature, hash: hash(raw), bytes: raw.length };
      this.fingerprints.set(relative, cached);
    }
    return { id: accepted?.id ?? relative, path: relative, hash: cached.hash, acceptedHash: accepted?.hash ?? null, status: accepted ? accepted.hash === cached.hash ? 'accepted' : 'external' : 'new', bytes: cached.bytes };
  }
  invalidateListing() { this.listing = undefined; }
  documentListing() { return (this.listing ?? this.scan()).map(document => ({ ...document })); }
  scan(): DocumentInfo[] {
    const found = new Map<string, DocumentInfo>();
    const accepted = new Map(this.db.acceptedDocuments().map(d => [d.path, d]));
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new Error('作品目录不能是目录联接');
    const canonicalRoot = fs.realpathSync.native(this.root);
    const pathKey = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    const walk = (dir: string, prefix = '') => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          ent.name.startsWith('.novelclient') ||
          ent.name === 'node_modules' ||
          ent.name === '.git' ||
          ent.isSymbolicLink()
        )
          continue;
        const rel = prefix + ent.name;
        if (rel === '00_作者输入/自由草稿') continue;
        if (ent.isDirectory()) walk(path.join(dir, ent.name), rel + '/');
        else if (/\.md$/i.test(ent.name)) {
          const file = path.join(dir, ent.name);
          if (pathKey(fs.realpathSync.native(file)) !== pathKey(path.join(canonicalRoot, rel))) throw new Error(`禁止通过符号链接或目录联接访问：${rel}`);
          const stat = fs.statSync(file, { bigint: true }),
            signature = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
          let cached = this.fingerprints.get(rel);
          if (!cached || cached.signature !== signature) {
            const raw = fs.readFileSync(file);
            cached = { signature, hash: hash(raw), bytes: raw.length };
            this.fingerprints.set(rel, cached);
          }
          const h = cached.hash,
            old = accepted.get(rel);
          found.set(rel, {
            id: old?.id ?? rel,
            path: rel,
            hash: h,
            acceptedHash: old?.hash ?? null,
            status: old ? (old.hash === h ? 'accepted' : 'external') : 'new',
            bytes: cached.bytes
          });
        }
      }
    };
    walk(this.root);
    for (const d of accepted.values())
      if (!found.has(d.path))
        found.set(d.path, { ...d, acceptedHash: d.hash, hash: null, status: 'missing' });
    for (const key of this.fingerprints.keys()) if (!found.has(key)) this.fingerprints.delete(key);
    this.listing = [...found.values()].sort((a, b) => this.pathOrder.compare(a.path, b.path));
    return this.listing.map(document => ({ ...document }));
  }
  commit(changes: Change[], project: ProjectState, run?: Run, fault?: (point: string) => void, approvalId?: string): string {
    this.invalidateListing();
    if (run) {
      const previous = this.db.sql.prepare('SELECT fingerprint,transaction_id FROM candidate_commits WHERE run_id=?').get(run.id);
      if (previous) {
        if (previous.fingerprint !== proposalHash(run)) throw new ApplicationError('APPROVAL_STALE', '此候选已经以另一版本提交');
        this.materialize(String(previous.transaction_id), fault);
        return String(previous.transaction_id);
      }
      if (!approvalId) throw new ApplicationError('PERMISSION_DENIED', '正式候选必须通过作者审批入口提交');
    }
    if (this.recoveryConflicts().length)
      throw new ApplicationError('VERSION_CONFLICT', '有未处理的提交恢复冲突，请先比较并恢复或放弃该次提交', ['refresh']);
    validateWorkbenchLocks(this, changes);
    validatePlotChanges(this, changes, !run || run.mode === 'manual');
    validateMediaChanges(this, changes);
    for (const c of changes)
      if (
        c.path === contractPath &&
        (!approvedCreation(project) || c.content !== renderContract(approvedCreation(project)!.spec, approvedCreation(project)!.contract))
      )
        throw new Error('标签契约展示只能由已批准的结构化记录生成');
    for (const c of changes)
      if (c.path === titlePath && (!project.titleBinding || c.content !== renderTitle(project.titleBinding)))
        throw new Error('书名展示只能由已批准的命名记录生成');
    if (changes.some((c) => c.path.replaceAll('\\', '/').toLowerCase().startsWith('00_作者输入/自由草稿/')))
      throw new Error('自由草稿不能通过正式提交保存，请使用草稿版本接口');
    if (!changes.length) throw new Error('提交没有文件内容');
    const tx = id(),
      seen = new Set<string>();
    const existingPaths = new Map(this.db.acceptedDocuments().map((d) => [d.path.toLowerCase(), d.path]));
    const entries = changes.map((change) => {
      if (change.path.includes('\\')) throw new Error('提交路径必须使用正斜杠 /，避免同一文件产生多个索引');
      const key = change.path.toLowerCase();
      const existing = existingPaths.get(key);
      if (existing && existing !== change.path)
        throw new Error(`路径大小写与已有文件冲突，请使用原路径：${existing}`);
      if (seen.has(key)) throw new Error('同一变更包包含重复文件');
      seen.add(key);
      const file = safePath(this.root, change.path);
      if (fileHash(file) !== change.baseHash) throw new Error(`文件已被外部修改：${change.path}`);
      if (change.baseHash) this.putObject(fs.readFileSync(file));
      return { path: change.path, baseHash: change.baseHash, newHash: this.putObject(change.content) };
    });
    const baseSnapshotId = this.db.get<string>('headSnapshot') ?? null;
    const payloadHash = hash(
      JSON.stringify({ entries, project, run: run ? proposalHash(run) : null, baseSnapshotId })
    );
    const changeset: ChangeSet = {
      id: tx,
      projectId: project.id,
      baseSnapshotId,
      payloadHash,
      changes,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      actor: 'local-author',
      runId: run?.id,
      scope: entries.map((c) => c.path)
    };
    this.db.sql
      .prepare('INSERT INTO changesets VALUES(?,?,?)')
      .run(tx, payloadHash, JSON.stringify(changeset));
    const journal: Journal = {
      approvalId,
      id: tx,
      state: 'prepared',
      createdAt: now(),
      changes: entries,
      project,
      run,
      baseSnapshotId,
      payloadHash
    };
    const jp = safePath(this.root, `.novelclient/transactions/${tx}.json`, true);
    atomicWrite(jp, JSON.stringify(journal, null, 2));
    fault?.('prepared');
    try {
      this.applyJournal(journal, fault);
    } catch (error) {
      if (error instanceof PendingCommitConflict) this.recordRecoveryConflict(journal, error);
      throw error;
    }
    atomicWrite(jp, completedJournal(journal));
    fault?.('committed');
    return tx;
  }
  private verifyJournal(j: Journal) {
    if (j.payloadHash) {
      const expected = hash(
        JSON.stringify({
          entries: j.changes,
          project: j.project,
          run: j.run ? proposalHash(j.run) : null,
          baseSnapshotId: j.baseSnapshotId
        })
      );
      const row = this.db.sql.prepare('SELECT payload_hash FROM changesets WHERE id=?').get(j.id) as
        { payload_hash: string } | undefined;
      if (expected !== j.payloadHash || row?.payload_hash !== j.payloadHash)
        throw new Error('提交内容与作者确认的变更集不一致');
    }
    // Check every referenced object before classifying a recoverable conflict.
    // A changed working copy must not conceal a damaged pending candidate.
    for (const change of j.changes) {
      safePath(this.root, change.path);
      this.object(change.newHash);
      if (change.baseHash) this.object(change.baseHash);
    }
  }
  private journalApproval(j: Journal) {
    if (!j.run) return;
    if (j.run && !j.approvalId) {
      const row = this.db.sql.prepare('SELECT data FROM changesets WHERE id=?').get(j.id);
      const prior = row ? JSON.parse(String(row.data)) as ChangeSet : undefined;
      if (!prior || prior.actor !== 'local-author' || prior.runId !== j.run.id || !j.run.accepted || prior.payloadHash !== j.payloadHash ||
        fingerprint(prior.scope) !== fingerprint(j.changes.map((change) => change.path)))
        throw new ApplicationError('APPROVAL_STALE', '旧提交缺少可验证的作者确认依据，保留记录，未自动提交');
      j.approvalId = `legacy:${j.id}`;
      const approval = { version: 1, id: j.approvalId, runId: j.run.id, fingerprint: proposalHash(j.run), projectId: j.project.id,
        baseSnapshotId: j.baseSnapshotId ?? null, scope: prior.scope, commitHash: fingerprint({ project: j.project, changes: j.changes }),
        actor: prior.actor, issuedAt: prior.createdAt, revokedAt: null, consumedByCommit: null, source: 'legacy-change-set', sourceId: prior.id };
      this.db.sql.prepare('INSERT OR IGNORE INTO approvals VALUES(?,?,?,?)').run(j.approvalId, j.run.id, proposalHash(j.run), JSON.stringify(approval));
    }
    const approvalRow = this.db.sql.prepare('SELECT data FROM approvals WHERE id=?').get(j.approvalId ?? '');
    if (!approvalRow) throw new ApplicationError('APPROVAL_STALE', '提交缺少可信审批记录');
    const approval = JSON.parse(String(approvalRow.data));
    if (approval.fingerprint !== proposalHash(j.run) || approval.projectId !== j.project.id ||
      approval.baseSnapshotId !== j.baseSnapshotId || approval.commitHash !== fingerprint({ project: j.project, changes: j.changes }) ||
      fingerprint(approval.scope) !== fingerprint(j.changes.map((change) => change.path)))
      throw new ApplicationError('APPROVAL_STALE', '提交内容与可信审批记录不一致');
    return approval;
  }
  private applyJournal(j: Journal, fault?: (point: string) => void) {
    this.verifyJournal(j);
    if (this.db.sql.prepare('SELECT 1 FROM applied_transactions WHERE id=?').get(j.id)) {
      this.materialize(j.id, fault);
      return;
    }
    this.journalApproval(j);
    for (const c of j.changes) {
      const h = fileHash(safePath(this.root, c.path));
      if (h !== c.baseHash && h !== c.newHash)
        throw new PendingCommitConflict('external_edit', `恢复遇到外部改稿，已保留，请先比较：${c.path}`);
    }
    fault?.('before-database');
    this.db.sql.exec('BEGIN IMMEDIATE');
    try {
      if (j.baseSnapshotId !== undefined && j.baseSnapshotId !== (this.db.get('headSnapshot') ?? null))
        throw new PendingCommitConflict('snapshot_changed', '提交基于旧快照，未写入正式版本');
      if (j.run) {
        const approval = this.journalApproval(j);
        if (approval.revokedAt || approval.consumedByCommit)
          throw new PendingCommitConflict('approval_changed', '审批已失效或已经使用，未自动提交');
        const current = this.db.run(j.run.id);
        if (proposalHash(current) !== approval.fingerprint || (current.stateVersion ?? 0) !== (j.run.stateVersion ?? 0))
          throw new PendingCommitConflict('candidate_changed', '候选版本或任务状态已改变，未自动提交');
        approval.consumedByCommit = j.id;
        this.db.sql.prepare('UPDATE approvals SET data=? WHERE id=?').run(JSON.stringify(approval), j.approvalId!);
        this.db.sql.prepare('INSERT INTO candidate_commits VALUES(?,?,?,?)').run(j.run.id, proposalHash(j.run), j.id, j.approvalId!);
      }
      for (const c of j.changes) {
        const old = this.db.document(c.path),
          docId = old?.id ?? id(),
          raw = this.object(c.newHash);
        this.db.sql
          .prepare(
            'INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash,bytes=excluded.bytes'
          )
          .run(docId, c.path, c.newHash, raw.length);
        this.db.sql
          .prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?,?)')
          .run(docId, c.newHash, j.createdAt, j.id);
        const indexed = this.db.sql.prepare('SELECT hash,fts_rowid FROM document_fts_rows WHERE path=?').get(c.path);
        if (old) {
          if (indexed?.hash === old.hash) this.db.sql.prepare('DELETE FROM documents_fts WHERE rowid=?').run(indexed.fts_rowid);
          else this.db.sql.prepare('DELETE FROM documents_fts WHERE path=?').run(c.path);
        }
        const indexedRow = this.db.sql
          .prepare('INSERT INTO documents_fts(path,content) VALUES(?,?)')
          .run(c.path, new TextDecoder().decode(raw));
        this.db.sql.prepare('INSERT INTO document_fts_rows VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash,fts_rowid=excluded.fts_rowid').run(c.path, c.newHash, indexedRow.lastInsertRowid);
        indexProse(this.db.sql, c.path, c.newHash, raw.toString('utf8'));
        if (j.run) captureCommittedEdit(this, c.path, c.baseHash, c.newHash, j.run.mode === 'manual' || j.run.revisionCore && this.db.run(j.run.revisionCore.sourceRunId).mode === 'manual' ? 'author' : 'model', j.run.chapter);
      }
      this.db.set('project', j.project);
      if (j.run) this.db.saveRun(j.run);
      const titleSelection = j.run?.planning?.titleSelection;
      if (titleSelection) {
        const child = this.db.run(titleSelection.batchRunId);
        if (child.naming?.sourceRunId !== j.run!.id || titleSelection.batchHash !== tagHash(child.naming.batch) ||
            child.naming.review?.hash !== titleSelection.batchHash || child.naming.review.result.decisions.find(v => v.candidateId === titleSelection.candidate.id)?.verdict !== 'keep')
          throw new ApplicationError('APPROVAL_STALE', '关联书名审核记录已改变，未提交作品方案');
        assertRunTransition(child.status, 'complete');
        child.status = 'complete'; child.accepted = true; child.updatedAt = now();
        this.db.saveRun(child);
      }
      updateFactIndex(this, j.changes.map(change => change.path), j.project.revision);
      for (const c of j.changes) {
        const affected = this.db.sql
          .prepare('SELECT dependent,kind FROM dependencies WHERE source_path=? AND source_hash<>?')
          .all(c.path, c.newHash) as { dependent: string; kind: string }[];
        for (const dependent of affected)
          this.db.sql
            .prepare('INSERT OR IGNORE INTO review_queue VALUES(?,?,?,?)')
            .run(hash(`${j.id}:${c.path}:${dependent.dependent}`), c.path, dependent.dependent, 'pending');
        this.db.sql
          .prepare("DELETE FROM vector_chunks WHERE path=? AND hash<>? AND id NOT LIKE 'fact:%'")
          .run(c.path, c.newHash);
      }
      if (j.run) {
        const sources = [...(j.run.manifest ? contextDependencies(j.run.manifest) : []),
          ...[...(j.run.manifest?.hardConstraints ?? []), ...(j.run.manifest?.retrievedFacts ?? [])].map(fact => ({ path: fact.id, hash: hash(JSON.stringify(fact)) })),
          ...Object.entries(j.run.memoryRepair?.sourceHashes ?? {}).map(([path, hash]) => ({ path, hash }))];
        for (const source of sources)
          for (const c of j.changes.filter(c => /^(05_|06_|07_)/.test(c.path) && c.path !== source.path))
            this.db.sql
              .prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?,?)')
              .run(source.path, source.hash, c.path, c.path.startsWith('07_') ? 'prose' : 'plan');
        const reviewed = j.run.memoryRepair?.completed ?? [];
        for (let i = 0; i < reviewed.length; i++)
          for (const earlier of reviewed.slice(0, i).filter(item => /^(05_|06_)/.test(item.path)))
            if (/^(05_|06_)/.test(reviewed[i].path)) this.db.sql.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?,?)')
              .run(earlier.path, this.db.document(earlier.path)!.hash, reviewed[i].path, 'plan');
      }
      for (const row of this.db.sql.prepare("SELECT id,dependent FROM review_queue WHERE status='pending'").all()) {
        const dependent = String(row.dependent);
        const rowFact = this.db.sql.prepare('SELECT data FROM facts WHERE id=?').get(dependent) ?? this.db.sql.prepare('SELECT data FROM fact_ledgers WHERE id=?').get(dependent);
        const fact = rowFact ? JSON.parse(String(rowFact.data)) as Fact : undefined;
        const resolved = fact
          ? fact.reviewStatus === 'retracted' || fact.state === 'superseded' || fact.reviewStatus === 'accepted' && fact.evidence.every(e => this.db.document(e.path)?.hash === e.hash && !pendingSource(j.project, e.path))
          : !!this.db.document(dependent) && !pendingSource(j.project, dependent);
        if (resolved) this.db.sql.prepare("UPDATE review_queue SET status='complete' WHERE id=?").run(row.id);
      }
      this.db.captureSnapshot(j.id);
      this.db.sql
        .prepare('INSERT INTO materialization_outbox VALUES(?,?,?,NULL)')
        .run(j.id, 'pending', JSON.stringify(j.changes));
      this.db.sql.prepare('INSERT INTO applied_transactions VALUES(?,?)').run(j.id, now());
      this.db.sql.exec('COMMIT');
    } catch (e) {
      this.db.sql.exec('ROLLBACK');
      throw e;
    }
    fault?.('after-database');
    this.materialize(j.id, fault);
  }
  materialize(tx?: string, fault?: (point: string) => void) {
    const rows = this.db.sql
      .prepare(
        `SELECT id,data FROM materialization_outbox WHERE status<>'complete' ${tx ? 'AND id=?' : ''} ORDER BY rowid`
      )
      .all(...(tx ? [tx] : [])) as { id: string; data: string }[];
    if (rows.length) this.invalidateListing();
    for (const row of rows) {
      const changes = JSON.parse(row.data) as Journal['changes'];
      const conflict = changes.find((c) => {
        const current = fileHash(safePath(this.root, c.path));
        if (current === null && c.baseHash !== null && fileHash(safePath(this.root, `.novelclient/preserved/${row.id}-${hash(c.path)}.previous`, true)) === c.baseHash) return false;
        return current !== c.baseHash && current !== c.newHash;
      });
      if (conflict) {
        this.db.sql
          .prepare('UPDATE materialization_outbox SET status=?,error=? WHERE id=?')
          .run('conflict', `外部改稿已保留：${conflict.path}`, row.id);
        continue;
      }
      for (const c of changes) {
        try { preserveAndMaterialize(this, row.id, c, fault); }
        catch (error) {
          this.db.sql.prepare('UPDATE materialization_outbox SET status=?,error=? WHERE id=?').run(error instanceof MaterializationConflict ? 'conflict' : 'pending', error instanceof Error ? error.message : '文件同步失败', row.id);
          return;
        }
        fault?.('file:' + c.path);
      }
      this.db.sql
        .prepare('UPDATE materialization_outbox SET status=?,error=NULL WHERE id=?')
        .run('complete', row.id);
    }
  }
  private recoveryRecords(): CommitRecoveryRecord[] {
    return this.db.sql.prepare("SELECT value FROM kv WHERE key LIKE 'commitRecovery:%'").all()
      .map((row) => JSON.parse(String(row.value)) as CommitRecoveryRecord);
  }
  recoveryConflicts(): CommitRecoveryConflict[] {
    return this.recoveryRecords().filter((record) => record.status === 'blocked')
      .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt) || a.transactionId.localeCompare(b.transactionId))
      .map(({ transactionId, runId, reason, message, paths, detectedAt }) => ({ transactionId, runId, reason, message, paths, detectedAt }));
  }
  private verifyRecoveryRecord(journal: Journal, record?: CommitRecoveryRecord) {
    if (record && (record.transactionId !== journal.id || record.journalHash !== fingerprint(journal)))
      throw new Error('待处理提交记录与原始日志不一致，已停止恢复');
  }
  private recordRecoveryConflict(journal: Journal, error: PendingCommitConflict): CommitRecoveryConflict {
    const previous = this.db.get<CommitRecoveryRecord>(recoveryKey(journal.id));
    this.verifyRecoveryRecord(journal, previous);
    const conflict: CommitRecoveryConflict = {
      transactionId: journal.id, runId: journal.run?.id, reason: error.reason, message: error.message,
      paths: journal.changes.map((change) => change.path), detectedAt: previous?.detectedAt ?? now()
    };
    this.db.transaction(() => {
      this.db.set(recoveryKey(journal.id), { ...conflict, status: 'blocked', journalHash: fingerprint(journal) } satisfies CommitRecoveryRecord);
      if (!previous || previous.reason !== error.reason || previous.message !== error.message)
        this.db.event(journal.run?.id ?? 'project', 'commit-recovery-conflict', error.message, { transactionId: journal.id, reason: error.reason });
    });
    return conflict;
  }
  private completeRecovery(journal: Journal, file: string) {
    const record = this.db.get<CommitRecoveryRecord>(recoveryKey(journal.id));
    if (record) this.db.transaction(() => {
      // Clear the conflict before compacting the journal. A crash between these
      // writes is resolved by applied_transactions without reviving the conflict.
      this.db.set(recoveryKey(journal.id), { ...record, status: 'resolved', resolvedAt: now(), actor: 'local-author' });
      this.db.event(journal.run?.id ?? 'project', 'commit-recovery-resolved', '已核验并恢复原批准提交', { transactionId: journal.id });
    });
    atomicWrite(file, completedJournal(journal));
    this.invalidateListing();
  }
  private pendingRecoveryJournal(transactionId: string) {
    const record = this.db.get<CommitRecoveryRecord>(recoveryKey(transactionId));
    if (!record) throw new ApplicationError('VALIDATION_ERROR', '此提交没有待处理的恢复记录', ['refresh']);
    const file = safePath(this.root, `.novelclient/transactions/${transactionId}.json`, true);
    const journal = JSON.parse(readUtf8(file)) as Journal;
    if (journal.id !== transactionId || journal.state !== 'prepared') throw new Error('待处理提交日志身份或状态不一致');
    this.verifyJournal(journal);
    this.journalApproval(journal);
    this.verifyRecoveryRecord(journal, record);
    return { file, journal, record };
  }
  recoveryPreview(transactionId: string, relative: string): { path: string; accepted: string; current: string | null; candidate: string } {
    const { journal } = this.pendingRecoveryJournal(transactionId);
    const change = journal.changes.find((entry) => entry.path === relative);
    if (!change) throw new ApplicationError('PERMISSION_DENIED', '此文件不在待处理提交中');
    const decode = (raw: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(raw);
    const file = safePath(this.root, relative), accepted = this.db.document(relative)?.hash;
    return { path: relative, accepted: accepted ? decode(this.object(accepted)) : '',
      current: fs.existsSync(file) ? decode(fs.readFileSync(file)) : null, candidate: decode(this.object(change.newHash)) };
  }
  retryRecovery(transactionId: string): { recovered: boolean; conflict?: CommitRecoveryConflict } {
    const previous = this.db.get<CommitRecoveryRecord>(recoveryKey(transactionId));
    if (previous?.status === 'resolved' && this.db.sql.prepare('SELECT 1 FROM applied_transactions WHERE id=?').get(transactionId)) {
      this.materialize(transactionId);
      this.invalidateListing();
      return { recovered: true };
    }
    const { file, journal, record } = this.pendingRecoveryJournal(transactionId);
    if (record.status !== 'blocked') throw new ApplicationError('APPROVAL_STALE', '此提交已放弃，不能复用原批准恢复', ['refresh']);
    try {
      this.applyJournal(journal);
    } catch (error) {
      if (error instanceof PendingCommitConflict) return { recovered: false, conflict: this.recordRecoveryConflict(journal, error) };
      throw error;
    }
    this.completeRecovery(journal, file);
    return { recovered: true };
  }
  abandonRecovery(transactionId: string): void {
    const { journal, record } = this.pendingRecoveryJournal(transactionId);
    if (record.status === 'abandoned') return;
    if (record.status !== 'blocked' || this.db.sql.prepare('SELECT 1 FROM applied_transactions WHERE id=?').get(transactionId))
      throw new ApplicationError('APPROVAL_STALE', '已生效的正式提交不能通过放弃恢复撤销', ['refresh']);
    const approval = this.journalApproval(journal), resolvedAt = now();
    this.db.transaction(() => {
      if (approval && !approval.consumedByCommit && !approval.revokedAt) {
        approval.revokedAt = resolvedAt;
        this.db.sql.prepare('UPDATE approvals SET data=? WHERE id=?').run(JSON.stringify(approval), journal.approvalId!);
      }
      this.db.set(recoveryKey(transactionId), { ...record, status: 'abandoned', resolvedAt, actor: 'local-author' });
      this.db.event(journal.run?.id ?? 'project', 'commit-recovery-abandoned', '作者放弃此次未生效提交；原候选、日志与外部文件均已保留', { transactionId });
    });
  }
  recover(): string[] {
    const dir = safePath(this.root, '.novelclient/transactions', true);
    const messages: string[] = [];
    const journals: { p: string; j: Journal }[] = [];
    for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!file.endsWith('.json')) continue;
      const p = path.join(dir, file), j = JSON.parse(readUtf8(p)) as Journal;
      if (file !== `${j.id}.json` || !['prepared', 'committed'].includes(j.state)) throw new Error('提交日志身份或状态无效');
      if (j.state === 'prepared') journals.push({ p, j });
    }
    for (const record of this.recoveryRecords())
      if (record.status !== 'resolved' && !journals.some(({ j }) => j.id === record.transactionId))
        throw new Error('待处理提交的原始日志缺失，已停止恢复');
    journals.sort((a, b) => a.j.createdAt.localeCompare(b.j.createdAt));
    for (const { p, j } of journals) {
      this.verifyJournal(j);
      if (this.db.sql.prepare('SELECT 1 FROM applied_transactions WHERE id=?').get(j.id)) {
        this.applyJournal(j);
        this.completeRecovery(j, p);
        messages.push(`已恢复提交 ${j.id}`);
        continue;
      }
      this.journalApproval(j);
      const record = this.db.get<CommitRecoveryRecord>(recoveryKey(j.id));
      this.verifyRecoveryRecord(j, record);
      if (record?.status === 'abandoned') continue;
      if (record?.status === 'blocked') { messages.push(record.message); continue; }
      if (record?.status === 'resolved') throw new Error('已恢复提交缺少正式生效记录');
      try {
        this.applyJournal(j);
      } catch (error) {
        if (!(error instanceof PendingCommitConflict)) throw error;
        messages.push(this.recordRecoveryConflict(j, error).message);
        continue;
      }
      this.completeRecovery(j, p);
      messages.push(`已恢复提交 ${j.id}`);
    }
    this.materialize();
    if (this.db.project() && !this.db.get('headSnapshot')) this.db.captureSnapshot();
    return messages;
  }
}
