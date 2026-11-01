import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { alignChapterTitle, chapterNameSlots, chapterNamingContext, chapterRenameIssues, chapterTitleIssues, makeChapterNaming, upgradesChapterNaming } from '../src/core/chapter-naming';
import { SkillRegistry } from '../src/core/skill-registry';
import { Service } from '../src/core/service';
import { bindDesign, designPrompt } from '../src/core/design-operations';
import { hash, paths, detailPath, taskPath, prosePath, stageOutputs } from '../src/core/domain';
import { loadNamingRules } from '../src/core/naming';
import { proposalHash } from '../src/core/storage';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { runSchema } from '../src/shared/contract-schemas';
import type { StageId } from '../src/shared/types';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';

const root = path.resolve('resources/skill');
const file = '06_章节设计/第001-030章细纲.md';
const before = '# 第001-030章细纲\n\n## 第001章：签字之前\n\n- 核心场面：看到事故记录后拒签。\n- 状态变化：资助取消，尚未获准对练。\n\n### 场面推进\n\n原对白“签字之前”保留。\n\n## 第002章：另一个入口\n\n- 核心场面：申请基础评估。\n';
const after = before.replace('## 第001章：签字之前', '## 第001章：练这套会重伤？这字我不签').replace('## 第002章：另一个入口', '## 第002章：断了资助，也别急着淘汰我');

async function setup(stage: StageId, caller: ConstructorParameters<typeof Service>[2] = async () => { throw new Error('禁止真实模型请求'); }) {
  const service = new Service(root, () => {}, caller);
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 10000 }];
  await service.invoke('project.create', { parent: isolatedRoot('chapter-names'), title: '章名回归', premise: '都市高武，未来武学', config: { defaultProfileId: fakeProfile.id, maxRounds: 1, preview: { enabled: false } } });
  const store = service.store!;
  let project = store.db.project();
  for (const step of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'] as const) {
    if (step >= stage) break;
    store.commit(stageOutputs(step, project).map(file => service.change(file, fixture(project, file, service))), project);
    project = store.db.project();
  }
  project.stage = stage; store.db.set('project', project);
  return { service, store, project };
}

test('章名商业规则统一覆盖新旧合同，旧提示指纹失效且审稿不加载起名规则', () => {
  const registry = new SkillRegistry(root);
  const historic = {
    'webnovel-batch-outline': 'b8fb0119e1685bb5076585d58deb01676167d52049a98f7df1b57bed4d6fa45f',
    'webnovel-chapter-planner': '75235a8ce810916388146641240d1fac68aa8e2170353d592d405d8627af2504',
    'webnovel-chapter-drafter': '1de87e73658074b885be7adc5cbc88c43bb587c59a7d6e8be5d6a891919356df'
  };
  for (const [skill, digest] of Object.entries(historic)) {
    assert.notEqual(registry.load(skill).hash, digest);
    assert.match(registry.load(skill).content, /番茄章节命名：与书名、卷名一致/);
    assert.match(registry.load(skill, { chapterNamingVersion: 1 }).content, /番茄章节命名：与书名、卷名一致/);
    assert.equal(registry.load(skill, { chapterNamingVersion: 1 }).hash, registry.load(skill).hash);
  }
  assert.equal(registry.load('webnovel-chapter-reviewer').hash, registry.load('webnovel-chapter-reviewer', { chapterNamingVersion: 1 }).hash);
  assert.equal(registry.read('references/chapter-naming-commercial.md'), fs.readFileSync(path.join(root, 'references/chapter-naming-commercial.md'), 'utf8'));
  assert.equal(hash(fs.readFileSync(path.join(root, 'title-market-editing/writer.system.md'))), '431aa319029905738d5da5a1f8beb1e52525dd771ae69cc6be61413bbf751363');
});

test('章名识别不碰文档名称、场面标题、对白和代码示例；换行与其他文字逐字冻结', () => {
  const { store, run } = refactorFixture();
  try {
    run.stage = 'S08';
    for (const newline of ['\n', '\r\n']) {
      const original = before.replaceAll('\n', newline), candidate = after.replaceAll('\n', newline);
      run.chapterNaming = makeChapterNaming(store, run, '只改章节名字', [{ path: file, content: original, baseHash: null }]);
      assert.equal(chapterNameSlots(original, file).slots.length, 2);
      assert.equal(chapterNameSlots(original, file).skeleton, chapterNameSlots(candidate, file).skeleton);
      assert.deepEqual(chapterRenameIssues(run, [{ path: file, content: candidate, baseHash: null }]), []);
      assert.match(candidate, /原对白“签字之前”保留/);
    }
    assert.equal(chapterNameSlots('```markdown\n' + before + '\n```', file).slots.length, 0);
    assert.equal(chapterNameSlots(before, '作者笔记.md').slots.length, 0);
    assert.equal(chapterNameSlots('# 第001章细纲\n\n## 场面1：签字之前\n', '06_章节设计/第001章细纲.md').slots.length, 0);
  } finally { store.close(); }
});

test('只改章名拦截改章号、改事件、改对白、删场、改文件和改事实；冻结进入批准指纹及协议', () => {
  const { store, run } = refactorFixture();
  try {
    run.stage = 'S08'; run.changes = [{ path: file, content: before, baseHash: null }];
    run.chapterNaming = makeChapterNaming(store, run, '仅优化全部章名', run.changes);
    const stamp = proposalHash(run);
    assert.deepEqual(runSchema.parse(run).chapterNaming, run.chapterNaming);
    for (const content of [after.replace('第002章', '第003章'), after.replace('尚未获准对练', '公开对练获胜'), after.replace('原对白“签字之前”保留', '对白被改写'), after.replace('### 场面推进', '### 删除场面'), after.replace('断了资助，也别急着淘汰我', '')])
      assert.ok(chapterRenameIssues(run, [{ path: file, content, baseHash: null }]).length);
    assert.ok(chapterRenameIssues(run, [{ path: paths.roles, content: '新角色', baseHash: null }]).length);
    run.factRetractions = [{ id: 'other', reason: '不应在改名时撤回' }];
    assert.ok(chapterRenameIssues(run).length);
    run.factRetractions = [];
    run.chapterNaming!.renameOnly!.documents[0].hash = 'stale';
    assert.notEqual(proposalHash(run), stamp);
    assert.ok(chapterRenameIssues(run).length);
  } finally { store.close(); }
});

test('批次章名传至任务清单，单章已确认标题传至正文；本地同步只动名称且不重复章号', () => {
  const { store, run, project } = refactorFixture();
  try {
    store.commit([{ path: file, content: after, baseHash: null }], project);
    run.stage = 'S09';
    run.chapterNaming = makeChapterNaming(store, run);
    assert.equal(run.chapterNaming.source!.title, '练这套会重伤？这字我不签');
    assert.equal(makeChapterNaming(store, run, '章节标题改成更有看点的番茄风格').source, undefined);
    assert.equal(makeChapterNaming(store, run, '沿用章名，只修改细纲').source!.title, run.chapterNaming.source!.title);
    const task = '# 第001章任务清单\n\n- 本章标题：签字之前\n- 本章核心事件：看到事故记录后拒签。\n';
    const synced = alignChapterTitle(run, { path: taskPath(1), content: task, baseHash: null });
    assert.equal(synced.content, task.replace('本章标题：签字之前', '本章标题：练这套会重伤？这字我不签'));
    store.commit([{ ...synced, content: synced.content.replace('练这套会重伤？这字我不签', '第001章：作者确认的新章名') }], store.db.project());
    run.stage = 'S10'; run.chapterNaming = makeChapterNaming(store, run);
    assert.equal(run.chapterNaming.source!.path, taskPath(1));
    assert.equal(run.chapterNaming.source!.title, '作者确认的新章名');
    const prose = '# 第001章：模型另起的名字\r\n\r\n许越把笔放回桌上。\r\n';
    assert.equal(alignChapterTitle(run, { path: prosePath(1), content: prose, baseHash: null }).content, prose.replace('模型另起的名字', '作者确认的新章名'));
    const bare = '# 第001章\n\n许越把笔放回桌上。';
    assert.equal(alignChapterTitle(run, { path: prosePath(1), content: bare, baseHash: null }).content, bare.replace('# 第001章', '# 第001章：作者确认的新章名'));
    const generic = '# 本章正文\r\n\r\n许越把笔放回桌上。\r\n';
    assert.equal(alignChapterTitle(run, { path: prosePath(1), content: generic, baseHash: null }).content, generic.replace('本章正文', '第001章：作者确认的新章名'));
    const wrongChapter = { path: prosePath(1), content: bare.replace('001', '002'), baseHash: null };
    assert.deepEqual(alignChapterTitle(run, wrongChapter), wrongChapter);
    assert.ok(chapterTitleIssues(store, run, [{ path: prosePath(1), content: prose.replace('001', '002'), baseHash: null }]).length);
    assert.match(JSON.stringify(chapterNamingContext(run)), /作者确认的新章名/);
  } finally { store.close(); }
});

test('旧章名任务普通恢复不升级；明确反馈刷新规则和冻结范围，保留已花费额度', async () => {
  const { service, store } = await setup('S08');
  try {
    const old = service.makeRun('stage', '完成当前批次');
    assert.equal(old.chapterNaming?.version, 1);
    delete old.chapterNaming;
    old.changes = [service.change(file, before)]; old.rounds = 3; old.toolCount = 8; store.db.saveRun(old);
    for (const instruction of ['继续', '章名不改', '不要修改章节标题', '保留章名，改场面']) assert.equal(upgradesChapterNaming(old, instruction), false);
    const resumed = service.rebuildRun(old, fakeProfile.id, '继续');
    assert.equal(resumed.chapterNaming, undefined);
    const renamed = service.rebuildRun(resumed, fakeProfile.id, '只改章节名字，统一番茄风格');
    assert.equal(renamed.chapterNaming?.version, 1);
    assert.equal(renamed.chapterNaming?.renameOnly?.documents[0].hash, hash(before));
    assert.equal(renamed.rounds, 3); assert.equal(renamed.toolCount, 8); assert.deepEqual(renamed.usage, old.usage);
    const original = structuredClone(renamed.changes);
    const call = (content: string) => ({ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(file, content)] }) });
    await service.runner!.execute(renamed, store.db.project(), call(after.replace('尚未获准对练', '主角已经获胜')), new AbortController().signal, loadNamingRules(root));
    assert.deepEqual(renamed.changes, original);
    await service.runner!.execute(renamed, store.db.project(), call(after), new AbortController().signal, loadNamingRules(root));
    assert.equal(renamed.changes[0].content, after);
  } finally { await service.drain(); }
});

test('单章候选只改章名时保留原细纲候选，冻结后不能借改名改场面', async () => {
  const { service, store } = await setup('S09');
  try {
    const old = service.makeRun('stage', '细化本章');
    old.changes = stageOutputs('S09', store.db.project()).map(file => service.change(file, fixture(store.db.project(), file, service)));
    store.db.saveRun(old);
    const revised = service.rebuildRun(old, fakeProfile.id, '章节标题改成更有看点的番茄风格');
    assert.equal(revised.chapterNaming?.source, undefined);
    const continued = service.rebuildRun(revised, fakeProfile.id, '继续');
    assert.equal(continued.chapterNaming?.source, undefined);
    const renamed = service.rebuildRun(continued, fakeProfile.id, '只改章名，统一番茄风格');
    assert.equal(renamed.chapterNaming?.source, undefined);
    assert.equal(renamed.chapterNaming?.renameOnly?.documents.length, 2);
    const task = renamed.changes.find(change => change.path === taskPath(1))!;
    const next = task.content.replace(/本章标题：[^\r\n]+/, '本章标题：先把药拿回来');
    await service.runner!.execute(renamed, store.db.project(), { id: 'title-only', name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(taskPath(1), next)] }) }, new AbortController().signal, loadNamingRules(root));
    assert.equal(renamed.changes.find(change => change.path === taskPath(1))!.content, next);
    assert.deepEqual(renamed.changes.find(change => change.path === detailPath(1)), old.changes.find(change => change.path === detailPath(1)));
    assert.deepEqual(chapterRenameIssues(renamed), []);
    assert.ok(chapterRenameIssues(renamed, renamed.changes.map(change => change.path === detailPath(1) ? { ...change, content: change.content + '\n新系统突然觉醒。' } : change)).length);
  } finally { await service.drain(); }
});

test('新S08在原调用内命名并保存完整批次，不另开命名请求、不加说明栏', async () => {
  let calls = 0, service: Service;
  const created = await setup('S08', async (_profile, system, _messages, _tools, _signal, _delta, options) => {
    calls++; assert.match(system, /番茄章节命名/); assert.equal(options?.webSearch, undefined);
    const content = fixture(service.store!.db.project(), file, service).replaceAll('章：求医', '章：先把药拿回来');
    return { ...fakeResult(''), calls: [{ id: 'batch', name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(file, content)] }) }] };
  });
  service = created.service;
  try {
    const run = service.makeRun('stage', '完成当前批次'); created.store.db.saveRun(run);
    await service.runner!.drive(run.id);
    const done = created.store.db.run(run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(calls, 1);
    assert.equal(chapterNameSlots(done.changes[0].content, file).slots.length, 30);
    assert.doesNotMatch(done.changes[0].content, /命名解释|AI味评分|营销点评/);
  } finally { await service.drain(); }
});

test('S09提交与S10正文保存继承已确认章名，正文哈希按同步后的文本建立', async () => {
  for (const stage of ['S09', 'S10'] as const) {
    let service: Service, calls = 0, emitted = '';
    const { service: created, store, project } = await setup(stage, async (_profile, system, messages) => {
      calls++; assert.match(system, /沿用作者确认的人名、称谓、地名、术语及本轮确认的标题/);
      assert.doesNotMatch(system, /番茄章节命名/, '已确认章名直接继承，不在正文或场景阶段重新策划命名');
      assert.match(messages[0].content, /chapterNamingReference/);
      if (stage === 'S10') { emitted = fixture(store.db.project(), prosePath(1), service); return fakeResult(emitted); }
      return { ...fakeResult(''), calls: [{ id: 'plan', name: 'propose_changes', arguments: JSON.stringify({ changes: stageOutputs(stage, store.db.project()).map(file => service.change(file, fixture(store.db.project(), file, service))) }) }] };
    });
    service = created;
    try {
      const run = service.makeRun('stage', '继续写作');
      const expected = run.chapterNaming!.source!.title;
      store.db.saveRun(run); await service.runner!.drive(run.id);
      const done = store.db.run(run.id);
      assert.equal(calls, 1, done.error ?? JSON.stringify(done.issues));
      const change = done.changes.find(change => change.path === (stage === 'S09' ? taskPath(1) : prosePath(1)))!;
      assert.equal(chapterNameSlots(change.content, change.path).slots[0].name, expected);
      assert.deepEqual(chapterTitleIssues(store, done), []);
      if (stage === 'S10') {
        assert.equal(done.pipeline!.proseHash, hash(change.content));
        assert.equal(change.content.slice(change.content.indexOf('\n')), emitted.slice(emitted.indexOf('\n')));
        assert.equal(done.pipeline!.phase, 'review');
      } else assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
      const source = run.chapterNaming!.source!;
      store.commit([service.change(source.path, store.readAccepted(source.path).content + '\n作者更新\n')], store.db.project());
      assert.ok(chapterTitleIssues(store, done, []).length);
      assert.throws(() => service.runner!.contextResident(done, project), /标题来源发生变化/);
    } finally { await service.drain(); }
  }
});

test('在S09修改已确认批次章名：设计工具沿用同规则，采纳只改标题且不废弃剧情', async () => {
  const { service, store, project } = await setup('S09');
  try {
    const original = store.readAccepted(file).content;
    const candidate = original.replaceAll('章：求医', '章：先把药拿回来');
    const run = service.makeRun('revision', '只改章节标题');
    bindDesign(store, root, run, { id: 'rolling-outline.batch', request: '只改章节标题', sources: [file] });
    assert.match(designPrompt(store, root, run), /番茄章节命名/);
    assert.ok(run.chapterNaming?.renameOnly);
    run.changes = [service.change(file, candidate)]; store.db.saveRun(run);
    await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run) });
    assert.equal(store.readAccepted(file).content, candidate);
    assert.equal(store.db.project().stage, 'S09');
    assert.deepEqual(store.db.project().stale, project.stale);
    const invalid = service.makeRun('revision', '只改章名');
    bindDesign(store, root, invalid, { id: 'rolling-outline.batch', request: '只改章名' });
    const changedStory = candidate.replace('求医事件与明确后果', '发现无敌系统');
    assert.notEqual(changedStory, candidate);
    invalid.changes = [service.change(file, changedStory)];
    store.db.saveRun(invalid);
    assert.throws(() => new ProjectCommitService(store).commit(invalid.changes, store.db.project(), invalid), /只修改章名/);
  } finally { await service.drain(); }
});
