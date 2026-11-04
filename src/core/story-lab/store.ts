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
  type LabSession,
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
      recoverAttempts(this.journal);
      for (const request of this.all('requests').filter((r) => r.status === 'running')) {
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
  version(sessionId: string, id: string) {
    const row = this.get('versions', id);
    if (!row || row.sessionId !== sessionId) throw new Error('版本不属于此实验');
    return row;
  }
  detail(id: string): LabDetail {
    return {
      session: this.session(id),
      versions: this.all('versions', id),
      messages: this.all('messages', id),
      requests: this.all('requests', id).map((request) => ({
        ...request,
        // Older lab records kept the diagnostic only in the gateway journal.
        // Expose that evidence without rewriting their status or resending.
        failure: request.failure ?? (request.status === 'unknown'
          ? labFailure(attempts(this.journal, request.id).at(-1)?.failure) : undefined)
      }))
    };
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
        const base = input.baseVersionId ? this.version(request.sessionId, input.baseVersionId) : undefined;
        const kind =
          input.action === 'continue'
            ? source!.kind
            : input.action === 'prose'
              ? 'prose'
              : input.action === 'discuss'
                ? 'discussion'
                : base?.kind === 'prose' && input.action === 'revise'
                  ? 'prose'
                  : 'blueprint';
        let content = request.response;
        if (input.action === 'revise' && input.selection && base)
          content =
            base.content.slice(0, input.selection.start) +
            request.response +
            base.content.slice(input.selection.end);
        if (input.action === 'continue' && source) content = source.content + '\n\n' + request.response;
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
          baseVersionId:
            input.action === 'continue'
              ? source!.id
              : input.action === 'prose'
                ? request.baseProseVersionId
                : input.baseVersionId,
          requestId: request.id,
          createdAt: request.endedAt!,
          source: 'model',
          partial: request.status !== 'complete'
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
