import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { profileSchema, type Protocol } from '../src/shared/types';
import { invokeModel } from '../src/core/provider';
const streams: Record<string, unknown[]> = {
  chat: [
    { choices: [{ delta: { reasoning_content: 'opaque' } }] },
    { choices: [{ delta: { content: '文字' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'lookup', arguments: '{"query":"中文"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 7, completion_tokens: 3 } }
  ],
  responses: [
    { type: 'response.output_item.added', item: { type: 'reasoning' } },
    { type: 'response.reasoning_summary_text.delta', delta: 'private-reasoning' },
    { type: 'response.output_text.delta', delta: '文字' },
    { type: 'response.function_call_arguments.delta', delta: '{"query":"中文"}' },
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [
          { type: 'reasoning', encrypted_content: 'opaque' },
          { type: 'function_call', call_id: 'c', name: 'lookup', arguments: '{"query":"中文"}' }
        ],
        usage: { input_tokens: 7, output_tokens: 3 }
      }
    }
  ],
  anthropic: [
    { type: 'message_start', message: { usage: { input_tokens: 7 } } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' }
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'opaque' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'c', name: 'lookup', input: {} }
    },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"中文"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' }
  ],
  gemini: [
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { id: 'c', name: 'lookup', args: { query: '中文' } },
                thoughtSignature: 'signed'
              }
            ]
          }
        }
      ]
    },
    {
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 }
    }
  ]
};
for (const [protocol, events] of Object.entries(streams))
  test(`${protocol} SSE 工具参数、签名与结束事件`, async () => {
    const server = http.createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const p = {
      ...profileSchema.parse({
        id: 't',
        name: 't',
        protocol: protocol as Protocol,
        model: 'm',
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
        stream: true
      }),
      apiKey: 'local-fixture'
    };
    try {
      const phases: string[] = [], visible: string[] = [];
      const result = await invokeModel(
        p,
        'system',
        [{ role: 'user', content: 'query' }],
        [],
        new AbortController().signal,
        text => visible.push(text),
        { onActivity: phase => phases.push(phase) }
      );
      assert.equal(phases[0], 'waiting');
      assert.ok(phases.includes('tool_input'));
      if (protocol !== 'gemini') assert.ok(phases.includes('thinking'));
      assert.doesNotMatch(visible.join(''), /opaque|private-reasoning|signed/);
      assert.equal(result.stop, 'tools');
      assert.equal(result.calls[0].arguments, '{"query":"中文"}');
      assert.equal(result.usage.input, 7);
      assert.equal(result.usage.output, 3);
      assert.match(JSON.stringify(result.native), /opaque|signed/);
    } finally {
      server.close();
    }
  });
