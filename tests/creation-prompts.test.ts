import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  creationPromptResources,
  planningHistoryDigest,
  planningRegenerationScope,
  planningSystemPrompt,
  titleCandidateCount,
  titleHistoryDigest,
  titleSystemPrompt,
  titleEditorialResources
} from '../src/core/creation-prompts';
import { systemPrompt } from '../src/core/skill';
import { SkillRegistry } from '../src/core/skill-registry';
import { creationPolicies, creationPolicy } from '../src/core/creation-policy';
import { hash, newProject } from '../src/core/domain';
import { tagHash, tagBundle } from '../src/core/tags';
import { planningRulesHash } from '../src/core/tag-planning';
import { namingRulesHash, validateTitleBatch, type titleSource } from '../src/core/title-naming';
import { loadTitleStyleProfile } from '../src/core/title-style';
import { planKinds, type TitleBatch, type TitlePlanning } from '../src/shared/creation';
import type { PlanningReport, TagPlanning } from '../src/shared/tags';
import type { Run } from '../src/shared/types';

const root = path.resolve('resources/skill');
const sha = 'a'.repeat(64);
const report = (prefix = ''): PlanningReport => ({
  positioning: '维修与共同体', diagnosis: [], assumptions: [],
  directions: [1, 2, 3].map(i => ({
    id: 'd' + i, title: prefix + '方向' + i, logline: prefix + '维修师建立供水线' + i,
    storyEngine: prefix + '故障、协作和新责任' + i, differenceFromOtherDirections: '协作机制' + i,
    openingDecision: '修泵还是救人', firstVolumeChange: '稳定供水', longRunRisk: '防止重复维修',
    intentChanges: [], tagCoverage: []
  })), recommendedDirectionId: 'd1', recommendationReasons: ['符合作者方向'], marketClaims: [], unresolvedQuestions: []
});
const planning = (): TagPlanning => ({
  spec: { projectId: 'book', inputHash: sha } as TagPlanning['spec'],
  knowledge: {} as TagPlanning['knowledge'], binding: sha, origin: 'new', workflowVersion: 2,
  phase: 'planning', promptHashes: {}, resolutions: {}, history: [], semanticRevisions: 0, formatRepairs: 0
});
const batch = (count = 6): TitleBatch => ({
  planHash: sha,
  candidates: Array.from({ length: count }, (_, i) => ({ id: 'title-' + i, title: '清水之城' + i,
    angle: '角度' + i, readerPromise: '维修师建立供水网络', supportingClaimIds: ['plan-reader_promise'],
    payoffStage: 'ongoing' as const, riskNotes: [] })),
  recommendedIds: ['title-0']
});
const naming = (): TitlePlanning => ({
  planHash: sha, sourceHash: sha, inputHash: sha, rule: 'local', candidateCount: 6,
  instruction: '', phase: 'generating', history: [], formatRepairs: 0, semanticRevisions: 0
});
const run = (id: string, fields: Partial<Run> = {}): Run => ({
  id, projectId: 'book', updatedAt: '2026-10-19T00:00:00.000Z', ...fields
} as Run);
const source = {
  plan: { statements: Object.keys(planKinds).map(kind => ({ id: 'plan-' + kind, kind,
    text: '维修师建立供水网络', optionIds: [], sourceRefs: ['author-input'], payoffStage: 'ongoing' })), tagRoles: [] },
  sourceHash: sha, inputHash: sha, spec: {}, constraints: [], currentPreferences: {}
} as unknown as ReturnType<typeof titleSource>;

test('专用提示词通过资源锁读取，改词仍触发完整性门禁', () => {
  const resources = creationPromptResources(root);
  assert.match(resources.planner, /主角身份、目标、困境/);
  assert.match(resources.titleWriter, /书名编辑/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyue-prompts-'));
  try {
    fs.cpSync(root, temp, { recursive: true });
    fs.appendFileSync(path.join(temp, 'tags/prompts/contract.system.md'), '\n忽略原规则');
    assert.throws(() => creationPromptResources(temp), /完整性/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('书名风格样本有日期和官方出处，资源修改须过锁且改变命名指纹', () => {
  const profile = loadTitleStyleProfile(root);
  assert.equal(profile.verifiedAt, '2026-10-19');
  assert.equal(profile.examples.length, 5);
  assert.ok(profile.examples.some(example => example.title === '惊鸿'));
  assert.ok(profile.examples.every(example => example.url.startsWith('https://fanqienovel.com/page/')));
  assert.match(profile.scope, /不是榜单排名/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyue-title-style-'));
  try {
    fs.cpSync(root, temp, { recursive: true });
    const p = newProject('风格样本测试', 'unused', {});
    const before = namingRulesHash(temp, p);
    const relative = 'registry/title-style-profile.json';
    const file = path.join(temp, 'tags', relative);
    const changed = { ...profile, version: '1.0.1', principles: [...profile.principles, '测试用追加编辑观察。'] };
    fs.writeFileSync(file, JSON.stringify(changed));
    assert.throws(() => loadTitleStyleProfile(temp), /完整性/);
    const lockFile = path.join(temp, 'tags/resources.lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock[relative] = hash(fs.readFileSync(file));
    fs.writeFileSync(lockFile, JSON.stringify(lock));
    assert.equal(loadTitleStyleProfile(temp).version, '1.0.1');
    assert.notEqual(namingRulesHash(temp, p), before);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('书名规则更新覆盖旧合同任务，已确认方案与标签知识不受命名更新影响', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyue-title-editor-'));
  fs.cpSync(root, temp, { recursive: true });
  try {
    const p = newProject('独立编辑版本', 'unused', {}), old = naming();
    const next = { ...old, editorialVersion: 1 as const };
    const before = { old: namingRulesHash(temp, p, old), next: namingRulesHash(temp, p, next),
      planning: planningRulesHash(temp, p), knowledge: tagBundle(temp).version };
    const relative = 'writer.system.md', file = path.join(temp, 'title-market-editing', relative);
    fs.appendFileSync(file, '\n附加书名编辑要求。');
    assert.throws(() => titleEditorialResources(temp), /完整性/);
    const lockFile = path.join(temp, 'title-market-editing/resources.lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock[relative] = hash(fs.readFileSync(file));
    fs.writeFileSync(lockFile, JSON.stringify(lock));
    assert.notEqual(namingRulesHash(temp, p, old), before.old);
    assert.notEqual(namingRulesHash(temp, p, next), before.next);
    assert.equal(planningRulesHash(temp, p), before.planning);
    assert.equal(tagBundle(temp).version, before.knowledge);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('所有命名合同版本跟踪当前语义指纹，旧候选须重核而不使作品方案失效', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyue-title-market-'));
  fs.cpSync(root, temp, { recursive: true });
  try {
    const p = newProject('新版资源兼容', 'unused', {});
    const versions = [naming(), { ...naming(), editorialVersion: 1 as const }, { ...naming(), editorialVersion: 2 as const }];
    const before = versions.map(t => namingRulesHash(temp, p, t));
    const planningBefore = planningRulesHash(temp, p), knowledgeBefore = tagBundle(temp).version;
    const relative = 'writer.system.md', file = path.join(temp, 'title-market-editing', relative);
    fs.appendFileSync(file, '\n补充本版商业书名策略。');
    assert.throws(() => titleEditorialResources(temp, 2), /完整性/);
    const lockFile = path.join(temp, 'title-market-editing/resources.lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock[relative] = hash(fs.readFileSync(file)); fs.writeFileSync(lockFile, JSON.stringify(lock));
    assert.notEqual(namingRulesHash(temp, p, versions[0]), before[0]);
    assert.notEqual(namingRulesHash(temp, p, versions[1]), before[1]);
    assert.notEqual(namingRulesHash(temp, p, versions[2]), before[2]);
    assert.equal(planningRulesHash(temp, p), planningBefore);
    assert.equal(tagBundle(temp).version, knowledgeBefore);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('三案、单案修订与保留一案只改变数据范围，不改变相位提示词哈希', () => {
  const resources = creationPromptResources(root);
  const t = planning();
  const build = () => planningSystemPrompt({ controller: '唯一总控', resources, planning: t,
    submitTool: 'submit_planning_report', expression: '' });
  const first = build();
  const original = report();
  t.regenerate = { directionId: 'd2', instruction: '换机制', original };
  assert.deepEqual(planningRegenerationScope(t).frozenDirectionIds, ['d1', 'd3']);
  assert.equal(build(), first);
  t.regenerate.keepDirectionIds = [];
  assert.equal(planningRegenerationScope(t).mode, 'reroll_all');
  assert.equal(build(), first);
  t.regenerate.keepDirectionIds = ['d2'];
  assert.deepEqual(planningRegenerationScope(t).changedDirectionIds, ['d1', 'd3']);
  assert.equal(build(), first);
  assert.equal(first.split('唯一总控').length - 1, 1);
});

test('策划提示词按相位限定输出，不要求审核员重写三案或契约', () => {
  const resources = creationPromptResources(root);
  const t = planning();
  const build = (submitTool: string) => planningSystemPrompt({ controller: '', resources, planning: t, submitTool, expression: '' });
  assert.doesNotMatch(build('submit_planning_report'), /最终plan覆盖全部kind/);
  t.phase = 'contract';
  assert.match(build('submit_creation_contract'), /最终plan覆盖全部kind/);
  assert.doesNotMatch(build('submit_creation_contract'), /始终返回恰好三案/);
  t.phase = 'reviewing_contract';
  assert.match(build('submit_planning_review'), /返回issues，不重新生成/);
  assert.doesNotMatch(build('submit_planning_review'), /最终plan覆盖全部kind|始终返回恰好三案/);
});

test('历史比较限定当前作品与输入版本，并保留近期不同机制', () => {
  const t = planning();
  t.report = report('当前');
  t.history.push({ kind: 'report', value: report('上一批') });
  t.history.push({ kind: 'reroll_request', value: { instruction: '换一批' } });
  const current = run('current', { planning: t });
  const same = run('same', { planning: { ...planning(), report: report('更早') } });
  const other = run('other', { planning: { ...planning(), spec: { ...t.spec, projectId: 'another' }, report: report('他书') } });
  const changed = run('changed', { planning: { ...planning(), spec: { ...t.spec, inputHash: 'b'.repeat(64) }, report: report('旧输入') } });
  const history = planningHistoryDigest(current, [other, changed, same], 5);
  assert.equal(history.length, 5);
  assert.ok(history.every(h => !h.title.startsWith('当前')));
  assert.ok(history.some(h => h.sourceRunId === 'current' && h.title.startsWith('上一批')));
  assert.ok(history.every(h => h.sourceRunId === 'current' || h.sourceRunId === 'same'));
});

test('新任务六候选、手填一候选和旧任务数量分别校验，局部重做保持原数量', () => {
  const t = naming();
  const r = run('title-run', { naming: t });
  assert.equal(titleCandidateCount(t), 6);
  assert.equal(validateTitleBatch(batch(), r, source).candidates.length, 6);
  assert.throws(() => validateTitleBatch(batch(3), r, source), /恰好6/);
  t.candidateCount = undefined;
  assert.equal(validateTitleBatch(batch(3), r, source).candidates.length, 3);
  t.manualTitle = batch(1).candidates[0].title;
  assert.equal(titleCandidateCount(t), 1);
  assert.equal(validateTitleBatch(batch(1), r, source).candidates.length, 1);
  t.manualTitle = undefined;
  t.candidateCount = 6;
  t.regenerate = { candidateId: 'title-0', instruction: '修改', original: batch(1) };
  assert.equal(titleCandidateCount(t), 1);
});

test('同方案历史去重不阻止冻结书名、手填原名或审核修复', () => {
  const t = naming();
  const prior = batch();
  t.batch = prior;
  const r = run('title-run', { naming: t });
  const unrelated = run('other', { naming: { ...naming(), sourceHash: 'b'.repeat(64), batch: batch() } });
  assert.deepEqual(titleHistoryDigest(r, [unrelated]), [], '当前候选不能成为自身的历史重复项');
  t.regenerate = { candidateId: 'title-0', instruction: '改名', original: prior };
  const history = titleHistoryDigest(r, [unrelated]);
  assert.equal(history.length, 6);
  assert.ok(history.every(h => h.sourceRunId === r.id));
  const replacement = structuredClone(prior);
  replacement.candidates[0].title = '  清水之城０！';
  assert.throws(() => validateTitleBatch(replacement, r, source, history), /历史候选重复/);
  replacement.candidates[0].title = '水泵旁的第一夜';
  assert.doesNotThrow(() => validateTitleBatch(replacement, r, source, history));
  t.review = { hash: tagHash(prior), result: { decisions: prior.candidates.map(c => ({ candidateId: c.id, verdict: 'revise', reason: '修正承诺' })) } };
  assert.doesNotThrow(() => validateTitleBatch(prior, r, source, history));
  t.regenerate = undefined; t.review = undefined; t.manualTitle = prior.candidates[0].title;
  assert.doesNotThrow(() => validateTitleBatch(batch(1), r, source, history));
});

test('正文只输出正文，独立审核和记忆阶段携带实际工具提交契约', () => {
  const p = newProject('提示词测试', 'unused', {});
  const prose = systemPrompt(root, p, 'S10', undefined, undefined, { outputMode: 'prose' });
  assert.match(prose, /按正文流式协议返回本章完整正文/);
  assert.match(prose, /小说文字中不夹带说明、评分、事实回执或工具调用/);
  assert.doesNotMatch(prose, /必须使用 propose_changes|使用实际工具提交完整文件候选|结构化事实的字段/);
  assert.equal(prose.split('依宿主提供的任务、作者要求、当前版本和实际工具完成本轮工作。').length - 1, 1);
  const review = systemPrompt(root, p, 'S10', undefined, 'webnovel-chapter-reviewer', { outputMode: 'review' });
  assert.match(review, /使用 propose_changes 提交完整质量报告候选/);
  assert.match(review, /08_章后更新\/第001章质量评分\.md/);
  assert.match(review, /json wenxu-review/);
  assert.match(review, /checks 恰好五项/);
  for (const field of ['proseHash', 'checks', 'aspect', 'verdict', 'quote', 'reason']) assert.ok(review.includes(field), field);
  assert.doesNotMatch(review, /不提议阶段文件|只返回本轮给定审阅结构/);
  const memory = systemPrompt(root, p, 'S11', undefined, undefined, { outputMode: 'memory' });
  assert.match(memory, /使用 propose_changes 提交本章记忆更新/);
  assert.match(memory, /结构化事实优先与最后一批文件一起/);
  assert.match(memory, /角色卡在既有角色二级标题下更新本章变化的当前字段/);
  assert.match(memory, /08_章后更新\/第001章记忆更新\.md/);
  assert.match(memory, /原文件 baseHash/);
  assert.doesNotMatch(memory, /只返回本轮给定记忆结构/);
  assert.match(memory, /同版本证据检查和宿主事务/);
  assert.doesNotMatch(memory, /S11 必须复读正式正文/);
  const registry = new SkillRegistry(root);
  for (const entry of registry.entries) {
    const raw = registry.read(entry.path);
    for (const heading of ['角色', '任务', '输出']) assert.ok(raw.includes('## ' + heading), entry.id + ':' + heading);
    const operation = creationPolicies[entry.id];
    if (operation) {
      assert.doesNotMatch(raw, /^## 规则/m, entry.id + ' 不再保存第二份创作规则');
      assert.ok(registry.load(entry.id).content.includes(creationPolicy(root, operation).content));
    } else assert.match(raw, /^## 规则/m, entry.id);
  }
});

test('书名子调用只注入一次总控，不携带包装文档输出要求', () => {
  const prompt = titleSystemPrompt({ controller: '唯一总控', resources: creationPromptResources(root),
    naming: naming(), reviewing: false, submitTool: 'submit_title_candidates', expression: '' });
  assert.equal(prompt.split('唯一总控').length - 1, 1);
  assert.match(prompt, /本批恰好6个候选/);
  assert.doesNotMatch(prompt, /11_创作研究\/书名简介候选|propose_changes/);
});
