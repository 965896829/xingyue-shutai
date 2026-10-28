import type { Profile } from './types';

export const connectionId = (p: Profile) => p.connectionId ?? p.id;
export function providerGroups(profiles: Profile[]) {
  const groups = new Map<string, Profile[]>();
  for (const p of profiles) {
    const id = connectionId(p);
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }
  return [...groups.values()];
}
export const connectionFields = (p: Profile) => ({
  id: connectionId(p),
  name: p.name,
  protocol: p.protocol,
  baseUrl: p.baseUrl,
  proxy: p.proxy,
  headers: p.headers
});
export const modelFields = (p: Profile) => ({
  model: p.model,
  contextLimit: p.contextLimit,
  outputLimit: p.outputLimit,
  inputLimit: p.inputLimit,
  limitMode: p.limitMode,
  modelLimits: p.modelLimits,
  ...(p.contextPolicy ? { contextPolicy: p.contextPolicy } : {}),
  ...(p.networkRecovery ? { networkRecovery: p.networkRecovery } : {}),
  stream: p.stream,
  ...(p.responsesTransport ? { responsesTransport: p.responsesTransport } : {}),
  tools: p.tools,
  temperature: p.temperature,
  reasoningEffort: p.reasoningEffort ?? null,
  reasoningRevision: p.reasoningRevision ?? 0,
  inputPrice: p.inputPrice,
  outputPrice: p.outputPrice,
  currency: p.currency,
  timeoutSeconds: p.timeoutSeconds,
  imageSize: p.imageSize,
  imageQuality: p.imageQuality
});

export function modelExecutionFields(p: Profile) {
  const { modelLimits, reasoningEffort, reasoningRevision, ...execution } = modelFields(p);
  return execution;
}
