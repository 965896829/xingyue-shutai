import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { DocumentImporter } from '../src/core/runtime/document-importer';
import { importDocument } from '../src/core/document-import';
import { exportDocument } from '../src/core/documents';
import { Service } from '../src/core/service';
import { refactorFixture } from './fixtures/refactor';

const entry = new URL('../electron/document-worker.ts', import.meta.url);
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-import-'));
const worker = (source: string) => new URL('data:text/javascript,' + encodeURIComponent(source));
const pausedWorker = worker("import { parentPort } from 'node:worker_threads'; parentPort.postMessage({ phase: 'paused' }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);");

test('isolated parser preserves DOCX headings, lists, tables, Unicode and source hash', async () => {
  const file = path.join(root(), '导入 样本.docx');
  await exportDocument('# 中文标题\n\n阿宁与𠮷字。\n\n- 第一项\n\n| 人物 | 状态 |\n| --- | --- |\n| 阿宁 | 骨折 |', file);
  const before = fs.readFileSync(file), importer = new DocumentImporter(entry);
  assert.deepEqual(await importer.read(file), importDocument(file));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(importer.running, 0);
});

test('large DOCX import leaves the parent event loop responsive and returns complete content', async () => {
  const file = path.join(root(), '大文档.docx');
  const paragraph = '<w:p><w:r><w:t>合成正文𠮷</w:t></w:r></w:p>';
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraph.repeat(20000) + '</w:body></w:document>';
  fs.writeFileSync(file, zipSync({ 'word/document.xml': strToU8(xml) }));
  const importer = new DocumentImporter(entry);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try {
    const result = await importer.read(file);
    assert.equal(result.content, Array(20000).fill('合成正文𠮷').join('\n\n'));
    assert.ok(ticks >= 3, `主线程未获得足够调度：${ticks}`);
    assert.equal(importer.running, 0);
  } finally { clearInterval(timer); }
});

test('cancelled import terminates its worker before rejecting and never modifies the source', async () => {
  const file = path.join(root(), '原稿.txt');
  fs.writeFileSync(file, '作者原稿𠮷\r\n');
  const importer = new DocumentImporter(entry), controller = new AbortController();
  const pending = importer.read(file, controller.signal);
  controller.abort();
  await assert.rejects(pending, { code: 'CANCEL_REQUESTED' });
  assert.equal(importer.running, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), '作者原稿𠮷\r\n');
  await assert.rejects(importer.read(file, controller.signal), { code: 'CANCEL_REQUESTED' });
  assert.equal(importer.running, 0);
  assert.equal((await importer.read(file)).content, '作者原稿𠮷\r\n');
});

test('invalid archive and oversized input fail locally, then the next import remains usable', async () => {
  const directory = root(), bad = path.join(directory, 'bad.docx'), large = path.join(directory, 'large.txt');
  fs.writeFileSync(bad, 'not-a-zip');
  fs.writeFileSync(large, '');
  fs.truncateSync(large, 30_000_001);
  const importer = new DocumentImporter(entry);
  await assert.rejects(importer.read(bad));
  await assert.rejects(importer.read(large), /30 MB/);
  fs.writeFileSync(bad.replace('.docx', '.txt'), '正常内容');
  assert.equal((await importer.read(bad.replace('.docx', '.txt'))).content, '正常内容');
  assert.equal(importer.running, 0);
});

test('import deadline stops a blocked parser and releases the thread', async () => {
  const importer = new DocumentImporter(worker('Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);'), 100);
  await assert.rejects(importer.read('unused'), { code: 'TIMEOUT_WAITING_RESPONSE' });
  assert.equal(importer.running, 0);
});

test('parser crash and malformed responses cannot resolve as successful imports', async () => {
  const crashed = new DocumentImporter(worker("throw new Error('合成线程失败');"));
  await assert.rejects(crashed.read('unused'), { code: 'WORKER_UNAVAILABLE' });
  assert.equal(crashed.running, 0);
  const malformed = new DocumentImporter(pausedWorker);
  await assert.rejects(malformed.read('unused'), { code: 'VALIDATION_ERROR' });
  assert.equal(malformed.running, 0);
});

test('service drain cancels active and queued imports and closes the project after worker exit', async () => {
  const { store, root: projectRoot } = refactorFixture();
  store.close();
  const importer = new DocumentImporter(worker('Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);'));
  const service = new Service(path.resolve('resources/skill'), () => {}, undefined, (file, signal) => importer.read(file, signal));
  await service.open(projectRoot);
  const requests = Promise.allSettled([service.invoke('project.importDocument', { file: 'unused-1' }), service.invoke('project.importDocument', { file: 'unused-2' })]);
  assert.equal(importer.running, 1);
  assert.equal(service.scheduler.pending, 1);
  await service.drain();
  const outcomes = await requests;
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'CANCEL_REQUESTED'));
  assert.equal(importer.running, 0);
  assert.equal(service.scheduler.running, 0);
  assert.equal(service.store, null);
  assert.equal(fs.existsSync(path.join(projectRoot, '.novelclient/write-lock.json')), false);
});
