import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, exportDocument, importDocument, restoreBackup } from '../src/core/documents';
import { Operations } from '../src/core/runtime/operations';
import { callExternal } from '../src/core/runtime/model-gateway';
import { RequestError } from '../src/core/provider';
import { ResourceScheduler } from '../src/core/runtime/scheduler';
import { Service } from '../src/core/service';
import { createProjectDirectory, FileStore } from '../src/core/storage';
import { parseOutput } from '../src/shared/contracts';
import { labHeadings } from '../src/shared/story-lab';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';

test('文字或工具连接测试只在收到完整有效的返回后通过', async () => {
  let response = fakeResult('星灯已亮'), calls = 0;
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => { calls++; return response; });
  service.profiles = [structuredClone(fakeProfile)];
  service.requestJournal = new FileStore(isolatedRoot('connection-probe'));
  try {
    const probe = (tools = false) => service.invoke('profiles.test', { id: fakeProfile.id, tools });
    assert.equal((await probe()).text, '星灯已亮');
    response = { ...fakeResult('星灯'), stop: 'length' };
    await assert.rejects(probe(), /完整文字/);
    response = fakeResult('  ');
    await assert.rejects(probe(), /完整文字/);
    response = { ...fakeResult(), stop: 'tools', calls: [{ id: 'call', name: 'probe', arguments: '{"value":"wrong"}' }] };
    await assert.rejects(probe(true), /参数/);
    assert.equal(calls, 4);
  } finally { service.requestJournal.close(); }
});

for (const kind of ['run', 'chat'] as const) test(`取消仍在排队的 ${kind} 后不会再发送，也不能在排队期间切走作品`, async () => {
  let calls = 0, release!: () => void;
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => { calls++; return fakeResult(); });
  service.profiles = [structuredClone(fakeProfile)];
  try {
    const opened = await service.invoke('project.create', { parent: isolatedRoot('queued-work'), title: '排队中的作品', premise: '测试', config: { defaultProfileId: fakeProfile.id } });
    const holder = service.scheduler.run('maintenance', ['foreground'], 10, () => new Promise<void>(resolve => { release = resolve; }));
    const taskId = kind === 'run'
      ? await service.invoke('run.start', { request: '继续开书', mode: 'stage' })
      : await service.invoke('chat.send', { conversationId: opened.conversations![0].id, text: '讨论写法', profileId: fakeProfile.id });
    await assert.rejects(service.invoke('project.close'), /任务|操作/);
    await service.invoke(kind === 'run' ? 'run.cancel' : 'chat.stop');
    release(); await holder;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
    if (kind === 'run') assert.equal(service.store!.db.run(taskId).status, 'paused');
    else assert.equal(service.chat!.records.get('conversation_turns', taskId).status, 'stopped');
    assert.equal((await service.invoke('project.close')).project, null);
  } finally { release?.(); await service.drain(); }
});

test('opening an occupied or incomplete book keeps the active writer and its session', async () => {
  const current = refactorFixture();
  const other = refactorFixture();
  const object = path.join(other.root, '.novelclient/objects', other.store.db.document('正文.md')!.hash!);
  const bytes = fs.readFileSync(object);
  current.store.close();
  const service = new Service(path.resolve('resources/skill'), () => {});
  try {
    const original = await service.invoke('project.open', { root: current.root });
    await assert.rejects(service.invoke('project.open', { root: other.root }), /进程/);
    assert.equal(service.snapshot().projectSessionId, original.projectSessionId);
    other.store.close();
    fs.unlinkSync(object);
    await assert.rejects(service.invoke('project.open', { root: other.root }), /对象缺失/);
    assert.equal(service.snapshot().project?.root, current.root);
    assert.equal(service.store!.readAccepted('正文.md').content, '原稿𠮷\r\n');
    assert.equal((await service.invoke('project.open', { root: current.root })).projectSessionId, original.projectSessionId);
    fs.writeFileSync(object, bytes);
    const next = await service.invoke('project.open', { root: other.root });
    assert.equal(next.project?.root, other.root);
    assert.notEqual(next.projectSessionId, original.projectSessionId);
    assert.equal(fs.existsSync(path.join(current.root, '.novelclient/write-lock.json')), false);
  } finally {
    if (fs.existsSync(path.join(other.root, '.novelclient/write-lock.json')) && service.store?.root !== other.root) other.store.close();
    await service.drain();
  }
});

test('an asynchronous export holds the current book until the document is published', async () => {
  const first = refactorFixture(), next = refactorFixture();
  first.store.close();
  next.store.close();
  const service = new Service(path.resolve('resources/skill'), () => {});
  try {
    await service.invoke('project.open', { root: first.root });
    const target = path.join(isolatedRoot(), '原稿.docx');
    const pending = service.invoke('project.export', { paths: ['正文.md'], target });
    await assert.rejects(service.invoke('project.open', { root: next.root }), /操作尚未结束/);
    assert.equal(await pending, target);
    assert.match(importDocument(target).content, /原稿𠮷/);
    assert.equal((await service.invoke('project.open', { root: next.root })).project?.root, next.root);
  } finally { await service.drain(); }
});

test('a book with an incomplete review cannot displace the active writer or accept its next draft', async () => {
  const active = refactorFixture(), incomplete = refactorFixture();
  const source = active.store.readAccepted('正文.md');
  active.store.close();
  incomplete.store.db.sql.prepare('INSERT INTO assessments(id,data) VALUES(?,?)')
    .run('old-review', JSON.stringify({ id: 'old-review', chapter: 1, track: 'candidate' }));
  incomplete.store.close();
  const service = new Service(path.resolve('resources/skill'), () => {});
  try {
    const original = await service.invoke('project.open', { root: active.root });
    const activeStore = service.store!;
    await assert.rejects(service.invoke('project.open', { root: incomplete.root }), /目标作品的记录不完整/);
    assert.equal(service.store, activeStore);
    assert.equal(service.projectSessionId, original.projectSessionId);
    const draft = await service.invoke('document.save', {
      path: '正文.md', content: '切换失败后继续写稿', baseHash: source.hash
    }, { projectSessionId: original.projectSessionId });
    assert.equal(activeStore.db.run(draft).changes[0].content, '切换失败后继续写稿');
    const reopened = new FileStore(incomplete.root);
    try { assert.equal(Array.from(reopened.db.allRuns(), run => run.id).includes(draft), false); }
    finally { reopened.close(); }
  } finally { await service.drain(); }
});

test('only one process can take over an abandoned writer lock at a time', async () => {
  const fixture = refactorFixture();
  fixture.store.close();
  const control = path.join(fixture.root, '.novelclient');
  const writer = path.join(control, 'write-lock.json');
  const exited = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.equal(exited.status, 0);
  const marker = JSON.stringify({ pid: exited.pid, nonce: 'finished' });
  fs.writeFileSync(writer, marker);
  const guard = new DatabaseSync(path.join(control, 'lock-recovery.sqlite'));
  try {
    guard.exec('BEGIN IMMEDIATE');
    assert.throws(() => new FileStore(fixture.root), /恢复作品占用状态/);
    assert.equal(fs.readFileSync(writer, 'utf8'), marker);
  } finally { guard.close(); }
  const reopened = new FileStore(fixture.root);
  try {
    assert.equal(reopened.readAccepted('正文.md').content, '原稿𠮷\r\n');
    assert.throws(() => new FileStore(fixture.root), /进程/);
    const archive = await createBackup(reopened, isolatedRoot());
    assert.equal(fs.existsSync(path.join(archive, '.novelclient/lock-recovery.sqlite')), false);
  } finally { reopened.close(); }
});

test('concurrent Word exports publish one complete file and preserve the winner', async () => {
  const directory = isolatedRoot();
  const target = path.join(directory, '同名.docx');
  const manuscripts = ['甲稿全文', '乙稿全文'];
  const results = await Promise.allSettled(manuscripts.map(content => exportDocument(content, target)));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  const loser = results.find(row => row.status === 'rejected');
  assert.match(String(loser?.reason), /已存在/);
  assert.equal(importDocument(target).content.trim(), manuscripts[results.findIndex(row => row.status === 'fulfilled')]);
  assert.deepEqual(fs.readdirSync(directory), ['同名.docx']);
});

test('incomplete project creation publishes nothing and cannot replace an existing directory', () => {
  const parent = isolatedRoot(), target = path.join(parent, '作品');
  assert.throws(() => createProjectDirectory(target, staged => {
    fs.writeFileSync(path.join(staged, '正文.md'), '半成品');
    throw new Error('写入中断');
  }), /写入中断/);
  assert.deepEqual(fs.readdirSync(parent), []);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, '作者笔记'), '保留');
  assert.throws(() => createProjectDirectory(target, () => {}), /已存在/);
  assert.deepEqual(fs.readdirSync(parent), ['作品']);
  assert.equal(fs.readFileSync(path.join(target, '作者笔记'), 'utf8'), '保留');
});

test('backup round trip preserves author files with reserved-looking names and stages failed restores', async () => {
  const { root, store } = refactorFixture();
  try {
    const authored = ['wenxu-backup.json', '资料/state.sqlite', '资料/write-lock.json'];
    fs.mkdirSync(path.join(root, '资料'));
    for (const file of authored) fs.writeFileSync(path.join(root, file), '作者原文 ' + file);
    const archive = await createBackup(store, isolatedRoot());
    assert.equal(JSON.parse(fs.readFileSync(path.join(archive, 'wenxu-backup.json'), 'utf8')).schema, 2);
    const restored = restoreBackup(archive, isolatedRoot());
    for (const file of authored) assert.deepEqual(fs.readFileSync(path.join(restored, file)), fs.readFileSync(path.join(root, file)));
    assert.deepEqual(fs.readFileSync(path.join(restored, '正文.md')), fs.readFileSync(path.join(root, '正文.md')));
    assert.equal(fs.existsSync(path.join(restored, '.novelclient/write-lock.json')), false);
    fs.appendFileSync(path.join(archive, 'files', authored[2]), '传输不完整');
    const parent = isolatedRoot();
    await assert.rejects(async () => restoreBackup(archive, parent), /校验失败/);
    assert.deepEqual(fs.readdirSync(parent), []);
  } finally { store.close(); }
});

test('备份校验要求断流时记录的回复片段完整', async () => {
  const { store, root, run } = refactorFixture();
  try {
    const partial = { version: 1, protocol: 'responses', incomplete: true, text: '模型断开前返回的测试片段', output: [] } satisfies NonNullable<RequestError['partial']>;
    await assert.rejects(callExternal(store, run, '断流测试',
      { provider: 'offline', model: 'fixture', version: 1, identity: {}, pricing: {}, currency: 'USD' },
      {}, null, new AbortController().signal,
      async () => { throw new RequestError('测试连接中断', true, undefined, partial); }, () => run.usage));
    const row = store.db.sql.prepare('SELECT data FROM model_attempts WHERE run_id=?').get(run.id)!;
    const ref = JSON.parse(String(row.data)).partialResponseRef;
    const file = path.join(root, '.novelclient', 'objects', ref);
    fs.writeFileSync(file, '意外变更');
    await assert.rejects(createBackup(store, isolatedRoot('incomplete-reply-backup')), /校验失败/);
  } finally { store.close(); }
});

test('backup destination resolves folder aliases before creating a new subdirectory', async () => {
  const { root, store } = refactorFixture();
  try {
    const alias = path.join(isolatedRoot(), '作品别名');
    fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(createBackup(store, path.join(alias, '新备份')), /作品目录之外/);
    assert.equal(fs.existsSync(path.join(root, '新备份')), false);
  } finally { store.close(); }
});

test('reentrant resource scheduling starts every ready job exactly once', async () => {
  const scheduler = new ResourceScheduler();
  let release!: () => void;
  const gate = scheduler.run('holder', ['index', 'assessment'], 1, () => new Promise<void>(resolve => { release = resolve; }));
  const calls: string[] = [];
  let child!: Promise<void>;
  const first = scheduler.run('first', ['index'], 1, async () => {
    calls.push('first');
    child = scheduler.run('nested', ['document'], 1, async () => { calls.push('nested'); });
  });
  const second = scheduler.run('second', ['assessment'], 1, async () => { calls.push('second'); });
  release();
  await Promise.all([gate, first, second]);
  await child;
  assert.deepEqual(calls.sort(), ['first', 'nested', 'second']);
  assert.equal(scheduler.running, 0);
  assert.equal(await scheduler.run('second', ['assessment'], 1, async () => '重新执行'), '重新执行');
});

test('operation receipts only coalesce duplicate requests for the same database', async () => {
  const first = refactorFixture(), second = refactorFixture();
  const ops = new Operations();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const submit = (fixture: typeof first, result: string) => ops.perform(fixture.store.db, 'same-id', 'run.start', {}, async () => {
    calls++;
    await gate;
    return result;
  });
  try {
    const all = [submit(first, '甲'), submit(second, '乙'), submit(first, '重复甲'), submit(second, '重复乙')];
    release();
    assert.deepEqual(await Promise.all(all), ['甲', '乙', '甲', '乙']);
    assert.equal(calls, 2);
  } finally { first.store.close(); second.store.close(); }
});

test('outline boundaries and memory citations retain exact offsets in the original text', () => {
  const first = '# 一\r\n', nested = '## 子节𠮷\r\n', fenced = '~~~\r\n# 代码中的标题\r\n~~~\r\n';
  const leaves = Array.from({ length: 2500 }, (_, n) => '## 节' + n + '\r\n');
  const last = '# 二\r\n', content = first + nested + fenced + leaves.join('') + last;
  const headings = labHeadings(content);
  assert.equal(headings.length, leaves.length + 3);
  assert.equal(headings[0].end, content.indexOf(last));
  assert.equal(content.slice(headings[1].start, headings[1].end), nested + fenced);
  assert.equal(content.slice(headings[2].start, headings[2].end), leaves[0]);
  assert.equal(headings.at(-1)!.end, content.length);
  const document = { path: '正文.md', hash: 'synthetic', excerpt: '相同的一句', reason: '第二处', start: 12, end: 17 };
  const result = parseOutput('memory.retrieve', { documents: [document], facts: [], issues: [], status: 'ok', hasMore: false });
  assert.deepEqual(result.documents, [document]);
});
