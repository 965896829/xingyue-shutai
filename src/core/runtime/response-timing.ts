import type { StreamTiming } from '../../shared/types';

/** Client-observed generation, not backend prefill/decode or tokenizer counts.
 * Keepalives, created/added markers and opaque signatures are not generated text.
 * No text, arguments or reasoning are retained in this diagnostic. */
export function responseTiming(protocol: string, elapsed: () => number) {
  const timing: StreamTiming = {};
  const nonempty = (value: unknown) => typeof value === 'string' && value.length > 0;
  return {
    observe(event: Record<string, any>) {
      let text = false, reasoning = false, tool = false;
      if (protocol === 'responses') {
        if (nonempty(event.delta)) {
          text = ['response.output_text.delta', 'response.refusal.delta'].includes(event.type);
          reasoning = /^response\.reasoning(?:_summary)?_text\.delta$/.test(event.type);
          tool = event.type === 'response.function_call_arguments.delta';
        }
      } else if (protocol === 'chat') {
        const delta = event.choices?.[0]?.delta;
        text = nonempty(delta?.content) || nonempty(delta?.refusal);
        reasoning = nonempty(delta?.reasoning_content);
        tool = delta?.tool_calls?.some((call: any) => nonempty(call.function?.arguments)) ?? false;
      } else if (protocol === 'anthropic') {
        if (event.type === 'content_block_delta') {
          text = event.delta?.type === 'text_delta' && nonempty(event.delta.text);
          reasoning = event.delta?.type === 'thinking_delta' && nonempty(event.delta.thinking);
          tool = event.delta?.type === 'input_json_delta' && nonempty(event.delta.partial_json);
        } else if (event.type === 'content_block_start') {
          text = event.content_block?.type === 'text' && nonempty(event.content_block.text);
          reasoning = event.content_block?.type === 'thinking' && nonempty(event.content_block.thinking);
        }
      } else if (protocol === 'gemini') {
        const parts = event.candidates?.[0]?.content?.parts ?? [];
        text = parts.some((part: any) => !part.thought && nonempty(part.text));
        reasoning = parts.some((part: any) => part.thought && nonempty(part.text));
        tool = parts.some((part: any) => part.functionCall?.args != null);
      }
      if (!text && !reasoning && !tool) return;
      const at = elapsed();
      timing.firstGenerationMs ??= at;
      timing.lastGenerationMs = at;
      if (text) timing.firstTextMs ??= at;
      if (reasoning) timing.firstReasoningMs ??= at;
      if (tool) timing.firstToolInputMs ??= at;
      timing.generationEvents = (timing.generationEvents ?? 0) + 1;
    },
    snapshot: (): StreamTiming => ({ ...timing })
  };
}
