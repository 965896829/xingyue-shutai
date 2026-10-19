import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileContext, contextPayload, contextChanged, fitContext } from '../src/core/context-compiler';
import { contextDependencies } from '../src/core/context-dependencies';
import { contextAllowance, countInput, assertRequestFits } from '../src/core/context-budget';
import { chapterSlice, endingSlice } from '../src/core/context-slices';
import { retrieveMemory, tokensOf, visibleFact } from '../src/core/memory-studio';
import { searchMemory } from '../src/core/memory';
import { memoryScopeSchema } from '../src/shared/studio';
import { contextPolicySchema } from '../src/shared/types';
import { paths, prosePath, batchPath, activeBatch } from '../src/core/domain';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult } from './fixtures/refactor';
import { contextBook, contextCase } from './fixtures/context-book';

const model = { ...fakeProfile, contextLimit: 200000, outputLimit: 4096 };

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
    const source = manifest.sources.find(s => s.path === prosePath(24))!;
    assert.equal(source.content, source.ranges!.map(r => Array.from(files[source.path]).slice(r.start, r.end).join('')).join('\n\n'));
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
    for (const request of requests) { assert.match(request, /ability-ban/); assert.match(request, /第30章前不能瞬移/); assert.match(request, /withheld/); assert.match(request, /key-secret/); }
    const turns = (await service.invoke('chat.read', { id: chat })).turns;
    assert.ok(turns.every((t: any) => t.manifest?.selectedBy === 'context-compiler-v1'));
  } finally { service.close(); }
});
