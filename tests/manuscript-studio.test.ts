import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Service } from '../src/core/service';
import { hash, paths, prosePath } from '../src/core/domain';
import { profileSchema, factSchema } from '../src/shared/types';
import { readManuscriptView, parseLedger, parseCharacterCards } from '../src/core/manuscript-view';
import { traceSource } from '../src/core/memory-studio';
import { manuscriptDraft } from '../src/shared/manuscript-target';
import { commandContracts } from '../src/shared/contracts';
import { sceneDimension } from '../src/shared/narrative-dimensions';
import { sceneEstimate, narrativePlan } from '../src/shared/narrative-playback';
import { curveSegments } from '../src/shared/narrative-curve';
import { createManuscriptFixture, roleFixture } from './fixtures/manuscript-studio';

async function setup(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-manuscript-test-'));
  let requests = 0;
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => { requests++; throw new Error('No model call allowed'); });
  service.profiles = [{ ...profileSchema.parse({ id: 'fixture', name: 'fixture', model: 'fixture', protocol: 'chat', baseUrl: 'http://127.0.0.1:1', contextLimit: 1000000 }), apiKey: 'test-only' }];
  const fixture = await createManuscriptFixture(service, root);
  t.after(() => { service.close(); if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('wenxu-manuscript-test-')) fs.rmSync(root, { recursive: true, force: true }); });
  return { service, store: service.store!, ...fixture, requests: () => requests };
}

test('empty facts do not hide role Markdown; projection is read-only and contract valid', async t => {
  const f = await setup(t), before = JSON.stringify(f.store.db.head()), runBefore = JSON.stringify(f.store.db.runs());
  assert.equal(f.store.db.facts().length, 0);
  const view = await f.service.invoke('manuscript.read', { runId: f.run.id });
  commandContracts['manuscript.read'].output.parse(view);
  assert.deepEqual(view.characters.map(c => c.name), ['林川', '赵宁']);
  assert.equal(view.characters[0].id, 'CH001');
  assert.deepEqual(view.characters[0].aliases, ['阿川']);
  assert.equal(JSON.stringify(f.store.db.head()), before);
  assert.equal(JSON.stringify(f.store.db.runs()), runBefore);
  assert.equal(f.requests(), 0);
});

test('draft field changes preserve original value and baseline toggle restores accepted roles', async t => {
  const f = await setup(t), view = readManuscriptView(f.store, 1, f.run.id);
  const injury = view.characters[0].fields.find(field => field.label === '伤势')!;
  assert.equal(injury.value, '右手包扎，暂时不能负重'); assert.equal(injury.previous, '右手受伤'); assert.equal(injury.track, 'draft');
  const baseline = readManuscriptView(f.store, 1, f.run.id, false);
  assert.equal(baseline.characters[0].fields.find(field => field.label === '伤势')!.value, '右手受伤');
  assert.ok(baseline.characters.every(c => c.track === 'saved'));
  assert.equal(view.entries.find(e => e.category === 'relation')?.fields.find(f => f.label === '关系')?.previous, '相互试探');
  assert.equal(view.entries.find(e => e.category === 'timeline')?.storyTime, '断水当日清晨');
  assert.ok(view.entries.some(e => e.category === 'promise' && e.kind === 'plan'));
});

test('unaccepted prose is opened from current task and never replaces formal placeholder on read', async t => {
  const f = await setup(t), file = prosePath(1), before = f.store.readAccepted(file).content;
  assert.equal(manuscriptDraft(f.store.db.runs(), f.project, file)?.id, f.run.id);
  assert.equal(manuscriptDraft([{ ...f.run, accepted: true }], f.project, file), undefined);
  assert.equal(manuscriptDraft([{ ...f.run, status: 'stale' }], f.project, file), undefined);
  assert.equal(manuscriptDraft([{ ...f.run, baseRevision: f.project.revision - 1 }], f.project, file), undefined);
  assert.equal(manuscriptDraft(f.store.db.runs(), f.project, paths.roles), undefined);
  assert.equal(f.store.readAccepted(file).content, before);
});

test('draft sources trace exact task-owned Unicode content, reject altered hash and coordinates', async t => {
  const f = await setup(t), content = '# 草稿\n\n𠮷林川抬起左手。', quote = '林川抬起左手。';
  f.run.changes = [{ path: prosePath(1), baseHash: null, content }]; f.store.db.saveRun(f.run);
  const source = { path: prosePath(1), hash: hash(content), quote };
  const result = traceSource(f.store, source);
  assert.equal(Array.from(content).slice(result.start, result.end).join(''), quote);
  assert.throws(() => traceSource(f.store, { ...source, hash: hash('elsewhere') }));
  assert.throws(() => traceSource(f.store, { ...source, start: result.start + 1, end: result.end }));
  assert.throws(() => traceSource(f.store, { ...source, path: '../foreign.md' }));
  const unowned = f.store.putObject('其他作品的内容');
  assert.throws(() => traceSource(f.store, { ...source, hash: unowned, quote: '其他作品' }));
});

test('stale, discarded, incompatible or different-chapter tasks cannot overlay current records', async t => {
  const f = await setup(t);
  for (const patch of [{ status: 'stale' as const }, { status: 'discarded' as const }, { accepted: true }, { chapter: 2 }, { baseRevision: -10, baseSnapshotId: 'missing' }]) {
    const candidate = { ...f.run, id: crypto.randomUUID(), stateVersion: 0, ...patch };
    f.store.db.saveRun(candidate);
    const view = readManuscriptView(f.store, 1, candidate.id);
    assert.equal(view.draftAvailable, false, JSON.stringify(patch));
    assert.equal(view.characters[0].fields.find(field => field.label === '伤势')!.value, '右手受伤');
  }
});

test('pending fact projection respects evidence, chapter, world and withdrawn status', async t => {
  const f = await setup(t), content = f.run.changes[0].content;
  const valid = factSchema.parse({ id: 'draft', subject: '林川', predicate: '动作', value: '检查水泵', kind: 'event', category: 'character', entityIds: ['CH001'], fromChapter: 1, revealedAt: 1,
    evidence: [{ path: f.run.changes[0].path, hash: hash(content), quote: content.slice(0, 10) }] });
  f.run.facts = [valid, { ...valid, id: 'retracted', reviewStatus: 'retracted' }, { ...valid, id: 'future', fromChapter: 2 }, { ...valid, id: 'alternate', worldId: 'alternate' },
    { ...valid, id: 'wrong-offset', evidence: [{ ...valid.evidence[0], start: 20, end: 30 }] }, { ...valid, id: 'disputed', state: 'disputed' }];
  f.store.db.saveRun(f.run);
  assert.deepEqual(readManuscriptView(f.store, 1, f.run.id).entries.filter(e => e.id.startsWith('fact-')).map(e => e.id), ['fact-draft']);
  assert.equal(f.store.db.facts().length, 0);
});

test('table ledgers preserve source quotes, escaped delimiters and injury sections', () => {
  const content = '# 物品\n\n| 名称 | 持有人 | 状态 |\n|---|---|---|\n|钥匙|林川|A\\|B<br>可用|\n\n## 伤势\n\n| 人物 | 伤势 |\n|---|---|\n|林川|右手包扎|';
  const entries = parseLedger({ path: paths.items, hash: hash(content), content, track: 'saved' }, 'item');
  assert.deepEqual(entries.map(e => e.category), ['item', 'injury']);
  assert.equal(entries[0].fields[2].value, 'A|B；可用');
  assert.ok(entries.every(e => content.includes(e.source.quote)));
  const cards = parseCharacterCards({ path: paths.roles, hash: hash(roleFixture), content: roleFixture + '\n<!-- wenxu-facts:v1 -->\n[]', track: 'saved' });
  assert.equal(cards.length, 2);
});

test('all scene fields inform estimates while missing dimensions stay empty and straight paths do not interpolate', () => {
  const scene = narrativePlan('## 场面1：供水\n- 阻碍与代价：倒计时迫近，失格后果不可逆。\n- 行动结果：恢复供水，取得信任。').scenes[0];
  assert.equal(sceneEstimate(scene).value, 4); assert.equal(sceneDimension(scene, 'pressure').value, 4);
  assert.equal(sceneDimension(scene, 'payoff').value, 4); assert.equal(sceneDimension(scene, 'emotion').value, null);
  assert.equal(curveSegments([{ x: 1, y: 2 }, { x: 3, y: 4 }], false)[0], 'M 1 2 L 3 4');
});

test('behavior heading lists and injury prose are displayed without inventing health or numeric state', () => {
  const content = '# 情绪\n\n## 第001章\n\n### 林川\n- 本章情绪：焦急\n- 本章行动：检查水泵\n\n## 第002章\n\n### 林川\n- 本章情绪：放心\n';
  const entries = parseLedger({ path: paths.behavior, hash: hash(content), content, track: 'draft' }, 'behavior');
  assert.deepEqual(entries.map(entry => entry.chapter), ['第001章', '第002章']);
  assert.notEqual(entries[0].id, entries[1].id);
  assert.equal(entries[0].fields[1].value, '检查水泵');
  const injury = '# 物品与伤势\n\n## 伤势\n\n未见明确新增伤势，也不推定全员健康。\n';
  const notes = parseLedger({ path: paths.items, hash: hash(injury), content: injury, track: 'draft' }, 'item');
  assert.equal(notes[0].kind, 'record_note'); assert.equal(notes[0].fields[0].value, '未见明确新增伤势，也不推定全员健康。');
});

test('full replacement role cards cannot silently retain removed characters or fields', async t => {
  const f = await setup(t);
  f.run.changes = [{ path: paths.roles, baseHash: f.store.db.document(paths.roles)!.hash, content: '# 角色卡\n\n## 林川\n- 重要度：主角，稳定标识 CH001\n- 身份：维修工\n' }];
  f.store.db.saveRun(f.run);
  const next = readManuscriptView(f.store, 1, f.run.id);
  assert.deepEqual(next.characters.map(c => c.name), ['林川']);
  assert.equal(next.characters[0].fields.some(f => f.label === '伤势'), false);
  assert.equal(readManuscriptView(f.store, 1, f.run.id, false).characters.length, 2);
});

test('multiple timeline entries in one chapter have unique identities without guessing old-to-new pairing', () => {
  const content = '# 时间线\n\n| 章节 | 故事时间 | 事件 |\n|---|---|---|\n|001|清晨|林川检查水泵|\n|001|傍晚|赵宁分配物资|';
  const entries = parseLedger({ path: paths.timeline, hash: hash(content), content, track: 'saved' }, 'timeline');
  assert.equal(entries.length, 2); assert.equal(new Set(entries.map(entry => entry.id)).size, 2);
  assert.ok(entries.every(entry => /-occ\d+$/.test(entry.id)));
});
