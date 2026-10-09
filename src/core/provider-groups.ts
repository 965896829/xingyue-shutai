import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { profileSchema, protocolSchema, type Profile, type ModelLimits } from '../shared/types';
import { connectionId, connectionFields, modelExecutionFields } from '../shared/provider-groups';
import { endpoint } from './provider';
import { sameEndpoint } from './model-catalog';
import { normalizeLimits, trustedModelLimits } from './model-limits';

export type StoredProfile = Profile & { encryptedKey: string };
const connectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  protocol: protocolSchema,
  baseUrl: z.string().trim().url(),
  proxy: z.string().default(''),
  headers: z.record(z.string(), z.string()).default({})
});
// Builds a complete replacement before the caller atomically persists it.
export function prepareProviderGroup(
  current: StoredProfile[],
  rawConnection: unknown,
  rawModels: unknown,
  replacementKey?: string,
  resolveLimits?: (p: Profile) => ModelLimits | null
) {
  const connection = connectionSchema.parse(rawConnection);
  const rows = z
    .array(z.record(z.string(), z.unknown()))
    .min(1, '请至少选择一个模型')
    .max(2000)
    .parse(rawModels);
  endpoint(connection, 'models');
  for (const header of Object.keys(connection.headers))
    if (/authorization|api[-_]key|cookie|^host$/i.test(header))
      throw new Error('密钥请填写 API Key 栏，不能存入自定义请求头');
  const collision = current.find((p) => p.id === connection.id && connectionId(p) !== connection.id);
  if (collision) throw new Error('供应商连接编号冲突');
  const group = current.filter((p) => connectionId(p) === connection.id);
  const anchor = group.find((p) => p.id === connection.id) ?? group[0];
  if (!replacementKey && anchor?.encryptedKey && !sameEndpoint(connection.baseUrl, anchor.baseUrl))
    throw new Error('API 根地址已改变，请重新填写用于此地址的 API Key');
  const encryptedKey = replacementKey ?? anchor?.encryptedKey ?? '';
  const selected = new Map<string, StoredProfile>();
  for (const row of rows) {
    const model = z.string().trim().min(1).max(512).parse(row.model);
    if (selected.has(model)) throw new Error(`重复选择模型：${model}`);
    const old = group.find((p) => p.model === model);
    const id = old?.id ?? (!group.length && !selected.size ? connection.id : randomUUID());
    const draft = profileSchema.parse({
      ...row,
      ...connection,
      id,
      model,
      connectionId: connection.id,
      enabled: true,
      hasKey: !!encryptedKey,
      version: old?.version ?? 1,
      capabilities: old?.capabilities ?? {}
    });
    // Ignore provenance submitted by the renderer. Only use a main-process
    // catalog result, an existing saved record, or the bundled official registry.
    const next = normalizeLimits(
      draft,
      resolveLimits
        ? resolveLimits({ ...draft, modelLimits: old?.modelLimits ?? null })
        : trustedModelLimits({ ...draft, modelLimits: old?.modelLimits ?? null })
    );
    const changed =
      old &&
      (JSON.stringify({ ...connectionFields(old), ...modelExecutionFields(old) }) !==
        JSON.stringify({ ...connectionFields(next), ...modelExecutionFields(next) }) ||
        old.encryptedKey !== encryptedKey);
    if (changed) {
      next.version = old.version + 1;
      next.capabilities = {};
    }
    selected.set(model, { ...next, encryptedKey });
  }
  const retained = group.map((old) => {
    const active = selected.get(old.model);
    if (active) {
      selected.delete(old.model);
      return active;
    }
    // Retain IDs and model-specific settings for history and future re-enabling.
    const changed =
      JSON.stringify(connectionFields(old)) !== JSON.stringify(connection) ||
      old.encryptedKey !== encryptedKey;
    return {
      ...old,
      ...connection,
      id: old.id,
      connectionId: connection.id,
      enabled: false,
      hasKey: !!encryptedKey,
      encryptedKey,
      version: changed ? old.version + 1 : old.version,
      capabilities: changed ? {} : old.capabilities
    };
  });
  const saved = [...retained, ...selected.values()];
  return { all: [...current.filter((p) => connectionId(p) !== connection.id), ...saved], saved };
}
