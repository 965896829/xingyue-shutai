import type { Run } from '../../shared/types';
import type { FileStore } from '../storage';
import { fingerprint } from './canonical';
import { normalizeToolArguments } from '../output-normalization';

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
    try { return parse(normalizeToolArguments(raw)); }
    catch (error) {
      const message = (error as Error).message;
      onInvalid(message);
      if (attempt === repairLimit) throw error;
      continuation.push({ role: 'assistant', content: raw }, { role: 'user', content: JSON.stringify({
        receiptError: message,
        correction: '上一份回执未通过校验。对照原始资料仅修复指出的回执问题，再返回完整约定 JSON。保留已有有效判断和证据，不把否定或不明确结论改成默认通过，不重新生成正文、台账或计划。'
      }) });
    }
  }
  throw new Error('核对回执未完成');
}
