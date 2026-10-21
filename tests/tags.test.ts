import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Service } from '../src/core/service';
import {
  profileSchema,
  stageIds,
  factSchema,
  type ModelResult,
  type SecretProfile
} from '../src/shared/types';
import type { TagInput, TagPlanning, PlanningReport } from '../src/shared/tags';
import {
  tagBundle,
  makeBookSpec,
  compileTags,
  validateReport,
  validateContract,
  validatePlanningReview,
  planningBinding,
  tagHash,
  tagContext,
  contractPath
} from '../src/core/tags';
import { paths, newProject, prosePath, stageOutputs, qualityPath, hash } from '../src/core/domain';
import { assembleContext, validateEvidence } from '../src/core/memory';
import { RequestError } from '../src/core/provider';
import { systemPrompt } from '../src/core/skill';
import { createBackup, restoreBackup } from '../src/core/documents';
import { fixture } from './fixtures/workflow';
import type { Caller } from '../src/core/runner';
import { emptyTagInput } from '../src/shared/tags';
import { approvedCreation, planKinds, type CreationPlan } from '../src/shared/creation';
import { validateTitleBatch, titleSource, titlePath, namingBinding } from '../src/core/title-naming';
import { loadTitleStyleProfile } from '../src/core/title-style';
import { titleStyleProfileSchema, type TitleStyleProfile } from '../src/shared/title-style';
import { creationDirectionId, runHasCurrentBasis } from '../src/shared/run-presentation';
const skill = path.resolve('resources/skill');
const input: TagInput = {
  selection: {
    reading: { main: 'reading.main.003', theme: [], role: [], plot: ['reading.plot.078'] },
    content: { plot: [], emotion: [], persona: [], world: [] }
  },
  premise: '维修师建立供水网络',
  mustKeep: ['主角是维修师'],
  mustAvoid: ['禁止后宫']
};
const model: SecretProfile = {
  ...profileSchema.parse({
    id: 'tags-test',
    name: 'fixture',
    model: 'fixture',
    protocol: 'chat',
    baseUrl: 'http://127.0.0.1:1',
    contextLimit: 1000000,
    inputPrice: 1,
    outputPrice: 1
  }),
  apiKey: 'fixture-only'
};
function makePlanning(): TagPlanning {
  const p = newProject('测试', 'unused', {}),
    spec = makeBookSpec(p, input, 1, tagBundle(skill).taxonomy);
  return {
    binding: 'fixture',
    promptHashes: {},
    spec,
    knowledge: compileTags(spec, skill),
    phase: 'planning',
    resolutions: {},
    semanticRevisions: 0,
    formatRepairs: 0,
    origin: 'new',
    history: []
  };
}
function reportFor(t: TagPlanning): PlanningReport {
  return {
    positioning: '有限资源与协作',
    diagnosis: [],
    assumptions: [{ id: 'space', text: '储物空间不能复制物品', critical: true, directionIds: [] }],
    directions: [1, 2, 3].map((n) => ({
      id: 'direction-' + n,
      title: '方案' + n,
      logline: '维修师选择不同的协作方式',
      storyEngine: '故障、协作、维修与新责任',
      differenceFromOtherDirections: '组织规模' + n,
      openingDecision: '修水泵还是先救人',
      firstVolumeChange: '稳定供水',
      longRunRisk: '避免重复维修',
      intentChanges: [],
      tagCoverage: t.knowledge.options.map((o) => ({
        optionId: o.id,
        implementation: '方向' + n + '中的实现',
        firstDemonstration: '开篇行动',
        risk: '不得临时加能力'
      }))
    })),
    recommendedDirectionId: 'direction-1',
    recommendationReasons: ['贴合作者前提'],
    marketClaims: [],
    unresolvedQuestions: []
  };
}
function result(name: string, value: unknown): ModelResult {
  return {
    text: '',
    calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(value) }],
    native: {},
    usage: { input: 10, output: 10, cost: 0.00002, currency: 'USD' },
    stop: 'tools'
  };
}
const plainResult = (value: unknown): ModelResult => ({ text: JSON.stringify(value), calls: [], native: {},
  usage: { input: 10, output: 10, cost: 0, currency: 'USD' }, stop: 'complete' });
function planFor(t: TagPlanning): CreationPlan {
  return {
    statements: Object.keys(planKinds).map((kind, index) => ({
      id: 'plan-' + kind, kind: kind as keyof typeof planKinds,
      text: ['维修师通过修复供水网络建立聚居地', '缺水推动维修与协作，稳定供水带来人口与维护责任', '维修师主动选择先修水泵再组织协作', '先让居民喝上清洁水', '逐步建成稳定的聚居地',
        '依靠维修技术，受零件、时间与协作条件限制', '发现故障、组织维修、恢复供水，再处理新增人口的需求', '从修泵转向供给分配、组织与防御', '开篇用有限零件修复一台水泵', '禁止后宫，不增加系统或无限资源'][index],
      optionIds: [], sourceRefs: [t.selectedDirectionId!],
      payoffStage: kind === 'long_term_goal' ? 'long_term' as const : kind === 'opening' ? 'opening' as const : 'ongoing' as const
    })),
    tagRoles: t.knowledge.options.map(o => ({ optionId: o.id, roles: ['action' as const], implementation: '通过维修与协作落实这个元素', claimIds: ['plan-fusion_causality'] }))
  };
}
async function setup(overrides?: {
  caller?: (standard: Caller) => Caller;
  legacy?: boolean;
  untitled?: boolean;
  config?: Record<string, unknown>;
  unified?: boolean;
  idea?: boolean;
}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-tags-'));
  let service: Service;
  const standard: Caller = async (_profile, _system, _messages, tools) => {
    const r = service.store!.db.runs().find((r) => (r.planning || r.naming) && !r.accepted && r.status === 'running')!;
    const t = r.planning!,
      name = tools[0].name;
    if (name === 'submit_title_candidates') {
      const naming = r.naming!;
      const source = titleSource(service.store!, naming.sourceRunId);
      return result(name, { planHash: naming.planHash,
        candidates: naming.manualTitle ? [{ id: 'manual', title: naming.manualTitle, angle: '作者命名', readerPromise: '维修供水与家园建设', supportingClaimIds: [source.plan.statements[0].id], payoffStage: 'ongoing', riskNotes: [] }]
          : Array.from({ length: naming.candidateCount ?? 3 }, (_, i) => i + 1).map((n) => ({ id: 'title-' + n, title: ['水泵旁的聚居地', '从一口清水开始', '维修师的家园', '水源线上的盟约', '缺水城的维修师', '一台水泵之后'][n - 1], angle: ['家园建设', '成长起点', '主角职业', '协作关系', '生存处境', '阶段变化'][n - 1],
            readerPromise: '维修供水与家园建设', supportingClaimIds: [source.plan.statements[0].id], payoffStage: 'ongoing', riskNotes: [] })),
        recommendedIds: naming.manualTitle ? ['manual'] : ['title-1', 'title-2', 'title-3'] });
    }
    if (name === 'submit_title_review') return result(name, { decisions: r.naming!.batch!.candidates.map(c => ({ candidateId: c.id, verdict: 'keep', reason: '承诺有方案依据，没有新增设定' })) });
    if (name === 'submit_planning_report') return result(name, reportFor(t));
    if (name === 'submit_planning_review') return result(name, { issues: [] });
    if (name === 'submit_creation_contract')
      return result(name, {
        directionId: t.selectedDirectionId,
        constraints: (t.knowledge.options.length ? t.knowledge.options : [{ id: '' }]).map((o) => ({
          id: 'c-' + o.id,
          optionIds: o.id ? [o.id] : [],
          text: '有限资源且禁止后宫',
          scope: { entityIds: [], fromChapter: null, toChapter: null },
          evidenceRef: t.selectedDirectionId
        })),
        tagCoverage: t.report!.directions.find((d) => d.id === t.selectedDirectionId)!.tagCoverage,
        openQuestions: [],
        ...(t.workflowVersion === 2 ? { plan: planFor(t) } : {}),
        premiseDocument:
          t.origin === 'new'
            ? fixture(service.store!.db.project(), paths.seed, service)
            : service.store!.readAccepted(paths.seed).content
      });
    throw new Error('unexpected model request ' + name);
  };
  service = new Service(skill, () => {}, overrides?.caller?.(standard) ?? standard);
  service.profiles = [structuredClone(model)];
  await service.invoke('project.create', {
    parent,
    ...(overrides?.untitled || overrides?.unified ? {} : { title: '标签测试' }),
    premise: '测试',
    ...(overrides?.unified ? { creationInput: overrides.idea ? { ...emptyTagInput(), premise: input.premise, mustKeep: input.mustKeep, mustAvoid: input.mustAvoid } : input } : overrides?.legacy ? {} : { tagInput: input }),
    config: { defaultProfileId: model.id, expressionRules: { enabled: false }, ...overrides?.config }
  });
  return { service, parent };
}
async function settled(s: Service) {
  for (let n = 0; s.runner?.controller; n++) {
    if (n > 1500) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function start(s: Service, key: string = crypto.randomUUID()) {
  const id = await s.invoke('tags.start', {
    inputHash: s.snapshot().tagDraft!.inputHash,
    profileId: model.id,
    requestId: key
  });
  await settled(s);
  return s.store!.db.run(id);
}
async function select(s: Service, id: string, directionId = 'direction-2') {
  const r = s.store!.db.run(id);
  await s.invoke('tags.selectDirection', {
    id,
    reportHash: r.planning!.reportHash,
    directionId,
    resolutions: { space: '同意有限储物，不可复制' }
  });
  await settled(s);
  return s.store!.db.run(id);
}

async function confirmPlan(s: Service, run: ReturnType<Service['makeRun']>) {
  await s.invoke('creation.confirmPlan', { id: run.id, proposalHash: s.store!.db.run(run.id).proposalHash!, warningReason: '审阅合成方案，验证业务约束' });
  return s.store!.db.run(run.id);
}
async function namePlan(s: Service, sourceRunId?: string, manualTitle?: string) {
  const source = titleSource(s.store!, sourceRunId);
  const id = await s.invoke('titles.start', { sourceRunId, planHash: tagHash(source.plan), profileId: model.id, requestId: crypto.randomUUID(), ...(manualTitle ? { manualTitle } : {}) });
  await settled(s);
  return s.store!.db.run(id);
}
async function chooseTitle(s: Service, run: ReturnType<Service['makeRun']>, candidateId?: string) {
  const t = s.store!.db.run(run.id).naming!;
  return s.invoke('titles.select', { id: run.id, batchHash: t.review!.hash, candidateId: candidateId ?? t.batch!.candidates[0].id });
}

test('开书一般审核建议保留在审查记录，确认方案和最终采纳无需填写豁免理由', async () => {
  const { service } = await setup({ unified: true, caller: standard => async (...args) =>
    args[3][0].name === 'submit_planning_review' ? result('submit_planning_review', { issues: [{
      code: 'detail', severity: 'minor', jsonPointer: '', explanation: '可以在单章设计中进一步细化维修代价', suggestedFix: '后续安排具体的材料取舍'
    }] }) : standard(...args) });
  try {
    let run = await start(service);
    run = await select(service, run.id);
    assert.equal(run.status, 'awaiting_review', run.error ?? '');
    assert.equal(run.planning!.contractReview!.result.issues[0].severity, 'minor');
    assert.deepEqual(run.issues, []);
    await service.invoke('creation.confirmPlan', { id: run.id, proposalHash: run.proposalHash! });
    const naming = await namePlan(service, run.id);
    await chooseTitle(service, naming);
    run = service.store!.db.run(run.id);
    await service.invoke('run.accept', { id: run.id, proposalHash: run.proposalHash!, startNext: false });
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.db.run(run.id).planning!.contractReview!.result.issues.length, 1);
  } finally { await service.drain(); }
});

test('开书策划及独立命名之间调整轮数，已审核方案和书名仍可采纳并保留新上限', async () => {
  const { service } = await setup({ unified: true });
  try {
    let run = await start(service);
    const oldReportHash = run.planning!.reportHash;
    await service.invoke('project.configure', { config: { ...service.store!.db.project().config, maxRounds: 30 } });
    run = await select(service, run.id);
    assert.equal(run.planning!.reportHash, oldReportHash);
    assert.equal(run.status, 'awaiting_review', run.error ?? '');
    run = await confirmPlan(service, run);
    const naming = await namePlan(service, run.id);
    const review = structuredClone(naming.naming!.review);
    await service.invoke('project.configure', { config: { ...service.store!.db.project().config, maxRounds: 40 } });
    await chooseTitle(service, naming);
    assert.deepEqual(service.store!.db.run(naming.id).naming!.review, review);
    run = service.store!.db.run(run.id);
    await service.invoke('run.accept', { id: run.id, proposalHash: run.proposalHash });
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.db.project().config.maxRounds, 40);
    assert.match(service.store!.readAccepted(paths.config).content, /"maxRounds": 40/);
  } finally { await service.drain(); }
});

test('预算变更后交接已确认方案和命名任务，保留选择与关联而不重抽或再次批准方案', async () => {
  let calls = 0;
  const { service } = await setup({ unified: true, caller: standard => async (...args) => { calls++; return standard(...args); } });
  try {
    const plan = await confirmPlan(service, await select(service, (await start(service)).id));
    const naming = await namePlan(service, plan.id);
    await chooseTitle(service, naming);
    const chosen = service.store!.db.run(plan.id);
    await service.invoke('project.configure', { config: { ...service.store!.db.project().config, maxRounds: 42 } });
    for (const original of [chosen, naming]) {
      const visible = service.snapshot().runs.find(run => run.id === original.id)!;
      assert.equal(runHasCurrentBasis(visible, service.store!.db.project()), true);
    }
    const before = calls;
    const changed = { ...structuredClone(model), id: 'compatible-handoff', model: 'alternate-writer' };
    service.profiles.push(changed);
    const nextId = await service.invoke('run.handoff', { id: chosen.id, profileId: changed.id });
    await settled(service);
    let next = service.store!.db.run(nextId);
    assert.equal(next.status, 'awaiting_review', next.error ?? '');
    assert.deepEqual(next.planning!.planApproval, chosen.planning!.planApproval);
    assert.deepEqual(next.planning!.titleSelection, chosen.planning!.titleSelection);
    assert.equal(service.store!.db.run(naming.id).naming!.sourceRunId, next.id);
    const titleId = await service.invoke('run.handoff', { id: naming.id, profileId: changed.id });
    await settled(service);
    next = service.store!.db.run(nextId);
    assert.equal(next.planning!.titleSelection!.batchRunId, titleId);
    assert.equal(calls, before, '模型切换只接续已有完整结果，不重新策划或命名');
    assert.equal(service.store!.db.project().stage, 'S01');
    await service.invoke('run.accept', { id: next.id, proposalHash: next.proposalHash });
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.db.project().config.maxRounds, 42);
    assert.equal(service.store!.db.project().title, chosen.planning!.titleSelection!.candidate.title);
  } finally { await service.drain(); }
});

for (const idea of [true, false]) test(`统一${idea ? '创意' : '标签'}开书：确认方案后独立命名，统一采纳仅推进一次且全阶段携带方案`, async () => {
  const { service } = await setup({ unified: true, idea });
  try {
    const p = service.store!.db.project();
    assert.equal(p.titlePending, true);
    assert.equal(p.creationWorkflow, 2);
    const id = await service.invoke('creation.start', { inputHash: service.snapshot().tagDraft!.inputHash, requestId: crypto.randomUUID(), profileId: model.id });
    await settled(service);
    let run = await select(service, id, 'direction-3');
    assert.equal(run.status, 'awaiting_review', run.error ?? '');
    assert.ok(run.planning!.candidate!.plan);
    assert.equal(service.store!.db.project().stage, 'S01');
    assert.equal(service.store!.db.project().creation, undefined);
    await assert.rejects(service.invoke('titles.start', { sourceRunId: id, planHash: tagHash(run.planning!.candidate!.plan), requestId: crypto.randomUUID() }), /尚未确认/);
    await assert.rejects(service.invoke('run.accept', { id, proposalHash: run.proposalHash }), /尚未确认/);
    run = await confirmPlan(service, run);
    assert.equal(service.store!.db.project().stage, 'S01');
    const naming = await namePlan(service, id);
    assert.equal(naming.status, 'awaiting_review', naming.error ?? '');
    assert.equal(naming.rounds, 2);
    assert.equal(naming.changes.length, 0);
    await assert.rejects(service.invoke('run.accept', { id: naming.id, proposalHash: naming.proposalHash }), /独立命名/);
    await chooseTitle(service, naming, 'title-2');
    run = service.store!.db.run(id);
    assert.equal(service.store!.db.project().titlePending, true);
    assert.equal(run.planning!.titleSelection!.candidate.title, '从一口清水开始');
    const before = service.store!.db.project().revision;
    await service.invoke('run.accept', { id, proposalHash: run.proposalHash, warningReason: '已审阅', startNext: false });
    const current = service.store!.db.project();
    assert.equal(current.stage, 'S02');
    assert.equal(current.revision, before + 1);
    assert.equal(current.title, '从一口清水开始');
    assert.equal(current.tags, undefined);
    assert.equal(current.creation!.contract.directionId, 'direction-3');
    assert.equal(current.creation!.knowledge.options.length === 0, idea);
    assert.equal(current.titleBinding!.needsReview, false);
    assert.equal(service.store!.db.run(naming.id).accepted, true);
    assert.equal(current.creation!.contract.planHash, tagHash(current.creation!.contract.plan));
    assert.equal(service.store!.readAccepted(titlePath).content.includes('从一口清水开始'), true);
    await service.invoke('run.accept', { id, proposalHash: run.proposalHash });
    assert.equal(service.store!.db.project().revision, current.revision);
    for (const stage of stageIds) {
      assert.match(tagContext(current, stage), /approved_creation_plan/);
      assert.match(tagContext(current, stage), /plan-reader_promise/);
    }
    const root = service.store!.root;
    service.close();
    await service.open(root);
    assert.equal(service.store!.db.project().creation!.contract.planHash, current.creation!.contract.planHash);
    assert.equal(service.store!.db.project().title, '从一口清水开始');
  } finally { service.close(); }
});

test('修改作者想法或禁区后方案确认及命名候选一并失效，旧内容保留为历史', async () => {
  const { service } = await setup({ unified: true, idea: true });
  try {
    const run = await confirmPlan(service, await select(service, (await start(service)).id));
    const naming = await namePlan(service, run.id);
    await chooseTitle(service, naming);
    const draft = service.snapshot().tagDraft!;
    await service.invoke('creation.saveDraft', { expectedRevision: draft.revision, input: { ...emptyTagInput(), premise: '维修师改为组织移动救援', mustKeep: [], mustAvoid: ['禁止固定基地'] } });
    assert.equal(service.store!.db.run(run.id).status, 'stale');
    assert.equal(service.store!.db.run(naming.id).status, 'stale');
    await assert.rejects(chooseTitle(service, naming), /来源策划|改变|审核/);
    await assert.rejects(service.invoke('run.accept', { id: run.id, proposalHash: service.store!.db.run(run.id).proposalHash }), /审阅|改变|状态/);
    assert.ok(service.store!.db.run(naming.id).naming!.batch!.candidates.length);
    assert.equal(service.store!.db.project().creation, undefined);
  } finally { service.close(); }
});

test('书名本地检查拒绝未知方案引用、规范化重复、超长与长期成果冒充开篇；语义审核淘汰项不可选择', async () => {
  const { service } = await setup({ unified: true, caller: standard => async (...args) => {
    const answer = await standard(...args);
    if (args[3][0].name === 'submit_title_review') {
      const value = JSON.parse(answer.calls[0].arguments);
      value.decisions[0] = { candidateId: 'title-1', verdict: 'reject', reason: '标题承诺范围过大，当前方案不支持' };
      answer.calls[0].arguments = JSON.stringify(value);
    }
    return answer;
  } });
  try {
    const run = await confirmPlan(service, await select(service, (await start(service)).id));
    const naming = await namePlan(service, run.id), batch = naming.naming!.batch!;
    const validate = (change: (copy: typeof batch) => void) => { const copy = structuredClone(batch); change(copy); return () => validateTitleBatch(copy, naming, titleSource(service.store!, run.id)); };
    assert.throws(validate(v => { v.candidates[0].supportingClaimIds = ['not-confirmed']; }), /不存在/);
    assert.throws(validate(v => { v.candidates[1].title = ' 水泵旁的聚居地！'; }), /重复/);
    assert.throws(validate(v => { v.candidates[0].title = '名'.repeat(81); }), /字符/);
    assert.throws(validate(v => { v.candidates[0].supportingClaimIds = ['plan-long_term_goal']; v.candidates[0].payoffStage = 'opening'; }), /开篇事实/);
    await assert.rejects(chooseTitle(service, naming, 'title-1'), /审核/);
    await chooseTitle(service, naming, 'title-2');
    assert.equal(service.store!.db.run(run.id).planning!.titleSelection!.candidate.id, 'title-2');
  } finally { service.close(); }
});

test('命名中断与重启保留方案确认和已有候选，恢复只审核，不重新策划或自动采纳', async () => {
  let interrupt = true, reports = 0, generated = 0;
  const { service } = await setup({ unified: true, idea: true, caller: standard => async (...args) => {
    const name = args[3][0].name;
    if (name === 'submit_planning_report') reports++;
    if (name === 'submit_title_candidates') generated++;
    if (name === 'submit_title_review' && interrupt) throw new RequestError('模拟命名审核断流', true);
    return standard(...args);
  } });
  try {
    const run = await confirmPlan(service, await select(service, (await start(service)).id));
    const naming = await namePlan(service, run.id);
    assert.ok(['unknown', 'paused'].includes(naming.status), naming.status);
    assert.equal(naming.naming!.phase, 'reviewing');
    assert.ok(naming.naming!.batch);
    const root = service.store!.root;
    service.close();
    await service.open(root);
    assert.equal(generated, 1);
    assert.ok(service.store!.db.run(run.id).planning!.planApproval);
    interrupt = false;
    await service.invoke('run.resume', { id: naming.id, retryUnknown: true });
    await settled(service);
    const resumed = service.store!.db.run(naming.id);
    assert.equal(resumed.status, 'awaiting_review', resumed.error ?? '');
    assert.equal(reports, 1);
    assert.equal(generated, 1);
    assert.equal(service.store!.db.project().stage, 'S01');
    assert.equal(service.store!.db.project().creation, undefined);
  } finally { service.close(); }
});

test('旧书主动补全方案不重置阶段，变更关联未来资料并保留正文；独立改名不再触发剧情修订', async () => {
  const repairs: { path: string; upstream: string[] }[] = [];
  const { service } = await setup({ legacy: true, caller: standard => async (...args) => {
    if (!args[3].length) {
      const input = JSON.parse(args[2][0].content);
      if (args[1].includes('你独立检查')) return plainResult({ decisions: input.items.map((item: any) => {
        const source = input.sources.find((v: any) => v.path === item.path);
        return { id: item.id, verdict: 'supported', reason: '核对新方案、未来生效范围与上游候选一致', evidence: [{ path: source.path, quote: source.content.slice(0, 35) }] };
      }) });
      repairs.push({ path: input.file.path, upstream: input.upstreamPlans.map((v: any) => v.path) });
      return plainResult({ content: input.file.content + '\n\n后续约定：第三章起优先维护供水与协作，不改变已发生事件。', reason: '按新方案落实未来安排，历史正文不变', records: [], withdrawn: [] });
    }
    return standard(...args);
  } });
  try {
    const store = service.store!, p = store.db.project();
    p.stage = 'S08'; p.chapter = 3; p.chapters = { 1: 'complete', 2: 'complete' }; p.revision++;
    const prose = '已经接受的第一章正文，维修师修复水泵。';
    store.commit([{ path: paths.seed, content: fixture(p, paths.seed, service), baseHash: store.db.document(paths.seed)!.hash },
      { path: paths.world, content: fixture(p, paths.world, service), baseHash: store.db.document(paths.world)!.hash },
      { path: paths.volumes, content: fixture(p, paths.volumes, service), baseHash: store.db.document(paths.volumes)!.hash },
      { path: prosePath(1), content: prose, baseHash: store.db.document(prosePath(1))?.hash ?? null }], p);
    const draft = await service.invoke('creation.saveDraft', { input: { ...emptyTagInput(), premise: input.premise, mustKeep: [], mustAvoid: input.mustAvoid }, expectedRevision: 0 });
    const id = await service.invoke('creation.start', { inputHash: draft.inputHash, requestId: crypto.randomUUID(), profileId: model.id });
    await settled(service);
    const ready = await confirmPlan(service, await select(service, id));
    assert.equal(ready.planning!.origin, 'adoption');
    await service.invoke('run.accept', { id, proposalHash: ready.proposalHash, warningReason: '主动接入已核对设定' });
    let current = store.db.project();
    assert.equal(current.stage, 'S08'); assert.equal(current.chapter, 3);
    assert.equal(current.chapters[1], 'complete');
    assert.equal(store.readAccepted(prosePath(1)).content, prose);
    assert.ok(current.stale.includes(paths.volumes));
    assert.ok(!current.stale.includes(prosePath(1)));
    assert.ok(current.storyImpacts!.some(v => v.creationChange && v.scope.mode === 'forward'));
    assert.equal(current.titleReviewRequired, true);
    const naming = await namePlan(service, undefined, current.title);
    await chooseTitle(service, naming, 'manual');
    current = store.db.project();
    assert.equal(current.titleReviewRequired, false);
    const before = structuredClone(current), nextName = await namePlan(service, undefined, '水泵与家园');
    await chooseTitle(service, nextName, 'manual');
    const after = store.db.project();
    assert.equal(after.title, '水泵与家园');
    assert.equal(after.stage, before.stage); assert.equal(after.chapter, before.chapter);
    assert.deepEqual(after.stale, before.stale);
    assert.deepEqual(after.storyImpacts, before.storyImpacts);
    assert.equal(store.readAccepted(prosePath(1)).content, prose);
    assert.equal(approvedCreation(after)!.contract.planHash, approvedCreation(before)!.contract.planHash);
    const revision = after.revision;
    await chooseTitle(service, nextName, 'manual');
    assert.equal(store.db.project().revision, revision);
    const repairId = await service.invoke('run.start', { request: '继续当前阶段', profileId: model.id });
    await settled(service);
    const repaired = store.db.run(repairId);
    assert.ok(repaired.memoryRepair);
    assert.equal(repaired.continuity?.mode, 'forward');
    assert.equal(repaired.status, 'awaiting_review', JSON.stringify({ error: repaired.error, issues: repaired.issues }));
    assert.ok(repairs.find(v => v.path === paths.volumes)?.upstream.includes(paths.world));
    assert.equal(store.readAccepted(prosePath(1)).content, prose);
    await service.invoke('run.accept', { id: repairId, proposalHash: repaired.proposalHash, warningReason: '核对合成修订候选' });
    assert.deepEqual(store.db.project().stale, []);
    assert.deepEqual(store.db.project().storyImpacts, []);
    assert.equal(store.db.project().stage, 'S08');
    assert.equal(store.readAccepted(prosePath(1)).content, prose);
    assert.match(store.readAccepted(paths.volumes).content, /第三章起/);
  } finally { service.close(); }
});

test('命名生成与审核实际接收带来源日期的番茄题面风格样本', async () => {
  const sent: { tool: string; profile: TitleStyleProfile; system: string; planHash: string }[] = [];
  const { service, parent } = await setup({ unified: true, idea: true, caller: standard => async (...args) => {
    const tool = args[3][0].name;
    if (tool === 'submit_title_candidates' || tool === 'submit_title_review') {
      const payload = JSON.parse(args[2][0].content);
      sent.push({ tool, profile: titleStyleProfileSchema.parse(payload.styleProfile), system: args[1], planHash: payload.planHash });
    }
    return standard(...args);
  } });
  try {
    const plan = await confirmPlan(service, await select(service, (await start(service)).id));
    const named = await namePlan(service, plan.id);
    assert.equal(named.status, 'awaiting_review', named.error ?? '');
    assert.equal(named.naming!.batch!.candidates.length, 6);
    assert.deepEqual(sent.map(value => value.tool), ['submit_title_candidates', 'submit_title_review']);
    for (const value of sent) {
      assert.deepEqual(value.profile, loadTitleStyleProfile(skill));
      assert.equal(value.planHash, named.naming!.planHash);
      assert.match(value.system, /作者短名偏好优先/);
      assert.match(value.system, /编辑归纳不等于官方规则或热度证明/);
    }
  } finally {
    service.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('书名局部重做只修改指定候选，旧选择失效而方案确认保留，命名预算和历史不清零', async () => {
  const { service } = await setup({ unified: true, idea: true, caller: standard => async (...args) => {
    const reply = await standard(...args);
    if (args[3][0].name === 'submit_title_candidates') {
      const input = JSON.parse(args[2][0].content);
      if (input.regenerate) reply.calls[0].arguments = JSON.stringify({ ...input.regenerate.original,
        candidates: input.regenerate.original.candidates.map((c: any) => c.id === input.regenerate.candidateId ? { ...c, title: c.id === 'manual' ? '清水汇成的家园' : '供水线上的家园' } : c) });
    }
    return reply;
  } });
  try {
    const run = await confirmPlan(service, await select(service, (await start(service)).id));
    const naming = await namePlan(service, run.id), before = structuredClone(naming.naming!.batch!);
    await chooseTitle(service, naming);
    await service.invoke('titles.regenerate', { id: naming.id, batchHash: naming.naming!.review!.hash, candidateId: 'title-1', instruction: '突出供水与家园' });
    await settled(service);
    const after = service.store!.db.run(naming.id);
    assert.equal(after.status, 'awaiting_review', after.error ?? '');
    assert.equal(after.rounds, 4);
    assert.equal(after.naming!.history.length, 1);
    assert.deepEqual(after.naming!.batch!.candidates.slice(1), before.candidates.slice(1));
    assert.equal(after.naming!.batch!.candidates[0].title, '供水线上的家园');
    assert.ok(service.store!.db.run(run.id).planning!.planApproval);
    assert.equal(service.store!.db.run(run.id).planning!.titleSelection, undefined);
    await assert.rejects(service.invoke('titles.select', { id: naming.id, batchHash: naming.naming!.review!.hash, candidateId: 'title-1' }), /改变/);
    await chooseTitle(service, after);
    assert.equal(service.store!.db.project().stage, 'S01');
    const manual = await namePlan(service, run.id, '供水维修记');
    await service.invoke('titles.regenerate', { id: manual.id, batchHash: manual.naming!.review!.hash, candidateId: 'manual', instruction: '我决定改名，突出家园建设' });
    await settled(service);
    const revised = service.store!.db.run(manual.id);
    assert.equal(revised.status, 'awaiting_review', revised.error ?? '');
    assert.equal(revised.naming!.batch!.candidates[0].title, '清水汇成的家园');
  } finally { service.close(); }
});

test('完整备份恢复包含统一方案、作者确认、命名候选与书名绑定', async () => {
  const { service, parent } = await setup({ unified: true, idea: true });
  try {
    const run = await confirmPlan(service, await select(service, (await start(service)).id));
    const naming = await namePlan(service, run.id);
    await chooseTitle(service, naming);
    const ready = service.store!.db.run(run.id);
    await service.invoke('run.accept', { id: ready.id, proposalHash: ready.proposalHash, warningReason: '备份验收' });
    const p = service.store!.db.project();
    const backup = await createBackup(service.store!, path.join(parent, 'backup'));
    const restored = restoreBackup(backup, parent);
    service.close();
    await service.open(restored);
    assert.equal(service.store!.db.project().id, p.id);
    assert.equal(service.store!.db.project().creation!.contract.planHash, p.creation!.contract.planHash);
    assert.equal(service.store!.db.project().titleBinding!.batchHash, p.titleBinding!.batchHash);
    assert.ok(service.store!.db.run(run.id).planning!.planApproval);
    assert.ok(service.store!.db.run(naming.id).naming!.review);
    assert.equal(service.store!.db.run(naming.id).status, 'complete');
    assert.equal(service.store!.readAccepted(titlePath).content.includes(p.title), true);
  } finally { service.close(); }
});

test('命名取消后的迟到结果不采纳，切换模型保留方案来源与累计预算', { timeout: 20000 }, async () => {
  let enter!: () => void, release!: () => void, delay = true;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { service } = await setup({ unified: true, idea: true, caller: standard => async (...args) => {
    if (args[3][0].name === 'submit_title_candidates' && delay) { delay = false; enter(); await gate; }
    return standard(...args);
  } });
  try {
    const run = await confirmPlan(service, await select(service, (await start(service)).id));
    const id = await service.invoke('titles.start', { sourceRunId: run.id, planHash: run.planning!.planApproval!.planHash, requestId: crypto.randomUUID(), profileId: model.id });
    await entered;
    await service.invoke('run.cancel', { id });
    release(); await settled(service);
    const stopped = service.store!.db.run(id);
    assert.equal(stopped.status, 'paused');
    assert.equal(stopped.naming!.batch, undefined);
    assert.equal(service.store!.db.project().creation, undefined);
    service.profiles.push({ ...structuredClone(model), id: 'title-handoff', version: 2 });
    const resumedId = await service.invoke('run.handoff', { id, profileId: 'title-handoff' });
    await settled(service);
    const resumed = service.store!.db.run(resumedId);
    assert.equal(resumed.status, 'awaiting_review', resumed.error ?? '');
    assert.equal(resumed.rounds, 3);
    assert.equal(resumed.naming!.sourceHash, stopped.naming!.sourceHash);
    assert.equal(resumed.naming!.sourceRunId, run.id);
    assert.equal(resumed.modelBindings!.title_writer.id, 'title-handoff');
    namingBinding(service.store!, resumed);
    assert.ok(service.store!.db.run(run.id).planning!.planApproval);
    assert.equal(service.store!.db.project().stage, 'S01');
  } finally { release(); service.close(); }
});

test('统一方案采纳后实际走通保留的十一阶段和逐章正文流程', async () => {
  let active!: Service;
  const { service } = await setup({ unified: true, idea: true,
    config: { targetWords: 400, chapterWords: 200, minWords: 200, maxWords: 200, batchSize: 2, maxRounds: 40 },
    caller: standard => async (...args) => {
      if (args[3][0]?.name.startsWith('submit_')) return standard(...args);
      const p = active.store!.db.project();
      if (!args[3].length) {
        if (args[1].includes('rubric narrative-1')) return plainResult({ values: { pressure: 3, payoff: 3, emotion: 3, revelation: null, relationship: null }, quotes: [fixture(p, prosePath(p.chapter), active).slice(-12)], note: '合成流程验证' });
        return { ...plainResult(null), text: fixture(p, prosePath(p.chapter), active) };
      }
      assert.match(args[1], /approved_creation_plan/);
      if (args[2].at(-1)?.role === 'tool') return { ...plainResult(null), text: '候选已完成' };
      const running = active.store!.db.runs().find(r => r.status === 'running')!;
      const outputs = running.pipeline?.phase === 'review' ? [qualityPath(p.chapter)] : stageOutputs(running.pipeline?.phase === 'memory' ? 'S11' : running.stage, p);
      return result('propose_changes', { changes: outputs.map(file => ({ path: file, content: fixture(p, file, active), baseHash: active.store!.db.document(file)?.hash ?? null })) });
    }
  });
  active = service;
  try {
    const run = await confirmPlan(service, await select(service, (await start(service)).id));
    const naming = await namePlan(service, run.id); await chooseTitle(service, naming);
    const ready = service.store!.db.run(run.id);
    await service.invoke('run.accept', { id: run.id, proposalHash: ready.proposalHash, warningReason: '全流程合成验证' });
    for (let count = 0; !service.store!.db.project().finished; count++) {
      assert.ok(count < 20);
      const id = await service.invoke('run.start', { request: '继续当前阶段并保持已确认作品方案', profileId: model.id });
      await settled(service);
      const candidate = service.store!.db.run(id);
      assert.equal(candidate.status, 'awaiting_review', JSON.stringify({ stage: candidate.stage, error: candidate.error, issues: candidate.issues }));
      if (candidate.stage === 'S10') assert.ok(candidate.pipeline);
      await service.invoke('run.accept', { id, proposalHash: candidate.proposalHash, warningReason: '合成流程验收' });
    }
    const current = service.store!.db.project();
    for (const stage of stageIds) assert.ok(Object.keys(current.completed).some(key => key.startsWith(stage)), stage);
    assert.equal(current.chapters[1], 'complete'); assert.equal(current.chapters[2], 'complete');
    assert.ok(current.creation!.contract.plan);
    assert.equal(current.title, '水泵旁的聚居地');
  } finally { service.close(); }
});
test('集中确认绑定所选方向与报告版本，保留修改意见，不默认确认其他方向', async () => {
  const { service } = await setup({ caller: standard => async (...args) => {
    const reply = await standard(...args);
    if (args[3][0].name === 'submit_planning_report') {
      const report = JSON.parse(reply.calls[0].arguments) as PlanningReport;
      report.assumptions.push(
        { id: 'chosen-rule', text: '供水网络需要维护成本', critical: true, directionIds: ['direction-2'] },
        { id: 'other-rule', text: '另一方向采用商会组织', critical: true, directionIds: ['direction-3'] }
      );
      reply.calls[0].arguments = JSON.stringify(report);
    }
    return reply;
  } });
  try {
    const run = await start(service);
    const selection = { id: run.id, reportHash: run.planning!.reportHash!, directionId: 'direction-2' };
    await assert.rejects(service.invoke('tags.selectDirection', selection), /关键假设/);
    await assert.rejects(service.invoke('tags.selectDirection', { ...selection, reportHash: 'outdated', acceptAssumptions: true }), /报告已改变/);
    await service.invoke('tags.selectDirection', { ...selection, acceptAssumptions: true, resolutions: { space: '改为工具箱，不采用储物空间' } });
    await settled(service);
    const chosen = service.store!.db.run(run.id);
    assert.equal(chosen.planning!.resolutions.space, '改为工具箱，不采用储物空间');
    assert.equal(chosen.planning!.resolutions['chosen-rule'], '作者已确认采用此设定');
    assert.equal(chosen.planning!.resolutions['other-rule'], undefined);
    assert.equal(chosen.status, 'awaiting_review');
    assert.equal(chosen.accepted, false);
    assert.equal(service.store!.db.project().tags, undefined);
  } finally { service.close(); }
});

test('策划一次确认后进入下一阶段，重复操作复用回执，下一阶段仍等作者审阅', async () => {
  let stageCalls = 0;
  const { service } = await setup({ caller: standard => async (...args) => {
    if (args[3][0].name.startsWith('submit_')) return standard(...args);
    stageCalls++;
    assert.match(args[1], /只集中询问会改变核心方向或禁区的缺口/);
    if (args[2].at(-1)?.role === 'tool') return { text: '本阶段结果已准备好', calls: [], native: {}, usage: { input: 1, output: 1, cost: 0, currency: 'USD' }, stop: 'complete' };
    const p = service.store!.db.project();
    return result('propose_changes', { changes: stageOutputs(p.stage, p).map(file => ({ path: file, content: fixture(p, file, service), baseHash: service.store!.db.document(file)?.hash ?? null })) });
  } });
  try {
    const started = await start(service);
    const ready = await select(service, started.id);
    const command = { id: ready.id, proposalHash: ready.proposalHash, startNext: true };
    const operationId = crypto.randomUUID();
    const accepted = await service.invoke('run.accept', command, { operationId });
    assert.equal(accepted.accepted, true);
    assert.ok(accepted.nextRun);
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.db.run(ready.id).accepted, true);
    assert.deepEqual(await service.invoke('run.accept', command, { operationId }), accepted);
    await settled(service);
    const next = service.store!.db.run(accepted.nextRun!);
    assert.equal(next.stage, 'S02');
    assert.equal(next.accepted, false);
    assert.equal(next.status, 'awaiting_review', JSON.stringify(next.issues));
    assert.equal(service.store!.db.project().stage, 'S02');
    const count = service.store!.db.runs().length;
    assert.deepEqual(await service.invoke('operation.query', { id: operationId }).then(value => value?.result), accepted);
    await service.invoke('run.accept', command);
    assert.equal(service.store!.db.runs().length, count);
    const callsBeforePause = stageCalls;
    await service.invoke('run.accept', { id: next.id, proposalHash: next.proposalHash, startNext: false, warningReason: '合成数据仅验证流程' });
    assert.equal(service.store!.db.project().stage, 'S03');
    assert.equal(service.store!.db.runs().length, count);
    assert.equal(stageCalls, callsBeforePause);
  } finally { service.close(); }
});

test('下一阶段启动失败时明确保留已保存结果，不把成功采纳显示为失败', async () => {
  const { service } = await setup();
  try {
    const started = await start(service), ready = await select(service, started.id);
    const originalLaunch = service.launch.bind(service);
    service.launch = () => { throw new Error('模拟启动暂不可用'); };
    const accepted = await service.invoke('run.accept', { id: ready.id, proposalHash: ready.proposalHash, startNext: true });
    service.launch = originalLaunch;
    assert.equal(accepted.accepted, true);
    assert.match(accepted.nextError!, /本阶段已保存.*模拟启动暂不可用/);
    assert.equal(accepted.nextRun, undefined);
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.db.run(ready.id).accepted, true);
    assert.equal(service.store!.db.runs().length, 1);
  } finally { service.close(); }
});

test('旧书接入的确认即使带继续标志也不启动或改变已有创作阶段', async () => {
  const { service } = await setup({ legacy: true });
  try {
    const p = service.store!.db.project();
    p.stage = 'S03';
    service.store!.db.set('project', p);
    await service.invoke('tags.saveDraft', { input, expectedRevision: 0 });
    const started = await start(service), ready = await select(service, started.id);
    assert.equal(ready.mode, 'revision');
    const before = service.store!.readAccepted(paths.seed).content;
    const accepted = await service.invoke('run.accept', { id: ready.id, proposalHash: ready.proposalHash, startNext: true });
    assert.equal(accepted.nextRun, undefined);
    assert.equal(service.store!.db.project().stage, 'S03');
    assert.equal(service.store!.readAccepted(paths.seed).content, before);
  } finally { service.close(); }
});

test('策划正文泄漏内部字段时在现有修复预算内重写，结构化编号和审批保持完整', async () => {
  let contractCalls = 0;
  const { service } = await setup({ caller: standard => async (profile, system, messages, tools, ...rest) => {
    assert.match(system, /面向作者的标题、说明/);
    const reply = await standard(profile, system, messages, tools, ...rest);
    if (tools[0].name === 'submit_creation_contract') {
      contractCalls++;
      if (contractCalls === 1) {
        const value = JSON.parse(reply.calls[0].arguments);
        value.constraints[0].text = '保留mustKeep=[]与mustAvoid=[]；只采用A_D1_RULE。';
        reply.calls[0].arguments = JSON.stringify(value);
      } else assert.ok(messages.some(message => message.role === 'tool' && message.content.includes('作者可见文字含内部字段或引用编号')));
    }
    return reply;
  } });
  try {
    const before = service.store!.readAccepted(paths.seed).content;
    const started = await start(service), ready = await select(service, started.id);
    assert.equal(contractCalls, 2);
    assert.equal(ready.status, 'awaiting_review');
    assert.equal(ready.planning!.formatRepairs, 1);
    assert.equal(ready.planning!.candidate!.directionId, 'direction-2');
    assert.equal(ready.planning!.candidate!.constraints[0].optionIds[0], input.selection.reading.main);
    assert.equal(ready.planning!.contractReview!.hash, tagHash(ready.planning!.candidate));
    assert.doesNotMatch(ready.planning!.candidate!.constraints[0].text, /mustKeep|mustAvoid|A_D1_RULE/);
    assert.equal(service.store!.readAccepted(paths.seed).content, before);
    assert.equal(service.store!.db.project().tags, undefined);
  } finally { service.close(); }
});

test('连续泄漏内部字段达到原有修复上限后停止，不增加无界调用或采纳候选', async () => {
  let contractCalls = 0;
  const { service } = await setup({ caller: standard => async (...args) => {
    const reply = await standard(...args);
    if (args[3][0].name === 'submit_creation_contract') {
      contractCalls++;
      const value = JSON.parse(reply.calls[0].arguments);
      value.openQuestions = ['mustAvoid是否为空？'];
      reply.calls[0].arguments = JSON.stringify(value);
    }
    return reply;
  } });
  try {
    const before = service.store!.readAccepted(paths.seed).content;
    const started = await start(service), failed = await select(service, started.id);
    assert.equal(contractCalls, 3);
    assert.equal(failed.planning!.candidate, undefined);
    assert.match(failed.error ?? '', /结构化输出校验连续失败/);
    assert.doesNotMatch(failed.error ?? '', /mustAvoid/);
    assert.equal(service.store!.db.project().tags, undefined);
    assert.equal(service.store!.readAccepted(paths.seed).content, before);
  } finally { service.close(); }
});

test('482标签、八组边界、跨组概念及配方条件', () => {
  const b = tagBundle(skill);
  assert.equal(b.taxonomy.options.length, 482);
  assert.equal(new Set(b.taxonomy.options.map((o) => o.id)).size, 482);
  assert.deepEqual(
    b.taxonomy.groups.map((g) => g.count),
    [19, 33, 22, 80, 144, 58, 94, 32]
  );
  const t = makePlanning();
  assert.equal(t.knowledge.coverage.length, 2);
  assert.equal(t.knowledge.recipes.length, 0);
  for (const invalid of [
    { ...input, selection: { ...input.selection, reading: { ...input.selection.reading, plot: ['nope'] } } },
    {
      ...input,
      selection: {
        ...input.selection,
        reading: { ...input.selection.reading, plot: ['reading.plot.078', 'reading.plot.078'] }
      }
    }
  ])
    assert.throws(() => makeBookSpec(newProject('a', 'x', {}), invalid, 1, b.taxonomy));
});
test('审核位置兼容当前请求包裹层，保留问题且拒绝不存在或跨阶段的引用', () => {
  const candidate = { directions: [{ storyEngine: '有限穿越次数' }], '带/斜线': { '~': '约束' } };
  const issue = { code: 'consumption', severity: 'major', jsonPointer: '/report/directions/0/storyEngine',
    explanation: '两次穿越超过一次消耗上限', suggestedFix: '统一消耗规则' };
  const review = validatePlanningReview({ issues: [issue] }, candidate, 'report');
  assert.deepEqual(review.issues, [{ ...issue, jsonPointer: '/directions/0/storyEngine' }]);
  assert.equal(issue.jsonPointer, '/report/directions/0/storyEngine', '保留模型原始回执');
  assert.equal(validatePlanningReview({ issues: [{ ...issue, jsonPointer: '/candidate/带~1斜线/~0' }] }, candidate, 'candidate').issues[0].jsonPointer, '/带~1斜线/~0');
  assert.equal(validatePlanningReview({ issues: [{ ...issue, jsonPointer: '/report' }] }, candidate, 'report').issues[0].jsonPointer, '');
  for (const pointer of ['/report/directions/4', '/candidate/directions/0', '/input/premise', '/report/__proto__/polluted', '/report/带~2斜线'])
    assert.throws(() => validatePlanningReview({ issues: [{ ...issue, jsonPointer: pointer }] }, candidate, 'report'), /不存在|JSON Pointer/);
  assert.throws(() => validatePlanningReview({ issues: [issue] }, candidate), /不存在/, '未指定当前审核对象时不猜测包裹层');
});

test('完整报告逐方向覆盖、诊断引用与结构化契约校验', () => {
  const t = makePlanning(),
    report = reportFor(t);
  assert.deepEqual(validateReport(report, t), report);
  const bad = structuredClone(report);
  bad.diagnosis.push({
    code: 'bad',
    severity: 'warning',
    message: 'x',
    optionIds: ['does-not-exist'],
    assumptionIds: []
  });
  assert.throws(() => validateReport(bad, t), /诊断/);
  const unconfirmed = structuredClone(report);
  unconfirmed.diagnosis.push({
    code: 'conflict',
    severity: 'needs_confirmation',
    message: '范围待确认',
    optionIds: [],
    assumptionIds: []
  });
  assert.throws(() => validateReport(unconfirmed, t), /关键假设/);
  assert.throws(
    () =>
      validatePlanningReview(
        {
          issues: [
            {
              code: 'missing',
              severity: 'major',
              jsonPointer: '/directions/4',
              explanation: '不存在',
              suggestedFix: '修正'
            }
          ]
        },
        report
      ),
    /不存在/
  );
  const missing = structuredClone(report);
  missing.directions[1].tagCoverage.pop();
  assert.throws(() => validateReport(missing, t), /缺漏/);
  t.report = report;
  t.selectedDirectionId = 'direction-2';
  const c = {
    directionId: 'direction-2',
    constraints: [
      {
        id: 'c',
        optionIds: ['reading.main.003'],
        text: '有限资源',
        scope: { entityIds: [], fromChapter: 2, toChapter: 1 },
        evidenceRef: 'direction-2'
      }
    ],
    tagCoverage: report.directions[1].tagCoverage,
    openQuestions: [],
    premiseDocument: '完整设定'
  };
  assert.throws(() => validateContract(c, t), /范围/);
  c.constraints[0].scope.toChapter = 3;
  assert.throws(() => validateContract(c, t), /关键假设/);
  t.resolutions.space = '同意';
  assert.ok(validateContract(c, t));
});
test('S01非推荐方向、审核、原子采纳、幂等、全阶段契约与备份恢复', async () => {
  const { service: s, parent } = await setup({ untitled: true });
  try {
    const before = s.snapshot().project!,
      key = 'same-request';
    let r = await start(s, key);
    assert.equal(r.planning!.phase, 'awaiting_direction');
    assert.equal(s.snapshot().project!.stage, 'S01');
    assert.equal(s.snapshot().facts.length, 0);
    assert.equal(
      await s.invoke('tags.start', {
        inputHash: s.snapshot().tagDraft!.inputHash,
        profileId: model.id,
        requestId: key
      }),
      r.id
    );
    await assert.rejects(() => s.invoke('run.accept', { id: r.id, proposalHash: r.proposalHash }), /审阅/);
    r = await select(s, r.id);
    assert.equal(s.snapshot().project!.titlePending, true);
    assert.equal(s.snapshot().project!.stage, 'S01');
    assert.equal(r.planning!.phase, 'ready');
    assert.deepEqual(
      r.issues.filter((i) => i.severity === 'error'),
      []
    );
    const approval = r.proposalHash;
    await assert.rejects(s.invoke('run.accept', { id: r.id, proposalHash: approval }), /填写书名/);
    await s.invoke('run.accept', { id: r.id, proposalHash: approval, title: '供水之城' });
    const p = s.snapshot().project!;
    assert.equal(p.title, '供水之城');
    assert.equal(p.titlePending, false);
    assert.equal(p.root, before.root);
    assert.match(s.store!.readAccepted(paths.config).content, /- 项目：供水之城/);
    assert.equal(p.stage, 'S02');
    assert.equal(p.revision, before.revision + 1);
    assert.equal(p.tags!.contract.directionId, 'direction-2');
    assert.equal(s.snapshot().facts.length, 0);
    assert.ok(p.tags!.contract.tagCoverage.every((v) => v.implementation.includes('方向2')));
    assert.equal((await s.invoke('run.accept', { id: r.id, proposalHash: approval })).alreadyAccepted, true);
    for (const stage of stageIds) {
      assert.match(systemPrompt(skill, p, stage), /禁止后宫/);
      assert.match(tagContext(p, stage), /approved_tag_contract/);
    }
    assert.match(tagContext(p, 'S10'), /按契约写正文/);
    assert.doesNotMatch(tagContext(p, 'S10'), /恰好三个/);
    await assert.rejects(
      () => s.invoke('document.save', { path: contractPath, content: '修改', baseHash: null }),
      /结构化记录/
    );
    assert.equal(s.store!.db.head()!.project.tags!.contract.directionId, 'direction-2');
    const root = p.root;
    s.close();
    await s.open(root);
    assert.equal(s.snapshot().project!.tags!.contract.directionId, 'direction-2');
    const backup = await createBackup(s.store!, path.join(parent, 'backups'));
    s.close();
    fs.mkdirSync(path.join(parent, 'restored'));
    const restored = restoreBackup(backup, path.join(parent, 'restored'));
    await s.open(restored);
    assert.equal(s.snapshot().project!.title, '供水之城');
    assert.equal(s.snapshot().project!.titlePending, false);
    assert.equal(s.snapshot().project!.tags!.contract.directionId, 'direction-2');
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
test('只改作者禁区或想法即使标签不变，也使旧报告失效', async () => {
  const { service: s, parent } = await setup();
  try {
    const r = await start(s),
      d = s.snapshot().tagDraft!;
    await s.invoke('tags.saveDraft', {
      expectedRevision: d.revision,
      input: { ...input, mustAvoid: ['禁止后宫', '禁止预知'] }
    });
    assert.throws(() => planningBinding(s.store!, r), /意图已改变/);
    assert.equal(s.store!.db.run(r.id).status, 'stale');
    await assert.rejects(() => select(s, r.id), /意图已改变/);
    await assert.rejects(
      () => s.invoke('tags.saveDraft', { expectedRevision: d.revision, input }),
      /另一个窗口/
    );
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
test('旧书主动接入保留阶段、章节、正文和记忆；未接入书保持原方式', async () => {
  const { service: s, parent } = await setup({ legacy: true });
  try {
    let p = s.store!.db.project();
    assert.equal(p.tagEnabled, undefined);
    assert.equal(s.makeRun('stage', '原流程').planning, undefined);
    p.stage = 'S05';
    p.chapter = 3;
    p.revision++;
    const prose = '# 第一章\n\n已接受的旧正文必须保留。';
    s.store!.commit(
      [{ path: prosePath(1), content: prose, baseHash: s.store!.db.document(prosePath(1))?.hash ?? null }],
      p
    );
    await s.invoke('tags.saveDraft', { input, expectedRevision: 0 });
    let r = await start(s);
    assert.equal(r.planning!.origin, 'adoption');
    r = await select(s, r.id);
    assert.deepEqual(
      r.issues.filter((i) => i.severity === 'error'),
      []
    );
    await s.invoke('run.accept', { id: r.id, proposalHash: r.proposalHash });
    p = s.store!.db.project();
    assert.equal(p.stage, 'S05');
    assert.equal(p.chapter, 3);
    assert.equal(s.store!.readAccepted(prosePath(1)).content, prose);
    assert.ok(p.stale.includes(prosePath(1)));
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
test('局部重做保留其他方向、预算不重置，关键假设不能跳过', async () => {
  const { service: s, parent } = await setup();
  try {
    let r = await start(s);
    const original = r.planning!.report!;
    await assert.rejects(
      () =>
        s.invoke('tags.selectDirection', {
          id: r.id,
          reportHash: r.planning!.reportHash,
          directionId: 'direction-2',
          resolutions: {}
        }),
      /关键假设/
    );
    await s.invoke('tags.reviseDirection', {
      id: r.id,
      reportHash: r.planning!.reportHash,
      directionId: 'direction-2',
      instruction: '保留两个方向，只调整第二个'
    });
    await settled(s);
    r = s.store!.db.run(r.id);
    assert.equal(r.rounds, 4);
    assert.equal(creationDirectionId(r), 'direction-2');
    assert.deepEqual(r.planning!.report!.directions[0], original.directions[0]);
    const bad = structuredClone(original);
    bad.directions[0].title = '偷偷改变';
    assert.throws(() => validateReport(bad, r.planning!), /保留/);
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
for (const keepDirectionIds of [[], ['direction-2']]) {
  test(keepDirectionIds.length ? '保留一案重抽另两案，冻结完整对象且旧报告不能重用' : '换一批三案保留历史，旧报告不能重复提交', async () => {
    let submittedHistory: { directionId: string; storyEngine: string }[] = [];
    let submittedScope: { mode: string; frozenDirectionIds: string[]; changedDirectionIds: string[] } | undefined;
    const { service: s, parent } = await setup({
      caller: standard => async (...args) => {
        const response = await standard(...args);
        if (args[3][0].name !== 'submit_planning_report') return response;
        const data = JSON.parse(args[2][0].content);
        if (!data.regenerate) return response;
        submittedHistory = data.history;
        submittedScope = data.regenerationScope;
        const original: PlanningReport = data.regenerate.original;
        const report = JSON.parse(response.calls[0].arguments) as PlanningReport;
        report.directions = original.directions.map((direction, index) => keepDirectionIds.includes(direction.id)
          ? direction
          : { ...direction, title: '新方向' + index, logline: '维修师主动选择新的协作道路' + index,
              storyEngine: ['交换维修债券，组织流动工队，再承担社区承诺', '识别旧管网故障，建立配水协议，再面对规则博弈', '护送净水设备，协同沿路居民，再建立巡回供应'][index] });
        return result('submit_planning_report', report);
      }
    });
    try {
      const first = await start(s);
      const original = structuredClone(first.planning!.report!);
      const oldHash = first.planning!.reportHash;
      const oldRounds = first.rounds;
      await s.invoke('tags.reroll', { id: first.id, reportHash: oldHash, keepDirectionIds, instruction: '保留作者约定，换有实质差异的机制' });
      await settled(s);
      const next = s.store!.db.run(first.id);
      assert.equal(next.planning!.phase, 'awaiting_direction', next.error ?? '');
      assert.equal(next.planning!.report!.directions.length, 3);
      assert.equal(next.rounds, oldRounds + 2);
      assert.notEqual(next.planning!.reportHash, oldHash);
      assert.ok(next.planning!.history.some(h => h.kind === 'report' && tagHash(h.value) === tagHash(original)));
      assert.ok(submittedHistory.length > 0);
      assert.equal(submittedScope!.mode, keepDirectionIds.length ? 'keep_one' : 'reroll_all');
      assert.deepEqual(submittedScope!.frozenDirectionIds, keepDirectionIds);
      const focused = keepDirectionIds[0] ?? next.planning!.report!.recommendedDirectionId;
      assert.equal(creationDirectionId(s.snapshot().runs.find(run => run.id === next.id)), focused);
      assert.equal(next.planning!.selectedDirectionId, undefined);
      assert.equal(s.snapshot().project!.stage, 'S01');
      for (const direction of original.directions) {
        const current = next.planning!.report!.directions.find(v => v.id === direction.id)!;
        if (keepDirectionIds.includes(direction.id)) assert.deepEqual(current, direction);
        else assert.notEqual(current.storyEngine, direction.storyEngine);
      }
      await assert.rejects(s.invoke('tags.reroll', { id: first.id, reportHash: oldHash, keepDirectionIds }), /改变/);
      await assert.rejects(s.invoke('tags.selectDirection', { id: first.id, reportHash: oldHash, directionId: 'direction-1', resolutions: { space: '采用' } }), /改变/);
      const expanded = await select(s, next.id, creationDirectionId(next));
      assert.equal(expanded.planning!.phase, 'ready', expanded.error ?? '');
      assert.equal(expanded.planning!.candidate!.directionId, focused);
      assert.equal(expanded.accepted, false);
      assert.equal(s.snapshot().project!.stage, 'S01');
    } finally {
      s.close();
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

test('独立审核最多一次语义修订，不能因暂停续跑重置预算', async () => {
  const { service: s, parent } = await setup({
    caller:
      (standard) =>
      async (...a) =>
        a[3][0].name === 'submit_planning_review'
          ? result('submit_planning_review', {
              issues: [
                {
                  code: 'conflict',
                  severity: 'major',
                  jsonPointer: '/directions/0',
                  explanation: '机制不持续',
                  suggestedFix: '补充持续难题'
                }
              ]
            })
          : standard(...a)
  });
  try {
    const r = await start(s);
    assert.equal(r.status, 'needs_repair');
    assert.equal(r.planning!.semanticRevisions, 1);
    assert.equal(r.rounds, 4);
    assert.equal(s.snapshot().project!.stage, 'S01');
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
test('取消后迟到模型结果不成为报告，事件分页只返回本任务', async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const { service: s, parent } = await setup({
    caller:
      (standard) =>
      async (...a) => {
        await wait;
        return standard(...a);
      }
  });
  try {
    const id = await s.invoke('tags.start', {
      inputHash: s.snapshot().tagDraft!.inputHash,
      profileId: model.id,
      requestId: 'cancel'
    });
    await s.invoke('run.cancel');
    release();
    await settled(s);
    const r = s.store!.db.run(id);
    assert.equal(r.planning!.report, undefined);
    assert.equal(r.accepted, false);
    assert.equal(s.snapshot().project!.stage, 'S01');
    const events = await s.invoke('run.events', { id, afterSeq: 0, limit: 1 });
    assert.equal(events.length, 1);
    const next = await s.invoke('run.events', { id, afterSeq: events[0].seq });
    assert.ok(next.every((e: any) => e.seq > events[0].seq && e.runId === id));
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('八组数量边界、版本固定、跨组同名与精确配方', () => {
  const b = tagBundle(skill),
    p = newProject('边界', 'unused', {});
  for (const g of b.taxonomy.groups.filter((g) => g.id !== 'reading.main')) {
    const [section, field] = g.id.split('.') as ['reading' | 'content', string];
    const value = structuredClone(input);
    const block = value.selection[section] as Record<string, string | string[]>;
    block[field] = b.taxonomy.options
      .filter((o) => o.group === g.id)
      .slice(0, g.max)
      .map((o) => o.id);
    assert.ok(makeBookSpec(p, value, 1, b.taxonomy));
    block[field].push(b.taxonomy.options.find((o) => o.group === g.id && !block[field].includes(o.id))!.id);
    assert.throws(() => makeBookSpec(p, value, 1, b.taxonomy));
  }
  const value = structuredClone(input);
  value.selection.reading.plot = ['content.plot.001'];
  assert.throws(() => makeBookSpec(p, value, 1, b.taxonomy), /错分组/);
  const spec = makeBookSpec(p, input, 1, b.taxonomy);
  assert.throws(() => compileTags({ ...spec, taxonomyVersion: 'unknown' }, skill), /版本/);
  const recipe = b.recipes[0],
    selection = structuredClone(input);
  selection.selection.reading.main = recipe.mainOptionIds[0];
  selection.selection.reading.plot = [];
  for (const concept of recipe.allOfConceptIds) {
    const option = b.taxonomy.options.find((o) => o.conceptId === concept && o.group !== 'reading.main')!;
    const [section, field] = option.group.split('.') as ['reading' | 'content', string];
    (selection.selection[section] as Record<string, string[]>)[field].push(option.id);
  }
  assert.ok(
    compileTags(makeBookSpec(p, selection, 1, b.taxonomy), skill).recipes.some((r: any) => r.id === recipe.id)
  );
  const duo = b.taxonomy.options.find(
    (o) =>
      o.group === 'reading.plot' &&
      b.taxonomy.options.some((v) => v.group === 'content.plot' && v.label === o.label)
  )!;
  selection.selection.reading.plot = [duo.id];
  selection.selection.content.plot = [
    b.taxonomy.options.find((o) => o.group === 'content.plot' && o.label === duo.label)!.id
  ];
  assert.equal(
    compileTags(makeBookSpec(p, selection, 1, b.taxonomy), skill).options.filter((o) => o.label === duo.label)
      .length,
    2
  );
});

test('重启、模型交接保留策划及预算；未知请求需明确重试', async () => {
  let first = true;
  const { service: s, parent } = await setup({
    caller:
      (standard) =>
      async (...a) => {
        if (first && a[3][0].name === 'submit_planning_review') {
          first = false;
          throw new RequestError('模拟已发送后断流', true);
        }
        return standard(...a);
      }
  });
  try {
    let r = await start(s);
    assert.equal(r.status, 'unknown');
    assert.ok(r.planning!.report);
    assert.equal(r.usage.cost, null);
    const root = s.store!.root;
    s.close();
    await s.open(root);
    await assert.rejects(() => s.invoke('run.resume', { id: r.id }), /未知/);
    const changed = { ...model, id: 'handoff', model: 'new-writer' };
    s.profiles.push(changed);
    const id = await s.invoke('run.handoff', { id: r.id, profileId: changed.id, retryUnknown: true });
    await settled(s);
    r = s.store!.db.run(id);
    assert.equal(r.planning!.phase, 'awaiting_direction');
    assert.equal(r.rounds, 3);
    assert.equal(r.usage.cost, null);
    assert.equal(s.store!.db.runs().find((v) => v.id !== id)!.status, 'discarded');
    r = await select(s, id, 'direction-3');
    assert.equal(r.planning!.phase, 'ready');
    await s.invoke('run.accept', { id, proposalHash: r.proposalHash });
    assert.equal(s.store!.db.project().tags!.contract.directionId, 'direction-3');
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('标签约束贯穿聊天与完整工作流，正文证据随一次采纳落库', async () => {
  let s: Service;
  const phases = new Set<string>();
  const setupResult = await setup({
    config: { targetWords: 400, chapterWords: 200, minWords: 200, maxWords: 200, batchSize: 2 },
    caller:
      (standard) =>
      async (...args) => {
        const [profile, system, messages, tools, , onDelta] = args;
        if (tools[0]?.name.startsWith('submit_')) return standard(...args);
        const p = s.store!.db.project();
        assert.match(system, /禁止后宫/);
        assert.doesNotMatch(system, /恰好三个/);
        if (system.includes('你独立检查')) {
          const input = JSON.parse(messages[0].content);
          return { text: JSON.stringify({ decisions: input.items.map((item: any) => {
            const source = input.sources.find((source: any) => source.path === (item.path ?? item.fact.evidence[0].path));
            return { id: item.id, verdict: 'supported', reason: '合成原文支持该记录', evidence: [{ path: source.path, quote: source.content.slice(-12) }] };
          }) }), calls: [], native: {}, usage: { input: 1, output: 1, cost: 0, currency: 'USD' }, stop: 'complete' };
        }
        if (system.includes('当前是自由讨论'))
          return {
            text: '沿用本书契约讨论。',
            calls: [],
            native: {},
            usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
            stop: 'complete'
          };
        const r = s.store!.db.runs().find((r) => r.status === 'running')!;
        phases.add(r.pipeline?.phase ?? r.stage);
        if (r.memoryRepair) {
          const input = JSON.parse(messages[0].content);
          assert.ok(input.changedSources.some((source: any) => source.path === contractPath && source.content.includes('禁止后宫')));
          return { text: JSON.stringify({ content: null, reason: '标签承诺的本章兑现符合后续安排，保留原有计划', records: [], withdrawn: [] }),
            calls: [], native: {}, usage: { input: 1, output: 1, cost: 0, currency: 'USD' }, stop: 'complete' };
        }
        if (!tools.length) {
          const text = fixture(p, prosePath(p.chapter), s);
          onDelta?.(text);
          return {
            text,
            calls: [],
            native: {},
            usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
            stop: 'complete'
          };
        }
        if (messages.at(-1)?.role === 'tool')
          return {
            text: '已提交候选',
            calls: [],
            native: {},
            usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
            stop: 'complete'
          };
        const outputs =
          r.pipeline?.phase === 'review'
            ? [qualityPath(p.chapter)]
            : stageOutputs(r.pipeline?.phase === 'memory' ? 'S11' : p.stage, p);
        const changes = outputs.map((file) => ({
          path: file,
          content: fixture(p, file, s),
          baseHash: s.store!.db.document(file)?.hash ?? null
        }));
        const response = result('propose_changes', { changes });
        if (r.pipeline?.phase === 'memory') {
          const prose = r.changes.find((c) => c.path === prosePath(p.chapter))!;
          response.calls.push({
            id: crypto.randomUUID(),
            name: 'propose_memory',
            arguments: JSON.stringify({
              facts: [
                {
                  id: 'tag-event-' + p.chapter,
                  subject: '主角',
                  predicate: '兑现',
                  value: '本章行动呈现有限资源',
                  kind: 'event',
                  category: 'promise',
                  fromChapter: p.chapter,
                  revealedAt: p.chapter,
                  evidence: [
                    { path: prose.path, hash: hash(prose.content), quote: prose.content.slice(-12) }
                  ],
                  tagRefs: {
                    inputHash: p.tags!.spec.inputHash,
                    contractRevision: 1,
                    optionIds: [p.tags!.knowledge.options[0].id],
                    constraintIds: []
                  }
                }
              ]
            })
          });
        }
        return response;
      }
  });
  s = setupResult.service;
  try {
    let r = await select(s, (await start(s)).id);
    await s.invoke('run.accept', { id: r.id, proposalHash: r.proposalHash });
    const p = s.store!.db.project();
    const scoped = structuredClone(p);
    scoped.config.viewpointCharacterId = 'entity-test';
    const context = assembleContext(s.store!, scoped, 'S02', '人物视角写作', model);
    assert.ok(
      context.sources.some((v) => v.path === contractPath && v.required && v.content.includes('禁止后宫'))
    );
    const conv = s.snapshot().conversations![0];
    const turn = s.chat!.prepare(conv.id, '按本书设定讨论', model.id);
    await s.chat!.drive(turn.id);
    assert.equal(s.chat!.records.get('conversation_turns', turn.id).tagBinding?.contractRevision, 1);
    let count = 0;
    while (!s.store!.db.project().finished) {
      const id = await s.invoke('run.start', { request: '按已批准标签继续当前阶段', profileId: model.id });
      await settled(s);
      r = s.store!.db.run(id);
      assert.equal(
        r.status,
        'awaiting_review',
        JSON.stringify({ stage: r.stage, error: r.error, issues: r.issues })
      );
      assert.equal(r.tagBinding!.contractRevision, 1);
      if (r.memoryRepair) {
        assert.ok(r.memoryRepair.sources.includes(contractPath));
        assert.equal(r.memoryRepair.sourceHashes![contractPath], s.store!.db.document(contractPath)!.hash);
        assert.equal(r.continuity?.mode, 'forward');
      } else assert.ok(r.manifest?.sources.some((v) => v.path === contractPath && v.required));
      if (r.pipeline) assert.equal(s.store!.db.facts().filter((f) => f.tagRefs).length, r.chapter - 1);
      await s.invoke('run.accept', {
        id,
        proposalHash: r.proposalHash,
        warningReason: '夹具只验证流程与证据，不验证文学质量'
      });
      assert.ok(++count < 20);
    }
    assert.ok(phases.has('prose') && phases.has('review') && phases.has('memory'));
    assert.equal(s.store!.db.facts().filter((f) => f.tagRefs).length, 2);
    const f = structuredClone(s.store!.db.facts().find((f) => f.tagRefs)!);
    f.tagRefs!.optionIds = ['unknown'];
    assert.ok(validateEvidence(s.store!, f, 2).some((v) => v.includes('不存在')));
    const d = s.snapshot().tagDraft!;
    await s.invoke('tags.saveDraft', {
      expectedRevision: d.revision,
      input: { ...input, mustAvoid: ['禁止后宫', '禁止突然复活'] }
    });
    r = await select(s, (await start(s)).id);
    const diff = await s.invoke('tags.diff', { id: r.id });
    assert.ok(diff.affected.some((a: any) => a.path === prosePath(1) && a.certainty === 'evidence'));
    await s.invoke('run.accept', { id: r.id, proposalHash: r.proposalHash });
    assert.equal(s.store!.db.project().tags!.contract.revision, 2);
    const priorFact = s.store!.db.facts().find((f) => f.tagRefs)!;
    assert.ok(validateEvidence(s.store!, priorFact, 2).some(issue => issue.includes('待核对')));
    assert.deepEqual(validateEvidence(s.store!, priorFact, 2, [], priorFact.evidence.map(e => e.path)), []);
  } finally {
    s.close();
    fs.rmSync(setupResult.parent, { recursive: true, force: true });
  }
});

test('契约展示外部变化不能采纳，允许从结构化正式记录恢复', async () => {
  const { service: s, parent } = await setup();
  try {
    const r = await select(s, (await start(s)).id);
    await s.invoke('run.accept', { id: r.id, proposalHash: r.proposalHash });
    const accepted = s.store!.readAccepted(contractPath).content;
    fs.writeFileSync(path.join(s.store!.root, contractPath), '外部修改');
    assert.throws(() => assembleContext(s.store!, s.store!.db.project(), 'S02', '', model), /外部修改/);
    await assert.rejects(() => s.invoke('tags.restoreProjection', { baseHash: 'wrong' }), /再次改变/);
    await s.invoke('tags.restoreProjection', { baseHash: hash('外部修改') });
    assert.equal(s.store!.read(contractPath).content, accepted);
    assert.equal(s.store!.db.project().stage, 'S02');
    assert.equal(s.store!.db.project().tags!.contract.revision, 1);
  } finally {
    s.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
