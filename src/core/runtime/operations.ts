import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from '../storage';
import { ApplicationError } from '../../shared/errors';
import { fingerprint } from './canonical';

export interface OperationReceipt { id: string; kind: string; inputHash: string; status: 'started' | 'complete' | 'unknown'; result?: unknown; createdAt: string }
export class Operations {
  private context = new AsyncLocalStorage<{ db: Database; receipt: OperationReceipt }>();
  private pending = new Map<string, Promise<unknown>>();
  currentId() { return this.context.getStore()?.receipt.id; }
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
    const previous = this.read(db, id);
    if (previous) {
      if (previous.kind !== kind || previous.inputHash !== inputHash)
        throw new ApplicationError('VERSION_CONFLICT', '同一操作编号不能用于不同输入', ['query_operation']);
      if (previous.status === 'complete') return previous.result as T;
      if (this.pending.has(id)) return this.pending.get(id)! as Promise<T>;
      throw new ApplicationError('REMOTE_RESULT_UNKNOWN', '原操作已开始但结果尚未确认，请查询原操作，不能自动重复执行', ['query_operation']);
    }
    const receipt: OperationReceipt = { id, kind, inputHash, status: 'started', createdAt: new Date().toISOString() };
    db.sql.prepare('INSERT INTO operation_receipts VALUES(?,?,?,?)').run(id, kind, inputHash, JSON.stringify(receipt));
    const promise = this.context.run({ db, receipt }, async () => {
      try { const result = await action(); this.complete(result); return result; }
      catch (error) {
        if (receipt.status !== 'complete') {
          receipt.status = 'unknown';
          db.sql.prepare('UPDATE operation_receipts SET data=? WHERE id=?').run(JSON.stringify(receipt), id);
        }
        throw error;
      } finally { this.pending.delete(id); }
    });
    this.pending.set(id, promise);
    return promise;
  }
}
