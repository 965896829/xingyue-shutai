import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessTagPolicy,
  tagPolicyProfileSchema,
  tagPolicySourceSchema
} from '../src/shared/tag-policy';
import {
  emptyTagInput,
  type ApprovedTags,
  type PlanningReport,
  type TagCatalog,
  type TagInput,
  type TagKnowledge,
  type TagPlanning
} from '../src/shared/tags';
import {
  compileTags,
  makeCreationSpec,
  selectedIds,
  tagBundle,
  tagHash,
  validateApprovedTags,
  validateReport,
  validateTagInput
} from '../src/core/tags';
import { hash, newProject } from '../src/core/domain';

const tagRoot = path.resolve('resources/skill/tags');
const json = (file: string) => JSON.parse(fs.readFileSync(path.join(tagRoot, file), 'utf8'));
function catalog(): TagCatalog {
  return {
    ...json('registry/taxonomy.json'),
    policy: tagPolicyProfileSchema.parse(json('registry/platform-policy.json')),
    sources: tagPolicySourceSchema.array().parse(json('sources.json'))
  };
}
function input(): TagInput {
  const value = emptyTagInput();
  value.selection.reading = {
    main: 'reading.main.014', theme: ['reading.theme.030'], role: [], plot: ['reading.plot.058']
  };
  value.premise = '灵气枯竭后，主角修复能在灾变中维持聚居地的灵阵';
  return value;
}
function legacyKnowledge(spec: TagInput, cat: TagCatalog): TagKnowledge {
  const options = selectedIds(spec).map(id => cat.options.find(option => option.id === id)!);
  return {
    version: 'a'.repeat(64), options, genre: null, cards: [], rules: [], recipes: [], candidates: [],
    coverage: options.map(option => ({ optionId: option.id, level: 'registry_only' }))
  };
}
function planning(): TagPlanning {
  const cat = catalog();
  const project = newProject('政策回归', 'unused', {});
  const spec = makeCreationSpec(project, input(), 1, cat);
  return {
    binding: 'fixture', promptHashes: {}, spec, knowledge: legacyKnowledge(spec, cat),
    phase: 'planning', resolutions: {}, semanticRevisions: 0, formatRepairs: 0,
    origin: 'new', history: []
  };
}
function reportFor(value: TagPlanning): PlanningReport {
  return {
    positioning: '灾变中的资源与协作', diagnosis: [], assumptions: [],
    directions: [1, 2, 3].map(n => ({
      id: `direction-${n}`, title: `方向${n}`, logline: `灵阵维修师的选择${n}`,
      storyEngine: '灵阵修复、资源分配与人口变化', differenceFromOtherDirections: `协作范围${n}`,
      openingDecision: '先修庇护阵还是救出阵外居民', firstVolumeChange: '建立稳定避难点',
      longRunRisk: '避免重复修复故障', intentChanges: [],
      tagCoverage: selectedIds(value.spec).map(optionId => ({
        optionId, implementation: '通过人物行动与环境后果体现', firstDemonstration: '第一次灵阵故障', risk: '避免空贴标签'
      }))
    })),
    recommendedDirectionId: 'direction-1', recommendationReasons: ['贴合已有创意'],
    marketClaims: [], unresolvedQuestions: []
  };
}
function frozenMetadataFixture() {
  const value = planning(), original = reportFor(value);
  original.assumptions = [
    { id: 'global-cost', text: '使用灵阵必须消耗有限能源', critical: true, directionIds: [] },
    { id: 'kept-cost', text: '第一案主角使用能力会损失寿命', critical: true, directionIds: ['direction-1'] },
    { id: 'other-cost', text: '第二案主角必须维持燃料供应', critical: false, directionIds: ['direction-2'] }
  ];
  original.diagnosis = [
    { code: 'global-risk', severity: 'warning', message: '能力边界需要持续一致', optionIds: [], assumptionIds: [] },
    { code: 'kept-risk', severity: 'warning', message: '寿命代价需要体现在主动选择中', optionIds: [], assumptionIds: ['kept-cost'] },
    { code: 'mixed-risk', severity: 'warning', message: '能力使用需体现资源取舍', optionIds: [], assumptionIds: ['global-cost', 'other-cost'] },
    { code: 'other-risk', severity: 'note', message: '燃料来源可以调整', optionIds: [], assumptionIds: ['other-cost'] }
  ];
  value.regenerate = { directionId: 'direction-1', keepDirectionIds: ['direction-1'], instruction: '只重做另外两案', original };
  return { value, original };
}

// Each integration test owns its temporary resource pack; the repository locks are untouched.
function temporarySkill(t: TestContext, edit?: (taxonomy: TagCatalog) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-tag-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tags = path.join(root, 'tags');
  fs.cpSync(tagRoot, tags, { recursive: true });
  if (edit) {
    const taxonomy = json('registry/taxonomy.json') as TagCatalog;
    edit(taxonomy);
    fs.writeFileSync(path.join(tags, 'registry/taxonomy.json'), JSON.stringify(taxonomy));
  }
  const lock: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== 'resources.lock.json')
        lock[path.relative(tags, full).split(path.sep).join('/')] = hash(fs.readFileSync(full));
    }
  };
  walk(tags);
  fs.writeFileSync(path.join(tags, 'resources.lock.json'), JSON.stringify(lock));
  return root;
}

test('公开阅读数量合规不把用户快照或完整组合认证为官方允许', () => {
  const cat = catalog(), value = input();
  const before = JSON.stringify({ cat, value });
  const assessment = assessTagPolicy(cat, value.selection);
  assert.equal(assessment.status, 'unknown');
  assert.equal(assessment.mode, 'tagged');
  assert.equal(assessment.verifiedAt, '2026-10-19');
  const reading = assessment.checks.filter(check => check.category === 'reading_cardinality');
  assert.equal(reading.length, 4);
  assert.ok(reading.every(check => check.status === 'allowed'));
  assert.ok(reading.every(check => check.sourceIds.includes('FQ-TAGS-20260316') && check.sourceIds.includes('FQ-TAGS-20260824')));
  for (const category of ['content_cardinality', 'option_availability', 'combination_rules'])
    assert.equal(assessment.checks.find(check => check.category === category)?.status, 'unknown');
  assert.equal(JSON.stringify({ cat, value }), before);
  assessment.sources[0].title = '仅修改返回值';
  assert.equal(JSON.stringify({ cat, value }), before);
  assert.deepEqual(validateTagInput(value, cat), value);
  assert.doesNotThrow(() => makeCreationSpec(newProject('待核实也能策划', 'unused', {}), value, 1, cat));
});

test('只有具备证据的阅读数量违例成为 forbidden，内容快照上限不冒充官方规则', () => {
  const cat = catalog(), value = input();
  value.selection.reading.theme = cat.options.filter(option => option.group === 'reading.theme').slice(0, 3).map(option => option.id);
  const overReading = assessTagPolicy(cat, value.selection);
  assert.equal(overReading.status, 'forbidden');
  assert.equal(overReading.checks.find(check => check.groupId === 'reading.theme')?.status, 'forbidden');

  value.selection.reading.theme = [];
  value.selection.content.plot = cat.options.filter(option => option.group === 'content.plot').slice(0, 5).map(option => option.id);
  const overSnapshot = assessTagPolicy(cat, value.selection);
  assert.equal(overSnapshot.status, 'unknown');
  assert.ok(overSnapshot.checks.every(check => check.status !== 'forbidden'));
  value.selection.reading.main = '';
  const missingMain = assessTagPolicy(cat, value.selection);
  assert.equal(missingMain.checks.find(check => check.groupId === 'reading.main')?.status, 'forbidden');
});

test('未知或错分组本地 ID 仍被输入校验拒绝，但不会被宣布为官方禁用标签', () => {
  const cat = catalog();
  for (const id of ['invented.official.id', 'reading.plot.058']) {
    const value = input();
    value.selection.reading.theme = [id];
    const assessment = assessTagPolicy(cat, value.selection);
    assert.equal(assessment.status, 'unknown');
    assert.ok(assessment.checks.some(check => check.category === 'local_selection'));
    assert.ok(assessment.checks.every(check => check.status !== 'forbidden'));
    assert.throws(() => validateTagInput(value, cat), /错分组/);
  }
});

test('规则资料或官方来源缺失时不从客户端阈值推断 allowed', () => {
  const cat = catalog(), value = input();
  cat.sources = cat.sources!.filter(source => source.id !== 'FQ-TAGS-20260824');
  const incomplete = assessTagPolicy(cat, value.selection);
  assert.ok(incomplete.checks.filter(check => check.category === 'reading_cardinality').every(check => check.status === 'unknown'));
  delete cat.policy;
  const absent = assessTagPolicy(cat, value.selection);
  assert.equal(absent.status, 'unknown');
  assert.ok(absent.checks.some(check => check.category === 'profile'));
  assert.doesNotThrow(() => makeCreationSpec(newProject('旧标签库', 'unused', {}), value, 1, cat));
});

test('纯创意不产生主分类必选错误，也不假称已通过平台标签验证', () => {
  const cat = catalog(), value = emptyTagInput();
  value.premise = '玄幻、脑洞与末世融合的创意，暂不映射平台标签';
  const assessment = assessTagPolicy(cat, value.selection);
  assert.equal(assessment.mode, 'creative');
  assert.equal(assessment.status, 'unknown');
  assert.deepEqual(assessment.checks, []);
  const spec = makeCreationSpec(newProject('自由创意', 'unused', {}), value, 1, cat);
  const { inputHash, ...inputWithoutHash } = spec;
  assert.equal(tagHash(inputWithoutHash), inputHash);
  assert.equal(spec.premise, value.premise);
  assert.ok(!Object.hasOwn(spec, 'policy'));
});

test('新知识快照独立记录政策判断，unknown 不阻断编译或改变知识覆盖', t => {
  const root = temporarySkill(t), cat = tagBundle(root).taxonomy;
  const spec = makeCreationSpec(newProject('知识与规则分开', 'unused', {}), input(), 1, cat);
  const original = JSON.stringify(spec);
  const knowledge = compileTags(spec, root);
  assert.equal(knowledge.policy?.status, 'unknown');
  assert.equal(knowledge.policy?.profileVersion, cat.policy?.version);
  assert.equal(knowledge.coverage.length, selectedIds(spec).length);
  assert.ok(knowledge.coverage.every(item => ['genre_draft', 'detailed_draft', 'registry_only'].includes(item.level)));
  assert.equal(JSON.stringify(spec), original);
  const idea = { ...emptyTagInput(), premise: '没有平台标签的原创构想' };
  const ideaKnowledge = compileTags(makeCreationSpec(newProject('创意', 'unused', {}), idea, 1, cat), root);
  assert.equal(ideaKnowledge.policy?.mode, 'creative');
  assert.deepEqual(ideaKnowledge.options, []);
});

test('注册表完整性依照声明数量验证，新增快照选项不要求重编译 482 常量', t => {
  const root = temporarySkill(t, taxonomy => {
    taxonomy.options.push({ ...taxonomy.options.find(option => option.group === 'reading.theme')!, id: 'local.test.theme', label: '测试扩展项' });
    taxonomy.groups.find(group => group.id === 'reading.theme')!.count += 1;
    taxonomy.counts!.reading += 1;
    taxonomy.counts!.total += 1;
  });
  const extended = tagBundle(root).taxonomy;
  assert.equal(extended.options.length, 483);
  assert.ok(extended.options.some(option => option.id === 'reading.main.014' && option.label === '玄幻脑洞'));
});

test('没有 policy 字段的旧已批准契约保持原样并通过哈希验证', () => {
  const value = planning(), report = reportFor(value);
  const approved: ApprovedTags = {
    spec: value.spec,
    knowledge: value.knowledge,
    contract: {
      directionId: 'direction-1',
      constraints: [{ id: 'constraint-1', optionIds: selectedIds(value.spec), text: '按已确认创意落实人物行动',
        scope: { entityIds: [], fromChapter: null, toChapter: null }, evidenceRef: 'direction-1', authorConfirmed: true }],
      tagCoverage: report.directions[0].tagCoverage, openQuestions: [], premiseDocument: value.spec.premise,
      revision: 1, inputHash: value.spec.inputHash, knowledgeVersion: value.knowledge.version,
      approval: { runId: 'legacy-run', proposalHash: 'b'.repeat(64), at: '2026-10-10T00:00:00.000Z', actor: 'local-author' },
      resolutions: {}
    }
  };
  const before = JSON.stringify(approved);
  validateApprovedTags(approved, approved.spec.projectId);
  assert.equal(JSON.stringify(approved), before);
  assert.ok(!Object.hasOwn(approved.knowledge, 'policy'));
});

test('保留一案换两案保护整个方向对象，全部换新仍要求恰好三案', () => {
  const value = planning(), original = reportFor(value), replacement = structuredClone(original);
  value.regenerate = { directionId: '', instruction: '换新', original, keepDirectionIds: ['direction-1'] };
  replacement.directions[1].storyEngine = '迁移聚居地并建立流动防护阵';
  replacement.directions[2].storyEngine = '争取城市之间的灵阵技术协作';
  assert.doesNotThrow(() => validateReport(replacement, value));
  const changedKept = structuredClone(replacement);
  changedKept.directions[0].tagCoverage[0].risk = '改动被保留方向的嵌套字段';
  assert.throws(() => validateReport(changedKept, value), /应保留/);
  value.regenerate.keepDirectionIds = [];
  assert.doesNotThrow(() => validateReport(changedKept, value));
  changedKept.directions.pop();
  assert.throws(() => validateReport(changedKept, value));
  for (const ids of [['missing-direction'], ['direction-1', 'direction-2'], ['direction-1', 'direction-1']]) {
    value.regenerate.keepDirectionIds = ids;
    assert.throws(() => validateReport(original, value), /保留方向列表/);
  }
});

test('旧单案重做仍保护另外两个方向', () => {
  const value = planning(), original = reportFor(value), replacement = structuredClone(original);
  value.regenerate = { directionId: 'direction-2', instruction: '只换第二案', original };
  replacement.directions[1].logline = '新的第二案';
  assert.doesNotThrow(() => validateReport(replacement, value));
  replacement.directions[2].logline = '不应改动的第三案';
  assert.throws(() => validateReport(replacement, value), /应保留/);
});

test('保留一案不能删除或改写其全局和独有假设，也不能挪走冻结关联', () => {
  const { value, original } = frozenMetadataFixture();
  const mutations: ((report: PlanningReport) => void)[] = [
    report => { report.assumptions = []; report.diagnosis = []; },
    report => { report.assumptions[0].text = '使用灵阵不需要能源'; },
    report => { report.assumptions[1].text = '使用能力不损失寿命'; },
    report => { report.assumptions[1].critical = false; },
    report => { report.assumptions[0].directionIds = ['direction-2', 'direction-3']; },
    report => { report.assumptions[1].directionIds = ['direction-2']; },
    report => {
      report.assumptions[1].id = 'renamed-cost';
      report.diagnosis[1].assumptionIds = ['renamed-cost'];
    }
  ];
  const before = JSON.stringify(original);
  for (const mutate of mutations) {
    const report = structuredClone(original);
    mutate(report);
    assert.throws(() => validateReport(report, value), /保留方向/);
  }
  assert.equal(JSON.stringify(original), before);
});

test('新两案可增删自己的假设，原全局假设可收窄到冻结案且保留混合诊断的冻结关联', () => {
  const { value, original } = frozenMetadataFixture();
  const report = structuredClone(original);
  report.assumptions[0].directionIds = ['direction-1'];
  report.assumptions = report.assumptions.filter(assumption => assumption.id !== 'other-cost');
  report.assumptions.push({ id: 'new-cost', text: '新两案依靠不同的协作协议取得资源', critical: true, directionIds: ['direction-2', 'direction-3'] });
  report.diagnosis = report.diagnosis.filter(diagnostic => diagnostic.code !== 'other-risk');
  report.diagnosis.find(diagnostic => diagnostic.code === 'mixed-risk')!.assumptionIds = ['global-cost', 'new-cost'];
  report.diagnosis.push({ code: 'new-risk', severity: 'note', message: '明确新协议的成本', optionIds: [], assumptionIds: ['new-cost'] });
  assert.doesNotThrow(() => validateReport(report, value));
});

test('新假设或旧非冻结假设不能通过改成全局来改变保留案', () => {
  const { value, original } = frozenMetadataFixture();
  for (const directionIds of [[], ['direction-1'], ['direction-1', 'direction-2']]) {
    const report = structuredClone(original);
    report.assumptions.push({ id: 'replacement-cost', text: '新的能力使用条件', critical: false, directionIds });
    assert.throws(() => validateReport(report, value), /影响了保留方向/);
  }
  const expanded = structuredClone(original);
  expanded.assumptions[2].directionIds = [];
  assert.throws(() => validateReport(expanded, value), /影响了保留方向/);
});

test('冻结案相关诊断的内容、级别和关联必须保留', () => {
  const { value, original } = frozenMetadataFixture();
  const mutations: ((report: PlanningReport) => void)[] = [
    report => { report.diagnosis.splice(0, 1); },
    report => { report.diagnosis.splice(1, 1); },
    report => { report.diagnosis[1].message = '寿命代价可以忽略'; },
    report => { report.diagnosis[1].severity = 'note'; },
    report => { report.diagnosis[1].code = 'replaced-risk'; },
    report => { report.diagnosis[1].optionIds = [value.spec.selection.reading.main]; },
    report => { report.diagnosis[1].assumptionIds = ['other-cost']; },
    report => { report.diagnosis[2].assumptionIds = ['other-cost']; }
  ];
  for (const mutate of mutations) {
    const report = structuredClone(original);
    mutate(report);
    assert.throws(() => validateReport(report, value), /保留方向的诊断/);
  }
});

test('全部换新与旧 undefined 单案合同不追溯新增的元数据冻结约束', () => {
  const { value, original } = frozenMetadataFixture();
  const report = structuredClone(original);
  report.assumptions = [{ id: 'new-global', text: '采用全新的能力机制', critical: true, directionIds: [] }];
  report.diagnosis = [];
  value.regenerate!.keepDirectionIds = [];
  assert.doesNotThrow(() => validateReport(report, value));
  delete value.regenerate!.keepDirectionIds;
  value.regenerate!.directionId = 'direction-2';
  assert.doesNotThrow(() => validateReport(report, value));
});
