import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createClient } from '../src/shared/client';
import { gateEvent, syncEventCursor, type EventCursor } from '../src/shared/event-gate';
import { readChatUpdates, mergeRows } from '../src/shared/chat-history';
import { ApplicationError } from '../src/shared/errors';
import { ExecutionRecords } from '../src/core/runtime/execution-records';
import { Conversations } from '../src/core/conversations';
import { FileStore } from '../src/core/storage';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { Service } from '../src/core/service';
import { isolatedRoot, refactorFixture, fakeProfile, fakeResult } from './fixtures/refactor';
import { RequestError } from '../src/core/provider';
import { PublicSearch } from '../src/core/search';
import { now } from '../src/core/domain';
import { commandContracts, type Invoke, type BridgeOptions } from '../src/shared/contracts';
import type { Snapshot } from '../src/shared/types';

test('T-004 command type rejects wrong arguments, output and arbitrary command at compile time', () => {
  const root = isolatedRoot('negative-type');
  const filename = path.join(root, 'negative.ts');
  fs.writeFileSync(filename, `import type { Invoke } from '${path.resolve('src/shared/contracts').replaceAll('\\', '/')}';
declare const invoke: Invoke;
invoke('run.start', { request: 17 });
invoke('run.accept', { id: 'test', approved: true });
invoke('arbitrary.write', {});
const result: Promise<number> = invoke('run.start', { request: 'test' });
void result;
`);
  const config = ts.readConfigFile(path.resolve('tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  const program = ts.createProgram([filename], parsed.options);
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error && d.file?.fileName === filename.replaceAll('\\', '/'));
  assert.equal(errors.length, 4, ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), { getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
});

test('T-007 renderer cancellation never transfers AbortSignal and keeps structured error and operation identity', async () => {
  let sent = 0, cancelled = '';
  let options: BridgeOptions | undefined;
  let complete!: (value: { ok: true; result: boolean }) => void;
  const client = createClient({ invoke: async (_command, _args, value) => { sent++; options = value; return await new Promise(resolve => { complete = resolve; }); }, cancelWait: id => { cancelled = id; } });
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(client('run.cancel', {}, { signal: aborted.signal }), { code: 'CANCEL_REQUESTED' });
  assert.equal(sent, 0);
  const controller = new AbortController();
  const pending = client('run.cancel', {}, { signal: controller.signal, operationId: 'one-operation' });
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof ApplicationError && error.code === 'CANCEL_REQUESTED' && error.details?.operationId === 'one-operation');
  assert.equal(sent, 1);
  assert.equal(cancelled, options!.waitId);
  assert.equal('signal' in options!, false);
  complete({ ok: true, result: true });
  const rejected = createClient({ invoke: async () => ({ ok: false, error: { code: 'REMOTE_RESULT_UNKNOWN', message: '请求结果未知', traceId: 'fixture', actions: ['query_operation'] } }), cancelWait: () => {} });
  await assert.rejects(rejected('run.cancel', {}), { code: 'REMOTE_RESULT_UNKNOWN' });
});

test('T-011/012 terminal execution cannot revive and competing state version loses', () => {
  const { store, run } = refactorFixture();
  try {
    const records = new ExecutionRecords(store.db);
    const first = records.create(run.id, 'legacy', '1');
    const active = records.transition(first.id, 1, 'running');
    assert.throws(() => records.transition(first.id, 1, 'cancelled'), /改变/);
    const finished = records.transition(first.id, active.version, 'succeeded');
    assert.throws(() => records.transition(first.id, finished.version, 'running'), /不可重新/);
    const next = records.create(run.id, 'legacy', '1', first.id);
    assert.notEqual(next.id, first.id);
    assert.equal(records.get(next.id).parentExecutionId, first.id);
    records.recover();
    assert.equal(records.get(next.id).state, 'parked');
    assert.equal(records.get(first.id).state, 'succeeded');
  } finally { store.close(); }
});

test('T-052 late project session, resource version and worker generation cannot overwrite latest view', () => {
  const cursor: EventCursor = { seq: 0, waiting: false };
  syncEventCursor(cursor, { epoch: 'epoch', projectSessionId: 'new', workerGeneration: 2, eventSeq: 8 } as Snapshot);
  assert.equal(gateEvent(cursor, { type: 'snapshot', projectSessionId: 'old', workerGeneration: 2, seq: 9 }), 'ignore');
  assert.equal(gateEvent(cursor, { type: 'snapshot', projectSessionId: 'new', workerGeneration: 1, seq: 9 }), 'ignore');
  assert.equal(gateEvent(cursor, { type: 'snapshot', seq: 9, resource: 'runs', resourceId: 'one', resourceVersion: 5 }), 'apply');
  assert.equal(gateEvent(cursor, { type: 'snapshot', seq: 10, resource: 'runs', resourceId: 'one', resourceVersion: 4 }), 'ignore');
  assert.equal(gateEvent(cursor, { type: 'snapshot', seq: 12 }), 'refresh');
  assert.equal(cursor.waiting, true);
});

test('T-053 multiple pages inserted between notifications remain reachable without message gaps', async () => {
  const { store } = refactorFixture();
  try {
    const records = new Conversations(store), chat = records.create();
    const insert = (i: number) => records.save('conversation_messages', { id: String(i), conversationId: chat.id, turnId: '', role: 'user', content: `合成${i}`, createdAt: now(), status: 'complete', citations: [] });
    store.db.transaction(() => { for (let i = 0; i < 350; i++) insert(i); });
    const original = records.page(chat.id);
    store.db.transaction(() => { for (let i = 350; i < 800; i++) insert(i); });
    const invoke = (async (_command, args) => { const input = commandContracts['chat.page'].input.parse(args); return records.page(input.id, input.before, input.watermark); }) as Invoke;
    const update = await readChatUpdates(invoke, chat.id, original.watermark);
    const rows = mergeRows(original.messages, update.messages);
    assert.deepEqual(rows.map(r => r.id), Array.from({ length: 550 }, (_, i) => String(250 + i)));
    const older = records.page(chat.id, original.nextBefore!, original.watermark);
    assert.equal(older.messages.at(-1)!.id, '249');
  } finally { store.close(); }
});

test('T-055/056 verified legacy commit journal migrates approval and recovers exactly once', () => {
  const { store, root, run, project } = refactorFixture();
  run.candidateFormat = undefined;
  store.db.saveRun(run);
  const accepted = { ...run, status: 'complete' as const, accepted: true };
  const next = { ...project, revision: project.revision + 1 };
  const commit = store.commit.bind(store);
  store.commit = (changes, state, candidate, _fault, approvalId) => commit(changes, state, candidate, (point) => { if (point === 'prepared') throw new Error('fixture interruption before database'); }, approvalId);
  assert.throws(() => new ProjectCommitService(store).commit(run.changes, next, accepted), /interruption/);
  const directory = path.join(root, '.novelclient/transactions');
  const filename = fs.readdirSync(directory).map(name => path.join(directory, name)).find(file => JSON.parse(fs.readFileSync(file, 'utf8')).run?.id === run.id)!;
  const journal = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const prior = JSON.parse(String(store.db.sql.prepare('SELECT data FROM changesets WHERE id=?').get(journal.id)!.data));
  delete journal.approvalId;
  fs.writeFileSync(filename, JSON.stringify(journal));
  store.db.sql.prepare('DELETE FROM approvals WHERE run_id=?').run(run.id);
  store.close();
  const reopened = new FileStore(root);
  try {
    reopened.recover(); reopened.recover();
    assert.equal(reopened.read('正文.md').content, '候选稿');
    assert.equal(reopened.db.sql.prepare('SELECT COUNT(*) AS n FROM candidate_commits').get()!.n, 1);
    const approval = JSON.parse(String(reopened.db.sql.prepare('SELECT data FROM approvals WHERE run_id=?').get(run.id)!.data));
    assert.equal(approval.source, 'legacy-change-set');
    assert.equal(approval.issuedAt, prior.createdAt);
  } finally { reopened.close(); }
});

test('T-053 run, snapshot and revision cursors keep a stable boundary and full recovery reaches old tasks', () => {
  const { store, run } = refactorFixture();
  try {
    store.db.transaction(() => {
      for (let i = 0; i < 230; i++) store.db.saveRun({ ...run, id: `history-${i}`, stateVersion: undefined });
    });
    const page = store.db.runPage(undefined, undefined, 100);
    store.db.saveRun({ ...run, id: 'later-run', stateVersion: undefined });
    const next = store.db.runPage(page.nextBefore!, page.watermark, 100);
    const last = store.db.runPage(next.nextBefore!, page.watermark, 100);
    assert.equal(new Set([...page.items, ...next.items, ...last.items].map(r => r.id)).size, 231);
    assert.equal([...store.db.allRuns()].length, 232);
    assert.equal(last.nextBefore, null);
    assert.equal(store.db.snapshotPage().items[0].id, store.db.head()!.id);
    assert.equal(store.db.historyPage('正文.md').items[0].hash, store.db.document('正文.md')!.hash);
  } finally { store.close(); }
});

test('T-059 missing referenced object refuses project activation without changing formal file', async () => {
  const { root, store } = refactorFixture();
  const version = store.db.document('正文.md')!.hash!;
  const original = fs.readFileSync(path.join(root, '正文.md'));
  store.close();
  fs.unlinkSync(path.join(root, '.novelclient/objects', version));
  const service = new Service(path.resolve('resources/skill'), () => {});
  await assert.rejects(service.open(root), /对象缺失/);
  assert.deepEqual(fs.readFileSync(path.join(root, '正文.md')), original);
  assert.equal(fs.existsSync(path.join(root, '.novelclient/write-lock.json')), false);
  service.close();
});

test('T-015/017/022 active conversation drains, refuses unsafe switch and retains remote uncertainty', async () => {
  let reached!: () => void;
  const dispatched = new Promise<void>(resolve => { reached = resolve; });
  let calls = 0;
  const service = new Service(path.resolve('resources/skill'), () => {}, async (_profile, _system, _messages, _tools, signal) => {
    calls++; reached();
    return await new Promise((_resolve, reject) => {
      const abort = () => reject(new RequestError('本地已取消，远端结果未知', true));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000 }];
  const snapshot = await service.invoke('project.create', { parent: isolatedRoot('drain'), title: '活动任务退出', premise: '仅离线合成数据', config: { defaultProfileId: fakeProfile.id, expressionRules: { enabled: false, modules: [] } } });
  const root = snapshot.project!.root;
  const conversation = snapshot.conversations![0];
  const turn = await service.invoke('chat.send', { conversationId: conversation.id, text: '合成测试', profileId: fakeProfile.id });
  await dispatched;
  await assert.rejects(service.open(isolatedRoot('unopened')), /先停止/);
  assert.equal(service.store!.root, root);
  await service.drain();
  assert.equal(service.store, null);
  assert.equal(fs.existsSync(path.join(root, '.novelclient/write-lock.json')), false);
  const recovered = new FileStore(root);
  try {
    const record = new Conversations(recovered).get('conversation_turns', turn);
    assert.equal(record.usage.cost, null);
    const rows = recovered.db.sql.prepare('SELECT status FROM model_attempts').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'unknown');
    assert.equal(calls, 1);
  } finally { recovered.close(); }
});

test('T-024/026 unknown auxiliary tool result stops the conversation before another paid round', async () => {
  const original = PublicSearch.prototype.search;
  let calls = 0, searches = 0;
  let reached!: () => void;
  const searched = new Promise<void>(resolve => { reached = resolve; });
  PublicSearch.prototype.search = async () => { searches++; reached(); throw new RequestError('合成搜索结果未知', true); };
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => {
    calls++;
    return calls === 1 ? { ...fakeResult(), stop: 'tools', calls: [{ id: 'search-one', name: 'public_search', arguments: JSON.stringify({ query: '合成资料' }) }] } : fakeResult();
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000 }];
  service.assistant.searchKey = 'synthetic-search-key';
  try {
    const snapshot = await service.invoke('project.create', { parent: isolatedRoot('tool-unknown'), title: '辅助未知结果', premise: '合成数据', config: { defaultProfileId: fakeProfile.id, expressionRules: { enabled: false, modules: [] } } });
    const turn = await service.invoke('chat.send', { conversationId: snapshot.conversations![0].id, text: '查找合成公开资料', profileId: fakeProfile.id });
    await Promise.race([searched, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('工具未调用')), 5000).unref())]);
    await new Promise(resolve => setTimeout(resolve, 20));
    const record = service.chat!.records.get('conversation_turns', turn);
    assert.equal(record.status, 'unknown');
    assert.equal(record.usage.cost, null);
    assert.equal(calls, 1);
    assert.equal(searches, 1);
  } finally { PublicSearch.prototype.search = original; await service.drain(); }
});

test('T-054 runs resource query does not scan files or load unrelated conversation history', async () => {
  const service = new Service(path.resolve('resources/skill'), () => {});
  try {
    await service.invoke('project.create', { parent: isolatedRoot('resource'), title: '资源隔离', premise: '合成资料' });
    let scans = 0;
    const scan = service.store!.scan.bind(service.store);
    service.store!.scan = () => { scans++; return scan(); };
    const result = await service.invoke('resource.read', { resources: ['runs'] });
    assert.equal(scans, 0);
    assert.equal(result.documents, undefined);
    assert.equal(result.conversations, undefined);
    assert.equal(result.studio, undefined);
    assert.ok(Array.isArray(result.runs));
  } finally { await service.drain(); }
});
