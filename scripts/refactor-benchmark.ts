import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const mode = process.argv[2];
if (!['baseline', 'current'].includes(mode)) throw new Error('Expected baseline or current');
const source = path.resolve(mode === 'baseline' ? '.test-output/refactor/baseline-source/src/core' : 'src/core');
const moduleAt = (name: string) => import(pathToFileURL(path.join(source, name + '.ts')).href);
const { FileStore } = await moduleAt('storage');
const { newProject, prosePath } = await moduleAt('domain');
const { searchMemory } = await moduleAt('memory');
const { Conversations } = await moduleAt('conversations');
const { createBackup } = await moduleAt('documents');
const base = path.resolve('.test-output/refactor/performance');
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, mode + '-'));
let store = new FileStore(root);
const project = newProject('合成性能夹具', root, {});
project.chapters = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [index + 1, 'complete']));
project.chapter = 100;
const changes = Array.from({ length: 100 }, (_, index) => ({ path: prosePath(index + 1), content: `阿宁追查第${index + 1}号线索。`.padEnd(10000, '文'), baseHash: null }));
const seedAt = performance.now(); store.commit(changes, project); const seedMs = performance.now() - seedAt;
const records = new Conversations(store); const chat = records.create();
store.db.transaction ? store.db.transaction(seedHistory) : records.transaction(seedHistory);
function seedHistory() {
  for (let index = 0; index < 10000; index++) records.save('conversation_messages', { id: String(index), conversationId: chat.id, turnId: '', role: 'user', content: '合成聊天'.repeat(50), createdAt: String(index), status: 'complete', citations: [] });
  for (let index = 0; index < 1000; index++) store.db.event('synthetic', 'fixture', '合成事件');
}
const samples: Record<string, number[]> = {};
async function measure(name: string, action: () => unknown | Promise<unknown>, repeats = 11) {
  for (let index = -2; index < repeats; index++) {
    const start = performance.now(); await action(); const duration = performance.now() - start;
    if (index >= 0) (samples[name] ??= []).push(duration);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
await measure('scan', () => { assert.equal(store.scan().length, 100); });
await measure('read', () => { assert.equal(store.readAccepted(prosePath(50)).content.length, 10000); });
await measure('search', () => { assert.ok(searchMemory(store, '第50号线索', 100).documents.length); });
let payloadBytes = 0;
await measure('chatFirstPage', () => {
  const messages = mode === 'baseline' ? new Conversations(store).all('conversation_messages', chat.id) : new Conversations(store).page(chat.id).messages;
  payloadBytes = Buffer.byteLength(JSON.stringify(messages));
  assert.equal(messages.at(-1).id, '9999');
});
await measure('eventList', () => { assert.equal(store.db.events().length, 250); });
await measure('commitOne', () => {
  const p = store.db.project(); p.revision++;
  store.commit([{ path: prosePath(1), content: '合成更新' + p.revision, baseHash: store.db.document(prosePath(1)).hash }], p);
});
await measure('backup', () => createBackup(store, path.join(base, 'backups-' + mode)), 5);
await measure('open', () => { store.close(); store = new FileStore(root); store.recover(); });
delay.disable();
const percentile = (values: number[], rank: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * rank) - 1];
const report = {
  mode, at: new Date().toISOString(), source, root,
  environment: { os: `${os.platform()} ${os.release()}`, node: process.version, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(), mode: 'Node source via tsx, no parallel test suite' },
  fixture: { documents: 100, characters: 1000000, messages: 10000, events: 1000, warmups: 2, repeats: 11, backupRepeats: 5 },
  seedMs, samples, summary: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { p50: percentile(values, 0.5), p95: percentile(values, 0.95) }])),
  payloadBytes, rssBytes: process.memoryUsage().rss, databaseBytes: fs.statSync(path.join(root, '.novelclient/state.sqlite')).size,
  eventLoopDelayMs: { p50: delay.percentile(50) / 1e6, p95: delay.percentile(95) / 1e6 }
};
store.close();
fs.writeFileSync(`docs/refactor/performance/${mode}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode, seedMs, summary: report.summary, payloadBytes }, null, 2));
