import type { AgentRunner } from '../runner';
import type { ConversationRunner } from '../conversation-runner';
import type { FileStore } from '../storage';
import { LegacyExecutorAdapter, type ExecutorAdapter, type ExecutorCheckpoint, type ExecutionContext } from './executor';
import { PiExecutorAdapter } from './pi-executor';

export class ExecutorRouter implements ExecutorAdapter {
  private readonly legacy: LegacyExecutorAdapter;
  private readonly pi: PiExecutorAdapter;
  constructor(readonly store: FileStore, runner: AgentRunner, chat: ConversationRunner) {
    this.legacy = new LegacyExecutorAdapter(store, runner, chat);
    this.pi = new PiExecutorAdapter(store, runner, chat);
  }
  describe() { return this.pi.describe(); }
  execute(context: ExecutionContext) {
    if (context.kind === 'conversation') return this.pi.execute(context);
    const run = this.store.db.run(context.id);
    return (run.executorId === 'pi' ? this.pi : this.legacy).execute(context);
  }
  restore(checkpoint: ExecutorCheckpoint) { return (checkpoint.executorId === 'pi' ? this.pi : this.legacy).restore(checkpoint); }
  requestControl(id: string, action: 'pause' | 'cancel') { this.legacy.requestControl(id, action); }
  dispose() { return this.legacy.dispose(); }
}
