import { z } from 'zod';
import { fetch, ProxyAgent } from 'undici';
import { protocolSchema, type ModelCatalog, type ModelCatalogEntry } from '../shared/types';
import { boundedBody, endpoint } from './provider';
import { limitsFromCatalog } from './model-limits';

// Discovery needs a connection, never an already-selected model.
const connectionSchema = z.object({
  id: z.string().optional(),
  protocol: protocolSchema,
  baseUrl: z.string().trim().url(),
  proxy: z.string().trim().default(''),
  headers: z.record(z.string(), z.string()).default({})
});
export type CatalogConnection = z.infer<typeof connectionSchema> & { apiKey: string };
export function sameEndpoint(a: string, b: string) {
  try {
    return new URL(a.trim()).href.replace(/\/+$/, '') === new URL(b.trim()).href.replace(/\/+$/, '');
  } catch {
    return false;
  }
}
export function resolveCatalogConnection(
  draft: unknown,
  suppliedKey: unknown,
  saved?: { id?: string; baseUrl: string; apiKey: string }
): CatalogConnection {
  const c = connectionSchema.parse(draft);
  endpoint(c, 'models');
  for (const h of Object.keys(c.headers))
    if (/authorization|api[-_]key|cookie|^host$/i.test(h))
      throw new Error('密钥请填写 API Key 栏，不能使用认证、Cookie 或 Host 自定义请求头');
  const key = typeof suppliedKey === 'string' ? suppliedKey.trim() : '';
  if (!key && saved?.apiKey && (!sameEndpoint(c.baseUrl, saved.baseUrl) || c.id !== saved.id))
    throw new Error('API 根地址已改变，请重新填写用于此地址的 API Key');
  return { ...c, apiKey: key || saved?.apiKey || '' };
}

class CatalogError extends Error {}
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 512) : '');
export async function fetchModelCatalog(c: CatalogConnection, parentSignal?: AbortSignal): Promise<ModelCatalog> {
  const headers: Record<string, string> = { ...c.headers, Accept: 'application/json' };
  if (c.protocol === 'anthropic') {
    headers['x-api-key'] = c.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (c.protocol === 'gemini') headers['x-goog-api-key'] = c.apiKey;
  else if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  let dispatcher: ProxyAgent | undefined;
  const entries = new Map<string, ModelCatalogEntry>();
  const cursors = new Set<string>();
  let cursor = '',
    truncated = false;
  try {
    dispatcher = c.proxy ? new ProxyAgent(c.proxy) : undefined;
    for (let page = 0; page < 20; page++) {
      const u = new URL(endpoint(c, 'models'));
      if (c.protocol === 'gemini') {
        u.searchParams.set('pageSize', '1000');
        if (cursor) u.searchParams.set('pageToken', cursor);
      } else if (c.protocol === 'anthropic' && cursor) u.searchParams.set('after_id', cursor);
      const res = await fetch(u, { headers, dispatcher, redirect: 'error', signal });
      if (!res.ok) {
        await res.body?.cancel();
        const reason =
          res.status === 401
            ? '密钥无效或已过期'
            : res.status === 403
              ? '密钥没有读取模型列表的权限'
              : [404, 405].includes(res.status)
                ? '此地址未提供模型列表接口，请核对 API 根地址或手动填写模型'
                : res.status === 429
                  ? '请求过于频繁或服务额度受限，请稍后重试'
                  : '供应商暂时无法返回模型列表';
        throw new CatalogError(`${reason}（HTTP ${res.status}）`);
      }
      let body: any;
      try {
        body = JSON.parse((await boundedBody(res.body, 4_000_000)).toString('utf8'));
      } catch {
        throw new CatalogError('模型列表不是有效 JSON，或响应超过 4 MB；请核对地址，也可手动填写模型');
      }
      const rows = body?.data ?? body?.models;
      if (!Array.isArray(rows))
        throw new CatalogError('响应中没有可识别的模型列表（data / models），可手动填写模型');
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        let id = clean(row.id) || clean(row.name);
        if (c.protocol === 'gemini') {
          id = id.replace(/^models\//, '');
          if (
            Array.isArray(row.supportedGenerationMethods) &&
            !row.supportedGenerationMethods.includes('generateContent')
          )
            continue;
        }
        if (!id || entries.has(id)) continue;
        if (entries.size >= 2000) {
          truncated = true;
          break;
        }
        const limits = limitsFromCatalog(c, id, row);
        entries.set(id, {
          id,
          name: clean(row.display_name) || clean(row.displayName) || id,
          owner: clean(row.owned_by),
          ...(limits ? { limits } : {})
        });
      }
      const next =
        c.protocol === 'gemini'
          ? clean(body.nextPageToken)
          : c.protocol === 'anthropic' && body.has_more === true
            ? clean(body.last_id)
            : '';
      if (c.protocol === 'anthropic' && body.has_more === true && !next) truncated = true;
      if (truncated || !next) break;
      if (cursors.has(next) || page === 19) {
        truncated = true;
        break;
      }
      cursors.add(next);
      cursor = next;
    }
    return { models: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)), truncated };
  } catch (e) {
    if (e instanceof CatalogError) throw e;
    // Do not relay raw network exceptions or server bodies, which may contain credentials.
    throw new Error(
      signal.aborted
        ? '读取模型列表超时（30 秒），请重试或手动填写模型'
        : '无法连接模型列表接口，请检查地址、网络、代理或证书；也可手动填写模型'
    );
  } finally {
    await dispatcher?.close();
  }
}
