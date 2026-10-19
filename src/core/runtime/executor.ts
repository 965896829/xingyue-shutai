import type { AgentRunner } from '../runner';
import type { ConversationRunner } from '../conversation-runner';
import type { FileStore } from '../storage';
import { ApplicationError } from '../../shared/errors';
import { recoveryActions } from './run-state';
import { ExecutionRecords, type ExecutionState } from './execution-records';

export interface ExecutorDescription {
  id: 'legacy' | 'pi'; version: string; checkpointVersion: number; admitted: boolean;
  capabilities: readonly string[];
}
export interface ExecutorCheckpoint { runId: string; executorId: string; executorVersion: string; checkpointVersion: number }
export interface ExecutionContext { id: string; kind: 'run' | 'conversation'; referenceChats?: string[] }
export interface ExecutorAdapter {
  describe(): ExecutorDescription;
  execute(context: ExecutionContext): Promise<void>;
  restore(checkpoint: ExecutorCheckpoint): readonly string[];
  requestControl(id: string, action: 'pause' | 'cancel'): void;
  dispose(): Promise<void>;
}
export const executorPolicy = Object.freeze({ piEnabled: false, piAdmitted: false });
export function chooseExecutor(requested: 'legacy' | 'pi', enabled: boolean = executorPolicy.piEnabled): 'legacy' | 'pi' {
  return requested === 'pi' && enabled && executorPolicy.piAdmitted ? 'pi' : 'legacy';
}
export class LegacyExecutorAdapter implements ExecutorAdapter {
  constructor(readonly store: FileStore, readonly runner: AgentRunner, readonly chat: ConversationRunner) {}
  describe(): ExecutorDescription { return { id: 'legacy', version: '1', checkpointVersion: 1, admitted: true, capabilities: ['stage', 'revision', 'planning', 'discussion', 'draft'] }; }
  async execute(context: ExecutionContext) {
    if (context.kind === 'conversation') { await this.chat.drive(context.id, context.referenceChats); return; }
    const run = this.store.db.run(context.id);
    this.restore({ runId: run.id, executorId: run.executorId ?? 'legacy', executorVersion: run.executorVersion ?? '1', checkpointVersion: run.checkpointVersion ?? 1 });
    const records = new ExecutionRecords(this.store.db);
    const record = run.executionId ? records.get(run.executionId) : undefined;
    if (record) records.transition(record.id, record.version, 'running');
    try { await this.runner.drive(context.id); }
    finally {
      if (record) {
        const latest = this.store.db.run(context.id);
        const state: ExecutionState = latest.status === 'unknown' ? 'remote_unknown' : latest.status === 'failed' ? 'failed' : latest.status === 'discarded' ? 'cancelled' : ['awaiting_review', 'needs_repair', 'complete'].includes(latest.status) ? 'succeeded' : 'parked';
        records.transition(record.id, records.get(record.id).version, state);
      }
    }
  }
  restore(checkpoint: ExecutorCheckpoint) {
    if (checkpoint.executorId !== 'legacy' || checkpoint.executorVersion !== '1' || checkpoint.checkpointVersion !== 1)
      throw new ApplicationError('PROJECT_VERSION_UNSUPPORTED', '执行器检查点版本不受支持，记录保留为只读，未重新执行');
    return recoveryActions(this.store.db.run(checkpoint.runId));
  }
  requestControl(id: string, action: 'pause' | 'cancel') {
    this.runner.requestControl(id, action);
  }
  async dispose() { this.runner.stop(); this.chat.stop(); await this.runner.telemetry.stop(); }
}
