import { z } from 'zod';
import type { Profile, Protocol } from './types';

export const reasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type ReasoningSelection = ReasoningEffort | null;
export type ReasoningSnapshot = Record<string, ReasoningSelection>;

export const effortLabels: Record<ReasoningEffort, string> = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: 'Max'
};
export const effortDescriptions: Record<ReasoningEffort, string> = {
  none: '关闭额外推理，优先响应速度。',
  minimal: '少量推理，适合简单任务。',
  low: '较快响应，适合日常讨论。',
  medium: '兼顾思考深度与响应速度。',
  high: '深入推敲，适合复杂方案和审核。',
  xhigh: '投入更多推理，等待时间和用量可能增加。',
  max: '使用最高推理档位，等待时间和用量可能增加。'
};

interface Capability {
  models: string[];
  efforts: ReasoningEffort[];
  defaultEffort: ReasoningEffort;
  source: string;
  responsesOnly?: boolean;
  chatTools?: 'none-only' | 'unsupported';
}
const docs = 'https://developers.openai.com/api/docs/models/';
// Exact model IDs only. A relay alias does not prove a model's capabilities.
// Sources checked 2026-10-19; Codex subscription-only levels are not API values.
const capabilities: Capability[] = [
  ...['gpt-6-astra', 'gpt-6.1-sol'].map((model) => ({
    models: [model],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[],
    defaultEffort: 'medium' as const,
    source: docs + model,
    chatTools: 'unsupported' as const
  })),
  ...['gpt-6-sol', 'gpt-6-luna'].map((model) => ({
    models: [model],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[],
    defaultEffort: 'medium' as const,
    source: docs + model,
    chatTools: 'none-only' as const
  })),
  ...['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].map((model) => ({
    models: [model],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[],
    defaultEffort: 'medium' as const,
    source: docs + model
  })),
  {
    models: ['gpt-5.5', 'gpt-5.5-2026-04-23'],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
    source: docs + 'gpt-5.5'
  },
  {
    models: ['gpt-5.4', 'gpt-5.4-2026-03-05'],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'none',
    source: docs + 'gpt-5.4'
  },
  ...['mini', 'nano'].map((size) => ({
    models: [`gpt-5.4-${size}`, `gpt-5.4-${size}-2026-03-17`],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh'] as ReasoningEffort[],
    defaultEffort: 'none' as const,
    source: docs + `gpt-5.4-${size}`
  })),
  {
    models: ['gpt-5.4-pro', 'gpt-5.4-pro-2026-03-05'],
    efforts: ['medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
    source: docs + 'gpt-5.4-pro',
    responsesOnly: true
  },
  {
    models: ['gpt-5.5-pro', 'gpt-5.5-pro-2026-04-23'],
    efforts: ['medium', 'high', 'xhigh'],
    defaultEffort: 'high',
    source: docs + 'gpt-5.5-pro',
    responsesOnly: true
  },
  ...['gpt-5.3-codex', 'gpt-5.2-codex'].map((model) => ({
    models: [model],
    efforts: ['low', 'medium', 'high', 'xhigh'] as ReasoningEffort[],
    defaultEffort: 'medium' as const,
    source: docs + model,
    responsesOnly: true
  })),
  {
    models: ['gpt-5.2', 'gpt-5.2-2025-12-11'],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'none',
    source: docs + 'gpt-5.2'
  },
  {
    models: ['gpt-5.2-pro', 'gpt-5.2-pro-2025-12-11'],
    efforts: ['medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
    source: docs + 'gpt-5.2-pro',
    responsesOnly: true
  },
  {
    models: ['gpt-5.1', 'gpt-5.1-2025-11-13'],
    efforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'none',
    source: docs + 'gpt-5.1'
  },
  {
    models: ['gpt-5', 'gpt-5-2025-08-07'],
    efforts: ['minimal', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
    source: docs + 'gpt-5'
  }
];

export function reasoningCapability(profile: Pick<Profile, 'model' | 'protocol'>) {
  if (!['chat', 'responses'].includes(profile.protocol)) return null;
  const cap = capabilities.find((row) => row.models.includes(profile.model));
  return cap && (!cap.responsesOnly || profile.protocol === 'responses') ? cap : null;
}

export function validateReasoning(profile: Pick<Profile, 'model' | 'protocol' | 'reasoningEffort'>) {
  const effort = profile.reasoningEffort ?? null;
  if (effort === null) return;
  reasoningEffortSchema.parse(effort);
  if (!reasoningCapability(profile)?.efforts.includes(effort))
    throw new Error(
      `${profile.model} 在当前协议下不支持「${effortLabels[effort]}」推理强度，请恢复默认或选择支持的档位。`
    );
}

export function reasoningLabel(value: ReasoningSelection | undefined) {
  return value == null ? '默认' : effortLabels[value];
}

export function captureReasoning(profiles: Pick<Profile, 'id' | 'reasoningEffort'>[]): ReasoningSnapshot {
  return Object.fromEntries(profiles.map((profile) => [profile.id, profile.reasoningEffort ?? null]));
}

export function withTaskReasoning<T extends Pick<Profile, 'id' | 'reasoningEffort'>>(
  profile: T,
  owner: { reasoningEfforts?: ReasoningSnapshot }
): T {
  // Legacy tasks were sent without an effort override. Never silently apply a
  // preference saved after a task/turn was created, including after a restart.
  return { ...profile, reasoningEffort: owner.reasoningEfforts?.[profile.id] ?? null };
}

export function reasoningRequest(
  profile: Pick<Profile, 'model' | 'protocol' | 'reasoningEffort'>,
  toolCount: number
): Record<string, unknown> {
  validateReasoning(profile);
  const effort = profile.reasoningEffort;
  if (effort == null) return {};
  const cap = reasoningCapability(profile)!;
  if (
    profile.protocol === 'chat' &&
    toolCount &&
    (cap.chatTools === 'unsupported' || (cap.chatTools === 'none-only' && effort !== 'none'))
  )
    throw new Error(
      `${profile.model} 的当前推理档位不能通过 Chat Completions 调用工具，请将此连接改为 Responses 协议。`
    );
  return profile.protocol === 'responses' ? { reasoning: { effort } } : { reasoning_effort: effort };
}

export function reasoningAllowsTemperature(profile: {
  model: string;
  protocol: Protocol;
  reasoningEffort?: ReasoningSelection;
}) {
  // Preserve legacy default requests; explicit reasoning must not send a
  // sampling parameter rejected by the OpenAI reasoning endpoint.
  return profile.reasoningEffort == null || profile.reasoningEffort === 'none';
}
