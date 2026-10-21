import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { invokeModel, normalize } from '../src/core/provider';
import { attempts, callModel } from '../src/core/runtime/model-gateway';
import { Service } from '../src/core/service';
import { fakeProfile, isolatedRoot, refactorFixture } from './fixtures/refactor';

const refusal = '无法按该请求生成内容，请调整创作要求。';
const wire = (protocol: 'chat' | 'responses') => protocol === 'chat'
  ? { choices: [{ message: { role: 'assistant', content: null, refusal }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20 } }
  : { status: 'completed', output: [{ id: 'message-1', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'refusal', refusal }] }], usage: { input_tokens: 10, output_tokens: 20 } };
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

for (const protocol of ['chat', 'responses'] as const) for (const stream of [false, true])
  test(`${protocol} ${stream ? '流式' : '非流式'}拒绝保留文本、原生结构和已知费用`, async () => {
    let requests = 0;
    const response = wire(protocol);
    const server = http.createServer((_request, res) => {
      requests++;
      res.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' });
      if (!stream) return void res.end(JSON.stringify(response));
      const parts = [refusal.slice(0, 8), refusal.slice(8)];
      if (protocol === 'chat') res.end(
        parts.map((part) => event({ choices: [{ delta: { refusal: part }, finish_reason: null }] })).join('') +
        event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
        event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20 } }) + 'data: [DONE]\n\n');
      else res.end(parts.map((delta) => event({ type: 'response.refusal.delta', delta })).join('') +
        event({ type: 'response.completed', response }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { store, run } = refactorFixture();
    try {
      const port = (server.address() as { port: number }).port;
      const profile = { ...fakeProfile, protocol, stream, baseUrl: `http://127.0.0.1:${port}/v1` };
      const deltas: string[] = [];
      const result = await callModel(store, run, 'refusal', invokeModel, profile, '测试系统', [], [],
        new AbortController().signal, (delta) => deltas.push(delta));
      assert.equal(requests, 1);
      assert.equal(result.stop, 'filtered');
      assert.equal(result.text, refusal);
      assert.equal(deltas.join(''), stream ? refusal : '');
      assert.deepEqual(result.calls, []);
      assert.equal(result.usage.cost, 0.00003);
      assert.deepEqual(result.usage, { input: 10, output: 20, cost: 0.00003, currency: 'USD' });
      if (protocol === 'chat') assert.equal((result.native as { refusal: string }).refusal, refusal);
      else assert.deepEqual(result.native, response.output);
      const records = attempts(store, run.id);
      assert.equal(records.length, 1);
      assert.equal(records[0].status, 'complete');
      assert.equal(records[0].usageState, 'known');
      assert.equal(records[0].usage!.cost, result.usage.cost);
      assert.equal(JSON.parse(store.object(records[0].responseRef!).toString('utf8')).result.stop, 'filtered');
    } finally {
      store.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

for (const protocol of ['chat', 'responses'] as const)
  test(`${protocol} 明确拒绝停在候选修复状态，不自动补发请求`, async () => {
    let requests = 0;
    const model = { ...fakeProfile, protocol, contextLimit: 200000, outputLimit: 4096, stream: false };
    const service = new Service(path.resolve('resources/skill'), () => {}, async () => {
      requests++;
      return normalize(model, wire(protocol));
    });
    service.profiles = [model];
    try {
      await service.invoke('project.create', { parent: isolatedRoot('refusal-run'), title: '拒绝响应验收',
        premise: '维修员追查停电原因', config: { defaultProfileId: model.id } });
      const store = service.store!, project = store.db.project();
      project.stage = 'S02'; project.completed['S01:global'] = 'accepted-in-fixture';
      store.db.set('project', project);
      const run = service.makeRun('stage', '整理项目与文风');
      store.db.saveRun(run);
      await service.runner!.drive(run.id);
      const current = store.db.run(run.id);
      assert.equal(requests, 1, current.error ?? '模型应收到一次请求');
      assert.equal(current.status, 'needs_repair');
      assert.equal(current.responseText, refusal);
      assert.equal(current.repairAttempts, undefined);
      assert.equal(current.usage.cost, 0.00003);
      assert.equal(current.accepted, false);
      assert.deepEqual(current.changes, []);
      assert.equal(store.db.project().revision, project.revision);
    } finally { await service.drain(); }
  });
