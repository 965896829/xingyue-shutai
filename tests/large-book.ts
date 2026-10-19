import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { FileStore } from '../src/core/storage';
import { newProject, prosePath, countWords, paths, hash, detailPath, taskPath, batchPath, activeBatch, rhythmPath } from '../src/core/domain';
import { initialFiles } from '../src/core/skill';
import { encodeFacts, rebuildMemory } from '../src/core/memory';
import { retrieveMemory } from '../src/core/memory-studio';
import { compileContext } from '../src/core/context-compiler';
import { factSchema, type Change } from '../src/shared/types';
import { fakeProfile } from './fixtures/refactor';
import { Service } from '../src/core/service';

const argument = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const chapters = Number(argument('chapters', '20000')), words = Number(argument('words', '2500'));
assert.ok(Number.isSafeInteger(chapters) && chapters >= 100 && Number.isSafeInteger(words) && words >= 100);
const folder = path.resolve(argument('output', '.test-output/scale-50m-20261012'));
const root = path.join(folder, 'book');
fs.mkdirSync(root, { recursive: true });
const reportFile = path.join(folder, 'large-book-report.json');
const report: any = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { version: 1, chapters, words, bodyCharacters: chapters * words, root, at: new Date().toISOString(), phases: {}, memory: [], checks: {} };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const sample = (phase: string) => { const m = process.memoryUsage(); report.memory.push({ phase, rssMiB: Math.round(m.rss / 1048576), heapMiB: Math.round(m.heapUsed / 1048576), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }); };
const emit = (phase: string, value: unknown) => { console.log(JSON.stringify({ phase, value })); save(); };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const clauses = ['城东街道上有人低声议论失踪的渡船。','雨停以后石阶仍有积水，老人提灯走过桥头。','守卫检查木箱里的货单，没有找到盖印的那一页。','茶铺门口的孩子指着西岸，却不肯说出昨夜来客的姓名。','风从巷口吹来，远处的船夫收起湿透的绳索。','同伴把沿途见闻记在纸上，留待回去逐条核对。','案卷里记载的时间互相矛盾，必须再找当事人询问。','几人依次穿过仓库，把新发现和既有证据分开放置。'];
function chapterText(n: number) {
  const quote = n === chapters ? '林澈右臂骨折尚未治疗，不能用右手提重物。' : `林澈追查第${n}号伏笔，证物记录为青铜令牌${n}。`;
  let state = n, body = quote;
  while (Array.from(body).length < words) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; body += clauses[state % clauses.length]; }
  body = Array.from(body).slice(0, words).join('');
  const content = `# 第${n}章\n\n` + body.match(/.{1,180}/gu)!.join('\n\n');
  assert.equal(countWords(content), words);
  return { quote, content };
}

if (argument('mode', 'seed') === 'seed') {
  const store = new FileStore(root), start = performance.now();
  try {
    store.recover();
    let project = store.db.project();
    if (!project) {
      project = newProject('五千万字压力验收', root, { targetWords: chapters * words, chapterWords: words, minWords: Math.min(2300, words), maxWords: Math.max(2700, words), defaultProfileId: fakeProfile.id });
      project.stage = 'S10'; project.revision = 1;
      const files = initialFiles(project, path.resolve('resources/skill'), '林澈在港城寻找青铜令牌。');
      delete files[prosePath(1)];
      files[paths.world] = '# 世界规则\n\n林澈不能瞬移；没有治疗证据时，旧伤仍然有效。';
      store.commit(Object.entries(files).map(([path, content]) => ({ path, content, baseHash: null })), project);
    }
    let completed = Number(store.db.get('scaleSeedCompleted') ?? 0);
    for (let base = completed + 1; base <= chapters; base += 100) {
      const end = Math.min(chapters, base + 99), changes: Change[] = [];
      for (let n = base; n <= end; n++) { const file = prosePath(n); changes.push({ path: file, content: chapterText(n).content, baseHash: store.db.document(file)?.hash ?? null }); project.chapters[n] = 'complete'; }
      project.chapter = end; project.revision++;
      store.commit(changes, project); store.db.set('scaleSeedCompleted', end); completed = end;
      if (end % 1000 === 0 || end === chapters) { sample(`seed-${end}`); report.seeded = completed; emit('seed', { chapters: end, seconds: Math.round((performance.now() - start) / 1000), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }); }
      await tick();
    }
    if (!store.db.get('scaleFactsReady')) {
      const facts = Array.from({ length: chapters }, (_, i) => {
        const n = i + 1, source = chapterText(n);
        return factSchema.parse({ id: `scale-fact-${n}`, subject: '林澈', aliases: ['小澈'], entityIds: ['linche'], predicate: n === chapters ? '右臂状态' : `线索${n}`, value: n === chapters ? '骨折，尚未治疗' : `青铜令牌${n}`, kind: 'event', category: n === chapters ? 'injury' : 'timeline', fromChapter: n, toChapter: n === chapters ? null : n, revealedAt: n, reviewStatus: 'accepted', mandatory: n === chapters, evidence: [{ path: prosePath(n), hash: hash(source.content), quote: source.quote }] });
      });
      const finalFiles = { [paths.items]: encodeFacts('# 正式事实记录', facts), [paths.volumes]: '# 分卷目标\n\n寻找青铜令牌的来源。', [paths.outline]: `# 总纲\n\n## 第${chapters}章\n\n林澈到码头询问，保护右臂。`, [taskPath(chapters)]: `# 第${chapters}章任务\n\n调查码头，不能自行恢复伤势。`, [detailPath(chapters)]: `# 第${chapters}章细纲\n\n林澈询问渡船老人。`, [batchPath(activeBatch(project))]: `# 章节计划\n\n## 第${chapters}章\n\n核对青铜令牌与前文约定。`, [rhythmPath(activeBatch(project))]: '# 节奏\n\n延续本章调查。' };
      project.revision++;
      store.commit(Object.entries(finalFiles).map(([path, content]) => ({ path, content, baseHash: store.db.document(path)?.hash ?? null })), project);
      store.db.set('scaleFactsReady', true);
    }
    report.phases.seedFinalizationMs = Math.round(performance.now() - start); report.seeded = completed; sample('seed-finished'); save();
  } finally { store.close(); }
} else {
  const preparation = new FileStore(root);
  try {
    assert.equal(preparation.db.get('scaleSeedCompleted'), chapters);
    assert.equal(preparation.db.get('scaleFactsReady'), true);
    const original = chapterText(2).content, current = preparation.readAccepted(prosePath(2));
    if (current.hash !== hash(original)) {
      const project = preparation.db.project(); project.revision++;
      preparation.commit([{ path: current.path, content: original, baseHash: current.hash }], project);
    }
  } finally { preparation.close(); }
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => { throw new Error('容量验收不得调用远端模型'); });
  service.profiles = [{ ...fakeProfile, contextLimit: 500000, outputLimit: 6000 }];
  let started = performance.now();
  try {
    const snapshot = await service.open(root); report.phases.openMs = Math.round(performance.now() - started); sample('opened'); emit('opened', { milliseconds: report.phases.openMs });
    const store = service.store!, project = store.db.project();
    report.checks.documents = snapshot.documents.filter(d => d.path.startsWith('07_')).length;
    assert.equal(report.checks.documents, chapters); assert.equal(store.db.facts().length, chapters);
    const timings: number[] = [];
    for (let i = 0; i < 30; i++) {
      const n = 101 + (i * 631) % (chapters - 101);
      started = performance.now();
      const found = retrieveMemory(store, `第${n}号伏笔`, { chapter: chapters });
      assert.ok(found.documents.some(d => d.path === prosePath(n)));
      timings.push(Math.round(performance.now() - started));
      console.log(JSON.stringify({ phase: 'query', chapter: n, milliseconds: timings.at(-1) }));
      if (i % 5 === 4) { globalThis.gc?.(); sample(`search-${i + 1}`); emit('search', { count: i + 1, lastMs: timings.at(-1) }); }
      await tick();
    }
    report.phases.searchMs = timings;
    started = performance.now(); const manifest = compileContext(store, project, 'S10', '小澈到码头询问青铜令牌，旧伤是否已经痊愈？', service.profiles[0]);
    report.phases.compileMs = Math.round(performance.now() - started); report.checks.packetBytes = Buffer.byteLength(JSON.stringify(manifest));
    assert.ok(manifest.hardConstraints!.some(f => f.id === `scale-fact-${chapters}`)); sample('compiled');
    const original = store.readAccepted(prosePath(2)), before = store.db.get<string>('headSnapshot')!;
    started = performance.now(); project.revision++;
    store.commit([{ path: original.path, content: original.content + '\n\n一段新增的验收修订。', baseHash: original.hash }], project);
    report.phases.saveMs = Math.round(performance.now() - started);
    assert.equal(store.readAccepted(original.path, before).content, original.content);
    assert.match(store.readAccepted(original.path).content, /验收修订/);
    const failedRevision = structuredClone(project); failedRevision.revision++;
    const current = store.readAccepted(original.path);
    assert.throws(() => store.commit([{ path: original.path, content: current.content + '\n故障后恢复。', baseHash: current.hash }], failedRevision, undefined, point => { if (point === 'after-database') throw new Error('模拟中断'); }), /模拟中断/);
    store.recover(); assert.match(store.readAccepted(original.path).content, /故障后恢复/); report.checks.recovery = true;
    report.checks.snapshotHistory = store.db.sql.prepare('SELECT COUNT(*) AS count,SUM(length(data)) AS bytes FROM snapshots').get();
    globalThis.gc?.(); sample('completed'); report.complete = true; delete report.error; emit('complete', report.phases);
  } catch (error) { report.complete = false; report.error = (error as Error).stack; save(); throw error; }
  finally { await service.drain(); }
}
