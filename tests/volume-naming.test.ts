import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { volumeNameSlots, volumeRenameIssues, revisedVolumeNaming, requestsVolumeNamesOnly } from '../src/core/volume-naming';
import { upgradesVolumeNaming, volumeNamingContext } from '../src/core/volume-market-research';
import { SkillRegistry } from '../src/core/skill-registry';
import { bindDesign, designPrompt } from '../src/core/design-operations';
import { Service } from '../src/core/service';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { loadNamingRules } from '../src/core/naming';
import { hash, paths, stageOutputs } from '../src/core/domain';
import { proposalHash } from '../src/core/storage';
import { factSchema } from '../src/shared/types';
import { encodeFacts, rebuildMemory } from '../src/core/memory';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';

const root = path.resolve('resources/skill');
const outline = '# 分卷大纲\n\n- 全书主线：以未来练法取得参赛资格。\n- 成长线：从依赖资料到自己判断。\n- 对抗路线：对手持续研究主角的打法。\n\n## 分卷容量表\n\n| 卷数 | 卷名 | 章节范围 | 预计章数 | 预计字数 | 细纲批次 | 阶段功能 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 第一卷 | 擂台另一边 | 001—600 | 600章 | 1500000字 | 20批 | 取得资格 |\n| 第二卷 | 同场的人 | 601—1200 | 600章 | 1500000字 | 20批 | 全国赛 |\n'
  + ['擂台另一边', '同场的人'].map((name, i) => `\n## 第${i ? '二' : '一'}卷：${name}\n\n- 章节范围：${i ? '601—1200' : '001—600'}。\n- 预计章数：600章。\n- 预计字数：1500000字。\n- 对应细纲批次：${i ? '第21—40批' : '第01—20批'}。\n- 核心规则或爽点：未来练法需要当下实战验证。\n- 主角阶段目标：取得${i ? '全国赛' : '市赛'}资格。\n- 主要反派：参赛对手有独立竞争目标。\n- 开局事件：原有打法被对手识破。\n- 中段升级：改变准备方法。\n- 高潮事件：${i ? '主角进入全国赛' : '主角取得市赛资格'}。\n- 卷尾钩子：下一位对手已经看过比赛。\n- 新增人物：赛事裁判。\n- 需要埋下的伏笔：保留“同场的人”这句对白。\n`).join('');
function renamed(text = outline) {
  const parsed = volumeNameSlots(text);
  for (const slot of parsed.slots.sort((a, b) => b.start - a.start)) {
    const name = slot.order === 1 ? '未来武学到手，先拿下参赛资格' : '全国赛场，谁能破我的招';
    text = text.slice(0, slot.start) + name + text.slice(slot.end);
  }
  return text;
}

test('商业卷名规则统一装配，旧语义指纹失效而书名规则保持', () => {
  const registry = new SkillRegistry(root);
  assert.notEqual(registry.load('webnovel-volume-architect').hash, 'f3f0a40f6493e5ec115faa775c2d26c83895737fde8db37003e3e0ce9c802425');
  assert.notEqual(registry.load('webnovel-volume-architect', { legacyVolumeNaming: true }).hash, '048c0236741fe3bf22402ff1f138ccb3d71c557c7f3850f57cc5b04ab2932059');
  assert.equal(registry.load('webnovel-volume-architect', { legacyVolumeNaming: true }).hash, registry.load('webnovel-volume-architect').hash);
  const next = registry.load('webnovel-volume-architect', { volumeNamingVersion: 2 }).content;
  assert.match(next, /番茄分卷命名：与商业书名一致/);
  assert.doesNotMatch(next, /从真实目录到本书的叙事口吻|处理角色口吻、意象、留白/);
  assert.equal(registry.read('references/volume-naming-commercial.md'), fs.readFileSync(path.join(root, 'references/volume-naming-commercial.md'), 'utf8'));
  const title = fs.readFileSync(path.join(root, 'title-market-editing/writer.system.md'));
  const titleLock = JSON.parse(fs.readFileSync(path.join(root, 'title-market-editing/resources.lock.json'), 'utf8'));
  assert.equal(hash(title), titleLock['writer.system.md']);
});

test('仅改卷名与扩大修订区分；已有市场资料复制保留，不携带过期的改名范围', () => {
  for (const request of ['只改卷名，按番茄风格', '仅优化全部卷名', '只修改分卷标题']) assert.equal(requestsVolumeNamesOnly(request), true);
  for (const request of ['不只改卷名，还修改剧情', '不仅优化卷名', '修改剧情和卷名', '继续']) assert.equal(requestsVolumeNamesOnly(request), false);
  const first = revisedVolumeNaming(undefined, '只改卷名', outline);
  first.research = { status: 'ready', provider: 'public', genre: '都市高武', tags: [], query: '公开主题', startedAt: '2026-10-30', message: '已核验', sources: [], reads: [] };
  const next = revisedVolumeNaming(first, '只改卷名', renamed());
  assert.deepEqual(next.research, first.research); assert.notEqual(next.research, first.research);
  assert.equal(next.renameOnly!.hash, hash(renamed()));
  assert.equal(revisedVolumeNaming(first, '调整剧情和卷名', outline).renameOnly, undefined);
});

test('名字局部替换允许长标题、标点和多种卷序；正文同名对白及 CRLF 原样保留', () => {
  const { store, run } = refactorFixture();
  try {
    for (const content of [outline, outline.replaceAll('\n', '\r\n'), outline.replaceAll('第一卷', '第1卷').replaceAll('第二卷', '第2卷')]) {
      run.volumeNaming = revisedVolumeNaming(undefined, '只改卷名', content);
      const candidate = renamed(content);
      assert.equal(volumeNameSlots(content).slots.length, 4);
      assert.deepEqual(volumeRenameIssues(run, [{ path: paths.volumes, content: candidate, baseHash: null }]), []);
      assert.match(candidate, /保留“同场的人”这句对白/);
    }
  } finally { store.close(); }
});

test('只改卷名时阻止改剧情、容量、漏改标题、增删卷、空名、其他文稿和伪造冻结依据', () => {
  const { store, run } = refactorFixture();
  try {
    run.volumeNaming = revisedVolumeNaming(undefined, '只改卷名', outline);
    const good = renamed();
    for (const content of [good.replace('主角取得市赛资格', '主角觉醒无敌系统'), good.replace('001—600', '001—601'), good.replace('1500000字', '1500001字'), good.replace('## 第一卷：未来武学到手，先拿下参赛资格', '## 第一卷：其他名字'), good + '\n## 第三卷：新的战场\n', good.replace('同场的人”这句对白', '新的名字”这句对白'), good.replaceAll('未来武学到手，先拿下参赛资格', '')]) {
      assert.ok(volumeRenameIssues(run, [{ path: paths.volumes, content, baseHash: null }]).length, content);
    }
    assert.ok(volumeRenameIssues(run, [{ path: paths.roles, content: '角色改动', baseHash: null }]).length);
    run.factRetractions = [{ id: 'unrelated', reason: '不得在改名时撤销事实' }];
    assert.ok(volumeRenameIssues(run, []).length);
    run.factRetractions = [];
    const original = structuredClone(run.volumeNaming);
    run.volumeNaming!.renameOnly!.hash = 'tampered';
    assert.ok(volumeRenameIssues(run, []).length);
    run.volumeNaming = original;
    run.volumeNaming!.renameOnly = { ...original.renameOnly!, content: outline.replace('## 第二卷：同场的人', '## 第一卷：同场的人'), hash: '' };
    run.volumeNaming!.renameOnly!.hash = hash(run.volumeNaming!.renameOnly!.content);
    assert.ok(volumeRenameIssues(run, []).length);
  } finally { store.close(); }
});

test('分卷设计工具共用当前商业规则，历史合同仍保留只改名范围', () => {
  const { store, run, project } = refactorFixture();
  try {
    store.commit([{ path: paths.volumes, content: outline, baseHash: null }], project);
    run.changes = [];
    bindDesign(store, root, run, { id: 'rolling-outline.volume', request: '只改卷名，统一番茄风格' });
    assert.equal(run.volumeNaming?.version, 2);
    assert.equal(run.volumeNaming?.renameOnly?.hash, hash(outline));
    assert.match(designPrompt(store, root, run), /题材辨识、具体看点、阅读期待/);
    assert.match(JSON.stringify(volumeNamingContext(run)), /volumeRenameScope/);
    assert.equal(upgradesVolumeNaming(run, '只改卷名'), true);
    const fingerprint = proposalHash(run);
    delete run.volumeNaming;
    assert.notEqual(proposalHash(run), fingerprint);
    assert.match(designPrompt(store, root, run), /番茄分卷命名：与商业书名一致/);
    assert.equal(designPrompt(store, root, run).split(new SkillRegistry(root).controller().content).length - 1, 1);
  } finally { store.close(); }
});

test('正式采纳层复核名字范围，不能绕过候选检查写入剧情变更', () => {
  const { store, run, project } = refactorFixture();
  try {
    run.volumeNaming = revisedVolumeNaming(undefined, '只改卷名', outline);
    run.changes = [{ path: paths.volumes, content: renamed().replace('主角进入全国赛', '主角杀死对手'), baseHash: null }];
    store.db.saveRun(run);
    assert.throws(() => new ProjectCommitService(store).commit(run.changes, project, run), /只修改卷名/);
    assert.equal(store.db.document(paths.volumes), undefined);
  } finally { store.close(); }
});

test('已生成卷名的修订保留检索与预算；工具提交越界原子拒绝，合法名字可提交并通过恢复检查', async () => {
  const service = new Service(root, () => {}, async () => { throw new Error('测试不允许真实模型请求'); });
  service.profiles = [fakeProfile];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('volume-names'), title: '卷名回归', premise: '都市高武，未来武学', config: { defaultProfileId: fakeProfile.id, preview: { enabled: false } } });
    const store = service.store!;
    let project = store.db.project();
    for (const stage of ['S01', 'S02', 'S03', 'S04'] as const) {
      store.commit(stageOutputs(stage, project).map(file => service.change(file, fixture(project, file, service))), project);
      project = store.db.project();
    }
    project.stage = 'S05'; store.db.set('project', project);
    const old = service.makeRun('stage', '生成分卷大纲');
    old.volumeNaming = { version: 1, research: { status: 'disabled', provider: 'none', genre: '都市高武', tags: [], query: '', startedAt: '2026-10-30', message: '关闭联网', sources: [], reads: [] } };
    old.changes = [service.change(paths.volumes, outline)]; old.rounds = 4; old.toolCount = 7;
    store.db.saveRun(old);
    const ordinary = service.rebuildRun(old, fakeProfile.id, '继续');
    assert.equal(ordinary.volumeNaming?.version, 1);
    const run = service.rebuildRun(ordinary, fakeProfile.id, '只改卷名，参考番茄商业风格');
    assert.equal(run.volumeNaming!.version, 2);
    assert.equal(run.volumeNaming!.renameOnly!.hash, hash(outline));
    assert.deepEqual(run.volumeNaming!.research, old.volumeNaming!.research);
    assert.equal(run.rounds, 4); assert.equal(run.toolCount, 7); assert.deepEqual(run.usage, old.usage);
    const original = structuredClone(run.changes);
    const call = (content: string) => ({ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(paths.volumes, content)] }) });
    await service.runner!.execute(run, project, call(renamed().replace('主角进入全国赛', '主角开启系统')), new AbortController().signal, loadNamingRules(root));
    assert.deepEqual(run.changes, original);
    assert.match(run.messages.at(-1)!.content, /只修改卷名/);
    await service.runner!.execute(run, project, { id: crypto.randomUUID(), name: 'propose_memory', arguments: JSON.stringify({ facts: [] }) }, new AbortController().signal, loadNamingRules(root));
    assert.match(run.messages.at(-1)!.content, /不能重新提交故事记忆/);
    await service.runner!.execute(run, project, call(renamed()), new AbortController().signal, loadNamingRules(root));
    assert.equal(run.changes[0].content, renamed());
    service.runner!.check(run, project);
    assert.ok(!run.issues.some(issue => issue.code === 'volume_rename_scope'));
  } finally { await service.drain(); }
});

test('在后续阶段改已确认分卷：恢复保留设计目标、章号和阶段，单次创作不加目录研究', async () => {
  let calls = 0;
  const service: Service = new Service(root, () => {}, async (_profile, system, _messages, _tools, _signal, _delta, options) => {
    calls++;
    assert.equal(options?.webSearch, undefined);
    assert.match(system, /番茄分卷命名：与商业书名一致/);
    return { ...fakeResult(''), calls: [{ id: 'rename', name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(paths.volumes, renamed())] }) }] };
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 4096 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('volume-design'), title: '已有大纲', premise: '都市高武', config: { defaultProfileId: fakeProfile.id, maxRounds: 1, preview: { enabled: false } } });
    const store = service.store!;
    let project = store.db.project();
    for (const stage of ['S01', 'S02', 'S03', 'S04'] as const) {
      store.commit(stageOutputs(stage, project).map(file => service.change(file, fixture(project, file, service))), project);
      project = store.db.project();
    }
    store.commit([service.change(paths.volumes, outline)], project);
    project = store.db.project();
    const fact = factSchema.parse({ id: 'volume-plan', subject: '主角', predicate: '长期参赛目标', value: '进入全国赛', kind: 'plan', category: 'promise', reviewStatus: 'accepted', fromChapter: 1, revealedAt: 1, evidence: [{ path: paths.volumes, hash: hash(outline), quote: '主角进入全国赛。' }] });
    store.commit([service.change(paths.behavior, encodeFacts(store.readAccepted(paths.behavior).content, [fact]))], project);
    rebuildMemory(store);
    const behaviorBefore = store.readAccepted(paths.behavior).content;
    project = store.db.project(); project.stage = 'S06'; store.db.set('project', project);
    const run = service.makeRun('revision', '只改卷名');
    bindDesign(store, root, run, { id: 'rolling-outline.volume', request: '只改卷名', sources: [paths.volumes] });
    store.db.saveRun(run);
    const resumed = service.rebuildRun(run, fakeProfile.id, '只改卷名，按番茄风格');
    assert.deepEqual(resumed.design, run.design); assert.equal(resumed.stage, 'S05');
    await service.runner!.drive(resumed.id);
    const done = store.db.run(resumed.id);
    assert.equal(calls, 1);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(done.changes[0].content, renamed());
    assert.ok(!done.issues.some(issue => issue.code === 'operation_scope' || issue.code === 'volume_rename_scope'));
    assert.equal(store.readAccepted(paths.volumes).content, outline);
    assert.equal(store.db.project().stage, 'S06');
    const beforeAccept = store.db.project();
    await service.invoke('run.accept', { id: done.id, proposalHash: proposalHash(done) });
    assert.equal(store.readAccepted(paths.volumes).content, renamed());
    assert.equal(store.db.project().stage, 'S06');
    assert.deepEqual(store.db.project().stale, beforeAccept.stale);
    assert.deepEqual(store.db.project().chapters, beforeAccept.chapters);
    assert.equal(encodeFacts(store.readAccepted(paths.behavior).content, []), encodeFacts(behaviorBefore, []));
    const savedFact = store.db.facts().find(value => value.id === fact.id)!;
    assert.equal(savedFact.value, fact.value);
    assert.equal(savedFact.evidence[0].hash, hash(renamed()));
    assert.equal(savedFact.evidence[0].quote, fact.evidence[0].quote);
    const priorDraft = renamed().replace('主角取得市赛资格', '主角主动退出市赛');
    const mixed = service.makeRun('revision', '只改已有候选的卷名');
    bindDesign(store, root, mixed, { id: 'rolling-outline.volume', request: '只改卷名', sources: [paths.volumes] });
    mixed.volumeNaming = revisedVolumeNaming(undefined, '只改卷名', priorDraft);
    mixed.changes = [service.change(paths.volumes, priorDraft)];
    store.db.saveRun(mixed);
    await service.invoke('run.accept', { id: mixed.id, proposalHash: proposalHash(mixed) });
    assert.ok(store.db.project().stale.length > beforeAccept.stale.length, '原候选已有剧情修订时不能借改名豁免关联核对');
  } finally { await service.drain(); }
});
