import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { chapterAuditInput } from '../src/core/chapter-audit';
import { memoryReviewInput, memoryReviewMatches } from '../src/core/memory-review';
import { futurePlanReviewInput, futurePlanReviewMatches, confirmedAlignedPlans } from '../src/core/future-plan-review';
import { hash, prosePath, stageOutputs } from '../src/core/domain';
import { controllerRules } from '../src/core/agent-control';
import { planningReportContext } from '../src/core/creation-prompts';
import { factSchema } from '../src/shared/types';
import type { TagPlanning } from '../src/shared/tags';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';

const skill = path.resolve('resources/skill');
const profile = { ...fakeProfile, contextLimit: 1000000, outputLimit: 32768, stream: false };

async function setup() {
  const requests: any[] = [];
  const service = new Service(skill, () => {}, async (_profile, system, messages) => {
    const input = JSON.parse(messages[0].content);
    requests.push(input);
    const memory = { decisions: (input.items ?? []).map((item: any) => ({ id: item.id,
      verdict: item.fact.value === '已经交给医生' ? 'contradicted' : 'supported',
      reason: '递出记录本不代表已经交付，需保留原文动作边界。', evidenceRefs: [0] })) };
    const plans = { decisions: (input.plans ?? []).map((plan: any) => ({ path: plan.path, verdict: 'consistent',
      reason: '后续求医计划与当前递出记录本的行为相容。',
      planQuote: (plan.content ?? input.sources.find((s: any) => s.path === plan.path).content).slice(0, 30),
      proseQuote: (input.prose.content ?? input.sources.find((s: any) => s.path === input.prose.path).content).slice(0, 30) })) };
    return fakeResult(JSON.stringify(system.includes('本次独立章后核对包含两个检查') ? { memory, plans } : input.items ? memory : plans));
  });
  service.profiles = [structuredClone(profile)];
  await service.invoke('project.create', { parent: isolatedRoot('incremental-review'), title: '增量核对', premise: '医生与调查员核对记录',
    config: { defaultProfileId: profile.id, maxRounds: 40, preview: { enabled: false } } });
  const store = service.store!;
  let p = store.db.project();
  for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'] as const) {
    store.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    p = store.db.project();
  }
  p.stage = 'S10'; store.db.set('project', p);
  const run = service.makeRun('stage', '核对本章事实与未写计划');
  run.agentRulesHash = controllerRules(skill).hash;
  const prose = service.change(prosePath(1), fixture(p, prosePath(1), service));
  run.changes = [prose]; run.pipeline!.proseHash = hash(prose.content);
  run.facts = Array.from({ length: 3 }, (_, i) => factSchema.parse({ id: `fact-${i}`, subject: '阿宁',
    predicate: `记录本动作${i}`, value: i ? '向医生递出记录本' : '已经交给医生', kind: 'event', category: 'item',
    fromChapter: 1, revealedAt: 1,
    evidence: [{ path: prose.path, hash: hash(prose.content), quote: '阿宁推开诊室的门，把记录本递到灯下。' }] }));
  store.db.saveRun(run);
  const audit = () => (service.runner as any).auditMemory(run, store.db.project(), service.profiles[0], new AbortController().signal);
  return { service, store, run, requests, audit };
}

test('仅修改一条事实只复查该条；正文和计划未变不再审查计划，负面回执与重启均可复用', async () => {
  const f = await setup();
  try {
    await f.audit();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].items.length, 3);
    assert.ok(f.requests[0].plans.length);
    assert.equal(f.run.memoryReview!.issues.length, 1);
    assert.equal(f.run.futurePlanReview, undefined, '事实未通过时不能提前认证后续计划');
    f.run.facts[0].value = '向医生递出记录本';
    await f.audit();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1].items.map((i: any) => i.id), ['fact-0']);
    assert.equal(f.requests[1].plans, undefined);
    assert.deepEqual(f.run.memoryReview!.issues, []);
    assert.equal(confirmedAlignedPlans(f.store, f.run).size, futurePlanReviewInput(f.store, f.run).plans.length);
    f.run.memoryReview = undefined; f.run.futurePlanReview = undefined;
    await f.audit();
    assert.equal(f.requests.length, 2, '已收到的有效结论不能因内存状态丢失重复请求');
    f.run.facts[0].value = '已经交给医生';
    assert.equal(confirmedAlignedPlans(f.store, f.run).size, 0, '未经核对的事实变动仍阻止认证');
    await f.audit();
    assert.equal(f.requests.length, 2);
    assert.match(f.run.memoryReview!.issues[0], /不代表已经交付/);
    assert.equal(f.run.futurePlanReview, undefined);
    assert.equal(memoryReviewMatches(f.store, f.run), true);
  } finally { await f.service.drain(); }
});

test('来源、作者约定、审核模型变化均使增量回执失效；新增项不能继承其他项结论', async () => {
  const f = await setup();
  try {
    f.run.facts[0].value = '向医生递出记录本';
    await f.audit();
    const mutateAndAudit = async (mutate: () => void, expectedItems: number) => {
      const at = f.requests.length;
      mutate(); await f.audit();
      const memoryRequests = f.requests.slice(at).filter(input => input.items);
      assert.equal(memoryRequests.length, 1);
      assert.equal(memoryRequests[0].items.length, expectedItems);
      assert.deepEqual(f.run.memoryReview!.issues, []);
    };
    await mutateAndAudit(() => { f.run.facts.push({ ...structuredClone(f.run.facts[1]), id: 'new-fact' }); }, 1);
    await mutateAndAudit(() => {
      const p = f.store.db.project(); p.config.constraints += '保留作者最新约定'; f.store.db.set('project', p);
    }, 4);
    await mutateAndAudit(() => { f.service.profiles[0].version++; }, 4);
    await mutateAndAudit(() => {
      f.run.changes[0].content += '\n医生还没有接过记录本。';
      f.run.pipeline!.proseHash = hash(f.run.changes[0].content);
      for (const fact of f.run.facts) fact.evidence[0].hash = f.run.pipeline!.proseHash;
    }, 4);
    const shared = chapterAuditInput(memoryReviewInput(f.store, f.run), futurePlanReviewInput(f.store, f.run));
    assert.equal(new Set(shared.sources.map(s => s.path)).size, shared.sources.length);
    assert.ok(f.run.rounds <= 12, '保留原请求计数和上限，不依靠重置计数');
  } finally { await f.service.drain(); }
});

test('旧后续计划指纹兼容精确旧输入，正文或事实变更不冒充旧回执', async () => {
  const f = await setup();
  try {
    const input = futurePlanReviewInput(f.store, f.run);
    f.run.futurePlanReview = { fingerprint: hash(JSON.stringify({ chapter: input.chapter, fromChapter: input.fromChapter,
      prose: input.prose, plans: input.plans, facts: f.run.facts })), decisions: [] };
    assert.equal(futurePlanReviewMatches(f.run, input), true);
    f.run.facts[0].value = '向医生递出记录本';
    assert.equal(futurePlanReviewMatches(f.run, input), false);
    assert.equal(input.fingerprint, futurePlanReviewInput(f.store, f.run).fingerprint, '新指纹依赖实际正文与计划，不重复装载提取结果');
  } finally { await f.service.drain(); }
});

test('完整方案只传所选方向，保留全部作者约束、假设和原始三案', () => {
  const report = { directions: [{ id: 'a', storyEngine: '甲' }, { id: 'b', storyEngine: '乙' }, { id: 'c', storyEngine: '丙' }],
    assumptions: [{ id: 'shared', text: '全局作者要求' }], diagnosis: [{ message: '仍需注意的约束' }] };
  const task = { phase: 'contract', selectedDirectionId: 'b', report } as unknown as TagPlanning;
  const context = planningReportContext(task)!;
  assert.deepEqual(context.directions.map(d => d.id), ['b']);
  assert.deepEqual(context.assumptions, report.assumptions);
  assert.deepEqual(context.diagnosis, report.diagnosis);
  assert.equal(report.directions.length, 3);
  assert.equal(planningReportContext({ ...task, phase: 'planning' }), report);
});
