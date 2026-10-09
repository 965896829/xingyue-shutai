import { fetch, ProxyAgent } from 'undici';
import { requireModelLimits } from '../shared/model-limits';
import type {
  SecretProfile,
  ModelMessage,
  ModelResult,
  ToolDefinition,
  ToolCall,
  Usage
} from '../shared/types';

type Obj = Record<string, any>;
export async function boundedBody(body: { getReader(): any } | null, maxBytes: number): Promise<Buffer> {
  if (!body) throw new Error('响应没有内容');
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('响应超出大小上限');
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}
export class RequestError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean
  ) {
    super(message);
  }
}
export function endpoint(p: Pick<SecretProfile, 'baseUrl'>, operation: string) {
  const base = p.baseUrl.replace(/\/+$/, '');
  const u = new URL(base);
  if (u.username || u.password || u.search || u.hash) throw new Error('端点不能含账号、查询参数或片段');
  if (
    u.protocol !== 'https:' &&
    !(['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && u.protocol === 'http:')
  )
    throw new Error('远程端点必须使用 HTTPS');
  return `${base}/${operation}`;
}
export function requestBody(
  p: SecretProfile,
  system: string,
  messages: ModelMessage[],
  tools: ToolDefinition[]
): { url: string; body: Obj; headers: Record<string, string> } {
  requireModelLimits(p);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...p.headers };
  for (const key of Object.keys(headers))
    if (/authorization|api[-_]key|host|cookie/i.test(key)) delete headers[key];
  let body: Obj, url: string;
  const temperature = p.temperature === null ? {} : { temperature: p.temperature };
  if (p.protocol === 'chat') {
    headers.Authorization = `Bearer ${p.apiKey}`;
    url = endpoint(p, 'chat/completions');
    body = {
      model: p.model,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) =>
          m.role === 'assistant' && m.native
            ? m.native
            : m.role === 'tool'
              ? { role: 'tool', tool_call_id: m.callId, content: m.content }
              : { role: m.role, content: m.content }
        )
      ],
      max_completion_tokens: p.outputLimit,
      ...temperature,
      stream: p.stream
    };
    if (p.stream) body.stream_options = { include_usage: true };
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: t }));
  } else if (p.protocol === 'responses') {
    headers.Authorization = `Bearer ${p.apiKey}`;
    url = endpoint(p, 'responses');
    body = {
      model: p.model,
      instructions: system,
      input: messages.flatMap((m) =>
        m.role === 'assistant' && Array.isArray(m.native)
          ? m.native
          : m.role === 'tool'
            ? [{ type: 'function_call_output', call_id: m.callId, output: m.content }]
            : [{ role: m.role, content: m.content }]
      ),
      max_output_tokens: p.outputLimit,
      store: false,
      include: ['reasoning.encrypted_content'],
      ...temperature,
      stream: p.stream
    };
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', ...t, strict: false }));
  } else if (p.protocol === 'anthropic') {
    headers['x-api-key'] = p.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    url = endpoint(p, 'messages');
    const wire: Obj[] = [];
    for (const m of messages) {
      const role = m.role === 'tool' ? 'user' : m.role;
      const content =
        m.role === 'tool'
          ? [{ type: 'tool_result', tool_use_id: m.callId, content: m.content }]
          : (m.native ?? [{ type: 'text', text: m.content }]);
      if (wire.at(-1)?.role === role) wire.at(-1)!.content.push(...(content as any[]));
      else wire.push({ role, content: structuredClone(content) });
    }
    body = {
      model: p.model,
      system,
      messages: wire,
      max_tokens: p.outputLimit,
      ...temperature,
      stream: p.stream
    };
    if (tools.length)
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
  } else if (p.protocol === 'gemini') {
    headers['x-goog-api-key'] = p.apiKey;
    url = endpoint(
      p,
      `models/${encodeURIComponent(p.model.replace(/^models\//, ''))}:${p.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
    );
    const contents: Obj[] = [];
    for (const m of messages) {
      let parts: any[];
      if (m.role === 'tool') {
        const call = messages.flatMap((x) => x.calls ?? []).find((x) => x.id === m.callId);
        parts = [
          {
            functionResponse: { name: call?.name ?? 'unknown', id: m.callId, response: { result: m.content } }
          }
        ];
      } else parts = (m.native as any[]) ?? [{ text: m.content }];
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (contents.at(-1)?.role === role) contents.at(-1)!.parts.push(...structuredClone(parts));
      else contents.push({ role, parts: structuredClone(parts) });
    }
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: p.outputLimit, ...temperature }
    };
    if (tools.length)
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.parameters
          }))
        }
      ];
  } else throw new Error('图像配置不能用于文字执行器');
  return { url, body, headers };
}
export function normalize(p: SecretProfile, data: Obj): ModelResult {
  let text = '',
    calls: ToolCall[] = [],
    native: unknown,
    reason = '',
    input: number | null = null,
    output: number | null = null;
  if (p.protocol === 'chat') {
    const c = data.choices?.[0];
    if (!c?.message || !c.finish_reason) throw new RequestError('响应没有明确结束标记', true);
    native = c.message;
    text = c.message.content ?? '';
    reason = c.finish_reason;
    calls = (c.message.tool_calls ?? []).map((t: Obj) => ({
      id: t.id,
      name: t.function.name,
      arguments: t.function.arguments
    }));
    input = data.usage?.prompt_tokens ?? null;
    output = data.usage?.completion_tokens ?? null;
  } else if (p.protocol === 'responses') {
    if (!['completed', 'incomplete'].includes(data.status))
      throw new RequestError('Responses 请求未完成', true);
    native = data.output ?? [];
    for (const item of data.output ?? []) {
      if (item.type === 'message')
        text += (item.content ?? [])
          .filter((v: Obj) => v.type === 'output_text')
          .map((v: Obj) => v.text)
          .join('');
      if (item.type === 'function_call')
        calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
    }
    reason =
      data.status === 'incomplete'
        ? data.incomplete_details?.reason === 'max_output_tokens'
          ? 'length'
          : 'filtered'
        : calls.length
          ? 'tools'
          : 'complete';
    input = data.usage?.input_tokens ?? null;
    output = data.usage?.output_tokens ?? null;
  } else if (p.protocol === 'anthropic') {
    if (!data.stop_reason) throw new RequestError('Messages 响应未明确结束', true);
    native = data.content ?? [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use')
        calls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
    }
    reason = data.stop_reason;
    input = data.usage?.input_tokens ?? null;
    output = data.usage?.output_tokens ?? null;
  } else {
    const c = data.candidates?.[0];
    if (!c?.finishReason) throw new RequestError('Gemini 响应未明确结束', true);
    native = c.content?.parts ?? [];
    for (const part of c.content?.parts ?? []) {
      if (part.text && !part.thought) text += part.text;
      if (part.functionCall)
        calls.push({
          id: part.functionCall.id ?? `g-${calls.length}-${data.responseId ?? Date.now()}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {})
        });
    }
    reason = c.finishReason;
    input = data.usageMetadata?.promptTokenCount ?? null;
    output = data.usageMetadata?.candidatesTokenCount ?? null;
  }
  const length = ['length', 'max_tokens', 'MAX_TOKENS'].includes(reason),
    filtered = [
      'content_filter',
      'filtered',
      'SAFETY',
      'RECITATION',
      'refusal',
      'MALFORMED_FUNCTION_CALL'
    ].includes(reason);
  if (
    !length &&
    !filtered &&
    !['stop', 'tool_calls', 'complete', 'tools', 'end_turn', 'stop_sequence', 'tool_use', 'STOP'].includes(
      reason
    )
  )
    throw new RequestError(`服务端返回不能视为完成的停止原因：${reason}`, true);
  const usage: Usage = {
    input,
    output,
    cost:
      input !== null && output !== null && p.inputPrice !== null && p.outputPrice !== null
        ? (input * p.inputPrice + output * p.outputPrice) / 1e6
        : null,
    currency: p.currency
  };
  return {
    text,
    calls,
    native,
    usage,
    stop: length ? 'length' : filtered ? 'filtered' : calls.length ? 'tools' : 'complete'
  };
}
export async function* sse(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      total += value?.byteLength ?? 0;
      if (total > 32_000_000) {
        await reader.cancel();
        throw new Error('流式响应超出大小上限');
      }
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
      let n;
      while ((n = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, n);
        buffer = buffer.slice(n + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
      if (buffer.length > 8 * 1024 * 1024) throw new Error('流事件过大');
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
export async function invokeModel(
  p: SecretProfile,
  system: string,
  messages: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  onDelta: (s: string) => void = () => {}
): Promise<ModelResult> {
  const req = requestBody(p, system, messages, p.tools ? tools : []),
    dispatcher = p.proxy ? new ProxyAgent(p.proxy) : undefined;
  let sent = false;
  try {
    sent = true;
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(p.timeoutSeconds * 1000)]),
      redirect: 'error',
      dispatcher
    });
    if (!res.ok)
      throw new RequestError(
        `模型返回 HTTP ${res.status}。请检查端点、模型、额度和协议；请求不会自动重发。`,
        res.status >= 500
      );
    let data: Obj = {};
    if (!p.stream) {
      const raw = (await boundedBody(res.body, 20_000_000)).toString('utf8');
      data = JSON.parse(raw);
    } else if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream'))
      throw new RequestError('配置要求流式输出，但端点未返回 SSE；可关闭流式重新测试', true);
    else {
      const msg: Obj = { role: 'assistant', content: '', tool_calls: [] };
      let terminal = false;
      const content: Obj[] = [];
      let usage: Obj = {};
      for await (const e of sse(res.body as unknown as ReadableStream<Uint8Array>)) {
        if (e.error || e.type === 'error')
          throw new RequestError('流式服务返回错误，已保留接收到的内容', true);
        if (p.protocol === 'chat') {
          const c = e.choices?.[0],
            d = c?.delta ?? {};
          if (d.content) {
            msg.content += d.content;
            onDelta(d.content);
          }
          if (d.reasoning_content)
            msg.reasoning_content = (msg.reasoning_content ?? '') + d.reasoning_content;
          for (const t of d.tool_calls ?? []) {
            const v = (msg.tool_calls[t.index] ??= {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' }
            });
            if (t.id) v.id = t.id;
            if (t.function?.name) v.function.name += t.function.name;
            if (t.function?.arguments) v.function.arguments += t.function.arguments;
          }
          if (c?.finish_reason) {
            data.choices = [{ message: msg, finish_reason: c.finish_reason }];
            terminal = true;
          }
          if (e.usage) data.usage = e.usage;
        } else if (p.protocol === 'responses') {
          if (e.type === 'response.output_text.delta') onDelta(e.delta);
          if (['response.completed', 'response.incomplete'].includes(e.type)) {
            data = e.response;
            terminal = true;
          }
          if (e.type === 'response.failed') throw new RequestError('Responses 流式执行失败', true);
        } else if (p.protocol === 'anthropic') {
          if (e.type === 'message_start') usage = { ...e.message.usage };
          if (e.type === 'content_block_start') content[e.index] = { ...e.content_block };
          if (e.type === 'content_block_delta') {
            const b = content[e.index],
              d = e.delta;
            if (d.type === 'text_delta') {
              b.text = (b.text ?? '') + d.text;
              onDelta(d.text);
            }
            if (d.type === 'input_json_delta') b._json = (b._json ?? '') + d.partial_json;
            if (d.type === 'thinking_delta') b.thinking = (b.thinking ?? '') + d.thinking;
            if (d.type === 'signature_delta') b.signature = (b.signature ?? '') + d.signature;
          }
          if (e.type === 'message_delta') {
            data.stop_reason = e.delta.stop_reason;
            usage = { ...usage, ...e.usage };
          }
          if (e.type === 'message_stop') {
            for (const b of content)
              if (b._json) {
                b.input = JSON.parse(b._json);
                delete b._json;
              }
            data.content = content;
            data.usage = usage;
            terminal = true;
          }
        } else {
          const c = e.candidates?.[0];
          for (const part of c?.content?.parts ?? []) {
            content.push(part);
            if (part.text && !part.thought) onDelta(part.text);
          }
          if (c?.finishReason) {
            data.candidates = [{ ...c, content: { parts: content } }];
            terminal = true;
          }
          if (e.usageMetadata) data.usageMetadata = e.usageMetadata;
          if (e.responseId) data.responseId = e.responseId;
        }
      }
      if (!terminal) throw new RequestError('连接中断，未收到完成标记；费用和服务端状态未知', true);
    }
    return normalize(p, data);
  } catch (e) {
    if (e instanceof RequestError) throw e;
    throw new RequestError(
      signal.aborted
        ? '已停止；服务端是否继续计费未知，恢复前需明确选择'
        : `请求异常：${(e as Error).message}`,
      sent
    );
  } finally {
    await dispatcher?.close();
  }
}
