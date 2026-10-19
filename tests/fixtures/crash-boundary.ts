import fs from 'node:fs';
import { databaseVersion } from '../../src/core/compatibility';
import path from 'node:path';
import { FileStore } from '../../src/core/storage';
import { callModel } from '../../src/core/runtime/model-gateway';
import { fakeProfile, fakeResult } from './refactor';
import { DatabaseSync } from 'node:sqlite';

const [root, point, runId] = process.argv.slice(2);
const base = path.resolve('.test-output/refactor/fixtures');
if (!path.resolve(root).startsWith(base + path.sep)) throw new Error('拒绝测试路径越界');
const halt = () => {
  fs.writeFileSync(path.join(root, 'crash-barrier.json'), JSON.stringify({ point, pid: process.pid }));
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
const store = new FileStore(root);
if (point === 'attempt-dispatched') {
  await callModel(store, store.db.run(runId), 'hard-crash', async () => { halt(); return fakeResult(); }, fakeProfile, 'synthetic', [], [], new AbortController().signal);
} else {
  const project = store.db.project();
  store.commit([{ path: '正文.md', content: '硬终止后应恢复的正式稿𠮷', baseHash: store.db.document('正文.md')!.hash }], { ...project, revision: project.revision + 1 }, undefined,
    (boundary) => { if (boundary === point) halt(); });
}
throw new Error('未达到注入边界');
