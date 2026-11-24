import type { Conversations } from '../conversations';
import type { FileStore } from '../storage';
import type { ExecutionContext } from './executor';
import { ExecutionRecords } from './execution-records';
import { setRunStatus } from './run-state';

export function parkQueuedExecution(store: FileStore, conversations: Conversations) {
  const queued = store.db.get<ExecutionContext>('queuedForeground');
  if (!queued) return;
  store.db.transaction(() => {
    const message = '任务在排队时已停止，尚未发送本次请求。';
    if (queued.kind === 'conversation') {
      const turn = conversations.get('conversation_turns', queued.id);
      if (turn.status === 'running') {
        conversations.save('conversation_turns', { ...turn, status: 'stopped', error: message });
        const reply = conversations.get('conversation_messages', turn.messageId);
        conversations.save('conversation_messages', { ...reply, status: 'stopped' });
      }
    } else {
      const run = store.db.run(queued.id);
      if (run.executionId) {
        const records = new ExecutionRecords(store.db);
        const record = records.get(run.executionId);
        if (record.state === 'queued') records.transition(record.id, record.version, 'parked');
      }
      if (!run.accepted && !['failed', 'discarded', 'stale', 'complete'].includes(run.status)) {
        setRunStatus(run, 'paused');
        run.error = message;
        store.db.saveRun(run);
      }
    }
    store.db.set('queuedForeground', null);
  });
}
