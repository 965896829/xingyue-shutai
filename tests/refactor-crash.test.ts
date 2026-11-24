import test from 'node:test';
import { databaseVersion } from '../src/core/compatibility';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { FileStore } from '../src/core/storage';
import { attempts, recoverAttempts } from '../src/core/runtime/model-gateway';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture, sampleProse } from './fixtures/workflow';
import { Service } from '../src/core/service';
import { prosePath, stageOutputs } from '../src/core/domain';
import { RequestError } from '../src/core/provider';

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

for (const point of ['visible-prose', 'received-prose']) test(`第一章在 ${point} 强退后能找回稿件，已完成的正文请求不重发`, async () => {
  const sent: string[] = [];
  const service = new Service(path.resolve('resources/skill'), () => {}, async (_profile, system) => {
    sent.push(system.includes('本阶段为 review') ? 'review' : 'prose');
    throw new RequestError('在下一阶段暂停测试', false);
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 4096 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('chapter-interruption'), title: '重启验收', premise: '伤员求医',
      config: { defaultProfileId: fakeProfile.id, chapterWords: 200, minWords: 200, maxWords: 200, targetWords: 6000, preview: { enabled: false } } });
    const store = service.store!, p = store.db.project();
    for (const stage of ['S01','S02','S03','S04','S05','S06','S07','S08','S09'] as const)
      store.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    p.stage = 'S10'; store.db.set('project', p);
    const run = service.makeRun('stage', '写第一章正文'); store.db.saveRun(run);
    const originalHash = store.db.document(prosePath(1))?.hash;
    service.close();
    await hardCrash(p.root, point, run.id);
    await service.invoke('project.open', { root: p.root });
    const recovered = service.store!.db.run(run.id);
    const content = recovered.changes.find(change => change.path === prosePath(1))?.content;
    assert.deepEqual(sent, []);
    if (point === 'visible-prose') {
      assert.equal(content, sampleProse(200).slice(0, 36));
      assert.equal(recovered.status, 'unknown');
      await assert.rejects(service.invoke('run.recover', { id: run.id }), /核对|确认/);
      assert.deepEqual(sent, []);
    } else {
      assert.ok(content?.includes(sampleProse(200).split('\n\n').at(-1)!));
      assert.equal(recovered.status, 'paused');
      assert.deepEqual(recovered.usage, fakeResult().usage);
      const backups = isolatedRoot('received-chapter-backup');
      const source = await service.invoke('project.backup', { directory: backups });
      const restored = await service.invoke('project.restoreBackup', { source, parent: isolatedRoot('restored-chapter') });
      await service.invoke('project.open', { root: restored });
      assert.equal(service.store!.db.run(run.id).changes.find(change => change.path === prosePath(1))?.content, content);
      await service.invoke('run.recover', { id: run.id });
      while (service.runner!.controller) await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual(sent, ['review']);
      assert.equal(service.store!.db.run(run.id).steps?.filter(step => step.phase === 'prose').length, 1);
      await service.invoke('project.close');
      await service.invoke('project.open', { root: restored });
      assert.deepEqual(service.store!.db.run(run.id).usage, fakeResult().usage, '明确未发送的审稿请求不改变已知用量');
    }
    assert.equal(attempts(service.store!, run.id).filter(attempt => attempt.purpose === 'prose').length, 1);
    assert.equal(service.store!.db.document(prosePath(1))?.hash, originalHash);
  } finally { await service.drain(); }
});

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

test('T-045 native file protection preserves the committed database and only retries materialization', { skip: !['darwin', 'win32'].includes(process.platform) }, async () => {
  const { store, root, project } = refactorFixture();
  const file = path.join(root, '正文.md');
  const marker = path.join(root, 'exclusive.locked');
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  let immutable = false;
  try {
    const commit = () => store.commit([{ path: '正文.md', content: '占用解除后物化', baseHash: store.db.document('正文.md')!.hash }], { ...project, revision: 1 }, undefined, point => {
      if (point !== 'after-database') return;
      if (process.platform === 'darwin') {
        execFileSync('/usr/bin/chflags', ['uchg', file]);
        immutable = true;
        return;
      }
      const code = `$stream=[IO.File]::Open(${quote(file)},'Open','ReadWrite','None'); try { [IO.File]::WriteAllText(${quote(marker)},'locked'); Start-Sleep -Milliseconds 1800 } finally { $stream.Dispose() }`;
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, stdio: 'ignore' });
      exited = once(child, 'exit');
      const start = Date.now();
      while (!fs.existsSync(marker) && Date.now() - start < 5000) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      assert.equal(fs.existsSync(marker), true);
    });
    if (process.platform === 'win32') assert.throws(commit, (e: NodeJS.ErrnoException) => ['EBUSY','EPERM','EACCES'].includes(e.code ?? ''));
    else {
      commit();
      assert.equal(fs.readFileSync(file, 'utf8'), '原稿𠮷\r\n');
    }
    assert.equal(store.db.project().revision, 1);
    assert.equal(store.readAccepted('正文.md').content, '占用解除后物化');
    assert.equal(store.db.sql.prepare("SELECT COUNT(*) AS n FROM materialization_outbox WHERE status='pending'").get()!.n, 1);
    if (immutable) { execFileSync('/usr/bin/chflags', ['nouchg', file]); immutable = false; }
    await exited;
    store.recover(); store.recover();
    assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '占用解除后物化');
    assert.equal(store.db.sql.prepare('SELECT COUNT(*) AS n FROM applied_transactions').get()!.n, 2);
  } finally {
    if (immutable) execFileSync('/usr/bin/chflags', ['nouchg', file]);
    if (child && child.exitCode === null) child.kill();
    store.close();
  }
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
