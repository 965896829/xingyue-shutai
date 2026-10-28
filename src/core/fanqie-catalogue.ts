import { Agent, fetch } from 'undici';
import { hash, now } from './domain';
import type { VolumeCatalogue } from '../shared/volume-style';

export function fanqieBookUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['fanqienovel.com', 'www.fanqienovel.com'].includes(url.hostname) || !/^\/page\/\d+\/?$/.test(url.pathname)) return;
    return `https://fanqienovel.com${url.pathname.replace(/\/$/, '')}`;
  } catch { return; }
}

function textOf(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' } as Record<string, string>)[code.toLowerCase()] ?? match;
  }).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Read only the website's directory groups, never headings invented in a search summary. */
export function parseFanqieCatalogue(html: string, sourceUrl: string, checkedAt = now()): VolumeCatalogue | null {
  const url = fanqieBookUrl(sourceUrl);
  if (!url || Buffer.byteLength(html) > 2_500_000) return null;
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const title = textOf(clean.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const author = textOf(clean.match(/<span\b[^>]*class=["']author-name-text["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
  const start = clean.search(/<div\b[^>]*class=["']page-directory-content["']/i);
  if (!title || title.length > 160 || start < 0) return null;
  let depth = 0, end = -1;
  for (const match of clean.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (!depth) { end = start + match.index! + match[0].length; break; }
  }
  if (end < 0) return null;
  const categories = [...clean.matchAll(/<span\b[^>]*class=["']info-label-grey["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map(match => textOf(match[1])).filter(label => label.length <= 40).slice(0, 12);
  const synopsis = textOf(clean.match(/<div\b[^>]*class=["']page-abstract-content["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '').slice(0, 600);
  const volumes = [...clean.slice(start, end).matchAll(/<div\b[^>]*class=["']volume(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map(match => textOf(match[1]).replace(/共\s*\d+\s*章\s*$/, '').trim())
    .filter(name => {
      const label = name.replace(/^第[一二三四五六七八九十百零〇两\d]+卷\s*[:：.、-]?\s*/, '').trim();
      return label.length > 0 && label.length <= 100 && !/^(?:默认|正文(?:卷)?|作品相关|番外(?:卷|篇)?)$/.test(label);
    });
  // A lone named volume cannot demonstrate a naming sequence; don't substitute chapter titles.
  if (new Set(volumes).size < 2) return null;
  return { title, author, url, categories, synopsis, volumes: [...new Set(volumes)].slice(0, 12), checkedAt, contentHash: hash(html) };
}

export type CatalogueReader = (url: string, signal: AbortSignal, timeoutMs: number) => Promise<VolumeCatalogue | null>;

/** Bounded public GET, no cookies or API credentials, strict TLS and no redirect to another host. */
export const readFanqieCatalogue: CatalogueReader = async (sourceUrl, signal, timeoutMs) => {
  const url = fanqieBookUrl(sourceUrl);
  if (!url) throw new Error('非番茄官方作品详情页');
  const agent = new Agent({ connect: { rejectUnauthorized: true } });
  try {
    const response = await fetch(url, { dispatcher: agent, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(30_000, Math.max(1000, timeoutMs)))]),
      headers: { accept: 'text/html', 'user-agent': 'Wenxu/volume-reference' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel();
      throw new Error(`目录读取失败（HTTP ${response.status}）`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body!) {
      size += chunk.byteLength;
      if (size > 2_500_000) throw new Error('目录页面超过读取上限');
      chunks.push(chunk);
    }
    return parseFanqieCatalogue(Buffer.concat(chunks).toString('utf8'), url);
  } finally { await agent.destroy(); }
};
