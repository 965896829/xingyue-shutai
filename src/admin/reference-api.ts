import type { ManagementSession, ManagementTransport } from './transport';
import { invokeCommand } from '../shared/client';
import { profileSchema, type Profile, type Snapshot } from '../shared/types';
import { connectionId, connectionFields, modelFields, providerGroups } from '../shared/provider-groups';
import originalCatalog from './reference/catalog.json';
import type { Catalog, DataRecord } from './reference/lib/api';
import { unavailableMessage } from './capabilities';
import { referencePreview } from './reference-preview';

let session: ManagementSession;
let transport: ManagementTransport;
export function configureReferenceApi(value: ManagementSession, bridge: ManagementTransport) { session = value; transport = bridge; }
export const catalog: Catalog = {
  ...originalCatalog,
  pages: [...originalCatalog.pages, ...[
    ['local-workspace', 'operations', '创作讨论', '/admin/local/workspace'],
    ['local-creation', 'operations', '作品方案与书名', '/admin/local/creation'],
    ['local-cover', 'operations', '封面设计', '/admin/local/cover'],
    ['local-settings', 'operations', '作品配置', '/admin/local/settings'],
    ['local-trash', 'operations', '作品回收站', '/admin/local/trash'],
    ['local-search', 'agents', '联网与语义检索', '/admin/local/search']
  ].map(([key, group, label, path]) => ({ key, group, label, path, description: '管理本机客户端', fields: [], actions: [], view: 'local' }))]
} as Catalog;
const protocolToOriginal = { chat: 'openai', responses: 'openai_responses', anthropic: 'anthropic', gemini: 'gemini', images: 'images' } as const;
const protocolToClient: Record<string, Profile['protocol']> = { openai: 'chat', openai_responses: 'responses', chat: 'chat', responses: 'responses', anthropic: 'anthropic', gemini: 'gemini', images: 'images' };
export function platformRow(group: Profile[]): DataRecord {
  const p = group[0];
  return {
    id: connectionId(p), name: p.name, status: group.some(x => x.enabled) ? 'active' : 'disabled',
    version: Math.max(...group.map(x => x.version)), created_at: '', configured_secrets: p.hasKey ? ['api_key', 'account:default:api_key'] : [],
    data: {
      provider: p.name, protocol: protocolToOriginal[p.protocol], base_url: p.baseUrl,
      expected_profiles: Object.fromEntries(group.map(x => [x.id, { version: x.version, enabled: x.enabled }])),
      variables: [{ name: 'baseURL', value: p.baseUrl, secret: false, usage: '客户端模型 API 地址' }],
      accounts: [{ id: 'default', name: '默认账号', priority: null, enabled: true, auth_type: 'api_key', auth: {}, header_name: 'X-API-Key', portrait_enabled: false }],
      native_protocols: [protocolToOriginal[p.protocol]], models: group.filter(x => x.enabled).map(x => x.model),
      model_settings: group.map(x => ({ model: x.model, display_name: x.model, real_model: x.model, enabled: x.enabled, discount: 1, pricing_id: '', runtime_policy_id: '', capability: x.protocol === 'images' ? 'image' : 'text' })),
      timeout_override: p.timeoutSeconds, proxy: p.proxy, proxy_mode: p.proxy ? 'custom' : 'none', proxy_url: p.proxy, headers: p.headers, mode: 'live'
    }
  };
}
function modelRow(p: Profile): DataRecord {
  return { id: p.id, name: p.model, status: p.enabled ? 'active' : 'disabled', version: p.version, created_at: '', data: {
    model_id: p.model, canonical_key: p.model, provider_id: connectionId(p), vendor: p.name, platform_id: connectionId(p),
    capability: p.protocol === 'images' ? 'image' : 'text', context_window: p.contextLimit, output_limit: p.outputLimit,
    input_price: p.inputPrice, output_price: p.outputPrice, currency: p.currency, default_real_model_name: p.model,
    description: `${p.name} · ${p.protocol}`, model_types: [p.protocol === 'images' ? 'image' : 'text'], usage_scenes: ['desktop'],
    stages: [], tokenizer: p.contextPolicy?.tokenizer ?? 'auto', timeout: p.timeoutSeconds, stream: p.stream, tools: p.tools
  } };
}
export async function recordRows(kind: string, snapshot?: Snapshot): Promise<DataRecord[]> {
  const s = snapshot ?? await invokeCommand('app.snapshot');
  const profiles = s.savedProfiles ?? s.profiles;
  const groups = providerGroups(profiles);
  if (kind === 'platforms') return groups.map(platformRow);
  if (kind === 'models' || kind === 'base-models') return profiles.map(modelRow);
  if (kind === 'providers') return groups.map(group => ({ ...platformRow(group), data: { code: connectionId(group[0]), protocol: protocolToOriginal[group[0].protocol], description: group[0].baseUrl, display_name: group[0].name } }));
  if (['pricing', 'runtime-policies'].includes(kind)) return profiles.map(p => ({ ...modelRow(p), data: kind === 'pricing' ? { model: p.model, resource_type: p.protocol === 'images' ? 'image' : 'text', unit: 'million_tokens', input_rate: p.inputPrice, output_rate: p.outputPrice, currency: p.currency, description: '客户端成本估算单价，不是平台收费规则' } : { model: p.model, timeout: p.timeoutSeconds, description: '客户端每次请求超时', concurrency: 1 } }));
  if (kind === 'skills') return (await invokeCommand('skills.list')).map(skill => ({ id: skill.id, name: skill.title, status: 'active', version: 1, created_at: '', data: { description: skill.description, instructions: skill.contract, version: skill.sha256.slice(0, 12), stage: skill.stage, source: '安装包', category: skill.stage, tools: skill.tools, path: skill.path, builtin: true } }));
  if (kind === 'knowledge') return s.documents.map(d => ({ id: d.path, name: d.path, status: 'active', version: 1, created_at: '', data: { description: '当前作品正式资料', scope: 'project', project_id: s.project?.id, purpose: 'reference', retrieval_mode: 'lexical' } }));
  if (kind === 'desktop-devices') return [{ id: session.client.clientId, name: session.client.name, status: 'active', version: 1, created_at: session.client.startedAt ?? '', data: { client_type: '星月书台', device_id: session.client.clientId, client_version: session.client.version, os: 'Windows', device_code: session.client.clientId, user_id: '本机作者', session_id: `${session.client.sessions} 个网页会话` } }];
  return [];
}
function paged(items: DataRecord[], params: URLSearchParams) {
  const query = (params.get('q') ?? '').toLowerCase();
  const filter = JSON.parse(params.get('filters') || '{}') as Record<string, string>;
  const selected = items.filter(row => (!query || JSON.stringify(row).toLowerCase().includes(query)) && Object.entries(filter).every(([key, value]) => key.startsWith('sort_') || !value || String(row[key] ?? row.data[key] ?? '').includes(value)));
  if (filter.sort_by === 'name') selected.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') * (filter.sort_order === 'asc' ? 1 : -1));
  const page = Math.max(1, Number(params.get('page')) || 1), size = Math.max(1, Math.min(200, Number(params.get('page_size')) || 20));
  return { items: selected.slice((page - 1) * size, page * size), total: selected.length, page, page_size: size };
}
function connectionInput(data: any, id: string, name: string) {
  const protocol = protocolToClient[data.protocol];
  if (!protocol) throw new Error('客户端支持 OpenAI Chat、OpenAI Responses、Anthropic、Gemini 和图片协议，请选择对应协议。');
  return { id, name, protocol, baseUrl: data.base_url, proxy: data.proxy ?? '', headers: data.headers ?? {} };
}
async function savePlatform(id: string | undefined, body: any) {
  const s = await invokeCommand('app.snapshot');
  const group = (s.savedProfiles ?? s.profiles).filter(p => connectionId(p) === id);
  const data = body.data;
  if (data.accounts?.length > 1) throw new Error('当前每个平台接入一个 API Key。多个账号请创建独立平台。');
  if (data.accounts?.some((a: any) => a.auth_type !== 'api_key' && a.auth_type !== 'none')) throw new Error('当前接入支持 API Key 鉴权。');
  const key = data.accounts?.[0]?.auth?.api_key;
  const connection = connectionInput(data, id ?? crypto.randomUUID(), body.name);
  const rows = (data.model_settings ?? []).map((m: any) => {
    if (m.real_model && m.real_model !== m.model) throw new Error('客户端直接使用实际模型 ID，请将模型标识与真实模型名保持一致。');
    const old = group.find(p => p.model === m.model);
    return { ...modelFields(old ?? profileSchema.parse({ ...connection, model: m.model })), enabled: body.status !== 'disabled' && m.enabled !== false, timeoutSeconds: data.timeout_override ?? old?.timeoutSeconds ?? 180 };
  });
  if (!rows.length) throw new Error('请先在「模型」页检测并添加模型，或者输入模型 ID。');
  const saved = await invokeCommand('profiles.saveGroup', { connection, models: rows, apiKey: key || undefined, expectedProfiles: body.expected_profiles ?? (id ? undefined : {}) });
  return platformRow(saved);
}
export async function referenceRequest(path: string, options: RequestInit = {}): Promise<any> {
  const url = new URL(path, 'http://local.invalid');
  const route = url.pathname, method = options.method ?? 'GET';
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
  if (route === '/auth/me') return { environment: 'local', user: { id: session.client.clientId, username: '本机作者', nickname: '本机管理员', role: 'superadmin' } };
  if (route === '/auth/logout') return transport.api('/api/logout', {});
  if (route === '/admin/catalog') return catalog;
  if (method !== 'GET') {
    if (/^\/notifications\/(read-all|[^/]+\/read)$/.test(route)) {
      const s = await invokeCommand('app.snapshot');
      const ids = route === '/notifications/read-all' ? s.runs.map(r => `${r.id}:${r.status}`) : [decodeURIComponent(route.split('/')[2])];
      for (const id of ids) sessionStorage.setItem(`notice:${id}`, 'read');
      return { ok: true };
    }
    let match = route.match(/^\/admin\/records\/platforms(?:\/([^/]+))?$/);
    if (match && (method === 'POST' || method === 'PUT')) return savePlatform(match[1], body);
    if (match?.[1] && method === 'DELETE') {
      if (!body.expected_profiles) throw new Error('请刷新平台列表后再删除。');
      return invokeCommand('profiles.deleteGroup', { id: match[1], expectedProfiles: body.expected_profiles });
    }
    match = route.match(/^\/admin\/records\/platforms\/([^/]+)\/actions\/toggle$/);
    if (match) {
      if (!body.expected_profiles) throw new Error('请刷新平台列表后再修改。');
      const s = await invokeCommand('app.snapshot'), group = (s.savedProfiles ?? s.profiles).filter(p => connectionId(p) === match![1]);
      if (!group.length) throw new Error('平台已不存在，请刷新。');
      const enabled = !group.some(p => p.enabled);
      const saved = await invokeCommand('profiles.saveGroup', { connection: connectionFields(group[0]), models: group.map(p => ({ ...modelFields(p), enabled })), expectedProfiles: body.expected_profiles });
      return { result: { message: enabled ? '已启用平台模型' : '已停用平台模型' }, record: platformRow(saved) };
    }
    match = route.match(/^\/admin\/records\/(models|base-models)\/([^/]+)$/);
    if (match && method === 'DELETE') {
      const s = await invokeCommand('app.snapshot'), old = (s.savedProfiles ?? s.profiles).find(p => p.id === match![2]);
      if (!old || old.version !== Number(url.searchParams.get('expected_version'))) throw new Error('模型配置已变化，请刷新后重试。');
      return invokeCommand('profiles.delete', { id: old.id, expectedVersion: old.version });
    }
    if (match && method === 'PUT') {
      const s = await invokeCommand('app.snapshot'), old = (s.savedProfiles ?? s.profiles).find(p => p.id === match![2]);
      if (!old || old.version !== body.expected_version) throw new Error('模型配置已变化，请刷新后重试。');
      const d = body.data;
      const profile = profileSchema.parse({ ...old, model: d.model_id ?? d.canonical_key ?? old.model, contextLimit: d.context_window ?? old.contextLimit, outputLimit: d.output_limit ?? old.outputLimit, inputPrice: d.input_price ?? old.inputPrice, outputPrice: d.output_price ?? old.outputPrice, currency: d.currency ?? old.currency, timeoutSeconds: d.timeout ?? old.timeoutSeconds, enabled: body.status !== 'disabled' });
      return modelRow(await invokeCommand('profiles.save', { profile }));
    }
    if (route === '/admin/platform-configuration/detect') {
      const s = await invokeCommand('app.snapshot'), group = (s.savedProfiles ?? s.profiles).filter(p => connectionId(p) === body.record_id);
      const catalog = await invokeCommand('profiles.models', { id: group[0]?.id, connection: connectionInput(body.data, body.record_id ?? crypto.randomUUID(), body.name), apiKey: body.data.accounts?.[0]?.auth?.api_key || undefined });
      return { environment: 'live', models: catalog.models, message: `已从上游读取 ${catalog.models.length} 个模型${catalog.truncated ? '（已达到读取上限）' : ''}` };
    }
    if (route === '/admin/calculator') {
      const s = await invokeCommand('app.snapshot'), p = (s.savedProfiles ?? s.profiles).find(p => p.id === (body.model_id || body.pricing_id));
      if (!p || p.inputPrice === null || p.outputPrice === null) throw new Error('请选择已配置输入、输出单价的模型。');
      if (body.resource_type !== 'text') throw new Error('当前客户端仅提供文本 Token 成本试算。');
      const input = Number(body.input_tokens), output = Number(body.output_tokens);
      if (![input, output].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Token 数量必须是非负数。');
      const cost = (input * p.inputPrice + output * p.outputPrice) / 1_000_000;
      return { credits: `${Number(cost.toFixed(8))} ${p.currency}`, '计算公式': `(${input} × ${p.inputPrice} + ${output} × ${p.outputPrice}) / 1,000,000`, '模型': p.model, '平台': p.name, '说明': '仅按客户端已配置单价估算，实际费用以供应商账单为准。' };
    }
    match = route.match(/^\/admin\/records\/(models|base-models)\/([^/]+)\/actions\/toggle$/);
    if (match) {
      const s = await invokeCommand('app.snapshot'), p = (s.savedProfiles ?? s.profiles).find(p => p.id === match![2]);
      if (!p || p.version !== body.expected_version) throw new Error('模型已变化，请刷新后重试。');
      await invokeCommand('profiles.save', { profile: { ...p, enabled: !p.enabled } });
      return { result: { message: p.enabled ? '模型已停用' : '模型已启用' } };
    }
    match = route.match(/^\/admin\/records\/platforms\/([^/]+)\/actions\/(test|probe)$/);
    if (match) {
      const s = await invokeCommand('app.snapshot'), profile = s.profiles.find(p => connectionId(p) === match![1]);
      if (!profile) throw new Error('请先保存并启用模型');
      const result = await invokeCommand('profiles.test', { id: profile.id });
      if (!result.ok) throw new Error(result.text);
      return { result: { ...result, message: result.text } };
    }
    // An unmapped platform action must never be acknowledged as saved or executed.
    throw new Error(unavailableMessage);
  }
  const list = route.match(/^\/admin\/(?:records|reference\/list)\/([^/]+)$/);
  if (list) return paged(await recordRows(list[1]), url.searchParams);
  if (route.match(/^\/admin\/platform-configuration\/[^/]+\/account-health$/)) return { items: [] };
  if (route === '/admin/platform-summary') {
    const s = await invokeCommand('app.snapshot'), ps = s.savedProfiles ?? s.profiles, groups = providerGroups(ps);
    return { counts: { providers: groups.length, models: ps.length, 'base-models': ps.length, pricing: ps.filter(p => p.inputPrice !== null).length, 'runtime-policies': ps.length }, platforms: groups.map(g => ({ ...platformRow(g), models: g.map(p => p.model) })), calls: s.runs.map(r => ({ created_at: r.createdAt, model: ps.find(p => p.id === r.profileId)?.model ?? r.profileId, status: r.status === 'unknown' ? 'pending_reconciliation' : r.status })), scope: '下方按当前作品已载入任务统计；一次任务可能包含多次模型调用，不代表全量 API 请求或供应商健康检测。' };
  }
  if (route === '/admin/model-catalog/status') {
    const s = await invokeCommand('app.snapshot');
    return { version: '本机配置', count: (s.savedProfiles ?? s.profiles).length, summary: { add: 0, update: 0, current: (s.savedProfiles ?? s.profiles).length, conflict: 0 }, providers_missing: 0, changes: [], captured_at: '实时读取本机配置，平台目录更新尚未接入' };
  }
  if (route === '/admin/analytics') {
    const s = await invokeCommand('app.snapshot');
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 30));
    const runs = s.runs.filter(r => Date.now() - Date.parse(r.createdAt) <= days * 86400000);
    const count = (value: string) => runs.filter(r => r.status === value).length;
    const byModel = new Map<string, number>();
    for (const r of runs) { const model = (s.savedProfiles ?? s.profiles).find(p => p.id === r.profileId)?.model ?? r.profileId; byModel.set(model, (byModel.get(model) ?? 0) + 1); }
    const buckets = new Map<string, number>();
    const hourly = url.searchParams.get('interval') === 'hour';
    for (const r of runs) { const label = new Date(r.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', ...(hourly ? { hour: '2-digit' } : {}) }); buckets.set(label, (buckets.get(label) ?? 0) + 1); }
    return { metrics: { dau: null, mau: null, total: runs.length, success_rate: null, avg_seconds: null, revenue: null, gpu: null }, growth: {}, notes: { generation: `统计当前作品已载入的 ${s.runs.length} 个任务，不包含未打开作品和更早历史。`, duration: '任务耗时和模型成功率未汇总，显示为 —。', gpu: '客户端调用远程模型，未采集本机 GPU 指标。', revenue: '平台收入服务尚未接入。' }, gpu: { available: false, devices: [] }, series: [...buckets].reverse().map(([label, total]) => ({ label, total, text: total, image: 0, video: 0, revenue: null, success_rate: null })), models: [...byModel].map(([name, value]) => ({ name, value })), users: { paid: 0, free: 0, new: 0, returning: 0 }, functions: [], prompt_topics: [], tasks: [...new Set(runs.map(r => r.status))].map(name => ({ name, value: count(name) })), workflow_capacity: { running: count('running'), limit: 1, queued: 0 }, latency: { P50: null, P90: null, P95: null } };
  }
  if (route === '/admin/quality-metrics') {
    const s = await invokeCommand('app.snapshot');
    return { adopted_characters: null, confirmed_chapters: s.project ? Object.values(s.project.chapters).filter(x => x === 'complete').length : 0, credits_per_1000_adopted_characters: null, editing_active_minutes: null, adopted_patch_proposals: s.runs.filter(r => r.accepted && r.mode === 'revision').length, pending_reconciliation: s.runs.filter(r => r.status === 'unknown').length, supplier_costs: [], unconfigured_supplier_requests: s.runs.filter(r => r.usage.cost === null).length, note: '章节数来自当前作品；历史费用、人工编辑时长和平台算力指标未汇总。' };
  }
  if (route === '/admin/system/themes') return { items: [], default: { name: '原管理后台', accent: '#d4ef68', background: '#161616', surface: '#202020', radius: 9, font: 'Arial, Microsoft YaHei, sans-serif', blocks: [] } };
  if (route === '/notifications') {
    const s = await invokeCommand('app.snapshot');
      const all = s.runs.filter(r => ['complete', 'awaiting_review', 'needs_repair', 'failed', 'unknown', 'paused', 'awaiting_input', 'awaiting_permission'].includes(r.status)).map(r => {
      const id = `${r.id}:${r.status}`;
      return { id, name: `${s.project?.title ?? '当前作品'} · ${r.stage}`, status: sessionStorage.getItem(`notice:${id}`) ? 'read' : 'unread', created_at: r.createdAt, data: { body: `任务状态：${r.status}。请到写作流程查看详情。` } };
    });
    const items = url.searchParams.get('unread_only') === 'true' ? all.filter(r => r.status === 'unread') : all;
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
    return { items: items.slice(offset, offset + limit), total: items.length, unread_count: all.filter(r => r.status === 'unread').length };
  }
  if (/\/history$/.test(route)) return { items: [] };
  if (['/admin/knowledge-services', '/admin/model-catalog-updates', '/admin/desktop/categories', '/auth/providers', '/admin/login-providers', '/admin/notification-deliveries'].includes(route)) return { items: [], total: 0 };
  if (route === '/admin/system/process-logs') {
    const page = await transport.api<{ items: any[] }>('logs?limit=500');
    return { source: '客户端管理操作', sources: ['客户端管理操作'], lines: page.items.map(x => `${x.at} ${x.source} ${x.command} ${x.status} ${x.durationMs}ms`).reverse(), truncated: true };
  }
  if (route === '/admin/me') return { user: { id: session.client.clientId, username: '本机作者', nickname: '本机管理员' } };
  const preview = referencePreview(route);
  if (preview !== undefined) return preview;
  throw new Error(unavailableMessage);
}
