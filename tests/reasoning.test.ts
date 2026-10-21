import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { profileSchema, type SecretProfile } from '../src/shared/types';
import { parseInput, parseOutput } from '../src/shared/contracts';
import {
  captureReasoning,
  reasoningCapability,
  validateReasoning,
  withTaskReasoning
} from '../src/shared/reasoning';
import { updateReasoningPreference, sameModelExecution } from '../src/core/reasoning-preferences';
import { requestBody, invokeModel } from '../src/core/provider';
import { prepareProviderGroup } from '../src/core/provider-groups';
import { connectionFields, modelFields } from '../src/shared/provider-groups';
import { callModel, attempts } from '../src/core/runtime/model-gateway';
import { Service } from '../src/core/service';
import { refactorFixture, isolatedRoot, fakeResult } from './fixtures/refactor';

const profile = (changes: Partial<SecretProfile> = {}): SecretProfile => ({
  ...profileSchema.parse({
    id: 'reasoning',
    name: '本地验收',
    model: 'gpt-6.1-sol',
    protocol: 'responses',
    baseUrl: 'http://127.0.0.1:1/v1',
    inputPrice: 1,
    outputPrice: 1,
    contextLimit: 128000,
    outputLimit: 4000
  }),
  apiKey: 'fixture-only',
  ...changes
});

test('推理档位按确切模型与协议校验，不把 Codex 专属档位或中转别名当作 API 能力', () => {
  assert.deepEqual(reasoningCapability(profile())!.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
    assert.throws(() => validateReasoning(profile({ model, reasoningEffort: 'none' })), /不支持/);
    assert.doesNotThrow(() => validateReasoning(profile({ model, reasoningEffort: 'max' })));
  }
  assert.doesNotThrow(() => validateReasoning(profile({ model: 'gpt-5.4', reasoningEffort: 'none' })));
  assert.throws(() => validateReasoning(profile({ model: 'gpt-5.4', reasoningEffort: 'max' })), /不支持/);
  for (const model of ['relay/gpt-6.1-sol', 'gpt-6.1-sol-unknown', 'gpt-4o']) {
    assert.equal(reasoningCapability(profile({ model })), null);
    assert.throws(() => validateReasoning(profile({ model, reasoningEffort: 'high' })), /不支持/);
    assert.doesNotThrow(() => validateReasoning(profile({ model })));
  }
  assert.equal(reasoningCapability(profile({ model: 'gpt-5.4-pro', protocol: 'chat' })), null);
  for (const protocol of ['anthropic', 'gemini', 'images'] as const)
    assert.equal(reasoningCapability(profile({ protocol })), null);
  assert.throws(() =>
    parseInput('profiles.reasoning', { id: 'x', effort: 'ultra', expectedVersion: 1, expectedRevision: 0 })
  );
});

test('原生推理参数与输出上限相互独立，默认值不发送，非 OpenAI 协议不混入参数', () => {
  for (const stream of [true, false]) {
    const p = profile({ stream, reasoningEffort: 'max', temperature: 0.7 });
    const body = requestBody(p, 'system', [], []).body;
    assert.deepEqual(body.reasoning, { effort: 'max' });
    assert.equal(body.max_output_tokens, p.outputLimit);
    assert.equal('temperature' in body, false);
    assert.equal('reasoning_effort' in body, false);
    const chat = requestBody({ ...p, protocol: 'chat' }, 'system', [], []).body;
    assert.equal(chat.reasoning_effort, 'max');
    assert.equal('reasoning' in chat, false);
  }
  const defaults = requestBody(profile(), 'system', [], []).body;
  assert.equal('reasoning' in defaults, false);
  assert.ok(defaults.include.includes('reasoning.encrypted_content'));
  for (const protocol of ['chat', 'anthropic', 'gemini'] as const) {
    const body = requestBody(profile({ protocol, reasoningEffort: null }), 'system', [], []).body;
    assert.equal('reasoning_effort' in body || 'reasoning' in body, false);
  }
  const tool = { name: 'inspect', description: '', parameters: { type: 'object', properties: {} } };
  assert.throws(
    () => requestBody(profile({ protocol: 'chat', reasoningEffort: 'high' }), '', [], [tool]),
    /Responses/
  );
  const native = requestBody(profile({ reasoningEffort: 'max' }), '', [], [tool], {
    webSearch: { maxCalls: 1 }
  }).body;
  assert.equal(native.reasoning.effort, 'max');
  assert.ok(native.tools.some((t: { type: string }) => t.type === 'web_search'));
});

test('快速强度设置保留执行版本和密钥，检测并发修改，重复设置不增加修订号', () => {
  const p = { ...profile(), encryptedKey: 'opaque' };
  const high = updateReasoningPreference(p, 'high', p.version, 0);
  assert.equal(high.version, p.version);
  assert.equal(high.reasoningRevision, 1);
  assert.equal(high.encryptedKey, 'opaque');
  assert.equal(sameModelExecution(high, p), true);
  assert.equal(sameModelExecution({ ...high, temperature: 0.5 }, p), false);
  assert.equal(sameModelExecution({ ...high, enabled: false }, p), false);
  assert.deepEqual(high.capabilities, p.capabilities);
  assert.equal(updateReasoningPreference(high, 'high', high.version, 1), high);
  assert.throws(() => updateReasoningPreference(high, 'low', p.version, 0), /另一处修改/);
  assert.throws(() => updateReasoningPreference(high, 'low', p.version + 1, 1), /另一处修改/);
  assert.equal(updateReasoningPreference(high, null, p.version, 1).reasoningRevision, 2);
  const output = parseOutput('profiles.reasoning', high);
  assert.equal(output.reasoningEffort, 'high');
  assert.equal(output.reasoningRevision, 1);
});

test('供应商批量保存保留各模型的强度，旧表单不能覆盖新偏好', () => {
  const before = { ...profile(), encryptedKey: 'opaque' };
  const latest = updateReasoningPreference(before, 'max', before.version, 0);
  assert.throws(
    () => prepareProviderGroup([latest], connectionFields(before), [modelFields(before)]),
    /推理强度已在另一处修改/
  );
  const next = prepareProviderGroup([latest], connectionFields(latest), [
    { ...modelFields(latest), reasoningEffort: 'low' }
  ]).saved[0];
  assert.equal(next.reasoningRevision, 2);
  assert.equal(next.reasoningEffort, 'low');
  assert.equal(next.version, latest.version);
  assert.equal(next.encryptedKey, 'opaque');
  assert.throws(
    () =>
      prepareProviderGroup([latest], connectionFields(latest), [
        { ...modelFields(latest), reasoningEffort: 'none' }
      ]),
    /不支持/
  );
});

test('任务重载和实际请求绑定创建时的强度，后来修改偏好不会改变旧任务', async () => {
  const { store, run } = refactorFixture();
  const p = profile({ reasoningEffort: 'high' });
  try {
    run.profileId = p.id;
    run.reasoningEfforts = captureReasoning([p]);
    store.db.saveRun(run);
    const restored = store.db.run(run.id);
    const changed = updateReasoningPreference(p, 'max', p.version, 0);
    let called: SecretProfile | undefined;
    await callModel(
      store,
      restored,
      'reasoning-test',
      async (actual) => {
        called = actual;
        return fakeResult();
      },
      changed,
      '',
      [],
      [],
      new AbortController().signal
    );
    assert.equal(called!.reasoningEffort, 'high');
    const attempt = attempts(store, run.id)[0];
    const recorded = JSON.parse(store.object(attempt.requestRef!).toString());
    assert.equal(recorded.request.reasoning.effort, 'high');
    assert.equal(withTaskReasoning(changed, {}).reasoningEffort, null, '旧任务保持原来的服务端默认');
    assert.equal(changed.reasoningEffort, 'max', '绑定不能修改全局偏好');
  } finally {
    store.close();
  }
});

test('新建阶段任务与聊天轮次保存强度快照，并覆盖独立审核模型', async () => {
  const service = new Service(
    path.resolve('resources/skill'),
    () => {},
    async () => fakeResult()
  );
  const p = profile({ reasoningEffort: 'high' });
  service.profiles = [p, profile({ id: 'reviewer', reasoningEffort: 'low' })];
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('reasoning-book'),
      title: '推理测试',
      premise: '本地合成',
      config: { defaultProfileId: p.id }
    });
    const run = service.makeRun('stage', '合成任务');
    assert.deepEqual(run.reasoningEfforts, { reasoning: 'high', reviewer: 'low' });
    service.profiles[0] = updateReasoningPreference(p, 'max', p.version, 0);
    const conversation = service.chat!.records.create('合成聊天');
    const turn = service.chat!.prepare(conversation.id, '测试', p.id);
    assert.deepEqual(turn.reasoningEfforts, { reasoning: 'max' });
    assert.equal(run.reasoningEfforts![p.id], 'high');
    assert.equal(parseOutput('app.snapshot', service.snapshot()).profiles[0].reasoningEffort, 'max');
  } finally {
    await service.drain();
  }
});

test('真实 HTTP 传输分别携带 Responses 和 Chat 参数，拒绝后不会自动降档重发', async () => {
  const payloads: { url: string; data: any }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const data = JSON.parse(Buffer.concat(chunks).toString());
    payloads.push({ url: req.url!, data });
    res.setHeader('Content-Type', 'application/json');
    if (data.reasoning?.effort === 'max') {
      res.writeHead(400).end('{}');
      return;
    }
    res.end(
      JSON.stringify(
        req.url?.endsWith('/responses')
          ? {
              status: 'completed',
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
              usage: { input_tokens: 1, output_tokens: 1 }
            }
          : {
              choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            }
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const p = profile({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    reasoningEffort: 'high',
    stream: false
  });
  try {
    await invokeModel(p, '', [], [], new AbortController().signal);
    await invokeModel({ ...p, protocol: 'chat' }, '', [], [], new AbortController().signal);
    await assert.rejects(
      invokeModel({ ...p, reasoningEffort: 'max' }, '', [], [], new AbortController().signal),
      /推理强度为 max/
    );
    assert.equal(payloads.length, 3);
    assert.equal(payloads[0].data.reasoning.effort, 'high');
    assert.equal(payloads[1].data.reasoning_effort, 'high');
    assert.equal(payloads[2].data.reasoning.effort, 'max');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
