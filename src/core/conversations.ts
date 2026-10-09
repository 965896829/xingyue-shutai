import fs from 'node:fs';
import { id, now, hash } from './domain';
import { atomicWrite, fileHash, FileStore, safePath } from './storage';
import type {
  Conversation,
  ConversationMessage,
  ConversationTurn,
  ActionProposal,
  DraftArtifact
} from '../shared/assistant';

type Rows = {
  conversations: Conversation;
  conversation_messages: ConversationMessage;
  conversation_turns: ConversationTurn;
  action_proposals: ActionProposal;
  draft_artifacts: DraftArtifact;
};
export class Conversations {
  constructor(readonly store: FileStore) {}
  all<K extends keyof Rows>(table: K, conversationId?: string): Rows[K][] {
    return (
      this.store.db.sql
        .prepare(
          `SELECT data FROM ${table}${conversationId ? ' WHERE conversation_id=?' : ''} ORDER BY rowid`
        )
        .all(...(conversationId ? [conversationId] : [])) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  get<K extends keyof Rows>(table: K, key: string): Rows[K] {
    const row = this.store.db.sql.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key) as
      { data: string } | undefined;
    if (!row) throw new Error('记录不存在，请刷新后重试');
    return JSON.parse(row.data);
  }
  save<K extends keyof Rows>(table: K, row: Rows[K]) {
    if ('conversationId' in row && table !== 'draft_artifacts')
      this.store.db.sql
        .prepare(
          `INSERT INTO ${table}(id,conversation_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`
        )
        .run(row.id, row.conversationId, JSON.stringify(row));
    else
      this.store.db.sql
        .prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
        .run(row.id, JSON.stringify(row));
    return row;
  }
  transaction<T>(fn: () => T): T {
    this.store.db.sql.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.store.db.sql.exec('COMMIT');
      return result;
    } catch (e) {
      this.store.db.sql.exec('ROLLBACK');
      throw e;
    }
  }
  create(title = '创作讨论', online = true) {
    return this.save('conversations', {
      id: id(),
      title: title.trim().slice(0, 80) || '创作讨论',
      archived: false,
      online,
      createdAt: now(),
      updatedAt: now()
    });
  }
  recover() {
    for (const turn of this.all('conversation_turns'))
      if (turn.status === 'running') {
        turn.status = 'unknown';
        turn.error = '上次运行中断，请先核对服务商请求和费用，再决定是否重新发送。';
        this.save('conversation_turns', turn);
        const message = this.get('conversation_messages', turn.messageId);
        message.status = 'unknown';
        this.save('conversation_messages', message);
      }
    const pending = this.store.db.get<{ draft: DraftArtifact; baseHash: string | null } | null>(
      'pendingDraft'
    );
    if (pending) this.finishDraft(pending.draft, pending.baseHash);
  }
  private finishDraft(draft: DraftArtifact, baseHash: string | null) {
    const target = safePath(this.store.root, draft.path),
      actual = fileHash(target);
    if (actual !== baseHash && actual !== draft.hash)
      throw new Error('草稿恢复遇到外部修改，请保留文件并核对历史版本');
    if (actual !== draft.hash) atomicWrite(target, this.store.object(draft.hash));
    this.transaction(() => {
      this.save('draft_artifacts', draft);
      this.store.db.set('pendingDraft', null);
    });
    return draft;
  }
  saveDraft(a: {
    id?: string;
    title: string;
    content: string;
    baseHash?: string;
    conversationId: string;
    messageId: string;
  }) {
    if (!a.content.trim()) throw new Error('草稿不能为空');
    this.get('conversations', a.conversationId);
    const source = this.get('conversation_messages', a.messageId);
    if (source.conversationId !== a.conversationId) throw new Error('草稿来源不属于此聊天');
    const previous = a.id ? this.get('draft_artifacts', a.id) : undefined;
    if (previous && (previous.conversationId !== a.conversationId || previous.messageId !== a.messageId))
      throw new Error('不能改变草稿来源');
    const key = previous?.id ?? id();
    const relative =
      previous?.path ??
      `00_作者输入/自由草稿/${a.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 60) || '草稿'}_${key.slice(0, 8)}.md`;
    const actual = fileHash(safePath(this.store.root, relative));
    if (previous ? actual !== a.baseHash : actual !== null)
      throw new Error('草稿已有外部修改，请重新读取并比较，未覆盖文件');
    const version = this.store.putObject(a.content);
    // Preserve an externally edited version too before replacing it after an explicit reload.
    const versions = [...(previous?.versions ?? [])];
    if (actual && !versions.some((v) => v.hash === actual))
      versions.push({
        hash: this.store.putObject(fs.readFileSync(safePath(this.store.root, relative))),
        at: now()
      });
    if (!versions.some((v) => v.hash === version)) versions.push({ hash: version, at: now() });
    const draft: DraftArtifact = {
      id: key,
      title: a.title.slice(0, 80),
      path: relative,
      conversationId: a.conversationId,
      messageId: a.messageId,
      hash: version,
      createdAt: previous?.createdAt ?? now(),
      updatedAt: now(),
      versions
    };
    this.store.db.set('pendingDraft', { draft, baseHash: actual });
    return this.finishDraft(draft, actual);
  }
  readDraft(key: string, version?: string) {
    const draft = this.get('draft_artifacts', key);
    if (version && !draft.versions.some((v) => v.hash === version)) throw new Error('草稿版本不存在');
    const content = version
      ? this.store.object(version).toString('utf8')
      : this.store.read(draft.path).content;
    return { ...draft, content, currentHash: hash(content) };
  }
}
