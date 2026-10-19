import { z } from 'zod';
import type { FileStore } from '../storage';
import type { ToolCall, ToolDefinition } from '../../shared/types';
import { ApplicationError } from '../../shared/errors';
import { fingerprint } from './canonical';
import { RequestError } from '../provider';

export interface ToolTicket {
  id: string; runId: string; attemptId: string; toolName: string; version: 1;
  argsHash: string; effect: 'read' | 'draft_write' | 'candidate_proposal';
  status: 'started' | 'complete'; result?: string; createdAt: string;
}
export function beginTool(store: FileStore, runId: string, call: ToolCall, definitions: ToolDefinition[], signal: AbortSignal): ToolTicket {
  if (signal.aborted) throw new ApplicationError('CANCEL_REQUESTED', '工具执行已取消');
  const definition = definitions.find((definition) => definition.name === call.name);
  if (!definition || ['terminal', 'network', 'commit', 'approve', 'run.accept'].includes(call.name))
    throw new ApplicationError('PERMISSION_DENIED', '此执行器没有该工具权限');
  const args: unknown = JSON.parse(call.arguments);
  const schema = z.fromJSONSchema(definition.parameters as Parameters<typeof z.fromJSONSchema>[0]);
  schema.parse(args);
  try {
  const row = store.db.sql.prepare("SELECT id FROM model_attempts WHERE run_id=? AND status='complete' ORDER BY rowid DESC LIMIT 1").get(runId);
  const attemptId = row ? String(row.id) : 'legacy';
  const id = `${runId}:${attemptId}:${call.id}`;
  const argsHash = fingerprint({ name: call.name, args });
  const previous = store.db.sql.prepare('SELECT data FROM tool_executions WHERE id=?').get(id);
  if (previous) {
    const ticket: ToolTicket = JSON.parse(String(previous.data));
    if (ticket.argsHash !== argsHash) throw new ApplicationError('VERSION_CONFLICT', '同一工具调用编号出现不同参数');
    if (ticket.status === 'complete') return ticket;
    if (ticket.effect !== 'read') throw new ApplicationError('REMOTE_RESULT_UNKNOWN', '此工具已开始但结果未确认，禁止自动重复执行', ['refresh']);
    return ticket;
  }
  const ticket: ToolTicket = {
    id, runId, attemptId, argsHash, toolName: call.name, version: 1,
    effect: /^(propose_|submit_)/.test(call.name) ? 'candidate_proposal' : call.name === 'save_draft' ? 'draft_write' : 'read',
    status: 'started', createdAt: new Date().toISOString()
  };
  store.db.transaction(() => {
    store.db.sql.prepare('INSERT INTO tool_executions VALUES(?,?,?,?,?)').run(id, runId, argsHash, 'started', JSON.stringify(ticket));
    store.db.event(runId, 'tool-intent', '工具执行意图已持久化', { scopedCallId: id, name: call.name, effect: ticket.effect });
  });
  return ticket;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError('STORAGE_FAILURE', '工具执行意图未能可靠保存，已停止后续执行');
  }
}
export function stopOnToolFailure(error: unknown) {
  if (error instanceof RequestError) throw error;
  if (error instanceof ApplicationError) {
    if (error.code === 'REMOTE_RESULT_UNKNOWN') throw new RequestError(error.message, true);
    if (!['VALIDATION_ERROR', 'PERMISSION_DENIED'].includes(error.code)) throw error;
  }
  if (error && typeof error === 'object' && 'code' in error && /^(?:ERR_SQLITE|SQLITE|ENOSPC|EIO|EACCES|EPERM|EBUSY)/.test(String(error.code))) throw error;
}
export function finishTool(store: FileStore, ticket: ToolTicket, result: string, persist: () => void = () => {}) {
  if (Buffer.byteLength(result) > 10_000_000) throw new ApplicationError('VALIDATION_ERROR', '工具结果超过输出上限');
  const complete = { ...ticket, status: 'complete', result };
  store.db.transaction(() => {
    persist();
    store.db.sql.prepare('UPDATE tool_executions SET status=?,data=? WHERE id=?').run('complete', JSON.stringify(complete), ticket.id);
    store.db.event(ticket.runId, 'tool-complete', '工具结果已持久化', { scopedCallId: ticket.id });
  });
}
