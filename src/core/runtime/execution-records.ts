import type { Database } from '../storage';
import { ApplicationError } from '../../shared/errors';
import { id, now } from '../domain';

export type ExecutionState = 'queued' | 'running' | 'parked' | 'succeeded' | 'failed' | 'remote_unknown' | 'cancelled';
export interface ExecutionRecord {
  id: string; runId: string; version: number; state: ExecutionState; executorId: string; executorVersion: string;
  checkpointVersion: number; parentExecutionId?: string; createdAt: string; updatedAt: string;
}
const transitions: Record<ExecutionState, readonly ExecutionState[]> = {
  queued: ['running', 'parked', 'cancelled'], running: ['parked', 'succeeded', 'failed', 'remote_unknown', 'cancelled'],
  parked: ['queued', 'cancelled'], succeeded: [], failed: [], remote_unknown: [], cancelled: []
};
export class ExecutionRecords {
  constructor(readonly db: Database) {}
  create(runId: string, executorId: string, executorVersion: string, parentExecutionId?: string) {
    const record: ExecutionRecord = { id: id(), runId, executorId, executorVersion, checkpointVersion: 1, parentExecutionId, state: 'queued', version: 1, createdAt: now(), updatedAt: now() };
    this.db.sql.prepare('INSERT INTO execution_records VALUES(?,?,?)').run(record.id, runId, JSON.stringify(record));
    return record;
  }
  get(key: string): ExecutionRecord {
    const row = this.db.sql.prepare('SELECT data FROM execution_records WHERE id=?').get(key);
    if (!row) throw new ApplicationError('PROJECT_VERSION_UNSUPPORTED', '执行记录不存在，不能自动恢复');
    return JSON.parse(String(row.data));
  }
  transition(key: string, version: number, state: ExecutionState) {
    return this.db.transaction(() => {
      const record = this.get(key);
      if (record.version !== version) throw new ApplicationError('VERSION_CONFLICT', '执行记录已改变');
      if (record.state === state) return record;
      if (!transitions[record.state].includes(state)) throw new ApplicationError('VERSION_CONFLICT', '终结的执行记录不可重新运行，请建立后继执行');
      record.state = state; record.version++; record.updatedAt = now();
      this.db.sql.prepare('UPDATE execution_records SET data=? WHERE id=?').run(JSON.stringify(record), key);
      this.db.event(record.runId, 'execution-transition', state, { executionId: key, version: record.version });
      return record;
    });
  }
  recover() {
    for (const row of this.db.sql.prepare("SELECT data FROM execution_records WHERE json_extract(data,'$.state') IN ('queued','running')").all()) {
      const record: ExecutionRecord = JSON.parse(String(row.data));
      const uncertain = this.db.sql.prepare("SELECT 1 FROM model_attempts WHERE run_id=? AND status IN ('dispatching','unknown') LIMIT 1").get(record.runId);
      this.transition(record.id, record.version, uncertain && record.state === 'running' ? 'remote_unknown' : 'parked');
    }
  }
}
