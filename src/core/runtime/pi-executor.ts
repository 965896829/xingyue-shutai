import { runAgentLoop, type AgentEvent, type AgentMessage, type AgentTool, type StreamFn } from '@mariozechner/pi-agent-core';
import { createAssistantMessageEventStream, type AssistantMessage, type Message, type Model } from '@mariozechner/pi-ai';
import type { TSchema } from 'typebox';
import type { FileStore } from '../storage';
import type { ModelMessage, ModelResult, Run, SecretProfile, ToolCall, ToolDefinition } from '../../shared/types';
import { invokeModel } from '../provider';
import { callModel } from './model-gateway';
import { beginTool, finishTool } from './tool-gateway';
import { ApplicationError } from '../../shared/errors';
import type { ExecutionContext, ExecutorAdapter, ExecutorCheckpoint, ExecutorDescription } from './executor';

export interface PiPorts {
  profile: SecretProfile;
  system: string;
  tools: ToolDefinition[];
  model?: typeof invokeModel;
  prepareTool(call: ToolCall, signal: AbortSignal): Promise<{ result: string; persist?: () => void }>;
  checkpoint?(event: AgentEvent): Promise<void>;
  display?(event: AgentEvent): void;
  maxTurns?: number;
}
export class PiExecutorAdapter implements ExecutorAdapter {
  private controller: AbortController | null = null;
  private current: Promise<void> | null = null;
  constructor(readonly store: FileStore, readonly ports: PiPorts) {}
  describe(): ExecutorDescription { return { id: 'pi', version: '0.73.1', checkpointVersion: 1, admitted: false, capabilities: ['offline-read', 'offline-draft', 'offline-candidate'] }; }
  restore(checkpoint: ExecutorCheckpoint) {
    if (checkpoint.executorId !== 'pi' || checkpoint.executorVersion !== '0.73.1' || checkpoint.checkpointVersion !== 1)
      throw new ApplicationError('PROJECT_VERSION_UNSUPPORTED', 'Pi 检查点版本未知，保留记录，禁止重新执行');
    this.store.db.run(checkpoint.runId);
    return ['read', 'authorize_attempt'] as const;
  }
  execute(context: ExecutionContext): Promise<void> {
    if (this.current) return Promise.reject(new Error('Pi 执行器已有活动任务'));
    if (context.kind !== 'run') return Promise.reject(new Error('此 Pi 实验不支持对话任务'));
    const current = this.drive(context.id);
    this.current = current;
    void current.finally(() => { if (this.current === current) this.current = null; }).catch(() => {});
    return current;
  }
  private async drive(runId: string) {
    const run = this.store.db.run(runId);
    this.restore({ runId, executorId: run.executorId ?? '', executorVersion: run.executorVersion ?? '', checkpointVersion: run.checkpointVersion ?? 0 });
    const controller = new AbortController();
    this.controller = controller;
    const { profile } = this.ports;
    const history: ModelMessage[] = structuredClone(run.messages);
    if (!history.length) history.push({ role: 'user', content: run.request });
    let turns = 0;
    let lastError: unknown;
    const model: Model<'openai-completions'> = { id: profile.model, name: profile.model, api: 'openai-completions', provider: 'client-gateway', baseUrl: 'https://invalid.invalid', reasoning: false, input: ['text'], contextWindow: profile.contextLimit, maxTokens: profile.outputLimit, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const projection = (result?: ModelResult): AssistantMessage => ({
      role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: result ? [ ...(result.text ? [{ type: 'text' as const, text: result.text }] : []), ...result.calls.map((call) => ({ type: 'toolCall' as const, id: call.id, name: call.name, arguments: JSON.parse(call.arguments) })) ] : [],
      usage: { input: result?.usage.input ?? Number.NaN, output: result?.usage.output ?? Number.NaN, totalTokens: result && result.usage.input !== null && result.usage.output !== null ? result.usage.input + result.usage.output : Number.NaN, cacheRead: Number.NaN, cacheWrite: Number.NaN,
        cost: { input: Number.NaN, output: Number.NaN, cacheRead: Number.NaN, cacheWrite: Number.NaN, total: result?.usage.cost ?? Number.NaN } },
      stopReason: result?.stop === 'tools' ? 'toolUse' : result?.stop === 'complete' ? 'stop' : result?.stop === 'length' ? 'length' : 'error'
    });
    const stream: StreamFn = async () => {
      const output = createAssistantMessageEventStream();
      try {
        if (++turns > (this.ports.maxTurns ?? 8)) throw new Error('Pi 实验轮数达到授权上限');
        const result = await callModel(this.store, run, 'pi-turn', this.ports.model ?? invokeModel, profile, this.ports.system, history, this.ports.tools, controller.signal);
        const message = projection(result);
        history.push({ role: 'assistant', content: result.text, calls: result.calls, native: result.native });
        output.push({ type: 'start', partial: message });
        if (message.stopReason === 'error') output.push({ type: 'error', reason: 'error', error: message });
        else output.push({ type: 'done', reason: message.stopReason as 'stop' | 'length' | 'toolUse', message });
      } catch (error) {
        lastError = error;
        const message = { ...projection(), stopReason: controller.signal.aborted ? 'aborted' as const : 'error' as const, errorMessage: error instanceof Error ? error.message : '请求失败' };
        output.push({ type: 'error', reason: message.stopReason, error: message });
      }
      return output;
    };
    const tools: AgentTool[] = this.ports.tools.map((definition) => ({
      ...definition, label: definition.name, parameters: definition.parameters as TSchema,
      execute: async (callId, args) => {
        try {
        const call = { id: callId, name: definition.name, arguments: JSON.stringify(args) };
        const ticket = beginTool(this.store, runId, call, this.ports.tools, controller.signal);
        const prepared = ticket.status === 'complete' ? { result: ticket.result! } : await this.ports.prepareTool(call, controller.signal);
        if (controller.signal.aborted) throw new ApplicationError('CANCEL_REQUESTED', '工具执行已停止');
        if (ticket.status !== 'complete') finishTool(this.store, ticket, prepared.result, prepared.persist);
        history.push({ role: 'tool', callId, content: prepared.result });
        return { content: [{ type: 'text', text: prepared.result }], details: { scopedCallId: ticket.id } };
        } catch (error) { controller.abort(); throw error; }
      }
    }));
    try {
      await runAgentLoop([{ role: 'user', content: run.request, timestamp: Date.now() }], { systemPrompt: this.ports.system, messages: [], tools }, {
        model, convertToLlm: (messages: AgentMessage[]) => messages as Message[], toolExecution: 'sequential', maxRetries: 0,
        shouldStopAfterTurn: () => controller.signal.aborted || turns >= (this.ports.maxTurns ?? 8)
      }, async (event) => {
        await this.ports.checkpoint?.(event);
        this.store.db.transaction(() => {
          const attachment = this.store.putObject(JSON.stringify({ executor: this.describe(), event, messages: history }));
          this.store.db.event(runId, 'executor-checkpoint', 'Pi 实验检查点已持久化', { attachment, type: event.type });
        });
        try { this.ports.display?.(event); } catch {}
      }, controller.signal, stream);
      if (lastError) throw lastError;
    } finally { this.controller = null; }
  }
  requestControl(runId: string, action: 'pause' | 'cancel') {
    this.store.db.event(runId, 'control-requested', '作者请求停止 Pi 实验', { action });
    this.controller?.abort();
  }
  async dispose() { this.controller?.abort(); await this.current?.catch(() => {}); }
}
