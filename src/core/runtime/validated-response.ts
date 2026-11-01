import { z } from 'zod';
import type { Run } from '../../shared/types';
import { ApplicationError } from '../../shared/errors';
import type { FileStore } from '../storage';
import { attempts, unresolvedAttempts } from './model-gateway';
import { fingerprint } from './canonical';
import { normalizeToolArguments } from '../output-normalization';

interface ValidationReceipt {
  version: 1;
  attemptId?: string;
  responseRef: string;
  transport: 'complete';
  parse: 'valid' | 'invalid';
  structure: 'valid' | 'invalid' | 'not_checked';
  business: 'valid' | 'invalid' | 'not_checked';
  error?: string;
}

/** Known-invalid complete responses have bounded repair identities; unknown requests never replay. */
export async function validatedResponse<T>(options: {
  store: FileStore; run: Run; phase: string; instruction: string; input: object; signal: AbortSignal;
  initialPurpose?: string;
  decode?: (raw: string) => unknown;
  send: (purpose: string, instruction: string, input: object) => Promise<string>;
  validate: (value: unknown) => T;
  assertCurrent: () => void;
}) {
  const { store, run, signal } = options;
  const ownerId = run.parentRunId ?? run.id;
  const purpose = options.initialPurpose ?? `${options.phase}:${fingerprint(options.input)}`;
  const binding = fingerprint({ purpose, instruction: options.instruction, input: options.input });
  let previous: ValidationReceipt | undefined;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (signal.aborted) throw new ApplicationError('CANCEL_REQUESTED', '任务已停止，未发起修复');
    options.assertCurrent();
    const key = `response-validation:v1:${ownerId}:${binding}:${attempt}`;
    const saved = store.db.get<ValidationReceipt>(key);
    if (saved?.error) { previous = saved; continue; }
    const phase = attempt === 0 ? purpose : `${purpose}:repair:${attempt}:${binding}`;
    const ledger = attempts(store, ownerId);
    if (unresolvedAttempts(store, run, row => row.purpose === purpose || row.purpose.startsWith(`${purpose}:repair:`)).length)
      throw new ApplicationError('REMOTE_RESULT_UNKNOWN', '上次请求结果未知，请先核对，未自动重发');
    const complete = ledger.findLast(row => row.purpose === phase && row.status === 'complete');
    let raw: string;
    if (saved) raw = store.object(saved.responseRef).toString('utf8');
    else if (complete?.responseRef) {
      const response = JSON.parse(store.object(complete.responseRef).toString('utf8')).result;
      if (response.stop !== 'complete' || response.calls.length)
        throw new ApplicationError('OUTPUT_INCOMPLETE', '已保存回执不完整，未当作可修复的完整结果');
      raw = response.text;
    } else raw = await options.send(phase, options.instruction, { ...options.input,
      ...(previous ? { responseRepair: { attempt, error: previous.error,
        previousResponse: store.object(previous.responseRef).toString('utf8'),
        instruction: '仅修正所列格式、结构或引用错误；正文及已有效字段保持不变。此前结果已完整返回但未通过校验，不能宣称已保存或采纳。' } } : {}) });
    if (signal.aborted) throw new ApplicationError('CANCEL_REQUESTED', '任务已停止，迟到结果未写入候选');
    options.assertCurrent();
    const receipt: ValidationReceipt = { version: 1, attemptId: complete?.id ?? attempts(store, run.id).findLast(row => row.purpose === phase)?.id,
      responseRef: store.putObject(raw), transport: 'complete', parse: 'invalid', structure: 'not_checked', business: 'not_checked' };
    try {
      const parsed = options.decode ? options.decode(raw) : JSON.parse(normalizeToolArguments(raw));
      receipt.parse = 'valid';
      const result = options.validate(parsed);
      receipt.structure = 'valid'; receipt.business = 'valid';
      store.db.set(key, receipt);
      return result;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      receipt.error = (error as Error).message;
      if (receipt.parse === 'valid') {
        receipt.structure = error instanceof z.ZodError ? 'invalid' : 'valid';
        receipt.business = receipt.structure === 'valid' ? 'invalid' : 'not_checked';
      }
      store.db.set(key, receipt);
      store.db.event(run.id, 'response-invalid', '完整响应未通过内容校验，原始结果已保留', { phase, attempt, ...receipt });
      previous = receipt;
    }
  }
  throw new ApplicationError('REPAIR_EXHAUSTED', `本项响应已达到两次修复上限：${previous?.error ?? '结果无效'}。原始结果与候选已保留`);
}
