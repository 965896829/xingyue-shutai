import {
  modelLimitsSchema,
  profileSchema,
  type ModelLimits,
  type Profile,
  type Protocol
} from '../shared/types';
import { officialModelLimits, applyModelLimits, requireModelLimits } from '../shared/model-limits';

export type LimitsConnection = { baseUrl: string; protocol: Protocol };
export const limitsCacheKey = (c: LimitsConnection, model: string) =>
  JSON.stringify([c.protocol, new URL(c.baseUrl).href.replace(/\/+$/, ''), model]);

// A relay's owned_by field or familiar-looking ID is not evidence that its metadata
// comes from the official API. Only these exact HTTPS origins qualify.
export function officialApiSource(c: LimitsConnection): string | null {
  const u = new URL(c.baseUrl);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash) return null;
  const route = u.pathname.replace(/\/+$/, '');
  if (
    c.protocol === 'gemini' &&
    u.hostname === 'generativelanguage.googleapis.com' &&
    /^\/v1(beta)?$/.test(route)
  )
    return `${u.origin}${route}/models`;
  if (c.protocol === 'anthropic' && u.hostname === 'api.anthropic.com' && route === '/v1')
    return `${u.origin}/v1/models`;
  if (
    ['chat', 'responses', 'anthropic'].includes(c.protocol) &&
    u.hostname === 'api.deepseek.com' &&
    ['', '/v1', '/anthropic'].includes(route)
  )
    return `${u.origin}${route}/models`;
  return null;
}

export function limitsFromCatalog(
  c: LimitsConnection,
  model: string,
  row: Record<string, unknown>
): ModelLimits | null {
  const source = officialApiSource(c);
  if (!source) return officialModelLimits(model, c.protocol);
  let context: unknown,
    input: unknown = null,
    output: unknown,
    kind: 'shared' | 'separate' = 'shared';
  if (c.protocol === 'gemini') {
    input = row.inputTokenLimit;
    output = row.outputTokenLimit;
    kind = 'separate';
    context = typeof input === 'number' && typeof output === 'number' ? input + output : null;
  } else if (new URL(c.baseUrl).hostname === 'api.anthropic.com') {
    input = row.max_input_tokens;
    context = input;
    output = row.max_tokens;
  } else {
    context = row.context_window;
    output = row.max_output_tokens;
  }
  const spec = modelLimitsSchema.safeParse({
    model,
    contextLimit: context,
    inputLimit: input,
    outputLimit: output,
    windowKind: kind,
    source,
    checkedAt: new Date().toISOString().slice(0, 10),
    origin: 'official-api'
  });
  return spec.success ? spec.data : officialModelLimits(model, c.protocol);
}

export function trustedModelLimits(p: Profile, cached?: ModelLimits): ModelLimits | null {
  const source = officialApiSource(p);
  for (const spec of [cached, p.modelLimits]) {
    if (
      spec?.origin === 'official-api' &&
      spec.model === p.model &&
      source === spec.source &&
      modelLimitsSchema.safeParse(spec).success
    )
      return spec;
  }
  return officialModelLimits(p.model, p.protocol);
}

// This is also used on startup so already-saved models receive the new default.
// Explicit manual overrides made in this version survive future refreshes.
export function migrateModelLimits<T extends Profile>(profiles: T[]): T[] {
  return profiles.map((raw) => {
    const parsed = profileSchema.parse(raw);
    const spec = trustedModelLimits(parsed);
    const mode = raw.limitMode ?? (spec ? 'official' : 'manual');
    const next = applyModelLimits({ ...raw, ...parsed, limitMode: mode }, spec);
    const changed =
      raw.contextLimit !== next.contextLimit ||
      raw.outputLimit !== next.outputLimit ||
      (raw.inputLimit ?? null) !== next.inputLimit;
    return {
      ...next,
      version: changed ? parsed.version + 1 : parsed.version,
      capabilities: changed ? {} : parsed.capabilities
    };
  });
}

export function normalizeLimits(p: Profile, spec: ModelLimits | null): Profile {
  const next = applyModelLimits({ ...p, modelLimits: spec }, spec);
  requireModelLimits(next);
  return profileSchema.parse(next);
}
