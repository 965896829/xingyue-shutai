import { z } from 'zod';
import { marketRequestSchema, marketEvidenceSchema, type MarketEvidence, type MarketRequest } from '../shared/market-evidence';
import type { PublishingSnapshot } from '../shared/publishing';
import { hash, now } from './domain';
import { fingerprint } from './runtime/canonical';
import { readPublicFanqie, verifyPublishingSnapshot } from './publishing';

export function parsePageState(html: string): unknown {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error('公开页面超过上限');
  const marker = /window\.__INITIAL_STATE__\s*=\s*/.exec(html);
  if (!marker) throw new Error('公开页面未包含可核验榜单');
  const start = marker.index + marker[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error('公开页面状态不完整');
}
const numeric = z.union([z.number().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)]).transform(Number);
const rankSchema = z.object({ rank: z.object({
  book_list: z.array(z.object({ bookId: z.string().regex(/^\d+$/), currentPos: z.number().int().positive(),
    read_count: numeric.nullish(), wordNumber: numeric.nullish(), creationStatus: z.string().nullish(),
    curent_category_id: numeric.optional()
  })).min(1).max(100), total_num: numeric.optional(), rankVersion: z.union([z.string(), z.number()]).optional(),
  defaultPage: z.number().optional()
}) });
export function parseRankPage(html: string, categoryId: string) {
  const rank = rankSchema.parse(parsePageState(html)).rank;
  if (rank.defaultPage !== undefined && rank.defaultPage !== 1) throw new Error('榜单分页不是首批样本');
  if (new Set(rank.book_list.map(v => v.bookId)).size !== rank.book_list.length || new Set(rank.book_list.map(v => v.currentPos)).size !== rank.book_list.length || rank.book_list.some(v => v.curent_category_id !== undefined && String(v.curent_category_id) !== categoryId)) throw new Error('榜单身份或分类不一致');
  const cutoff = html.replace(/<!--[\s\S]*?-->/g, '').match(/统计时间截止至\s*([\d\-/:. ]{8,30})</)?.[1].trim() ?? null;
  return { rank, cutoff };
}
export function detailTitle(html: string) {
  const raw = html.match(/<title\b[^>]*>([^<]{1,400})<\/title>/i)?.[1];
  if (!raw) return null;
  const text = raw.replace(/&quot;/g, '"').replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, hex, dec) => {
    const n = hex ? parseInt(hex, 16) : Number(dec); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/完整版在线.*$|在线免费阅读.*$|最新章节.*$/u, '').replace(/[_\s-]+番茄小说(?:官网)?.*$/u, '').replace(/^《|》$/gu, '').trim();
  return text && Array.from(text).length <= 160 && !/[\p{Co}\uFFFD\r\n]/u.test(text) ? text : null;
}
const finish = (data: Omit<MarketEvidence, 'id'>) => marketEvidenceSchema.parse({ id: fingerprint(data), ...data });
export function marketCacheKey(request: MarketRequest) {
  return fingerprint({ channel: request.channel, categoryId: request.categoryId, rankType: request.rankType, referenceCategoryId: request.referenceCategoryId });
}
export async function collectMarketEvidence(raw: MarketRequest, catalog: PublishingSnapshot, signal: AbortSignal,
  options: { enabled?: boolean; cached?: MarketEvidence; read?: (url: string, signal: AbortSignal) => Promise<string> } = {}) {
  const input = marketRequestSchema.parse(raw); verifyPublishingSnapshot(catalog);
  if (input.catalogId !== catalog.id) throw new Error('目录版本已改变');
  const get = (id: string) => catalog.options.find(o => o.channel === input.channel && o.group === 'reading.main' && o.platformId === id);
  const selected = get(input.categoryId), effective = get(input.referenceCategoryId ?? input.categoryId);
  if (!selected || !effective) throw new Error('请选择当前频道主分类');
  const category = (o: typeof selected) => ({ channel: o.channel, platformId: o.platformId, label: o.label });
  const matched = selected.id === effective.id ? 'exact' as const : 'nearby' as const;
  const entry = catalog.ranks.find(r => r.channel === input.channel && r.platformId === effective.platformId);
  const data: Omit<MarketEvidence, 'id'> = { status: 'unavailable', observedAt: now(), requested: category(selected), effective: entry ? category(effective) : null,
    rankType: input.rankType, match: entry ? matched : 'none', reason: '', board: null, samples: [], sampleSelections: [],
    limitations: ['仅采集公开榜单首批前六名，不代表完整榜单或平台总体。', '在读数据不是销量、点击率或书名效果；不推断首次发布时间。'] };
  if (options.enabled === false) return finish({ ...data, status: 'disabled', reason: '联网设置已关闭。' });
  if (!entry) return finish({ ...data, reason: '该频道分类没有对应榜单；可以明确选择同频道参考分类。' });
  const url = `https://fanqienovel.com/rank/${input.channel === 'male' ? 1 : 0}_${input.rankType === 'new_book' ? 1 : 2}_${effective.platformId}`;
  const read = options.read ?? readPublicFanqie;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  try {
    const html = await read(url, bounded), observedAt = now(), { rank, cutoff } = parseRankPage(html, effective.platformId);
    data.board = { url, sourceHash: hash(html), observedAt, statsCutoffRaw: cutoff, rankVersionRaw: rank.rankVersion == null ? null : String(rank.rankVersion), totalReported: rank.total_num ?? null, itemsFetched: rank.book_list.length, fullRankCoverage: rank.total_num !== undefined && rank.book_list.length === rank.total_num };
    const sampled = rank.book_list.slice(0, 6);
    for (let i = 0; i < sampled.length; i += 3) {
      const rows = await Promise.all(sampled.slice(i, i + 3).map(async row => {
        const url = `https://fanqienovel.com/page/${row.bookId}`;
        let title: string | null = null, titleSource: MarketEvidence['samples'][number]['titleSource'] = null;
        try { const html = await read(url, bounded); title = detailTitle(html); if (title) titleSource = { kind: 'official_book_detail_title', sourceHash: hash(html), observedAt: now() }; } catch { signal.throwIfAborted(); }
        return { id: `sample-${row.bookId}`, bookId: row.bookId, title, titleSource, url, rankPosition: row.currentPos,
          readCount: row.read_count == null ? null : { value: row.read_count, sourceField: 'rank.book_list[].read_count' as const },
          wordCount: row.wordNumber ?? null, statusRaw: row.creationStatus ?? null, firstPublishedAt: null,
          missing: ['首次发布时间未知', ...(!title ? ['书页标题未核验'] : []), ...(row.read_count == null ? ['在读数据未知'] : [])] };
      }));
      data.samples.push(...rows);
    }
    signal.throwIfAborted();
    data.sampleSelections = data.samples.filter(s => s.title).map(s => ({ sampleId: s.id, relation: matched, reason: matched === 'exact' ? '同频道同分类的公开榜单样本' : `作者选用${effective.label}作近邻参考，未匹配原分类${selected.label}` }));
    data.status = data.samples.every(s => s.title) ? 'ready' : 'partial';
    data.reason = data.status === 'ready' ? '已核验所采集样本的书页标题。' : '保留已取得的榜单数据；未核验的标题不进入命名输入。';
    return finish(data);
  } catch (error) {
    signal.throwIfAborted();
    const cached = options.cached && marketEvidenceSchema.parse(options.cached);
    if (cached?.board && cached.requested.channel === input.channel && cached.requested.platformId === input.categoryId && cached.effective?.platformId === effective.platformId && cached.rankType === input.rankType && cached.samples.some(s => s.title)) {
      const { id, ...prior } = cached;
      return finish({ ...prior, status: 'stale', reason: '本次读取失败，使用明确标注观察日期的既有样本。' });
    }
    return finish({ ...data, reason: `公开榜单暂不可用：${error instanceof Error ? error.message : '读取失败'}` });
  }
}
