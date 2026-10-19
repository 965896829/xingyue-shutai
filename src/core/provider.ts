import { fetch, ProxyAgent } from 'undici';
import { requireModelLimits } from '../shared/model-limits';
import { webSourceUrl, type ModelRequestOptions, type NativeWebCitation, type NativeWebSearchCall, type NativeWebSearchState } from '../shared/web-search';
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
const interruptedResponse = '模型连接中断，已保留收到的内容。';
const invalidResponse = '模型返回的数据不完整或格式异常，已保留收到的内容。';
function httpFailure(status: number) {
  const reason = status === 401 || status === 403
    ? '模型服务拒绝访问，请检查 API Key 和账号权限。'
    : status === 429
      ? '模型服务限流或额度不足，请查看服务商用量后再试。'
      : status === 408 || status === 504
        ? '模型服务或中转等待超时，请稍后手动重试。'
        : status >= 500
          ? '模型服务或中转暂时异常，请稍后手动重试。'
          : status === 404
            ? '模型或请求地址不存在，请检查模型名称、端点和协议。'
            : '模型服务未接受请求，请检查模型设置。';
  return `模型返回 HTTP ${status}。${reason}已保留当前进度，请求不会自动重发。`;
}
function streamFailure(event: Obj) {
  const code = event.code ?? event.error?.code ?? event.response?.error?.code;
  return new RequestError(
    [
      'upstream_http2_stream_error',
      'upstream_stream_read_error',
      'upstream_stream_truncated',
      'stream_timeout',
      'stream_read_error'
    ].includes(code)
      ? interruptedResponse
      : '模型服务中断了响应，已保留收到的内容。',
    true
  );
}
function streamEvent(block: string): Obj | undefined {
  const lines = block.split('\n');
  const dataLines = (part: string[]) =>
    part
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
  const data = dataLines(lines);
  if (!data || data === '[DONE]') return;
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid event');
    return parsed;
  } catch {
    // An interrupted gateway can append its error to an unfinished SSE event.
    // Only recognize a complete error envelope; never repair or execute partial output.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!/^event: ?(?:error|response\.failed)\s*$/.test(lines[i])) continue;
      let failure: Obj;
      try {
        failure = JSON.parse(dataLines(lines.slice(i + 1)));
      } catch {
        continue;
      }
      if (failure && ['error', 'response.failed'].includes(failure.type)) throw streamFailure(failure);
    }
    throw new RequestError(invalidResponse, true);
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
  tools: ToolDefinition[],
  options: ModelRequestOptions = {}
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
    if (options.webSearch) {
      if (!p.tools || p.capabilities.tools === 'failed') throw new Error('请先启用模型工具调用，再使用原生联网搜索');
      if (!Number.isInteger(options.webSearch.maxCalls) || options.webSearch.maxCalls < 1)
        throw new Error('本轮原生搜索次数已达上限');
      body.tools = [...(body.tools ?? []), { type: 'web_search', search_context_size: 'medium', external_web_access: true }];
      if (options.webSearch.serverLimit !== false) body.max_tool_calls = options.webSearch.maxCalls;
      if (options.webSearch.required) body.tool_choice = 'required';
      body.include.push('web_search_call.action.sources');
    }
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
  if (options.webSearch && p.protocol !== 'responses') throw new Error('OpenAI 原生搜索需要 Responses 协议模型');
  return { url, body, headers };
}
function nativeCitation(annotation: Obj, offset = 0): NativeWebCitation | undefined {
  const url = annotation.type === 'url_citation' ? webSourceUrl(annotation.url) : undefined;
  if (!url) return;
  return { url, title: String(annotation.title ?? url).slice(0, 500),
    ...(Number.isInteger(annotation.start_index) ? { startIndex: annotation.start_index + offset } : {}),
    ...(Number.isInteger(annotation.end_index) ? { endIndex: annotation.end_index + offset } : {}) };
}
function nativeSearchCall(item: Obj): NativeWebSearchCall {
  const action = item.action;
  return { id: String(item.id), status: ['completed', 'failed', 'searching'].includes(item.status) ? item.status : 'in_progress',
    ...(action ? { action: { type: String(action.type),
      ...(action.queries || action.query ? { queries: (action.queries ?? [action.query]).map(String).slice(0, 20) } : {}),
      ...(webSourceUrl(action.url) ? { url: webSourceUrl(action.url) } : {}),
      ...(action.pattern ? { pattern: String(action.pattern).slice(0, 1000) } : {}) } } : {}),
    sources: (action?.sources ?? []).flatMap((source: Obj) => {
      const url = webSourceUrl(source.url);
      return url ? [{ url, title: String(source.title ?? url).slice(0, 500) }] : [];
    }) };
}
export function normalize(p: SecretProfile, data: Obj): ModelResult {
  let text = '',
    calls: ToolCall[] = [],
    native: unknown,
    reason = '',
    input: number | null = null,
    output: number | null = null;
  const webSearch: NativeWebSearchState = { calls: [], citations: [] };
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
        for (const part of item.content ?? []) {
          if (part.type !== 'output_text') continue;
          const offset = Array.from(text).length;
          for (const annotation of part.annotations ?? []) {
            const citation = nativeCitation(annotation, offset);
            if (citation) webSearch.citations.push(citation);
          }
          text += part.text ?? '';
        }
      if (item.type === 'web_search_call') webSearch.calls.push(nativeSearchCall(item));
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
  if (webSearch.calls.length) usage.cost = null;
  return {
    text,
    calls,
    native,
    ...(webSearch.calls.length || webSearch.citations.length ? { webSearch } : {}),
    usage,
    stop: length ? 'length' : filtered ? 'filtered' : calls.length ? 'tools' : 'complete'
  };
}
export async function* sse(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    total = 0,
    ended = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      ended = done;
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
        if (block.length > 8 * 1024 * 1024) throw new RequestError('模型响应事件过大，已停止接收。', true);
        const event = streamEvent(block);
        if (event) yield event;
      }
      if (buffer.length > 8 * 1024 * 1024) throw new Error('流事件过大');
      if (done) {
        if (buffer.split('\n').some((line) => line.startsWith('data:')))
          throw new RequestError(interruptedResponse, true);
        break;
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function invokeModel(
  p: SecretProfile,
  system: string,
  messages: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  onDelta: (s: string) => void = () => {},
  options: ModelRequestOptions = {}
): Promise<ModelResult> {
  const req = requestBody(p, system, messages, p.tools ? tools : [], options),
    dispatcher = p.proxy ? new ProxyAgent(p.proxy) : undefined,
    timeout = AbortSignal.timeout(p.timeoutSeconds * 1000),
    requestSignal = AbortSignal.any([signal, timeout]);
  let sent = false;
  try {
    sent = true;
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: requestSignal,
      redirect: 'error',
      dispatcher
    });
    if (!res.ok)
      throw new RequestError(
        httpFailure(res.status) + (options.webSearch && [400, 404, 422].includes(res.status)
          ? '本次启用了 OpenAI 原生 web_search，请确认所选模型和中转支持此工具；可关闭联网后继续普通对话。' : ''),
        true
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
        if (e.error || e.type === 'error') throw streamFailure(e);
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
          if (typeof e.type === 'string' && e.type.startsWith('response.web_search_call.')) {
            const status = e.type.split('.').at(-1);
            if (['in_progress', 'searching', 'completed'].includes(status!))
              options.onWebSearch?.({ id: String(e.item_id), status: status as NativeWebSearchCall['status'], sources: [] });
          }
          if (e.type === 'response.output_item.done' && e.item?.type === 'web_search_call')
            options.onWebSearch?.(nativeSearchCall(e.item));
          if (e.type === 'response.output_text.annotation.added') {
            const citation = nativeCitation(e.annotation ?? {});
            if (citation) options.onWebCitation?.(citation);
          }
          if (['response.completed', 'response.incomplete'].includes(e.type)) {
            data = e.response;
            terminal = true;
          }
          if (e.type === 'response.failed') throw streamFailure(e);
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
      if (!terminal) throw new RequestError(interruptedResponse, true);
    }
    const result = normalize(p, data);
    for (const call of result.webSearch?.calls ?? []) options.onWebSearch?.(call);
    for (const citation of result.webSearch?.citations ?? []) options.onWebCitation?.(citation);
    return result;
  } catch (e) {
    if (e instanceof RequestError && !requestSignal.aborted) throw e;
    throw new RequestError(
      requestSignal.aborted && requestSignal.reason === signal.reason
        ? '已停止；服务端是否继续计费未知，恢复前需明确选择'
        : timeout.aborted
          ? `等待模型超过 ${p.timeoutSeconds} 秒，已保留收到的内容。可在模型设置中增加等待时间后手动继续；服务端结果与费用尚不确定，请求不会自动重发。`
          : e instanceof SyntaxError
          ? invalidResponse
          : interruptedResponse,
      sent
    );
  } finally {
    await dispatcher?.close();
  }
}
