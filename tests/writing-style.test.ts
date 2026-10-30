import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { FileStore } from '../src/core/storage';
import { paths, parseConfig } from '../src/core/domain';
import { attempts } from '../src/core/runtime/model-gateway';
import { emptyTagInput } from '../src/shared/tags';
import { newProjectRequest } from '../src/shared/new-project-request';
import { normalizeWritingStyle, writingStylePresets, writingStyleRequestSchema } from '../src/shared/writing-style';
import type { Caller } from '../src/core/runner';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { writingStyleReportFixture as report } from './fixtures/writing-style';

function request() {
  return writingStyleRequestSchema.parse({ requestId: crypto.randomUUID(), profileId: fakeProfile.id, currentStyle: writingStylePresets[0].style,
    context: { premise: '维修员阿宁在停电中发现异常，保持第三人称。', genre: '都市悬疑', constraints: '不增加超能力' } });
}
function setup(caller: Caller = async () => fakeResult(JSON.stringify(report))) {
  const service = new Service(path.resolve('resources/skill'), () => {}, caller);
  service.profiles = [{ ...fakeProfile, outputLimit: 4096 }];
  service.requestJournal = new FileStore(isolatedRoot('writing-style-journal'));
  return service;
}

for (const mode of ['planning', 'existing'] as const) test(`${mode} 新作品保存所选风格，策划与配置正文使用相同内容`, async () => {
  const service = setup();
  try {
    const style = '自然口语；\n情绪细腻； 不强制快节奏';
    const snapshot = await service.invoke('project.create', newProjectRequest({ mode, parent: isolatedRoot('writing-style-project'),
      title: '风格选择', premise: '维修员调查停电原因', profileId: fakeProfile.id, style,
      capacity: { targetWords: 3000000, chapterWords: 2500, minWords: 2300, maxWords: 2700 }, creationInput: { ...emptyTagInput(), premise: '维修员调查停电原因' } }));
    assert.equal(snapshot.project?.config.style, normalizeWritingStyle(style));
    assert.equal(parseConfig(service.store!.readAccepted(paths.config).content, snapshot.project!.config).style, normalizeWritingStyle(style));
    if (mode === 'planning') assert.equal(snapshot.tagDraft?.preferences.style, normalizeWritingStyle(style));
  } finally { await service.drain(); }
});

test('无已打开作品也能推荐；一次请求记账、重复请求复用，推荐不修改作品', async () => {
  let calls = 0;
  const service = setup(async (profile, system, messages, tools) => {
    calls++;
    assert.equal(profile.tools, false); assert.equal(profile.networkRecovery?.maxRetries, 0); assert.deepEqual(tools, []);
    assert.match(system, /没有实时市场数据/);
    const input = JSON.parse(messages[0].content);
    assert.equal(input.premise, request().context.premise); assert.equal(input.constraints, '不增加超能力');
    assert.equal(input.currentStyle, writingStylePresets[0].style);
    return fakeResult('```json\n' + JSON.stringify(report) + '\n```');
  });
  const input = request(), journalRoot = service.requestJournal!.root;
  try {
    assert.equal(service.store, null);
    const first = await service.invoke('style.recommend', input);
    assert.deepEqual(first, report);
    assert.deepEqual(await service.invoke('style.recommend', input), report);
    assert.equal(calls, 1);
    const history = attempts(service.requestJournal!, input.requestId);
    assert.equal(history.length, 1); assert.equal(history[0].status, 'complete');
    await assert.rejects(service.invoke('style.recommend', { ...input, currentStyle: '另一要求' }), /同一操作编号/);
    assert.equal(service.store, null);
  } finally { await service.drain(); }
  const reopened = setup(async () => { throw new Error('缓存不应调用模型'); });
  reopened.requestJournal!.close(); reopened.requestJournal = new FileStore(journalRoot);
  try { assert.deepEqual(await reopened.invoke('style.recommend', input), report); }
  finally { await reopened.drain(); }
});

test('已有作品使用已保存设定和目标读者；采纳后更新配置而不改写正文', async () => {
  let captured: Record<string, unknown> = {};
  const service = setup(async (_p, _s, messages) => { captured = JSON.parse(messages[0].content); return fakeResult(JSON.stringify(report)); });
  try {
    await service.invoke('project.create', { parent: isolatedRoot('writing-style-existing'), title: '电梯', premise: '维修员调查失踪事件', config: { defaultProfileId: fakeProfile.id } });
    const store = service.store!, project = store.db.project();
    store.commit([service.change(paths.config, store.readAccepted(paths.config).content + '\n- 目标读者：喜欢职业悬疑的读者\n'),
      service.change('07_正文章节/第001章.md', '原正文保留。')], project);
    const revision = store.db.project().revision, configBefore = store.readAccepted(paths.config).hash;
    const result = await service.invoke('style.recommend', { ...request(), projectSessionId: service.projectSessionId, context: { premise: '', genre: '都市悬疑' } });
    assert.match(String(captured.premise), /维修员调查失踪事件/);
    assert.equal(captured.targetAudience, '喜欢职业悬疑的读者');
    assert.equal(store.db.project().revision, revision); assert.equal(store.readAccepted(paths.config).hash, configBefore);
    await service.invoke('project.configure', { config: { ...store.db.project().config, style: result.options[0].style } });
    const saved = store.db.project();
    assert.equal(saved.config.style, result.options[0].style);
    assert.equal(parseConfig(store.readAccepted(paths.config).content, saved.config).style, result.options[0].style);
    assert.match(store.readAccepted(paths.config).content, /目标读者：喜欢职业悬疑的读者/);
    assert.equal(store.readAccepted('07_正文章节/第001章.md').content, '原正文保留。');
  } finally { await service.drain(); }
});

test('番茄发布分类以可读名称进入推荐，错误频道不构造虚假分类', async () => {
  let captured: Record<string, unknown> = {};
  const service = setup(async (_p, _s, messages) => { captured = JSON.parse(messages[0].content); return fakeResult(JSON.stringify(report)); });
  try {
    const catalog = service.tagCatalog().publishingSnapshots![0], main = catalog.options.find(item => item.channel === 'male' && item.group === 'reading.main')!;
    await service.invoke('style.recommend', { ...request(), context: { premise: '', bookProfile: { creativeGenres: [], publishing: { platform: 'fanqie', form: 'original_long', channel: main.channel, snapshotId: catalog.id, reading: { main: main.id, theme: [], role: [], plot: [] } } } } });
    assert.deepEqual(captured.publishing, { platform: '番茄小说', channel: '男频', category: main.label });
    assert.equal(captured.genre, main.label);
    await assert.rejects(service.invoke('style.recommend', { ...request(), context: { premise: '角色调查旧案', bookProfile: { creativeGenres: [], publishing: { platform: 'fanqie', form: 'original_long', channel: 'female', snapshotId: catalog.id, reading: { main: main.id, theme: [], role: [], plot: [] } } } } }), /分类与目录不一致/);
  } finally { await service.drain(); }
});

test('取消推荐阻止迟到结果，重复未知请求不再收费，恢复后可发起新请求', async () => {
  let release!: () => void, started!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { started = resolve; });
  const service = setup(async () => { calls++; started(); await gate; return fakeResult(JSON.stringify(report)); });
  try {
    const input = request(), pending = service.invoke('style.recommend', input);
    await reached;
    await assert.rejects(service.invoke('style.recommend', request()), /已有风格推荐/);
    assert.equal(service.writingStyles.busy, true);
    await service.invoke('style.cancel', { requestId: crypto.randomUUID() });
    assert.equal(service.writingStyles.busy, true);
    await service.invoke('style.cancel', { requestId: input.requestId });
    const rejected = assert.rejects(pending, /已停止/); release(); await rejected;
    assert.equal(service.writingStyles.busy, false);
    await assert.rejects(service.invoke('style.recommend', input), /不能自动重复执行/);
    assert.equal(calls, 1);
    assert.deepEqual(await service.invoke('style.recommend', request()), report); assert.equal(calls, 2);
  } finally { release?.(); await service.drain(); }
});

test('坏结果、无模型和无作品信息不自动补发或写入设置', async () => {
  const invalid = ['不是JSON', JSON.stringify({ ...report, recommendedId: 'missing' }), JSON.stringify({ ...report, options: [report.options[0], report.options[0], report.options[2]] })];
  let calls = 0;
  const service = setup(async () => fakeResult(invalid[calls++]));
  try {
    await assert.rejects(service.invoke('style.recommend', { ...request(), profileId: 'missing' }), /可用的创作模型/);
    await assert.rejects(service.invoke('style.recommend', { ...request(), context: {} }), /创作想法或选择题材/);
    assert.equal(calls, 0);
    for (const _ of invalid) await assert.rejects(service.invoke('style.recommend', request()), /候选不完整/);
    assert.equal(calls, 3);
    await assert.rejects(service.invoke('style.recommend', { ...request(), projectSessionId: 'old-project' }), /作品已切换/);
    assert.equal(calls, 3);
  } finally { await service.drain(); }
});
