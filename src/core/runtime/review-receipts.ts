import type { Run } from '../../shared/types';
import type { FileStore } from '../storage';
import { fingerprint } from './canonical';
import { normalizeToolArguments } from '../output-normalization';
import { z } from 'zod';
import { ApplicationError } from '../../shared/errors';

/** Reuse received receipts only for identical review inputs. Repair by extending
 * the original conversation, never by silently repeating the same audit request. */
export async function reviewWithRepair<T>(store: FileStore, binding: unknown, repairLimit: number,
  send: (continuation: Run['messages']) => Promise<string>, parse: (raw: string) => T,
  onInvalid: (message: string) => void) {
  const key = `review-receipts:v1:${fingerprint(binding)}`;
  const receipts = store.db.get<string[]>(key) ?? [];
  const continuation: Run['messages'] = [];
  for (let attempt = 0; attempt <= repairLimit; attempt++) {
    let raw: string;
    if (receipts[attempt]) raw = store.object(receipts[attempt]).toString('utf8');
    else {
      raw = await send(continuation);
      receipts.push(store.putObject(raw));
      store.db.set(key, receipts);
    }
    const receipt = { transport: 'complete', parse: 'not_checked', structure: 'not_checked', business: 'not_checked', responseRef: receipts[attempt], error: '' };
    const validationKey = `${key}:validation:${attempt}`;
    try {
      const normalized = normalizeToolArguments(raw);
      JSON.parse(normalized); receipt.parse = 'valid';
      const result = parse(normalized);
      receipt.structure = 'valid'; receipt.business = 'valid';
      store.db.set(validationKey, receipt);
      return result;
    }
    catch (error) {
      const message = (error as Error).message;
      receipt.error = message;
      if (receipt.parse !== 'valid') receipt.parse = 'invalid';
      else { receipt.structure = error instanceof z.ZodError ? 'invalid' : 'valid'; receipt.business = receipt.structure === 'valid' ? 'invalid' : 'not_checked'; }
      store.db.set(validationKey, receipt);
      onInvalid(message);
      if (attempt === repairLimit) throw new ApplicationError('REPAIR_EXHAUSTED', `核对回执已达到 ${repairLimit} 次修复上限：${message}。原始回执已保留`);
      continuation.push({ role: 'assistant', content: raw }, { role: 'user', content: JSON.stringify({
        receiptError: message,
        correction: '上一份回执未通过校验。对照原始资料仅修复指出的回执问题，再返回完整约定 JSON。保留已有有效判断和证据，不把否定或不明确结论改成默认通过，不重新生成正文、台账或计划。'
      }) });
    }
  }
  throw new Error('核对回执未完成');
}
