import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { bundledPublishingCatalog, bookProfileContext, bookProfilePath, parseBookProfile, parsePublishingResponse, readBookProfile, refreshPublishingCatalog, renderBookProfile, resolveBookProfile } from '../src/core/publishing';
import { comparePublishingSnapshots, type BookProfile, type PublishingChannel } from '../src/shared/publishing';
import { compileTags, makeCreationSpec, selectedIds, tagBundle } from '../src/core/tags';
import { newProject, paths } from '../src/core/domain';
import { emptyTagInput } from '../src/shared/tags';
import { titleSearchTopic } from '../src/core/title-market-research';
import { Service } from '../src/core/service';
import { isolatedRoot, fakeProfile } from './fixtures/refactor';
import { proposalHash } from '../src/core/storage';
import { compileContext } from '../src/core/context-compiler';
import { newProjectRequest } from '../src/shared/new-project-request';
import { documentPreviewText } from '../src/shared/run-presentation';

const skill = path.resolve('resources/skill'), catalog = bundledPublishingCatalog(skill);
function profile(channel: PublishingChannel = 'female'): BookProfile {
  return { creativeGenres: ['都市日常', '悬疑调查'], publishing: { platform: 'fanqie', form: 'original_long', channel, snapshotId: catalog.id,
    reading: { main: catalog.options.find(o => o.channel === channel && o.group === 'reading.main')!.id, theme: [], role: [], plot: [] } } };
}
const response = (channel: PublishingChannel) => ({ code: 0, data: catalog.options.filter(o => o.channel === channel).map(o => ({
  category_id: Number(o.platformId), label: ({ 'reading.main': '主分类', 'reading.theme': '主题', 'reading.role': '角色', 'reading.plot': '情节' })[o.group], name: o.label
})) });

test('公开书库336项与37榜单分别保存，154旧标签身份不变，同名不同频道不混合', () => {
  assert.equal(catalog.options.length, 336); assert.equal(catalog.ranks.length, 37);
  assert.equal(catalog.options.filter(o => o.channel === 'male').length, 154);
  assert.equal(catalog.options.filter(o => o.channel === 'female').length, 182);
  const legacy = tagBundle(skill).taxonomy.options;
  const mapped = catalog.options.filter(o => o.legacyId);
  assert.equal(mapped.length, 154);
  for (const option of mapped) assert.equal(legacy.find(o => o.id === option.legacyId)!.conceptId, option.conceptId);
  const main = catalog.options.filter(o => o.group === 'reading.main');
  assert.equal(main.filter(o => o.channel === 'female').length, 21);
  assert.equal(main.filter(o => !catalog.ranks.some(r => r.channel === o.channel && r.platformId === o.platformId)).length, 3);
  const invalid = profile(); invalid.publishing!.reading.main = profile('male').publishing!.reading.main;
  assert.throws(() => resolveBookProfile(invalid, [catalog]), /频道/);
});

test('刷新完整目录产生可比较的新快照，半截响应或单频道失败不产生替代目录', async () => {
  const next = await refreshPublishingCatalog(catalog, new AbortController().signal, async url => {
    const data = response(url.endsWith('=1') ? 'male' : 'female');
    if (url.endsWith('=0')) data.data[0].name += '新版';
    return JSON.stringify(data);
  });
  assert.equal(comparePublishingSnapshots(catalog, next).renamed.length, 1);
  assert.equal(resolveBookProfile(profile(), [next, catalog]).catalog!.id, catalog.id);
  assert.throws(() => parsePublishingResponse({ ...response('female'), data: response('female').data.slice(0, 12) }, 'female', catalog), /不完整|减少/);
  await assert.rejects(refreshPublishingCatalog(catalog, new AbortController().signal, async url => {
    if (url.endsWith('=0')) throw new Error('offline'); return JSON.stringify(response('male'));
  }), /offline/);
  assert.equal(bundledPublishingCatalog(skill).id, catalog.id);
});

test('频道分类进入方案覆盖和书名检索，混搭题材独立保存，模型只读选中结果', () => {
  const book = newProject('组合题材', isolatedRoot('profile-spec'), {});
  const spec = makeCreationSpec(book, { ...emptyTagInput(), bookProfile: profile() }, 1, tagBundle(skill).taxonomy);
  const knowledge = compileTags(spec, skill);
  assert.deepEqual(knowledge.options.map(o => o.id), selectedIds(spec));
  assert.equal(titleSearchTopic(skill, spec, '').genre, knowledge.options[0].label);
  const text = renderBookProfile(profile(), catalog);
  assert.deepEqual(parseBookProfile(text).profile.creativeGenres, ['都市日常', '悬疑调查']);
  assert.ok(bookProfileContext(text).length < 1000);
  assert.doesNotMatch(documentPreviewText(text), /wenxu-book-profile|public_library|extractorVersion/);
  assert.throws(() => parseBookProfile(text.replace('发布主分类：', '发布分类：')), /不一致/);
});

test('已有设定开书保留频道、混搭题材和作者禁区，浏览及候选采纳零模型请求', async () => {
  let calls = 0;
  const service = new Service(skill, () => {}, async () => { calls++; throw new Error('不应请求模型'); });
  service.profiles = [fakeProfile];
  try {
    const input = { ...emptyTagInput(), bookProfile: profile(), mustKeep: ['现实职业'], mustAvoid: ['超能力'] };
    const args = newProjectRequest({ mode: 'existing', parent: isolatedRoot('profile-existing'), title: '记录', premise: '维修员调查旧案',
      profileId: fakeProfile.id, capacity: { targetWords: 100000, chapterWords: 2500, minWords: 2300, maxWords: 2700 }, creationInput: input });
    const created = await service.invoke('project.create', args), store = service.store!;
    assert.match(created.project!.config.constraints, /不能出现：超能力/);
    assert.equal(created.project!.config.genre, '都市日常、悬疑调查');
    assert.equal(created.project!.creationWorkflow, undefined);
    const before = { config: store.readAccepted(paths.config).hash, seed: store.readAccepted(paths.seed).hash };
    const state = await service.invoke('publishing.read', {});
    const id = await service.invoke('publishing.propose', { profile: { ...state.profile, publishing: profile('male').publishing }, baseHash: state.baseHash, snapshotId: store.db.headRef()!.id });
    assert.equal(readBookProfile(store).profile.publishing!.channel, 'female');
    const run = store.db.run(id);
    assert.deepEqual(run.changes.map(c => c.path), [bookProfilePath]);
    await service.invoke('run.accept', { id, proposalHash: proposalHash(run) });
    assert.equal(readBookProfile(store).profile.publishing!.channel, 'male');
    assert.deepEqual({ config: store.readAccepted(paths.config).hash, seed: store.readAccepted(paths.seed).hash }, before);
    const author = compileContext(store, store.db.project(), 'S01', '继续讨论', fakeProfile, { purpose: 'discussion', allowConflicts: true });
    assert.ok(author.sources.some(s => s.path === bookProfilePath && s.content.length < 1000));
    const root = store.root; service.close(); await service.invoke('project.open', { root });
    assert.equal((await service.invoke('publishing.read', {})).profile.publishing!.channel, 'male');
    const current = await service.invoke('publishing.read', {}), reopened = service.store!;
    const genreId = await service.invoke('publishing.propose', { profile: { ...current.profile, creativeGenres: ['城市调查'] }, baseHash: current.baseHash, snapshotId: reopened.db.headRef()!.id });
    const genreRun = reopened.db.run(genreId);
    assert.equal(reopened.db.project().config.genre, '都市日常、悬疑调查');
    assert.deepEqual(genreRun.changes.map(c => c.path), [bookProfilePath, paths.config]);
    await service.invoke('run.accept', { id: genreId, proposalHash: proposalHash(genreRun) });
    assert.equal(reopened.db.project().config.genre, '城市调查');
    assert.match(reopened.readAccepted(paths.config).content, /城市调查/);
    await assert.rejects(service.invoke('project.configure', { config: { ...reopened.db.project().config, genre: '另一题材' } }), /题材与发布分类/);
    assert.equal(calls, 0);
  } finally { service.close(); }
});

test('规划开书只选频道和主分类也能保存，旧版标签开书不被新目录改写', async () => {
  const service = new Service(skill, () => {});
  try {
    const created = await service.invoke('project.create', { parent: isolatedRoot('profile-planning'), premise: '', creationInput: { ...emptyTagInput(), bookProfile: profile() } });
    assert.equal(created.project!.creationWorkflow, 2);
    assert.deepEqual(created.tagDraft!.bookProfile, profile());
    assert.equal(created.tagDraft!.publishingCatalog!.id, catalog.id);
    const old = { ...emptyTagInput(), premise: '修理城市', selection: { ...emptyTagInput().selection, reading: { ...emptyTagInput().selection.reading, main: 'reading.main.001' } } };
    const draft = makeCreationSpec(service.store!.db.project(), old, 1, tagBundle(skill).taxonomy);
    assert.equal(draft.bookProfile, undefined); assert.equal(draft.publishingCatalog, undefined);
    assert.deepEqual(compileTags(draft, skill).options.map(o => o.id), ['reading.main.001']);
    const input = { ...emptyTagInput(), premise: '保留作者原来的调查想法', mustKeep: ['保留小镇'], bookProfile: profile() };
    const saved = await service.invoke('creation.saveDraft', { expectedRevision: created.tagDraft!.revision, input });
    assert.equal(service.snapshot().tagDraft!.inputHash, saved.inputHash);
    const state = await service.invoke('publishing.read', {}), store = service.store!;
    const changeId = await service.invoke('publishing.propose', { profile: profile('male'), baseHash: state.baseHash, snapshotId: store.db.headRef()!.id });
    await service.invoke('run.accept', { id: changeId, proposalHash: proposalHash(store.db.run(changeId)) });
    const updated = service.snapshot().tagDraft!;
    assert.equal(updated.bookProfile!.publishing!.channel, 'male');
    assert.ok(updated.revision > saved.revision);
    assert.notEqual(updated.inputHash, saved.inputHash);
    assert.equal(updated.premise, input.premise); assert.deepEqual(updated.mustKeep, input.mustKeep);
    const run = service.makeRun('revision', '继续策划'); service.initializePlanning(run, 'revision', true);
    assert.equal(run.planning!.spec.bookProfile!.publishing!.channel, 'male');
    const nextInput = { ...input, bookProfile: { ...profile('male'), creativeGenres: ['作者正在尝试的题材'] } };
    const pending = await service.invoke('creation.saveDraft', { expectedRevision: updated.revision, input: nextInput });
    assert.equal(service.snapshot().tagDraft!.inputHash, pending.inputHash);
  } finally { service.close(); }
});
