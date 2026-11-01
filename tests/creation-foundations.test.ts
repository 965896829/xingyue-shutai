import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { bindDesign } from '../src/core/design-operations';
import { projectForRun, targetBatch } from '../src/core/task-scope';
import { hash, paths, prosePath, taskPath, detailPath, stageOutputs, updateConfigDocument } from '../src/core/domain';
import { proposalHash } from '../src/core/storage';
import { factSchema } from '../src/shared/types';
import { encodeFacts } from '../src/core/memory-records';
import { characterState, retrieveMemory, visibleFact } from '../src/core/memory-studio';
import { memoryScopeSchema } from '../src/shared/studio';
import { workbenchFactsAt } from '../src/core/workbench';
import { memoryReviewInput, memoryReviewMatches } from '../src/core/memory-review';
import { compileContext, contextPayload } from '../src/core/context-compiler';
import { validatedResponse } from '../src/core/runtime/validated-response';
import { ApplicationError } from '../src/shared/errors';
import { FileStore } from '../src/core/storage';
import { callModel, attempts, authorizeUnknownAttempts, unresolvedAttempts } from '../src/core/runtime/model-gateway';
import { RequestError } from '../src/core/provider';
import { requestGuard } from '../src/core/telemetry';
import { controllerRules } from '../src/core/agent-control';
import { fixtureAuditEvidence } from './fixtures/chapter-coverage';

const root = path.resolve('resources/skill');
const model = { ...fakeProfile, contextLimit: 1000000, outputLimit: 16000 };
const evidenceRoot = path.resolve('.test-output/creation-upgrade-20261030/requests');
fs.mkdirSync(evidenceRoot, { recursive: true });

for (const protocol of ['chat', 'responses'] as const) for (const [current, chapter] of [[1, 1], [1, 2], [8, 2], [1, 31]]) test(`实际模型请求、输出与资料统一：${protocol} 当前 ${current} / 目标 ${chapter}`, async () => {
  let capture: unknown;
  const service = new Service(root, () => {}, async (_p, system, messages, tools) => {
    capture = { system, messages, tools };
    return fakeResult('已收到本章范围。');
  });
  service.profiles = [{ ...model, protocol }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('target-chapter'), title: '章节范围', premise: '阿宁求医', config: { defaultProfileId: model.id, maxRounds: 1 } });
    const store = service.store!;
    let p = store.db.project(); p.chapter = current; p.stage = 'S10'; store.db.set('project', p);
    const run = service.makeRun('revision', '生成指定章节');
    bindDesign(store, root, run, { id: 'chapter-draft.draft', chapter, request: '生成指定章节' });
    const scoped = projectForRun(p, run);
    for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'] as const)
      store.commit(stageOutputs(stage, scoped).map(file => service.change(file, fixture(scoped, file, service) + (file === taskPath(chapter) || file === detailPath(chapter) ? `\n目标标记：唯一第${chapter}章\n` : ''))), store.db.project());
    if (chapter > 1) store.commit([service.change(prosePath(chapter - 1), fixture(scoped, prosePath(chapter), service))], store.db.project());
    run.baseSnapshotId = store.db.headRef()!.id; run.baseRevision = store.db.project().revision;
    // Rebind after fixture installation exactly as a new author action would do.
    bindDesign(store, root, run, { id: 'chapter-draft.draft', chapter, request: '生成指定章节' });
    store.db.saveRun(run); await service.runner!.drive(run.id);
    assert.ok(capture, store.db.run(run.id).error ?? '未发送请求');
    const wire = JSON.stringify(capture);
    assert.match(wire, new RegExp(`唯一第${chapter}章`));
    assert.ok(wire.includes(taskPath(chapter)) && wire.includes(detailPath(chapter)) && wire.includes(prosePath(chapter)));
    const request = (capture as any).messages.map((m: any) => m.content).join('\n');
    assert.match(request, new RegExp(`"chapter"\\s*:\\s*${chapter}(?:,|\\s*})`));
    assert.deepEqual(store.db.run(run.id).batch, targetBatch(store.db.project(), chapter));
    assert.equal(store.db.project().chapter, current);
    const dispatched = attempts(store, run.id).map(attempt => JSON.parse(store.object(attempt.requestRef!).toString('utf8')).request);
    assert.equal(dispatched.length, 1);
    assert.match(JSON.stringify(dispatched), new RegExp(`唯一第${chapter}章`));
    assert.ok(JSON.stringify(dispatched).includes(taskPath(chapter)) && JSON.stringify(dispatched).includes(detailPath(chapter)));
    fs.writeFileSync(path.join(evidenceRoot, `${protocol}-current-${current}-target-${chapter}.json`), JSON.stringify({ caller: capture, dispatched }, null, 2));
  } finally { await service.drain(); }
});

test('目标资料缺失不借用活动章，模型零调用', async () => {
  let calls = 0;
  const service = new Service(root, () => {}, async () => { calls++; return fakeResult(''); }); service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('missing-target'), title: '缺口', premise: '求医', config: { defaultProfileId: model.id } });
    const run = service.makeRun('revision', '写第二章');
    bindDesign(service.store!, root, run, { id: 'chapter-draft.draft', chapter: 2 });
    service.store!.db.saveRun(run); await service.runner!.drive(run.id);
    assert.equal(calls, 0); assert.match(service.store!.db.run(run.id).error ?? '', /缺少.*第002章/);
  } finally { await service.drain(); }
});

test('任意阶段采纳创作配置即生效，重启、预算变更保留风格且模型权限不可写', async () => {
  let wire = '';
  const service = new Service(root, () => {}, async (_p, system, messages) => { wire = system + JSON.stringify(messages); return fakeResult('已读取新配置。'); }); service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('adopt-config'), title: '配置', premise: '求医', config: { defaultProfileId: model.id } });
    const store = service.store!, p = store.db.project();
    const proposed = { ...p, config: { ...p.config, pov: '第一人称', style: '冷距离叙述，保留长句', constraints: '世界没有神灵', genre: '都市日常', maxRounds: 99, allowSearch: true } };
    const content = updateConfigDocument(fixture(p, paths.config, service), proposed) + '\n作者备注：这段不可结构化的约定保留。\n';
    const run = service.makeRun('manual', '采用新创作配置'); run.changes = [service.change(paths.config, content)]; run.status = 'awaiting_review'; store.db.saveRun(run);
    const stale = service.makeRun('manual', '旧配置候选'); stale.changes = [service.change(paths.config, content)]; stale.status = 'awaiting_review'; store.db.saveRun(stale);
    try { await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run) }); }
    catch (e) { throw new Error(`${(e as Error).message}: ${JSON.stringify(store.db.run(run.id).issues)}`); }
    assert.equal(store.db.project().config.pov, proposed.config.pov); assert.equal(store.db.project().config.style, proposed.config.style);
    assert.equal(store.db.project().config.maxRounds, p.config.maxRounds);
    assert.match(store.readAccepted(paths.config).content, /不可结构化的约定保留/);
    const directory = store.root; service.close(); await service.invoke('project.open', { root: directory });
    const reopened = service.store!;
    await service.invoke('project.configure', { config: { ...reopened.db.project().config, maxRounds: 20 } });
    assert.equal(reopened.db.project().config.style, proposed.config.style);
    const context = compileContext(reopened, reopened.db.project(), 'S01', '继续', model, { purpose: 'discussion', allowConflicts: true });
    assert.match(JSON.stringify(contextPayload(context)), /第一人称/); assert.match(JSON.stringify(contextPayload(context)), /世界没有神灵/);
    await service.invoke('chat.send', { conversationId: service.snapshot().conversations![0].id, profileId: model.id, text: '按当前文风说明下一步' });
    while (service.chat?.controller) await new Promise(resolve => setTimeout(resolve, 10));
    assert.match(wire, /第一人称/); assert.match(wire, /冷距离叙述/); assert.match(wire, /世界没有神灵/);
    fs.writeFileSync(path.join(evidenceRoot, 'configuration-after-restart.txt'), wire);
    assert.equal((await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run) })).alreadyAccepted, true);
    await assert.rejects(service.invoke('run.accept', { id: stale.id, proposalHash: proposalHash(stale) }), /已|候选/);
  } finally { service.close(); }
});

test('人物实际请求和工具结果隔离旧聊天与同段证据中的未知秘密', async () => {
  const captures: string[] = [];
  let character = false, requested = false;
  const secret = '未来密令藏在赤铜塔';
  const service = new Service(root, () => {}, async (_p, system, messages, tools) => {
    if (!character) return fakeResult(secret);
    captures.push(system + JSON.stringify({ messages, tools }));
    if (!requested) {
      requested = true;
      return { ...fakeResult(''), stop: 'tools' as const, calls: [
        { id: 'read-visible', name: 'read_book', arguments: JSON.stringify({ path: prosePath(1), reason: '核对阿宁所知' }) },
        { id: 'search-visible', name: 'search_memory', arguments: JSON.stringify({ query: '阿宁' }) }
      ] };
    }
    return fakeResult('阿宁想借钱，但尚不知道未来的安排。');
  }); service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('character-wire'), title: '范围测试', premise: secret, config: { defaultProfileId: model.id } });
    const store = service.store!, conversationId = service.snapshot().conversations![0].id;
    const text = `阿宁想借钱。${secret}。`;
    const known = factSchema.parse({ id: 'known', subject: '阿宁', predicate: '目标', value: '借钱', category: 'character', kind: 'state', entityIds: ['AN'], fromChapter: 1, revealedAt: 1, reviewStatus: 'accepted', knowledge: [{ who: 'AN', mode: 'seen', fromChapter: 1 }], evidence: [{ path: prosePath(1), hash: hash(text), quote: text }] });
    const disputed = factSchema.parse({ ...known, id: 'dispute', value: '已还款', state: 'disputed' });
    store.commit([service.change(prosePath(1), text), service.change(paths.roles, encodeFacts('# 人物', [known, disputed]))], store.db.project());
    await service.invoke('chat.send', { conversationId, profileId: model.id, text: '作者讨论' });
    while (service.chat?.controller) await new Promise(resolve => setTimeout(resolve, 10));
    await service.invoke('project.configure', { config: { ...store.db.project().config, viewpointCharacterId: 'AN' } });
    character = true;
    await service.invoke('chat.send', { conversationId, profileId: model.id, text: '阿宁目前想做什么，读取证据再回答' });
    while (service.chat?.controller) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(captures.length, 2);
    for (const wire of captures) { assert.match(wire, /借钱/); assert.doesNotMatch(wire, new RegExp(secret)); assert.doesNotMatch(wire, /"name":"search_history"/); }
    assert.match(captures[1], /visible-fact-projection|目标：借钱/);
    const result = retrieveMemory(store, '阿宁', memoryScopeSchema.parse({ chapter: 1, viewpoint: 'character', characterId: 'AN' }));
    assert.deepEqual(result.facts.map(f => f.fact.id), ['known']); assert.deepEqual(result.disputes.map(f => f.id), ['dispute']);
    fs.writeFileSync(path.join(evidenceRoot, 'character-history-tools.json'), JSON.stringify(captures, null, 2));
  } finally { await service.drain(); }
});

test('真实请求账本恢复保留无效回执与预算，未知网络结果不重发', async () => {
  const fixture = refactorFixture(); let store = fixture.store, calls = 0;
  const run = fixture.run; run.usage.cost = 0;
  const execute = (phase: string, failUnknown = false) => validatedResponse({ store, run, phase, instruction: '返回合法 JSON', input: { protectedProse: '原文保持' }, signal: new AbortController().signal, assertCurrent: () => {},
    send: async (purpose, instruction, input) => {
      const messages = [{ role: 'user' as const, content: JSON.stringify(input) }];
      requestGuard(model, instruction, messages, [], run, 1, 0);
      const response = await callModel(store, run, purpose, async () => { calls++; if (failUnknown) throw new RequestError('结果未知', true); return fakeResult('{"bad":true}'); }, model, instruction, messages, [], new AbortController().signal);
      return response.text;
    }, validate: value => { if (!(value as any).valid) throw new Error('缺少 valid'); return value; } });
  try {
    await assert.rejects(execute('invalid'), /两次修复上限/); assert.equal(calls, 3);
    assert.equal(attempts(store, run.id).filter(row => row.status === 'complete').length, 3);
    store.close(); store = new FileStore(fixture.root);
    await assert.rejects(execute('invalid'), /两次修复上限/); assert.equal(calls, 3);
    run.usage.cost = 2;
    await assert.rejects(execute('budget'), /费用|预算|上限/); assert.equal(calls, 3);
    run.usage.cost = 0;
    await assert.rejects(execute('unknown', true), /未知/); assert.equal(calls, 4);
    await assert.rejects(execute('unknown', true), /未知/); assert.equal(calls, 4);
  } finally { store.close(); }
});

test('历史断臂、当前痊愈在人物卡、检索、面板一致，撤回与误解不复活', () => {
  const { store } = refactorFixture();
  try {
    const one = '阿宁断臂。', three = '阿宁已经痊愈。';
    const injury = factSchema.parse({ id: 'injury', subject: '阿宁', predicate: '身体', value: '断臂', category: 'injury', kind: 'event', entityIds: ['AN'], fromChapter: 1, toChapter: 2, revealedAt: 1, state: 'superseded', reviewStatus: 'accepted', knowledge: [{ who: 'AN', mode: 'seen', fromChapter: 1 }], evidence: [{ path: prosePath(1), hash: hash(one), quote: one }] });
    const healed = factSchema.parse({ ...injury, id: 'healed', value: '痊愈', fromChapter: 3, toChapter: null, revealedAt: 3, state: 'active', supersedes: 'injury', evidence: [{ path: prosePath(3), hash: hash(three), quote: three }] });
    const wrong = factSchema.parse({ ...injury, id: 'withdrawn', value: '假记录', reviewStatus: 'retracted' });
    store.commit([{ path: prosePath(1), content: one, baseHash: null }, { path: prosePath(3), content: three, baseHash: null }, { path: paths.roles, content: encodeFacts('# 人物', [injury, healed, wrong]), baseHash: null }], store.db.project());
    for (const chapter of [2, 3]) {
      const scope = memoryScopeSchema.parse({ chapter, viewpoint: 'character', characterId: 'AN' });
      const expected = chapter === 2 ? 'injury' : 'healed';
      assert.deepEqual(characterState(store, 'AN', scope).facts.map(f => f.id), [expected]);
      assert.deepEqual(retrieveMemory(store, '阿宁', scope).facts.map(f => f.fact.id), [expected]);
      assert.deepEqual(workbenchFactsAt(store.db.facts(), scope).map(f => f.id), [expected]);
    }
    assert.equal(visibleFact({ ...injury, knowledge: [{ who: 'AN', mode: 'misunderstood', fromChapter: 1 }] }, memoryScopeSchema.parse({ chapter: 2, viewpoint: 'character', characterId: 'AN' })), false);
  } finally { store.close(); }
});

test('阅读面板可回看到第1200章，人物三层独立，远期查询不构造空章节', async () => {
  const service = new Service(root, () => {}, async () => { throw new Error('打开面板不能调用模型'); });
  try {
    await service.invoke('project.create', { parent: isolatedRoot('long-reading'), title: '长篇回看', premise: '阿宁求医' });
    const store = service.store!;
    const rows = [
      { chapter: 1, layer: 'stable', kind: 'state', quote: '阿宁愿意承担责任。' },
      { chapter: 2, layer: 'experience', kind: 'event', quote: '阿宁兑现了还款承诺。' },
      { chapter: 1200, layer: 'current', kind: 'state', quote: '阿宁接管了修理站。' }
    ];
    const facts = rows.map(({ chapter, layer, kind, quote }) => factSchema.parse({ id: `layer-${layer}`, subject: '阿宁', predicate: layer, value: quote,
      category: 'character', kind, characterLayer: layer, entityIds: ['AN'], fromChapter: chapter, revealedAt: chapter, reviewStatus: 'accepted',
      evidence: [{ path: prosePath(chapter), hash: hash(quote), quote }] }));
    store.commit([...rows.map(row => service.change(prosePath(row.chapter), row.quote)), service.change(paths.roles, encodeFacts('# 阿宁', facts))], store.db.project());
    const before = await service.invoke('experience.read', { throughChapter: 1199 });
    assert.equal(before.characters[0].current.length, 0);
    const view = await service.invoke('experience.read', { throughChapter: 1200 });
    assert.deepEqual(view.characters[0].stable.map(x => x.id), ['layer-stable']);
    assert.deepEqual(view.characters[0].current.map(x => x.id), ['layer-current']);
    assert.deepEqual(view.characters[0].experiences.map(x => x.id), ['layer-experience']);
    const distant = await service.invoke('experience.read', { throughChapter: 100000 });
    assert.deepEqual(distant.chapters.map(x => x.chapter), [2]);
  } finally { service.close(); }
});

test('人物卡前后对照进入记忆审核，改动后原通过记录失效', () => {
  const { store, run } = refactorFixture();
  try {
    store.commit([{ path: paths.roles, content: '# 阿宁\n身体：断臂', baseHash: null }], store.db.project());
    run.pipeline = { phase: 'memory', proseHash: hash('阿宁痊愈了。'), epoch: run.id, version: 1, previewCalls: 0 };
    run.changes = [{ path: prosePath(1), content: '阿宁痊愈了。', baseHash: null }, { path: paths.roles, content: '# 阿宁\n身体：断臂\n衣着：蓝衣', baseHash: store.db.document(paths.roles)!.hash }];
    const input = memoryReviewInput(store, run);
    assert.ok(input.items.some(i => i.path === paths.roles));
    assert.match(input.sources.find(s => s.path === prosePath(1))!.content, /痊愈/);
    assert.match(input.sources.find(s => s.path === paths.roles)!.previous!.content, /断臂/);
    run.memoryReview = { fingerprint: input.fingerprint, issues: [] };
    assert.equal(memoryReviewMatches(store, run), true);
    run.changes[1].content = '# 阿宁\n身体：痊愈'; assert.equal(memoryReviewMatches(store, run), false);
  } finally { store.close(); }
});

test('实际独立记忆审核发现正文痊愈与人物卡断臂矛盾，修改卡片重新审核', async () => {
  const wires: any[] = [];
  const service = new Service(root, () => {}, async (_profile, _system, messages) => {
    const input = JSON.parse(messages[0].content); wires.push(input);
    const card = input.sources.find((s: any) => s.path === paths.roles);
    assert.match(input.sources.find((s: any) => s.path === prosePath(1)).content, /痊愈/);
    assert.match(card.previous.content, /断臂/);
    const memory = { decisions: input.items.map((item: any) => ({ id: item.id,
      verdict: item.path === paths.roles && card.content.includes('身体：断臂') ? 'contradicted' : 'supported',
      reason: card.content.includes('身体：断臂') ? '最终正文已痊愈，当前人物卡仍记录断臂。' : '人物卡与正文一致。',
      evidence: fixtureAuditEvidence(item, input.sources) })) };
    const plans = { decisions: (input.plans ?? []).map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '后续计划与痊愈状态一致。',
      planQuote: input.sources.find((s: any) => s.path === plan.path).content.slice(0, 30), proseQuote: input.sources.find((s: any) => s.path === input.prose.path).content.slice(0, 30) })) };
    return fakeResult(JSON.stringify(input.plans ? { memory, plans } : memory));
  }); service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('card-review'), title: '卡片审核', premise: '阿宁求医', config: { defaultProfileId: model.id } });
    const store = service.store!; store.commit([service.change(paths.roles, '# 阿宁\n身体：断臂')], store.db.project());
    const p = store.db.project(); p.stage = 'S11'; store.db.set('project', p);
    const run = service.makeRun('stage', '核对人物卡'); run.agentRulesHash = controllerRules(root).hash;
    run.changes = [service.change(prosePath(1), '阿宁经过治疗已经痊愈。'), service.change(paths.roles, '# 阿宁\n身体：断臂\n衣着：蓝衣')];
    const audit = () => (service.runner as any).auditMemory(run, store.db.project(), model, new AbortController().signal);
    await audit(); assert.equal(wires.length, 1); assert.match(run.memoryReview!.issues.join(), /仍记录断臂/);
    run.changes[1].content = '# 阿宁\n身体：痊愈\n衣着：蓝衣';
    assert.equal(memoryReviewMatches(store, run), false);
    await audit(); assert.equal(wires.length, 2); assert.deepEqual(run.memoryReview!.issues, []);
    fs.writeFileSync(path.join(evidenceRoot, 'actual-card-memory-review.json'), JSON.stringify(wires, null, 2));
  } finally { await service.drain(); }
});

test('实际记忆审核交接不重置修复上限，回执保存前崩溃复用请求账本，未知请求不重发', async () => {
  let calls = 0, unknown = false;
  const service = new Service(root, () => {}, async () => {
    calls++;
    if (unknown) throw new RequestError('审核结果未知', true);
    return fakeResult('{"decisions":[]}');
  }); service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('review-handoff'), title: '审核恢复', premise: '阿宁求医', config: { defaultProfileId: model.id, maxRounds: 12 } });
    const store = service.store!;
    store.commit([service.change(paths.roles, '# 阿宁\n身体：断臂')], store.db.project());
    const p = store.db.project(); p.stage = 'S11'; store.db.set('project', p);
    let run = service.makeRun('stage', '核对人物卡'); run.agentRulesHash = controllerRules(root).hash;
    run.changes = [service.change(prosePath(1), '阿宁经过治疗已经痊愈。'), service.change(paths.roles, '# 阿宁\n身体：痊愈')];
    const audit = () => service.runner!.auditMemory(run, store.db.project(), model, new AbortController().signal);
    await assert.rejects(audit(), /修复上限/); assert.equal(calls, 3);
    run.status = 'paused'; store.db.saveRun(run);
    run = service.rebuildRun(run, model.id);
    run.agentRulesHash = controllerRules(root).hash;
    await assert.rejects(audit(), /修复上限/); assert.equal(calls, 3, '换任务记录、恢复提示不重置审核修复额度');
    store.db.sql.prepare("DELETE FROM kv WHERE key LIKE 'review-receipts:v1:%'").run();
    await assert.rejects(audit(), /修复上限/); assert.equal(calls, 3, '未持久化业务回执时仍复用已完成请求');
    unknown = true;
    run = service.makeRun('stage', '新一轮核对'); run.agentRulesHash = controllerRules(root).hash;
    run.changes = [service.change(prosePath(1), '阿宁经过治疗已经痊愈。'), service.change(paths.roles, '# 阿宁\n身体：痊愈')];
    await assert.rejects(audit(), /未知/); assert.equal(calls, 4);
    await assert.rejects(audit(), /未知/); assert.equal(calls, 4);
    const prior = attempts(store, run.id).find(row => row.status === 'unknown')!;
    authorizeUnknownAttempts(store, run);
    assert.equal(unresolvedAttempts(store, run).length, 0);
    assert.deepEqual(attempts(store, run.id).find(row => row.id === prior.id), prior, '授权不删除未知记录、不重置费用');
    await assert.rejects(audit(), /未知/); assert.equal(calls, 5);
    assert.equal(unresolvedAttempts(store, run).length, 1, '新未知响应必须重新核对，旧授权不覆盖未来请求');
  } finally { await service.drain(); }
});

test('已知无效结果最多修复两次，重启和重复继续不重置上限，取消及原文改变不接纳迟到结果', async () => {
  const { store, run } = refactorFixture(); let calls = 0;
  const signal = new AbortController();
  const request = () => validatedResponse({ store, run, phase: 'test-extract', instruction: '合同', input: { prose: '冻结正文' }, signal: signal.signal,
    send: async () => { calls++; return '{"invalid":true}'; }, validate: value => { if (!(value as any).valid) throw new Error('缺少 valid'); return value; }, assertCurrent: () => {} });
  try {
    await assert.rejects(request(), /两次修复上限/); assert.equal(calls, 3);
    await assert.rejects(request(), /两次修复上限/); assert.equal(calls, 3);
    const oldId = run.id; run.parentRunId = oldId; run.id = 'recovered-child';
    await assert.rejects(request(), /两次修复上限/); assert.equal(calls, 3, '交接到原预算根任务也不能刷新修复次数');
    const cancelled = new AbortController();
    await assert.rejects(validatedResponse({ store, run, phase: 'cancel', instruction: '', input: {}, signal: cancelled.signal,
      send: async () => { cancelled.abort(); return '{"valid":true}'; }, validate: v => v, assertCurrent: () => {} }), /迟到结果/);
    let changed = false;
    await assert.rejects(validatedResponse({ store, run, phase: 'change', instruction: '', input: {}, signal: signal.signal,
      send: async () => { changed = true; return '{}'; }, validate: v => v, assertCurrent: () => { if (changed) throw new ApplicationError('VERSION_CONFLICT', '原文变化'); } }), /原文变化/);
  } finally { store.close(); }
});
