import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { contextMeter, latestContext, type ContextUsage } from '../src/shared/context-meter';
import { callModel } from '../src/core/runtime/model-gateway';
import { requestSize } from '../src/core/context-budget';
import { RequestError } from '../src/core/provider';
import { fakeProfile, fakeResult, refactorFixture, isolatedRoot } from './fixtures/refactor';
import { runSchema, conversationTurnSchema } from '../src/shared/contract-schemas';
import { Service } from '../src/core/service';

const usage: ContextUsage = {
  requestId: 'one', at: '2026-10-26T01:00:00.000Z', profileId: fakeProfile.id, profileVersion: 1, model: fakeProfile.model,
  protocol: fakeProfile.protocol, contextLimit: fakeProfile.contextLimit, inputLimit: 99872, availableInput: 96000,
  outputReserve: 128, estimatedInput: 5000, method: 'utf8_upper_bound', status: 'complete', inputTokens: 1000, cachedInputTokens: 990
};

test('圆环用单次输入实测值，缓存不扣除、旧调用不累加，未发送的文字不冒充实测', () => {
  const meter = contextMeter(fakeProfile, usage);
  assert.equal(meter.tokens, 1000);
  assert.equal(meter.percent, 1);
  assert.equal(meter.measured, true);
  assert.equal(contextMeter(fakeProfile).percent, null);
  assert.equal(contextMeter(fakeProfile, { ...usage, status: 'pending' }).tokens, 5000);
  assert.equal(contextMeter(fakeProfile, { ...usage, inputTokens: null }).measured, false);
  assert.equal(contextMeter(fakeProfile, { ...usage, inputTokens: 0 }).tokens, 0);
  assert.equal(contextMeter(fakeProfile, { ...usage, status: 'unknown' }).measured, false);
  assert.equal(latestContext([{ contextUsage: usage }, { contextUsage: { ...usage, requestId: 'two', at: '2026-10-26T02:00:00.000Z' } }])?.requestId, 'two');
});

test('切换模型、连接版本或容量时立即改变容量，但不挪用旧模型实测值', () => {
  for (const override of [{ id: 'other' }, { model: 'other' }, { version: 2 }, { contextLimit: 200000 }, { outputLimit: 256 }, { protocol: 'responses' as const }]) {
    const next = { ...fakeProfile, ...override };
    assert.equal(contextMeter(next, usage).tokens, null);
    assert.equal(contextMeter(next, usage).capacity, next.contextLimit);
  }
  assert.equal(contextMeter({ ...fakeProfile, limitMode: 'official', modelLimits: null }, usage).capacity, null);
  assert.equal(contextMeter({ ...fakeProfile, protocol: 'images' }, usage).capacity, null);
  const bounded = { ...fakeProfile, contextPolicy: { tokenizer: 'auto' as const, effectiveInputLimit: 20000, providerOverhead: 256, safetyRatio: .03, safetyTokens: 256, toolResultReserve: 2048 } };
  assert.equal(contextMeter(bounded).inputLimit, 20000);
  assert.equal(contextMeter(bounded, usage).matching, false);
  const separate = { ...fakeProfile, limitMode: 'official' as const, inputLimit: 80000, modelLimits: {
    model: fakeProfile.model, contextLimit: 100000, inputLimit: 80000, outputLimit: 128,
    windowKind: 'separate' as const, origin: 'official-api' as const, checkedAt: 'fixture', source: 'https://example.test/models'
  } };
  assert.equal(contextMeter(separate).capacity, 80000);
  assert.equal(contextMeter(separate).separate, true);
});

test('模型网关记录真正发送的请求预算及单次 usage，显示状态不增加调用、费用或改动输出', async () => {
  const f = refactorFixture();
  let calls = 0;
  const profile = { ...fakeProfile, networkRecovery: { maxRetries: 0, retryUnknown: false } };
  try {
    f.run.usage.input = 90000;
    const result = await callModel(f.store, f.run, 'context-display', async () => {
      calls++;
      assert.equal(f.run.contextUsage?.status, 'pending');
      assert.equal(f.run.contextUsage?.availableInput, requestSize(profile, '', 0).availableInput);
      return { ...fakeResult('保留原内容结构'), usage: { input: 1200, output: 300, cachedInput: 1100, cost: 0, currency: 'USD' } };
    }, profile, '原规则', [{ role: 'user', content: '死亡权设定' }], [], new AbortController().signal);
    assert.equal(calls, 1);
    assert.equal(result.text, '保留原内容结构');
    assert.equal(f.run.usage.input, 90000);
    assert.equal(f.run.contextUsage!.inputTokens, 1200);
    assert.equal(contextMeter(profile, f.run.contextUsage).tokens, 1200);
    assert.deepEqual(runSchema.parse(f.run).contextUsage, f.run.contextUsage);
    const first = f.run.contextUsage!.requestId;
    await callModel(f.store, f.run, 'context-display', async () => { calls++; return { ...fakeResult(), usage: { input: null, output: null, cost: null, currency: 'USD' } }; }, profile, '原规则', [{ role: 'user', content: '下一次内容' }], [], new AbortController().signal);
    assert.equal(calls, 2);
    assert.notEqual(f.run.contextUsage!.requestId, first);
    assert.equal(contextMeter(profile, f.run.contextUsage).measured, false);
    await assert.rejects(callModel(f.store, f.run, 'context-display', async () => { calls++; throw new RequestError('断流', true); }, profile, '原规则', [{ role: 'user', content: '第三次' }], [], new AbortController().signal), /断流/);
    assert.equal(calls, 3);
    assert.equal(f.run.contextUsage!.status, 'unknown');
    assert.equal(contextMeter(profile, f.run.contextUsage).measured, false);
    await assert.rejects(callModel(f.store, f.run, 'context-display', async () => { calls++; throw new RequestError('明确拒绝请求', false); }, profile, '原规则', [{ role: 'user', content: '第四次' }], [], new AbortController().signal), /明确拒绝请求/);
    assert.equal(calls, 4);
    assert.equal(f.run.contextUsage!.status, 'not_sent');
    assert.equal(contextMeter(profile, f.run.contextUsage).measured, false);
  } finally { f.store.close(); }
});

test('聊天的真实历史整理显示可回查摘录，保留原消息，只调用一次且 IPC 保留用量和整理记录', async () => {
  let calls = 0;
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => { calls++; return fakeResult('故事原设定不变。'); });
  service.profiles = [{ ...fakeProfile, contextLimit: 500000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('context-chat'), title: '上下文界面离线验收', premise: '每个人持有另一个人的死亡权', config: { defaultProfileId: fakeProfile.id } });
    const conversation = service.snapshot().conversations![0];
    const original: string[] = [];
    for (let i = 0; i < 25; i++) {
      const content = '作者历史讨论，未采纳。'.repeat(50) + i;
      original.push(content);
      service.chat!.records.save('conversation_turns', { id: `history-${i}`, conversationId: conversation.id, messageId: `old-${i}`,
        profileId: fakeProfile.id, profileVersion: 1, status: 'complete', createdAt: new Date(1000000 + i).toISOString(), updatedAt: new Date(1000000 + i).toISOString(),
        rules: [], citations: [], messages: [], usage: { input: 0, output: 0, cost: 0, currency: 'USD' }, calls: [], budgets: [], kind: 'discussion', request: '历史讨论' });
      service.chat!.records.save('conversation_messages', { id: `old-${i}`, conversationId: conversation.id, turnId: `history-${i}`, role: i % 2 ? 'assistant' : 'user', content, createdAt: new Date(1000000 + i).toISOString(), status: 'complete', citations: [] });
    }
    await service.invoke('chat.send', { conversationId: conversation.id, text: '解释设定，不要改写', profileId: fakeProfile.id });
    const end = Date.now() + 15000;
    while (service.chat?.controller) { if (Date.now() > end) throw new Error('离线聊天未结束'); await new Promise(resolve => setTimeout(resolve, 10)); }
    const read = await service.invoke('chat.read', { id: conversation.id });
    const turn = read.turns.at(-1)!;
    assert.equal(calls, 1);
    assert.equal(turn.status, 'complete', turn.error ?? '聊天应正常完成');
    assert.equal(turn.contextUsage!.inputTokens, 10);
    assert.equal(turn.contextCompactions!.length, 1);
    assert.equal(turn.contextCompactions![0].archivedMessages, 5);
    assert.ok(turn.contextCompactions![0].beforeBytes > turn.contextCompactions![0].afterBytes);
    assert.deepEqual(read.messages.filter(message => message.id.startsWith('old-')).map(message => message.content), original);
    const through = read.conversation.summary!.through;
    assert.equal(through, 'old-4');
    assert.deepEqual(conversationTurnSchema.parse(turn).contextCompactions, turn.contextCompactions);
    const page = await service.invoke('chat.page', { id: conversation.id });
    assert.deepEqual(page.turns.at(-1)!.contextUsage, turn.contextUsage);
  } finally { service.close(); }
});
