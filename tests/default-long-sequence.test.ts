import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { fixtureCoverage, fixtureAuditEvidence } from './fixtures/chapter-coverage';
import { stageOutputs, prosePath, qualityPath, paths, hash, countWords, updatePath } from '../src/core/domain';
import { factSchema, type Fact } from '../src/shared/types';
import { requiredCharacterCoverage } from '../src/core/chapter-memory';
import { proposalHash } from '../src/core/storage';
import { retrieveMemory } from '../src/core/memory-studio';
import { attempts } from '../src/core/runtime/model-gateway';

test('20章正常篇幅连续通过默认规划、首稿、审核、记忆和采纳，前章状态实际进入后章请求', { timeout: 360000 }, async () => {
  let service: Service, calls = 0, entity = '';
  const wireSizes: number[] = [], rows: object[] = [];
  const output = path.resolve('.test-output/creation-upgrade-20261030/continuous'); fs.mkdirSync(output, { recursive: true });
  service = new Service(path.resolve('resources/skill'), () => {}, async (_profile, system, messages, tools) => {
    calls++; wireSizes.push(Buffer.byteLength(JSON.stringify({ system, messages, tools })));
    const store = service.store!, p = store.db.project(), r = store.db.runs().find(r => r.status === 'running')!;
    const input = JSON.parse(messages[0].content);
    if (input.items) {
      const memory = { decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '合成夹具仅验证状态、文稿版本和来源连线。', evidence: fixtureAuditEvidence(item, input.sources) })) };
      const plans = { decisions: (input.plans ?? []).map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '测试夹具保持已授权的后续计划。', planQuote: input.sources.find((s: any) => s.path === plan.path).content.slice(0, 30), proseQuote: input.sources.find((s: any) => s.path === input.prose.path).content.slice(0, 30) })) };
      return fakeResult(JSON.stringify(input.plans ? { memory, plans } : memory));
    }
    if (!tools.length) {
      const states = [...input.facts ?? [], ...input.authorRules ?? []].filter((f: Fact) => f.predicate === '左臂状态');
      if (p.chapter === 2 || p.chapter === 3) assert.ok(states.some((f: Fact) => f.value === '受伤'));
      if (p.chapter >= 4) { assert.ok(states.some((f: Fact) => f.value === '痊愈')); assert.ok(!states.some((f: Fact) => f.value === '受伤')); }
      const state = p.chapter <= 2 ? '阿宁的左臂受伤了。' : '阿宁的左臂已经痊愈。';
      return fakeResult(fixture(p, prosePath(p.chapter), service) + `\n\n${state}这是他第${p.chapter}次来诊所。`);
    }
    const memory = r.pipeline?.phase === 'memory';
    const files = r.stage === 'S09' ? stageOutputs('S09', p) : memory ? stageOutputs('S11', p) : [qualityPath(p.chapter)];
    const facts: Fact[] = [];
    if (memory && [1, 3].includes(p.chapter)) {
      entity ||= requiredCharacterCoverage(store, r).find(c => c.name === '阿宁')!.entityId;
      const quote = p.chapter === 1 ? '阿宁的左臂受伤了。' : '阿宁的左臂已经痊愈。';
      const prose = r.changes.find(c => c.path === prosePath(p.chapter))!.content;
      facts.push(factSchema.parse({ id: `arm-${p.chapter}`, subject: '阿宁', entityIds: [entity], kind: 'state', category: 'injury',
        predicate: '左臂状态', value: p.chapter === 1 ? '受伤' : '痊愈', characterLayer: 'current', fromChapter: p.chapter, revealedAt: p.chapter,
        supersedes: p.chapter === 3 ? 'arm-1' : null, replacementReason: p.chapter === 3 ? '本章正文明确写已痊愈' : '',
        knowledge: [{ who: entity, mode: 'seen', fromChapter: p.chapter }], evidence: [{ path: prosePath(p.chapter), hash: hash(prose), quote }] }));
    }
    const changes = files.map(file => {
      let content = memory && file.startsWith('04_') && file !== paths.behavior ? store.readAccepted(file).content : fixture(p, file, service);
      if (memory && file === paths.behavior && p.chapter > 1) content = store.readAccepted(file).content + '\n\n' + content.replace(/^# [^\n]*\n/, '');
      if (memory && file === updatePath(p.chapter)) content += `\n- 冲突来源：诊所线索出现分歧\n- 主角策略：核对第${p.chapter}次收到的收据\n- 局面变化：得到本章证据\n`;
      return service.change(file, content);
    });
    return { ...fakeResult(''), stop: 'tools' as const, calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes, ...(memory ? { facts, complete: true, coverage: fixtureCoverage(service, r, facts) } : {}) }) }] };
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 32768 }];
  const idle = async () => { while (service.runner!.controller) await new Promise(resolve => setTimeout(resolve, 10)); };
  try {
    await service.invoke('project.create', { parent: isolatedRoot('twenty-default-chapters'), title: '连续流程验收', premise: '阿宁求医并核对收据', config: { defaultProfileId: fakeProfile.id, maxRounds: 12, preview: { enabled: false } } });
    const store = service.store!;
    for (const stage of ['S01','S02','S03','S04','S05','S06','S07','S08'] as const) {
      const p = store.db.project(); store.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    }
    const initial = store.db.project(); initial.stage = 'S09'; store.db.set('project', initial);
    for (let chapter = 1; chapter <= 20; chapter++) {
      const started = Date.now(), before = calls;
      const planning = await service.invoke('run.start', { request: '生成本章任务和细纲' }); await idle();
      let run = store.db.run(planning); assert.equal(run.status, 'awaiting_review', `第${chapter}章规划：${run.error ?? JSON.stringify(run.issues)}`);
      await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run), startNext: false });
      const writing = await service.invoke('run.start', { request: '生成正文' }); await idle();
      run = store.db.run(writing); assert.equal(run.status, 'awaiting_review', `第${chapter}章正文：${run.error ?? JSON.stringify(run.issues)}`);
      assert.equal(run.pipeline?.phase, 'ready');
      const first = run.changes.find(c => c.path === prosePath(chapter))!;
      assert.ok(countWords(first.content) >= 2300 && countWords(first.content) <= 2700);
      fs.writeFileSync(path.join(output, `chapter-${chapter}-candidate.txt`), first.content);
      await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run), startNext: false });
      assert.equal(store.db.project().chapter, chapter + 1);
      assert.equal(store.db.project().chapters[chapter], 'complete');
      assert.equal(store.readAccepted(prosePath(chapter)).content, first.content);
      rows.push({ chapter, calls: calls - before, elapsedMs: Date.now() - started, words: countWords(first.content), firstHash: hash(first.content), finalHash: store.db.document(prosePath(chapter))!.hash,
        sourceSnapshots: [run.baseSnapshotId, store.db.headRef()!.id], attempts: attempts(store, writing).map(a => ({ purpose: a.purpose, requestHash: a.requestHash, requestRef: a.requestRef, status: a.status })) });
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ model: 'offline-fixture', realModelCalls: 0, actualCost: 0, literaryQualityVerified: false, rows, requestBytes: wireSizes }, null, 2));
    }
    assert.ok(retrieveMemory(store, '阿宁', { chapter: 2 }).facts.some(f => f.fact.id === 'arm-1'));
    assert.ok(retrieveMemory(store, '阿宁', { chapter: 3 }).facts.some(f => f.fact.id === 'arm-3'));
    assert.equal(store.db.facts().find(f => f.id === 'arm-3')?.characterLayer, 'current');
    assert.equal(calls, 100, '每章五个常规阶段，默认不增加人物或润色请求');
  } finally { await service.drain(); }
});
