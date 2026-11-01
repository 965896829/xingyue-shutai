import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Service } from '../src/core/service';
import { directionPromptResources, planningReportContext } from '../src/core/creation-prompts';
import { planningRulesHash } from '../src/core/tag-planning';
import { validateReport, tagHash, tagBundle } from '../src/core/tags';
import { hash, paths } from '../src/core/domain';
import { emptyTagInput, concisePlanningReportSchema, planningReportSchema, type TagPlanning } from '../src/shared/tags';
import { runSchema } from '../src/shared/contract-schemas';
import { planKinds } from '../src/shared/creation';
import type { Caller } from '../src/core/runner';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';

const skillRoot = path.resolve('resources/skill');
const compactReport = (): z.infer<typeof concisePlanningReportSchema> => ({
  positioning: '事故调查员在死亡权规则下寻找生路。',
  assumptions: [
    { id: 'common-limit', text: '公证处每天只开放两小时。', critical: true, directionIds: [] },
    { id: 'rescue-cost', text: '帮助母女赎命会暴露主角的调查路线。', critical: false, directionIds: ['rescue'] }
  ],
  directions: ['rescue', 'market', 'truth'].map((id, index) => ({
    id, title: ['母女赎命', '黑市交易', '追查旧案'][index],
    logline: ['调查员拿自己异常的权证作筹码，替母女赎命。', '调查员利用事故责任线索，在死亡权黑市中交换生路。', '调查员从七年前的死亡记录追查异常权证的来源。'][index],
    storyEngine: ['寻找持证人、付出情报代价、赎回人命，接着面对新的追查者。', '核实权证、交换筹码、承受交易反制，逐步追查定价背后的组织。', '重访证人、验证旧案、承担暴露代价，每条新证据引出更深的矛盾。'][index],
    openingDecision: '先救被困的女儿，还是趁持证人离开追回自己的线索？',
    firstVolumeChange: ['从独自求生转为组织赎命互助。', '从散户变为能影响交易规则的中间人。', '查清一个关键证人的隐瞒，发现死亡记录被篡改。'][index],
    differenceFromOtherDirections: ['以救人为行动目标，靠关系和代价推进。', '以交易和利益冲突推进，重点在博弈。', '以证据和悬念推进，重点在调查。'][index],
    longRunRisk: '避免重复寻找持证人，让每次成功改变关系和规则压力。',
    intentChanges: index === 1 ? ['原先先救母女，本案先进入黑市寻找可交换的权证。'] : []
  })),
  recommendedDirectionId: 'rescue', recommendationReasons: ['开篇有明确的人命取舍，主角的调查能力能直接推动行动。']
});

async function settled(service: Service) {
  for (let n = 0; service.runner?.controller; n++) {
    if (n > 2000) throw new Error('离线流程未结束');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await new Promise<void>(resolve => setImmediate(resolve));
}

async function setup(transform?: (report: ReturnType<typeof compactReport>, task: TagPlanning) => ReturnType<typeof compactReport>) {
  const root = isolatedRoot('concise-directions');
  const calls: { name: string; input: Record<string, any>; schema: Record<string, any>; system: string }[] = [];
  let service: Service;
  const caller: Caller = async (_profile, system, messages, tools) => {
    const run = service.store!.db.runs().find(run => run.status === 'running')!;
    const task = run.planning!, name = tools[0].name;
    const input = JSON.parse(messages[0].content);
    calls.push({ name, input, schema: tools[0].parameters, system });
    let value: unknown;
    if (name === 'submit_planning_report') value = transform?.(compactReport(), task) ?? compactReport();
    else if (name === 'submit_planning_review') value = { issues: [] };
    else if (name === 'submit_creation_contract') value = {
      directionId: task.selectedDirectionId, constraints: [{ id: 'rule-1', optionIds: [],
        text: '死亡权规则与事故调查员身份保持不变，按照作者修改后的开放时间展开。',
        scope: { entityIds: [], fromChapter: null, toChapter: null }, evidenceRef: task.selectedDirectionId }],
      tagCoverage: [], openQuestions: [], premiseDocument: fixture(service.store!.db.project(), paths.seed, service),
      plan: { statements: Object.keys(planKinds).map(kind => ({ id: 'plan-' + kind, kind,
        text: '事故调查员在死亡权规则下核实线索并帮助母女赎命，必须承担暴露的代价。',
        optionIds: [], sourceRefs: [task.selectedDirectionId], payoffStage: 'ongoing' })), tagRoles: [] }
    };
    else throw new Error('意外模型请求：' + name);
    return { ...fakeResult(''), stop: 'tools', calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(value) }] };
  };
  service = new Service(skillRoot, () => {}, caller);
  service.profiles = [{ ...structuredClone(fakeProfile), outputLimit: 8000 }];
  await service.invoke('project.create', { parent: root, premise: '事故调查员持有自己的死亡权。',
    creationInput: { ...emptyTagInput(), premise: '事故调查员持有自己的死亡权。', mustKeep: ['保留事故调查员身份和死亡权规则'] },
    config: { defaultProfileId: fakeProfile.id, expressionRules: { enabled: false }, preview: { enabled: false, maxCalls: 0 } } });
  const request = { inputHash: service.snapshot().tagDraft!.inputHash, profileId: fakeProfile.id, requestId: crypto.randomUUID() };
  const id = await service.invoke('creation.start', request);
  await settled(service);
  return { service, calls, id, request, root };
}

test('新三案省去诊断和逐标签输出，但保留故事因果、区别、新增设定与原意调整', () => {
  const schema = z.toJSONSchema(concisePlanningReportSchema) as any;
  assert.deepEqual(Object.keys(schema.properties).sort(), ['assumptions', 'directions', 'positioning', 'recommendationReasons', 'recommendedDirectionId']);
  assert.equal(schema.properties.directions.items.properties.tagCoverage, undefined);
  for (const field of ['storyEngine', 'openingDecision', 'firstVolumeChange', 'differenceFromOtherDirections', 'longRunRisk', 'intentChanges'])
    assert.ok(schema.properties.directions.items.required.includes(field));
  const task = { directionFormatVersion: 1, spec: { selection: { reading: { main: 'genre', theme: [], role: [], plot: [] }, content: { plot: [], emotion: [], persona: [], world: [] } } } } as unknown as TagPlanning;
  const report = validateReport(compactReport(), task);
  assert.deepEqual(report.assumptions, compactReport().assumptions);
  assert.deepEqual(report.directions[1].intentChanges, compactReport().directions[1].intentChanges);
  assert.deepEqual(report.directions.map(direction => direction.tagCoverage), [[], [], []]);
  assert.deepEqual(report.diagnosis, []);
  assert.deepEqual(report.unresolvedQuestions, []);
  assert.throws(() => validateReport(compactReport(), { ...task, directionFormatVersion: undefined }), /diagnosis|tagCoverage|marketClaims/);
  const bad = compactReport(); bad.assumptions[0].directionIds = ['missing'];
  assert.throws(() => validateReport(bad, task), /不存在的方向/);
  const duplicate = compactReport(); duplicate.directions[1].id = duplicate.directions[0].id;
  assert.throws(() => validateReport(duplicate, task), /方向编号重复/);
  assert.ok(JSON.stringify(schema).length < JSON.stringify(z.toJSONSchema(planningReportSchema)).length);
});

test('真实服务三案只发一次请求，重复点击不重发，新增设定及修改意见传入完整方案', async () => {
  const f = await setup();
  try {
    let run = f.service.store!.db.run(f.id);
    assert.equal(run.status, 'awaiting_input', run.error ?? '');
    assert.equal(run.rounds, 1); assert.equal(run.planning!.formatRepairs, 0);
    assert.equal(runSchema.parse(run).planning!.directionFormatVersion, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].schema.properties.diagnosis, undefined);
    assert.match(f.calls[0].system, /模型新增的关键身份/);
    assert.doesNotMatch(f.calls[0].system, /每案tagCoverage覆盖/);
    assert.equal(await f.service.invoke('creation.start', f.request), f.id);
    await settled(f.service); assert.equal(f.calls.length, 1);
    const originalReport = structuredClone(run.planning!.report);
    await f.service.invoke('tags.selectDirection', { id: f.id, reportHash: run.planning!.reportHash!, directionId: 'rescue',
      acceptAssumptions: true, resolutions: { 'common-limit': '公证处改为每天开放四小时。' } });
    await settled(f.service);
    run = f.service.store!.db.run(f.id);
    assert.equal(run.planning!.phase, 'ready', run.error ?? '');
    assert.equal(run.planning!.formatRepairs, 0);
    assert.deepEqual(f.calls.map(call => call.name), ['submit_planning_report', 'submit_creation_contract', 'submit_planning_review']);
    assert.deepEqual(run.planning!.report, originalReport, '后续展开不改写已展示的三案');
    assert.equal(f.calls[1].input.resolutions['common-limit'], '公证处改为每天开放四小时。');
    assert.equal(f.calls[1].input.resolutions['rescue-cost'], '作者已确认采用此设定');
    assert.equal(f.calls[1].input.report.directions.length, 1);
    assert.deepEqual(f.calls[1].input.report.assumptions, originalReport!.assumptions);
    assert.ok(run.changes.some(change => change.path === paths.seed));
  } finally { await f.service.drain(); }
});

test('新格式保留一案换两案不复查，冻结设定保持原样，恢复不重发完成请求', async () => {
  const f = await setup((report, task) => {
    if (!task.regenerate) return report;
    return { ...report, directions: report.directions.map(direction => direction.id === 'rescue' ? direction
      : { ...direction, logline: direction.logline + '从敌对持证人的困局切入。' }) };
  });
  try {
    let run = f.service.store!.db.run(f.id);
    const original = structuredClone(run.planning!.report!);
    await f.service.invoke('tags.reroll', { id: f.id, reportHash: run.planning!.reportHash!, keepDirectionIds: ['rescue'], instruction: '另外两案增加对抗。' });
    await settled(f.service); run = f.service.store!.db.run(f.id);
    assert.equal(run.status, 'awaiting_input', run.error ?? '');
    assert.equal(run.planning!.formatRepairs, 0);
    assert.deepEqual(run.planning!.report!.directions[0], original.directions[0]);
    assert.deepEqual(run.planning!.report!.assumptions, original.assumptions);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].input.report, undefined);
    assert.equal(f.calls[1].input.regenerate.original.directions.length, 3);
    const root = f.service.store!.root;
    await f.service.invoke('project.open', { root });
    const restored = f.service.store!.db.run(f.id);
    assert.deepEqual(restored.planning!.report, run.planning!.report);
    assert.equal(restored.planning!.directionFormatVersion, 1);
    await f.service.runner!.drive(f.id);
    assert.equal(f.calls.length, 2, '本地恢复完整候选不触发新请求');
  } finally { await f.service.drain(); }
});

test('方向语义更新覆盖新旧任务指纹，保留报告和标签知识原版本', async () => {
  const f = await setup();
  const root = path.join(f.root, 'skill-copy'); fs.cpSync(skillRoot, root, { recursive: true });
  try {
    const project = f.service.store!.db.project(), task = f.service.store!.db.run(f.id).planning!;
    const before = { legacy: planningRulesHash(root, project), current: planningRulesHash(root, project, task), knowledge: tagBundle(root).version };
    const file = path.join(root, 'direction-planning/planner.system.md');
    fs.appendFileSync(file, '\n测试用规则变化。');
    assert.throws(() => directionPromptResources(root), /完整性/);
    assert.throws(() => planningRulesHash(root, project), /完整性/, '旧任务也校验当前规则');
    fs.writeFileSync(path.join(root, 'direction-planning/resources.lock.json'), JSON.stringify({ 'planner.system.md': hash(fs.readFileSync(file)) }));
    assert.notEqual(planningRulesHash(root, project, task), before.current);
    assert.equal(tagBundle(root).version, before.knowledge);
    assert.notEqual(planningRulesHash(root, project), before.legacy);
    assert.equal(tagHash(planningReportContext(task)), tagHash(task.report));
  } finally { await f.service.drain(); }
});

test('没有新版标记的旧三案断点按原规则恢复，不迁移输出或消耗新请求', async () => {
  const f = await setup();
  try {
    const run = f.service.store!.db.run(f.id), task = run.planning!;
    delete task.directionFormatVersion;
    run.skillHash = planningRulesHash(skillRoot, f.service.store!.db.project());
    task.phase = 'reviewing_report'; run.status = 'paused';
    run.rounds = f.service.store!.db.project().config.maxRounds;
    const original = structuredClone(task.report);
    f.service.store!.db.saveRun(run);
    await f.service.invoke('project.open', { root: f.service.store!.root });
    await f.service.runner!.drive(f.id);
    const restored = f.service.store!.db.run(f.id);
    assert.equal(restored.status, 'awaiting_input', restored.error ?? '');
    assert.equal(restored.planning!.directionFormatVersion, undefined);
    assert.equal(restored.rounds, run.rounds);
    assert.deepEqual(restored.planning!.report, original);
    assert.equal(f.calls.length, 1);
  } finally { await f.service.drain(); }
});
