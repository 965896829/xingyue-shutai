import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PendingRequests } from '../electron/pending-requests';
import { WorkerSupervisor } from '../electron/supervisor';
import { buildVersion, protocolVersion } from '../src/shared/build';
import { commandContracts, isCommand, parseInput, parseOutput } from '../src/shared/contracts';
import { requestSchema } from '../src/shared/ipc';
import { Operations } from '../src/core/runtime/operations';
import { callModel, callExternal, attempts, estimatedUnits, moneyUnits, recoverAttempts } from '../src/core/runtime/model-gateway';
import { beginTool, finishTool } from '../src/core/runtime/tool-gateway';
import { setRunStatus } from '../src/core/runtime/run-state';
import { ResourceScheduler } from '../src/core/runtime/scheduler';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { ApplicationError, errorPayload } from '../src/shared/errors';
import { waitForResponse } from '../src/shared/wait-for-response';
import { RequestError } from '../src/core/provider';
import { FileStore, proposalHash } from '../src/core/storage';
import { readSettings } from '../src/core/settings-recovery';
import { createBackup, restoreBackup } from '../src/core/documents';
import { garbageCollectionPreview } from '../src/core/integrity';
import { Conversations } from '../src/core/conversations';
import { chooseExecutor } from '../src/core/runtime/executor';
import { hash, id, now } from '../src/core/domain';
import { refactorFixture, isolatedRoot, fakeProfile, fakeResult } from './fixtures/refactor';

function barrier<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

test('T-004/005 contract rejects forged input and output before dispatch', () => {
  assert.ok(Object.keys(commandContracts).length >= 100);
  assert.equal(isCommand('__proto__'), false);
  assert.equal(isCommand('fs.read'), false);
  assert.throws(() => parseInput('run.accept', { id: 'x', approved: true }), z.ZodError);
  assert.throws(() => parseOutput('app.snapshot', { project: null }), z.ZodError);
  assert.throws(() => requestSchema.parse({ protocolVersion: 999, requestId: id(), command: 'run.start', params: {} }), z.ZodError);
});

test('T-006/013/014 supervisor versions, generations, backoff and circuit breaker', () => {
  const supervisor = new WorkerSupervisor(() => 1, () => 0.5);
  assert.equal(supervisor.start(), 1);
  assert.throws(() => supervisor.start());
  assert.throws(() => supervisor.ready({ protocolVersion: 9, buildVersion, workerGeneration: 1 }));
  for (const delay of [500, 1000, 2000]) {
    assert.equal(supervisor.exited(false), delay);
    supervisor.start();
  }
  assert.equal(supervisor.exited(false), null);
  assert.equal(supervisor.state, 'degraded');
  assert.throws(() => supervisor.start());
  const healthy = new WorkerSupervisor();
  healthy.start(); healthy.ready({ protocolVersion, buildVersion, workerGeneration: 1 });
  healthy.drain(); assert.equal(healthy.exited(true), null); assert.equal(healthy.state, 'stopped');
});

test('T-007 timeout, abort, late response and worker exit reclaim pending waits', async () => {
  const pending = new PendingRequests();
  const wait = pending.create('timeout', 1);
  await assert.rejects(wait, (error: ApplicationError) => error.code === 'TIMEOUT_WAITING_RESPONSE');
  assert.equal(pending.size, 0); assert.equal(pending.resolve('timeout', 'late'), false);
  const controller = new AbortController();
  const cancelled = pending.create('cancelled', 10000, controller.signal);
  controller.abort(); await assert.rejects(cancelled); assert.equal(pending.size, 0);
  const waiting = pending.create('exit', 10000);
  pending.clear(new Error('exit')); await assert.rejects(waiting, /exit/); assert.equal(pending.size, 0);
  const response = barrier<string>(); let cancelCount = 0;
  await assert.rejects(waitForResponse(response.promise, 'operation-1', 1, undefined, () => cancelCount++), (error: ApplicationError) => error.details?.operationId === 'operation-1');
  response.resolve('late'); assert.equal(cancelCount, 1);
});

test('T-008/009 persistent operation receipts survive lost replies and reject changed input', async () => {
  const { store } = refactorFixture();
  try {
    const ops = new Operations(); let effects = 0; const release = barrier();
    const first = ops.perform(store.db, 'intent', 'run.start', { text: 'same' }, async () => { effects++; await release.promise; return 'run-1'; });
    const second = ops.perform(store.db, 'intent', 'run.start', { text: 'same' }, async () => 'wrong');
    release.resolve(); assert.deepEqual(await Promise.all([first, second]), ['run-1', 'run-1']);
    const restarted = new Operations();
    assert.equal(await restarted.perform(store.db, 'intent', 'run.start', { text: 'same' }, async () => { effects++; return 'wrong'; }), 'run-1');
    await assert.rejects(restarted.perform(store.db, 'intent', 'run.start', { text: 'changed' }, async () => 'wrong'), /操作编号/);
    assert.equal(effects, 1);
  } finally { store.close(); }
});

test('T-011/012 state CAS and transition journal are atomic', () => {
  const { store, run } = refactorFixture();
  try {
    const a = store.db.run(run.id), b = store.db.run(run.id);
    setRunStatus(a, 'running'); store.db.saveRun(a);
    assert.ok(store.db.run(run.id).activity?.startedAt);
    assert.equal(store.db.run(run.id).activity?.stoppedAt, undefined);
    setRunStatus(b, 'discarded'); assert.throws(() => store.db.saveRun(b), /状态已改变/);
    const current = store.db.run(run.id); setRunStatus(current, 'awaiting_review'); store.db.saveRun(current);
    const endedAt = current.activity?.stoppedAt;
    assert.ok(endedAt);
    assert.deepEqual(parseOutput('run.revalidate', current).activity, current.activity);
    setRunStatus(current, 'complete'); store.db.saveRun(current);
    assert.equal(current.activity?.stoppedAt, endedAt);
    const count = store.db.events().length;
    assert.throws(() => setRunStatus(current, 'running'), /不允许/);
    assert.equal(store.db.events().length, count); assert.equal(store.db.run(run.id).status, 'complete');
  } finally { store.close(); }
});

test('T-018 live owner lock and foreign nonce are never stolen or removed', () => {
  const { root, store } = refactorFixture();
  const lock = path.join(root, '.novelclient/write-lock.json');
  assert.throws(() => new FileStore(root), /进程/);
  const foreign = { pid: process.pid, nonce: 'foreign', startedAt: 0 };
  fs.writeFileSync(lock, JSON.stringify(foreign)); store.close();
  assert.deepEqual(JSON.parse(fs.readFileSync(lock, 'utf8')), foreign);
});

test('T-019 gateway cannot call remote without a durable sending intent', async () => {
  const { store, run } = refactorFixture(); let requests = 0;
  try {
    store.db.sql.exec("CREATE TRIGGER fail_attempt BEFORE INSERT ON model_attempts BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");
    await assert.rejects(callModel(store, run, 'test', async () => { requests++; return fakeResult(); }, fakeProfile, 'system', [], [], new AbortController().signal), /disk failure/);
    assert.equal(requests, 0); assert.equal(attempts(store, run.id).length, 0);
  } finally { store.close(); }
});
test('原生搜索费用未知时不绕过预算上限，已完成调用保留费用未知与原始来源', async () => {
  const { store, run, project } = refactorFixture();
  let requests = 0;
  const profile = { ...fakeProfile, protocol: 'responses' as const };
  try {
    project.config.stageBudget = 1; store.db.set('project', project);
    await assert.rejects(callModel(store, run, 'native-test', async () => { requests++; return fakeResult(); },
      profile, '', [], [], new AbortController().signal, () => {}, { webSearch: { maxCalls: 1 } }), /原生联网搜索.*额外工具费用/);
    assert.equal(requests, 0);
    assert.equal(attempts(store, run.id).length, 0);
    project.config.stageBudget = null; store.db.set('project', project);
    await callModel(store, run, 'native-test', async () => { requests++; return { ...fakeResult(), usage: { input: 30, output: 20, cost: null, currency: 'USD' } }; },
      profile, '', [], [], new AbortController().signal, () => {}, { webSearch: { maxCalls: 1 } });
    const attempt = attempts(store, run.id)[0];
    assert.equal(requests, 1);
    assert.equal(attempt.status, 'complete');
    assert.equal(attempt.usageState, 'unknown');
    assert.equal(attempt.settledUnits, null);
    assert.ok(attempt.requestRef && attempt.responseRef);
  } finally { store.close(); }
});

test('T-020/022/023/026 recovery preserves unknown and never silently retries', async () => {
  const { store, run, project } = refactorFixture(); let requests = 0;
  try {
    project.config.stageBudget = 1; store.db.set('project', project);
    const diagnostic = { source: 'upstream' as const, code: 'upstream_http2_stream_error', requestId: 'relay-123', elapsedMs: 381000 };
    await assert.rejects(callModel(store, run, 'test', async () => { requests++; throw new RequestError('remote unknown', true, diagnostic); }, fakeProfile, 'system', [], [], new AbortController().signal));
    assert.equal(attempts(store, run.id)[0].status, 'unknown');
    recoverAttempts(store);
    assert.deepEqual(attempts(store, run.id)[0].failure, diagnostic, '恢复后仍能按请求编号定位中转错误');
    await assert.rejects(callModel(store, run, 'test', async () => { requests++; return fakeResult(); }, fakeProfile, 'system', [], [], new AbortController().signal), /费用未知/);
    assert.equal(requests, 1);
  } finally { store.close(); }
});

test('T-023/024/025 atomic shared reservations and exact integer currency block auxiliary overspend', async () => {
  const { store, run, project } = refactorFixture(); let requests = 0; const release = barrier();
  const config = { provider: 'fixture', model: 'fake', version: 1, identity: {}, pricing: 1, currency: 'USD' };
  try {
    project.config.stageBudget = 0.0002; store.db.set('project', project);
    const child = { ...run, id: id(), parentRunId: run.id };
    const first = callExternal(store, run, 'foreground', config, {}, 150000n, new AbortController().signal, async () => { requests++; await release.promise; return fakeResult(); }, (result) => result.usage);
    await assert.rejects(callExternal(store, child, 'summary', config, {}, 150000n, new AbortController().signal, async () => { requests++; return fakeResult(); }, (result) => result.usage), /费用上限/);
    release.resolve(); await first; assert.equal(requests, 1);
    assert.equal(moneyUnits(0.000000001), 1n); assert.equal(estimatedUnits(1, 0, 0.1, 0), 100n);
    assert.equal(attempts(store, run.id)[0].settledUnits, '20000');
    await assert.rejects(callExternal(store, child, 'unknown-search-price', config, {}, null, new AbortController().signal, async () => { requests++; return fakeResult(); }, (result) => result.usage), /费用未知/);
    assert.equal(requests, 1);
  } finally { release.resolve(); store.close(); }
});

test('T-029/030/031/032 tool schema, scoped replay and forbidden authority', () => {
  const { store, run } = refactorFixture(); let effects = 0;
  const definitions = [{ name: 'save_draft', description: 'fixture', parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false } }];
  const signal = new AbortController().signal;
  const call = { id: 'call-1', name: 'save_draft', arguments: '{"content":"草稿"}' };
  try {
    assert.throws(() => beginTool(store, run.id, { ...call, arguments: '{"content":' }, definitions, signal));
    assert.throws(() => beginTool(store, run.id, { ...call, arguments: '{"content":1}' }, definitions, signal));
    assert.equal(store.db.sql.prepare('SELECT count(*) AS n FROM tool_executions').get()!.n, 0);
    const ticket = beginTool(store, run.id, call, definitions, signal);
    finishTool(store, ticket, 'saved', () => { effects++; });
    assert.equal(beginTool(store, run.id, call, definitions, signal).result, 'saved');
    assert.throws(() => beginTool(store, run.id, { ...call, arguments: '{"content":"别的"}' }, definitions, signal), /不同参数/);
    assert.throws(() => beginTool(store, run.id, { id: 'evil', name: 'commit', arguments: '{}' }, [{ name: 'commit', description: '', parameters: { type: 'object' } }], signal), /权限/);
    assert.equal(effects, 1); assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
  } finally { store.close(); }
});

test('T-035 structured errors redact secrets and never serialize raw validation content', () => {
  const error = errorPayload(new Error('Authorization: Bearer fixture-only-secret api_key=other-secret'), ['fixture-only-secret']);
  assert.equal(JSON.stringify(error).includes('fixture-only-secret'), false);
  assert.equal(JSON.stringify(error).includes('other-secret'), false);
  const parsed = z.object({ key: z.literal('x') }).safeParse({ key: 'private-novel' });
  assert.equal(JSON.stringify(errorPayload(parsed.error)).includes('private-novel'), false);
});

test('T-036/037/038/039 candidate fingerprints bind immutable versions and commit once', () => {
  const { store, run, project } = refactorFixture();
  try {
    const originalHash = proposalHash(run);
    run.changes[0].content += '改动'; store.db.saveRun(run);
    assert.notEqual(proposalHash(run), originalHash);
    assert.equal(store.db.sql.prepare('SELECT count(*) AS n FROM candidate_versions WHERE run_id=?').get(run.id)!.n, 2);
    assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
    const kernel = new ProjectCommitService(store);
    const next = { ...project, revision: project.revision + 1 };
    const before = Number(store.db.sql.prepare('SELECT count(*) AS n FROM applied_transactions').get()!.n);
    const tx = kernel.commit(run.changes, next, run);
    assert.equal(kernel.commit(run.changes, next, run), tx);
    assert.equal(Number(store.db.sql.prepare('SELECT count(*) AS n FROM applied_transactions').get()!.n), before + 1);
    assert.equal(store.db.sql.prepare('SELECT count(*) AS n FROM candidate_commits').get()!.n, 1);
    assert.equal(store.readAccepted('正文.md').content, run.changes[0].content);
    const changed = structuredClone(run); changed.changes[0].content = '未批准内容';
    assert.throws(() => kernel.commit(changed.changes, next, changed), /改变/);
  } finally { store.close(); }
});

test('T-043/044 Windows replacement race preserves exact external bytes and conflict evidence', () => {
  const { store, project, root } = refactorFixture();
  try {
    const external = Buffer.from('外部编辑器抢写𠮷\r\n');
    const target = path.join(root, '正文.md');
    const tx = store.commit([{ path: '正文.md', content: '客户端候选', baseHash: hash(fs.readFileSync(target)) }], { ...project, revision: project.revision + 1 }, undefined,
      (point) => { if (point === 'before-replace:正文.md') fs.writeFileSync(target, external); });
    assert.deepEqual(fs.readFileSync(target), external);
    const outbox = store.db.sql.prepare('SELECT status FROM materialization_outbox WHERE id=?').get(tx)!;
    assert.equal(outbox.status, 'conflict');
    assert.equal(store.readAccepted('正文.md').content, '客户端候选');
    const preserved = fs.readdirSync(path.join(root, '.novelclient/preserved')).find((file) => file.startsWith(tx) && file.endsWith('.previous'))!;
    assert.deepEqual(fs.readFileSync(path.join(root, '.novelclient/preserved', preserved)), external);
    store.materialize(tx); assert.deepEqual(fs.readFileSync(target), external);
  } finally { store.close(); }
});

test('T-045 committed DB survives denied materialization and resumes from outbox', () => {
  const { store, project, root } = refactorFixture();
  try {
    const tx = store.commit([{ path: '正文.md', content: '已提交内容', baseHash: store.db.document('正文.md')!.hash }], { ...project, revision: 1 }, undefined,
      (point) => { if (point === 'before-replace:正文.md') { const error = new Error('fixture EACCES'); Object.assign(error, { code: 'EACCES' }); throw error; } });
    assert.equal(store.db.sql.prepare('SELECT status FROM materialization_outbox WHERE id=?').get(tx)!.status, 'pending');
    assert.equal(store.readAccepted('正文.md').content, '已提交内容');
    store.materialize(tx); assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '已提交内容');
  } finally { store.close(); }
});

test('T-048 oversized mandatory model input does not send', async () => {
  const { store, run } = refactorFixture(); let requests = 0;
  try {
    await assert.rejects(callModel(store, run, 'oversize', async () => { requests++; return fakeResult(); }, { ...fakeProfile, contextLimit: 1024 }, '正文'.repeat(3000), [], [], new AbortController().signal), /容量/);
    assert.equal(requests, 0); assert.equal(attempts(store, run.id).length, 0);
  } finally { store.close(); }
});

test('T-045 interrupted private staging is rebuilt from its verified object without losing original bytes', () => {
  const { store, project, root } = refactorFixture();
  try {
    const original = fs.readFileSync(path.join(root, '正文.md'));
    let temporary = '';
    const tx = store.commit([{ path: '正文.md', content: '刷盘恢复稿𠮷\r\n', baseHash: hash(original) }], { ...project, revision: 1 }, undefined,
      (point) => {
        if (point !== 'before-replace:正文.md') return;
        const pending = store.db.sql.prepare("SELECT id FROM materialization_outbox WHERE status='pending'").get()!;
        temporary = path.join(root, `.novelclient/preserved/${pending.id}-${hash('正文.md')}.new`);
        fs.writeFileSync(temporary, Buffer.from([0xe5, 0x88]));
      });
    assert.equal(store.db.sql.prepare('SELECT status FROM materialization_outbox WHERE id=?').get(tx)!.status, 'complete');
    assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '刷盘恢复稿𠮷\r\n');
    assert.deepEqual(fs.readFileSync(path.join(root, `.novelclient/preserved/${tx}-${hash('正文.md')}.previous`)), original);
    assert.equal(fs.existsSync(temporary), false);
    store.recover();
    assert.equal(store.readAccepted('正文.md').content, '刷盘恢复稿𠮷\r\n');
  } finally { store.close(); }
});

test('T-053 cursor watermark prevents skips and duplicates when new messages arrive', () => {
  const { store } = refactorFixture();
  try {
    const records = new Conversations(store), conversation = records.create();
    for (let i = 0; i < 12; i++) records.save('conversation_messages', { id: String(i), conversationId: conversation.id, turnId: '', role: 'user', content: String(i), createdAt: now(), status: 'complete', citations: [] });
    const first = records.page(conversation.id, undefined, undefined, 5);
    records.save('conversation_messages', { id: 'new', conversationId: conversation.id, turnId: '', role: 'user', content: 'new', createdAt: now(), status: 'complete', citations: [] });
    const second = records.page(conversation.id, first.nextBefore!, first.watermark, 5);
    const third = records.page(conversation.id, second.nextBefore!, first.watermark, 5);
    assert.deepEqual([...third.messages, ...second.messages, ...first.messages].map((row) => row.id), Array.from({ length: 12 }, (_, i) => String(i)));
    assert.equal(records.page(conversation.id).messages.at(-1)!.id, 'new');
  } finally { store.close(); }
});

test('T-059/060/061 referenced object removed from manifest blocks restore and GC only previews', async () => {
  const { store, root } = refactorFixture();
  try {
    const orphan = store.putObject('未引用对象');
    const preview = garbageCollectionPreview(root, store.db.sql);
    assert.ok(preview.candidates.some((row) => row.version === orphan)); assert.equal(preview.deletionEnabled, false);
    assert.ok(fs.existsSync(path.join(root, '.novelclient/objects', orphan)));
    const backup = await createBackup(store, isolatedRoot('backup'));
    const manifestFile = path.join(backup, 'wenxu-backup.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const required = store.db.document('正文.md')!.hash;
    manifest.manifest = manifest.manifest.filter((row: { path: string }) => !row.path.endsWith(required!));
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const destination = isolatedRoot('restore');
    assert.throws(() => restoreBackup(backup, destination), /被引用对象/); assert.deepEqual(fs.readdirSync(destination), []);
    assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
  } finally { store.close(); }
});

test('T-062 corrupted global JSON remains recoverable without overwriting original', () => {
  const file = path.join(isolatedRoot('settings'), 'settings.json');
  const original = Buffer.from('{"broken":'); fs.writeFileSync(file, original);
  const result = readSettings(file, z.object({ profiles: z.array(z.string()) }), { profiles: [] });
  assert.equal(result.recovered, true); assert.deepEqual(fs.readFileSync(file), original); assert.deepEqual(fs.readFileSync(result.preserved!), original);
});

test('T-059 batched backup cancellation keeps a durable partial manifest and cannot restore incomplete data', async () => {
  const { store } = refactorFixture();
  try {
    fs.writeFileSync(path.join(store.root, 'wenxu-backup.pending.json'), '用户自有同名文件');
    for (let index = 0; index < 75; index++) store.putObject(`合成备份对象${index}`);
    const controller = new AbortController(), destination = isolatedRoot('cancelled-backup');
    const original = store.readAccepted('正文.md');
    setImmediate(() => controller.abort(new Error('合成取消')));
    await assert.rejects(createBackup(store, destination, controller.signal), /合成取消/);
    const partial = path.join(destination, fs.readdirSync(destination).find(entry => fs.statSync(path.join(destination, entry)).isDirectory())!);
    const checkpoint = JSON.parse(fs.readFileSync(partial + '.pending.json', 'utf8'));
    assert.equal(checkpoint.manifest.length, 32);
    for (const entry of checkpoint.manifest) assert.equal(hash(fs.readFileSync(path.join(partial, entry.path))), entry.hash);
    assert.equal(fs.existsSync(path.join(partial, 'wenxu-backup.json')), false);
    const restoreTarget = isolatedRoot('partial-restore');
    assert.throws(() => restoreBackup(partial, restoreTarget));
    assert.deepEqual(fs.readdirSync(restoreTarget), []);
    assert.deepEqual(store.readAccepted('正文.md'), original);
    const complete = await createBackup(store, destination);
    assert.notEqual(complete, partial);
    assert.equal(fs.existsSync(complete + '.pending.json'), false);
    const restored = new FileStore(restoreBackup(complete, restoreTarget));
    try {
      assert.deepEqual(restored.readAccepted('正文.md'), original);
      assert.equal(fs.readFileSync(path.join(restored.root, 'wenxu-backup.pending.json'), 'utf8'), '用户自有同名文件');
    } finally { restored.close(); }
  } finally { store.close(); }
});

test('T-063 admitted Pi is explicit and disabling it preserves Legacy routing', () => {
  assert.equal(chooseExecutor('legacy'), 'legacy'); assert.equal(chooseExecutor('pi', true), 'pi');
  assert.equal(chooseExecutor('pi', false), 'legacy');
});

test('T-024/061 scheduler excludes competing resources while allowing independent work and releases on failure', async () => {
  const scheduler = new ResourceScheduler(), release = barrier(); const order: string[] = [];
  const first = scheduler.run('run', ['foreground'], 10, async () => { order.push('run'); await release.promise; });
  const backup = scheduler.run('backup', ['foreground', 'index'], 1, async () => { order.push('backup'); });
  await scheduler.run('assessment', ['assessment'], 2, async () => { order.push('assessment'); });
  assert.deepEqual(order, ['run', 'assessment']); release.resolve(); await Promise.all([first, backup]); assert.equal(order.at(-1), 'backup');
  await assert.rejects(scheduler.run('failed', ['foreground'], 1, async () => { throw new Error('fixture'); }));
  await scheduler.run('next', ['foreground'], 1, async () => {}); scheduler.stop();
  await assert.rejects(scheduler.run('late', ['foreground'], 1, async () => {}), /关闭/);
});
