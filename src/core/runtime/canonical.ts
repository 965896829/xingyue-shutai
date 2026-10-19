import { createHash } from 'node:crypto';

export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error('无法编码提交依据');
    return result;
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => JSON.stringify(key) + ':' + canonical(value)).join(',') + '}';
}
export function fingerprint(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
