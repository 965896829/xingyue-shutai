import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture, sampleProse } from './fixtures/workflow';
import { fixtureCoverage, fixtureAuditEvidence } from './fixtures/chapter-coverage';
import { stageOutputs, detailPath, prosePath, qualityPath, hash } from '../src/core/domain';
import { proposalHash } from '../src/core/storage';
import { mutateQuality, readQuality, storeLearnedPreferences, voiceDocument, voicePath } from '../src/core/quality';
import { compileContext, contextPayload } from '../src/core/context-compiler';
import { memoryScopeSchema } from '../src/shared/studio';
import { visibleFact } from '../src/core/memory-studio';
import { factSchema } from '../src/shared/types';

const root = path.resolve('resources/skill');
const model = { ...fakeProfile, contextLimit: 1000000, outputLimit: 32768 };
const pause = () => new Promise(resolve => setTimeout(resolve, 10));

for (const mode of ['chapter', 'scene'] as const) test(`正常生成按钮的 S09 到 S10 实际发送人物体验与限定范围：${mode}`, async () => {
  let service: Service;
  const requests: { system: string; messages: unknown; tools: unknown }[] = [];
  service = new Service(root, () => {}, async (_profile, system, messages, tools) => {
    requests.push({ system, messages, tools });
    const store = service.store!, p = store.db.project(), run = store.db.runs().find(r => r.status === 'running')!;
    const input = JSON.parse(messages[0].content);
    if (input.items) {
      const memory = { decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '合成资料与最终正文相符。', evidence: fixtureAuditEvidence(item, input.sources) })) };
      const plans = { decisions: (input.plans ?? []).map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '当前正文没有改变后续求医计划。', planQuote: input.sources.find((s: any) => s.path === plan.path).content.slice(0, 30), proseQuote: input.sources.find((s: any) => s.path === input.prose.path).content.slice(0, 30) })) };
      return fakeResult(JSON.stringify(input.plans ? { memory, plans } : memory));
    }
    if (!tools.length) {
      assert.match(system, /让当前关切影响人物注意什么/);
      assert.match(system, /流式/);
      if (mode === 'scene') {
        assert.ok(input.scope.position.scene);
        assert.equal(input.scope.viewpoint, 'character');
        assert.equal(messages.length, 1);
        assert.equal(input.authorPremise, undefined);
        if (input.scope.position.scene < 99) assert.doesNotMatch(JSON.stringify(input), /赊账资格|分期付款/);
        else assert.match(JSON.stringify(input), /让医生同意分期付款/);
        const body = Array.from(sampleProse(p.config.chapterWords).replace(/^#[^\r\n]*\r?\n/, '').trim());
        const index = [1, 2, 3, 4, 5, 99].indexOf(input.scope.position.scene);
        return fakeResult(body.slice(Math.floor(index * body.length / 6), Math.floor((index + 1) * body.length / 6)).join(''));
      }
      assert.ok(input.writingMaterials);
      assert.ok(input.writingMaterials.focalExperience.scenes.some((s: any) => s.concern === '保住诊所的赊账资格'));
      assert.ok(input.writingMaterials.dialogueIntent.some((s: any) => s.intent === '让医生同意分期付款'));
      return fakeResult(fixture(p, prosePath(1), service));
    }
    const files = run.stage === 'S09' ? stageOutputs('S09', p) : run.pipeline!.phase === 'review' ? [qualityPath(1)] : stageOutputs('S11', p);
    if (run.stage === 'S09') assert.match(system, /只为需要详写的时刻补少量体验材料/);
    if (run.pipeline?.phase === 'memory') {
      assert.equal(input.writingMaterials, undefined, '提取只依据最终正文，不携带首稿体验计划');
      assert.equal(input.voicePreferences, undefined, '提取不携带表达样例');
      assert.ok(input.sources.every((source: any) => !/^(05_|06_)/.test(source.path)), '场景计划不进入已发生事件提取');
      assert.ok(input.sources.some((source: any) => source.path.startsWith('04_')), '实际更新的核心台账仍完整提供');
      assert.match(system, /最终正文|指定正文版本/);
    }
    const changes = files.map(file => service.change(file, fixture(p, file, service) + (file === detailPath(1) ? '\n## 场面99：谈赊账\n- 场景功能：对话\n- 焦点人物：阿宁\n- 当前关切：保住诊所的赊账资格\n- 个人意义：明天仍能继续治疗\n- 主观判断：医生可能认为自己失信\n- 交流对象：医生\n- 当前关系：医患\n- 对话意图：让医生同意分期付款\n- 叙述处理：写足提出要求后的交锋，压缩路途\n' : '')));
    return { ...fakeResult(''), stop: 'tools' as const, calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes, ...(run.pipeline?.phase === 'memory' ? { facts: [], complete: true, coverage: fixtureCoverage(service, run) } : {}) }) }] };
  });
  service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('default-materials'), title: '日常求医', premise: '阿宁求医', config: { defaultProfileId: model.id, maxRounds: 12, preview: { enabled: false }, proseMode: mode, viewpointCharacterId: mode === 'scene' ? '阿宁' : '' } });
    const store = service.store!;
    for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08'] as const) {
      const p = store.db.project(); store.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    }
    const project = store.db.project(); project.stage = 'S09'; store.db.set('project', project);
    const planned = await service.invoke('run.start', { request: '生成本章任务与细纲' });
    while (service.runner!.controller) await pause();
    const plan = store.db.run(planned); assert.equal(plan.status, 'awaiting_review', JSON.stringify(plan.issues));
    await service.invoke('run.accept', { id: planned, proposalHash: proposalHash(plan), startNext: false });
    assert.equal(store.db.project().stage, 'S10');
    const writing = await service.invoke('run.start', { request: '生成正文' });
    while (service.runner!.controller) await pause();
    const ready = store.db.run(writing); assert.equal(ready.status, 'awaiting_review', `${ready.error}: ${JSON.stringify(ready.issues)}`);
    assert.equal(ready.pipeline?.phase, 'ready');
    assert.equal(requests.length, mode === 'chapter' ? 5 : 10, '整章一次首稿；可选逐场模式每场一次，后续审核和记忆仍共用');
    const directory = path.resolve('.test-output/creation-upgrade-20261030/requests'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `default-s09-s10-${mode}.json`), JSON.stringify(requests, null, 2));
  } finally { await service.drain(); }
});

test('人物视角保持适用表达指导，关系例外与撤回生效，不带入编辑样例事实', async () => {
  const service = new Service(root, () => {}); service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('voice-scope'), title: '声音范围', premise: '求医', config: { defaultProfileId: model.id } });
    const store = service.store!, file = prosePath(1), before = '未来密令是天井。', after = '未来密令是风塔。';
    store.commit([service.change(file, before)], store.db.project()); store.commit([service.change(file, after)], store.db.project());
    const span = (text: string) => ({ path: file, hash: hash(text), start: 0, end: Array.from(text).length, quote: text });
    const scope = { kind: 'character' as const, target: 'AN', sceneFunction: '对话', addresseeIds: ['医生'], exceptAddresseeIds: ['母亲'] };
    let state = mutateQuality(store, readQuality(store).revision, { kind: 'evidence', evidence: { before: span(before), after: span(after), scope, domain: 'expression', reason: '保留冷静而直接的声口', editor: 'author' } });
    storeLearnedPreferences(store, 'learning', [{ statement: '对医生直接说要求，保留长句', scope, evidenceIds: [state.evidence.at(-1)!.id], alternatives: [], exceptions: ['面对母亲时更温和'] }]);
    state = readQuality(store); store.commit([service.change(voicePath, voiceDocument(store, [state.preferences.at(-1)!.id])), service.change(detailPath(1), '# 细纲\n\n## 场面1：求医\n- 场景功能：对话\n- 交流对象：医生\n')], store.db.project());
    const current = store.db.project(); current.config.viewpointCharacterId = 'AN'; store.db.set('project', current);
    const packet = () => contextPayload(compileContext(store, store.db.project(), 'S10', '阿宁求医', model, { purpose: 'revision', allowConflicts: true }));
    assert.match(JSON.stringify(packet()), /对医生直接说要求/);
    assert.doesNotMatch(JSON.stringify(packet()), /天井|风塔/);
    const authorPacket = contextPayload(compileContext(store, store.db.project(), 'S10', '阿宁求医', model, { purpose: 'revision', allowConflicts: true,
      scope: memoryScopeSchema.parse({ chapter: 1, viewpoint: 'author', characterId: 'AN' }) }));
    assert.ok(authorPacket.voicePreferences?.some(p => p.samples?.some(sample => sample.kind === 'expression_sample' && sample.text.includes('风塔'))));
    assert.doesNotMatch(JSON.stringify(authorPacket.facts), /风塔/, '样例独立标识，不进入故事事实');
    store.commit([service.change(detailPath(1), '# 细纲\n\n## 场面1：求医\n- 场景功能：对话\n- 交流对象：母亲\n')], store.db.project());
    assert.doesNotMatch(JSON.stringify(packet()), /对医生直接说要求/);
    store.commit([service.change(detailPath(1), '# 细纲\n\n## 场面1：求医\n- 场景功能：对话\n- 交流对象：医生\n')], store.db.project());
    state = readQuality(store); mutateQuality(store, state.revision, { kind: 'retract', id: state.evidence.at(-1)!.id });
    assert.doesNotMatch(JSON.stringify(packet()), /对医生直接说要求/);
  } finally { service.close(); }
});

test('获知时间使用场景事件顺序，旧章节级记录不伪造同章获知时刻', () => {
  const fact = factSchema.parse({ id: 'secret', subject: '阿宁', predicate: '知道', value: '药箱在后院', kind: 'belief', category: 'knowledge', fromChapter: 1, revealedAt: 1, reviewStatus: 'accepted', knowledge: [{ who: 'AN', mode: 'told', fromChapter: 1, fromPosition: { chapter: 1, scene: 3 } }], evidence: [{ path: prosePath(1), hash: hash('原文'), quote: '原文' }] });
  // The fact existed before this chapter; the message arrives in scene three.
  fact.fromChapter = 0;
  for (const scene of [1, 3, 4]) assert.equal(visibleFact(fact, memoryScopeSchema.parse({ chapter: 1, position: { chapter: 1, scene }, viewpoint: 'character', characterId: 'AN' })), scene >= 3);
  const legacy = structuredClone(fact); delete legacy.knowledge[0].fromPosition;
  assert.equal(visibleFact(legacy, memoryScopeSchema.parse({ chapter: 1, position: { chapter: 1, scene: 4 }, viewpoint: 'character', characterId: 'AN' })), false);
  assert.equal(visibleFact(legacy, memoryScopeSchema.parse({ chapter: 2, viewpoint: 'character', characterId: 'AN' })), true);
});
