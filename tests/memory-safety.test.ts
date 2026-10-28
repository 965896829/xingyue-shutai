import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Service } from '../src/core/service';
import type { Caller } from '../src/core/runner';
import { encodeFacts, rebuildMemory, searchMemory } from '../src/core/memory';
import { retrieveMemory, characterState, scopedRead } from '../src/core/memory-studio';
import { prepareMemoryRepair, memoryRepairRequest } from '../src/core/memory-repair';
import { memoryReviewInput, parseMemoryReview } from '../src/core/memory-review';
import { SemanticIndex } from '../src/core/embeddings';
import { embeddingSettingsSchema, memoryScopeSchema } from '../src/shared/studio';
import { factSchema } from '../src/shared/types';
import { paths, prosePath, hash, activeBatch, batchPath, detailPath, taskPath, rhythmPath, stageOutputs } from '../src/core/domain';
import { proposalHash, FileStore } from '../src/core/storage';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { RequestError } from '../src/core/provider';
import { controllerRules } from '../src/core/agent-control';
import { fixture } from './fixtures/workflow';
import { changedStoryStates, continuityIssues } from '../src/core/story-impact';
import { pastPlanText } from '../src/core/context-slices';
import { compileContext } from '../src/core/context-compiler';

const profile = { ...fakeProfile, contextLimit: 200000, outputLimit: 4096, stream: false };
const body = '# 第一章\n\n阿宁右臂骨折，尚未治疗。';
const later = '# 第二章\n\n阿宁右臂骨折，尚未治疗。';

const caller: Caller = async (_profile, system, messages) => {
  const input = JSON.parse(messages[0].content);
  if (system.includes('你独立核对本章实际正文')) return fakeResult(JSON.stringify({ decisions: input.plans.map((plan: any) => ({
    path: plan.path, verdict: 'needs_review', reason: '离线夹具保守保留待同步计划，仍需核对康复后的行动安排',
    planQuote: plan.content.slice(0, 24), proseQuote: input.prose.content.slice(0, 24)
  })) }));
  if (system.includes('你独立检查')) return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => {
    const source = input.sources.find((source: any) => source.path === (item.path ?? item.fact.evidence[0].path));
    return { id: item.id, verdict: 'supported', reason: '离线夹具逐条比对原文', evidence: [{ path: source.path, quote: source.content.slice(0, 24) }] };
  }) }));
  assert.ok(input.file, '同步调用必须包含当前文件');
  const content = input.file.path.startsWith('07_') && input.changedSources.some((source: any) => source.content.includes('完全痊愈'))
    ? input.file.content.replace('骨折，尚未治疗', '已经完全痊愈') : null;
  const current = content ?? input.file.content;
  return fakeResult(JSON.stringify({ content, reason: '已与修改后的原文核对',
    records: input.previousFacts.map((old: any) => ({ replaces: old.id, reason: '以当前原文更新状态', fact: {
      ...old, state: 'active', value: current.includes('痊愈') ? '已经完全痊愈' : old.value,
      evidence: [{ path: input.file.path, hash: input.file.hash, quote: current.split('\n\n')[1] }]
    } })), withdrawn: [] }));
};

async function setup(invoke: Caller = caller) {
  const service = new Service(path.resolve('resources/skill'), () => {}, invoke);
  service.profiles = [profile];
  await service.invoke('project.create', { parent: isolatedRoot('memory-safety'), title: '合成记忆验证', premise: '只用于离线验证',
    config: { defaultProfileId: profile.id, chapterWords: 50, minWords: 1, maxWords: 500, maxRounds: 40 } });
  const store = service.store!, project = store.db.project();
  project.chapter = 3;
  project.chapters = { 1: 'complete', 2: 'complete' };
  project.revision++;
  const make = (chapter: number, content: string) => factSchema.parse({ id: `injury-${chapter}`, subject: '阿宁', entityIds: ['ning'],
    predicate: '右臂状态', value: '骨折', kind: 'event', category: 'injury', reviewStatus: 'accepted',
    fromChapter: chapter, toChapter: chapter === 1 ? 1 : null, revealedAt: chapter,
    evidence: [{ path: prosePath(chapter), hash: hash(content), quote: content.split('\n\n')[1] }] });
  const facts = [make(1, body), make(2, later)];
  store.commit([
    { path: prosePath(1), content: body, baseHash: store.db.document(prosePath(1))?.hash ?? null },
    { path: prosePath(2), content: later, baseHash: null },
    { path: paths.items, content: encodeFacts(store.readAccepted(paths.items).content, facts), baseHash: store.db.document(paths.items)!.hash }
  ], project);
  return { service, store, project, facts };
}

test('待核对来源在普通、人物、直接读取和语义检索中统一排除，历史版本独立可用', async () => {
  const { service, store, project } = await setup();
  try {
    const historic = store.db.head()!.id;
    const index = new SemanticIndex(store, () => ({ settings: embeddingSettingsSchema.parse({ enabled: true, model: 'mock', dimensions: 2, dataScope: 'prose-and-memory' }), apiKey: 'fixture' }), () => {},
      { embed: async input => ({ vectors: input.map(() => [1, 0]), tokens: 1 }) });
    await index.rebuild();
    project.stale = [prosePath(2)];
    project.chapters[2] = 'stale';
    project.revision++;
    store.commit([{ path: paths.impact, content: '第 2 章因为前文修改需要核对。', baseHash: store.db.document(paths.impact)!.hash }], project);
    const scope = memoryScopeSchema.parse({ chapter: 3 });
    for (const result of [retrieveMemory(store, '阿宁', scope), searchMemory(store, '阿宁', 3), await index.retrieve('阿宁', scope)]) {
      assert.ok(!result.facts.some(item => item.fact.id === 'injury-2'));
      assert.ok(!result.documents.some(item => item.path === prosePath(2)));
    }
    assert.equal(characterState(store, 'ning', scope).facts.length, 0);
    assert.throws(() => scopedRead(store, prosePath(2), scope), /待核对/);
    assert.equal(retrieveMemory(store, '阿宁', { chapter: 3, mode: 'historical', snapshotId: historic }).facts.length, 1);
    assert.throws(() => retrieveMemory(store, '阿宁', { chapter: 3, snapshotId: historic }), /历史回看/);
  } finally { await service.drain(); }
});

test('只调整空行和缩进时重定位证据，不把未改变的剧情与后续章节全部标记失效', async () => {
  const { service, store } = await setup();
  try {
    const before = store.db.facts().find(fact => fact.id === 'injury-1')!;
    const id = await service.invoke('document.save', { path: prosePath(1), baseHash: hash(body), content: body.replace('\n\n', '\r\n\r\n\r\n  ') });
    await service.invoke('run.accept', { id, proposalHash: proposalHash(store.db.run(id)) });
    const after = store.db.facts().find(fact => fact.id === before.id)!;
    assert.equal(after.reviewStatus, 'accepted');
    assert.notEqual(after.evidence[0].hash, before.evidence[0].hash);
    assert.equal(after.evidence[0].quote, before.evidence[0].quote);
    assert.deepEqual(store.db.project().stale, []);
    assert.equal(store.db.project().chapters[2], 'complete');
  } finally { await service.drain(); }
});

for (const changeBudget of [false, true]) test(`记忆同步逐项修正文稿与事实，独立审核后一次接受并关闭待核对队列${changeBudget ? '（调整预算并交接）' : ''}`, async () => {
  const { service, store } = await setup();
  try {
    const edit = await service.invoke('document.save', { path: prosePath(1), baseHash: hash(body), content: body.replace('骨折，尚未治疗', '已经完全痊愈') });
    await service.invoke('run.accept', { id: edit, proposalHash: proposalHash(store.db.run(edit)) });
    assert.equal(store.db.project().chapters[2], 'stale');
    const run = service.makeRun('revision', '同步记忆');
    run.memoryRepair = prepareMemoryRepair(store);
    store.db.saveRun(run);
    await service.runner!.drive(run.id);
    let ready = store.db.run(run.id);
    assert.equal(ready.status, 'awaiting_review', JSON.stringify({ error: ready.error, issues: ready.issues }));
    assert.equal(store.readAccepted(prosePath(2)).content, later);
    assert.ok(ready.memoryReview && !ready.memoryReview.issues.length);
    if (changeBudget) {
      const reviewed = structuredClone(ready.memoryReview), completed = structuredClone(ready.memoryRepair!.completed);
      await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 50 } });
      service.runner!.check(ready, store.db.project());
      assert.deepEqual(ready.issues.filter(issue => issue.severity === 'error'), []);
      ready = service.rebuildRun(store.db.run(run.id), profile.id);
      assert.deepEqual(ready.memoryRepair!.completed, completed);
      assert.deepEqual(ready.memoryReview, reviewed);
      service.runner!.check(ready, store.db.project());
      assert.deepEqual(ready.issues.filter(issue => issue.severity === 'error'), []);
    }
    await service.invoke('run.accept', { id: ready.id, proposalHash: proposalHash(ready) });
    assert.match(store.readAccepted(prosePath(2)).content, /完全痊愈/);
    assert.deepEqual(store.db.project().stale, []);
    assert.equal(store.db.project().chapters[2], 'complete');
    assert.equal(rebuildMemory(store).issues.length, 0);
    assert.ok(retrieveMemory(store, '阿宁', { chapter: 3 }).facts.every(item => item.fact.value.includes('痊愈')));
    assert.equal(store.db.sql.prepare("SELECT COUNT(*) AS n FROM review_queue WHERE status='pending'").get()!.n, 0);
  } finally { await service.drain(); }
});

test('独立语义检查拒绝骨折引文支持已痊愈，候选变化使审核回执失效', async () => {
  let reviews = 0;
  const { service, store, facts } = await setup(async (_profile, system, messages) => {
    if (!system.includes('你独立检查')) return fakeResult();
    reviews++;
    const input = JSON.parse(messages[0].content);
    return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'contradicted', reason: '原文仍为骨折未治疗，不能宣称痊愈', evidence: [{ path: prosePath(2), quote: '阿宁右臂骨折，尚未治疗。' }] })) }));
  });
  try {
    const run = service.makeRun('revision', '错误记忆验证');
    run.agentRulesHash = controllerRules(service.skillRoot).hash;
    run.facts = [{ ...facts[1], id: 'wrong', value: '已经完全痊愈', reviewStatus: 'candidate' }];
    run.changes = [{ path: paths.impact, content: '核对测试：不改变正式文稿。', baseHash: store.db.document(paths.impact)!.hash }];
    store.db.saveRun(run);
    await (service.runner as any).auditMemory(run, store.db.project(), profile, new AbortController().signal);
    service.runner!.check(run, store.db.project());
    assert.equal(reviews, 1);
    assert.ok(run.issues.some(issue => issue.code === 'memory_review' && issue.message.includes('不能宣称痊愈')));
    run.memoryReview = { fingerprint: memoryReviewInput(store, run).fingerprint, issues: [] };
    run.facts[0].value = '现在改成另一条结论';
    service.runner!.check(run, store.db.project());
    assert.ok(run.issues.some(issue => issue.code === 'memory_review'));
  } finally { await service.drain(); }
});

test('同步中的远端结果未知不自动重发，已处理文件留存且正式文稿不变', async () => {
  let calls = 0;
  const { service, store, project } = await setup(async (...args) => {
    calls++;
    if (calls === 2) throw new RequestError('合成连接中断', true);
    return caller(...args);
  });
  try {
    project.stale = [prosePath(1), prosePath(2)];
    project.chapters[1] = 'stale';
    project.chapters[2] = 'stale';
    store.db.set('project', project);
    const run = service.makeRun('revision', '同步');
    run.memoryRepair = prepareMemoryRepair(store);
    store.db.saveRun(run);
    await service.runner!.drive(run.id);
    const stopped = store.db.run(run.id);
    assert.equal(calls, 2);
    assert.equal(stopped.status, 'unknown');
    assert.equal(stopped.memoryRepair!.cursor, 1);
    assert.equal(store.readAccepted(prosePath(1)).content, body);
    assert.equal(service.runner!.controller, null);
  } finally { await service.drain(); }
});

test('核对按钮启动持久化同步任务，重复点击复用同一任务与操作回执', async () => {
  const { service, store } = await setup();
  try {
    const id = await service.invoke('document.save', { path: prosePath(1), baseHash: hash(body), content: body + '\n\n窗外下起了雨。' });
    await service.invoke('run.accept', { id, proposalHash: proposalHash(store.db.run(id)) });
    const receipt = await service.invoke('memory.rebuild', { profileId: profile.id }, { operationId: 'memory-repair-command' });
    assert.ok(receipt.runId);
    for (let i = 0; i < 200 && ['running', 'awaiting_review'].includes(store.db.run(receipt.runId!).status) && !store.db.run(receipt.runId!).memoryReview; i++)
      await new Promise(resolve => setTimeout(resolve, 20));
    const ready = store.db.run(receipt.runId!);
    assert.equal(ready.status, 'awaiting_review', JSON.stringify({ error: ready.error, issues: ready.issues }));
    const repeated = await service.invoke('memory.rebuild', { profileId: profile.id }, { operationId: 'memory-repair-command' });
    assert.deepEqual(repeated, receipt);
    assert.equal((await service.invoke('memory.rebuild', { profileId: profile.id })).runId, receipt.runId);
    await service.invoke('run.accept', { id: ready.id, proposalHash: proposalHash(ready) });
    assert.equal(store.readAccepted(prosePath(2)).content, later);
    assert.equal(retrieveMemory(store, '阿宁', { chapter: 3 }).facts[0].fact.value, '骨折');
    assert.deepEqual(store.db.project().stale, []);
  } finally { await service.drain(); }
});

test('语义审查不能用无关文件、遗漏编号或伪造引文通过核对', () => {
  const sources = [{ path: 'chapter.md', content: '阿宁右臂骨折。' }, { path: 'other.md', content: '窗外下雨。' }];
  const item = { id: 'document:chapter.md', path: 'chapter.md' };
  const result = (path: string, quote: string) => JSON.stringify({ decisions: [{ id: item.id, verdict: 'supported', reason: '合成依据', evidence: [{ path, quote }] }] });
  assert.throws(() => parseMemoryReview(result('other.md', '窗外下雨。'), [item], sources), /无关文件/);
  assert.throws(() => parseMemoryReview(result('chapter.md', '已经痊愈'), [item], sources), /真实原文/);
  assert.throws(() => parseMemoryReview('{"decisions":[]}', [item], sources), /逐条覆盖/);
});

function seedPlans(service: Service, stage: 'S09' | 'S11' = 'S09') {
  const store = service.store!, p = store.db.project();
  p.stage = stage;
  p.revision++;
  const files = [paths.roles, paths.world, paths.volumes, paths.outline, rhythmPath(activeBatch(p)), batchPath(activeBatch(p)),
    taskPath(2), detailPath(2), taskPath(3), detailPath(3), taskPath(4), detailPath(4)];
  store.commit(files.map(file => ({ path: file, baseHash: store.db.document(file)?.hash ?? null,
    content: fixture({ ...p, chapter: Number(file.match(/第(\d+)章/)?.[1] ?? p.chapter) }, file, service) })), p);
}

async function waitForRun(service: Service, runId: string) {
  for (let i = 0; i < 500 && service.runner!.controller; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const run = service.store!.db.run(runId);
  assert.equal(run.status, 'awaiting_review', JSON.stringify({ error: run.error, issues: run.issues }));
  return run;
}

test('重复提取同一状态不会触发新变化，康复和关系变化保留旧值与生效范围', async () => {
  const { service, facts } = await setup();
  try {
    assert.deepEqual(changedStoryStates(facts, [{ ...facts[1], id: 'again', fromChapter: 3 }]), []);
    const next = { ...facts[1], id: 'healed', fromChapter: 3, value: '已经完全痊愈', supersedes: facts[1].id };
    const changes = changedStoryStates(facts, [next]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].before, '骨折');
    assert.equal(changes[0].after, '已经完全痊愈');
    assert.equal(changes[0].fromChapter, 3);
  } finally { await service.drain(); }
});

test('正常章后采纳状态变化会先核对未来计划，不使已完成正文失效，继续按钮先启动同步', async () => {
  const { service, store, facts } = await setup();
  try {
    seedPlans(service, 'S11');
    const p = store.db.project(), content = '# 第三章\n\n阿宁右臂已经完全痊愈。';
    p.chapters[3] = 'prose_accepted_pending_aftermath';
    p.revision++;
    store.commit([{ path: prosePath(3), baseHash: null, content }], p);
    const run = service.makeRun('stage', '确认第三章的实际状态', profile.id);
    run.agentRulesHash = controllerRules(service.skillRoot).hash;
    run.changes = stageOutputs('S11', p).map(file => ({ path: file, baseHash: store.db.document(file)?.hash ?? null, content: fixture(p, file, service) }));
    run.facts = [{ ...facts[1], id: 'recovered-3', fromChapter: 3, toChapter: null, revealedAt: 3, supersedes: facts[1].id,
      value: '已经完全痊愈', replacementReason: '第三章治疗后康复', reviewStatus: 'candidate', evidence: [{ path: prosePath(3), hash: hash(content), quote: '阿宁右臂已经完全痊愈。' }] }];
    await (service.runner as any).auditMemory(run, p, profile, new AbortController().signal);
    assert.ok(run.futurePlanReview?.decisions.length);
    assert.ok(run.futurePlanReview.decisions.every(item => item.verdict === 'needs_review'));
    run.status = 'awaiting_review';
    store.db.saveRun(run);
    const result = await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run), startNext: true, warningReason: '离线流程验收' });
    assert.ok(result.nextRun);
    const next = store.db.project();
    assert.equal(next.chapter, 4);
    assert.equal(next.stage, 'S09');
    assert.equal(next.chapters[3], 'complete');
    assert.equal(next.storyImpacts?.[0].scope.fromChapter, 4);
    assert.equal(next.storyImpacts?.[0].stateChanges[0].after, '已经完全痊愈');
    assert.ok(next.stale.includes(paths.outline));
    assert.ok(!next.stale.some(file => file.startsWith('07_') || file === detailPath(3)));
    assert.throws(() => compileContext(store, next, 'S09', '继续第四章', profile), /待核对|需要核对/);
    const pending = store.db.run(result.nextRun!);
    assert.ok(pending.memoryRepair);
    assert.equal(pending.continuity?.mode, 'forward');
    assert.ok(pending.memoryRepair!.sources.includes(prosePath(3)), '同步计划必须收到状态变化的正式原文证据');
    assert.ok(pending.memoryRepair!.sources.includes(paths.world));
    assert.ok(pending.memoryRepair!.readonlySources!.includes(prosePath(3)));
    await waitForRun(service, pending.id);
    assert.equal(store.readAccepted(prosePath(3)).content, content);
  } finally { await service.drain(); }
});

test('后续调整按大纲到细纲传递候选，正式采纳前不覆盖，保留前文并原子闭环', async () => {
  const processed: string[] = [];
  const { service, store } = await setup(async (...args) => {
    const input = JSON.parse(args[2][0].content);
    if (args[1].includes('你独立检查')) return caller(...args);
    processed.push(input.file.path);
    let content = input.file.content;
    if (input.file.path === paths.volumes) content += '\n\n后续行动改为左手持盾。';
    if (input.file.path === paths.outline) {
      assert.ok(input.upstreamPlans.some((source: any) => source.path === paths.volumes && source.content.includes('左手持盾')));
      content = content.split('\n').map((line: string) => line.includes('| 第3章 |') ? line.replace('决定求医', '左手持盾') : line).join('\n');
    }
    if (input.file.path === detailPath(3)) {
      assert.ok(input.upstreamPlans.some((source: any) => source.path === paths.outline && source.content.includes('左手持盾')));
      content += '\n\n本章动作：左手持盾。';
      assert.ok(input.formatRequirements.requiredFields.includes('章节类型'));
      if (processed.filter(file => file === detailPath(3)).length === 1) content = content.replace('章节类型：', '章节形式：');
      else assert.match(input.correction, /当前文件格式需要修正.*章节类型/);
    }
    return fakeResult(JSON.stringify({ content, reason: '依据作者新约束同步后续行动，保留第 1—2 章', records: [], withdrawn: [] }));
  });
  try {
    seedPlans(service);
    const original = store.readAccepted(prosePath(2)).content;
    const oldDetail = store.readAccepted(detailPath(2)).content;
    const oldOutline = store.readAccepted(paths.outline).content;
    const run = service.makeRun('revision', '阿宁从第三章起右手不能握剑，后续改为左手持盾', profile.id);
    run.continuity = { mode: 'forward', fromChapter: 3 };
    run.changes = [{ path: paths.roles, baseHash: store.db.document(paths.roles)!.hash,
      content: store.readAccepted(paths.roles).content + '\n\n作者要求：从第三章起右手不能握剑，后续改为左手持盾。' }];
    run.status = 'awaiting_review';
    store.db.saveRun(run);
    await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run), warningReason: '离线流程验收' });
    const saved = service.snapshot();
    assert.ok(saved.project!.storyImpacts!.length);
    assert.equal(saved.project!.chapters[2], 'complete');
    const backup = await service.invoke('project.backup', { directory: isolatedRoot('continuity-backup') });
    const restored = await service.invoke('project.restoreBackup', { source: backup, parent: isolatedRoot('continuity-restored') });
    const restoredStore = new FileStore(restored);
    try { assert.deepEqual(restoredStore.db.project().storyImpacts, saved.project!.storyImpacts); }
    finally { restoredStore.close(); }
    const root = store.root;
    service.close();
    await service.open(root);
    assert.deepEqual(service.store!.db.project().storyImpacts, saved.project!.storyImpacts);
    const active = service.store!;
    const nextId = await service.invoke('run.start', { request: '继续第三章', profileId: profile.id });
    const ready = await waitForRun(service, nextId);
    assert.equal(ready.continuity?.mode, 'forward');
    assert.ok(processed.indexOf(paths.volumes) < processed.indexOf(paths.outline));
    assert.ok(processed.indexOf(paths.outline) < processed.indexOf(detailPath(3)));
    assert.equal(processed.filter(file => file === paths.volumes).length, 1, '局部格式错误不重做已通过的上游文件');
    assert.equal(processed.filter(file => file === paths.outline).length, 1);
    assert.equal(processed.filter(file => file === detailPath(3)).length, 2);
    assert.equal(ready.repairAttempts?.memory_sync, undefined);
    assert.ok(memoryRepairRequest(active, ready, paths.volumes, service.skillRoot).formatRequirements.requiredFields.includes('需要埋下的伏笔'));
    assert.ok(memoryRepairRequest(active, ready, batchPath(activeBatch(active.db.project())), service.skillRoot).formatRequirements.requiredFields.includes('依据文件'));
    assert.equal(active.readAccepted(paths.outline).content, oldOutline);
    assert.equal(active.readAccepted(prosePath(2)).content, original);
    const originalCandidate = ready.changes.find(change => change.path === paths.volumes)!.content;
    const changed = await service.invoke('run.update', { id: nextId, path: paths.volumes, content: originalCandidate + '\n临时改变已审核方案' });
    assert.ok(changed.issues.some(issue => issue.code === 'memory_review'));
    await assert.rejects(service.invoke('run.accept', { id: nextId, proposalHash: proposalHash(changed), warningReason: '不能沿用旧审核' }), /阻断/);
    await service.invoke('run.update', { id: nextId, path: paths.volumes, content: originalCandidate });
    await service.invoke('run.accept', { id: nextId, proposalHash: proposalHash(ready), warningReason: '离线流程验收' });
    assert.match(active.readAccepted(detailPath(3)).content, /左手持盾/);
    assert.equal(pastPlanText(active.readAccepted(paths.outline).content, 3), pastPlanText(oldOutline, 3));
    assert.equal(active.readAccepted(detailPath(2)).content, oldDetail);
    assert.deepEqual(active.db.project().stale, []);
    assert.deepEqual(active.db.project().storyImpacts, []);
    assert.ok(active.db.sql.prepare("SELECT * FROM dependencies WHERE source_path=? AND dependent=? AND kind='plan'").get(paths.outline, detailPath(3)));
    assert.equal((await service.invoke('run.accept', { id: nextId, proposalHash: proposalHash(ready) })).alreadyAccepted, true);
  } finally { await service.drain(); }
});

test('整批审核反馈传递到所有同步文件，前一个文件完成后不丢失', async () => {
  const corrected: string[] = [];
  const { service, store } = await setup(async (...args) => {
    if (!args[1].includes('你独立检查')) {
      const input = JSON.parse(args[2][0].content);
      assert.match(input.correction, /不得重新拟定首章已确认的反馈时间/);
      corrected.push(input.file.path);
    }
    return caller(...args);
  });
  try {
    seedPlans(service);
    const run = service.makeRun('revision', '核对后续计划的反馈时间', profile.id);
    run.continuity = { mode: 'forward', fromChapter: 3 };
    run.memoryRepair = { paths: [paths.volumes, paths.outline], sources: [prosePath(2)], completed: [], cursor: 0 };
    run.memoryReview = { fingerprint: '', issues: ['不得重新拟定首章已确认的反馈时间'] };
    store.db.saveRun(run);
    await service.runner!.drive(run.id);
    assert.deepEqual(corrected, [paths.volumes, paths.outline]);
    const ready = store.db.run(run.id);
    assert.equal(ready.status, 'awaiting_review', JSON.stringify(ready.issues));
    assert.deepEqual(ready.memoryReview?.issues, []);
  } finally { await service.drain(); }
});

test('后续计划同步中断后保留候选和变化依据，重启恢复不会写入未采纳结果', async () => {
  let count = 0;
  const { service, store } = await setup(async (...args) => {
    if (!args[1].includes('你独立检查') && ++count === 2) throw new RequestError('模拟远端结果未知', true);
    return caller(...args);
  });
  try {
    seedPlans(service);
    const run = service.makeRun('revision', '第三章起调整右手状态', profile.id);
    run.continuity = { mode: 'forward', fromChapter: 3 };
    run.status = 'awaiting_review';
    run.changes = [{ path: paths.roles, baseHash: store.db.document(paths.roles)!.hash,
      content: store.readAccepted(paths.roles).content + '\n第三章起右手受伤，改用左手。' }];
    store.db.saveRun(run);
    await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run), warningReason: '离线验收' });
    const before = store.readAccepted(paths.volumes).hash;
    const receipt = await service.invoke('memory.rebuild', { profileId: profile.id });
    while (service.runner!.controller) await new Promise(resolve => setTimeout(resolve, 10));
    const stopped = store.db.run(receipt.runId!);
    assert.equal(stopped.status, 'unknown');
    assert.equal(stopped.memoryRepair!.cursor, 1);
    assert.equal(stopped.continuity?.mode, 'forward');
    const root = store.root;
    service.close(); await service.open(root);
    assert.equal(service.store!.readAccepted(paths.volumes).hash, before);
    assert.deepEqual(service.store!.db.run(stopped.id).memoryRepair, stopped.memoryRepair);
    const resumed = await service.invoke('run.resume', { id: stopped.id, retryUnknown: true });
    const ready = await waitForRun(service, resumed);
    assert.equal(ready.continuity?.mode, 'forward');
    assert.equal(service.store!.readAccepted(paths.volumes).hash, before);
    await service.invoke('run.accept', { id: ready.id, proposalHash: proposalHash(ready), warningReason: '离线验收' });
    assert.deepEqual(service.store!.db.project().storyImpacts, []);
  } finally { await service.drain(); }
});

test('后续调整禁止改动已有正文和过往计划，来源外改及候选变化使旧核对失效', async () => {
  const { service, store } = await setup();
  try {
    seedPlans(service);
    const run = service.makeRun('revision', '从第三章调整', profile.id);
    run.continuity = { mode: 'forward', fromChapter: 3 };
    run.changes = [{ path: prosePath(1), baseHash: hash(body), content: body + '\n不应修改的历史。' }];
    assert.ok(continuityIssues(store, run).some(issue => issue.path === prosePath(1)));
    run.changes = [{ path: paths.outline, baseHash: store.db.document(paths.outline)!.hash,
      content: store.readAccepted(paths.outline).content.replace('| 第1章 |', '| 第100章 |') }];
    const protectedPlan = continuityIssues(store, run).find(issue => issue.message.includes('之前'));
    assert.ok(protectedPlan);
    assert.match(protectedPlan.message, /首处差异.*第1章/);
    run.continuity = { mode: 'extraction', fromChapter: 1 };
    assert.ok(continuityIssues(store, run).some(issue => issue.message.includes('纠正记忆')));
    run.continuity = { mode: 'forward', fromChapter: 3 };
    run.changes = [];
    run.memoryRepair = { paths: [paths.outline], sources: [paths.roles], sourceHashes: { [paths.roles]: store.db.document(paths.roles)!.hash! }, readonlySources: [paths.roles], completed: [], cursor: 0 };
    run.changes = [{ path: paths.roles, baseHash: store.db.document(paths.roles)!.hash, content: store.readAccepted(paths.roles).content + '\n把新状态改回旧状态' }];
    assert.ok(continuityIssues(store, run).some(issue => issue.message.includes('迁就旧计划')));
    run.changes = [];
    fs.appendFileSync(path.join(store.root, paths.roles), '\n外部改动');
    assert.ok(continuityIssues(store, run).some(issue => issue.message.includes('来源已改变')));
  } finally { await service.drain(); }
});

test('后续计划入口创建真实修订任务，生效章号和授权范围随模型切换保留', async () => {
  const { service, store } = await setup(async (_profile, _system, messages) => {
    if (messages.at(-1)?.role === 'tool') return fakeResult('候选完成');
    const run = store.db.runs().find(run => run.status === 'running')!;
    assert.equal(run.mode, 'revision');
    assert.equal(run.continuity?.mode, 'forward');
    assert.match(JSON.stringify(messages), /story_change_scope/);
    return { ...fakeResult(''), stop: 'tools', calls: [{ id: 'future-plan', name: 'propose_changes', arguments: JSON.stringify({ changes: [{
      path: paths.volumes, baseHash: store.db.document(paths.volumes)!.hash,
      content: store.readAccepted(paths.volumes).content + '\n\n第三章起调整为左手持盾。'
    }] }) }] };
  });
  try {
    seedPlans(service);
    await assert.rejects(service.invoke('state.proposeCorrection', { kind: 'plan', request: '调整', fromChapter: 2 }), /已有正文/);
    const id = await service.invoke('state.proposeCorrection', { kind: 'plan', request: '从第三章改用左手持盾', fromChapter: 3 });
    const run = await waitForRun(service, id);
    assert.ok(run.changes.some(change => change.path === paths.volumes));
    assert.ok(!run.issues.some(issue => issue.code === 'analysis_scope'));
    const rebuilt = service.rebuildRun(run, profile.id, '保留当前调整范围');
    assert.deepEqual(rebuilt.continuity, run.continuity);
    assert.notEqual(proposalHash({ ...run, continuity: { mode: 'retcon', fromChapter: 1 } }), proposalHash(run));
  } finally { await service.drain(); }
});
