import { z } from 'zod';
import type { Conversations } from './conversations';
import { hash } from './domain';
import { queryTerms } from './text-search';
import { visibleFact, writingScope } from './memory-studio';
import type { ConversationTurn } from '../shared/assistant';

const pageSize = z.number().int().min(1).max(8000).default(4000);
const cursorSchema = z.object({ version: z.literal(1), chat: z.string(), binding: z.string(), offset: z.number().int().nonnegative() });
const encode = (chat: string, binding: string, offset: number) => Buffer.from(JSON.stringify({ version: 1, chat, binding, offset })).toString('base64url');
function cursor(value: unknown, chat: string, binding: string) {
  if (value === undefined) return 0;
  const raw = z.string().max(2000).parse(value);
  let parsed: z.infer<typeof cursorSchema>;
  try { parsed = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))); }
  catch { throw new Error('历史读取位置无效，请重新定位消息'); }
  if (parsed.chat !== chat || parsed.binding !== binding) throw new Error('历史消息或查询已变化，请重新定位，未混用旧分页');
  return parsed.offset;
}
export function historyChat(records: Conversations, current: string, allowed: string[], requested: unknown, restricted: boolean) {
  if (restricted) throw new Error('人物视角不能读取未经知情筛选的聊天历史');
  const chat = requested === undefined ? current : z.string().min(1).parse(requested);
  if (chat !== current && !allowed.includes(chat)) throw new Error('作者未选择引用此聊天，不能读取其未采纳方案');
  records.get('conversations', chat);
  return chat;
}
export function assertHistoryReads(records: Conversations, reads: ConversationTurn['historyReads']) {
  for (const read of reads ?? []) {
    const message = records.get('conversation_messages', read.messageId);
    if (message.conversationId !== read.conversationId || hash(message.content) !== read.hash)
      throw new Error('已回读的历史原文发生变化，请重新核对；未混用新旧版本');
  }
}
export function readHistoryMessage(records: Conversations, chat: string, args: Record<string, unknown>) {
  const message = records.get('conversation_messages', z.string().min(1).parse(args.messageId));
  if (message.conversationId !== chat) throw new Error('此消息不属于允许读取的聊天');
  const version = hash(message.content), points = Array.from(message.content);
  if (args.hash !== undefined && args.hash !== version) throw new Error('历史消息版本已变化，请重新定位');
  const start = cursor(args.cursor, chat, `${message.id}:${version}`), limit = pageSize.parse(args.limit);
  if (start > points.length) throw new Error('历史读取位置超出原文');
  const end = Math.min(points.length, start + limit);
  return { messageId: message.id, conversationId: chat, hash: version, role: message.role, status: message.status,
    content: points.slice(start, end).join(''), start, end, totalCharacters: points.length, complete: end === points.length,
    nextCursor: end < points.length ? encode(chat, `${message.id}:${version}`, end) : null,
    meaning: '历史讨论原文；尚未采纳的意见不构成作品事实' };
}
export function searchHistory(records: Conversations, chat: string, args: Record<string, unknown>, excludeTurn: string) {
  const query = z.string().max(500).parse(args.query ?? ''), limit = z.number().int().min(1).max(20).default(8).parse(args.limit);
  const exactId = args.messageId === undefined ? undefined : z.string().min(1).parse(args.messageId);
  const scope = writingScope(records.store.db.project());
  const aliases = records.store.db.facts(scope).filter(f => visibleFact(f, scope) && [f.subject, ...f.aliases].some(n => n && query.includes(n)))
    .flatMap(f => [f.subject, ...f.aliases]);
  const terms = [...new Set([...queryTerms(query).filter(t => Array.from(t).length > 1), ...aliases.map(s => s.toLowerCase())])];
  const rows = records.all('conversation_messages', chat).filter(m => m.turnId !== excludeTurn);
  const ranked = rows.map((m, sequence) => {
    const text = m.content.toLowerCase(), exact = query.trim() ? text.indexOf(query.toLowerCase()) : -1;
    const matches = terms.filter(t => text.includes(t));
    const score = exactId ? Number(m.id === exactId) : !query.trim() ? 1 : (exact >= 0 ? 1000 : 0) + matches.length;
    const at = exact >= 0 ? exact : matches.length ? text.indexOf(matches[0]) : 0;
    const start = Math.max(0, Array.from(m.content.slice(0, at)).length - 100);
    return { m, sequence, score, start, hash: hash(m.content) };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || b.sequence - a.sequence);
  const binding = hash(JSON.stringify({ query, exactId, rows: ranked.map(r => [r.m.id, r.hash, r.m.status]) }));
  const offset = cursor(args.cursor, chat, binding);
  if (offset > ranked.length) throw new Error('历史搜索位置超出结果，请重新查询');
  return { items: ranked.slice(offset, offset + limit).map(({ m, hash: version, start }) => {
    const points = Array.from(m.content), end = Math.min(points.length, start + 700);
    return { id: m.id, conversationId: chat, role: m.role, status: m.status, hash: version,
      content: points.slice(start, end).join(''), start, end, totalCharacters: points.length,
      truncated: start > 0 || end < points.length, read: { tool: 'read_history_message', messageId: m.id, conversationId: chat, hash: version } };
  }), totalMatches: ranked.length, nextCursor: offset + limit < ranked.length ? encode(chat, binding, offset + limit) : null };
}
