import { fetch, Agent, ProxyAgent, WebSocket, type Dispatcher } from 'undici';
import { requireModelLimits } from '../shared/model-limits';
import { reasoningRequest, reasoningAllowsTemperature } from '../shared/reasoning';
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
export interface RequestDiagnostic {
  source: 'upstream' | 'transport' | 'protocol' | 'client';
  code: string;
  requestId?: string;
  elapsedMs?: number;
}
export class RequestError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean,
    readonly diagnostic?: RequestDiagnostic
  ) {
    super(message);
  }
}
const interruptedResponse = '模型连接中断，未收到完整结果。当前任务可以在连接恢复后继续。';
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
  const known: Record<string, string> = {
    upstream_http2_stream_error: '中转与上游模型的 HTTP/2 连接中断，未收到完整结果。请检查中转连接后继续当前任务。',
    upstream_stream_read_error: '中转读取上游模型响应时连接中断，未收到完整结果。请检查中转连接后继续当前任务。',
    upstream_stream_truncated: '中转返回的模型响应提前结束，未收到完整结果。当前任务可以在连接恢复后继续。',
    stream_timeout: '中转等待上游模型响应超时，未收到完整结果。请检查中转的等待时间设置后继续。',
    stream_read_error: '模型服务的响应流中断，未收到完整结果。当前任务可以在连接恢复后继续。'
  };
  const knownCode = typeof code === 'string' && Object.hasOwn(known, code) ? code : 'RESPONSE_FAILED';
  return new RequestError(
    known[knownCode] ?? '模型服务中断了响应，未收到完整结果。',
    true,
    { source: 'upstream', code: knownCode }
  );
}
function transportFailure(error: unknown): RequestDiagnostic {
  const known = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']);
  for (let value = error, depth = 0; value && typeof value === 'object' && depth < 5; depth++) {
    const cause = value as { code?: unknown; cause?: unknown };
    if (typeof cause.code === 'string' && known.has(cause.code)) return { source: 'transport', code: cause.code };
    value = cause.cause;
  }
  return { source: 'transport', code: 'NETWORK_INTERRUPTED' };
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
  const reasoning = reasoningRequest(p, tools.length);
  const temperature = p.temperature === null || !reasoningAllowsTemperature(p) ? {} : { temperature: p.temperature };
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
      ...reasoning,
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
      ...reasoning,
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
    refused = false,
    input: number | null = null,
    output: number | null = null;
  const webSearch: NativeWebSearchState = { calls: [], citations: [] };
  if (p.protocol === 'chat') {
    const c = data.choices?.[0];
    if (!c?.message || !c.finish_reason) throw new RequestError('响应没有明确结束标记', true);
    native = c.message;
    text = c.message.content ?? '';
    if (typeof c.message.refusal === 'string' && c.message.refusal.trim()) {
      refused = true;
      text += c.message.refusal;
    }
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
          if (part.type === 'refusal') {
            refused = true;
            text += part.refusal ?? '';
            continue;
          }
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
    filtered = refused || [
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
async function* responseWebSocketEvents(
  request: ReturnType<typeof requestBody>,
  dispatcher: Dispatcher,
  signal: AbortSignal,
  onSent: () => void
): AsyncGenerator<Obj> {
  signal.throwIfAborted();
  const url = new URL(request.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, { dispatcher, headers: request.headers });
  socket.binaryType = 'arraybuffer';
  const queue: Obj[] = [];
  let wake: (() => void) | undefined;
  let failure: unknown;
  let failed = false;
  let total = 0;
  let sent = false;
  let terminalReceived = false;
  const notify = () => { const resume = wake; wake = undefined; resume?.(); };
  const fail = (error: unknown) => { if (!failed) { failed = true; failure = error; } notify(); };
  const open = () => {
    try {
      if (signal.aborted) return fail(signal.reason);
      // WebSocket implicitly streams. Preserve the full native conversation so
      // a resumed task does not depend on a previous socket or response cache.
      const { stream: _stream, background: _background, ...body } = request.body;
      socket.send(JSON.stringify({ ...body, type: 'response.create' }));
      sent = true;
      onSent();
    } catch (error) { fail(error); }
  };
  const message = (event: { data: unknown }) => {
    if (failed || terminalReceived) return;
    try {
      const raw = typeof event.data === 'string' ? event.data
        : event.data instanceof ArrayBuffer ? Buffer.from(event.data).toString('utf8') : '';
      const bytes = Buffer.byteLength(raw);
      total += bytes;
      if (bytes > 8 * 1024 * 1024 || total > 32_000_000)
        throw new RequestError('模型响应超出大小上限，已停止接收。', sent, { source: 'protocol', code: 'RESPONSE_TOO_LARGE' });
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as Obj).type !== 'string')
        throw new SyntaxError('Invalid Responses WebSocket event');
      const item = value as Obj;
      terminalReceived = ['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(item.type);
      queue.push(item);
      notify();
    } catch (error) { fail(error); }
  };
  const error = () => fail(new RequestError(
    sent ? '模型 WebSocket 连接中断，已保留收到的内容。'
      : '无法建立模型 WebSocket 连接，请确认中转已启用 Responses WebSocket，或在模型设置中选择 HTTP。',
    sent, { source: 'transport', code: 'WEBSOCKET_CONNECTION_ERROR' }
  ));
  const close = () => {
    if (!terminalReceived) fail(new RequestError(interruptedResponse, sent, { source: 'transport', code: 'WEBSOCKET_CLOSED' }));
  };
  const abort = () => fail(signal.reason);
  socket.addEventListener('open', open);
  socket.addEventListener('message', message);
  socket.addEventListener('error', error);
  socket.addEventListener('close', close);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    while (true) {
      signal.throwIfAborted();
      while (queue.length) {
        signal.throwIfAborted();
        const item = queue.shift()!;
        yield item;
        if (['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(item.type)) return;
      }
      if (failed) throw failure;
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  } finally {
    signal.removeEventListener('abort', abort);
    socket.removeEventListener('open', open);
    socket.removeEventListener('message', message);
    socket.removeEventListener('error', error);
    socket.removeEventListener('close', close);
    socket.close();
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
    // One deadline applies to headers, quiet reasoning and streamed output. Undici's
    // independent 300s defaults must not silently override the author's setting.
    dispatcher = p.proxy ? new ProxyAgent({ uri: p.proxy, headersTimeout: 0, bodyTimeout: 0,
      ...(p.protocol === 'responses' && p.responsesTransport === 'websocket' ? { proxyTunnel: true } : {})
    }) : new Agent({ headersTimeout: 0, bodyTimeout: 0 }),
    timeout = AbortSignal.timeout(p.timeoutSeconds * 1000),
    requestSignal = AbortSignal.any([signal, timeout]);
  const startedAt = Date.now();
  let requestId: string | undefined;
  let sent = false;
  try {
    options.onActivity?.('waiting');
    let data: Obj = {};
    let events: AsyncIterable<Obj> | undefined;
    if (p.protocol === 'responses' && p.responsesTransport === 'websocket') {
      events = responseWebSocketEvents(req, dispatcher, requestSignal, () => { sent = true; });
    } else {
      sent = true;
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: requestSignal,
        redirect: 'error',
        dispatcher
      });
      const receivedId = res.headers.get('x-request-id') ?? res.headers.get('request-id');
      if (receivedId && /^[a-zA-Z0-9._:-]{1,160}$/.test(receivedId)) requestId = receivedId;
      if (!res.ok)
        throw new RequestError(
          httpFailure(res.status) + (options.webSearch && [400, 404, 422].includes(res.status)
            ? '本次启用了 OpenAI 原生 web_search，请确认所选模型和中转支持此工具；可关闭联网后继续普通对话。' : '') +
            (p.reasoningEffort != null && [400, 422].includes(res.status) ? `本次推理强度为 ${p.reasoningEffort}，请确认中转支持该档位；客户端不会自动降档或重发。` : ''),
          true,
          { source: 'upstream', code: `HTTP_${res.status}` }
        );
      if (!p.stream) {
        const raw = (await boundedBody(res.body, 20_000_000)).toString('utf8');
        data = JSON.parse(raw);
      } else if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream'))
        throw new RequestError('配置要求流式输出，但端点未返回 SSE；可关闭流式重新测试', true);
      else events = sse(res.body as unknown as ReadableStream<Uint8Array>);
    }
    if (events) {
      const msg: Obj = { role: 'assistant', content: '', tool_calls: [] };
      let terminal = false;
      const content: Obj[] = [];
      let usage: Obj = {};
      for await (const e of events) {
        if (e.error || e.type === 'error') throw streamFailure(e);
        if (p.protocol === 'chat') {
          const c = e.choices?.[0],
            d = c?.delta ?? {};
          if (d.content) {
            options.onActivity?.('responding');
            msg.content += d.content;
            onDelta(d.content);
          }
          if (typeof d.refusal === 'string') {
            options.onActivity?.('responding');
            msg.refusal = (msg.refusal ?? '') + d.refusal;
            onDelta(d.refusal);
          }
          if (d.reasoning_content) {
            options.onActivity?.('thinking');
            msg.reasoning_content = (msg.reasoning_content ?? '') + d.reasoning_content;
          }
          for (const t of d.tool_calls ?? []) {
            options.onActivity?.('tool_input');
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
          if (['response.output_text.delta', 'response.refusal.delta'].includes(e.type)) options.onActivity?.('responding');
          if (e.type?.startsWith('response.reasoning') || e.type === 'response.output_item.added' && e.item?.type === 'reasoning') options.onActivity?.('thinking');
          if (e.type === 'response.function_call_arguments.delta' || e.type === 'response.output_item.added' && e.item?.type === 'function_call') options.onActivity?.('tool_input');
          if (e.type === 'response.output_text.delta') onDelta(e.delta);
          if (e.type === 'response.refusal.delta') onDelta(e.delta);
          if (typeof e.type === 'string' && e.type.startsWith('response.web_search_call.')) {
            options.onActivity?.('searching');
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
              options.onActivity?.('responding');
              b.text = (b.text ?? '') + d.text;
              onDelta(d.text);
            }
            if (d.type === 'input_json_delta') { options.onActivity?.('tool_input'); b._json = (b._json ?? '') + d.partial_json; }
            if (d.type === 'thinking_delta') { options.onActivity?.('thinking'); b.thinking = (b.thinking ?? '') + d.thinking; }
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
            if (part.thought) options.onActivity?.('thinking');
            else if (part.functionCall) options.onActivity?.('tool_input');
            else if (part.text) options.onActivity?.('responding');
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
    if (e instanceof RequestError && !requestSignal.aborted)
      throw new RequestError(e.message, e.uncertain, { ...(e.diagnostic ?? { source: 'protocol', code: 'INCOMPLETE_RESPONSE' }), requestId, elapsedMs: Date.now() - startedAt });
    const cancelled = requestSignal.aborted && requestSignal.reason === signal.reason;
    const diagnostic: RequestDiagnostic = cancelled ? { source: 'client', code: 'CANCELLED' }
      : timeout.aborted ? { source: 'client', code: 'REQUEST_TIMEOUT' }
      : e instanceof SyntaxError ? { source: 'protocol', code: 'INVALID_RESPONSE' } : transportFailure(e);
    throw new RequestError(
      cancelled
        ? '已停止；服务端是否继续计费未知，恢复前需明确选择'
        : timeout.aborted
          ? `等待模型超过 ${p.timeoutSeconds} 秒，当前任务已保留，但尚未收到完整结果。可在模型设置中增加等待时间后继续；服务端结果与费用尚不确定，请求不会自动重发。`
          : e instanceof SyntaxError
          ? invalidResponse
          : diagnostic.source === 'transport'
            ? `客户端与模型接口的连接中断（${diagnostic.code}），未收到完整结果。请检查本机中转或网络后继续当前任务。`
            : interruptedResponse,
      sent,
      { ...diagnostic, requestId, elapsedMs: Date.now() - startedAt }
    );
  } finally {
    // Do not wait for an unread failed response or a broken connection to drain.
    await dispatcher.destroy();
  }
}
