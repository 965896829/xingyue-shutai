import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { encodeSnapshot, decodeSnapshot, type StoredSnapshot } from '../src/core/snapshot-codec';
import { FileStore } from '../src/core/storage';
import { newProject, prosePath, hash } from '../src/core/domain';
import { factSchema } from '../src/shared/types';
import type { CanonicalSnapshot } from '../src/shared/studio';
import { isolatedRoot } from './fixtures/refactor';
import { retrieveMemory } from '../src/core/memory-studio';
import { ProseIndexer } from '../src/core/prose-index';
import { LocalCosine } from '../src/core/embeddings';

test('大量历史版本用增量和检查点保存，逐版精确恢复文件、章节与事实顺序', () => {
  const project = newProject('历史容量测试', isolatedRoot('snapshot-deltas'), {});
  project.chapters = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [i + 1, 'complete' as const]));
  const a = factSchema.parse({ id: 'a', subject: '林澈', predicate: '右手', value: '骨折', kind: 'event', category: 'injury', fromChapter: 1, revealedAt: 1, evidence: [{ path: prosePath(1), hash: hash('林澈右手骨折'), quote: '林澈右手骨折' }] });
  const b = { ...a, id: 'b', predicate: '携带', value: '钥匙' };
  let current: CanonicalSnapshot = { id: '0', projectId: project.id, revision: 0, parentId: null, createdAt: '2026-10-12T00:00:00Z', project, documents: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [prosePath(i + 1), hash(String(i))])), facts: [a, b] };
  const stored = new Map<string, StoredSnapshot>();
  let total = 0, full = 0, depth = 0, checkpoints = 0;
  for (let i = 0; i < 300; i++) {
    const next = structuredClone(current);
    next.parentId = i ? current.id : null; next.id = String(i); next.revision = i; next.project.revision = i;
    next.documents[prosePath(1)] = hash(String(i)); next.project.chapters[1] = i % 2 ? 'complete' : 'stale';
    if (i % 3 === 1) next.facts = [b, { ...a, value: '仍然骨折' }];
    if (i % 3 === 2) { next.facts = [a]; delete next.documents[prosePath(2)]; delete next.project.chapters[2]; }
    if (i % 3 === 0) { next.facts = [a, b]; next.documents[prosePath(2)] = hash('恢复'); next.project.chapters[2] = 'complete'; }
    const encoded = encodeSnapshot(next, i ? current : null, depth);
    depth = 'encoding' in encoded ? encoded.depth : 0;
    if (!depth) checkpoints++;
    stored.set(next.id, JSON.parse(JSON.stringify(encoded)));
    assert.deepEqual(decodeSnapshot(stored.get(next.id)!, key => stored.get(key)!), next);
    total += JSON.stringify(encoded).length; full += JSON.stringify(next).length;
    current = next;
  }
  assert.equal(checkpoints, 3);
  assert.ok(total < full / 10);
  const final = stored.get('299')!;
  assert.throws(() => decodeSnapshot(final, () => final), /快照/);
  assert.throws(() => decodeSnapshot(final, () => { throw new Error('基础版本缺失'); }), /基础版本缺失/);
});

test('五百章检索限定版本和章号，支持两字姓名与末尾命中，不遍历读取全书', () => {
  const root = isolatedRoot('indexed-prose'), store = new FileStore(root), project = newProject('检索容量测试', root, {});
  try {
    const changes = Array.from({ length: 500 }, (_, i) => { const n = i + 1; project.chapters[n] = 'complete'; return { path: prosePath(n), content: `# 第${n}章\n\n林澈寻找第${n}号铜钥。${n === 499 ? '独有线索：河畔石门' : '人们穿过长街。'}`, baseHash: null }; });
    store.commit(changes, project);
    const before = store.db.get<string>('headSnapshot')!;
    const object = store.object.bind(store); let reads = 0;
    store.object = (version: string) => { reads++; return object(version); };
    let result = retrieveMemory(store, '第499号铜钥', { chapter: 500 }, 4);
    assert.equal(result.documents[0].path, prosePath(499));
    assert.ok(reads <= 4);
    assert.ok(retrieveMemory(store, '林澈', { chapter: 500 }, 4).documents.length);
    assert.ok(!retrieveMemory(store, '第499号铜钥', { chapter: 498 }, 4).documents.some(d => d.path === prosePath(499)));
    const original = store.readAccepted(prosePath(499)); project.revision++;
    store.commit([{ path: original.path, content: '# 新版本\n\n林澈发现石门已经封闭。', baseHash: original.hash }], project);
    result = retrieveMemory(store, '独有线索', { chapter: 500, mode: 'historical', snapshotId: before });
    assert.ok(result.documents.some(d => d.path === original.path && d.excerpt.includes('河畔石门')));
    result = retrieveMemory(store, '独有线索', { chapter: 500 });
    assert.ok(!result.documents.some(d => d.excerpt.includes('河畔石门')));
    assert.equal(store.readAccepted(original.path, before).content, original.content);
    const indexed = store.db.sql.prepare('SELECT id FROM prose_search_versions WHERE path=? AND hash=?').get(original.path, store.db.document(original.path)!.hash!);
    store.db.sql.prepare('UPDATE prose_search_versions SET content=? WHERE id=?').run('林澈发现石门已经开启。', indexed!.id);
    assert.throws(() => retrieveMemory(store, '石门', { chapter: 500 }), /已修复缓存/);
    assert.ok(retrieveMemory(store, '石门', { chapter: 500 }).documents.some(d => d.excerpt.includes('已经封闭')));
  } finally { store.close(); }
});

test('旧作品索引可中止和继续，缺失索引时仍读取正确原文', async () => {
  const root = isolatedRoot('index-rebuild'), store = new FileStore(root), project = newProject('旧作品', root, {});
  try {
    project.chapters[1] = 'complete';
    store.commit([{ path: prosePath(1), content: '# 正文\n\n林澈站在断桥边。', baseHash: null }], project);
    store.db.sql.exec('DELETE FROM prose_search_terms; DELETE FROM prose_search_versions');
    const stopped = new ProseIndexer(store); stopped.stop(); await stopped.rebuild();
    const fallback = retrieveMemory(store, '断桥', { chapter: 1 });
    assert.match(fallback.documents[0].excerpt, /断桥/); assert.ok(fallback.note);
    await new ProseIndexer(store).rebuild();
    assert.equal(retrieveMemory(store, '断桥', { chapter: 1 }).note, undefined);
  } finally { store.close(); }
});

test('已完成提交只保留必要恢复记录，中断提交保留完整载荷且可恢复', () => {
  const root = isolatedRoot('compact-journal'), project = newProject('提交历史', root, {});
  let store = new FileStore(root);
  try {
    store.commit([{ path: '正文.md', content: '初稿', baseHash: null }], project);
    project.revision++;
    assert.throws(() => store.commit([{ path: '正文.md', content: '修订稿', baseHash: hash('初稿') }], project, undefined, point => { if (point === 'after-database') throw new Error('中断'); }), /中断/);
    const folder = path.join(root, '.novelclient/transactions');
    let records = fs.readdirSync(folder).map(file => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')));
    assert.ok(records.find(r => r.state === 'prepared').project);
    assert.equal(records.find(r => r.state === 'committed').project, undefined);
    store.close(); store = new FileStore(root); store.recover();
    assert.equal(store.readAccepted('正文.md').content, '修订稿');
    records = fs.readdirSync(folder).map(file => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')));
    assert.ok(records.every(r => r.state === 'committed' && !r.project && !r.run));
    assert.equal(store.db.snapshot(store.db.snapshots().at(-1)!.id).documents['正文.md'], hash('初稿'));
  } finally { store.close(); }
});

test('十万条向量按批次排名保留相同结果，不要求将全集装入数组', () => {
  function* rows() {
    for (let i = 1; i <= 100000; i++) yield { id: String(i), vector: [1, i] };
    yield { id: 'invalid', vector: [Infinity, 0] };
    yield { id: 'dimension', vector: [1] };
  }
  const ranked = new LocalCosine().rank([1, 0], rows(), 3);
  assert.deepEqual(ranked.map(r => r.id), ['1', '2', '3']);
});

test('按需校验与目录扫描识别外部改稿，并继续拒绝目录联接', () => {
  const root = isolatedRoot('bounded-inspect'), outside = isolatedRoot('outside-inspect'), store = new FileStore(root), project = newProject('路径校验', root, {});
  try {
    store.commit([{ path: '正文.md', content: '初稿', baseHash: null }], project);
    assert.equal(store.inspect('正文.md')?.status, 'accepted');
    store.documentListing();
    const scan = store.scan.bind(store); let rescans = 0;
    store.scan = () => { rescans++; return scan(); };
    for (let i = 0; i < 10; i++) assert.equal(store.documentListing()[0].status, 'accepted');
    assert.equal(rescans, 0);
    fs.writeFileSync(path.join(root, '正文.md'), '外部改稿');
    assert.equal(store.inspect('正文.md')?.status, 'external');
    assert.equal(store.documentListing()[0].status, 'external');
    assert.equal(rescans, 1);
    assert.equal(store.scan().find(d => d.path === '正文.md')?.status, 'external');
    fs.writeFileSync(path.join(outside, '不可读取.md'), '外部目录');
    fs.symlinkSync(outside, path.join(root, '联接'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => store.inspect('联接/不可读取.md'), /符号链接|联接/);
    assert.ok(!store.scan().some(d => d.path.includes('不可读取')));
  } finally { store.close(); }
});
