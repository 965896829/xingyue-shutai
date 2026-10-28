import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sse, invokeModel, RequestError } from '../src/core/provider';
import { SseFramer, SseFrameLimitError } from '../src/core/runtime/sse-framer';
import { responseTiming } from '../src/core/runtime/response-timing';
import { profileSchema } from '../src/shared/types';

for (const mode of ['empty', 'omitted', 'incomplete', 'unfinished', 'text-without-done'] as const) {
  test(`Responses terminal ${mode} uses only explicitly completed streamed items`, async (t) => {
    let requests = 0;
    const call = { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'submit_title_candidates', arguments: '{"title":"凡人修仙"}' };
    const search = { type: 'web_search_call', id: 'search-1', status: 'completed', action: { type: 'search', query: '玄幻', sources: [{ type: 'url', title: '参考书', url: 'https://fanqienovel.com/page/123' }] } };
    const server = http.createServer((_req, res) => {
      requests++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const write = (event: unknown) => res.write('data: ' + JSON.stringify(event) + '\n\n');
      write({ type: 'response.output_item.done', output_index: 0, item: search });
      if (mode === 'text-without-done') write({ type: 'response.output_text.delta', item_id: 'msg-1', output_index: 1, delta: '未完成文本' });
      else {
        write({ type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } });
        write({ type: 'response.function_call_arguments.delta', output_index: 1, item_id: call.id, delta: call.arguments });
        if (mode !== 'unfinished') write({ type: 'response.output_item.done', output_index: 1, item: call });
      }
      const incomplete = mode === 'incomplete';
      write({ type: incomplete ? 'response.incomplete' : 'response.completed', response: {
        id: 'resp-test', status: incomplete ? 'incomplete' : 'completed', ...(mode === 'omitted' ? {} : { output: [] }),
        ...(incomplete ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
        usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } }
      } });
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const profile = { ...profileSchema.parse({ id: 'relay', name: 'relay', protocol: 'responses',
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'fixture' }), apiKey: 'test' };
    const promise = invokeModel(profile, '', [], [], new AbortController().signal);
    if (mode === 'unfinished' || mode === 'text-without-done') await assert.rejects(promise, (e: unknown) => {
      assert.ok(e instanceof RequestError && e.uncertain);
      assert.ok(e.partial?.output.length);
      return true;
    });
    else {
      const result = await promise;
      assert.equal(result.calls.length, 1);
      assert.equal(result.calls[0].arguments, call.arguments);
      assert.equal(result.stop, incompleteStop(mode));
      assert.equal(result.webSearch?.calls[0].sources[0].title, '参考书');
      assert.equal(result.usage.cachedInput, 80);
    }
    assert.equal(requests, 1);
  });
}
function incompleteStop(mode: string) { return mode === 'incomplete' ? 'length' : 'tools'; }

function stream(parts: Uint8Array[], onCancel = () => {}) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < parts.length) controller.enqueue(parts[index++]);
      else controller.close();
    },
    cancel: onCancel
  });
}
async function collect(input: ReadableStream<Uint8Array>) {
  const result = [];
  for await (const event of sse(input)) result.push(event);
  return result;
}

for (const ending of ['\n', '\r', '\r\n']) {
  test(`SSE ${JSON.stringify(ending)}: every UTF-8 byte boundary preserves multiline data and BOM`, async () => {
    const bytes = Buffer.from('\ufeff: keepalive' + ending + 'data: {"text":' + ending +
      'data: "顾平安𠮷\\n死亡权\\\""}' + ending + ending + 'data: [DONE]' + ending + ending);
    for (let split = 0; split <= bytes.length; split++) {
      assert.deepEqual(await collect(stream([bytes.subarray(0, split), bytes.subarray(split)])),
        [{ text: '顾平安𠮷\n死亡权"' }], `split=${split}`);
    }
    assert.deepEqual(await collect(stream([...bytes].map(value => Uint8Array.of(value)))),
      [{ text: '顾平安𠮷\n死亡权"' }]);
  });
}

test('mixed SSE endings, comments and coalesced frames preserve output order', async () => {
  const expected = Array.from({ length: 120 }, (_, index) => ({ index, text: '死亡权\\n𠮷"' }));
  const endings = ['\n', '\r\n', '\r'];
  const bytes = Buffer.from(expected.map((value, i) =>
    ': ping' + endings[i % 3] + 'data: ' + JSON.stringify(value) + endings[(i + 1) % 3] + endings[(i + 1) % 3]
  ).join(''));
  const parts: Buffer[] = [];
  for (let at = 0; at < bytes.length;) {
    const size = 1 + (at * 7 % 101);
    parts.push(bytes.subarray(at, at + size));
    at += size;
  }
  assert.deepEqual(await collect(stream(parts)), expected);
});

test('EOF cannot dispatch an unfinished data event; a trailing comment is harmless', async () => {
  for (const suffix of ['data: {"ok":true}', 'data: {"ok":true}\r\n', 'data: {"ok":true}\r']) {
    await assert.rejects(collect(stream([Buffer.from(suffix)])),
      (error: unknown) => error instanceof RequestError && error.uncertain);
  }
  assert.deepEqual(await collect(stream([Buffer.from(': keepalive')])), []);
});

test('frame bounds cover uncompleted lines and reset after dispatch', () => {
  const framer = new SseFramer(10);
  assert.deepEqual([...framer.push('data: 1234\r')], []);
  assert.deepEqual([...framer.push('\n\r\ndata: 5678\n\n')], ['data: 1234', 'data: 5678']);
  assert.throws(() => [...framer.push('data: 12345')], SseFrameLimitError);
  const multiline = new SseFramer(10);
  assert.deepEqual([...multiline.push('data:\ndata')], []);
  assert.throws(() => [...multiline.push(':')], SseFrameLimitError);
});

test('oversized events cancel and release the reader with a protocol error', async () => {
  for (const terminated of [false, true]) {
    let cancelled = false;
    const input = stream([Buffer.from('data: ' + 'x'.repeat(8 * 1024 * 1024) + (terminated ? '\n\n' : ''))],
      () => { cancelled = true; });
    await assert.rejects(collect(input), (error: unknown) => {
      assert.ok(error instanceof RequestError && error.uncertain);
      assert.equal(error.diagnostic?.source, 'protocol');
      assert.equal(error.diagnostic?.code, 'RESPONSE_TOO_LARGE');
      return true;
    });
    assert.equal(cancelled, true);
    assert.equal(input.locked, false);
  }
});

test('total wire byte limit remains active across many small frames', async () => {
  let cancelled = false;
  const chunk = Buffer.from(':' + 'x'.repeat(1_000_000) + '\n\n');
  const input = stream(Array(33).fill(chunk), () => { cancelled = true; });
  await assert.rejects(collect(input), (error: unknown) =>
    error instanceof RequestError && error.diagnostic?.code === 'RESPONSE_TOO_LARGE');
  assert.equal(cancelled, true);
  assert.equal(input.locked, false);
});

test('consumer terminal boundary cancels without inspecting a trailing malformed event', async () => {
  let cancelled = false;
  const input = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(Buffer.from('data: {"complete":true}\n\ndata: bad json\n\n')); },
    cancel() { cancelled = true; }
  });
  for await (const event of sse(input)) {
    assert.deepEqual(event, { complete: true });
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(input.locked, false);
});

test('timing ignores lifecycle/empty/signature events and counts mixed content once', () => {
  let clock = 10;
  const timing = responseTiming('responses', () => clock);
  for (const event of [
    { type: 'response.created' }, { type: 'response.output_item.added', item: { type: 'reasoning' } },
    { type: 'response.output_text.delta', delta: '' }, { type: 'response.function_call_arguments.delta', delta: '' }
  ]) timing.observe(event);
  assert.deepEqual(timing.snapshot(), {});
  clock = 20; timing.observe({ type: 'response.reasoning_summary_text.delta', delta: 'private' });
  clock = 45; timing.observe({ type: 'response.function_call_arguments.delta', delta: '{"content":"private"}' });
  clock = 80; timing.observe({ type: 'response.output_text.delta', delta: '正文' });
  clock = 90; timing.observe({ type: 'response.completed' });
  assert.deepEqual(timing.snapshot(), {
    firstGenerationMs: 20, lastGenerationMs: 80, firstReasoningMs: 20, firstToolInputMs: 45,
    firstTextMs: 80, generationEvents: 3
  });
  assert.doesNotMatch(JSON.stringify(timing.snapshot()), /private|content|正文/);
  const chat = responseTiming('chat', () => 100);
  chat.observe({ choices: [{ delta: { content: 'text', reasoning_content: 'hidden',
    tool_calls: [{ function: { arguments: '{}' } }] } }] });
  assert.equal(chat.snapshot().generationEvents, 1);
  assert.equal(chat.snapshot().firstToolInputMs, 100);
  const anthropic = responseTiming('anthropic', () => 110);
  anthropic.observe({ type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'hidden' } });
  assert.deepEqual(anthropic.snapshot(), {});
  anthropic.observe({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } });
  assert.equal(anthropic.snapshot().firstReasoningMs, 110);
  const gemini = responseTiming('gemini', () => 120);
  gemini.observe({ candidates: [{ content: { parts: [{ thoughtSignature: 'hidden' }] } }] });
  assert.deepEqual(gemini.snapshot(), {});
  gemini.observe({ candidates: [{ content: { parts: [{ functionCall: { args: {} } }] } }] });
  assert.equal(gemini.snapshot().firstToolInputMs, 120);
});

for (const fail of [false, true]) test(`HTTP timing survives ${fail ? 'interruption' : 'completion'} without duplicate requests`, async () => {
  let requests = 0;
  const server = http.createServer(async (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const write = (value: unknown) => res.write('data: ' + JSON.stringify(value) + '\r\r');
    write({ type: 'response.created' });
    await new Promise(resolve => setTimeout(resolve, 35));
    write({ type: 'response.function_call_arguments.delta', delta: '{"title":"死亡权"}' });
    await new Promise(resolve => setTimeout(resolve, 35));
    if (fail) write({ type: 'error', error: { code: 'upstream_stream_truncated' } });
    else write({ type: 'response.completed', response: { status: 'completed', output: [
      { type: 'function_call', call_id: 'call', name: 'propose_changes', arguments: '{"title":"死亡权"}' }
    ], usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } } } });
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const profile = { ...profileSchema.parse({ id: 'timing', name: 'timing', protocol: 'responses',
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'mock',
      stream: true, contextLimit: 10000, inputLimit: 5000, outputLimit: 1000 }), apiKey: 'test' };
    const run = invokeModel(profile, 'system', [], [], new AbortController().signal);
    const check = (metadata: any) => {
      assert.ok(metadata.firstGenerationMs - metadata.firstEventMs >= 15);
      assert.equal(metadata.firstToolInputMs, metadata.firstGenerationMs);
      assert.equal(metadata.firstTextMs, undefined);
      assert.equal(metadata.generationEvents, 1);
      assert.ok(metadata.elapsedMs >= metadata.lastGenerationMs);
    };
    if (fail) await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof RequestError && error.uncertain);
      check(error.diagnostic);
      assert.equal(error.partial?.output[0].arguments, '{"title":"死亡权"}');
      return true;
    });
    else {
      const result = await run;
      check(result.provider);
      assert.equal(result.calls[0].arguments, '{"title":"死亡权"}');
      assert.equal(result.usage.cachedInput, 80);
    }
    assert.equal(requests, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
