import { inheritedLabRules } from '../../shared/lab-material';
import { describeOperation, mergeLabFragment } from './operation';
import fs from 'node:fs';
import path from 'node:path';
import { FileStore, atomicWrite, safePath } from '../storage';
import { attempts, recoverAttempts } from '../runtime/model-gateway';
import {
  labSessionSchema,
  labVersionSchema,
  labMessageSchema,
  labRequestSchema,
  labFailure,
  type LabSession, type LabCursor,
  type LabVersion,
  type LabMessage,
  type LabRequest,
  type LabDetail
} from '../../shared/story-lab';

type Records = { sessions: LabSession; versions: LabVersion; messages: LabMessage; requests: LabRequest };
const schemas = {
  sessions: labSessionSchema,
  versions: labVersionSchema,
  messages: labMessageSchema,
  requests: labRequestSchema
};
export class LabStore {
  readonly journal: FileStore;
  constructor(readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
    this.journal = new FileStore(root);
    try {
      for (const table of ['sessions', 'versions', 'messages', 'requests'])
        this.journal.db.sql.exec(
          `CREATE TABLE IF NOT EXISTS lab_${table} (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS lab_${table}_session ON lab_${table}(session_id)`
        );
      this.journal.db.sql.exec("CREATE INDEX IF NOT EXISTS lab_request_state ON lab_requests(session_id,json_extract(data,'$.status'),json_extract(data,'$.usage.cost')); CREATE INDEX IF NOT EXISTS lab_discussion ON lab_messages(session_id,json_extract(data,'$.action'));");
      recoverAttempts(this.journal);
      for (const row of this.journal.db.sql.prepare("SELECT data FROM lab_requests WHERE json_extract(data,'$.status')='running'").all()) {
        const request = labRequestSchema.parse(JSON.parse(String(row.data)));
        const rows = attempts(this.journal, request.id),
          completed = rows.find((r) => r.status === 'complete');
        if (completed?.responseRef) {
          const result = JSON.parse(this.journal.object(completed.responseRef).toString()).result;
          request.response = result.text;
          request.status =
            result.stop === 'length' ? 'length' : result.stop === 'filtered' ? 'filtered' : 'complete';
          request.usage = result.usage;
        } else {
          request.status = rows.some((r) => r.status !== 'not_sent') ? 'unknown' : 'not_sent';
          request.error =
            request.status === 'unknown'
              ? '应用退出或连接中断，远端结果与费用未知；未自动重发。'
              : '退出前没有发送请求。';
        }
        request.attempts = rows.filter((r) => r.status !== 'not_sent').length;
        request.endedAt = new Date().toISOString();
        this.finish(request);
      }
    } catch (error) {
      this.journal.close();
      throw error;
    }
  }
  all<K extends keyof Records>(table: K, sessionId?: string): Records[K][] {
    const rows = sessionId
      ? this.journal.db.sql
          .prepare(`SELECT data FROM lab_${table} WHERE session_id=? ORDER BY rowid`)
          .all(sessionId)
      : this.journal.db.sql.prepare(`SELECT data FROM lab_${table} ORDER BY rowid`).all();
    return rows.map((row) => schemas[table].parse(JSON.parse(String(row.data))) as Records[K]);
  }
  get<K extends keyof Records>(table: K, id: string): Records[K] | undefined {
    const row = this.journal.db.sql.prepare(`SELECT data FROM lab_${table} WHERE id=?`).get(id);
    return row ? (schemas[table].parse(JSON.parse(String(row.data))) as Records[K]) : undefined;
  }
  save<K extends keyof Records>(table: K, record: Records[K]) {
    const value = schemas[table].parse(record);
    this.journal.db.sql
      .prepare(`INSERT INTO lab_${table} VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
      .run(value.id, 'sessionId' in value ? value.sessionId : value.id, JSON.stringify(value));
  }
  session(id: string) {
    const row = this.get('sessions', id);
    if (!row) throw new Error('实验会话不存在');
    return row;
  }
  version(sessionId: string, id: string): LabVersion {
    const row = this.get('versions', id);
    if (!row || row.sessionId !== sessionId) throw new Error('版本不属于此实验');
    if (!row.operation && row.source === 'edit' && row.baseVersionId) {
      const parent = this.version(sessionId, row.baseVersionId);
      return { ...row, partial: parent.partial, operation: parent.operation && { ...parent.operation,
        ...(parent.kind === 'prose' && !parent.partial ? { proseParentId: parent.id } : {}) } };
    }
    if (row.operation || !row.requestId) return row;
    // Reconstruct historical candidates from the immutable request and its exact base.
    const request = this.get('requests', row.requestId);
    if (!request) return row;
    try {
      const operation = describeOperation(this, request.input, request.baseProseVersionId);
      const base = operation.baseId ? this.version(sessionId, operation.baseId) : undefined;
      const source = request.input.sourceVersionId ? this.version(sessionId, request.input.sourceVersionId) : undefined;
      const raw = (request.action === 'continue' ? source?.content ?? '' : '') + request.response;
      return { ...row, operation, content: row.partial ? raw : mergeLabFragment(operation, base, raw),
        baseVersionId: row.kind === 'prose' ? operation.proseParentId : operation.baseId };
    } catch { return { ...row, partial: true }; }
  }
  latestVersion(id: string) {
    const key = this.latestVersionId(id);
    return key ? this.version(id, key) : undefined;
  }
  discussions(id: string) {
    return this.journal.db.sql.prepare("SELECT data FROM lab_messages WHERE session_id=? AND json_extract(data,'$.action')='discuss' ORDER BY rowid DESC LIMIT 6")
      .all(id).reverse().map(r => labMessageSchema.parse(JSON.parse(String(r.data))));
  }
  hasUnknown(id: string) {
    return !!this.journal.db.sql.prepare("SELECT 1 FROM lab_requests WHERE session_id=? AND (json_extract(data,'$.status')='unknown' OR (json_extract(data,'$.status')='cancelled' AND json_extract(data,'$.usage.cost') IS NULL)) LIMIT 1").get(id);
  }
  stamp(id: string) {
    const request = this.journal.db.sql.prepare("SELECT id,json_extract(data,'$.sequence') AS seq,json_extract(data,'$.status') AS status FROM lab_requests WHERE session_id=? ORDER BY rowid DESC LIMIT 1").get(id);
    return JSON.stringify([this.session(id).revision, request?.id, request?.seq, request?.status]);
  }
  request(id: string, requestId: string) {
    const req = this.get('requests', requestId);
    if (!req || req.sessionId !== id) throw new Error('请求不属于此实验');
    return { ...req, failure: req.failure ?? (req.status === 'unknown' ? labFailure(attempts(this.journal, req.id).at(-1)?.failure) : undefined) };
  }
  detail(id: string, before?: LabCursor): LabDetail {
    const session = this.session(id), older = { versions: 0, messages: 0, requests: 0 };
    const page = <K extends keyof LabCursor>(table: K): Records[K][] => {
      const projection = table === 'versions' ? "json_remove(json_set(data,'$.content',''),'$.materialRules','$.operation.selected')" :
        table === 'requests' ? "CASE WHEN json_extract(data,'$.status')='running' THEN data ELSE json_remove(json_set(data,'$.response','','$.context.system','','$.context.user','','$.context.sources',json('[]')),'$.input.selection','$.operation.selected') END" :
          "CASE WHEN json_extract(data,'$.role')='assistant' AND length(json_extract(data,'$.content'))>480 THEN json_set(data,'$.content',substr(json_extract(data,'$.content'),1,480),'$.excerpt',json('true')) ELSE data END";
      const rows = this.journal.db.sql.prepare('SELECT rowid,' + projection + ' AS data FROM lab_' + table + ' WHERE session_id=? AND rowid < ? ORDER BY rowid DESC LIMIT 13')
        .all(id, before?.[table] ?? Number.MAX_SAFE_INTEGER);
      const head = rows.slice(0, 12);
      if (rows.length > head.length) older[table] = Number(head.at(-1)!.rowid);
      return head.reverse().map(r => schemas[table].parse(JSON.parse(String(r.data))) as Records[K]);
    };
    const versions = page('versions'), messages = page('messages'), requests = page('requests').map(req => req.status === 'unknown' && !req.failure
      ? { ...req, failure: labFailure(attempts(this.journal, req.id).at(-1)?.failure) } : req);
    if (!before) for (const key of new Set([versions.at(-1)?.id, session.currentVersionId, session.currentProseId, this.latestVersionId(id)])) {
      if (!key) continue;
      const full = this.version(id, key), index = versions.findIndex(v => v.id === key);
      if (index >= 0) versions[index] = full; else versions.unshift(full);
    }
    return { session, versions, messages, requests, older: Object.values(older).some(Boolean) ? older : undefined,
      stamp: this.stamp(id), hasUnknown: this.hasUnknown(id) };
  }
  private latestVersionId(id: string) {
    return this.journal.db.sql.prepare("SELECT id FROM lab_versions WHERE session_id=? AND json_extract(data,'$.kind')!='discussion' ORDER BY rowid DESC LIMIT 1").get(id)?.id as string | undefined;
  }
  checkRevision(session: LabSession, expected: number) {
    if (session.revision !== expected) throw new Error('实验已更新，请刷新后再操作；原稿未覆盖。');
  }
  update(session: LabSession) {
    session.revision++;
    session.updatedAt = new Date().toISOString();
    this.save('sessions', session);
  }
  finish(request: LabRequest) {
    this.journal.db.transaction(() => {
      if (request.response && !request.versionId) {
        const input = request.input;
        const source = input.sourceVersionId
          ? this.version(request.sessionId, input.sourceVersionId)
          : undefined;
        const operation = request.operation ?? describeOperation(this, input, request.baseProseVersionId);
        const base = operation.baseId ? this.version(request.sessionId, operation.baseId) : undefined;
        const kind = operation.action === 'prose' || operation.action === 'revise' && base?.kind === 'prose' ? 'prose' :
          operation.action === 'discuss' ? 'discussion' : 'blueprint';
        const partial = request.status !== 'complete';
        const raw = (input.action === 'continue' && source ? source.content : '') + request.response;
        const content = partial ? raw : mergeLabFragment(operation, base, raw);
        request.operation = operation;
        const title = {
          blueprint: '作品构想',
          prose: '正文试稿',
          discuss: '讨论候选',
          revise: '局部修改',
          expand: '展开候选',
          continue: '继续片段'
        }[input.action];
        const version: LabVersion = {
          id: crypto.randomUUID(),
          sessionId: request.sessionId,
          kind,
          title,
          content,
          operation,
          materialRules: kind === 'blueprint' && !partial ? inheritedLabRules(content, base) : undefined,
          baseVersionId: kind === 'prose' ? operation.proseParentId : source && !source.partial ? source.id : operation.baseId,
          requestId: request.id,
          createdAt: request.endedAt!,
          source: 'model',
          partial
        };
        this.save('versions', version);
        request.versionId = version.id;
        this.save('messages', {
          id: crypto.randomUUID(),
          sessionId: request.sessionId,
          requestId: request.id,
          role: 'assistant',
          content: request.response,
          versionId: version.id,
          action: request.action,
          createdAt: version.createdAt
        });
      }
      this.save('requests', request);
    });
  }
  export(sessionId: string, versionId: string | undefined, requirementsOnly: boolean, format: 'md' | 'txt') {
    const session = this.session(sessionId);
    const requirements = [
      '# 创作要求',
      session.requirements.idea,
      `全书：${session.requirements.targetWords || '未指定'}；单章：${session.requirements.chapterWords || '未指定'}`,
      `必须保留：${session.requirements.keep}`,
      `不想出现：${session.requirements.avoid}`,
      session.requirements.existing,
      '# 后续保留',
      ...session.pins
    ].join('\n\n');
    const content = requirementsOnly
      ? requirements
      : this.version(sessionId, versionId ?? session.currentVersionId ?? '').content;
    const filename = `${sessionId}-${crypto.randomUUID()}.${format}`;
    const target = safePath(this.root, `exports/${filename}`);
    atomicWrite(target, content);
    return { content, filename, path: path.resolve(target) };
  }
  close() {
    this.journal.close();
  }
}
