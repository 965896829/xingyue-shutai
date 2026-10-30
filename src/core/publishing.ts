import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Agent, fetch } from 'undici';
import { hash, paths, updateConfigDocument } from './domain';
import { fingerprint } from './runtime/canonical';
import {
  bookProfileSchema, emptyBookProfile, publishingGroups, publishingOptions, publishingSnapshotSchema,
  type BookProfile, type BookProfileState, type PublishingChannel, type PublishingSnapshot
} from '../shared/publishing';
import type { FileStore } from './storage';
import type { BookSpec } from '../shared/tags';
import type { Change } from '../shared/types';

export const bookProfilePath = '02_项目配置/创作与发布.md';
export function isPublishingConfigChange(store: FileStore, changes: Change[]) {
  const profile = changes.find(c => c.path === bookProfilePath), config = changes.find(c => c.path === paths.config);
  if (!profile || !config) return false;
  try {
    const next = structuredClone(store.db.project());
    next.config.genre = parseBookProfile(profile.content).profile.creativeGenres.join('、') || '未限定';
    return config.content === updateConfigDocument(store.readAccepted(paths.config).content, next);
  } catch { return false; }
}
export function verifyPublishingSnapshot(raw: unknown): PublishingSnapshot {
  const snapshot = publishingSnapshotSchema.parse(raw), { id, ...data } = snapshot;
  if (fingerprint(data) !== id) throw new Error('分类目录完整性检查失败');
  if (new Set(snapshot.options.map(o => o.id)).size !== snapshot.options.length) throw new Error('分类目录含重复身份');
  for (const channel of ['male', 'female'] as const) {
    const source = snapshot.sources.find(s => s.channel === channel);
    if (!source || source.url !== publishingUrl(channel)) throw new Error('分类目录来源不匹配');
    for (const group of publishingGroups)
      if (!snapshot.options.some(o => o.channel === channel && o.group === group)) throw new Error('分类目录不完整');
  }
  for (const option of snapshot.options)
    if (option.id !== `fanqie:public_library:${option.channel}:${option.group}:${option.platformId}`)
      throw new Error('分类身份与频道或来源不匹配');
  return snapshot;
}
export function bundledPublishingCatalog(skillRoot: string) {
  const root = path.join(skillRoot, 'platform');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'resources.lock.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(root, 'fanqie.json'), 'utf8');
  if (hash(raw) !== lock['fanqie.json']) throw new Error('番茄分类资源完整性检查失败');
  return verifyPublishingSnapshot(JSON.parse(raw));
}
export const publishingUrl = (channel: PublishingChannel) =>
  `https://fanqienovel.com/api/author/book/category_list/v0/?gender=${channel === 'male' ? 1 : 0}`;
const responseSchema = z.object({ code: z.literal(0), data: z.array(z.object({
  category_id: z.number().int().positive(), label: z.enum(['主分类', '主题', '角色', '情节']), name: z.string().trim().min(1).max(100)
})).min(4).max(2000) });
export function parsePublishingResponse(raw: unknown, channel: PublishingChannel, previous: PublishingSnapshot) {
  const data = responseSchema.parse(raw).data;
  const groups = { 主分类: 'reading.main', 主题: 'reading.theme', 角色: 'reading.role', 情节: 'reading.plot' } as const;
  const options = data.map(row => {
    const group = groups[row.label], platformId = String(row.category_id);
    const id = `fanqie:public_library:${channel}:${group}:${platformId}`;
    const prior = previous.options.find(o => o.id === id);
    return { id, platformId, group, channel, label: row.name,
      ...(prior?.legacyId ? { legacyId: prior.legacyId, conceptId: prior.conceptId } : {}) };
  });
  if (new Set(options.map(o => o.id)).size !== options.length) throw new Error('分类接口返回重复身份');
  for (const group of publishingGroups) {
    const count = options.filter(o => o.group === group).length;
    const prior = previous.options.filter(o => o.channel === channel && o.group === group).length;
    if (!count || count < Math.ceil(prior * 0.8)) throw new Error('分类返回数量明显减少，已保留原完整目录');
  }
  return options;
}
export async function readPublicFanqie(url: string, signal: AbortSignal) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://fanqienovel.com' || parsed.username || parsed.password || !/^\/(?:rank\/\d_\d_\d+|page\/\d+|api\/author\/book\/category_list\/v0\/)\/?$/.test(parsed.pathname)) throw new Error('来源不是受支持的番茄公开页面');
  const agent = new Agent({ connect: { rejectUnauthorized: true } });
  try {
    const response = await fetch(url, { dispatcher: agent, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), redirect: 'error', credentials: 'omit' });
    if (!response.ok) throw new Error(`分类接口暂不可用（${response.status}）`);
    if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('分类响应过大');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('分类接口没有返回内容');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 2_000_000) throw new Error('分类响应过大'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await agent.destroy(); }
}
export async function refreshPublishingCatalog(previous: PublishingSnapshot, signal: AbortSignal,
  read: (url: string, signal: AbortSignal) => Promise<string> = readPublicFanqie): Promise<PublishingSnapshot> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const responses = await Promise.all((['male', 'female'] as const).map(async channel => {
    const url = publishingUrl(channel), raw = await read(url, bounded), observedAt = new Date().toISOString();
    return { source: { channel, url, observedAt, hash: hash(raw) }, options: parsePublishingResponse(JSON.parse(raw), channel, previous) };
  }));
  bounded.throwIfAborted();
  const data = { observedAt: new Date().toISOString(), extractorVersion: 1 as const, sources: responses.map(r => r.source),
    options: responses.flatMap(r => r.options), ranks: previous.ranks, ranksObservedAt: previous.ranksObservedAt, source: 'refreshed' as const };
  return verifyPublishingSnapshot({ id: fingerprint(data), ...data });
}
export function resolveBookProfile(raw: unknown, snapshots: PublishingSnapshot[]) {
  const profile = bookProfileSchema.parse(raw);
  if (new Set(profile.creativeGenres).size !== profile.creativeGenres.length) throw new Error('创作题材不能重复');
  const catalog = profile.publishing ? snapshots.find(c => c.id === profile.publishing!.snapshotId) : null;
  if (profile.publishing && !catalog) throw new Error('找不到所选分类版本，请保留旧目录或重新选择');
  if (catalog) publishingOptions(profile, verifyPublishingSnapshot(catalog));
  return { profile, catalog: catalog ?? null };
}
export function renderBookProfile(profile: BookProfile, catalog: PublishingSnapshot | null) {
  const selected = catalog ? publishingOptions(profile, catalog) : [];
  const main = selected.find(o => o.group === 'reading.main');
  return `# 创作与发布\n\n- 创作题材：${profile.creativeGenres.join('、') || '暂不归类'}\n- 发布平台：${profile.publishing ? '番茄小说' : '暂未选择'}\n- 发布频道：${profile.publishing ? profile.publishing.channel === 'male' ? '男频' : '女频' : '未定'}\n- 发布主分类：${main?.label ?? '未定'}\n- 补充阅读标签：${selected.filter(o => o.group !== 'reading.main').map(o => o.label).join('、') || '无'}\n\n\`\`\`json wenxu-book-profile\n${JSON.stringify({ version: 1, profile, catalog })}\n\`\`\`\n`;
}
export function parseBookProfile(content: string) {
  const match = content.match(/```json wenxu-book-profile\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error('创作与发布资料格式无效，请恢复对应历史版本');
  const value = z.object({ version: z.literal(1), profile: bookProfileSchema, catalog: publishingSnapshotSchema.nullable() }).parse(JSON.parse(match[1]));
  const resolved = resolveBookProfile(value.profile, value.catalog ? [value.catalog] : []);
  if (content.replace(/\r\n/g, '\n').trim() !== renderBookProfile(resolved.profile, resolved.catalog).trim())
    throw new Error('分类展示与保存资料不一致，请通过题材与发布分类重新生成');
  return resolved;
}
export function bookProfileContext(content: string) {
  const { profile, catalog } = parseBookProfile(content);
  const selected = catalog ? publishingOptions(profile, catalog) : [];
  return JSON.stringify({ creativeGenres: profile.creativeGenres, publishing: profile.publishing ? {
    channel: profile.publishing.channel, main: selected.find(o => o.group === 'reading.main')?.label,
    tags: selected.filter(o => o.group !== 'reading.main').map(o => o.label), snapshotId: profile.publishing.snapshotId
  } : null, policy: '创作题材可混搭。发布分类仅作平台归类，不是世界规则，不得据此补入境界、金手指或其他设定。此处是当前选择，旧契约中的分类仅作历史来源。' });
}
export function readBookProfile(store: FileStore): BookProfileState {
  const doc = store.db.document(bookProfilePath);
  if (!doc?.hash) return { profile: emptyBookProfile(), catalog: null, baseHash: null, legacy: true };
  const resolved = parseBookProfile(store.readAccepted(bookProfilePath).content);
  return { ...resolved, baseHash: doc.hash, legacy: false };
}
export function publishingResearchSpec(store: FileStore, spec: BookSpec): BookSpec {
  const state = readBookProfile(store);
  if (state.legacy) return spec;
  return { ...spec, bookProfile: state.profile, publishingCatalog: state.catalog ?? undefined };
}
