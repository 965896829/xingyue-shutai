import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { invokeModel, RequestError } from '../src/core/provider';
import { profileSchema } from '../src/shared/types';
import { callModel, attempts } from '../src/core/runtime/model-gateway';
import { refactorFixture } from './fixtures/refactor';

const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const output = [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'propose_changes', arguments: '{"content":"完整候选"}' }];
const completed = { type: 'response.completed', response: { status: 'completed', output,
  usage: { input_tokens: 100, output_tokens: 50 } } };
const profile = { ...profileSchema.parse({ id: 'idle-timeout-test', name: '本地超时测试',
  protocol: 'responses', baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture', stream: true,
  contextLimit: 100000, outputLimit: 4096 }), apiKey: 'local-only' };

async function endpoint(t: test.TestContext, handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` };
}

test('持续生成跨过原总时限后完整提交一次，保留原生调用及用量', async t => {
  let requests = 0;
  const { baseUrl } = await endpoint(t, (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event({ type: 'response.output_item.added', item: { id: 'reasoning_1', type: 'reasoning' } }));
    let count = 0;
    const timer = setInterval(() => {
      if (++count === 9) { clearInterval(timer); res.end(event(completed)); return; }
      res.write(event(count < 4 ? { type: 'response.reasoning_summary_text.delta', delta: '思考进展' }
        : { type: 'response.function_call_arguments.delta', delta: '候选内容' }));
    }, 70);
    res.on('close', () => clearInterval(timer));
  });
  const start = Date.now();
  const result = await invokeModel({ ...profile, baseUrl, timeoutSeconds: .3 }, '', [], [], new AbortController().signal);
  assert.ok(Date.now() - start > 550);
  assert.equal(requests, 1);
  assert.equal(result.stop, 'tools');
  assert.deepEqual(result.native, output);
  assert.deepEqual(result.calls.map(x => [x.id, x.name, x.arguments]), [['call_1', 'propose_changes', '{"content":"完整候选"}']]);
  assert.equal(result.usage.output, 50);
});

test('心跳、空增量和重复状态不能无限延长无进展超时', async t => {
  let requests = 0;
  const { baseUrl } = await endpoint(t, (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const timer = setInterval(() => res.write(': keepalive\n\n' +
      event({ type: 'response.output_item.added', item: { id: 'same_item', type: 'reasoning' } }) +
      event({ type: 'response.function_call_arguments.delta', delta: '' }) +
      event({ type: 'unknown.keepalive', delta: 'not generated output' })), 35);
    res.on('close', () => clearInterval(timer));
  });
  await assert.rejects(invokeModel({ ...profile, baseUrl, timeoutSeconds: .2 }, '', [], [], new AbortController().signal), error => {
    assert.ok(error instanceof RequestError && error.uncertain);
    assert.equal(error.diagnostic?.code, 'REQUEST_TIMEOUT');
    assert.equal(error.diagnostic?.timeoutMode, 'idle');
    assert.ok(error.diagnostic!.progressIdleMs! >= 190);
    assert.ok(error.diagnostic!.idleMs! < 150, 'recent noise does not count as model progress');
    assert.ok(error.diagnostic!.elapsedMs! < 700);
    return true;
  });
  assert.equal(requests, 1);
});

test('非流式响应仍遵守总等待时限，传输零碎字节不会续期', async t => {
  const { baseUrl } = await endpoint(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"waiting":"');
    const timer = setInterval(() => res.write('.'), 35);
    res.on('close', () => clearInterval(timer));
  });
  await assert.rejects(invokeModel({ ...profile, stream: false, baseUrl, timeoutSeconds: .2 }, '', [], [], new AbortController().signal), error => {
    assert.ok(error instanceof RequestError && error.uncertain);
    assert.equal(error.diagnostic?.timeoutMode, 'total');
    assert.equal(error.diagnostic?.code, 'REQUEST_TIMEOUT');
    return true;
  });
});

test('Responses完整终止事件可结束调用，不等待中转额外关闭HTTP连接', async t => {
  const { baseUrl } = await endpoint(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event(completed));
  });
  const result = await invokeModel({ ...profile, baseUrl, timeoutSeconds: .2 }, '', [], [], new AbortController().signal);
  assert.equal(result.stop, 'tools');
  assert.deepEqual(result.native, output);
});

test('正在生成时作者取消仍立即生效，不等待空闲计时', async t => {
  const controller = new AbortController();
  let requests = 0;
  const { baseUrl } = await endpoint(t, (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const timer = setInterval(() => res.write(event({ type: 'response.output_text.delta', delta: '文字' })), 30);
    res.on('close', () => clearInterval(timer));
  });
  const cancel = setTimeout(() => controller.abort(), 160);
  try {
    await assert.rejects(invokeModel({ ...profile, baseUrl, timeoutSeconds: 10 }, '', [], [], controller.signal), error =>
      error instanceof RequestError && error.diagnostic?.code === 'CANCELLED' && error.uncertain);
    assert.equal(requests, 1);
  } finally { clearTimeout(cancel); }
});

test('WebSocket持续工具输出同样延长无进展时限，仅发送一次', async t => {
  const { server, baseUrl } = await endpoint(t, (_req, res) => { res.writeHead(404); res.end(); });
  const sockets = new WebSocketServer({ server });
  let requests = 0;
  sockets.on('connection', socket => socket.on('message', () => {
    requests++;
    let count = 0;
    const timer = setInterval(() => {
      if (++count === 9) { clearInterval(timer); socket.send(JSON.stringify(completed)); return; }
      socket.send(JSON.stringify({ type: 'response.function_call_arguments.delta', delta: '工具参数' }));
    }, 70);
    socket.on('close', () => clearInterval(timer));
  }));
  try {
    const result = await invokeModel({ ...profile, baseUrl, responsesTransport: 'websocket', timeoutSeconds: .3 }, '', [], [], new AbortController().signal);
    assert.equal(result.stop, 'tools');
    assert.equal(requests, 1);
    assert.deepEqual(result.native, output);
  } finally {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
  }
});

test('中止的Responses工具参数持久化为片段，不执行、不采纳、不重发', async t => {
  let requests = 0;
  const fragment = '{"changes":[{"path":"章节总纲.md","content":"未完成';
  const { baseUrl } = await endpoint(t, (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event({ type: 'response.output_item.added', output_index: 0, item: { id: 'fc_partial', type: 'function_call', call_id: 'call_partial', name: 'propose_changes', arguments: '' } }));
    res.write(event({ type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_partial', delta: fragment }));
  });
  const { store, run } = refactorFixture();
  const originalChanges = structuredClone(run.changes);
  try {
    await assert.rejects(callModel(store, run, 'test', invokeModel, { ...profile, baseUrl, timeoutSeconds: .2 }, '', [], [], new AbortController().signal), error => {
      assert.ok(error instanceof RequestError && error.uncertain);
      assert.equal(error.partial?.incomplete, true);
      assert.equal(error.partial?.output[0].arguments, fragment);
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /未完成|changes/);
      return true;
    });
    const records = attempts(store, run.id);
    assert.equal(requests, 1);
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'unknown');
    assert.equal(records[0].usageState, 'unknown');
    assert.equal(records[0].responseRef, undefined);
    const partial = JSON.parse(store.object(records[0].partialResponseRef!).toString('utf8'));
    assert.equal(partial.incomplete, true);
    assert.equal(partial.output[0].arguments, fragment);
    assert.deepEqual(run.changes, originalChanges);
  } finally { store.close(); }
});
