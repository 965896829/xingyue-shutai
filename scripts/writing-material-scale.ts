import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { contextBook } from '../tests/fixtures/context-book';
import { fakeProfile } from '../tests/fixtures/refactor';
import { compileContext, contextPayload } from '../src/core/context-compiler';
import { preloadOutputTargets } from '../src/core/runtime/context-preload';
import { batchPath, rhythmPath, taskPath, detailPath, prosePath, paths } from '../src/core/domain';
import { writingTarget } from '../src/shared/writing-target';
import { requestBody } from '../src/core/provider';
import { encodeFacts } from '../src/core/memory-records';
import { hash } from '../src/core/domain';
import type { Run } from '../src/shared/types';

if (!process.argv.includes('--run')) throw new Error('以 --run 运行合成历史验收');
const book = contextBook(false), store = book.store;
const profile = { ...fakeProfile, contextLimit: 200000 };
const measurements = [];
try {
  const ruleFile = '02_项目配置/合成验收作者约定.md', guard = '渡船老人不能替林澈作出交还玉钥的决定。';
  const permanent = { ...book.facts[0], id: 'permanent-author-rule', value: guard, scope: 'global' as const, toChapter: null,
    evidence: [{ path: ruleFile, hash: hash(guard), quote: guard }] };
  store.commit([{ path:ruleFile,content:guard,baseHash:null }, { path:paths.items,baseHash:store.db.document(paths.items)!.hash,
    content:encodeFacts(store.readAccepted(paths.items).content,[...book.facts,permanent]) }], store.db.project());
  let previous = 0;
  for (const length of [100, 500, 1200]) {
    const project = structuredClone(store.db.project());
    project.config.targetWords = 5000000;
    project.chapter = length + 1; project.revision++; project.stage = 'S10';
    const target = writingTarget(project, project.chapter, []);
    project.batches = [target.batch];
    const changes = new Map<string, string>();
    for (let n = previous + 1; n <= length; n++) {
      project.chapters[n] = 'complete';
      if (!store.db.document(prosePath(n))) changes.set(prosePath(n), '# 第' + n + '章\n\n' + ('无关的旧事' + n + '。').repeat(315));
    }
    changes.set(prosePath(length), '林澈在码头遇到渡船老人。上一章留下未交还的钥匙。');
    const history = Array.from({length}, (_, n) => '| 第' + (n + 1) + '章 | 远城索引' + (n + 1) + ' | 旧日旁人经过 |').join('\n');
    changes.set(paths.timeline, '# 时间线\n\n| 章节 | 对象 | 事件 |\n| --- | --- | --- |\n' + history);
    changes.set(batchPath(target.batch), '## 第' + project.chapter + '章\n林澈找渡船老人归还玉钥。');
    changes.set(rhythmPath(target.batch), '## 第' + project.chapter + '章\n交涉。');
    changes.set(taskPath(project.chapter), '# 任务\n林澈找渡船老人。');
    changes.set(detailPath(project.chapter), '# 本章细纲\n## 场面1：归还玉钥\n- 焦点人物：林澈\n- 交流对象：渡船老人');
    store.commit([...changes].map(([file, content]) => ({ path: file, content, baseHash: store.db.document(file)?.hash ?? null })), project);
    const metrics: Record<string, {bytes: number; ledgerBytes: number; ms: number}> = {};
    for (const phase of ['planning', 'prose', 'memory'] as const) {
      const start = performance.now(), stage = phase === 'planning' ? 'S09' : 'S10';
      const manifest = compileContext(store, project, stage, '林澈找渡船老人交还玉钥', profile);
      if (phase === 'memory') preloadOutputTargets(store, { mode: 'stage', stage, chapter: project.chapter, pipeline: {phase:'memory'}, changes: [] } as unknown as Run, project, manifest);
      const payload = contextPayload(manifest, project, phase === 'planning' ? 'tools' : phase);
      const data = JSON.stringify(requestBody(profile,'合成规模验收',[{role:'user',content:JSON.stringify(payload)}],[]).body);
      const selectedIds = [...manifest.retrievedFacts ?? [], ...manifest.hardConstraints ?? []].map(f => f.id);
      assert.ok(selectedIds.includes('arm') && manifest.hardConstraints?.some(f => f.id === permanent.id), '实际选择：' + selectedIds.join(','));
      assert.ok(data.includes('骨折') && data.includes(guard), '旧伤与作者约束进入各阶段出站资料');
      assert.ok(!data.includes('旧日旁人经过') && !data.includes('远城索引'), '无关历史不能进入本章材料');
      metrics[phase] = {bytes:Buffer.byteLength(data), ledgerBytes:payload.sources.filter(s => s.path.startsWith('04_')).reduce((n,s) => n+Buffer.byteLength(s.content),0),ms:Math.round(performance.now()-start)};
    }
    measurements.push({ chapters: length, participants:['林澈','渡船老人'], metrics });
    previous = length;
  }
  for (const phase of ['planning','prose','memory']) {
    const widths = measurements.map(m => m.metrics[phase].bytes);
    const ledgerWidths = measurements.map(m => m.metrics[phase].ledgerBytes);
    assert.ok(Math.max(...ledgerWidths) - Math.min(...ledgerWidths) < 512, '台账摘录应保持有界');
    assert.ok(widths.slice(1).every(bytes => bytes <= widths[0] + 2048), '无关历史导致请求增长：' + JSON.stringify(widths));
  }
  const directory = path.resolve('.test-output/writing-material-acceptance'); fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'scale.json'), JSON.stringify(measurements,null,2));
  console.table(measurements.map(m => ({ chapters:m.chapters, planningBytes:m.metrics.planning.bytes, proseBytes:m.metrics.prose.bytes, memoryBytes:m.metrics.memory.bytes })));
} finally { store.close(); }
