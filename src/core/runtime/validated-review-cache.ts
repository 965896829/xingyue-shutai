import type { FileStore } from '../storage';
import { fingerprint } from './canonical';

/** Internal receipts, never approvals. Callers bind all authoritative sources,
 * instructions, author constraints and reviewer settings, then revalidate on read.
 * Negative judgments are cached unchanged; missing/corrupt entries are misses. */
export function readValidatedReview<T>(store: FileStore, binding: unknown, parse: (raw: string) => T): T | undefined {
  const object = store.db.get<string>(`validated-review:v1:${fingerprint(binding)}`);
  if (!object) return undefined;
  try { return parse(store.object(object).toString('utf8')); }
  catch { return undefined; }
}

export function saveValidatedReview(store: FileStore, binding: unknown, value: unknown) {
  store.db.set(`validated-review:v1:${fingerprint(binding)}`, store.putObject(JSON.stringify(value)));
}
