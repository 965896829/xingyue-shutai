import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chapterSlice } from '../src/core/context-slices';
import { contextChanged } from '../src/core/context-compiler';
import { chapterAuditInput, canCombineChapterAudit, parseChapterAudit } from '../src/core/chapter-audit';
import { memoryReviewInput, memoryReviewMatches, memoryReviewIssues } from '../src/core/memory-review';
import { futurePlanReviewInput, confirmedAlignedPlans } from '../src/core/future-plan-review';
import { Service } from '../src/core/service';
import { hash, paths, stageOutputs, prosePath, qualityPath, updatePath } from '../src/core/domain';
import { factSchema, type Run } from '../src/shared/types';
import { loadNamingRules, selectNamingModules } from '../src/core/naming';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import type { Caller } from '../src/core/runner';
import { controllerRules } from '../src/core/agent-control';
import { fixtureCoverage, fixtureAuditEvidence } from './fixtures/chapter-coverage';
import type { ChapterCoverage } from '../src/shared/chapter-memory';

const skill = path.resolve('resources/skill');
const profile = { ...fakeProfile, contextLimit: 1000000, outputLimit: 32768, stream: false };

test('分卷字段及无章字节奏范围能截取正文上下文，保留全局约束及准确Unicode来源范围', () => {
  const text = '# 分卷大纲\n\n全局禁区：𠮷第七卷才揭露死因。\n\n## 第一卷 谁拿着我的命\n- 章节范围：001—180。\n- 目标：找回权证。\n### 卷内推进\n先救母女。\n\n## 第二卷 死亡交易所\n- 章节范围：181—300。\n- 目标：建立交易所。\n\n## 未定安排\n保留作者备注。\n';
  const sliced = chapterSlice(text, 1);
  assert.match(sliced.content, /第七卷才揭露死因/);
  assert.match(sliced.content, /先救母女/);
  assert.match(sliced.content, /保留作者备注/);
  assert.doesNotMatch(sliced.content, /建立交易所|第二卷/);
  assert.match(chapterSlice(text, 175, 200).content, /先救母女/);
  assert.match(chapterSlice(text, 175, 200).content, /建立交易所/);
  assert.equal(sliced.content, sliced.ranges.map(r => Array.from(text).slice(r.start, r.end).join('')).join('\n\n'));
  assert.equal(chapterSlice(text, 900).content, text, '无法匹配时不得猜测删除');
  const rhythm = '# 节奏\n全局约束。\n| 单元 | 任务 |\n| --- | --- |\n| 001—003 | 异常求生 |\n| 004—007 | 母女赎命 |\n';
  assert.match(chapterSlice(rhythm, 2).content, /异常求生/);
  assert.doesNotMatch(chapterSlice(rhythm, 2).content, /母女赎命/);
});

test('复合题材仅按明确别名预载命名模块，不把否定与未知标签猜成世界设定', () => {
  const rules = loadNamingRules(skill);
  const selected = selectNamingModules(rules, '都市规则悬疑、智斗、大逃杀');
  assert.deepEqual(selected.modules.map(m => m.id), ['G01', 'G14', 'T01']);
  assert.deepEqual(selected.unmatched, []);
  assert.deepEqual(selectNamingModules(rules, '不是都市规则悬疑').modules.map(m => m.id), ['G37']);
});

test('目标模板本地预载到首个请求，外部变更仍使上下文失效，无读模板模型往返', async () => {
  let service: Service, calls = 0;
  service = new Service(skill, () => {}, async (_p, _s, messages) => {
    calls++;
    const input = JSON.parse(messages[0].content);
    const targets = input.sources.filter((s: any) => s.path === paths.seed);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].mode, 'full');
    assert.equal(targets[0].content, service.store!.readAccepted(paths.seed).content);
    const p = service.store!.db.project();
    return { ...fakeResult(''), stop: 'tools', calls: [{ id: 'seed', name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(paths.seed, fixture(p, paths.seed, service))] }) }] };
  });
  service.profiles = [profile];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('preload'), title: '模板预载', premise: '调查员寻找权证', config: { defaultProfileId: profile.id } });
    const run = service.makeRun('stage', '完成设定'); service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const done = service.store!.db.run(run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(calls, 1);
    assert.equal(contextChanged(service.store!, done.manifest!), false);
    fs.appendFileSync(path.join(service.store!.root, paths.seed), '\n作者外部修改');
    assert.equal(contextChanged(service.store!, done.manifest!), true);
  } finally { await service.drain(); }
});

function proposal(changes: unknown[], facts?: unknown[], coverage?: ChapterCoverage) {
  return { ...fakeResult(''), native: null, stop: 'tools' as const, calls: [
    ...(changes.length ? [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes }) }] : []),
    ...(facts ? [{ id: crypto.randomUUID(), name: 'propose_memory', arguments: JSON.stringify({ facts, complete: true, coverage }) }] : [])
  ] };
}

test('单独后续计划核对也携带错误修复回执，预算仍由原任务累计', async () => {
  let calls = 0;
  const created = await setup(async (_p, system, messages) => {
    calls++;
    assert.match(system, /你独立核对本章实际正文/);
    const input = JSON.parse(messages[0].content);
    if (calls === 1) return fakeResult('{"decisions":[]}');
    assert.equal(messages.length, 3);
    assert.equal(messages[1].content, '{"decisions":[]}');
    assert.match(messages[2].content, /逐份覆盖/);
    return fakeResult(JSON.stringify({ decisions: input.plans.map((plan: any) => ({ path: plan.path,
      verdict: 'consistent', reason: '未来计划与当前递出动作没有冲突。',
      planQuote: plan.content.slice(0, 30), proseQuote: input.prose.content.slice(0, 30) })) }));
  });
  try {
    const { service, run } = created, p = service.store!.db.project();
    run.agentRulesHash = controllerRules(skill).hash;
    const prose = service.change(prosePath(1), fixture(p, prosePath(1), service));
    run.changes = [prose]; run.pipeline!.proseHash = hash(prose.content);
    run.facts = [factSchema.parse({ id: 'record', subject: '阿宁', predicate: '动作', value: '向医生递出记录本',
      kind: 'event', category: 'item', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '阿宁推开诊室的门，把记录本递到灯下。' }] })];
    service.store!.db.saveRun(run);
    await (service.runner as any).auditFuturePlans(run, p, profile, new AbortController().signal);
    assert.equal(calls, 2); assert.equal(run.rounds, 2);
    assert.equal(run.futurePlanReview!.decisions.length, futurePlanReviewInput(service.store!, run).plans.length);
    await (service.runner as any).auditFuturePlans(run, p, profile, new AbortController().signal);
    assert.equal(calls, 2);
  } finally { await created.service.drain(); }
});

async function setup(caller: Caller) {
  const service = new Service(skill, () => {}, caller); service.profiles = [profile];
  await service.invoke('project.create', { parent: isolatedRoot('shared-audit'), title: '共享原文审查', premise: '医生与调查员核对记录', config: { defaultProfileId: profile.id, maxRounds: 12, maxTools: 64, preview: { enabled: false } } });
  let p = service.store!.db.project();
  for (const stage of ['S01','S02','S03','S04','S05','S06','S07','S08','S09'] as const) {
    service.store!.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    p = service.store!.db.project();
  }
  p.stage = 'S10'; service.store!.db.set('project', p);
  const run = service.makeRun('stage', '完成正文与全部章后核对'); service.store!.db.saveRun(run);
  return { service, run };
}

for (const scenario of [
  { name: '报告计数错误', missing: false, reads: [] },
  { name: '报告缺失后读取资料', missing: true, reads: ['read_document'] },
  { name: '报告计数错误后读取和检查', missing: false, reads: ['read_document', 'validate'] }
]) test(`章后定向修复：${scenario.name}，只在实际提交后验收`, async () => {
  let service: Service, requests = 0, memories = 0, audits = 0;
  const created = await setup(async (_p, system, messages, tools) => {
    requests++;
    const p = service.store!.db.project(), input = JSON.parse(messages[0].content);
    if (system.includes('本次独立章后核对包含两个检查')) {
      audits++;
      assert.equal(memories, 2 + scenario.reads.length, '本地错误修复前不能审查旧候选');
      return fakeResult(JSON.stringify({ memory: { decisions: input.items.map((i: any) => ({ id: i.id, verdict: 'supported', reason: '原文写明递出动作。', ...(i.fact ? { evidenceRefs: [0] } : { evidence: fixtureAuditEvidence(i, input.sources) }) })) },
        plans: { decisions: input.plans.map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '当前动作与求医计划相容。',
          planQuote: input.sources.find((s: any) => s.path === plan.path).content.slice(0, 30), proseQuote: input.sources.find((s: any) => s.path === input.prose.path).content.slice(0, 30) })) } }));
    }
    if (!tools.length) return fakeResult(fixture(p, prosePath(1), service));
    if (system.includes('本阶段为 review')) return proposal([service.change(qualityPath(1), fixture(p, qualityPath(1), service))]);
    memories++;
    if (memories === 2) {
      assert.match(messages.at(-1)!.content, scenario.missing ? /missing_output/ : /aftermath_words/);
      if (scenario.missing) assert.doesNotMatch(messages.at(-1)!.content, /aftermath_words|报告填写.*未知/);
      const repair = JSON.parse(messages.at(-1)!.content).repairScope;
      assert.deepEqual(repair.paths, [updatePath(1)]);
      assert.deepEqual(repair.factIds, []);
      assert.ok(repair.protectedPaths.includes(prosePath(1)));
      assert.equal(repair.allowNewFacts, false);
    }
    const run = service.store!.db.runs().find(r => r.status === 'running')!, prose = run.changes.find(c => c.path === prosePath(1))!;
    if (memories > 1) {
      assert.equal(run.repairAttempts?.memory, 1, '只读工具不能消耗自动修复次数');
      assert.equal(audits, 0, '读取或检查不能触发独立验收');
      assert.equal(hash(prose.content), run.pipeline!.proseHash);
    }
    const read = scenario.reads[memories - 2];
    if (read) return { ...fakeResult(''), native: null, stop: 'tools', calls: [{
      id: crypto.randomUUID(), name: read,
      arguments: JSON.stringify(read === 'read_document' ? { path: updatePath(1), candidate: true } : {})
    }] };
    const fact = factSchema.parse({ id: 'action', subject: '阿宁', predicate: '递出记录', value: '向医生递出记录本', kind: 'event', category: 'item', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '阿宁推开诊室的门，把记录本递到灯下。' }] });
    const changes = (memories === 1 ? stageOutputs('S11', p).filter(file => !scenario.missing || file !== updatePath(1)) : [updatePath(1)]).map(file => service.change(file,
      memories === 1 && file === updatePath(1) ? fixture(p, file, service).replace(/正文实际字数：\d+/, '正文实际字数：1') : fixture(p, file, service)));
    return proposal(changes, [fact], fixtureCoverage(service, run, [fact]));
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(requests, 5 + scenario.reads.length); assert.equal(memories, 2 + scenario.reads.length); assert.equal(audits, 1);
    assert.equal(done.repairAttempts?.memory, 1); assert.equal(done.rounds, 5 + scenario.reads.length);
  } finally { await service.drain(); }
});

for (const mode of ['valid', 'contradicted', 'invalid-quote']) test(`独立章后审查共享一次原文：${mode}`, async () => {
  const rejected = mode === 'contradicted';
  let service: Service, audits = 0, extractions = 0, requests = 0;
  const created = await setup(async (_p, system, messages, tools) => {
    requests++;
    const input = JSON.parse(messages[0].content), p = service.store!.db.project();
    if (system.includes('本次独立章后核对包含两个检查')) {
      audits++;
      assert.equal(tools.length, 0);
      assert.equal(input.sources.filter((s: any) => s.path === input.prose.path).length, 1);
      assert.equal(input.prose.content, undefined);
      assert.equal(input.facts, undefined);
      assert.equal(input.context_manifest, undefined);
      if (mode === 'invalid-quote' && audits === 2) {
        assert.equal(messages.length, 3);
        assert.match(messages[1].content, /伪造的证据片段/);
        assert.match(messages[2].content, /真实原文/);
        assert.match(messages[2].content, /不把否定或不明确结论改成默认通过/);
      } else assert.equal(messages.length, 1);
      return fakeResult(JSON.stringify({ memory: { decisions: input.items.map((item: any) => ({ id: item.id,
        verdict: rejected && audits === 1 && item.action !== 'review_document' ? 'contradicted' : 'supported', reason: rejected && audits === 1 && item.action !== 'review_document' ? '原文医生没有接，不能记成已经交付。' : '原文明确写出递出动作，未声称完成交付。', ...(item.fact ? { evidenceRefs: [0] } : {}),
        evidence: [...fixtureAuditEvidence(item, input.sources).map((e: any) => ({ path: e.path, quote: mode === 'invalid-quote' && audits === 1 ? '伪造的证据片段' : e.quote })),
          { path: input.plans[0].path, quote: input.sources.find((s: any) => s.path === input.plans[0].path).content.slice(0, 30) }] })) },
        plans: { decisions: input.plans.map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '后续求医计划与当前递出记录本的行为相容。', planQuote: input.sources.find((s: any) => s.path === plan.path).content.slice(0, 30), proseQuote: input.sources.find((s: any) => s.path === input.prose.path).content.slice(0, 30) })) } }));
    }
    if (system.includes('你独立检查') && input.items) {
      audits++;
      assert.equal(input.plans, undefined, '仅事实改动不重复核对已有后续计划');
      return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => ({ id: item.id,
        verdict: 'supported', reason: '原文支持递出动作，不声称完成交付。', ...(item.fact ? { evidenceRefs: [0] } : { evidence: fixtureAuditEvidence(item, input.sources) }) })) }));
    }
    if (!tools.length) return fakeResult(fixture(p, prosePath(1), service));
    if (system.includes('本阶段为 review')) {
      assert.ok(!tools.some(t => ['propose_memory', 'read_naming_rules'].includes(t.name)));
      return proposal([service.change(qualityPath(1), fixture(p, qualityPath(1), service))]);
    }
    extractions++;
    assert.ok(!input.existingCandidates.some((c: any) => c.path === qualityPath(1)));
    const r = service.store!.db.runs().find(r => r.status === 'running')!, prose = r.changes.find(c => c.path === prosePath(1))!;
    const fact = factSchema.parse({ id: 'record-action', subject: '阿宁', predicate: '记录本动作', value: rejected && extractions === 1 ? '已经交给医生' : '向医生递出记录本', kind: 'event', category: 'item', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '阿宁推开诊室的门，把记录本递到灯下。' }] });
    return proposal(extractions === 1 ? stageOutputs('S11', p).map(file => service.change(file, fixture(p, file, service))) : [], [fact], fixtureCoverage(service, r, [fact]));
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(audits, mode === 'valid' ? 1 : 2); assert.equal(requests, rejected ? 6 : mode === 'invalid-quote' ? 5 : 4);
    assert.equal(done.pipeline?.phase, 'ready'); assert.equal(done.accepted, false);
    assert.deepEqual(done.memoryReview!.issues, []);
    const memory = memoryReviewInput(service.store!, done), plans = futurePlanReviewInput(service.store!, done), shared = chapterAuditInput(memory, plans);
    assert.equal(confirmedAlignedPlans(service.store!, done).size, plans.plans.length);
    assert.equal(canCombineChapterAudit(profile, shared, ''), true);
    assert.equal(canCombineChapterAudit({ ...profile, outputLimit: 4096 }, shared, ''), false);
    assert.equal(canCombineChapterAudit({ ...profile, contextLimit: 4096, inputLimit: 1024, outputLimit: 1024 }, shared, ''), false);
    const good = { memory: { decisions: memory.items.map(item => ({ id: item.id, verdict: 'supported', reason: '原文支持递出动作。', evidence: fixtureAuditEvidence(item, memory.sources) })) }, plans: { decisions: done.futurePlanReview!.decisions } };
    assert.throws(() => parseChapterAudit(JSON.stringify({ ...good, memory: { decisions: [] } }), memory, plans), /逐条覆盖/);
    assert.throws(() => parseChapterAudit(JSON.stringify({ ...good, plans: { decisions: [] } }), memory, plans), /逐份覆盖/);
    const badQuote = structuredClone(good); badQuote.plans.decisions[0].proseQuote = '不存在于原文中的证据句子';
    assert.throws(() => parseChapterAudit(JSON.stringify(badQuote), memory, plans), /准确/);
    const changed: Run = structuredClone(done); changed.facts[0].value = '不同的结论';
    assert.equal(confirmedAlignedPlans(service.store!, changed).size, 0);
    const changedPlan: Run = structuredClone(done);
    changedPlan.changes.push(service.change(plans.plans[0].path, plans.plans[0].content + '\n计划改变了。'));
    assert.equal(memoryReviewMatches(service.store!, changedPlan), false, '补充证据的计划变化必须使记忆回执失效');
    assert.equal(memoryReviewIssues(service.store!, changedPlan).length, 1);
    const planOnly = structuredClone(good);
    planOnly.memory.decisions[0].evidence = [{ path: plans.plans[0].path, quote: plans.plans[0].content.slice(0, 30) }];
    assert.throws(() => parseChapterAudit(JSON.stringify(planOnly), memory, plans), /无关文件/, '计划不能替代已发生事件的正文证据');
    if (mode === 'valid') {
      const before = requests;
      done.pipeline!.phase = 'memory'; done.status = 'paused';
      done.memoryReview = undefined; done.futurePlanReview = undefined;
      done.messages.push({ role: 'assistant', content: '', calls: [] });
      service.store!.db.saveRun(done);
      await service.runner!.drive(done.id);
      const resumed = service.store!.db.run(done.id);
      assert.equal(resumed.status, 'awaiting_review', resumed.error ?? JSON.stringify(resumed.issues));
      assert.equal(requests, before, '旧任务已收到结束消息和有效审查时，恢复不得再请求空回复或重复审查');
    }
  } finally { await service.drain(); }
});
