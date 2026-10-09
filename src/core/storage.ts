import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hash, id, now } from './domain';
import type { Change, DocumentInfo, Fact, ProjectState, Run, RunEvent } from '../shared/types';

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
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw new Error(`禁止通过符号链接或目录联接访问：${relative}`);
  }
  return target;
}
export function atomicWrite(file: string, data: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${id()}.tmp`,
    fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
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
  constructor(readonly filename: string) {
    this.sql = new DatabaseSync(filename);
    const schema = (this.sql.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (schema > 2) {
      this.sql.close();
      throw new Error(`数据库版本 ${schema} 高于本客户端支持版本，已停止打开且未修改原数据库`);
    }
    // VACUUM INTO captures WAL contents too; never copy a live SQLite main file alone.
    if (schema === 1) {
      const backup = `${filename}.before-v2-${id()}.bak`;
      this.sql.prepare('VACUUM INTO ?').run(backup);
    }
    try {
      this.sql
        .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,hash TEXT,bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(document_id TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,tx TEXT NOT NULL,PRIMARY KEY(document_id,hash));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,at TEXT NOT NULL,data TEXT);
      CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,data TEXT NOT NULL,source_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applied_transactions(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(path UNINDEXED,content,tokenize='trigram');
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS message_conversation ON conversation_messages(conversation_id);
      CREATE TABLE IF NOT EXISTS conversation_turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS action_proposals(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draft_artifacts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      PRAGMA user_version=2; COMMIT;`);
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
  saveRun(run: Run) {
    this.sql
      .prepare('INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(run.id, JSON.stringify(run));
  }
  run(runId: string): Run {
    const r = this.sql.prepare('SELECT data FROM runs WHERE id=?').get(runId) as { data: string } | undefined;
    if (!r) throw new Error('运行记录不存在');
    return JSON.parse(r.data);
  }
  runs(): Run[] {
    return (
      this.sql.prepare('SELECT data FROM runs ORDER BY rowid DESC LIMIT 100').all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
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
  replaceFacts(facts: Fact[], revision: number) {
    this.sql.exec('DELETE FROM facts');
    const insert = this.sql.prepare('INSERT INTO facts VALUES(?,?,?)');
    for (const f of facts) insert.run(f.id, JSON.stringify(f), f.evidence.map((e) => e.hash).join(','));
    this.set('indexRevision', revision);
  }
  facts(): Fact[] {
    return (this.sql.prepare('SELECT data FROM facts').all() as { data: string }[]).map((r) =>
      JSON.parse(r.data)
    );
  }
  close() {
    this.sql.close();
  }
}
interface Journal {
  id: string;
  state: 'prepared' | 'committed';
  createdAt: string;
  changes: { path: string; baseHash: string | null; newHash: string }[];
  project: ProjectState;
  run?: Run;
}
export class FileStore {
  readonly root: string;
  readonly control: string;
  readonly db: Database;
  private lockOwned = false;
  private fingerprints = new Map<string, { signature: string; hash: string; bytes: number }>();
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
    if (fs.existsSync(lock)) {
      const old = JSON.parse(readUtf8(lock)) as { pid: number };
      let alive = true;
      try {
        process.kill(old.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (alive) throw new Error('这部作品正在另一个窗口或进程中打开，请先关闭它');
      fs.unlinkSync(lock);
    }
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: now() }), { flag: 'wx' });
    this.lockOwned = true;
  }
  private releaseLock() {
    if (this.lockOwned) {
      const f = path.join(this.control, 'write-lock.json');
      if (fs.existsSync(f)) fs.unlinkSync(f);
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
  scan(): DocumentInfo[] {
    const found = new Map<string, DocumentInfo>();
    const walk = (dir: string, prefix = '') => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          ent.name === '.novelclient' ||
          ent.name === 'node_modules' ||
          ent.name === '.git' ||
          ent.isSymbolicLink()
        )
          continue;
        const rel = prefix + ent.name;
        if (rel === '00_作者输入/自由草稿') continue;
        if (ent.isDirectory()) walk(path.join(dir, ent.name), rel + '/');
        else if (/\.md$/i.test(ent.name)) {
          const file = safePath(this.root, rel),
            stat = fs.statSync(file, { bigint: true }),
            signature = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
          let cached = this.fingerprints.get(rel);
          if (!cached || cached.signature !== signature) {
            const raw = fs.readFileSync(file);
            cached = { signature, hash: hash(raw), bytes: raw.length };
            this.fingerprints.set(rel, cached);
          }
          const h = cached.hash,
            old = this.db.document(rel);
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
    for (const d of this.db.acceptedDocuments())
      if (!found.has(d.path))
        found.set(d.path, { ...d, acceptedHash: d.hash, hash: null, status: 'missing' });
    return [...found.values()].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
  }
  commit(changes: Change[], project: ProjectState, run?: Run, fault?: (point: string) => void): string {
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
    const journal: Journal = { id: tx, state: 'prepared', createdAt: now(), changes: entries, project, run };
    const jp = safePath(this.root, `.novelclient/transactions/${tx}.json`, true);
    atomicWrite(jp, JSON.stringify(journal, null, 2));
    fault?.('prepared');
    this.applyJournal(journal, fault);
    journal.state = 'committed';
    atomicWrite(jp, JSON.stringify(journal, null, 2));
    fault?.('committed');
    return tx;
  }
  private applyJournal(j: Journal, fault?: (point: string) => void) {
    if (this.db.sql.prepare('SELECT 1 FROM applied_transactions WHERE id=?').get(j.id)) return;
    for (const c of j.changes) {
      const h = fileHash(safePath(this.root, c.path));
      if (h !== c.baseHash && h !== c.newHash)
        throw new Error(`恢复遇到外部改稿，已保留，请先比较：${c.path}`);
    }
    for (const c of j.changes) {
      const f = safePath(this.root, c.path);
      if (fileHash(f) !== c.newHash) atomicWrite(f, this.object(c.newHash));
      fault?.('file:' + c.path);
    }
    fault?.('before-database');
    this.db.sql.exec('BEGIN IMMEDIATE');
    try {
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
        this.db.sql.prepare('DELETE FROM documents_fts WHERE path=?').run(c.path);
        this.db.sql
          .prepare('INSERT INTO documents_fts(path,content) VALUES(?,?)')
          .run(c.path, new TextDecoder().decode(raw));
      }
      this.db.set('project', j.project);
      if (j.run) this.db.saveRun(j.run);
      this.db.sql.prepare('INSERT INTO applied_transactions VALUES(?,?)').run(j.id, now());
      this.db.set('indexRevision', -1);
      this.db.sql.exec('COMMIT');
    } catch (e) {
      this.db.sql.exec('ROLLBACK');
      throw e;
    }
    fault?.('after-database');
  }
  recover(): string[] {
    const dir = safePath(this.root, '.novelclient/transactions', true);
    if (!fs.existsSync(dir)) return [];
    const messages: string[] = [];
    const journals = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ p: path.join(dir, f), j: JSON.parse(readUtf8(path.join(dir, f))) as Journal }))
      .sort((a, b) => a.j.createdAt.localeCompare(b.j.createdAt));
    for (const { p, j } of journals)
      if (j.state === 'prepared') {
        this.applyJournal(j);
        j.state = 'committed';
        atomicWrite(p, JSON.stringify(j, null, 2));
        messages.push(`已恢复提交 ${j.id}`);
      }
    return messages;
  }
  snapshotFile(relative: string) {
    const raw = fs.readFileSync(safePath(this.root, relative));
    return this.putObject(raw);
  }
}
