import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanningTextFormatter, containsInternalPlanningText } from '../src/shared/planning-language';
import { checkPlanningReportLanguage, checkPlanningContractLanguage, checkPlanningReviewLanguage } from '../src/core/planning-language';
import type { ContractCandidate, PlanningReport, TagPlanning } from '../src/shared/tags';
import { emptyTagInput } from '../src/shared/tags';

function fixture() {
  const coverage = [{ optionId: 'reading.main.003', implementation: '城市设施维修中的异常事件', firstDemonstration: '修复停电故障', risk: '不增加全知能力' }];
  const report: PlanningReport = {
    positioning: '城市异常中的有限判断', diagnosis: [],
    assumptions: [
      { id: 'A_COMMON_URBAN', text: '现代城市正常运行，异常仅有局部边界', critical: true, directionIds: [] },
      { id: 'A_D1_RULE', text: '告示不可靠，约束需要通过记录与试验确认', critical: true, directionIds: ['D1'] },
      { id: 'A_D1_HERO', text: '主角为年轻设施检修员，不具备全知能力', critical: true, directionIds: ['D1'] }
    ],
    directions: ['夜间检修', '合同争议', '群体调查'].map((title, index) => ({
      id: 'D' + (index + 1), title, logline: '检修员面对难以解释的事故', storyEngine: '故障排查与责任选择',
      differenceFromOtherDirections: '信息获取方式不同', openingDecision: '先救人还是记录异常', firstVolumeChange: '建立可靠记录',
      longRunRisk: '避免重复故障', intentChanges: [], tagCoverage: coverage
    })),
    recommendedDirectionId: 'D1', recommendationReasons: ['符合作者前提'], marketClaims: [], unresolvedQuestions: []
  };
  const candidate: ContractCandidate = {
    directionId: 'D1', constraints: [{ id: 'C_LIMIT', optionIds: ['reading.main.003'], text: '主角不具备全知能力', scope: { entityIds: [], fromChapter: null, toChapter: null }, evidenceRef: 'A_D1_RULE' }],
    tagCoverage: coverage, openQuestions: [], premiseDocument: '# 设定拆解\n\n主角是设施检修员。'
  };
  const planning: TagPlanning = {
    spec: { ...emptyTagInput(), projectId: 'fixture', revision: 1, taxonomyVersion: 'fixture', inputHash: '0'.repeat(64), preferences: { targetWords: 3000000, pov: '第三人称', style: '', constraints: '' } },
    knowledge: { version: 'fixture', options: [{ id: 'reading.main.003', label: '都市', group: 'reading.main', conceptId: 'urban', editorialFlags: [], status: 'active' }], genre: null, cards: [], rules: [], recipes: [], candidates: [], coverage: [] },
    binding: 'fixture', promptHashes: {}, phase: 'ready', report, candidate, selectedDirectionId: 'D1',
    resolutions: { A_COMMON_URBAN: '同意', A_D1_RULE: '同意', A_D1_HERO: '同意' }, semanticRevisions: 0, formatRepairs: 0, origin: 'new', history: []
  };
  return { report, candidate, planning };
}

test('旧契约显示把截图中的字段和引用编号解释为中文，保留否定与原记录', () => {
  const { planning } = fixture(), before = JSON.stringify(planning);
  const format = createPlanningTextFormatter(planning);
  const displayed = format('唯一采用D1及作者同意的A_COMMON_URBAN、A_D1_RULE、A_D1_HERO；不引入D2的接受条款机制或D3的群体确认机制。完整保留mustKeep=[]与mustAvoid=[]；本次仅提交S01候选。实体ID未提供。');
  assert.doesNotMatch(displayed, /A_COMMON_URBAN|A_D1_RULE|A_D1_HERO|\bD[123]\b|mustKeep|mustAvoid|S01|实体ID/);
  assert.match(displayed, /方向一「夜间检修」/);
  assert.match(displayed, /告示不可靠，约束需要通过记录与试验确认/);
  assert.match(displayed, /不引入方向二「合同争议」/);
  assert.match(displayed, /必须保留：未填写与不能出现：未填写/);
  assert.match(displayed, /实体编号未提供/);
  assert.equal(JSON.stringify(planning), before);
});

test('正常英文专名、网址和路径保持原样；引用替换不误伤较长编号', () => {
  const { planning } = fixture(), format = createPlanningTextFormatter(planning);
  const value = 'AI、NASA、USB-C与Project Hail Mary；https://example.test/mustKeep/A_D1_RULE；D10不等于D1。';
  const displayed = format(value);
  assert.match(displayed, /^AI、NASA、USB-C与Project Hail Mary；https:\/\/example.test\/mustKeep\/A_D1_RULE；D10/);
  assert.match(displayed, /D10不等于方向一「夜间检修」/);
  assert.equal(format('D:\\drafts\\A_D1_RULE.md'), 'D:\\drafts\\A_D1_RULE.md');
  assert.equal(containsInternalPlanningText('NASA研究AI与USB-C', planning), false);
  assert.equal(containsInternalPlanningText('https://example.test/mustKeep；mustAvoid需要确认', planning), true);
  assert.equal(format('A_UNKNOWN_RULE'), 'A_UNKNOWN_RULE');
  assert.equal(containsInternalPlanningText('采用A_UNKNOWN_RULE', planning), true);
});

test('空作者约定不被翻译成授权，已处理假设不被翻译成同意', () => {
  const format = createPlanningTextFormatter({ resolutions: { A_OLD_RULE: '不同意' } });
  assert.equal(format('mustAvoid=[]不等于作者确认后宫等级。'), '不能出现：未填写不等于作者确认后宫等级。');
  assert.equal(format('A_OLD_RULE'), '已处理假设1');
});

test('新报告的程序字段可保留编号，作者可见说明不能泄漏字段或引用', () => {
  const { planning, report } = fixture();
  assert.doesNotThrow(() => checkPlanningReportLanguage(report, planning));
  report.directions[0].storyEngine = '采用A_D1_RULE';
  assert.throws(() => checkPlanningReportLanguage(report, planning), /作者可见文字含内部字段或引用编号/);
  report.directions[0].storyEngine = '必须保留主角的维修技能';
  report.assumptions[0].text = '保留mustKeep';
  assert.throws(() => checkPlanningReportLanguage(report, planning), /作者可见文字/);
});

test('新契约检查约束和正文，旧书接入不要求改写已接受原稿', () => {
  const { planning, candidate } = fixture();
  assert.doesNotThrow(() => checkPlanningContractLanguage(candidate, planning));
  candidate.openQuestions = ['mustAvoid是否为空？'];
  assert.throws(() => checkPlanningContractLanguage(candidate, planning), /作者可见文字/);
  candidate.openQuestions = [];
  candidate.premiseDocument = '# 旧设定\n保留A_D1_RULE和NASA。';
  assert.throws(() => checkPlanningContractLanguage(candidate, planning), /作者可见文字/);
  assert.doesNotThrow(() => checkPlanningContractLanguage(candidate, { ...planning, origin: 'adoption' }));
});

test('审核定位留在专用字段，解释与修复建议必须可读', () => {
  const { planning } = fixture();
  const issue = { code: 'missing_scope', severity: 'major' as const, jsonPointer: '/constraints/0/scope', explanation: '未明确约束适用的人物', suggestedFix: '补充适用人物及章节范围' };
  assert.doesNotThrow(() => checkPlanningReviewLanguage({ issues: [issue] }, planning));
  assert.throws(() => checkPlanningReviewLanguage({ issues: [{ ...issue, explanation: 'scope中的entityIds为空' }] }, planning), /作者可见文字/);
});

test('局部重做保留其他方向的历史文字，不强迫改写已冻结方向', () => {
  const { planning, report } = fixture();
  report.directions[1].storyEngine = '历史方向引用A_D1_RULE';
  planning.regenerate = { directionId: 'D1', instruction: '完善首卷变化', original: structuredClone(report) };
  assert.doesNotThrow(() => checkPlanningReportLanguage(report, planning));
});
