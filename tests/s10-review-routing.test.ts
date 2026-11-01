import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { hash, prosePath, qualityPath, batchPath, activeBatch } from '../src/core/domain';
import { fingerprint } from '../src/core/runtime/canonical';
import { scoreFields } from '../src/core/output-normalization';
import { RequestError } from '../src/core/provider';
import type { Caller } from '../src/core/runner';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { readNarrativeData } from '../src/core/narrative-curves';

const skill = path.resolve('resources/skill');
const model = { ...fakeProfile, contextLimit: 1000000, outputLimit: 4096, stream: false };
const reply = (text = '审核已提交', changes?: unknown) => ({ ...fakeResult(text), native: null,
  ...(changes ? { calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes }) }], stop: 'tools' as const } : {}) });

for (const valid of [true, false]) test(`曲线附带数据${valid ? '有效' : '损坏'}均不增加审核请求或改变正文`, async () => {
  let service: Service, reviews = 0, memories = 0;
  const created = await setup(async (_profile, system) => {
    if (system.includes('本阶段为 review')) {
      reviews++;
      const result = reply('', [report(service, 'pass')]), call = result.calls[0];
      const original = service.store!.db.runs().find(r => r.pipeline)?.changes.find(c => c.path === prosePath(1))!.content!;
      call.arguments = JSON.stringify({ ...JSON.parse(call.arguments), narrative: valid ? { points: [{ label: '开场动作', strength: 4, anchor: original.slice(0, 80) }] } : { points: '损坏数据' } });
      return result;
    }
    memories++; throw new RequestError('测试在记忆入口暂停', false);
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const current = service.store!.db.run(created.run.id);
    assert.equal(reviews, 1); assert.equal(memories, 1); assert.equal(current.pipeline!.phase, 'memory');
    assert.equal(current.repairAttempts?.review, undefined);
    assert.equal(current.changes.find(c => c.path === prosePath(1))!.content, created.prose.content);
    assert.equal(!!readNarrativeData(service.store!, 1, current.id).actual, valid);
  } finally { await service.drain(); }
});

async function setup(caller: Caller) {
  const service = new Service(skill, () => {}, caller);
  service.profiles = [structuredClone(model)];
  await service.invoke('project.create', { parent: isolatedRoot('review-routing'), title: '审核修订分流', premise: '维修员追查停电原因',
    config: { defaultProfileId: model.id, maxRounds: 12, maxTools: 64, preview: { enabled: false } } });
  const p = service.store!.db.project();
  p.stage = 'S10'; p.revision++;
  service.store!.commit([service.change(batchPath(activeBatch(p)), fixture(p, batchPath(activeBatch(p)), service))], p);
  const run = service.makeRun('stage', '完成当前章的独立审核及章后核验');
  const prose = service.change(prosePath(p.chapter), fixture(p, prosePath(p.chapter), service).replace('# 本章正文', '# 第001章：求医'));
  run.pipeline!.phase = 'review'; run.pipeline!.proseHash = hash(prose.content); run.sourceProseHash = run.pipeline!.proseHash;
  run.changes = [prose]; service.store!.db.saveRun(run);
  return { service, run, p, prose };
}

function report(service: Service, verdict: 'pass' | 'warning' | 'error', invalidQuote = false) {
  const p = service.store!.db.project(), file = qualityPath(p.chapter);
  const content = fixture(p, file, service).replace(/(```json wenxu-review\n)([\s\S]*?)(\n```)/, (_all, start, json, end) => {
    const data = JSON.parse(json);
    data.checks[2].verdict = verdict;
    data.checks[2].reason = '前后动作回指发生矛盾，请仅修正相关半句，不需重写整章。';
    if (invalidQuote) data.checks[2].quote = '这段文字从未在当前候选正文中出现过。';
    return start + JSON.stringify(data) + end;
  });
  assert.match(content, /是否需要重写：否/);
  return service.change(file, content);
}

test('有效破折号评分只审一次便进入记忆，不生成结束说明或格式修复请求', async () => {
  let service: Service, reviews = 0, memories = 0;
  const created = await setup(async (_profile, system) => {
    if (system.includes('本阶段为 review')) {
      reviews++;
      assert.equal(reviews, 1, '有效评分不得重复请求');
      const change = report(service, 'pass');
      for (const field of [...scoreFields, '总分']) {
        change.content = change.content.replace(new RegExp(`(- ${field}：[^\\n]+)`), '$1——核对了本章动作和实际结果。');
      }
      return reply('', [change]);
    }
    assert.match(system, /本阶段为 memory/);
    memories++; throw new RequestError('测试在记忆入口暂停', false);
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const current = service.store!.db.run(created.run.id);
    assert.equal(reviews, 1); assert.equal(memories, 1);
    assert.equal(current.pipeline!.phase, 'memory');
    assert.equal(current.repairAttempts?.review, undefined);
    assert.equal(current.proseReviewFeedback, undefined);
    assert.equal(current.accepted, false);
  } finally { await service.drain(); }
});

test('S10 独立审稿携带不可由上游摘要替代的作者原始设定', async () => {
  let seen = false;
  const original = '第一卷高潮发生在30—50万字：顾平安死亡权挂牌172亿；第二卷处理交易所秩序。';
  const created = await setup(async (_profile, system, messages) => {
    assert.match(system, /本阶段为 review/);
    const context = JSON.parse(messages[0].content);
    assert.equal(context.authorPremise, original);
    assert.match(context.authorization.accepted_design_policy, /阶段采纳不能把与原始要求冲突的模型建议变成作者硬约束/);
    seen = true;
    throw new RequestError('测试在审稿输入边界暂停', false);
  });
  try {
    created.service.store!.db.set('premise', original);
    await created.service.runner!.drive(created.run.id);
    assert.equal(seen, true);
  } finally { await created.service.drain(); }
});

test('正文资料包为完整作者输入预留预算，超长原文不能漏算后发送', async () => {
  const created = await setup(async () => { throw new Error('预算检查不应发送模型请求'); });
  try {
    assert.doesNotThrow(() => created.service.runner!.previewContext(created.run, model));
    created.service.store!.db.set('premise', '作者指定的事件必须保留。'.repeat(100000));
    assert.throws(() => created.service.runner!.previewContext(created.run, model), /必读资料超过输入预算/);
  } finally { await created.service.drain(); }
});

for (const verdict of ['error', 'warning'] as const) test(`独立审核 ${verdict} 发现按严重程度分流，局部正文问题不误送修评分`, async () => {
  let service: Service, reviews = 0, rewrites = 0, memories = 0;
  const created = await setup(async (_profile, system, messages, tools) => {
    if (system.includes('本阶段为 review')) {
      reviews++;
      return reviews === 1 || verdict === 'error' && reviews === 2 ? reply('', [report(service, reviews === 1 ? verdict : 'pass')]) : reply();
    }
    if (system.includes('本阶段为 memory')) { memories++; throw new RequestError('测试在独立记忆阶段边界暂停', false); }
    rewrites++;
    assert.equal(tools.length, 0);
    assert.match(JSON.parse(messages[0].content).reviewFeedback.review.content, /前后动作回指发生矛盾/);
    return reply(created.prose.content + '\n门外的风终于停了。');
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const current = service.store!.db.run(created.run.id);
    assert.equal(rewrites, verdict === 'error' ? 1 : 0, current.error ?? '');
    assert.equal(memories, 1, current.error ?? '');
    assert.equal(current.pipeline!.phase, 'memory');
    assert.equal(current.repairAttempts?.review, undefined, '不应要求审稿模型抹掉有效的正文错误');
    assert.equal(current.pipeline!.previewCalls, 0);
    assert.equal(current.accepted, false);
    assert.equal(service.store!.db.document(created.prose.path)?.hash ?? null, created.prose.baseHash);
  } finally { await service.drain(); }
});

test('带无效引文的 error 发现必须先修审核证据，不能驱动正文修改', async () => {
  let service: Service, reviews = 0, rewrites = 0;
  const created = await setup(async (_profile, system, messages) => {
    if (system.includes('本阶段为 review')) {
      reviews++;
      if (reviews === 1) return reply('', [report(service, 'error', true)]);
      assert.match(messages.at(-1)!.content, /review_evidence_quote/);
      throw new RequestError('测试在审核证据修复请求边界暂停', false);
    }
    rewrites++; throw new Error('坏证据不能驱动正文重写');
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const current = service.store!.db.run(created.run.id);
    assert.equal(rewrites, 0); assert.equal(reviews, 2);
    assert.equal(current.repairAttempts?.review, 1);
    assert.equal(current.pipeline!.phase, 'review');
    assert.equal(current.changes.find(c => c.path === created.prose.path)!.content, created.prose.content);
  } finally { await service.drain(); }
});

test('第十二轮发现正文错误仍暂停，不能因修订分流重置总预算', async () => {
  let service: Service, calls = 0;
  const created = await setup(async () => { calls++; return reply('', [report(service, 'error')]); });
  service = created.service;
  try {
    created.run.rounds = 11; service.store!.db.saveRun(created.run);
    await service.runner!.drive(created.run.id);
    const current = service.store!.db.run(created.run.id);
    assert.equal(calls, 1); assert.equal(current.rounds, 12);
    assert.equal(current.status, 'needs_repair'); assert.equal(current.failure?.code, 'ROUND_LIMIT');
    assert.equal(current.pipeline!.phase, 'review');
    assert.equal(current.accepted, false);
  } finally { await service.drain(); }
});

test('作者编辑正文后失效旧修复范围与证据，显式加预算恢复保留累计计数并审核新稿', async () => {
  let service: Service, calls = 0, newContent = '';
  const created = await setup(async (_profile, system, messages, tools) => {
    calls++;
    if (!system.includes('本阶段为 review')) {
      assert.equal(tools.length, 0);
      assert.equal(JSON.parse(messages[0].content).prior, newContent);
      throw new RequestError('测试在新稿正文修复边界暂停', false);
    }
    assert.match(system, /本阶段为 review/);
    const input = JSON.parse(messages[0].content);
    assert.equal(input.prose.content, newContent);
    assert.equal(input.prose.hash, hash(newContent));
    const current = service.store!.db.runs().find(run => run.status === 'running')!;
    assert.equal(current.memoryReview, undefined); assert.equal(current.proseReviewFeedback, undefined);
    assert.equal(current.repairScope?.protectedHashes[created.prose.path], fingerprint(current.changes.find(c => c.path === created.prose.path)!));
    assert.notEqual(current.repairScope?.protectedHashes[created.prose.path], fingerprint(created.prose));
    if (calls === 1) return reply('', [report(service, 'error')]);
    // The valid new finding must route to prose, not request another review.
    throw new Error('新正文错误应路由正文修复');
  });
  service = created.service;
  try {
    const original = created.run;
    original.status = 'needs_repair'; original.rounds = 11; original.toolCount = 20;
    original.usage = { input: 1000, output: 100, cost: null, currency: 'USD' };
    original.repairAttempts = { prose: 2, review: 2, memory: 2 };
    original.repairScope = { phase: 'review', paths: [qualityPath(created.p.chapter)], protectedHashes: { [created.prose.path]: fingerprint(created.prose) }, fingerprint: 'old', attempts: 2 };
    original.memoryReview = { fingerprint: 'old-memory', issues: [] };
    original.proseReviewFeedback = { review: report(service, 'error'), proseHash: hash(created.prose.content) };
    original.changes.push(original.proseReviewFeedback.review);
    service.store!.db.saveRun(original);
    await service.invoke('project.configure', { config: { ...service.store!.db.project().config, maxRounds: 32 } });
    newContent = created.prose.content + '\n门外的风终于停了。';
    await service.invoke('run.update', { id: original.id, path: created.prose.path, content: newContent });
    const edited = service.store!.db.run(original.id);
    assert.equal(edited.repairScope, undefined); assert.equal(edited.memoryReview, undefined); assert.equal(edited.proseReviewFeedback, undefined);
    assert.deepEqual(edited.repairAttempts, {});
    assert.equal(edited.changes.length, 1); assert.equal(edited.rounds, 11); assert.equal(edited.toolCount, 20); assert.deepEqual(edited.usage, original.usage);
    const recoveredId = await service.invoke('run.recover', { id: original.id });
    for (let i = 0; service.runner?.controller; i++) { assert.ok(i < 2000); await new Promise(resolve => setTimeout(resolve, 5)); }
    const current = service.store!.db.run(recoveredId);
    assert.equal(calls, 2, current.error ?? ''); assert.equal(current.rounds, 13);
    assert.equal(current.toolCount, 21); assert.equal(current.usage.cost, null);
    assert.ok(current.usage.input! >= 1000); assert.equal(current.pipeline!.phase, 'prose');
    assert.equal(current.repairAttempts?.prose, 1); assert.equal(current.accepted, false);
    assert.ok(service.store!.db.events().some(event => event.runId === original.id && event.kind === 'candidate-prose-edited'));
  } finally { await service.drain(); }
});
