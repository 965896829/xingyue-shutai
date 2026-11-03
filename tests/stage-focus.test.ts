import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { stageIds, type ContextManifest, type ContextSource } from '../src/shared/types';
import { hash, paths, prosePath, renderConfig, renderProgress, stageOutputs } from '../src/core/domain';
import { creationPolicies, creationPolicy } from '../src/core/creation-policy';
import { SkillRegistry, stageSkills } from '../src/core/skill-registry';
import { stageSources } from '../src/core/stage-context';
import { contextPayload, contextChanged } from '../src/core/context-compiler';
import { contractPath, renderContract, tagContext } from '../src/core/tags';
import { proseTask, authorProseIntent } from '../src/core/prose-task';
import { prepareAuthorRevision } from '../src/core/runtime/run-recovery';
import { requestBody } from '../src/core/provider';
import { callModel, attempts } from '../src/core/runtime/model-gateway';
import { prepareCacheSession } from '../src/core/runtime/cache-session';
import { focusInstruction } from '../src/core/prompt-profile';
import { sceneMaterials } from '../src/core/scene-material';
import { designCatalog, designResource } from '../src/core/design-operations';

const root = path.resolve('resources/skill');
const model = { ...fakeProfile, protocol: 'responses' as const, contextLimit: 1000000, outputLimit: 16000 };
const output = path.resolve('.test-output/stage-focus/requests');
fs.mkdirSync(output, { recursive: true });

for (const stage of stageIds) test(`阶段真实入口与网关请求专注当前专业任务：${stage}`, async () => {
  let observed: { system: string; input: any } | undefined;
  const service = new Service(root, () => {}, async (_profile, system, messages) => {
    observed = { system, input: JSON.parse(messages[0].content) };
    return fakeResult('离线请求截获；不生成正式内容。');
  });
  service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('stage-focus'), title: '范围夹具', premise: '作者原始要求：二十年后的同城。',
      config: { defaultProfileId: model.id, maxRounds: 1, constraints: '必须保留：只能携带随身小物；伤势不会因穿越消失。', preview: { enabled: false } } });
    const store = service.store!;
    for (const prior of stageIds.filter(s => s < stage)) {
      const p = store.db.project();
      store.commit(stageOutputs(prior, p).map(file => {
        let content = fixture(p, file, service);
        if (stage === 'S10' && prior === 'S09' && /第\d+章细纲\.md$/.test(file))
          content = content.replace(/(^## 场面\s*1[：:][^\r\n]*\r?\n)/m,
            '$1- 当前关切：保住这笔送货订单\n- 个人意义：兑现对伙伴的承诺\n- 对话意图：请伙伴留下帮忙\n- 可用经验：\n');
        return service.change(file, content);
      }), p);
    }
    const p = store.db.project(); p.stage = stage; store.db.set('project', p);
    const before = store.db.headRef()!.id;
    const run = service.makeRun('stage', '只处理当前阶段，保留作者的全部必要条件。');
    store.db.saveRun(run); await service.runner!.drive(run.id);
    assert.ok(observed, store.db.run(run.id).error ?? '当前阶段没有发起请求');
    const controller = new SkillRegistry(root).controller().content;
    assert.equal(observed.system.split(controller).length - 1, 1, '完整总控在阶段请求中只装入一次');
    assert.ok(observed.system.includes(creationPolicy(root, creationPolicies[stageSkills[stage]]).content));
    assert.match(observed.system, /wenxu-stage-focus/);
    assert.match(observed.system, /只能携带随身小物；伤势不会因穿越消失/);
    assert.doesNotMatch(observed.system, /"defaultProfileId"|"modelRouting"|"backupDirectory"/);
    if (!['S03', 'S04'].includes(stage)) assert.doesNotMatch(observed.system, /全题材扩展版|可按需读取的模块索引/);
    if (stage === 'S10') {
      const experience = observed.input.writingMaterials.focalExperience.scenes[0];
      assert.equal(experience.concern, '保住这笔送货订单');
      assert.equal(experience.personalMeaning, '兑现对伙伴的承诺');
      assert.equal(experience.experience, undefined);
      assert.equal(experience.kind, 'plan');
      assert.equal(observed.input.writingMaterials.dialogueIntent[0].intent, '请伙伴留下帮忙');
      assert.doesNotMatch(observed.system, /# 番茄创作共编|# 当前任务解释与处理/);
      assert.equal(observed.input.proseOperation.mode, 'draft');
      assert.equal(observed.input.prior, undefined);
      assert.doesNotMatch(observed.system, /read_naming_rules|使用 ask_author/);
      assert.deepEqual(observed.input.output_versions.map((s: any) => s.path), [prosePath(1)]);
    }
    if (stage === 'S11') {
      assert.equal(observed.input.writingMaterials, undefined);
      assert.ok(observed.input.sources.every((source: any) => !/^(05_|06_)/.test(source.path)));
      assert.match(observed.system, /不得新命名、改名或把同名对象合并/);
    }
    const dispatched = attempts(store, run.id).map(attempt => JSON.parse(store.object(attempt.requestRef!).toString('utf8')).request);
    assert.equal(dispatched.length, 1, '阶段聚焦不新增模型调用');
    assert.ok(JSON.stringify(dispatched[0]).includes(JSON.stringify(controller).slice(1, -1)), '当前完整总控进入最终网关请求');
    assert.ok(store.db.get(`context-preflight:${run.id}`), '实际阶段请求必须经过最终资料核验');
    assert.equal(store.db.headRef()!.id, before, '截获请求不修改正式作品');
    assert.ok(JSON.stringify(dispatched[0]).includes('二十年后的同城'));
    assert.doesNotMatch(JSON.stringify(dispatched[0]), /readPlan|context-preflight/, '必读清单与核验记录留在宿主，不挤占阶段专业提示词');
    fs.writeFileSync(path.join(output, `${stage}.json`), JSON.stringify({ caller: observed, wire: dispatched[0] }, null, 2));
  } finally { await service.drain(); }
});

test('资料投影仅省略可证明重复的宿主文档，关键条件、作者备注及完整依赖保留', () => {
  const { store, project } = refactorFixture();
  try {
    const source = (file: string, content: string): ContextSource => ({ path: file, content, hash: hash(content), required: true, mode: 'full', reason: 'fixture', ranges: [{ start: 0, end: Array.from(content).length }] });
    const sources = [source(paths.config, renderConfig(project)), source(paths.progress, renderProgress(project)),
      source(paths.world, '只能前往二十年后的同城；可带随身小物，不能携带大型设备。伤势保持，未来会随现在改变。'),
      source(paths.roles, '第二章断臂；第三章已痊愈，原状态在第二章仍成立。')];
    store.commit(sources.map(s => ({ path: s.path, content: s.content, baseHash: null })), project);
    const manifest = { stage: 'S10', chapter: 1, sources, factIds: [], projectRevision: project.revision,
      retrievedFacts: [], hardConstraints: [], conflicts: [] } as unknown as ContextManifest;
    const before = structuredClone(manifest);
    const projected = stageSources(manifest, project, 'prose');
    assert.deepEqual(projected.excluded.map(s => s.path), [paths.config, paths.progress]);
    assert.equal(projected.sources.find(s => s.path === paths.world)!.content, sources[2].content);
    assert.deepEqual(manifest, before, '模型投影不改变宿主的原文、来源与失效依据');
    sources[0].content += '\n作者备注：不能用祖传经验代替第一次学习。'; sources[0].hash = hash(sources[0].content);
    assert.match(JSON.stringify(stageSources(manifest, project, 'prose')), /不能用祖传经验/);
    manifest.sources = before.sources;
    fs.appendFileSync(path.join(store.root, paths.config), '\n作者改动');
    assert.equal(contextChanged(store, manifest), true, '即使该显示文档未进入请求，原文变化仍使任务失效');
  } finally { store.close(); }
});

test('完整确认契约只传一次，条件、例外、未决项与未来计划全部保留', () => {
  const { store, project } = refactorFixture();
  try {
    project.creation = { spec: { inputHash: 'input', taxonomyVersion: 'tax', revision: 1, mustKeep: ['无代价能力'], mustAvoid: ['强加创伤'] },
      contract: { revision: 1, directionId: 'd1', constraints: [{ id: 'c1', text: '只限同城；遇到地区例外保留未知', optionIds: [], scope: { entityIds: [], fromChapter: 1, toChapter: null }, evidenceRef: 'author' }],
        resolutions: { q1: '作者保留普通日常' }, openQuestions: ['其他地区规则未定'], tagCoverage: [],
        plan: { statements: [{ id: 'p1', kind: 'long_term_goal', text: '第三卷再获知真相', optionIds: [], sourceRefs: ['author-input'], payoffStage: 'long_term' }], tagRoles: [] } },
      knowledge: { version: 'k1', options: [], cards: [{ text: '未采纳的市场建议' }] } } as any;
    const content = renderContract(project.creation!.spec, project.creation!.contract);
    const manifest = { stage: 'S10', sources: [{ path: contractPath, hash: hash(content), content, mode: 'full', required: true }], factIds: [] } as unknown as ContextManifest;
    const packet = contextPayload(manifest, project, 'prose');
    assert.equal(packet.sources.length, 0);
    const prompt = tagContext(project, 'S10', { focused: true });
    for (const value of ['无代价能力', '强加创伤', '只限同城；遇到地区例外保留未知', '作者保留普通日常', '其他地区规则未定', '第三卷再获知真相']) assert.ok(prompt.includes(value));
    assert.doesNotMatch(prompt, /未采纳的市场建议/);
    manifest.sources[0].content += '\n作者补充：保持这个例外。';
    assert.match(JSON.stringify(contextPayload(manifest, project, 'prose')), /保持这个例外/);
  } finally { store.close(); }
});

test('整章重写、局部修订、续接与修复模式保持原预算和原候选', () => {
  const { store, run } = refactorFixture();
  try {
    run.pipeline = { phase: 'prose', epoch: 'e', version: 1, previewCalls: 0 };
    run.changes = [{ path: prosePath(1), content: '旧稿及有效结尾', baseHash: null }]; run.rounds = 4;
    const old = structuredClone(run.changes);
    assert.equal(proseTask(run).proseOperation.mode, 'continue');
    prepareAuthorRevision(run, '整章重写，保留人物选择和结果。');
    assert.equal(proseTask(run).prior, undefined); assert.equal(proseTask(run).proseOperation.mode, 'rewrite');
    assert.deepEqual(run.changes, old); assert.equal(run.rounds, 4);
    prepareAuthorRevision(run, '只修改最后一句，不要整章重写。');
    assert.equal(proseTask(run).proseOperation.mode, 'revision'); assert.equal(proseTask(run).prior, old[0].content);
    run.repairAttempts = { prose: 1 }; run.issues = [{ code: 'prose', severity: 'error', message: '结尾未完成' }];
    assert.equal(proseTask(run).proseOperation.mode, 'repair'); assert.deepEqual(proseTask(run).repair, run.issues);
    assert.equal(authorProseIntent('不要重新生成正文，只改对白'), 'revision');
    assert.equal(authorProseIntent('按作者要求重写整章，不只是局部润色。'), 'rewrite');
    assert.equal(authorProseIntent('整章重写。\n作者本轮修改意见：只改对白'), 'revision');
    prepareAuthorRevision(run, '从头重写，保留原稿中最后一句对白。');
    assert.equal(proseTask(run).proseOperation.mode, 'rewrite');
    assert.equal(proseTask(run).prior, undefined);
    assert.equal(proseTask(run).protectedTextReference?.content, old[0].content);
    assert.equal(run.rounds, 4);
  } finally { store.close(); }
});

test('聚焦请求不会继承旧阶段缓存中的指令、秘密或已丢弃候选，活动回执仍完整', async () => {
  const { store, run } = refactorFixture();
  try {
    run.mode = 'stage'; run.stage = 'S03'; run.manifest = { scope: { viewpoint: 'author', chapter: 1, mode: 'current', worldId: 'main', timelineId: 'main' }, sources: [] } as any;
    const initial = [{ role: 'user' as const, content: JSON.stringify({ authorPremise: '作者输入', contextPolicy: '资料', sources: [], secret: '旧阶段秘密' }) }];
    const options = { promptCacheKey: 'focus-cache' };
    const cacheProfile = { ...model, model: 'gpt-6.1-sol' };
    const old = requestBody(cacheProfile, '旧总控\n--- 当前专项技能：旧任务标记:retired-stage-fixture', initial, [], options).body;
    prepareCacheSession(store, run, cacheProfile, old, initial, 0)!.complete();
    const current = '共同规则\n--- 当前专项技能：当前任务\n' + focusInstruction('S04', '只处理当前角色');
    const messages = [{ role: 'user' as const, content: JSON.stringify({ authorPremise: '作者输入', contextPolicy: '资料', sources: [] }) },
      { role: 'assistant' as const, content: '', calls: [{ id: 'active', name: 'read_document', arguments: '{}' }],
        native: [{ type: 'function_call', call_id: 'active', name: 'read_document', arguments: '{}' }] },
      { role: 'tool' as const, callId: 'active', content: '本轮真实工具结果' }];
    const body = requestBody(cacheProfile, current, messages, [], options).body;
    assert.equal(prepareCacheSession(store, run, cacheProfile, body, messages, 0), undefined);
    await callModel(store, run, 'S04', async () => fakeResult(), cacheProfile, current, messages, [], new AbortController().signal);
    const sent = JSON.parse(store.object(attempts(store, run.id).at(-1)!.requestRef!).toString('utf8')).request;
    assert.doesNotMatch(JSON.stringify(sent), /旧阶段秘密|旧总控|retired-stage-fixture/);
    assert.match(JSON.stringify(sent), /本轮真实工具结果/);
    assert.ok(sent.input.some((item: any) => item.type === 'function_call' && item.call_id === 'active'));
    assert.ok(sent.input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'active'));
  } finally { store.close(); }
});

test('旧细纲的目标与行动直接读取，缺失心理材料不补造；所有专项资源可加载', () => {
  const text = '## 场面1：求医\n- 目标：获得治疗\n- 动作：交出收据\n- 结果：医生同意检查\n';
  const scene = sceneMaterials([{ path: '06_章节设计/第001章细纲.md', hash: hash(text), content: text } as ContextSource])[0];
  assert.equal(scene.goal, '获得治疗'); assert.equal(scene.actions, '交出收据'); assert.equal(scene.personalMeaning, undefined);
  for (const operation of designCatalog(root)) assert.ok(designResource(root, operation.id).content.trim());
});
