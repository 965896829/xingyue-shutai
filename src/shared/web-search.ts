export interface NativeWebCitation {
  url: string;
  title: string;
  startIndex?: number;
  endIndex?: number;
}
export interface NativeWebSearchCall {
  id: string;
  status: 'in_progress' | 'searching' | 'completed' | 'failed';
  action?: { type: string; queries?: string[]; url?: string; pattern?: string };
  sources: { url: string; title: string }[];
}
export interface NativeWebSearchState {
  calls: NativeWebSearchCall[];
  citations: NativeWebCitation[];
}
export interface ModelRequestOptions {
  /** Host-owned stable catalogue; actual callable tools are still the tools argument. */
  cacheTools?: import('./types').ToolDefinition[];
  /** Stable project/provider partition; never an attempt ID or a timestamp. */
  promptCacheKey?: string;
  /** Stage-owned reasoning scope; current tool chains remain intact. */
  reasoningContext?: 'current_turn' | 'all_turns';
  /** Host-owned, verified continuation of a Responses input; never supplied by a model. */
  responsesInput?: Record<string, unknown>[];
  singleToolCall?: boolean;
  onActivity?: (phase: import('./generation').GenerationPhase) => void;
  webSearch?: { maxCalls: number; required?: boolean; serverLimit?: boolean; allowedDomains?: string[] };
  onWebSearch?: (call: NativeWebSearchCall) => void;
  onWebCitation?: (citation: NativeWebCitation) => void;
}
export function usesNativeSearch(
  profile: { protocol: string; tools: boolean; capabilities: Record<string, string> },
  settings: { provider: 'auto' | 'openai' | 'tavily' }
) {
  return settings.provider !== 'tavily' && profile.protocol === 'responses' &&
    profile.tools && profile.capabilities.tools !== 'failed';
}
export function nativeServerLimit(profile: { baseUrl: string }, settings: { nativeToolLimit: 'auto' | 'server' | 'compatible' }) {
  return settings.nativeToolLimit === 'server' || settings.nativeToolLimit === 'auto' && new URL(profile.baseUrl).hostname === 'api.openai.com';
}
export function webSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 10000) return;
  try {
    const u = new URL(value), host = u.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || !host.includes('.') || host.endsWith('.local')) return;
    return u.href;
  } catch { return; }
}
export function mergeNativeSearch(state: NativeWebSearchState, incoming: Partial<NativeWebSearchState>) {
  for (const call of incoming.calls ?? []) {
    const previous = state.calls.find(item => item.id === call.id);
    if (!previous) state.calls.push(structuredClone(call));
    else Object.assign(previous, call, { action: call.action ?? previous.action,
      sources: [...new Map([...previous.sources, ...call.sources].map(source => [source.url, source])).values()] });
  }
  for (const citation of incoming.citations ?? [])
    if (!state.citations.some(item => item.url === citation.url && item.startIndex === citation.startIndex && item.endIndex === citation.endIndex))
      state.citations.push(structuredClone(citation));
}
export function renderNativeCitations(text: string, citations: NativeWebCitation[] = []) {
  const characters = Array.from(text), links = new Map<string, number>(), insertions = new Map<number, string[]>();
  for (const citation of citations) {
    const url = webSourceUrl(citation.url);
    if (!url) continue;
    if (text.includes(`](${url})`) || text.includes(`](<${url}>)`)) continue;
    if (!links.has(url)) links.set(url, links.size + 1);
    const position = Number.isInteger(citation.endIndex) && citation.endIndex! >= 0 && citation.endIndex! <= characters.length
      ? citation.endIndex! : characters.length;
    const link = ` [来源${links.get(url)}](<${url.replace(/>/g, '%3E')}>)`;
    const items = insertions.get(position) ?? [];
    if (!items.includes(link)) items.push(link);
    insertions.set(position, items);
  }
  for (const [position, items] of [...insertions].sort(([a], [b]) => b - a)) characters.splice(position, 0, items.join(''));
  return characters.join('').replace(/cite[^]*/g, '');
}
