import assert from 'node:assert/strict';
import test from 'node:test';
import { needsWorkerCredentials } from '../electron/worker-credentials';
import type { Command } from '../src/shared/types';

test('打开作品、读写文稿和查看已有候选可以在钥匙串锁定时使用', () => {
  const local: Command[] = ['app.snapshot', 'project.open', 'document.read', 'document.save',
    'document.history', 'resource.read', 'context.preview', 'run.revalidate', 'run.accept'];
  for (const command of local) assert.equal(needsWorkerCredentials(command, {}), false, command);
});

test('前台请求和会启动后台模型任务的操作在执行前加载凭据', () => {
  const requests: Command[] = ['profiles.test', 'lab.generate', 'run.start', 'run.resume',
    'proposal.confirm', 'chat.retry', 'draft.checkpoint', 'embedding.reindex', 'search.test'];
  for (const command of requests) assert.equal(needsWorkerCredentials(command, {}), true, command);
  assert.equal(needsWorkerCredentials('run.accept', { startNext: true }), true);
});
