import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { profileSchema, type Protocol, type SecretProfile } from '../src/shared/types';
import { invokeModel, requestBody, normalize, sse, RequestError } from '../src/core/provider';
const profile = (protocol: Protocol): SecretProfile => ({
  ...profileSchema.parse({
    id: 'test',
    name: 'mock',
    protocol,
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'm',
    stream: false
  }),
  apiKey: 'test-only-key'
});
const tool = {
  name: 'lookup',
  description: 'query',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
};
const responses: Record<string, any> = {
  chat: {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: 'opaque',
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"query":"中文"}' } }
          ]
        },
        finish_reason: 'tool_calls'
      }
    ],
    usage: { prompt_tokens: 3, completion_tokens: 5 }
  },
  responses: {
    status: 'completed',
    output: [
      { type: 'reasoning', encrypted_content: 'opaque-signature' },
      { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{"query":"中文"}' }
    ]
  },
  anthropic: {
    content: [
      { type: 'thinking', thinking: 'opaque', signature: 'signed' },
      { type: 'tool_use', id: 'c1', name: 'lookup', input: { query: '中文' } }
    ],
    stop_reason: 'tool_use'
  },
  gemini: {
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: { id: 'c1', name: 'lookup', args: { query: '中文' } },
              thoughtSignature: 'signed'
            }
          ]
        },
        finishReason: 'STOP'
      }
    ]
  }
};
for (const protocol of ['chat', 'responses', 'anthropic', 'gemini'] as const)
  test(`${protocol} 请求与工具续轮保留原生块`, async () => {
    const p = profile(protocol),
      result = normalize(p, responses[protocol]);
    assert.equal(result.calls[0].arguments, '{"query":"中文"}');
    const wire = requestBody(
      p,
      'system',
      [
        { role: 'user', content: '查询' },
        { role: 'assistant', content: result.text, calls: result.calls, native: result.native },
        { role: 'tool', content: '工具结果', callId: 'c1' }
      ],
      [tool]
    );
    assert.match(JSON.stringify(wire.body), /c1/);
    assert.match(JSON.stringify(wire.body), /工具结果/);
    if (protocol !== 'responses') assert.match(JSON.stringify(wire.body), /opaque|signed/);
    else assert.match(JSON.stringify(wire.body), /encrypted_content/);
    assert.ok(!JSON.stringify(wire.body).includes('test-only-key'));
    const received: any[] = [];
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      received.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responses[protocol]));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    p.baseUrl = `http://127.0.0.1:${(server.address() as any).port}/v1`;
    try {
      const r = await invokeModel(
        p,
        'system',
        [{ role: 'user', content: '请求' }],
        [tool],
        new AbortController().signal
      );
      assert.equal(r.stop, 'tools');
      assert.equal(received.length, 1);
    } finally {
      server.close();
    }
  });
test('SSE 在 UTF-8 和事件边界任意拆包仍正确', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"中文𠮷"}\r\n\r\ndata: [DONE]\r\n\r\n');
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let n = 0; n < bytes.length; n += 1) c.enqueue(bytes.slice(n, n + 1));
      c.close();
    }
  });
  const list = [];
  for await (const x of sse(stream)) list.push(x);
  assert.deepEqual(list, [{ text: '中文𠮷' }]);
});
test('没有结束标记不能当完成，远程明文端点拒绝', () => {
  assert.throws(
    () => normalize(profile('chat'), { choices: [{ message: { content: '部分' } }] }),
    RequestError
  );
  assert.throws(
    () => requestBody({ ...profile('chat'), baseUrl: 'http://example.com/v1' }, '', [], []),
    /HTTPS/
  );
});
test('中途断流保持结果未知，不能自动重试', async () => {
  let requests = 0;
  const server = http.createServer((_, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const p = {
    ...profile('chat'),
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    stream: true
  };
  try {
    await assert.rejects(
      invokeModel(p, '', [], [], new AbortController().signal),
      (e) => e instanceof RequestError && e.uncertain
    );
    assert.equal(requests, 1);
  } finally {
    server.close();
  }
});
