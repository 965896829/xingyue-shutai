import type { Profile, Protocol } from './types';
import { inputTokenBudget } from './model-limits';

/** One serialized request, never the cumulative billing total of a run. */
export interface ContextUsage {
  requestId: string;
  at: string;
  profileId: string;
  profileVersion: number;
  model: string;
  protocol: Protocol;
  contextLimit: number;
  inputLimit: number;
  availableInput: number;
  outputReserve: number;
  estimatedInput: number;
  method: 'o200k_base' | 'cl100k_base' | 'utf8_upper_bound' | 'measured_prefix_upper_bound';
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  status: 'not_sent' | 'pending' | 'complete' | 'unknown';
}

/** Local compaction evidence. Byte counts are deliberately not called tokens. */
export interface ContextCompaction {
  id: string;
  at: string;
  kind: 'stage_handoff' | 'history_excerpt';
  beforeBytes: number;
  afterBytes: number;
  elapsedMs: number;
  retainedSources?: number;
  archivedMessages?: number;
}

export function latestContext(items: { contextUsage?: ContextUsage }[]): ContextUsage | undefined {
  return items.flatMap(item => item.contextUsage ? [item.contextUsage] : [])
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}

export function contextMeter(profile?: Profile, usage?: ContextUsage) {
  const known = !!profile && profile.protocol !== 'images' &&
    (profile.limitMode !== 'official' || profile.modelLimits?.model === profile.model);
  const separate = profile?.limitMode === 'official' && profile.modelLimits?.windowKind === 'separate';
  const capacity = known ? (separate ? profile!.inputLimit ?? inputTokenBudget(profile!) : profile!.contextLimit) : null;
  const inputLimit = known ? Math.min(inputTokenBudget(profile!), profile!.contextPolicy?.effectiveInputLimit ?? Infinity) : null;
  // A different route/version must not inherit another model's measurement.
  const matching = !!profile && !!usage && profile.id === usage.profileId && profile.version === usage.profileVersion &&
    profile.model === usage.model && profile.protocol === usage.protocol && profile.contextLimit === usage.contextLimit &&
    inputLimit === usage.inputLimit && profile.outputLimit === usage.outputReserve;
  const measured = matching && usage.status === 'complete' && Number.isFinite(usage.inputTokens) && usage.inputTokens! >= 0;
  const tokens = matching ? measured ? usage.inputTokens! : usage.estimatedInput : null;
  const percent = capacity && tokens !== null ? tokens / capacity * 100 : null;
  return { capacity, inputLimit, separate, matching, measured, tokens, percent,
    availableInput: matching ? usage.availableInput : null,
    label: !profile ? '请选择模型' : !known ? '容量待配置' : !matching ? '待测量' : measured ? '服务端用量' : '本地估算' };
}
