import type { AgentRunner } from '../runner';
import type { ConversationRunner } from '../conversation-runner';
import type { FileStore } from '../storage';
import { ApplicationError } from '../../shared/errors';
import { RecordedExecutorAdapter, type ExecutorCheckpoint, type ExecutorDescription } from './executor';
import { recoveryActions } from './run-state';
import { piExecutorVersion } from './task-loop';

export class PiExecutorAdapter extends RecordedExecutorAdapter {
  constructor(store: FileStore, runner: AgentRunner, chat: ConversationRunner) { super(store, runner, chat); }
  override describe(): ExecutorDescription {
    return { id: 'pi', version: piExecutorVersion, checkpointVersion: 1, admitted: true,
      capabilities: ['stage', 'revision', 'planning', 'discussion', 'draft'] };
  }
  override restore(checkpoint: ExecutorCheckpoint) {
    if (checkpoint.executorId !== 'pi' || checkpoint.executorVersion !== piExecutorVersion || checkpoint.checkpointVersion !== 1)
      throw new ApplicationError('PROJECT_VERSION_UNSUPPORTED', '此 Pi 检查点不受支持，原记录保留，未重新发送请求');
    return recoveryActions(this.store.db.run(checkpoint.runId));
  }
}
