import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FileStore } from '../src/core/storage';
import { newProject, prosePath, countWords } from '../src/core/domain';
import { searchMemory } from '../src/core/memory';
import { retrieveMemory } from '../src/core/memory-studio';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-1200-')),
  store = new FileStore(root),
  p = newProject('300万字合成容量测试', root, {});
p.chapter = 1200;
p.revision = 1;
p.chapters = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [i + 1, 'complete']));
const start = performance.now();
const changes = Array.from({ length: 1200 }, (_, i) => ({
  path: prosePath(i + 1),
  content: `# 第${i + 1}章\n\n` + `阿宁在古城追查第${i + 1}号伏笔。`.padEnd(2500, '文'),
  baseHash: null
}));
try {
  assert.equal(
    changes.reduce((n, c) => n + countWords(c.content), 0),
    3000000
  );
  store.commit(changes, p);
  const commitMs = performance.now() - start;
  const beforeScan = performance.now(),
    docs = store.scan(),
    scanMs = performance.now() - beforeScan;
  assert.equal(docs.length, 1200);
  const beforeSearch = performance.now(),
    found = searchMemory(store, '第1000号伏笔', 1200),
    searchMs = performance.now() - beforeSearch;
  assert.ok(found.documents.some((d) => d.path === prosePath(1000)));
  assert.equal(store.read(prosePath(1000)).content, changes[999].content);
  const beforeScoped = performance.now(),
    scoped = retrieveMemory(store, '第1000号伏笔', { chapter: 1000 }),
    scopedSearchMs = performance.now() - beforeScoped;
  assert.ok(scoped.documents.some((d) => d.path === prosePath(1000)));
  assert.ok(scoped.documents.every((d) => Number(d.path.match(/第(\d+)章/)?.[1]) <= 1000));
  const result = {
    chapters: 1200,
    bodyCharacters: 3000000,
    commitMs: Math.round(commitMs),
    scanMs: Math.round(scanMs),
    searchMs: Math.round(searchMs),
    scopedSearchMs: Math.round(scopedSearchMs),
    node: process.versions.node,
    platform: process.platform,
    at: new Date().toISOString(),
    meaning: '仅验证本机合成数据容量、编号、检索和计时，不代表真实文学效果'
  };
  fs.mkdirSync('.test-output', { recursive: true });
  fs.writeFileSync('.test-output/scale-report.json', JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  store.close();
}
