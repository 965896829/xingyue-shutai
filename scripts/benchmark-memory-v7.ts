import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { FileStore } from '../src/core/storage';
import { hash, newProject, paths, prosePath } from '../src/core/domain';
import { factSchema } from '../src/shared/types';
import { encodeFacts, rebuildMemory } from '../src/core/memory-records';
import { compileContext } from '../src/core/context-compiler';
import { profileSchema } from '../src/shared/types';
import { characterState, retrieveMemory } from '../src/core/memory-studio';

const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('请提供基准标签，如 before 或 after');
const directory = path.resolve('.test-output/xingyue-v7');
fs.mkdirSync(directory, { recursive: true });
const output = path.join(directory, `memory-${label}.json`);
if (fs.existsSync(output)) throw new Error('此基准标签已有证据，请使用新标签');
const results: unknown[] = [];
const extended = process.argv.includes('--extended');
const diskSize = (root: string): number => fs.readdirSync(root, { withFileTypes: true }).reduce((size, entry) => size + (entry.isDirectory() ? diskSize(path.join(root, entry.name)) : fs.statSync(path.join(root, entry.name)).size), 0);
for (const chapters of [100, 500, 1000]) {
  const root = fs.mkdtempSync(path.join(directory, `memory-${label}-${chapters}-`));
  const store = new FileStore(root);
  const p = newProject('合成长篇性能夹具', root, { targetWords: chapters * 3000 });
  p.chapter = chapters + 1;
  const prose = Array.from({ length: chapters }, (_, index) => {
    const chapter = index + 1;
    return {
      path: prosePath(chapter),
      content:
        `# 第${chapter}章\n\n人物${chapter % 30}在第${chapter}次会面确认凭证，记录事实与证据。` +
        '故事继续，记录各自的选择及后果。'.repeat(30),
      baseHash: null
    };
  });
  const facts = prose.flatMap((source, index) =>
    Array.from({ length: 4 }, (_, item) =>
      factSchema.parse({
        id: `fact-${index}-${item}`,
        subject: `人物${(index + 1) % 30}`,
        predicate: `状态-${index}-${item}`,
        value: `凭证-${index}-${item}`,
        kind: 'event',
        category: 'character',
        entityIds: [`CH${(index + 1) % 30}`],
        fromChapter: index + 1,
        revealedAt: index + 1,
        reviewStatus: 'accepted',
        evidence: [
          { path: source.path, hash: hash(source.content), quote: '故事继续，记录各自的选择及后果。' }
        ]
      })
    )
  );
  try {
    store.commit(
      [...prose, { path: paths.roles, content: encodeFacts('# 人物状态', facts), baseHash: null }],
      p
    );
    let objectReads = 0;
    const originalObject = store.object.bind(store);
    store.object = (digest) => {
      objectReads++;
      return originalObject(digest);
    };
    const measure = (name: string, work: () => unknown) => {
      const samples: number[] = [],
        reads: number[] = [];
      for (let index = 0; index < 4; index++) {
        objectReads = 0;
        const started = performance.now();
        work();
        samples.push(performance.now() - started);
        reads.push(objectReads);
      }
      return { name, coldMs: samples[0], warmMs: samples.slice(1), objectReads: reads };
    };
    const scope = { chapter: chapters + 1, viewpoint: 'author' };
    const metrics = [
      measure('retrieve', () => retrieveMemory(store, '', scope, 20)),
      measure('character', () => characterState(store, 'CH1', scope)),
      measure('commit-unrelated', () => {
        const next = store.db.project();
        next.revision++;
        store.commit(
          [
            {
              path: paths.progress,
              content: `修订 ${next.revision}`,
              baseHash: store.db.document(paths.progress)?.hash ?? null
            }
          ],
          next
        );
      })
    ];
    const diskBefore = diskSize(root);
    if (extended) {
      const profile = profileSchema.parse({ id: 'benchmark', name: '工程容量测试', protocol: 'chat', baseUrl: 'http://127.0.0.1:1/v1', model: 'offline', contextLimit: 1000000, outputLimit: 4096 });
      metrics.push(measure('context-compile-discussion', () => compileContext(store, store.db.project(), 'S01', '人物1的当前状态', profile, { purpose: 'discussion', allowConflicts: true })));
      metrics.push(measure('snapshot-metadata', () => store.db.snapshotInfo(store.db.headRef()!.id)));
      const expected = hash(JSON.stringify(store.db.facts().sort((a, b) => a.id.localeCompare(b.id))));
      metrics.push(measure('rebuild', () => rebuildMemory(store)));
      if (hash(JSON.stringify(store.db.facts().sort((a, b) => a.id.localeCompare(b.id)))) !== expected) throw new Error('重建与增量索引语义不一致');
    }
    results.push({
      chapters,
      characters: 30,
      facts: facts.length,
      evidence: facts.length,
      proseCodePoints: prose.reduce((sum, source) => sum + Array.from(source.content).length, 0),
      factsHash: hash(JSON.stringify(store.db.facts().sort((a, b) => a.id.localeCompare(b.id)))),
      metrics,
      memory: process.memoryUsage(),
      processPeakRssKiB: process.resourceUsage().maxRSS,
      diskBefore,
      diskAfter: diskSize(root),
      root
    });
  } finally {
    store.close();
  }
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        label,
        createdAt: new Date().toISOString(),
        node: process.version,
        platform: os.platform(),
        release: os.release(),
        cpu: os.cpus()[0]?.model,
        samples: 4,
        cacheConditions: 'first sample is process-local first access, not an OS cold cache; following three samples are warm',
        extendedMetrics: extended ? 'new absolute observations; no retroactive before/after performance claim' : null,
        nature: 'synthetic_engineering_load_not_literary_quality',
        target:
          'Warm median must not regress by more than 20%; source objects read at most once per query; fact hashes unchanged.',
        results
      },
      null,
      2
    )
  );
}
console.log(output);
