import test from 'node:test';
import assert from 'node:assert/strict';
import { modularPlanningReportSchema, type TagPlanning, emptyTagInput } from '../src/shared/tags';
import { validateReport } from '../src/core/tags';
import { renderWorldModel, parseWorldModel, worldContext, worldCandidateIssues } from '../src/core/world-model';
import { documentPreviewText } from '../src/shared/run-presentation';
import type { WorldModel } from '../src/shared/quality';
import { refactorFixture } from './fixtures/refactor';
import { paths } from '../src/core/domain';
import { bindDesign, designPrompt } from '../src/core/design-operations';
import path from 'node:path';

const report = () => ({ positioning: '城市调查', assumptions: [{ id: 'a', text: '街区由地方自治组织管理', critical: false, directionIds: ['one'] }],
  directions: ['one', 'two', 'three'].map(id => ({ id, title: `方向${id}`, logline: '调查员从一张旧票据开始追索', storyEngine: '每次追索揭开新的责任关系', differenceFromOtherDirections: '从不同人物的责任与代价展开', openingDecision: '帮助失去证据的邻居', firstVolumeChange: '从旁观者变成承担责任的人', longRunRisk: '让案件后果推动后续行动', intentChanges: [],
    worldSuggestions: [{ moduleId: 'society-factions', state: 'enabled' as const, reason: '调查需要明确组织权责', assumptionIds: id === 'one' ? ['a'] : [] }] })),
  recommendedDirectionId: 'one', recommendationReasons: ['行动边界清楚'] });
test('三个方向一次提交模块建议，冻结方向连同模块和假设不可偷改', () => {
  const input = report(); modularPlanningReportSchema.parse(input);
  const task = { directionFormatVersion: 2, spec: emptyTagInput() } as TagPlanning;
  const original = validateReport(input, task);
  const changed = structuredClone(original); changed.directions[0].worldSuggestions![0].reason = '改变冻结方向';
  const frozen = { ...task, regenerate: { original, directionId: 'two', instruction: '仅修改第二案' } } as TagPlanning;
  assert.throws(() => validateReport(changed, frozen), /保留/);
  const wrong = report(); wrong.directions[1].worldSuggestions[0].assumptionIds = ['a'];
  assert.throws(() => validateReport(wrong, task), /其他方向/);
  const missing = report() as any; delete missing.directions[0].worldSuggestions;
  assert.throws(() => validateReport(missing, task), /worldSuggestions/);
});
function world(): WorldModel {
  return { version: 1, source: null, original: '', modules: [], systems: [{ id: 'dao', title: '山门修行', version: 1, state: 'enabled', subjects: ['林川', '山门'], fromChapter: 1, toChapter: 10,
    original: '炼气、筑基、金丹。金丹仍需契约许可。', unparsed: ['契约例外尚未确定'], locked: true,
    steps: [{ id: 'qi', title: '炼气', ability: '感知灵气', boundary: '不可跨界', prerequisites: [] }, { id: 'foundation', title: '筑基', ability: '承载术法', boundary: '需要契约', prerequisites: ['qi'] }, { id: 'core', title: '金丹', ability: '稳定施法', boundary: '许可范围内', prerequisites: ['foundation'] }], interactions: [] },
    { id: 'guild', title: '工匠资格', version: 1, state: 'enabled', subjects: ['工会'], fromChapter: 11, toChapter: null, original: '学徒与师傅', unparsed: [], locked: false,
      steps: [{ id: 'apprentice', title: '学徒', ability: '检修', boundary: '需监督', prerequisites: [] }], interactions: [{ targetSystemId: 'dao', rule: '职业资格不代表修行境界' }] }] };
}
test('独立成长体系保留原文、路线、主体和时段，不自行换算或新增境界', () => {
  const text = renderWorldModel(world());
  assert.deepEqual(parseWorldModel(text), world());
  assert.match(worldContext(text, 2), /金丹/); assert.doesNotMatch(worldContext(text, 2), /工匠资格/);
  assert.match(worldContext(text, 12), /工匠资格/); assert.doesNotMatch(worldContext(text, 12), /稳定施法/);
  assert.doesNotMatch(text, /元婴|化神/);
  assert.match(documentPreviewText(text), /金丹/); assert.doesNotMatch(documentPreviewText(text), /"system|"steps|sourceHash/);
  const bad = world(); bad.systems![0].steps[0].prerequisites = ['core']; assert.throws(() => renderWorldModel(bad), /循环/);
  const unknown = world(); unknown.systems![1].interactions[0].targetSystemId = 'missing'; assert.throws(() => renderWorldModel(unknown), /不存在/);
});
test('固定体系禁止模型修改，作者解锁产生新版本，因果图只禁止前置环', () => {
  const f = refactorFixture();
  try {
    f.store.commit([{ path: paths.world, content: renderWorldModel(world()), baseHash: null }], f.project);
    const changed = world(); changed.systems![0].steps[0].ability = '新的能力'; changed.systems![0].version++;
    const change = { path: paths.world, content: renderWorldModel(changed), baseHash: f.store.db.document(paths.world)!.hash };
    assert.ok(worldCandidateIssues(f.store, [change], false).some(i => /固定/.test(i.message)));
    changed.systems![0].locked = false;
    assert.deepEqual(worldCandidateIssues(f.store, [{ ...change, content: renderWorldModel(changed) }], true), []);
    const cycle: WorldModel = { version: 1, source: null, original: '', modules: ['custom:a', 'custom:b'].map(id => ({ id, title: id, state: 'enabled', content: '明确规则', origin: 'author', locked: false })),
      links: [{ id: 'ab', from: 'custom:a', to: 'custom:b', kind: 'causes', label: '反馈' }, { id: 'ba', from: 'custom:b', to: 'custom:a', kind: 'causes', label: '回应' }] };
    assert.doesNotThrow(() => renderWorldModel(cycle)); cycle.links!.forEach(l => l.kind = 'requires'); assert.throws(() => renderWorldModel(cycle), /循环/);
  } finally { f.store.close(); }
});

test('新的世界设计操作接通多体系合同，旧版本恢复不增加新合同', () => {
  const f = refactorFixture(), root = path.resolve('resources/skill');
  try {
    f.run.changes = [];
    bindDesign(f.store, root, f.run, { id: 'world-design.create', request: '保留两条独立成长路线', sources: [], targets: [] });
    assert.equal(f.run.worldContract, 2);
    assert.match(designPrompt(f.store, root, f.run), /独立 systems 数组/);
    f.run.worldContract = 1;
    assert.doesNotMatch(designPrompt(f.store, root, f.run), /独立 systems 数组/);
  } finally { f.store.close(); }
});
