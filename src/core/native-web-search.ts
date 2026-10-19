import type { SecretProfile } from '../shared/types';
import type { SearchSettings } from '../shared/assistant';
import { mergeNativeSearch, nativeServerLimit, usesNativeSearch, type ModelRequestOptions, type NativeWebSearchState } from '../shared/web-search';
import { RequestError } from './provider';

export function nativeSearchOptions(
  profile: SecretProfile, settings: SearchSettings, enabled: boolean,
  state: NativeWebSearchState, remainingTools: number, changed: () => void
): ModelRequestOptions {
  const remaining = Math.min(settings.maxSearches - state.calls.length, remainingTools);
  if (!enabled || !settings.enabled || !usesNativeSearch(profile, settings) || remaining < 1) return {};
  const permittedCalls = state.calls.length + remaining;
  const update = (incoming: Partial<NativeWebSearchState>) => {
    const before = JSON.stringify(state);
    mergeNativeSearch(state, incoming);
    if (before !== JSON.stringify(state)) changed();
    if (state.calls.length > permittedCalls)
      throw new RequestError('原生搜索超过客户端参考次数，已停止接收；中转兼容模式下上游执行情况与费用仍需核对', true);
  };
  return {
    webSearch: { maxCalls: remaining, serverLimit: nativeServerLimit(profile, settings) },
    onWebSearch: call => update({ calls: [call] }),
    onWebCitation: citation => update({ citations: [{ url: citation.url, title: citation.title }] })
  };
}
export function acceptNativeSearch(state: NativeWebSearchState, result: NativeWebSearchState | undefined, offset = 0) {
  if (!result) return;
  for (const citation of result.citations)
    state.citations = state.citations.filter(previous => previous.url !== citation.url || previous.endIndex !== undefined);
  mergeNativeSearch(state, { calls: result.calls, citations: result.citations.map(citation => ({ ...citation,
    ...(citation.startIndex !== undefined ? { startIndex: citation.startIndex + offset } : {}),
    ...(citation.endIndex !== undefined ? { endIndex: citation.endIndex + offset } : {}) })) });
}
export function nativeSearchSources(state: NativeWebSearchState) {
  return [...new Map([...state.calls.flatMap(call => call.sources), ...state.citations].map(source => [source.url, source])).values()];
}
