import { databaseVersion } from '../../src/core/compatibility';
import path from 'node:path';
import { atomicWrite, FileStore } from '../../src/core/storage';
import { callModel } from '../../src/core/runtime/model-gateway';
import { fakeProfile, fakeResult } from './refactor';
import { DatabaseSync } from 'node:sqlite';

const [root, point, runId] = process.argv.slice(2);
const base = path.resolve('.test-output/refactor/fixtures');
if (!path.resolve(root).startsWith(base + path.sep)) throw new Error('拒绝测试路径越界');
const halt = () => {
  // Publish the complete barrier before the parent observes it and kills this process.
  atomicWrite(path.join(root, 'crash-barrier.json'), JSON.stringify({ point, pid: process.pid }));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
if (point === 'migration-in-progress') {
  const execute = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql: string) {
    if (sql.includes(`PRAGMA user_version=${databaseVersion}; COMMIT;`)) {
      execute.call(this, sql.replace(`PRAGMA user_version=${databaseVersion}; COMMIT;`, ''));
      halt();
    }
    return execute.call(this, sql);
  };
}
if (point === 'visible-prose' || point === 'received-prose') {
  const { Service } = await import('../../src/core/service');
  const { sampleProse } = await import('./workflow');
  const prose = sampleProse(200);
  const service = new Service(path.resolve('resources/skill'), event => {
    if (point === 'visible-prose' && event.type === 'prose-delta' && event.textOffset === 12) halt();
  }, async (_profile, _system, _messages, _tools, _signal, delta) => {
    delta?.(prose.slice(0, 12));
    delta?.(prose.slice(12, 36));
    return fakeResult(prose);
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 4096 }];
  await service.open(root);
  const runner = service.runner!;
  const activity = runner.activity.bind(runner);
  runner.activity = (run, phase, operation) => {
    if (point === 'received-prose' && phase === 'checking') halt();
    activity(run, phase, operation);
  };
  await runner.drive(runId);
  throw new Error('章节未到达预期的中断位置');
}
const store = new FileStore(root);
if (point === 'attempt-dispatched') {
  await callModel(store, store.db.run(runId), 'hard-crash', async () => { halt(); return fakeResult(); }, fakeProfile, 'synthetic', [], [], new AbortController().signal);
} else {
  const project = store.db.project();
  store.commit([{ path: '正文.md', content: '硬终止后应恢复的正式稿𠮷', baseHash: store.db.document('正文.md')!.hash }], { ...project, revision: project.revision + 1 }, undefined,
    (boundary) => { if (boundary === point) halt(); });
}
throw new Error('未达到注入边界');
