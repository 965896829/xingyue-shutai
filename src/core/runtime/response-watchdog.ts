/** A streaming response may legitimately outlive the configured quiet interval.
 * Only model progress renews it; HTTP/SSE keepalives do not. */
export function responseWatchdog(milliseconds: number, streaming: boolean) {
  const controller = new AbortController();
  let lastProgressAt = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException('Model response timed out', 'TimeoutError')), milliseconds);
    timer.unref();
  };
  arm();
  const markers = new Set<string>();
  return {
    signal: controller.signal,
    mode: streaming ? 'idle' as const : 'total' as const,
    idleMs: () => Date.now() - lastProgressAt,
    progress(marker?: string) {
      if (!streaming || controller.signal.aborted || marker && markers.has(marker)) return;
      if (marker) markers.add(marker);
      lastProgressAt = Date.now();
      arm();
    },
    dispose() { clearTimeout(timer); }
  };
}

/** A marker is useful once; nonempty generated deltas are always new progress. */
export function responseProgress(protocol: string, event: Record<string, any>): string | true | undefined {
  const nonempty = (value: unknown) => typeof value === 'string' && value.length > 0;
  if (protocol === 'responses') {
    if (/^response\.(?:output_text|refusal|function_call_arguments|reasoning(?:_summary)?_text)\.delta$/.test(event.type) && nonempty(event.delta)) return true;
    if (event.type === 'response.output_item.added' && ['reasoning', 'function_call', 'message', 'web_search_call'].includes(event.item?.type))
      return `${event.type}:${event.item.id ?? event.output_index ?? event.item.type}`;
    if (/^response\.web_search_call\.(?:in_progress|searching|completed)$/.test(event.type)) return `${event.type}:${event.item_id ?? ''}`;
  } else if (protocol === 'chat') {
    const delta = event.choices?.[0]?.delta;
    if (delta && ([delta.content, delta.refusal, delta.reasoning_content].some(nonempty) ||
      delta.tool_calls?.some((t: any) => nonempty(t.function?.arguments) || nonempty(t.function?.name)))) return true;
  } else if (protocol === 'anthropic') {
    if (event.type === 'content_block_delta' && ['text', 'partial_json', 'thinking', 'signature'].some(key => nonempty(event.delta?.[key]))) return true;
    if (event.type === 'content_block_start') return `${event.type}:${event.index}`;
  } else if (protocol === 'gemini') {
    if (event.candidates?.[0]?.content?.parts?.some((part: any) => nonempty(part.text) || part.functionCall)) return true;
  }
}
