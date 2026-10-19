import test from 'node:test';
import { databaseVersion } from '../src/core/compatibility';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { FileStore } from '../src/core/storage';
import { attempts, recoverAttempts } from '../src/core/runtime/model-gateway';
import { refactorFixture } from './fixtures/refactor';

async function hardCrash(root: string, point: string, runId: string) {
  const marker = path.join(root, 'crash-barrier.json');
  let done!: () => void;
  const arrived = new Promise<void>((resolve) => { done = resolve; });
  const watch = fs.watch(root, (_event, file) => { if (String(file) === 'crash-barrier.json' && fs.existsSync(marker)) done(); });
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/crash-boundary.ts', root, point, runId], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = once(child, 'exit');
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([arrived, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('未到达故障边界：' + output)), 15000); }), exited.then(() => { throw new Error('子进程提前退出：' + output); })]);
    child.kill('SIGKILL'); await exited;
    assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).point, point);
  } finally { watch.close(); clearTimeout(timeout!); if (child.exitCode === null) child.kill('SIGKILL'); }
}

test('T-020 FI-02 independent process hard termination preserves possible dispatch without resend', async () => {
  const { root, store, run } = refactorFixture(); store.close();
  await hardCrash(root, 'attempt-dispatched', run.id);
  const reopened = new FileStore(root);
  try {
    assert.equal(attempts(reopened, run.id)[0].status, 'dispatching');
    recoverAttempts(reopened);
    assert.equal(attempts(reopened, run.id)[0].status, 'unknown');
    recoverAttempts(reopened); assert.equal(attempts(reopened, run.id).length, 1);
  } finally { reopened.close(); }
});

for (const [point, committed] of [['prepared', false], ['before-database', false], ['after-database', true], ['file:正文.md', true]] as const)
  test(`T-040/041/042 ${point} hard termination replays one local commit`, async () => {
    const { root, store, run } = refactorFixture(); store.close();
    await hardCrash(root, point, run.id);
    const reopened = new FileStore(root);
    try {
      assert.equal(reopened.db.project().revision, committed ? 1 : 0);
      reopened.recover(); reopened.recover();
      assert.equal(reopened.db.project().revision, 1);
      assert.equal(reopened.readAccepted('正文.md').content, '硬终止后应恢复的正式稿𠮷');
      assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '硬终止后应恢复的正式稿𠮷');
      assert.equal(reopened.db.sql.prepare('SELECT count(*) AS n FROM applied_transactions').get()!.n, 2);
      assert.equal(reopened.db.sql.prepare("SELECT count(*) AS n FROM materialization_outbox WHERE status<>'complete'").get()!.n, 0);
      assert.equal(attempts(reopened, run.id).length, 0);
    } finally { reopened.close(); }
  });

test('T-045 Windows exclusive file handle preserves committed database and retries only materialization', { skip: process.platform !== 'win32' }, async () => {
  const { store, root, project } = refactorFixture();
  const marker = path.join(root, 'exclusive.locked');
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  try {
    assert.throws(() => store.commit([{ path: '正文.md', content: '占用解除后物化', baseHash: store.db.document('正文.md')!.hash }], { ...project, revision: 1 }, undefined, point => {
      if (point !== 'after-database') return;
      const code = `$stream=[IO.File]::Open(${quote(path.join(root, '正文.md'))},'Open','ReadWrite','None'); try { [IO.File]::WriteAllText(${quote(marker)},'locked'); Start-Sleep -Milliseconds 1800 } finally { $stream.Dispose() }`;
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, stdio: 'ignore' });
      exited = once(child, 'exit');
      const start = Date.now();
      while (!fs.existsSync(marker) && Date.now() - start < 5000) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      assert.equal(fs.existsSync(marker), true);
    }));
    assert.equal(store.db.project().revision, 1);
    assert.equal(store.db.sql.prepare("SELECT COUNT(*) AS n FROM materialization_outbox WHERE status='pending'").get()!.n, 1);
    await exited;
    store.recover(); store.recover();
    assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '占用解除后物化');
    assert.equal(store.db.sql.prepare('SELECT COUNT(*) AS n FROM applied_transactions').get()!.n, 2);
  } finally { if (child && child.exitCode === null) child.kill(); store.close(); }
});

test('T-055/056 killing SQLite schema migration rolls back partial DDL and next open upgrades intact content', async () => {
  const { store, root, run } = refactorFixture();
  const before = fs.readFileSync(path.join(root, '正文.md'));
  store.db.sql.exec('DROP TABLE operation_receipts; DROP TABLE model_attempts; DROP TABLE tool_executions; DROP TABLE candidate_versions; DROP TABLE approvals; DROP TABLE candidate_commits; DROP TABLE execution_checkpoints; DROP TABLE execution_records; PRAGMA user_version=3;');
  store.close();
  await hardCrash(root, 'migration-in-progress', run.id);
  const raw = new DatabaseSync(path.join(root, '.novelclient/state.sqlite'));
  assert.equal(raw.prepare('PRAGMA user_version').get()!.user_version, 3);
  assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='execution_records'").get(), undefined);
  raw.close();
  const upgraded = new FileStore(root);
  try {
    assert.equal(upgraded.db.sql.prepare('PRAGMA user_version').get()!.user_version, databaseVersion);
    assert.deepEqual(fs.readFileSync(path.join(root, '正文.md')), before);
    assert.equal(upgraded.readAccepted('正文.md').content, before.toString('utf8'));
    assert.equal(upgraded.db.run(run.id).id, run.id);
    assert.ok(fs.readdirSync(root).some(name => name.startsWith(`.novelclient.before-v${databaseVersion}-`)));
  } finally { upgraded.close(); }
});
