import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { attempts } from '../src/core/runtime/model-gateway';
import { runTaskLoop, piExecutorVersion, type TaskTurn } from '../src/core/runtime/task-loop';
import { stageOutputs } from '../src/core/domain';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { RequestError } from '../src/core/provider';
import type { Caller } from '../src/core/runner';
import type { AppEvent, ModelMessage, ModelResult, SecretProfile } from '../src/shared/types';

async function setup(caller: Caller, protocol: SecretProfile['protocol'] = 'chat', events: AppEvent[] = []) {
  const service = new Service(path.resolve('resources/skill'), e => events.push(e), caller);
  service.profiles = [{ ...fakeProfile, protocol, contextLimit: 1000000, outputLimit: 4096 }];
  await service.invoke('project.create', { parent: isolatedRoot('pi-production'), title: 'Pi 接入验证', premise: '伤员求医',
    config: { defaultProfileId: fakeProfile.id, targetWords: 6000, chapterWords: 200, minWords: 200, maxWords: 200, batchSize: 30, maxRounds: 12, maxTools: 64 } });
  const p = service.store!.db.project();
  service.store!.commit(stageOutputs('S01', p).map(file => service.change(file, fixture(p, file, service))), p);
  const ready = service.store!.db.project(); ready.stage = 'S02'; service.store!.db.set('project', ready);
  const run = service.makeRun('stage', '生成项目配置'); service.store!.db.saveRun(run);
  return { service, run };
}
function proposal(service: Service): ModelResult {
  const p = service.store!.db.project();
  return { ...fakeResult(''), calls: [{ id: 'save', name: 'propose_changes', arguments: JSON.stringify({
    changes: stageOutputs(p.stage, p).map(file => service.change(file, fixture(p, file, service)))
  }) }], stop: 'tools' };
}
test('Pi 正式默认：完整候选一轮结束，累计预算、正式稿边界和真实执行事件保留', async () => {
  let service!: Service, calls = 0;
  const prepared = await setup(async () => { calls++; return proposal(service); }); service = prepared.service;
  try {
    assert.equal(prepared.run.executorId, 'pi'); assert.equal(prepared.run.executorVersion, piExecutorVersion);
    await service.executor!.execute({ id: prepared.run.id, kind: 'run' });
    const done = service.store!.db.run(prepared.run.id);
    assert.equal(calls, 1); assert.equal(done.rounds, 1); assert.equal(done.toolCount, 1);
    assert.equal(done.status, 'awaiting_review', done.error ?? ''); assert.equal(done.accepted, false);
    assert.equal(attempts(service.store!, done.id).length, 1);
    assert.ok(service.store!.db.events().some(e => e.runId === done.id && e.kind === 'pi-turn'));
    assert.equal(service.store!.db.project().stage, 'S02');
  } finally { await service.drain(); }
});
for (const protocol of ['chat', 'responses', 'anthropic', 'gemini'] as const) test(`Pi ${protocol} 仍经原网关，下一轮原生信息和工具回执不失真`, async () => {
  let service!: Service, calls = 0;
  const native = { opaque: `${protocol}-signature` };
  const prepared = await setup(async (profile, _system, messages) => {
    assert.equal(profile.protocol, protocol); calls++;
    if (calls === 1) return { ...fakeResult(''), native, stop: 'tools', calls: [{ id: 'read', name: 'read_document', arguments: JSON.stringify({ path: '01_设定拆解/设定拆解.md' }) }] };
    assert.deepEqual(messages.find(m => m.role === 'assistant')!.native, native);
    assert.ok(messages.some(m => m.role === 'tool' && m.callId === 'read'));
    return proposal(service);
  }, protocol); service = prepared.service;
  try {
    await service.executor!.execute({ id: prepared.run.id, kind: 'run' });
    const done = service.store!.db.run(prepared.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? ''); assert.equal(calls, 2); assert.equal(done.rounds, 2);
  } finally { await service.drain(); }
});
test('Pi 已到轮数上限不会重置计数或发送请求，旧 Legacy 任务仍由原执行器恢复', async () => {
  let service!: Service, calls = 0;
  const prepared = await setup(async () => { calls++; return proposal(service); }); service = prepared.service;
  try {
    prepared.run.rounds = 12; service.store!.db.saveRun(prepared.run);
    await service.executor!.execute({ id: prepared.run.id, kind: 'run' });
    assert.equal(calls, 0); assert.equal(service.store!.db.run(prepared.run.id).rounds, 12);
    const legacy = service.makeRun('stage', '继续旧任务'); legacy.executorId = 'legacy'; legacy.executorVersion = '1';
    service.store!.db.saveRun(legacy); await service.executor!.execute({ id: legacy.id, kind: 'run' });
    assert.equal(service.store!.db.run(legacy.id).status, 'awaiting_review'); assert.equal(calls, 1);
    assert.ok(!service.store!.db.events().some(e => e.runId === legacy.id && e.kind === 'pi-turn'));
  } finally { await service.drain(); }
});
test('Pi 断流仅计一次未知请求，恢复检查不联网，旧实验检查点不能冒充正式版本', async () => {
  let calls = 0;
  const { service, run } = await setup(async () => { calls++; throw new RequestError('fixture disconnected', true); });
  try {
    await service.executor!.execute({ id: run.id, kind: 'run' });
    assert.equal(calls, 1); assert.equal(service.store!.db.run(run.id).status, 'unknown');
    assert.equal(attempts(service.store!, run.id)[0].status, 'unknown');
    const actions: readonly string[] = service.executor!.restore({ runId: run.id, executorId: 'pi', executorVersion: piExecutorVersion, checkpointVersion: 1 });
    assert.ok(actions.includes('authorize_attempt'));
    assert.throws(() => service.executor!.restore({ runId: run.id, executorId: 'pi', executorVersion: '0.73.1', checkpointVersion: 1 }), /不受支持/);
    assert.equal(calls, 1);
  } finally { await service.drain(); }
});
test('Pi 流式文本在请求结束前送达界面，停止后的迟到结果不执行工具', async () => {
  const events: AppEvent[] = []; let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { reached = r; });
  let service!: Service;
  const prepared = await setup(async (_p, _s, _m, _t, _signal, delta) => {
    delta?.('正在'); delta?.('生成'); reached(); await gate; return proposal(service);
  }, 'chat', events); service = prepared.service;
  try {
    const pending = service.executor!.execute({ id: prepared.run.id, kind: 'run' }); await started;
    assert.equal(events.filter(e => e.type === 'delta').map(e => e.type === 'delta' ? e.text : '').join(''), '正在生成');
    service.runner!.stop(); release(); await pending;
    const done = service.store!.db.run(prepared.run.id);
    assert.equal(done.toolCount, 0); assert.equal(done.accepted, false);
    assert.equal(attempts(service.store!, done.id).length, 1);
  } finally { release(); await service.drain(); }
});

function syntheticTurn(overrides: Partial<TaskTurn> = {}): TaskTurn {
  return { profile: fakeProfile, system: '', messages: [{ role: 'user', content: '离线任务' }],
    tools: [{ name: 'save_draft', description: '', parameters: { type: 'object' } }],
    request: async delta => { delta('片段'); return { ...fakeResult('片段'), calls: [{ id: 'write', name: 'save_draft', arguments: '{}' }], stop: 'tools' }; },
    received: async () => true, execute: async () => ({ proceed: true, content: '{"saved":true}' }), finish: async () => false, ...overrides };
}
test('Pi 等待关键回执；检查点失败时下一工具不会执行，且没有额外收尾请求', async () => {
  let writes = 0, calls = 0, release!: () => void, reached!: () => void;
  const gate = new Promise<void>(r => { release = r; }), atBarrier = new Promise<void>(r => { reached = r; });
  const turn = syntheticTurn({ execute: async () => { writes++; return { proceed: true, content: '{}' }; } });
  const request = turn.request; turn.request = async delta => { calls++; return request(delta); };
  const pending = runTaskLoop({ executorId: 'pi', signal: new AbortController().signal, next: async () => turn,
    event: async event => { if (event.type === 'message_end' && event.message.role === 'assistant') { reached(); await gate; throw new Error('checkpoint failed'); } } });
  await atBarrier; assert.equal(writes, 0); release(); await assert.rejects(pending, /checkpoint failed/);
  assert.equal(calls, 1); assert.equal(writes, 0);
});
test('Pi 保留原始工具参数并按批次顺序阻断，错误不会只停留在 Pi 临时记录中', async () => {
  const seen: string[] = [], messages: ModelMessage[] = [];
  const turn = syntheticTurn({ messages,
    request: async () => ({ ...fakeResult(''), calls: [{ id: 'a', name: 'unknown', arguments: '{bad' }, { id: 'b', name: 'save_draft', arguments: '{}' }], stop: 'tools' }),
    execute: async call => { seen.push(call.arguments); messages.push({ role: 'tool', callId: call.id, content: 'denied' }); return { proceed: false, content: 'denied' }; }
  });
  await runTaskLoop({ executorId: 'pi', signal: new AbortController().signal, next: async () => turn });
  assert.deepEqual(seen, ['{bad']); assert.equal(messages.length, 1);
});

test('Pi 不按重复的上游调用编号猜测参数；每个调用仍交由原工具网关判断', async () => {
  const seen: string[] = [];
  const turn = syntheticTurn({
    request: async () => ({ ...fakeResult(''), stop: 'tools', calls: [
      { id: 'same', name: 'save_draft', arguments: '{"text":"first"}' },
      { id: 'same', name: 'save_draft', arguments: '{"text":"second"}' }
    ] }),
    execute: async call => { seen.push(call.arguments); return { proceed: true, content: '{}' }; }
  });
  await runTaskLoop({ executorId: 'pi', signal: new AbortController().signal, next: async () => turn });
  assert.deepEqual(seen, ['{"text":"first"}', '{"text":"second"}']);
});

test('Pi 截断输出仅保存回执，不能执行其中看似完整的工具', async () => {
  let receipts = 0, writes = 0;
  const turn = syntheticTurn({
    request: async () => ({ ...fakeResult('未完成'), stop: 'length', calls: [{ id: 'write', name: 'save_draft', arguments: '{}' }] }),
    received: async () => { receipts++; return true; },
    execute: async () => { writes++; return { proceed: true, content: '{}' }; }
  });
  await assert.rejects(runTaskLoop({ executorId: 'pi', signal: new AbortController().signal, next: async () => turn }), /未完整结束/);
  assert.equal(receipts, 1); assert.equal(writes, 0);
});
