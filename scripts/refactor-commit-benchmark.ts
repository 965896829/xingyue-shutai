import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const base = path.resolve('.test-output/refactor/performance');
const contexts = [];
for (const mode of ['baseline', 'current']) {
  const source = path.resolve(mode === 'baseline' ? '.test-output/refactor/baseline-source/src/core' : 'src/core');
  const moduleAt = (name: string) => import(pathToFileURL(path.join(source, name + '.ts')).href);
  const { FileStore } = await moduleAt('storage');
  const { newProject, prosePath } = await moduleAt('domain');
  const { Conversations } = await moduleAt('conversations');
  const root = fs.mkdtempSync(path.join(base, 'paired-' + mode + '-'));
  const store = new FileStore(root), project = newProject('合成性能夹具', root, {});
  project.chapters = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i + 1, 'complete']));
  project.chapter = 100;
  store.commit(Array.from({ length: 100 }, (_, i) => ({ path: prosePath(i + 1), content: `阿宁追查第${i + 1}号线索。`.padEnd(10000, '文'), baseHash: null })), project);
  const records = new Conversations(store), chat = records.create();
  const seed = () => {
    for (let i = 0; i < 10000; i++) records.save('conversation_messages', { id: String(i), conversationId: chat.id, turnId: '', role: 'user', content: '合成聊天'.repeat(50), createdAt: String(i), status: 'complete', citations: [] });
    for (let i = 0; i < 1000; i++) store.db.event('synthetic', 'fixture', '合成事件');
  };
  store.db.transaction ? store.db.transaction(seed) : records.transaction(seed);
  contexts.push({ mode, root, store, file: prosePath(1), samples: [] as number[] });
}
try {
  for (let i = -5; i < 51; i++) {
    for (const entry of i % 2 === 0 ? contexts : [...contexts].reverse()) {
      const project = entry.store.db.project();
      project.revision++;
      const before = performance.now();
      entry.store.commit([{ path: entry.file, content: '合成更新' + project.revision, baseHash: entry.store.db.document(entry.file).hash }], project);
      const elapsed = performance.now() - before;
      if (i >= 0) entry.samples.push(elapsed);
      assert.equal(entry.store.readAccepted(entry.file).content, '合成更新' + project.revision);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  const percentile = (values: number[], rank: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * rank) - 1];
  const report = { at: new Date().toISOString(), environment: { os: `${os.platform()} ${os.release()}`, node: process.version, cpu: os.cpus()[0].model },
    fixture: { documents: 100, characters: 1000000, messages: 10000, events: 1000, warmups: 5, repeats: 51, order: 'alternating baseline/current and current/baseline; no parallel build or test' },
    results: Object.fromEntries(contexts.map(({ mode, root, samples }) => [mode, { root, samples, p50: percentile(samples, .5), p95: percentile(samples, .95) }])) };
  fs.writeFileSync('docs/refactor/performance/commit-paired.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.results).map(([mode, {p50, p95}]) => [mode, {p50,p95}])), null, 2));
} finally { for (const entry of contexts) entry.store.close(); }
