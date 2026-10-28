import { Tiktoken } from 'js-tiktoken/lite';
import { ApplicationError } from '../shared/errors';
import o200k from 'js-tiktoken/ranks/o200k_base';
import cl100k from 'js-tiktoken/ranks/cl100k_base';
import { contextPolicySchema, type Profile } from '../shared/types';
import { inputTokenBudget, requireModelLimits } from '../shared/model-limits';
import { hash } from './domain';

export type CountingMethod = 'o200k_base' | 'cl100k_base' | 'utf8_upper_bound';
const encoders = new Map<CountingMethod, Tiktoken>();
const counts = new Map<string, number>();

export function countingMethod(profile: Profile): CountingMethod {
  const configured = profile.contextPolicy?.tokenizer ?? 'auto';
  if (configured === 'conservative') return 'utf8_upper_bound';
  if (configured !== 'auto') return configured;
  if (profile.protocol !== 'chat' && profile.protocol !== 'responses') return 'utf8_upper_bound';
  if (/^(?:gpt-5(?:[.\-]|$)|gpt-4(?:o|\.1|\.5)(?:-|$)|chatgpt-4o-|o[13](?:-|$)|o4-mini(?:-|$))/.test(profile.model)) return 'o200k_base';
  if (/^(?:gpt-4(?:-|$)|gpt-3\.5-turbo(?:-|$)|gpt-35-turbo(?:-|$))/.test(profile.model)) return 'cl100k_base';
  return 'utf8_upper_bound';
}

export function countInput(profile: Profile, value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  const bytes = Buffer.byteLength(text, 'utf8'), method = countingMethod(profile);
  if (method === 'utf8_upper_bound') return { tokens: bytes, bytes, method };
  const key = method + ':' + hash(text);
  let tokens = counts.get(key);
  if (tokens === undefined) {
    let encoder = encoders.get(method);
    if (!encoder) { encoder = new Tiktoken(method === 'o200k_base' ? o200k : cl100k); encoders.set(method, encoder); }
    tokens = encoder.encode(text, [], []).length;
    if (counts.size >= 256) counts.delete(counts.keys().next().value!);
    counts.set(key, tokens);
  }
  return { tokens, bytes, method };
}

export function contextAllowance(profile: Profile, toolCount = 0) {
  requireModelLimits(profile);
  const policy = contextPolicySchema.parse(profile.contextPolicy ?? {});
  const modelInputLimit = inputTokenBudget(profile);
  const effectiveInputLimit = Math.min(modelInputLimit, policy.effectiveInputLimit ?? Infinity);
  const safetyReserve = Math.max(policy.safetyTokens, Math.ceil(effectiveInputLimit * policy.safetyRatio));
  const toolReserve = toolCount ? policy.toolResultReserve : 0;
  return {
    modelInputLimit, effectiveInputLimit, outputReserve: profile.outputLimit,
    providerReserve: policy.providerOverhead, safetyReserve, toolReserve,
    availableInput: Math.max(0, effectiveInputLimit - policy.providerOverhead - safetyReserve - toolReserve),
    effectiveLimitSource: policy.effectiveInputLimit === null ? 'model' as const : 'configured' as const
  };
}

export function requestSize(profile: Profile, body: unknown, toolCount = 0) {
  return { ...countInput(profile, body), ...contextAllowance(profile, toolCount) };
}

export function assertRequestFits(profile: Profile, body: unknown, toolCount = 0) {
  const size = requestSize(profile, body, toolCount);
  if (size.tokens > size.availableInput) throw new ApplicationError('MODEL_CONFIGURATION', `必需上下文超过模型可用容量（${size.method === 'utf8_upper_bound' ? '字节保守上界' : '本地分词估计'} ${size.tokens}，可用 ${size.availableInput}，已预留输出、协议开销和安全余量）。请缩小任务范围或选择容量更大的模型；关键约定未被删除，本次没有发送请求。`);
  return size;
}
