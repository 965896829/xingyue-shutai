import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { canCombineChapterAudit, chapterAuditInput, chapterAuditPrompts, compactAuditInstruction } from '../src/core/chapter-audit';
import { countInput, requestSize } from '../src/core/context-budget';
import { tagContext } from '../src/core/tags';
import { memoryReviewInput, memoryReviewMatches } from '../src/core/memory-review';
import { futurePlanReviewInput, futurePlanReviewMatches, confirmedAlignedPlans } from '../src/core/future-plan-review';
import { hash, prosePath, stageOutputs, paths, countWords } from '../src/core/domain';
import { controllerRules } from '../src/core/agent-control';
import { planningReportContext } from '../src/core/creation-prompts';
import { factSchema, type Fact } from '../src/shared/types';
import type { TagPlanning } from '../src/shared/tags';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { requestBody } from '../src/core/provider';
import { encodeFacts } from '../src/core/memory-records';
import { loadNamingRules } from '../src/core/naming';
import { fixtureCoverage } from './fixtures/chapter-coverage';

const skill = path.resolve('resources/skill');
const profile = { ...fakeProfile, contextLimit: 1000000, outputLimit: 32768, stream: false };

async function setup() {
  const requests: any[] = [];
  const wireRequests: any[] = [];
  const service = new Service(skill, () => {}, async (_profile, system, messages) => {
    const input = JSON.parse(messages[0].content);
    requests.push(input);
    wireRequests.push(requestBody({ ..._profile, protocol: 'responses', model: 'gpt-6.1-sol' }, system, messages, [], { promptCacheKey: 'audit-input-test' }).body);
    const memory = { decisions: (input.items ?? []).map((item: any) => ({ id: item.id,
      verdict: item.fact?.value === '已经交给医生' ? 'contradicted' : 'supported',
      reason: '递出记录本不代表已经交付，需保留原文动作边界。',
      ...(item.fact ? { evidenceRefs: [0] } : { evidence: [{ path: item.path, quote: input.sources.find((s: any) => s.path === item.path).content.slice(0, 30) }] }) })) };
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
  return { service, store, run, requests, wireRequests, audit };
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

test('实际联合审核传递修改前资料和宿主字数；修改前版本变化使独立回执失效', async () => {
  const f = await setup();
  try {
    f.run.facts[0].value = '向医生递出记录本';
    const before = f.store.readAccepted(paths.roles).content;
    const change = f.service.change(paths.roles, before + '\n- 当前动作：递出记录本。');
    f.run.changes.push(change);
    await f.audit();
    const input = f.requests[0];
    assert.ok(input.plans.length, '验证真实联合审核请求');
    assert.deepEqual(input.sources.find((s: any) => s.path === paths.roles).previous, { hash: hash(before), content: before });
    const sentSources = f.wireRequests[0].input.flatMap((item: any) => {
      try { const value = JSON.parse(typeof item.content === 'string' ? item.content : item.content?.[0]?.text); return value.source ? [value.source] : []; }
      catch { return []; }
    });
    assert.deepEqual(sentSources.find((s: any) => s.path === paths.roles).previous, { hash: hash(before), content: before }, '必须检查缓存处理后最终出站数据');
    assert.deepEqual(input.proseMetrics.map((m: any) => [m.path, m.hash, m.words, m.computedBy]),
      [[prosePath(1), hash(f.run.changes[0].content), countWords(f.run.changes[0].content), 'host']]);
    const fingerprint = f.run.memoryReview!.fingerprint;
    const older = before + '\n- 修改前已有约定：克制。';
    f.store.commit([f.service.change(paths.roles, older)], f.store.db.project());
    change.baseHash = hash(older);
    assert.equal(memoryReviewMatches(f.store, f.run), false);
    await assert.rejects(f.audit(), /作品已改变/);
    const refreshed = f.service.makeRun('stage', f.run.request);
    f.run.baseRevision = refreshed.baseRevision;
    f.run.baseSnapshotId = refreshed.baseSnapshotId;
    await f.audit();
    const updated = f.requests.at(-1);
    assert.equal(updated.sources.find((s: any) => s.path === paths.roles).previous.content, older);
    assert.notEqual(f.run.memoryReview!.fingerprint, fingerprint);
    const sent = f.requests.length;
    await f.audit();
    assert.equal(f.requests.length, sent, '同版完整输入仍复用有效结论');
  } finally { await f.service.drain(); }
});

test('大资料章后审核按真实发送容量拆页，完整保留前后文与逐项负面结论，恢复不重审已完成页', async () => {
  const f = await setup();
  try {
    f.service.profiles[0].contextLimit = 220000;
    const originals = new Map([paths.roles, paths.behavior].map(file => [file, f.store.readAccepted(file).content]));
    for (const [file, content] of originals) f.run.changes.push(f.service.change(file, content + '\n' + '保留原文'.repeat(9000)));
    const expected = memoryReviewInput(f.store, f.run);
    const originalProse = f.run.changes[0].content;
    await f.audit();
    const pages = f.requests.filter(input => input.items);
    assert.ok(pages.length > 1, '同一组不足12项的大资料也必须按实际容量拆分');
    const ids = pages.flatMap(input => input.items.map((item: any) => item.id));
    assert.equal(new Set(ids).size, ids.length, '一轮拆页不能重复审同一项');
    assert.deepEqual([...ids].sort(), expected.items.map(item => item.id).sort(), '全部审核对象均有回执');
    for (const source of expected.sources) {
      const included = pages.flatMap(input => input.sources).filter((item: any) => item.path === source.path);
      assert.ok(included.length);
      for (const sent of included) {
        assert.equal(sent.content, source.content);
        assert.equal(sent.hash, source.hash);
        assert.deepEqual(sent.previous, source.previous, '拆页不能用摘要代替修改前原文');
      }
    }
    assert.equal(f.run.memoryReview!.issues.length, 1);
    assert.match(f.run.memoryReview!.issues[0], /不代表已经交付/);
    const calls = f.requests.length;
    f.run.memoryReview = undefined;
    await f.audit();
    assert.equal(f.requests.length, calls, '恢复合并已完成分页回执，不重新请求或把否定改为通过');
    assert.equal(f.run.changes[0].content, originalProse);
    for (const [file, content] of originals) assert.equal(f.store.readAccepted(file).content, content);
  } finally { await f.service.drain(); }
});

test('合并审核的未封装估算可容纳但实际请求超限时自动分开核对，全部来源和计划仍经过审核', async () => {
  const f = await setup();
  try {
    f.run.facts[0].value = '向医生递出记录本';
    const p = f.store.db.project(), model = f.service.profiles[0];
    const memory = memoryReviewInput(f.store, f.run), plans = futurePlanReviewInput(f.store, f.run);
    const shared = chapterAuditInput(memory, plans);
    const prompts = chapterAuditPrompts(skill);
    const resident = controllerRules(skill).content + tagContext(p, 'discussion', { focused: true }) + p.config.constraints;
    const instruction = prompts.chapterAuditInstruction + compactAuditInstruction;
    const request = (f.service.runner as any).memoryRequest(f.run, p, 'chapter-consistency-review', instruction, shared);
    const body = requestBody(model, request.system, request.messages, []).body;
    const estimated = countInput(model, { system: resident + prompts.chapterAuditInstruction, input: shared }).tokens + 2048;
    const actual = countInput(model, body).tokens;
    assert.ok(actual > estimated, '覆盖封装、权限和来源字段使真实请求大于旧估算的情形');
    const target = Math.floor((estimated + actual) / 2);
    model.contextPolicy = { tokenizer: 'conservative', effectiveInputLimit: Math.floor(target / 0.99),
      safetyRatio: 0.01, safetyTokens: 64, providerOverhead: 0, toolResultReserve: 2048 };
    assert.equal(canCombineChapterAudit(model, shared, resident, prompts.chapterAuditInstruction), true);
    const sized = requestSize(model, body);
    assert.ok(sized.tokens > sized.availableInput);
    await f.audit();
    assert.ok(f.requests.some(input => input.items && !input.plans));
    assert.ok(f.requests.some(input => input.plans && !input.items));
    assert.equal(f.requests.some(input => input.plans && input.items), false);
    assert.deepEqual(f.run.memoryReview!.issues, []);
    assert.equal(confirmedAlignedPlans(f.store, f.run).size, plans.plans.length);
    assert.deepEqual(f.requests.filter(input => input.items).flatMap(input => input.items.map((item: any) => item.id)).sort(),
      memory.items.map(item => item.id).sort());
  } finally { await f.service.drain(); }
});

test('单项完整审核资料仍超容量时零调用拒发，不截断资料也不生成通过回执', async () => {
  const f = await setup();
  try {
    f.service.profiles[0].contextLimit = 100000;
    f.run.facts = [];
    const before = f.store.readAccepted(paths.roles).content;
    f.run.changes.push(f.service.change(paths.roles, before + '\n' + '保留原文'.repeat(10000)));
    const candidate = structuredClone(f.run.changes);
    await assert.rejects(f.audit(), /必需上下文超过模型可用容量/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.run.memoryReview, undefined);
    assert.deepEqual(f.run.changes, candidate);
    assert.equal(f.store.readAccepted(paths.roles).content, before);
  } finally { await f.service.drain(); }
});

test('审核收到与采纳同源的事实状态预览，旧机器索引不冒充更新后的状态或提前生效', async () => {
  const f = await setup();
  try {
    const old = { ...structuredClone(f.run.facts[1]), id: 'old-promise', category: 'promise' as const,
      predicate: '承诺递出记录本', fromChapter: 0, reviewStatus: 'accepted' as const };
    f.store.db.replaceFacts([old], f.store.db.project().revision);
    f.run.facts = [{ ...structuredClone(f.run.facts[1]), id: 'fulfilled', category: 'promise',
      state: 'resolved', supersedes: old.id, replacementReason: '正文中已经递出记录本' }];
    const candidate = encodeFacts('# 行为\n\n本章已经递出记录本。', [old]);
    f.run.changes.push(f.service.change(paths.behavior, candidate));
    await f.audit();
    const input = f.requests[0];
    assert.equal(input.sources.find((s: any) => s.path === paths.behavior).content, candidate, '原始索引与来源哈希不可伪改');
    assert.deepEqual(input.factTransitions[0], { id: old.id, replacementId: 'fulfilled', reason: '正文中已经递出记录本',
      before: { state: 'active', reviewStatus: 'accepted', toChapter: null },
      after: { state: 'superseded', reviewStatus: 'accepted', toChapter: 0 } });
    assert.ok(JSON.stringify(f.wireRequests[0]).includes('factTransitions'));
    assert.equal(f.store.db.factsByIds([old.id])[0].state, 'active', '审核预览不能提前改变正式状态');
    const before = f.run.memoryReview!.fingerprint;
    f.run.facts[0].fromChapter = 0;
    assert.equal(memoryReviewMatches(f.store, f.run), false);
    await f.audit();
    assert.equal(f.requests.at(-1).factTransitions[0].after.toChapter, null, '未知顺序不能编造有效期');
    assert.notEqual(f.run.memoryReview!.fingerprint, before);
  } finally { await f.service.drain(); }
});

test('事实替代缺原因在提交和独立审核之前阻断，修正后复用原正文与事实编号', async () => {
  const f = await setup();
  try {
    const old = { ...structuredClone(f.run.facts[1]), id: 'prior-state', reviewStatus: 'accepted' as const };
    f.store.db.replaceFacts([old], f.store.db.project().revision);
    const replacement = { ...structuredClone(f.run.facts[1]), id: 'new-state', supersedes: old.id, replacementReason: '   ' };
    f.run.facts = [replacement]; f.run.pipeline!.phase = 'memory';
    f.service.runner!.check(f.run, f.store.db.project());
    assert.ok(f.run.issues.some(i => i.code === 'fact_transition' && i.factId === replacement.id && /replacementReason/.test(i.message)));
    await f.audit(); assert.equal(f.requests.length, 0, '可本地发现的错误不得浪费审核调用');
    f.run.facts = [];
    const before = structuredClone(f.run.changes);
    const submit = async (id: string, fact: Fact) => {
      await f.service.runner!.execute(f.run, f.store.db.project(), { id, name: 'propose_memory', arguments: JSON.stringify({ facts: [fact] }) }, new AbortController().signal, loadNamingRules(skill));
      return f.run.messages.find(message => message.role === 'tool' && message.callId === id)!.content;
    };
    assert.match(await submit('missing-reason', replacement), /replacementReason/);
    assert.equal(f.run.facts.length, 0); assert.deepEqual(f.run.changes, before);
    assert.match(await submit('missing-target', { ...replacement, supersedes: 'missing', replacementReason: '依据正文推进' }), /被替代记忆不存在/);
    assert.match(await submit('duplicate-id', { ...replacement, id: old.id, supersedes: null, replacementReason: '' }), /记忆编号已存在/);
    assert.equal(f.run.facts.length, 0);
    await submit('corrected', { ...replacement, replacementReason: '正文已将递出记录本从计划变为实际行动' });
    assert.equal(f.run.facts.length, 1); assert.equal(f.run.facts[0].id, replacement.id);
    assert.deepEqual(f.run.changes, before);
    await f.audit(); assert.equal(f.requests.length, 1);
    assert.equal(f.store.db.factsByIds([old.id])[0].state, 'active', '审核不能提前采纳替代');
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

test('普通章后记忆两种提交入口定位同版唯一引文，重复、缺失及旧版证据仍拒绝且不改正文', async () => {
  const f = await setup();
  try {
    const prose = f.run.changes[0];
    prose.content += '\n🛶\n阿宁把核对后的原件交给医生保管。';
    f.run.pipeline!.phase = 'memory'; f.run.pipeline!.coverageVersion = 1;
    f.run.pipeline!.proseHash = hash(prose.content);
    for (const fact of f.run.facts) fact.evidence[0].hash = f.run.pipeline!.proseHash;
    const quote = '阿宁把核对后的原件交给医生保管。';
    const expectedStart = Array.from(prose.content.slice(0, prose.content.indexOf(quote))).length;
    const original = prose.content, raw = fixtureCoverage(f.service, f.run);
    assert.ok(raw.characters.length);
    for (const character of raw.characters) character.evidence = [{ quote, start: 0, end: Array.from(quote).length }];
    let calls = 0;
    const submit = async (name: string, coverage: typeof raw) => {
      const id = `coverage-${++calls}`;
      await f.service.runner!.execute(f.run, f.store.db.project(), { id, name,
        arguments: JSON.stringify({ ...(name === 'propose_changes' ? { changes: [] } : {}), facts: f.run.facts, coverage })
      }, new AbortController().signal, loadNamingRules(skill));
      return JSON.parse(f.run.messages.find(message => message.role === 'tool' && message.callId === id)!.content);
    };
    for (const name of ['propose_changes', 'propose_memory']) {
      const result = await submit(name, raw);
      assert.equal(result.error, undefined);
      for (const character of f.run.chapterCoverage!.characters) {
        assert.equal(character.evidence[0].start, expectedStart);
        assert.equal(character.evidence[0].end, expectedStart + Array.from(quote).length);
        assert.equal(character.evidence[0].quote, quote);
      }
      const preserved = JSON.stringify({ facts: f.run.facts, coverage: f.run.chapterCoverage, changes: f.run.changes });
      for (const invalid of ['missing', 'ambiguous', 'stale']) {
        const bad = structuredClone(raw);
        if (invalid === 'stale') bad.proseHash = hash('旧版本');
        else for (const character of bad.characters) character.evidence[0] = {
          quote: invalid === 'missing' ? '正文中从未出现的人物动作。' : '阿宁推开诊室的门，把记录本递到灯下。', start: 0, end: 12
        };
        const error = (await submit(name, bad)).error;
        assert.match(error, invalid === 'stale' ? /版本不一致/ : /坐标不一致/);
        if (invalid !== 'stale') {
          assert.ok(error.includes(bad.characters[0].name));
          assert.match(error, invalid === 'missing' ? /引文不在本章最终正文/ : /出现多次/);
        }
        assert.equal(JSON.stringify({ facts: f.run.facts, coverage: f.run.chapterCoverage, changes: f.run.changes }), preserved);
      }
      const omitted = structuredClone(raw); omitted.characters = [];
      const missingError = (await submit(name, omitted)).error;
      assert.match(missingError, /遗漏.*仅提及、无变化或证据不足/);
      for (const character of raw.characters) {
        assert.ok(missingError.includes(character.name));
        assert.ok(missingError.includes(character.entityId));
      }
      assert.equal(JSON.stringify({ facts: f.run.facts, coverage: f.run.chapterCoverage, changes: f.run.changes }), preserved);
      for (const invalid of ['missing-fact', 'wrong-subject']) {
        const bad = structuredClone(raw), character = bad.characters[0];
        character.outcome = 'changed';
        character.factIds = [invalid === 'missing-fact' ? 'unsubmitted-fact' : f.run.facts[0].id];
        if (invalid === 'wrong-subject') { character.name = '另一个人物'; character.entityId = 'another-character'; }
        const error = (await submit(name, bad)).error;
        assert.match(error, /人物变化缺少本章同版本事实依据/);
        assert.ok(error.includes(character.name)); assert.ok(error.includes(character.entityId));
        assert.ok(error.includes(character.factIds[0]));
        assert.match(error, invalid === 'missing-fact' ? /该事实尚未提交/ : /主体.*关联人物.*不匹配/);
        assert.equal(JSON.stringify({ facts: f.run.facts, coverage: f.run.chapterCoverage, changes: f.run.changes }), preserved,
          '更明确的定位不能放宽证据或改变已通过候选');
      }
    }
    assert.equal(prose.content, original);
    assert.equal(f.requests.length, 0, '唯一引文定位由宿主完成，不调用模型计算坐标');
  } finally { await f.service.drain(); }
});

test('记忆提交省略可选关联字段时优先复用明确人物ID，不被其他人物同名或别名抢占', async () => {
  const f = await setup();
  try {
    const known = { ...structuredClone(f.run.facts[1]), id: 'known-identity', entityIds: ['CH01'],
      category: 'character' as const, subject: '阿宁', reviewStatus: 'accepted' as const };
    const collision = { ...structuredClone(known), id: 'other-identity', entityIds: ['OTHER'], subject: '另一个人物', aliases: ['CH01'] };
    f.run.pipeline!.phase = 'memory';
    let counter = 0;
    for (const order of [[collision, known], [known, collision]]) for (const name of ['propose_changes', 'propose_memory']) {
      f.store.db.replaceFacts(order, f.store.db.project().revision);
      f.run.facts = [];
      const proposed: Partial<Fact> = { ...structuredClone(f.run.facts[0] ?? known), id: 'new-action', subject: 'CH01', reviewStatus: 'candidate' };
      delete proposed.entityIds;
      const callId = `explicit-subject-${++counter}`;
      await f.service.runner!.execute(f.run, f.store.db.project(), { id: callId, name,
        arguments: JSON.stringify({ ...(name === 'propose_changes' ? { changes: [] } : {}), facts: [proposed] })
      }, new AbortController().signal, loadNamingRules(skill));
      const result = JSON.parse(f.run.messages.find(message => message.role === 'tool' && message.callId === callId)!.content);
      assert.equal(result.error, undefined);
      assert.deepEqual(f.run.facts[0].entityIds, ['CH01']);
      assert.equal(f.run.facts[0].subject, 'CH01');
      assert.equal(f.store.db.factsByIds(['new-action']).length, 0, '候选不能提前进入正式事实');
    }
    assert.equal(f.requests.length, 0, '身份复用在本地完成');
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
