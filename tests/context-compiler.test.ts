import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileContext, contextPayload, contextChanged, fitContext } from '../src/core/context-compiler';
import { contextDependencies } from '../src/core/context-dependencies';
import { contextAllowance, countInput, assertRequestFits } from '../src/core/context-budget';
import { chapterSlice, endingSlice, pastPlanText } from '../src/core/context-slices';
import { retrieveMemory, tokensOf, visibleFact } from '../src/core/memory-studio';
import { searchMemory } from '../src/core/memory';
import { memoryScopeSchema } from '../src/shared/studio';
import { contextPolicySchema } from '../src/shared/types';
import { paths, prosePath, batchPath, activeBatch } from '../src/core/domain';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult } from './fixtures/refactor';
import { contextBook, contextCase } from './fixtures/context-book';
import { encodeFacts, rebuildMemory } from '../src/core/memory-records';
import { selectMemoryDiagnostics } from '../src/core/memory-diagnostics';

const model = { ...fakeProfile, contextLimit: 200000, outputLimit: 4096 };

function addBrokenMemory(book: ReturnType<typeof contextBook>, kind: 'unrelated' | 'related' | 'linked' | 'unknown-entity' | 'unknown-world' | 'future' | 'global' | 'duplicate' | 'parse') {
  const bad = structuredClone(book.facts[1]);
  bad.id = kind === 'duplicate' ? book.facts[0].id : 'isolated-bad-fact';
  bad.subject = '远方旅人'; bad.aliases = []; bad.entityIds = ['traveler'];
  bad.evidence[0].quote = '正式原文里不存在的证据';
  if (kind === 'related') { bad.subject = '林澈'; bad.entityIds = ['linche']; }
  if (kind === 'linked') bad.relatedIds = ['linche'];
  if (kind === 'unknown-entity') bad.entityIds = [];
  if (kind === 'unknown-world') bad.worldId = '';
  if (kind === 'future') { bad.subject = '林澈'; bad.fromChapter = 40; bad.revealedAt = 40; }
  if (kind === 'global') bad.scope = 'global';
  const content = kind === 'parse' ? '<!-- wenxu-facts:v1 -->\n```json\n{\n```' : encodeFacts('# 连续性记录', [...book.facts, bad]);
  if (kind === 'duplicate' || kind === 'parse') {
    // Normal commits reject corrupt records. Exercise recovery from a legacy
    // source without weakening the transaction checks to manufacture a fixture.
    const read = book.store.read.bind(book.store);
    book.store.read = (file, version) => file === paths.items ? { ...read(file, version), content } : read(file, version);
    rebuildMemory(book.store);
    return book.project;
  }
  const project = structuredClone(book.project); project.revision++;
  book.store.commit([{ path: paths.items, baseHash: book.store.db.document(paths.items)!.hash, content }], project);
  rebuildMemory(book.store);
  return project;
}

test('无关及尚未生效的坏证据隔离保留，不阻止当前章，也不进入模型事实', () => {
  for (const kind of ['unrelated', 'future'] as const) {
    const book = contextBook(false);
    try {
      const project = addBrokenMemory(book, kind);
      const manifest = compileContext(book.store, project, 'S10', contextCase.request, model);
      assert.deepEqual(manifest.conflicts, []);
      assert.ok(manifest.omitted!.some(item => item.reason.includes('失效记忆已隔离')));
      assert.ok(!JSON.stringify(contextPayload(manifest)).includes('isolated-bad-fact'));
      assert.ok(book.store.db.get<string[]>('memoryIssues')!.length > 0);
      assert.equal(book.store.db.facts().find(fact => fact.id === 'isolated-bad-fact')!.state, 'disputed');
      const loaded = selectMemoryDiagnostics(book.store, { scope: memoryScopeSchema.parse({ chapter: 25 }), query: '', sourcePaths: [paths.items] });
      assert.ok(loaded.blocking.length > 0, '实际装入的整份资料不能隐藏其坏事实');
    } finally { book.store.close(); }
  }
});

test('当前人物、全局约束、身份重复和无法解析的记忆继续阻断，未知旧诊断不被放行', () => {
  for (const kind of ['related', 'linked', 'unknown-entity', 'unknown-world', 'global', 'duplicate', 'parse'] as const) {
    const book = contextBook(false);
    try {
      const project = addBrokenMemory(book, kind);
      assert.throws(() => compileContext(book.store, project, 'S10', contextCase.request, model), /记忆来源需要核对/);
      if (kind === 'linked') assert.ok(selectMemoryDiagnostics(book.store, {
        scope: memoryScopeSchema.parse({ chapter: 25 }), query: 'linche', sourcePaths: []
      }).blocking.length > 0, '直接指定关联实体编号也必须核对其失效关系');
      book.store.db.set('memoryDiagnostics', null);
      const result = selectMemoryDiagnostics(book.store, { scope: memoryScopeSchema.parse({ chapter: 25 }), query: '', sourcePaths: [] });
      assert.deepEqual(result.blocking, book.store.db.get('memoryIssues'));
    } finally { book.store.close(); }
  }
});

test('新任务入口不会因无关坏记忆自动改成全书同步任务', async () => {
  const book = contextBook(false);
  addBrokenMemory(book, 'unrelated'); book.store.close();
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => fakeResult('隔离夹具'));
  service.profiles = [model];
  try {
    await service.invoke('project.open', { root: book.root });
    const project = service.store!.db.project();
    project.config.defaultProfileId = model.id;
    project.config.stageProfiles[project.stage] = '';
    service.store!.db.set('project', project);
    const id = await service.invoke('run.start', { request: contextCase.request });
    const run = service.store!.db.run(String(id));
    assert.equal(run.mode, 'stage'); assert.equal(run.memoryRepair, undefined);
    assert.equal(run.profileId, model.id);
    assert.ok(service.store!.db.get<string[]>('memoryIssues')!.length > 0);
  } finally { await service.drain(); service.close(); }
});

test('人物视角保留作者能力禁令、伤势和承诺，未知秘密不混入人物事实', () => {
  const { store, project, files } = contextBook();
  try {
    const manifest = compileContext(store, project, 'S10', contextCase.request, model);
    assert.deepEqual(new Set(manifest.hardConstraints!.map(f => f.id)), new Set(['ability-ban','arm','key-secret','key-promise']));
    assert.equal(visibleFact(manifest.hardConstraints![0], memoryScopeSchema.parse({ chapter: 25, viewpoint: 'character', characterId: 'linche' })), false);
    assert.ok(manifest.revelation!.withheld.some(f => f.id === 'key-secret' && f.revealedAt === 31));
    assert.ok(manifest.revelation!.characterUnknown.includes('key-secret'));
    assert.ok(!manifest.retrievedFacts!.some(f => ['key-secret','alternate-arm','old-arm'].includes(f.id)));
    assert.ok(manifest.sources.some(s => s.path === paths.world && s.layer === 'author_rules'));
    assert.match(JSON.stringify(contextPayload(manifest)), /不能借他人能力绕过/);
    assert.doesNotMatch(JSON.stringify(contextPayload(manifest)), /林澈的师父/);
    const source = manifest.sources.find(s => s.path === prosePath(24))!;
    assert.equal(source.category, 'formal_fact');
    assert.match(source.content, /林澈|玉钥/);
    for (const range of source.ranges!) {
      const quote = Array.from(files[source.path]).slice(range.start, range.end).join('');
      assert.ok(store.db.facts().some(f => f.evidence.some(e => e.path === source.path && e.quote === quote)), '证据坐标仍精确定位原文，模型只收到可见事实投影');
    }
  } finally { store.close(); }
});

test('资料包只装入本章计划与当前卷目标，保留全局规则和可回查原文范围', () => {
  const { store, project, files } = contextBook(false);
  try {
    const manifest = compileContext(store, project, 'S10', contextCase.request, model);
    const plan = manifest.sources.find(s => s.path === batchPath(activeBatch(project)))!;
    assert.match(plan.content, /本批禁止提前揭示|只揭示玉钥最后出现地点/);
    assert.doesNotMatch(plan.content, /秘密暗号赤鸢|走出旧城/);
    assert.doesNotMatch(manifest.sources.find(s => s.path === paths.volumes)!.content, /登上天空城/);
    const previous = manifest.sources.find(s => s.path === prosePath(24))!;
    assert.ok(previous.content.length < files[prosePath(24)].length / 2);
    assert.match(previous.content, /左手握住栏杆/);
    for (const source of [plan, previous]) assert.equal(source.content, source.ranges!.map(r => Array.from(files[source.path]).slice(r.start, r.end).join('')).join('\n\n'));
    assert.ok(manifest.omitted!.some(o => o.path === previous.path));
  } finally { store.close(); }
});

test('章节选择理解中文章号，无法可靠匹配时保留全文，结尾不截断 Unicode 字符', () => {
  const text = '# 大纲\n\n全书禁区。\n\n## 第二十四章\n\n过去。\n\n## 第二十五章\n\n码头。\n\n## 第二十六章\n\n未来。';
  assert.match(chapterSlice(text, 25).content, /全书禁区|码头/);
  assert.doesNotMatch(chapterSlice(text, 25).content, /过去|未来/);
  assert.equal(chapterSlice(text, 88).content, text);
  const body = '𠮷'.repeat(3000) + '\n\n最后一段𠮷。';
  const tail = endingSlice(body, 80);
  assert.equal(tail.content, Array.from(body).slice(tail.ranges[0].start).join(''));
  assert.ok(!tail.content.includes('\uFFFD'));
});

test('S09 实际编译保留全局说明与本章前后承接，不装入整批无关细纲', () => {
  const { store, project, files } = contextBook(false);
  try {
    const file = batchPath(activeBatch(project));
    files[file] += '\n\n## 第27章\n\n无关远期安排。';
    const current = { ...project, revision: project.revision + 1 };
    store.commit([{ path: file, content: files[file], baseHash: store.db.document(file)!.hash }], current);
    const manifest = compileContext(store, current, 'S09', contextCase.request, model);
    const source = manifest.sources.find(source => source.path === file)!;
    assert.equal(source.content, chapterSlice(files[file], project.chapter - 1, project.chapter + 1).content);
    assert.match(source.content, /本批禁止提前揭示|只揭示玉钥最后出现地点/);
    assert.equal(source.mode, 'excerpt');
    assert.doesNotMatch(source.content, /无关远期安排/);
    assert.ok(contextDependencies(manifest).some(dependency => dependency.path === file && dependency.hash === source.hash));
  } finally { store.close(); }
});

test('资料来源中的章号不被当成章节计划，后续同步仍保护真正的过往章节', () => {
  const sources = '\n## 资料依据\n\n| 文件 | 采用位置 |\n| --- | --- |\n| 09_续写状态/当前进度.md | S07、当前第001章、已完成0章 |\n| 07_正文章节/第001章.md | 已接受原文 |\n| 第001章.md | 原文副本引用 |\n';
  for (const [header, past, current] of [
    ['章节', '第001章', '第002章'],
    ['章号', '1', '2'],
    ['单元', '**第一章**', '第二章：反馈']
  ]) {
    const plan = `# 计划\n\n| ${header} | 安排 |\n| --- | --- |\n| ${past} | 首章已经交接 |\n| ${current} | 继续首章约定；引用第001章 |\n` + sources;
    const slice = chapterSlice(plan, 2).content;
    assert.doesNotMatch(slice, /首章已经交接/);
    assert.match(slice, /继续首章约定/);
    assert.ok(slice.includes(sources.trim()), '来源及版本说明应留在本章资料包');
    const updated = plan.replace('已完成0章', '已完成1章').replace('原文副本引用', '核对第001章的已接受版本') + '| 08_章后更新/第001章记忆更新.md | 新的章后证据 |\n';
    assert.equal(pastPlanText(updated, 2), pastPlanText(plan, 2));
    assert.notEqual(pastPlanText(plan.replace('首章已经交接', '首章没有交接'), 2), pastPlanText(plan, 2));
  }
});

test('中文分词、两字姓名与别名召回共用范围和版本过滤', () => {
  const { store } = contextBook(false);
  try {
    assert.ok(tokensOf('林澈不能使用瞬移').includes('不能'));
    for (const result of [retrieveMemory(store, '小澈回到码头', { chapter: 25 }, 1), searchMemory(store, '小澈回到码头', 25, 1)]) {
      assert.ok(result.facts.some(f => f.fact.id === 'arm'));
      assert.ok(!result.facts.some(f => ['alternate-arm','old-arm'].includes(f.fact.id)));
      assert.ok(result.documents.some(d => d.path === prosePath(24)));
    }
  } finally { store.close(); }
});

test('前文待核对时所有生成入口阻断，讨论保留问题说明且不使用失效记忆', () => {
  const { store, project } = contextBook(false);
  try {
    project.revision++; project.stale = [prosePath(24)]; project.chapters[24] = 'stale';
    store.commit([{ path: paths.impact, baseHash: store.db.document(paths.impact)!.hash, content: '前文修改后，第24章尚未核对。' }], project);
    for (const purpose of ['stage','draft'] as const) assert.throws(() => compileContext(store, project, 'S10', contextCase.request, model, { purpose }), /核对/);
    for (const purpose of ['discussion','revision'] as const) {
      const manifest = compileContext(store, project, 'S10', contextCase.request, model, { purpose, allowConflicts: true });
      assert.ok(manifest.conflicts.length);
      assert.ok(!manifest.sources.some(s => s.path === prosePath(24)));
      assert.ok(!manifest.hardConstraints!.some(f => f.id === 'arm'));
    }
  } finally { store.close(); }
});

test('硬约束和揭示边界超过预算时停止，可选片段被省略时有记录', () => {
  const { store, project } = contextBook(false);
  try {
    assert.throws(() => compileContext(store, project, 'S10', contextCase.request, { ...model, contextLimit: 4096, outputLimit: 1024 }), /必读资料超过输入预算/);
    const m = compileContext(store, project, 'S10', contextCase.request, model);
    const required = m.hardConstraints!.map(f => f.id);
    m.sources.push({ path: prosePath(2), hash: 'fixture', content: '可选资料'.repeat(30000), required: false, mode: 'excerpt', reason: '验收超预算可选资料' });
    fitContext(m, model);
    assert.ok(m.omitted!.some(o => o.path === prosePath(2)));
    assert.deepEqual(m.hardConstraints!.map(f => f.id), required);
    assert.ok(m.revelation!.withheld.some(f => f.id === 'key-secret'));
  } finally { store.close(); }
});

test('已知模型本地分词，未知模型明确使用字节上界，协议与安全余量独立扣除', () => {
  const openai = { ...model, model: 'gpt-4o' };
  const text = '林澈的右臂没有痊愈。'.repeat(100);
  const counted = countInput(openai, text);
  assert.equal(counted.method, 'o200k_base');
  assert.ok(counted.tokens < counted.bytes / 2);
  assert.equal(countInput(model, text).tokens, Buffer.byteLength(text));
  assert.equal(countInput(model, text).method, 'utf8_upper_bound');
  assert.ok(countInput(openai, '<|endoftext|>').tokens > 0);
  const configured = { ...openai, contextPolicy: contextPolicySchema.parse({ effectiveInputLimit: 16000, providerOverhead: 512, safetyRatio: 0.05, safetyTokens: 256, toolResultReserve: 1024 }) };
  const b = contextAllowance(configured, 3);
  assert.equal(b.availableInput, 16000 - 512 - 800 - 1024);
  assert.equal(b.effectiveLimitSource, 'configured');
  assert.throws(() => assertRequestFits({ ...model, contextLimit: 8000, outputLimit: 2000 }, { system: '中'.repeat(4000), tools: [] }), /容量/);
});

test('资料包来源追踪覆盖硬规则、隐藏信息与正文，外部修改会使整包失效', () => {
  const { store, project, root, files } = contextBook();
  try {
    const m = compileContext(store, project, 'S10', contextCase.request, model);
    assert.ok(contextDependencies(m).some(d => d.path === prosePath(1)));
    assert.equal(contextChanged(store, m), false);
    fs.writeFileSync(path.join(root, prosePath(1)), files[prosePath(1)] + '\n发生外部修改');
    assert.equal(contextChanged(store, m), true);
  } finally { store.close(); }
});

test('资料包拒绝跨作品、历史快照与其他任务章号', () => {
  const { store, project } = contextBook(false);
  try {
    for (const scope of [memoryScopeSchema.parse({ chapter: 25, projectId: 'foreign' }), memoryScopeSchema.parse({ chapter: 24 }), memoryScopeSchema.parse({ chapter: 25, mode: 'historical', snapshotId: store.db.head()!.id })]) {
      assert.throws(() => compileContext(store, project, 'S10', contextCase.request, model, { scope }), /范围|当前/);
    }
  } finally { store.close(); }
});

test('上下文预览扣除真实任务规则的常驻预算，不创建任务或请求模型', async () => {
  const { store, root } = contextBook(); store.close();
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => { throw new Error('预览不得调用模型'); });
  service.profiles = [model];
  try {
    await service.invoke('project.open', { root });
    const before = service.snapshot().runs.length;
    const manifest = await service.invoke('context.preview', { profileId: model.id, request: contextCase.request });
    assert.ok(manifest.budget!.residentTokens > 1000);
    assert.ok(manifest.availableTokens < contextAllowance(model).availableInput - 1000);
    assert.equal(service.snapshot().runs.length, before);
    assert.equal(service.runner?.controller, null);
  } finally { service.close(); }
});

test('讨论、自由试写和正式修订实际发送同一编排器提供的作者规则与揭示边界', async () => {
  const { store, root } = contextBook(); store.close();
  const requests: string[] = [];
  const service = new Service(path.resolve('resources/skill'), () => {}, async (_p, system, messages) => { requests.push(system + JSON.stringify(messages)); return fakeResult('已依据当前章节资料作答。'); });
  service.profiles = [model];
  const idle = async () => { const end = Date.now() + 15000; while (service.chat?.controller || service.runner?.controller) { assert.ok(Date.now() < end); await new Promise(r => setTimeout(r, 5)); } };
  try {
    await service.invoke('project.open', { root });
    const chat = service.snapshot().conversations![0].id;
    await service.invoke('chat.send', { conversationId: chat, profileId: model.id, text: contextCase.request }); await idle();
    const card = await service.invoke('proposal.create', { conversationId: chat, profileId: model.id, proposal: { kind: 'draft', goal: '试写码头一段', scope: '第25章', request: contextCase.request, outputs: ['独立草稿'] } });
    await service.invoke('proposal.confirm', { id: card.id, version: card.version }); await idle();
    await service.invoke('run.start', { mode: 'revision', request: contextCase.request, profileId: model.id }); await idle();
    assert.equal(requests.length, 3);
    for (const request of requests) { assert.match(request, /ability-ban/); assert.match(request, /第30章前不能瞬移/); assert.match(request, /withheld/); assert.match(request, /key-secret/); assert.doesNotMatch(request, /林澈的师父/); }
    const turns = (await service.invoke('chat.read', { id: chat })).turns;
    assert.ok(turns.every((t: any) => t.manifest?.selectedBy === 'context-compiler-v1'));
  } finally { service.close(); }
});
