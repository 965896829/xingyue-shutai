import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { StoryLabService } from '../src/core/story-lab/service';
import { LabStore } from '../src/core/story-lab/store';
import { labProfile } from '../src/core/story-lab/context';
import { invokeModel, RequestError } from '../src/core/provider';
import { attempts } from '../src/core/runtime/model-gateway';
import { labGenerateSchema, labRequirementsSchema } from '../src/shared/story-lab';
import { fakeProfile, isolatedRoot } from './fixtures/refactor';
import type { SecretProfile } from '../src/shared/types';

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const reasoning = { type: 'reasoning', id: 'rs_local', summary: [] };
const initial = [
  { type: 'response.created', response: { id: 'resp_local' } },
  { type: 'response.in_progress', response: { id: 'resp_local' } },
  { type: 'response.output_item.added', output_index: 0, item: reasoning },
  { type: 'response.reasoning_summary_part.added', output_index: 0 },
  { type: 'response.reasoning_summary_part.done', output_index: 0 },
  { type: 'response.output_item.done', output_index: 0, item: reasoning }
];
const text = '# 核心设定\n本地模拟完整构想，不是收费模型输出。';
const completed = { type: 'response.completed', response: { id: 'resp_local', status: 'completed',
  output: [{ type: 'message', id: 'msg_local', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 100, output_tokens: 40 } } };

function setup(profile: SecretProfile, caller = invokeModel) {
  const root = isolatedRoot('lab-transport');
  const lab = new StoryLabService(root, path.resolve('resources/skill'), () => [profile], () => {}, caller);
  const session = lab.create({ id: crypto.randomUUID(), requirements: labRequirementsSchema.parse({ idea: '东方玄幻＋脑洞＋规则怪谈' }), profileId: profile.id, outputLimit: 4096 }).session;
  const input = labGenerateSchema.parse({ sessionId: session.id, requestId: crypto.randomUUID(), action: 'blueprint', baseVersionId: null });
  return { lab, root, session, input };
}

test('lab uses HTTP/SSE before sending, bypasses a 1011 WS idle closure, and preserves global settings', async t => {
  // Optional local endurance run crosses the observed 120s idle interval.
  const idleMs = Number(process.env.STORY_LAB_IDLE_CHECK_MS ?? 200);
  assert.ok(idleMs >= 100 && idleMs <= 130000);
  let posts = 0, upgrades = 0;
  const server = http.createServer((req, res) => {
    posts++;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/responses');
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const item of initial) res.write(frame(item));
    const timer = setTimeout(() => res.end(frame({ type: 'response.output_text.delta', delta: text }) + frame(completed)), idleMs);
    res.on('close', () => clearTimeout(timer));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', socket => socket.on('message', () => {
    upgrades++;
    for (const item of initial) socket.send(JSON.stringify(item));
    const timer = setTimeout(() => socket.close(1011, 'upstream read EOF'), 50);
    socket.on('close', () => clearTimeout(timer));
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const profile: SecretProfile = { ...structuredClone(fakeProfile), protocol: 'responses', responsesTransport: 'websocket',
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, outputLimit: 4096, timeoutSeconds: 600 };
  const original = structuredClone(profile);
  await assert.rejects(invokeModel(profile, '', [], [], new AbortController().signal), error => {
    assert.ok(error instanceof RequestError);
    assert.equal(error.uncertain, true);
    assert.equal(error.diagnostic?.code, 'WEBSOCKET_CLOSED');
    assert.equal(error.diagnostic?.closeCode, 1011);
    assert.equal(error.diagnostic?.eventCount, 6);
    assert.equal(error.diagnostic?.lastEventType, 'response.output_item.done');
    assert.match(error.message, /1011/);
    assert.equal(error.partial?.text, '');
    return true;
  });
  const { lab, session, input } = setup(profile);
  try {
    const began = Date.now();
    lab.start(input); await lab.settled(session.id);
    const result = lab.store.get('requests', input.requestId)!;
    assert.ok(Date.now() - began >= idleMs);
    assert.equal(result.status, 'complete');
    assert.equal(result.response, text);
    assert.equal(result.model.transport, 'http');
    assert.equal(result.model.timeoutSeconds, 600);
    assert.equal(result.attempts, 1);
    assert.equal(result.failure, undefined);
    assert.equal(lab.store.journal.db.project(), undefined);
    assert.equal(posts, 1);
    assert.equal(upgrades, 1, 'only the deliberate legacy control used WS');
    lab.start(input); await lab.settled(session.id);
    assert.equal(posts, 1, 'same request ID never replays');
    assert.deepEqual(profile, original);
  } finally { await lab.close(); }
});

test('truncated HTTP stream keeps text, unknown fee and diagnostics without protocol fallback or replay', async t => {
  let posts = 0, upgrades = 0;
  const server = http.createServer((req, res) => {
    posts++; req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'relay_local' });
    res.end(initial.map(frame).join('') + frame({ type: 'response.output_text.delta', delta: '已收到的开篇' }));
  });
  server.on('upgrade', (_req, socket) => { upgrades++; socket.destroy(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const profile: SecretProfile = { ...fakeProfile, protocol: 'responses', responsesTransport: 'websocket',
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, outputLimit: 4096 };
  const { lab, session, input, root } = setup(profile);
  try {
    lab.start(input); await lab.settled(session.id);
    const result = lab.store.get('requests', input.requestId)!;
    assert.equal(result.status, 'unknown');
    assert.equal(result.response, '已收到的开篇');
    assert.equal(result.usage.cost, null);
    assert.equal(result.failure?.code, 'INCOMPLETE_RESPONSE');
    assert.equal(result.failure?.requestId, 'relay_local');
    assert.equal(result.failure?.eventCount, 7);
    assert.equal(result.attempts, 1);
    assert.equal(attempts(lab.store.journal, input.requestId).length, 1);
    lab.start(input); await lab.settled(session.id);
    assert.equal(posts, 1); assert.equal(upgrades, 0);
    // Simulate a historical lab row which only kept the failure in the journal.
    delete result.failure; lab.store.save('requests', result);
    const before = lab.store.get('requests', input.requestId);
    assert.equal(lab.store.detail(session.id).requests[0].failure?.code, 'INCOMPLETE_RESPONSE');
    assert.deepEqual(lab.store.get('requests', input.requestId), before, 'reading diagnosis does not rewrite history');
  } finally { await lab.close(); }
  const reopened = new LabStore(root);
  try {
    assert.equal(reopened.detail(session.id).requests[0].status, 'unknown');
    assert.equal(reopened.detail(session.id).requests[0].failure?.requestId, 'relay_local');
    assert.equal(posts, 1);
  } finally { reopened.close(); }
});

test('lab exposes only bounded connection metadata, excluding opaque failure payloads', async () => {
  const { lab, session, input } = setup({ ...fakeProfile, outputLimit: 4096 }, async () => {
    throw new RequestError('连接中断', true, Object.assign({ source: 'transport' as const, code: 'WEBSOCKET_CLOSED', closeCode: 1011, elapsedMs: 146000 }, { headers: { Authorization: 'private-secret' }, encrypted_content: 'opaque-reasoning' }));
  });
  try {
    lab.start(input); await lab.settled(session.id);
    const result = lab.store.detail(session.id).requests[0];
    assert.deepEqual(result.failure, { source: 'transport', code: 'WEBSOCKET_CLOSED', closeCode: 1011, elapsedMs: 146000 });
    assert.doesNotMatch(JSON.stringify(result), /private-secret|opaque-reasoning|encrypted_content/);
  } finally { await lab.close(); }
});

test('lab HTTP override is confined to Responses snapshots', () => {
  const source = structuredClone(fakeProfile);
  assert.equal(labProfile(source, 128).responsesTransport, source.responsesTransport);
  assert.deepEqual(source, fakeProfile);
});
