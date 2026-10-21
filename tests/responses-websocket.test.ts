import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { invokeModel, RequestError } from '../src/core/provider';
import { profileSchema, type ModelMessage } from '../src/shared/types';
import { modelFields, connectionFields } from '../src/shared/provider-groups';
import { prepareProviderGroup } from '../src/core/provider-groups';
import { parseOutput } from '../src/shared/contracts';

const complete = (output: unknown[], status = 'completed') => ({
  type: status === 'completed' ? 'response.completed' : 'response.incomplete',
  response: { status, output, usage: { input_tokens: 9, output_tokens: 4 },
    ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) }
});
const textOutput = [{ type: 'message', content: [{ type: 'output_text', text: '完成', annotations: [] }] }];

async function endpoint(t: test.TestContext, handle: (socket: WebSocket, body: any, request: http.IncomingMessage) => void) {
  const server = http.createServer((_req, res) => { res.writeHead(500); res.end(); });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, request) => socket.on('message', (body) => handle(socket, JSON.parse(body.toString()), request)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as net.AddressInfo).port;
  return { server, sockets, profile: { ...profileSchema.parse({
    id: 'ws-test', name: 'WS test', protocol: 'responses', model: 'gpt-6.1-sol',
    baseUrl: `http://127.0.0.1:${port}/v1`, responsesTransport: 'websocket', reasoningEffort: 'high'
  }), apiKey: 'test-secret' } };
}

test('Responses WebSocket keeps tools, native state, reasoning, usage and search citations across fresh connections', async (t) => {
  const bodies: any[] = [];
  const { profile } = await endpoint(t, (socket, body, request) => {
    assert.equal(request.url, '/v1/responses');
    assert.equal(request.headers.authorization, 'Bearer test-secret');
    bodies.push(body);
    assert.equal(body.type, 'response.create');
    assert.equal(body.stream, undefined);
    assert.equal(body.background, undefined);
    assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, 'high');
    if (bodies.length === 1) {
      socket.send(JSON.stringify({ type: 'response.output_item.added', item: { type: 'reasoning' } }));
      socket.send(JSON.stringify({ type: 'response.function_call_arguments.delta', delta: '{}' }));
      socket.send(JSON.stringify(complete([
        { type: 'reasoning', encrypted_content: 'opaque-state' },
        { type: 'function_call', call_id: 'call-1', name: 'read_fixture', arguments: '{}' }
      ])));
    } else {
      socket.send(JSON.stringify({ type: 'response.output_text.delta', delta: '完成' }));
      socket.send(JSON.stringify({ type: 'response.web_search_call.completed', item_id: 'search-1' }));
      socket.send(JSON.stringify({ type: 'response.output_text.annotation.added', annotation: {
        type: 'url_citation', url: 'https://example.org/source', title: '来源', start_index: 0, end_index: 2
      } }));
      socket.send(JSON.stringify(complete(textOutput)));
    }
  });
  const messages: ModelMessage[] = [{ role: 'user', content: '读取测试素材再回答。' }];
  const tools = [{ name: 'read_fixture', description: '读取测试素材', parameters: { type: 'object', properties: {} } }];
  const activity: string[] = [];
  const first = await invokeModel(profile, 'system', messages, tools, new AbortController().signal, () => {}, { onActivity: (s) => activity.push(s) });
  assert.equal(first.stop, 'tools');
  assert.equal(first.calls[0].id, 'call-1');
  assert.deepEqual(first.usage, { input: 9, output: 4, cost: null, currency: 'USD' });
  assert.ok(activity.includes('thinking') && activity.includes('tool_input'));
  messages.push({ role: 'assistant', content: first.text, calls: first.calls, native: first.native }, { role: 'tool', content: '素材', callId: 'call-1' });
  let delta = ''; const searches: unknown[] = []; const citations: unknown[] = [];
  const second = await invokeModel(profile, 'system', messages, tools, new AbortController().signal, (s) => { delta += s; }, {
    webSearch: { maxCalls: 1 }, onWebSearch: (s) => searches.push(s), onWebCitation: (s) => citations.push(s)
  });
  assert.equal(second.stop, 'complete');
  assert.equal(second.text, '完成');
  assert.equal(delta, '完成');
  assert.equal(bodies.length, 2);
  assert.ok(bodies[1].input.some((item: any) => item.encrypted_content === 'opaque-state'));
  assert.ok(bodies[1].input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'call-1'));
  assert.ok(bodies[1].tools.some((tool: any) => tool.type === 'web_search'));
  assert.equal(searches.length, 1); assert.equal(citations.length, 1);
});

for (const mode of ['close', 'failed', 'malformed', 'incomplete'] as const) {
  test(`Responses WebSocket ${mode} preserves partial output without retrying or claiming completion`, async (t) => {
    let calls = 0; let delta = '';
    const { profile } = await endpoint(t, (socket) => {
      calls++;
      socket.send(JSON.stringify({ type: 'response.output_text.delta', delta: '已收到片段' }));
      if (mode === 'close') socket.close();
      if (mode === 'failed') socket.send(JSON.stringify({ type: 'response.failed', response: { error: { code: 'upstream_stream_read_error' } } }));
      if (mode === 'malformed') socket.send('{broken-json');
      if (mode === 'incomplete') socket.send(JSON.stringify(complete(textOutput, 'incomplete')));
    });
    const run = invokeModel(profile, '', [{ role: 'user', content: 'test' }], [], new AbortController().signal, (s) => { delta += s; });
    if (mode === 'incomplete') assert.equal((await run).stop, 'length');
    else await assert.rejects(run, (error: unknown) => error instanceof RequestError && error.uncertain);
    assert.equal(delta, '已收到片段');
    assert.equal(calls, 1);
  });
}

test('Responses WebSocket cancellation and request deadline terminate a quiet connection', async (t) => {
  let calls = 0;
  const controller = new AbortController();
  const { profile } = await endpoint(t, () => { if (++calls === 1) controller.abort(); });
  await assert.rejects(invokeModel(profile, '', [], [], controller.signal), (error: unknown) =>
    error instanceof RequestError && error.diagnostic?.code === 'CANCELLED');
  await assert.rejects(invokeModel({ ...profile, timeoutSeconds: 0.25 }, '', [], [], new AbortController().signal), (error: unknown) =>
    error instanceof RequestError && error.diagnostic?.code === 'REQUEST_TIMEOUT');
  assert.equal(calls, 2);
});

test('Responses WebSocket uses the configured HTTP CONNECT proxy and closes its tunnel', async (t) => {
  const { profile } = await endpoint(t, (socket) => socket.send(JSON.stringify(complete(textOutput))));
  let connections = 0;
  const active = new Set<net.Socket>();
  const proxy = http.createServer();
  proxy.on('connect', (request, downstream, head) => {
    connections++;
    const destination = new URL('http://' + request.url);
    const upstream = net.connect(Number(destination.port), destination.hostname, () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream); upstream.pipe(downstream);
    });
    for (const socket of [downstream as net.Socket, upstream]) {
      active.add(socket); socket.on('close', () => active.delete(socket)); socket.on('error', () => socket.destroy());
    }
    downstream.on('close', () => upstream.destroy()); upstream.on('close', () => downstream.destroy());
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(async () => { for (const socket of active) socket.destroy(); await new Promise<void>((resolve) => proxy.close(() => resolve())); });
  const result = await invokeModel({ ...profile, timeoutSeconds: 1, proxy: `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}` }, '', [], [], new AbortController().signal);
  assert.equal(result.text, '完成'); assert.equal(connections, 1);
});

test('Responses WebSocket rejects an oversized event and an already cancelled request sends nothing', async (t) => {
  let calls = 0;
  const { profile } = await endpoint(t, (socket) => { calls++; socket.send(JSON.stringify({ type: 'response.output_text.delta', delta: 'a'.repeat(8 * 1024 * 1024) })); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(invokeModel(profile, '', [], [], controller.signal), (error: unknown) =>
    error instanceof RequestError && !error.uncertain && error.diagnostic?.code === 'CANCELLED');
  assert.equal(calls, 0);
  await assert.rejects(invokeModel(profile, '', [], [], new AbortController().signal), (error: unknown) =>
    error instanceof RequestError && error.uncertain && error.diagnostic?.code === 'RESPONSE_TOO_LARGE');
  assert.equal(calls, 1);
});

test('Responses WebSocket refuses an unsupported handshake without sending a generation or falling back to HTTP', async (t) => {
  let upgrades = 0; let posts = 0;
  const server = http.createServer((_req, res) => { posts++; res.writeHead(500); res.end(); });
  server.on('upgrade', (_req, socket) => { upgrades++; socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const profile = { ...profileSchema.parse({ id: 'ws', name: 'ws', model: 'model', protocol: 'responses',
    responsesTransport: 'websocket', baseUrl: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/v1` }), apiKey: 'key' };
  await assert.rejects(invokeModel(profile, '', [], [], new AbortController().signal), (error: unknown) =>
    error instanceof RequestError && !error.uncertain && error.diagnostic?.code === 'WEBSOCKET_CONNECTION_ERROR');
  assert.equal(upgrades, 1); assert.equal(posts, 0);
});

test('Responses WebSocket settings survive model group saving and the IPC result contract; legacy profiles keep HTTP', () => {
  const legacy = profileSchema.parse({ id: 'legacy', name: 'local', protocol: 'responses', model: 'model', baseUrl: 'http://localhost:8080/v1' });
  assert.equal(legacy.responsesTransport, undefined);
  const saved = prepareProviderGroup([{ ...legacy, encryptedKey: '' }], connectionFields(legacy), [{ ...modelFields(legacy), responsesTransport: 'websocket' }]);
  assert.equal(saved.saved[0].responsesTransport, 'websocket');
  assert.equal(saved.saved[0].version, legacy.version + 1);
  assert.equal(parseOutput('profiles.save', saved.saved[0]).responsesTransport, 'websocket');
});
