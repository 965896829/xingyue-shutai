import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from '../storage';
import { ApplicationError } from '../../shared/errors';
import { fingerprint } from './canonical';

export interface OperationReceipt { id: string; kind: string; inputHash: string; status: 'started' | 'complete' | 'unknown'; result?: unknown; createdAt: string }
export class Operations {
  private context = new AsyncLocalStorage<{ db: Database; receipt: OperationReceipt }>();
  private pending = new WeakMap<Database, Map<string, Promise<unknown>>>();
  currentId() { return this.context.getStore()?.receipt.id; }
  binding(kind: string) {
    const receipt = this.context.getStore()?.receipt;
    return receipt?.kind === kind ? { id: receipt.id, inputHash: receipt.inputHash, kind: receipt.kind } : undefined;
  }
  read(db: Database, id: string): OperationReceipt | null {
    const row = db.sql.prepare('SELECT data FROM operation_receipts WHERE id=?').get(id);
    return row ? JSON.parse(String(row.data)) : null;
  }
  complete(result: unknown) {
    const current = this.context.getStore();
    if (!current) return;
    const { db, receipt } = current;
    receipt.status = 'complete';
    receipt.result = result;
    db.sql.prepare('UPDATE operation_receipts SET data=? WHERE id=?').run(JSON.stringify(receipt), receipt.id);
  }
  async perform<T>(db: Database, id: string, kind: string, input: unknown, action: () => Promise<T>): Promise<T> {
    const inputHash = fingerprint({ kind, input });
    const pending = this.pending.get(db) ?? new Map<string, Promise<unknown>>();
    const previous = this.read(db, id);
    if (previous) {
      if (previous.kind !== kind || previous.inputHash !== inputHash)
        throw new ApplicationError('VERSION_CONFLICT', '同一操作编号不能用于不同输入', ['query_operation']);
      if (pending.has(id)) return pending.get(id)! as Promise<T>;
      if (previous.status === 'complete') return previous.result as T;
      // Older clients could commit authorship and lose the success receipt during indexing.
      if (kind === 'run.accept' && input && typeof input === 'object' && 'id' in input && typeof input.id === 'string' &&
          'proposalHash' in input && typeof input.proposalHash === 'string') {
        const saved = db.sql.prepare('SELECT transaction_id,fingerprint FROM candidate_commits WHERE run_id=? AND fingerprint=?').get(input.id, input.proposalHash);
        if (saved) {
          const snapshot = db.snapshot(String(saved.transaction_id));
          if (!('title' in input) || input.title === undefined || input.title === snapshot.project.title) {
            const result = { accepted: true, revision: snapshot.revision, proposalHash: saved.fingerprint };
            db.sql.prepare('UPDATE operation_receipts SET data=? WHERE id=?').run(JSON.stringify({ ...previous, status: 'complete', result }), id);
            return result as T;
          }
        }
      }
      throw new ApplicationError('REMOTE_RESULT_UNKNOWN', '原操作已开始但结果尚未确认，请查询原操作，不能自动重复执行', ['query_operation']);
    }
    const receipt: OperationReceipt = { id, kind, inputHash, status: 'started', createdAt: new Date().toISOString() };
    db.sql.prepare('INSERT INTO operation_receipts VALUES(?,?,?,?)').run(id, kind, inputHash, JSON.stringify(receipt));
    const promise = this.context.run({ db, receipt }, async () => {
      try { const result = await action(); this.complete(result); return result; }
      catch (error) {
        const saved = this.read(db, id);
        if (saved?.status === 'complete') return saved.result as T;
        if (saved) {
          receipt.status = 'unknown';
          db.sql.prepare('UPDATE operation_receipts SET data=? WHERE id=?').run(JSON.stringify(receipt), id);
        }
        throw error;
      }
    }).finally(() => pending.delete(id));
    this.pending.set(db, pending);
    pending.set(id, promise);
    return promise;
  }
}
