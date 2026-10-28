import { runAgentLoop, type AgentContext, type AgentEvent, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import type { AssistantMessage, Message, Model } from '@earendil-works/pi-ai';
import type { ModelMessage, ModelResult, SecretProfile, ToolCall, ToolDefinition } from '../../shared/types';
import { ApplicationError } from '../../shared/errors';

export const piExecutorVersion = '1.4.0-client.1';
export interface TaskTurn {
  profile: SecretProfile;
  system: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  request(delta: (text: string) => void): Promise<ModelResult>;
  received(result: ModelResult): Promise<boolean>;
  execute(call: ToolCall): Promise<{ proceed: boolean; content: string }>;
  finish(result: ModelResult): Promise<boolean>;
}
export interface TaskLoop {
  executorId?: string;
  signal: AbortSignal;
  next(): Promise<TaskTurn | undefined>;
  event?(event: AgentEvent): Promise<void> | void;
}
function modelView(profile: SecretProfile): Model<'client-gateway'> {
  return { id: profile.model, name: profile.name, api: 'client-gateway', provider: profile.protocol,
    baseUrl: '', reasoning: false, input: ['text'], contextWindow: profile.contextLimit, maxTokens: profile.outputLimit,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}
function messageView(profile: SecretProfile, result?: ModelResult, slots = false): AssistantMessage {
  return { role: 'assistant', api: 'client-gateway', provider: profile.protocol, model: profile.model, timestamp: Date.now(),
    content: result ? [ ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
      ...result.calls.map((call, index) => ({ type: 'toolCall' as const, id: slots ? String(index) : call.id, name: call.name, arguments: {} })) ] : [],
    usage: { input: result?.usage.input ?? Number.NaN, output: result?.usage.output ?? Number.NaN,
      totalTokens: result?.usage.input != null && result.usage.output != null ? result.usage.input + result.usage.output : Number.NaN,
      cacheRead: result?.usage.cachedInput ?? Number.NaN, cacheWrite: Number.NaN,
      cost: { input: Number.NaN, output: Number.NaN, cacheRead: Number.NaN, cacheWrite: Number.NaN, total: result?.usage.cost ?? Number.NaN } },
    stopReason: result?.calls.length ? 'toolUse' : 'stop' };
}

/** The host owns canonical requests, native signatures, counters and receipts.
 * Pi schedules turns and tools over a disposable view; it never opens another
 * provider, retries a request, or persists a competing conversation. */
export async function runTaskLoop(options: TaskLoop): Promise<void> {
  if (options.executorId && !['legacy', 'pi'].includes(options.executorId)) throw new Error('未知执行器不能发送请求');
  if (options.signal.aborted) throw new ApplicationError('CANCEL_REQUESTED', '任务已停止，未发送请求');
  let turn = await options.next();
  if (!turn) return;
  if (options.executorId !== 'pi') {
    do {
      const result = await turn.request(() => {});
      if (!await turn.received(result)) return;
      for (const call of result.calls) if (!(await turn.execute(call)).proceed) return;
      if (!await turn.finish(result)) return;
      turn = await options.next();
    } while (turn);
    return;
  }
  let result: ModelResult | undefined, failure: unknown, stopped = false;
  const toolView = (name: string): AgentTool => ({ name, label: name, description: '',
    // Validate original JSON once in the host gateway. The Pi projection must
    // not apply a second, different schema/coercion to the model's arguments.
    parameters: {} as AgentTool['parameters'],
    execute: async callId => {
      if (stopped || options.signal.aborted) return { content: [], details: {}, terminate: true };
      const call = /^\d+$/.test(callId) ? result?.calls[Number(callId)] : undefined;
      if (!call) throw new Error('工具调用缺少已保存的模型回执');
      try {
        const output = await turn!.execute(call);
        stopped ||= !output.proceed;
        return { content: [{ type: 'text', text: output.content }], details: {}, terminate: stopped };
      } catch (error) {
        failure = error; stopped = true;
        return { content: [], details: {}, isError: true, terminate: true };
      }
    }
  });
  const context = (): AgentContext => ({
    messages: [{ role: 'system', content: turn!.system, timestamp: Date.now() },
      ...turn!.messages.map((m): Message => m.role === 'assistant'
        ? messageView(turn!.profile, { text: m.content, calls: m.calls ?? [], native: m.native, stop: m.calls?.length ? 'tools' : 'complete', usage: { input: null, output: null, cost: null, currency: 'USD' } })
        : m.role === 'tool' ? { role: 'toolResult', toolCallId: m.callId!, toolName: '', content: [{ type: 'text', text: m.content }], isError: false, timestamp: Date.now() }
          : { role: 'user', content: m.content, timestamp: Date.now() })],
    tools: turn!.tools.map(tool => toolView(tool.name))
  });
  let currentContext = context();
  const stream: StreamFn = () => {
    const output = createAssistantMessageEventStream();
    const partial = messageView(turn!.profile);
    partial.content = [{ type: 'text', text: '' }];
    output.push({ type: 'start', partial });
    output.push({ type: 'text_start', contentIndex: 0, partial });
    void (async () => {
      try {
        result = await turn!.request(text => {
          (partial.content[0] as { text: string }).text += text;
          output.push({ type: 'text_delta', contentIndex: 0, delta: text, partial });
        });
        stopped = !await turn!.received(result);
        if (!stopped && (result.stop === 'length' || result.stop === 'filtered')) throw new ApplicationError('OUTPUT_INCOMPLETE', '模型输出未完整结束，已保留回执，未执行工具');
        const message = messageView(turn!.profile, result, true);
        if (stopped || options.signal.aborted) { stopped = true; message.content = message.content.filter(c => c.type !== 'toolCall'); message.stopReason = 'stop'; }
        // Unknown names still reach the host's deny path in source order, so
        // their error receipts and budget are canonical and survive recovery.
        for (const call of result.calls) if (!currentContext.tools?.some(tool => tool.name === call.name)) currentContext.tools!.push(toolView(call.name));
        output.push({ type: 'text_end', contentIndex: 0, content: result.text, partial });
        output.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      } catch (error) {
        failure = error; stopped = true;
        output.push({ type: 'error', reason: options.signal.aborted ? 'aborted' : 'error',
          error: { ...partial, stopReason: options.signal.aborted ? 'aborted' : 'error', errorMessage: error instanceof Error ? error.message : String(error) } });
      }
    })();
    return output;
  };
  await runAgentLoop([], currentContext, {
    model: modelView(turn.profile), convertToLlm: messages => messages as Message[], toolExecution: 'sequential', maxRetries: 0,
    prepareRequest: () => { currentContext = context(); return { context: currentContext, model: modelView(turn!.profile) }; },
    finishTurn: async () => {
      if (stopped || failure || options.signal.aborted || !result) return { action: 'end' };
      if (!await turn!.finish(result)) return { action: 'end' };
      turn = await options.next();
      result = undefined;
      return { action: turn ? 'continue' : 'end' };
    }
  }, async event => { await options.event?.(event); }, options.signal, stream);
  if (failure) throw failure;
  if (options.signal.aborted) throw new ApplicationError('CANCEL_REQUESTED', '任务已停止，已保留收到的结果');
}
