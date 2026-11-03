import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AssistantSettings } from '../src/core/assistant-settings';
import { creationPolicy, professionalMethod, conditionalCreationPolicy, professionalMethods } from '../src/core/creation-policy';
import { designResource } from '../src/core/design-operations';
import { creativeRules, compileCreative } from '../src/core/creative-context';
import { chapterAuditPrompts } from '../src/core/chapter-audit';
import { writingMaterials, sceneMaterials } from '../src/core/scene-material';
import { Service } from '../src/core/service';
import { SkillRegistry } from '../src/core/skill-registry';
import { attempts } from '../src/core/runtime/model-gateway';
import { bindWorkflow } from '../src/core/runtime/workflow-contract';
import { encodeFacts } from '../src/core/memory-records';
import { hash, paths, prosePath, updatePath } from '../src/core/domain';
import { factSchema, type ContextManifest } from '../src/shared/types';
import { parseOutput } from '../src/shared/contracts';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';

const root = path.resolve('resources/skill');

test('共享方法受资源锁保护，更新同时使默认、显式和探索提示指纹失效', () => {
  const copied = isolatedRoot('shared-method-integrity');
  fs.cpSync(root, copied, { recursive: true });
  const prior = {
    stage: new SkillRegistry(copied).load('webnovel-chapter-drafter').hash,
    design: designResource(copied, 'chapter-draft.draft').hash,
    creative: creativeRules(copied, 'explore').hash,
    world: designResource(copied, 'world-design.create').hash
  };
  const file = path.join(copied, 'design-v7/methods/prose.md');
  fs.appendFileSync(file, '\n本次版本测试规则。\n');
  assert.throws(() => new SkillRegistry(copied).load('webnovel-chapter-drafter'), /完整性/);
  assert.throws(() => designResource(copied, 'chapter-draft.draft'), /完整性/);
  assert.throws(() => creativeRules(copied, 'explore'), /完整性/);
  const lockFile = path.join(copied, 'design-v7/resources.lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock['methods/prose.md'] = hash(fs.readFileSync(file));
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  assert.notEqual(new SkillRegistry(copied).load('webnovel-chapter-drafter').hash, prior.stage);
  assert.notEqual(designResource(copied, 'chapter-draft.draft').hash, prior.design);
  assert.notEqual(creativeRules(copied, 'explore').hash, prior.creative);
  assert.equal(designResource(copied, 'world-design.create').hash, prior.world);
});

test('默认、显式操作与隔离工具使用同一方法，每份仅装入一次且各自合同保留', () => {
  for (const [operation, methods] of Object.entries(professionalMethods)) {
    if (!fs.existsSync(path.join(root, 'design-v7', `${operation}.md`))) continue;
    const loaded = creationPolicy(root, operation);
    assert.deepEqual(designResource(root, operation), loaded);
    for (const method of methods) assert.equal(loaded.content.split(professionalMethod(root, method).content).length - 1, 1, operation);
  }
  for (const operation of ['explore', 'voice-pilot', 'learn-edits', 'patterns', 'compare-feedback'] as const) {
    const loaded = creativeRules(root, operation);
    assert.match(loaded.content, /宿主输出合同 v1/);
    for (const method of professionalMethods[operation]) assert.equal(loaded.content.split(professionalMethod(root, method).content).length - 1, 1);
  }
  assert.doesNotMatch(creativeRules(root, 'first-read').content, /作者真相与当前方案核验|角色资料全量/);
  const audits = chapterAuditPrompts(root);
  assert.equal(audits.chapterAuditInstruction.split(professionalMethod(root, 'memory').content).length - 1, 1);
  assert.match(audits.chapterAuditInstruction, /"memory".*"plans"/);
  assert.match(audits.compactAuditInstruction, /evidenceRefs/);
  assert.match(audits.compactAuditInstruction, /不得省略项目/);
});

test('契约转移规则按相关创作材料加载，正文不带入条件片段', () => {
  assert.equal(conditionalCreationPolicy(root, 'S01', '两个孩子度过快乐的一天。'), '');
  assert.equal(conditionalCreationPolicy(root, 'S10', '继承规则'), '');
  assert.match(conditionalCreationPolicy(root, 'S03', '能力转移后，原契约如何生效。'), /不能把保管默认等同权属转移/);
  assert.doesNotMatch(creationPolicy(root, 'premise.analyze').content, /权利人怎样取回/);
});

test('旧偏好原文与版本保留，冲突规则不自动启用，选择迁入后可重启和回退', () => {
  const directory = isolatedRoot('editor-archive');
  let settings = new AssistantSettings(directory, root);
  settings.saveRole('editor', 'OLD_EDITOR：一律用长句。');
  settings.saveRole('tomato', 'OLD_TOMATO：一律用短句。');
  settings.saveRole('qidian', 'OLD_QIDIAN：禁止第一人称。');
  settings.saveSearch({ enabled: false, maxResults: 7 }, 'encrypted-search-fixture');
  settings.saveEmbedding({ enabled: false }, 'encrypted-embedding-fixture');
  const before = settings.settings();
  const archive = before.roles.find(role => role.id === 'editor')!;
  settings = new AssistantSettings(directory, root);
  assert.equal(settings.roles().filter(role => !role.archived).length, 1);
  assert.equal(settings.roles()[0].id, 'coeditor');
  assert.doesNotMatch(settings.roles()[0].current.text, /OLD_/);
  assert.deepEqual(settings.roles().filter(role => role.archived), before.roles.filter(role => role.archived));
  settings.saveRole('coeditor', '有作用时保留长句。', '作者编辑', { id: 'editor', version: archive.current.id });
  const imported = settings.roles()[0].current;
  assert.match(imported.reason, /网文编辑/);
  assert.deepEqual(imported.source, { id: 'editor', version: archive.current.id });
  settings.reset('coeditor');
  settings.rollback('coeditor', imported.id);
  settings = new AssistantSettings(directory, root);
  assert.equal(settings.roles()[0].current.text, imported.text);
  assert.deepEqual(settings.settings().search, before.search);
  assert.deepEqual(settings.settings().embedding, before.embedding);
  assert.equal(settings.secret(), 'encrypted-search-fixture');
  assert.equal(settings.embeddingSecret(), 'encrypted-embedding-fixture');
  assert.deepEqual(parseOutput('assistant.settings', settings.settings()).roles, settings.roles());
  assert.throws(() => settings.saveRole('coeditor', 'invalid', '作者编辑', { id: 'editor', version: 'missing' }), /来源不存在/);
});

test('自由对话完整出站请求仅启用共编，旧 read_rule 标识兼容且不读取归档规则', async () => {
  const settings = new AssistantSettings(isolatedRoot('editor-chat'), root);
  settings.saveRole('editor', 'ARCHIVED_CANARY');
  let requests = 0;
  const service = new Service(root, () => {}, async (_profile, system, messages, tools, _signal, _delta, options) => {
    requests++;
    const wire = JSON.stringify({ system, messages, tools, options });
    assert.doesNotMatch(wire, /ARCHIVED_CANARY|使用编辑、番茄创作和起点创作|# 当前任务解释与处理/);
    assert.match(system, /# 番茄创作共编/);
    if (requests === 1) return { ...fakeResult(''), stop: 'tools', calls: [{ id: 'read-editor', name: 'read_rule', arguments: JSON.stringify({ name: 'editor', lines: 80 }) }] };
    assert.match(messages.find(message => message.role === 'tool')!.content, /番茄创作共编/);
    return fakeResult('可以先讨论这个场景。');
  });
  service.profiles = [{ ...fakeProfile, tools: true, outputLimit: 4096 }];
  service.assistant.roles = settings.roles();
  try {
    await service.invoke('project.create', { parent: isolatedRoot('editor-chat-book'), title: '讨论测试', premise: '阿宁准备送货。', config: { defaultProfileId: fakeProfile.id } });
    const conversation = await service.invoke('chat.create', {});
    await service.invoke('chat.send', { conversationId: conversation.id, profileId: fakeProfile.id, text: '先看看编辑方法，再讨论这个场景。' });
    const deadline = Date.now() + 10000;
    while (service.chat?.controller) {
      if (Date.now() > deadline) throw new Error('对话未按期完成');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(requests, 2);
  } finally { await service.drain(); }
});

test('S09 精确场面字段与 S11 八项机制摘要实际进入写作材料并保留来源', () => {
  const { store } = refactorFixture();
  try {
    const fields = ['场景功能', '焦点人物', '当前关切', '个人意义', '主观判断', '注意线索', '可用经验', '对话意图', '交流对象', '当前关系', '叙述处理', '声音依据', '重要新增'];
    const keys = ['sceneFunction', 'focalCharacter', 'concern', 'personalMeaning', 'interpretation', 'attention', 'experience', 'dialogueIntent', 'addressees', 'relationship', 'narration', 'voice', 'additions'];
    const scene = '# 本章细纲\n\n## 场面1：保住订单\n' + fields.map((label, i) => `- ${label}：材料${i}`).join('\n');
    const labels = ['冲突来源', '主角策略', '对手反制', '解法', '局面变化', '阅读回报', '付出与损失', '有意复现'];
    const mechanism = labels.map((label, i) => `- ${label}：依据${i}`).join('\n');
    store.commit([{ path: updatePath(1), content: mechanism, baseHash: null }], store.db.project());
    const manifest = { chapter: 2, scope: { viewpoint: 'author' }, sources: [{ path: '06_章节设计/第002章细纲.md', hash: hash(scene), content: scene }] } as ContextManifest;
    const material = writingMaterials(store, manifest);
    keys.forEach((key, i) => assert.equal((material.focalExperience.scenes[0] as unknown as Record<string, unknown>)[key], `材料${i}`));
    const history = material.historicalMechanisms[0];
    for (const [i, key] of ['conflict', 'strategy', 'response', 'solution', 'change', 'reward', 'cost', 'protectedRepetition'].entries())
      assert.equal((history as unknown as Record<string, unknown>)[key], `依据${i}`);
    assert.equal(history.sources.length, 8);
    assert.equal(material.focalExperience.scenes[0].kind, 'plan');
    assert.equal(material.dialogueIntent[0].intent, '材料7');
    const optional = scene.replace('- 当前关切：材料2', '- 当前关切：').replace('- 可用经验：材料6', '- 可用经验：\t');
    const parsed = sceneMaterials([{ ...manifest.sources[0], content: optional }])[0];
    assert.equal(parsed.concern, undefined, '空字段不能吞入下一行的个人意义');
    assert.equal(parsed.experience, undefined, '空经验不能误读对白目的');
    assert.equal(parsed.personalMeaning, '材料3');
  } finally { store.close(); }
});

test('人物试演真实调用不泄漏上个角色的私下不确定内容，并拒绝未来回合', async () => {
  let requests = 0;
  const service = new Service(root, () => {}, async (_profile, system, messages, tools, _signal, _delta, options) => {
    requests++;
    const wire = JSON.stringify({ system, messages, tools, options });
    assert.doesNotMatch(wire, /PRIVATE_CANARY|AUTHOR_CANARY|actor_safe_direction/);
    assert.match(wire, /门外有人/);
    const payload = JSON.parse(messages[0].content);
    assert.deepEqual(payload.visibleInteractionHistory, [{ speaker: '上一位行动者', speech: '门外有人。', action: '指向门口。' }]);
    assert.equal(payload.observations, '窗边有动静。');
    return fakeResult(JSON.stringify({ speech: '先等一下。', action: '听门外的动静。', uncertainty: '还不知道是谁。' }));
  });
  service.profiles = [{ ...fakeProfile, tools: false, outputLimit: 4096 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('rehearsal-private'), title: 'AUTHOR_CANARY', premise: 'AUTHOR_CANARY', config: { defaultProfileId: fakeProfile.id } });
    const store = service.store!;
    const prose = '阿宁相信木匣在屋里。AUTHOR_CANARY';
    const fact = factSchema.parse({ id: 'belief', subject: '阿宁', predicate: '认为', value: '木匣在屋里', entityIds: ['CH1'], kind: 'belief', category: 'knowledge', fromChapter: 1, revealedAt: 1, reviewStatus: 'accepted', knowledge: [{ who: 'CH1', fromChapter: 1, mode: 'misunderstood' }], evidence: [{ path: prosePath(1), hash: hash(prose), quote: prose }] });
    store.commit([{ path: prosePath(1), content: prose, baseHash: store.db.document(prosePath(1))?.hash ?? null }, { path: paths.knowledge, content: encodeFacts('# 知情', [fact]), baseHash: store.db.document(paths.knowledge)?.hash ?? null }], store.db.project());
    const previous = service.makeRun('analysis', '上一回合', fakeProfile.id);
    previous.creative = compileCreative(store, root, { operation: 'rehearse', characterId: 'CH1', chapter: 1, observations: '门响了。' }, previous.id).binding;
    previous.creative.result = { content: 'PRIVATE_CANARY', hash: hash('PRIVATE_CANARY'), createdAt: new Date().toISOString(), synthetic: true,
      turn: { speech: '门外有人。', action: '指向门口。', ...{ uncertainty: 'PRIVATE_CANARY' } } };
    previous.status = 'complete'; store.db.saveRun(previous);
    const run = service.makeRun('analysis', 'AUTHOR_CANARY', fakeProfile.id);
    const input = { operation: 'rehearse' as const, characterId: 'CH1', chapter: 1, observations: '窗边有动静。', parentRunId: previous.id };
    run.creative = compileCreative(store, root, input, run.id).binding;
    run.tagBinding = undefined; run.workflowVersion = 1; bindWorkflow(run); store.db.saveRun(run);
    await service.runner!.drive(run.id);
    assert.equal(store.db.run(run.id).status, 'complete', store.db.run(run.id).error ?? '');
    assert.equal(requests, 1);
    assert.equal(attempts(store, run.id).length, 1);
    (previous.creative.input as { chapter: number }).chapter = 3;
    store.db.saveRun(previous);
    assert.throws(() => compileCreative(store, root, input, run.id), /故事位置/);
  } finally { await service.drain(); service.close(); }
});
