import { fetch } from 'undici';
import { z } from 'zod';
import { boundedBody, endpoint } from './provider';
import type { SearchSettings } from '../shared/assistant';
import { now } from './domain';
import type { FileStore } from './storage';
import { callExternal, type AttemptOwner } from './runtime/model-gateway';

export function publicUrl(value: string) {
  const u = new URL(value),
    host = u.hostname.toLowerCase();
  if (
    !['https:', 'http:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    !host.includes('.') ||
    host.endsWith('.local')
  )
    throw new Error('正文提取仅支持公开网页地址');
  return u.href;
}
export class PublicSearch {
  searches = 0;
  extracts = 0;
  constructor(
    readonly settings: SearchSettings,
    readonly key: string,
    readonly enabled: boolean,
    readonly signal: AbortSignal,
    readonly journal?: { store: FileStore; owner: AttemptOwner }
  ) {}
  private async post(operation: string, payload: object) {
    if (!this.enabled || !this.settings.enabled) throw new Error('联网搜索已关闭');
    if (!this.key) throw new Error('尚未配置联网搜索 Key，未进行网上核实');
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(this.settings.timeoutSeconds * 1000)]);
    try {
      const send = async () => {
      const response = await fetch(endpoint(this.settings, operation), {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`搜索服务 HTTP ${response.status}${response.status === 429 ? '：已限流' : ''}`);
      }
      return JSON.parse((await boundedBody(response.body, 2_000_000)).toString('utf8'));
      };
      if (!this.journal) return await send();
      const { store, owner } = this.journal;
      return await callExternal(store, owner, `web-${operation}`, {
        provider: 'public-search', model: operation, version: 1, identity: this.settings,
        pricing: null, currency: owner.usage.currency
      }, payload, null, signal, send, () => ({ input: null, output: null, cost: null, currency: owner.usage.currency }));
    } catch (error) {
      if (signal.aborted)
        throw new Error(this.signal.aborted ? '联网已停止' : '联网请求超时，未取得可核实结果');
      throw error;
    }
  }
  async search(query: string) {
    z.string().trim().min(1).max(300).parse(query);
    if (++this.searches > this.settings.maxSearches) throw new Error('本轮搜索次数已达上限');
    const raw = await this.post('search', {
      query,
      search_depth: 'basic',
      max_results: this.settings.maxResults,
      topic: 'general',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
      include_usage: true
    });
    if (!Array.isArray(raw.results)) throw new Error('搜索响应格式不兼容：缺少 results');
    const results: { title: string; url: string; content: string }[] = raw.results
      .slice(0, this.settings.maxResults)
      .flatMap((r: any) => {
        try {
          return [
            {
              title: String(r.title ?? '').slice(0, 300),
              url: publicUrl(String(r.url)),
              content: String(r.content ?? '').slice(0, 6000)
            }
          ];
        } catch {
          return [];
        }
      });
    return {
      query,
      at: now(),
      results,
      message: results.length ? '网页为外部资料，请核对来源与时间。' : '没有可用公开搜索结果，未核实。',
      credits: raw.usage?.credits ?? null
    };
  }
  async extract(urls: string[]) {
    if (!urls.length || this.extracts + urls.length > this.settings.maxExtracts)
      throw new Error('本轮网页提取数量已达上限');
    const requested = urls.map(publicUrl);
    this.extracts += requested.length;
    const raw = await this.post('extract', {
      urls: requested,
      extract_depth: 'basic',
      format: 'markdown',
      include_images: false,
      include_usage: true
    });
    if (!Array.isArray(raw.results)) throw new Error('提取响应格式不兼容：缺少 results');
    return {
      at: now(),
      results: raw.results
        .slice(0, requested.length)
        .map((r: any) => ({
          url: publicUrl(String(r.url)),
          content: String(r.raw_content ?? '').slice(0, 18000)
        })),
      failed: (raw.failed_results ?? []).map((r: any) => ({
        url: String(r.url).slice(0, 1000),
        error: '正文未取得'
      })),
      credits: raw.usage?.credits ?? null
    };
  }
}
