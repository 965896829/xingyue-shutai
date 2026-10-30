import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStore } from '../src/core/storage';
import { newProject, paths, detailPath, prosePath, updatePath, qualityPath, hash } from '../src/core/domain';
import { initialFiles } from '../src/core/skill';
import { readNarrativeData, saveNarrativeRecord } from '../src/core/narrative-curves';
import { chapterIntensity, tableIntensities, readIntensity, curveSegments, curveContinuation } from '../src/shared/narrative-curve';
import { narrativePlan, sceneEstimate, SceneLocator } from '../src/shared/narrative-playback';
import { commandContracts } from '../src/shared/contracts';
import { playbackPlan, playbackProse } from './fixtures/streaming-content';
import { toolDefinitions } from '../src/core/runner';
import { traceSource } from '../src/core/memory-studio';
import { z } from 'zod';
import type { Run } from '../src/shared/types';

test('story intensity never uses quality scores or unknown/default zero', () => {
  for (const value of ['待评估', '0', '6', '/5', '8/10', '95/100', '未知，可能5']) assert.equal(readIntensity(value), null, value);
  for (const value of ['4', '**4/5**', '强冲突、推进4', '日常（2）', '强度：3/5']) assert.ok(readIntensity(value), value);
  assert.equal(chapterIntensity('- 总分：95/100\n- 节奏可读性：9/10'), undefined);
  assert.equal(chapterIntensity('# 正文\n## 场面1\n- 强度：5'), undefined);
  assert.equal(narrativePlan('- 情节强度：4/10').strength, undefined);
});

test('chapter ranges require explicit individual strengths; no invented flat line', () => {
  const table = '| 章节单元 | 类型与强度曲线 |\n|---|---|\n|001—004|001强冲突、推进5；002强冲突、推进4；003推进、情绪4；004日常、推进2。|\n|005—007|总体缓和，强度3|';
  assert.deepEqual(tableIntensities(table).map(p => p.strength), [5, 4, 4, 2, null, null, null]);
  const actual = tableIntensities(fs.readFileSync('tests/fixtures/death-right-rhythm-041.md', 'utf8'));
  assert.equal(actual[0].strength, 5); assert.equal(actual[3].strength, 2); assert.equal(actual.length, 30);
});

test('missing observations split smooth curves, and interpolation cannot overshoot', () => {
  assert.equal(curveSegments([{ x: 0, y: 2 }, { x: 1, y: null }, { x: 2, y: 5 }]).length, 2);
  assert.equal(curveSegments([{ x: 0, y: null }]).length, 0);
  assert.equal(curveSegments([{ x: 0, y: 2 }, { x: 2, y: 5 }])[0], 'M 0 2 C 1 2, 1 5, 2 5');
});

test('实时单节点向已显示正文延续，后续节点接管；缺失情绪不被补成零或跨缺口连线', () => {
  const one = [{ x: 140, y: 4 }];
  assert.equal(curveContinuation(one, 933), 'M 140 4 L 933 4');
  assert.equal(curveContinuation(one, 1200), 'M 140 4 L 1200 4');
  const next = [...one, { x: 1300, y: 2 }];
  assert.match(curveSegments(next)[0], / C .*1300 2$/);
  assert.equal(curveContinuation(next, 1500), 'M 1300 2 L 1500 2');
  assert.equal(curveContinuation([], 933), undefined);
  assert.equal(curveContinuation([{ x: 140, y: 0 }], 933), 'M 140 0 L 933 0');
  assert.equal(curveContinuation([{ x: 140, y: -2 }, { x: 500, y: null }], 933), undefined);
  for (const cursor of [0, 140, NaN, Infinity]) assert.equal(curveContinuation(one, cursor), undefined);
  assert.equal(curveContinuation([{ x: 140, y: NaN }], 933), undefined);
  assert.equal(curveContinuation([{ x: NaN, y: 2 }], 933), undefined);
});

test('old plans get labelled local estimates and unknown scene content stays unknown', () => {
  const plan = narrativePlan(playbackPlan);
  assert.deepEqual(plan.scenes.map(s => sceneEstimate(s).value), [3, 3, 2, 3]);
  assert.ok(plan.scenes.every(s => sceneEstimate(s).estimated));
  assert.equal(sceneEstimate({ title: '一', action: '甲来到乙处', hook: '', content: '' }).value, null);
  assert.equal(sceneEstimate({ title: '休整', action: '不再追杀。主角清点收获。', hook: '', content: '' }).value, 2);
  assert.equal(sceneEstimate({ title: '一', action: '', hook: '', content: '', strength: 4 }).estimated, false);
});

test('scene locator follows distinctive complete prose paragraphs, not word count', () => {
  const locator = new SceneLocator(narrativePlan(playbackPlan).scenes);
  assert.equal(locator.update('完全不相关的内容。'.repeat(500) + '\n\n').length, 0);
  const matches = locator.update(playbackProse, true);
  assert.deepEqual(matches.map(m => m.scene), [0, 1, 2, 3]);
  for (const match of matches) assert.equal(playbackProse.slice(match.start, match.end), match.quote);
  assert.equal(locator.update('新一轮不同正文。\n\n').length, 0);
});

test('locator never reveals a future scene before its paragraph is displayed; final tail is matched', () => {
  const locator = new SceneLocator(narrativePlan(playbackPlan).scenes);
  for (let i = 0; i <= playbackProse.length; i += 37) {
    const prefix = playbackProse.slice(0, i), points = locator.update(prefix);
    assert.ok(points.every(p => p.end <= prefix.length && prefix.includes(p.quote)));
  }
  assert.equal(locator.update(playbackProse, true).at(-1)?.scene, 3);
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-narrative-')), store = new FileStore(root);
  const project = newProject('曲线隔离验收', root, {}); project.revision = 1;
  store.commit(Object.entries(initialFiles(project, path.resolve('resources/skill'), '测试')).map(([path, content]) => ({ path, content, baseHash: null })), project);
  const write = (file: string, content: string) => { project.revision++; store.commit([{ path: file, content, baseHash: store.db.document(file)?.hash ?? null }], project); };
  return { root, store, project, write };
}

test('curves read accepted plans and aftermath without model calls; quality totals are excluded', () => {
  const f = setup();
  try {
    f.write(paths.outline, '| 章节 | 强度 |\n|---|---|\n|001|4|\n|002|2|\n|004|5|');
    f.write(detailPath(1), playbackPlan);
    f.write(updatePath(1), '- 章节类型与强度：推进，强度3/5');
    f.write(qualityPath(2), '- 总分：99/100\n- 节奏可读性：10/10');
    const result = readNarrativeData(f.store, 1);
    commandContracts['narrative.read'].output.parse(result);
    assert.equal(result.chapters[0].plan, 4); assert.equal(result.chapters[0].actual, 3);
    assert.equal(result.chapters[1].actual, null); assert.equal(result.chapters.find(c => c.chapter === 3), undefined);
    assert.equal(result.detail?.hash, hash(playbackPlan));
  } finally { f.store.close(); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('metadata is optional, bound to exact source hash, and ignores fabricated or unordered anchors', () => {
  const f = setup();
  try {
    f.write(detailPath(1), playbackPlan);
    const run = { id: 'plan', stage: 'S09', chapter: 1, changes: [{ path: detailPath(1), content: playbackPlan, baseHash: null }] } as Run;
    assert.equal(saveNarrativeRecord(f.store, run, { points: [{ label: '不存在', strength: 5, anchor: '不是来源中的句子' }] }), false);
    assert.equal(saveNarrativeRecord(f.store, run, { points: [{ label: '发现故障', strength: 3, anchor: '场面1：发现故障' }, { label: '兑现', strength: 2, anchor: '场面3：兑现回报' }, { label: '倒序', strength: 4, anchor: '场面2：一起抢修' }] }), true);
    assert.equal(readNarrativeData(f.store, 1).plan?.points.length, 2);
    f.write(detailPath(1), playbackPlan + '\n修订细纲');
    assert.equal(readNarrativeData(f.store, 1).plan, undefined);
    const schema = z.fromJSONSchema(toolDefinitions.find(t => t.name === 'propose_changes')!.parameters as any);
    for (const narrative of [null, false, '不合规', { points: [{ strength: 999 }] }]) assert.doesNotThrow(() => schema.parse({ changes: [], narrative }));
  } finally { f.store.close(); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('completed prose metadata survives restart but cannot be applied to another version', () => {
  const f = setup();
  try {
    const content = '# 第1章\n\n他用肩膀顶住即将倒塌的大门。\n\n孩子终于从狭窄的通道爬了出去。';
    const run = { id: 'review', chapter: 1, stage: 'S10', pipeline: { phase: 'review', proseHash: hash(content) }, changes: [{ path: prosePath(1), content, baseHash: null }] } as Run;
    assert.equal(saveNarrativeRecord(f.store, run, { points: [{ label: '顶门', strength: 4, anchor: '他用肩膀顶住即将倒塌的大门。' }, { label: '逃脱', strength: 2, anchor: '孩子终于从狭窄的通道爬了出去。' }] }), true);
    const source = { path: prosePath(1), hash: hash(content), quote: '他用肩膀顶住即将倒塌的大门。' };
    assert.equal(traceSource(f.store, source).content, content);
    assert.throws(() => traceSource(f.store, { ...source, quote: '伪造引文' }), /不属于/);
    f.write(prosePath(1), content);
    assert.equal(readNarrativeData(f.store, 1).actual?.points[1].strength, 2);
    f.store.close(); const reopened = new FileStore(f.root);
    assert.equal(readNarrativeData(reopened, 1).actual?.points.length, 2); reopened.close();
  } finally { try { f.store.close(); } catch {} fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('five-dimension metadata is optional, bounded, version-bound and reused from accepted prose', () => {
  const f = setup();
  try {
    const content = '# 第1章\n\n他用肩膀顶住即将倒塌的大门。\n\n孩子终于从狭窄的通道爬了出去。';
    const run = { id: 'dimensions', chapter: 1, stage: 'S10', pipeline: { phase: 'review', proseHash: hash(content) }, changes: [{ path: prosePath(1), content, baseHash: null }] } as Run;
    assert.equal(saveNarrativeRecord(f.store, run, { chapterValues: { pressure: 4, payoff: 3, emotion: 99, revelation: null, relationship: 2 }, points: [
      { label: '顶门', strength: 4, anchor: '他用肩膀顶住即将倒塌的大门。', values: { pressure: 5, emotion: 4, payoff: -1 } }
    ] }), true);
    f.write(prosePath(1), content);
    const data = readNarrativeData(f.store, 1);
    assert.deepEqual(data.actual?.chapterValues, { pressure: 4, payoff: 3, relationship: 2 });
    assert.deepEqual(data.actual?.points[0].values, { pressure: 5, emotion: 4 });
    assert.deepEqual(data.chapters[0].actualValues, data.actual?.chapterValues);
    assert.equal(data.chapters[0].candidateValues, undefined);
    f.write(prosePath(1), content + '\n\n修订版本。');
    assert.equal(readNarrativeData(f.store, 1).chapters.some(row => row.actualValues), false);
  } finally { f.store.close(); fs.rmSync(f.root, { recursive: true, force: true }); }
});
