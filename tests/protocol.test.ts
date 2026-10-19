import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { profileSchema, type Protocol, type SecretProfile } from '../src/shared/types';
import { invokeModel, requestBody, normalize, sse, RequestError } from '../src/core/provider';
import { renderNativeCitations, nativeServerLimit } from '../src/shared/web-search';
import { nativeResponse, nativeSource, nativeText } from './fixtures/native-search';
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
test('Responses 原生搜索按请求启用，与自定义工具共存且关闭后不发送', () => {
  const p = profile('responses');
  const enabled = requestBody(p, 'system', [], [tool], { webSearch: { maxCalls: 2 } }).body;
  assert.deepEqual(enabled.tools.map((t: any) => t.type), ['function', 'web_search']);
  assert.equal(enabled.max_tool_calls, 2);
  assert.ok(enabled.include.includes('web_search_call.action.sources'));
  assert.equal(enabled.tools[1].external_web_access, true);
  assert.equal(requestBody(p, '', [], [], { webSearch: { maxCalls: 1, serverLimit: false, required: true } }).body.max_tool_calls, undefined);
  assert.equal(requestBody(p, '', [], [], { webSearch: { maxCalls: 1, required: true } }).body.tool_choice, 'required');
  assert.equal(nativeServerLimit({ baseUrl: 'https://api.openai.com/v1' }, { nativeToolLimit: 'auto' }), true);
  assert.equal(nativeServerLimit({ baseUrl: 'http://127.0.0.1:8080/v1' }, { nativeToolLimit: 'auto' }), false);
  assert.equal(requestBody(p, 'system', [], [tool]).body.tools.some((t: any) => t.type === 'web_search'), false);
  assert.throws(() => requestBody(profile('chat'), '', [], [], { webSearch: { maxCalls: 1 } }), /Responses/);
  assert.throws(() => requestBody({ ...p, tools: false }, '', [], [], { webSearch: { maxCalls: 1 } }), /工具调用/);
});
test('原生搜索来源、引用和不透明状态完整保留，额外工具费用不伪记为已知', () => {
  const p = { ...profile('responses'), inputPrice: 1, outputPrice: 2 };
  const result = normalize(p, nativeResponse);
  assert.equal(result.text, nativeText);
  assert.equal(result.calls.length, 0);
  assert.equal(result.webSearch!.calls[0].action!.queries![0], 'OpenAI web_search official documentation');
  assert.equal(result.webSearch!.citations[0].url, nativeSource.url);
  assert.equal(result.usage.cost, null);
  const next = requestBody(p, 'system', [{ role: 'assistant', content: result.text, native: result.native }, { role: 'user', content: '继续' }], []);
  assert.deepEqual(next.body.input.slice(0, 3), nativeResponse.output);
  assert.match(renderNativeCitations(result.text, result.webSearch!.citations), /𠮷：已查阅官方文档。 \[来源1\]\(<https:/);
  assert.equal(renderNativeCitations('回答', [{ url: 'javascript:alert(1)', title: '伪来源' }]), '回答');
  assert.equal(renderNativeCitations('回答', [{ url: 'http://127.0.0.1/private', title: '内网' }]), '回答');
});
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
