import test from 'node:test';
import assert from 'node:assert/strict';
import { refactorFixture } from './fixtures/refactor';
import { readQuality, mutateQuality, storeLearnedPreferences, voiceDocument, voiceSlice, voicePath, qualityStatistics, blindPresentation, captureCommittedEdit, storePatterns } from '../src/core/quality';
import { parseWorldModel, readWorldModel, renderWorldModel, worldContext } from '../src/core/world-model';
import { checkWorldFields } from '../src/core/validation';
import { hash, paths, prosePath } from '../src/core/domain';
import { compileCreative } from '../src/core/creative-context';
import path from 'node:path';

function edited() {
  const f = refactorFixture(), file = prosePath(1), before = '阿宁𠮷低头，心想他大概已经猜到了答案。', after = '阿宁𠮷低头，把没点燃的火柴折成了两段。';
  f.store.commit([{ path: file, content: before, baseHash: null }], f.project);
  f.store.commit([{ path: file, content: after, baseHash: hash(before) }], f.store.db.project());
  const span = (text: string) => ({ path: file, hash: hash(text), start: 0, end: Array.from(text).length, quote: text });
  const evidence = { before: span(before), after: span(after), scope: { kind: 'character' as const, target: 'a', sceneFunction: '对话' }, domain: 'expression' as const, reason: '此人物用动作掩饰情绪', editor: 'author' as const };
  return { ...f, evidence };
}
test('编辑学习保留对象和场景，撤回证据使已采纳声音停止参与检索', () => {
  const { store, evidence } = edited();
  try {
    let state = mutateQuality(store, 0, { kind: 'evidence', evidence });
    storeLearnedPreferences(store, 'learn-1', [{ statement: '此人在对话中用动作掩饰情绪', scope: evidence.scope, evidenceIds: [state.evidence[0].id], alternatives: ['可能只是此场景需要'], exceptions: ['明确坦白时'], }]);
    state = readQuality(store); assert.equal(state.preferences[0].state, 'proposal');
    store.commit([{ path: voicePath, content: voiceDocument(store, [state.preferences[0].id]), baseHash: null }], store.db.project());
    assert.equal(voiceSlice(store, evidence.scope).length, 1);
    assert.equal(voiceSlice(store, { ...evidence.scope, target: 'b' }).length, 0);
    assert.equal(voiceSlice(store, { ...evidence.scope, sceneFunction: '行动' }).length, 0);
    state = mutateQuality(store, state.revision, { kind: 'retract', id: state.evidence[0].id });
    assert.equal(state.preferences[0].state, 'stale');
    assert.equal(voiceSlice(store, evidence.scope).length, 0);
    assert.match(store.readAccepted(voicePath).content, /此人在对话中用动作掩饰情绪/);
  } finally { store.close(); }
});
test('一次编辑、纠错和未知原因均不能形成全书稳定偏好', () => {
  const { store, evidence } = edited();
  try {
    for (const [i, domain] of ['expression', 'fact_correction', 'unknown'].entries()) {
      const scope = { kind: 'book' as const, target: '', sceneFunction: '对话' };
      const state = mutateQuality(store, readQuality(store).revision, { kind: 'evidence', evidence: { ...evidence, scope, domain, reason: domain === 'unknown' ? '' : evidence.reason } });
      storeLearnedPreferences(store, `run-${i}`, [{ statement: '少用直接心理描写', scope, evidenceIds: [state.evidence.at(-1)!.id], alternatives: [], exceptions: [] }]);
    }
    assert.ok(readQuality(store).preferences.every(p => p.state === 'insufficient_evidence'));
    assert.throws(() => voiceDocument(store, [readQuality(store).preferences[0].id]), /有效证据/);
    assert.throws(() => mutateQuality(store, 0, { kind: 'retract', id: 'x' }), /已更新/);
  } finally { store.close(); }
});
test('修订来源不漂移、无效 Unicode 引文不能成为证据', () => {
  const { store, evidence } = edited();
  try {
    assert.throws(() => mutateQuality(store, 0, { kind: 'evidence', evidence: { ...evidence, after: { ...evidence.after, end: evidence.after.end + 1, quote: '错误' } } }), /不一致/);
    const state = mutateQuality(store, 0, { kind: 'evidence', evidence });
    storeLearnedPreferences(store, 'r', [{ statement: '观察', scope: evidence.scope, evidenceIds: [state.evidence[0].id], alternatives: [], exceptions: [] }]);
    store.commit([{ path: evidence.after.path, content: '后来版本完全改变。', baseHash: evidence.after.hash }], store.db.project());
    assert.equal(readQuality(store).preferences[0].state, 'stale');
    assert.throws(() => compileCreative(store, path.resolve('resources/skill'), { operation: 'learn-edits', evidenceIds: [state.evidence[0].id] }, 'branch'), /失效/);
  } finally { store.close(); }
});
test('自动编辑记录支持删除，默认原因未知且重复回放不增加记录', () => {
  const { store, evidence } = edited();
  try {
    const after = store.putObject('');
    captureCommittedEdit(store, evidence.after.path, evidence.after.hash, after, 'author', 1);
    captureCommittedEdit(store, evidence.after.path, evidence.after.hash, after, 'author', 1);
    const state = readQuality(store);
    assert.equal(state.evidence.length, 1); assert.equal(state.evidence[0].domain, 'unknown'); assert.equal(state.evidence[0].after.quote, '');
  } finally { store.close(); }
});
test('匿名展示隐藏模型绑定，作者、目标读者、模拟意见分开统计并保留平局弃权', () => {
  const { store } = refactorFixture();
  try {
    let state = mutateQuality(store, 0, { kind: 'experiment', experiment: { title: '同场景', kind: 'voice_fixed_story', stage: 'holdout', family: 'family', sceneFunction: '对话', audience: '悬疑读者', variedFactors: ['voice'], constraints: '不得改变事件', questions: ['更喜欢哪篇？'] }, candidates: [{ text: '她把信放下。', runId: '' }, { text: '信落在桌角。', runId: '' }] });
    const experiment = state.experiments[0];
    for (const [i, origin] of ['human_author', 'human_target_reader', 'model_simulation'].entries()) {
      state = mutateQuality(store, state.revision, { kind: 'present', experimentId: experiment.id, participant: `reader-${i}` });
      const p = state.presentations.at(-1)!;
      const blind = blindPresentation(store, p.id);
      assert.deepEqual(Object.keys(blind.candidates[0]).sort(), ['alias', 'hash', 'text']);
      assert.equal(JSON.stringify(blind).includes('provenance'), false);
      const outcome = ['tie', 'abstained', 'preferred'][i];
      state = mutateQuality(store, state.revision, { kind: 'feedback', observation: { presentationId: p.id, origin, outcome, alias: i === 2 ? 'A' : '', reason: '', recruitment: '作者邀请', excluded: '' } });
    }
    let stats = qualityStatistics(store, experiment.id);
    assert.equal(stats.strata[0].ties, 1); assert.equal(stats.strata[1].abstentions, 1); assert.equal(stats.strata[2].comparisons, 1);
    state = mutateQuality(store, state.revision, { kind: 'withdraw', id: state.observations[2].id });
    stats = qualityStatistics(store, experiment.id); assert.equal(stats.strata[2].comparisons, 0); assert.equal(stats.excluded.length, 1);
    assert.throws(() => mutateQuality(store, state.revision, { kind: 'experiment', experiment: { ...experiment, id: undefined, createdAt: undefined, snapshotId: undefined, candidates: undefined, stage: 'development' }, candidates: [{ text: 'x', runId: '' }, { text: 'y', runId: '' }] }));
  } finally { store.close(); }
});
test('旧世界原文与 hash 保留，模块自由停用，自定义体系往返无损', () => {
  const { store, project } = refactorFixture();
  try {
    const original = '# 作者已有体系\n\n只有蒸汽机械，没有境界和魔法。';
    store.commit([{ path: paths.world, content: original, baseHash: null }], project);
    const model = readWorldModel(store);
    model.modules.push({ id: 'custom:steam', title: '蒸汽机械', state: 'enabled', content: '压力不得超过铜管强度', origin: 'inherited', locked: true });
    const content = renderWorldModel(model);
    assert.deepEqual(parseWorldModel(content), model); assert.equal(model.source!.hash, hash(original));
    assert.deepEqual(checkWorldFields(content, paths.world), []); assert.match(worldContext(content), /没有境界/); assert.doesNotMatch(worldContext(content), /暂未确定/);
    assert.throws(() => renderWorldModel({ ...model, original: '篡改' }), /不一致/);
  } finally { store.close(); }
});
test('剧情解法只接受当前正文来源，旧章变化后投影变为待重建', () => {
  const { store, evidence } = edited();
  try {
    storePatterns(store, 'patterns', [{ chapter: 1, scene: '门前', sources: [evidence.after], conflict: '信任', strategy: '等待', response: '沉默', solution: '行动', change: '犹豫', reward: '理解', protectedRepetition: 'echo' }]);
    assert.equal(readQuality(store).patterns[0].protectedRepetition, 'echo');
    store.commit([{ path: evidence.after.path, content: '改写后的场景。', baseHash: evidence.after.hash }], store.db.project());
    assert.equal(readQuality(store).patterns[0].state, 'stale');
    assert.throws(() => storePatterns(store, 'bad', [{ chapter: 1, scene: '门前', sources: [evidence.after], conflict: '信任', strategy: '等待', response: '沉默', solution: '行动', change: '犹豫', reward: '理解', protectedRepetition: 'none' }]), /已变化/);
  } finally { store.close(); }
});
