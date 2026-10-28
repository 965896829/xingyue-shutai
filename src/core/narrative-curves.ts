import type { FileStore } from './storage';
import type { Run } from '../shared/types';
import type { SourceRef } from '../shared/studio';
import { detailPath, prosePath, paths } from './domain';
import { chapterIntensity, tableIntensities, narrativeRecordSchema, narrativeEventRecordSchema, type NarrativeData, type NarrativeRecord } from '../shared/narrative-curve';
import { visibleNarrativeEvents } from '../shared/narrative-events';
import { narrativePlan } from '../shared/narrative-playback';
import { dimensions } from '../shared/studio';

const key = (kind: string, chapter: number, digest: string) => `narrative:${kind}:${chapter}:${digest}`;
export function ownsNarrativeSource(store: FileStore, source: SourceRef): boolean {
  const plan = source.path.match(/^06_章节设计\/第(\d+)章细纲\.md$/), actual = source.path.match(/^07_正文章节\/第(\d+)章\.md$/);
  if (!plan && !actual) return false;
  if (actual) {
    const events = narrativeEventRecordSchema.safeParse(store.db.get(key('events', Number(actual[1]), source.hash)));
    if (events.success && events.data.source.path === source.path && events.data.source.hash === source.hash && events.data.events.some(event => event.anchor === source.quote)) return true;
  }
  const record = narrativeRecordSchema.safeParse(store.db.get(key(plan ? 'plan' : 'actual', Number((plan ?? actual)![1]), source.hash)));
  return record.success && record.data.source.path === source.path && record.data.source.hash === source.hash && record.data.points.some(p => p.anchor === source.quote);
}

/** Display metadata is stored by the clean manuscript hash, outside Skill files. */
export function saveNarrativeEvents(store: FileStore, run: Run, content: string) {
  const state = run.pipeline?.narrative;
  if (!state || state.epoch !== run.pipeline?.epoch) return;
  const digest = store.putObject(content), events = visibleNarrativeEvents(state.events, content);
  store.db.set(key('events', run.chapter, digest), {
    version: 1, source: { path: prosePath(run.chapter), hash: digest, quote: events[0]?.anchor ?? '' }, events
  });
}
export const narrativeInstruction = (actual: boolean) =>
  '可视化附带数据（不改变文件结构、不增加工具调用）：在本次已有 propose_changes 中可附 narrative:{points:[{label:"场面短名",strength:1,anchor:"来源中的准确原文"}]}。' +
  (actual ? '按正文先后给出3—12个关键场面的实际强度，anchor 为该场面中6—100字的唯一连续原句。' : '按细纲先后给各场面强度，anchor 为对应场面的准确标题（含“场面1”等编号）。') +
  '强度沿用1—5尺度：1平静/余波，2轻度变化，3明确推进，4强冲突或强烈情绪，5关键爆发；低谷正常，不是质量扣分。可在每点附values:{pressure,payoff,emotion,revelation,relationship}，分别表示压力、回报、情绪、揭示、关系的1—5级判断；narrative.chapterValues可附同样五维的全章判断。两者均可省略，不足以判断的维度留空。只描述已写内容，绝不为补曲线重发、重写或另写文档。';

function boundedValues(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined;
  const values = raw as Record<string, unknown>;
  const entries = dimensions.filter(d => Number.isInteger(values[d]) && Number(values[d]) >= 1 && Number(values[d]) <= 5).map(d => [d, values[d]]);
  return entries.length ? Object.fromEntries(entries) as NarrativeRecord['chapterValues'] : undefined;
}

/** Optional display metadata must never reject otherwise valid writing or consume repair rounds. */
export function saveNarrativeRecord(store: FileStore, run: Run, raw: unknown): boolean {
  const kind = run.stage === 'S09' && !run.pipeline ? 'plan' : run.pipeline?.phase === 'review' ? 'actual' : undefined;
  if (!kind || !raw || typeof raw !== 'object' || !Array.isArray((raw as any).points)) return false;
  const path = kind === 'plan' ? detailPath(run.chapter) : prosePath(run.chapter);
  const content = run.changes.find(c => c.path === path)?.content;
  if (!content) return false;
  const scenes = kind === 'plan' ? narrativePlan(content).scenes : [];
  let previous = -1;
  const points: NarrativeRecord['points'] = [];
  for (const item of (raw as any).points.slice(0, 16)) {
    if (!item || typeof item.label !== 'string' || typeof item.anchor !== 'string' ||
      !Number.isInteger(item.strength) || item.strength < 1 || item.strength > 5 || item.label.length > 60 ||
      item.anchor.length < 4 || item.anchor.length > 200) continue;
    const anchor = kind === 'plan' ? item.anchor.trim().replace(/^#{2,4}\s*/, '') : item.anchor.trim(), offset = content.indexOf(anchor);
    if (offset < 0 || offset <= previous || content.indexOf(anchor, offset + 1) >= 0 ||
      kind === 'plan' && !scenes.some(scene => scene.title === anchor)) continue;
    const values = boundedValues(item.values);
    points.push({ label: item.label, strength: item.strength, anchor, ...(values && Object.keys(values).length ? { values } : {}) }); previous = offset;
  }
  if (!points.length) return false;
  const digest = store.putObject(content);
  store.db.set(key(kind, run.chapter, digest), { kind, chapter: run.chapter, source: { path, hash: digest, quote: '' },
    points, chapterValues: boundedValues((raw as any).chapterValues), rubric: 'intensity-1' } satisfies NarrativeRecord);
  return true;
}

// Parsed immutable artifacts are reused across navigation; never store project plaintext globally.
const parsed = new WeakMap<FileStore, Map<string, ReturnType<typeof tableIntensities>>>();
export function readNarrativeData(store: FileStore, chapter: number, runId?: string, scope: 'batch' | 'book' = 'batch'): NarrativeData {
  const project = store.db.project(), run = runId ? store.db.runs().find(r => r.id === runId && r.chapter === chapter) : undefined;
  const batch = project.batches.find(b => chapter >= b.start && chapter <= b.end);
  const range: [number, number] = scope === 'book' ? [1, 100000] :
    batch ? [batch.start, batch.end] : [Math.max(1, chapter - 14), chapter + 15];
  const result: NarrativeData = { chapter, chapters: [], range, unavailable: 0 };
  const byChapter = new Map<number, NarrativeData['chapters'][number]>();
  const row = (n: number) => { let value = byChapter.get(n); if (!value) { value = { chapter: n, plan: null, actual: null }; byChapter.set(n, value); } return value; };
  const documents = store.db.sql.prepare('SELECT path, hash FROM documents WHERE hash IS NOT NULL').all() as { path: string; hash: string }[];
  const cache = parsed.get(store) ?? new Map(); parsed.set(store, cache);
  const read = (path: string, digest: string) => {
    try { return { path, hash: digest, content: store.object(digest).toString('utf8') }; }
    catch { result.unavailable++; return undefined; }
  };
  for (const document of documents.sort((a, b) => Number(a.path !== paths.outline) - Number(b.path !== paths.outline))) {
    if (project.stale.includes(document.path)) continue;
    const dimensionChapter = document.path.match(/^(?:06_章节设计|07_正文章节)\/第(\d+)章(?:细纲)?\.md$/)?.[1];
    if (dimensionChapter && Number(dimensionChapter) >= range[0] && Number(dimensionChapter) <= range[1]) {
      const kind = document.path.startsWith('06_') ? 'plan' : 'actual';
      const record = narrativeRecordSchema.safeParse(store.db.get(key(kind, Number(dimensionChapter), document.hash)));
      if (record.success && record.data.chapterValues) Object.assign(row(Number(dimensionChapter)), {
        [kind === 'plan' ? 'planValues' : 'actualValues']: record.data.chapterValues,
        [kind === 'plan' ? 'planSource' : 'actualSource']: { ...record.data.source, quote: record.data.points[0].anchor }
      });
    }
    if (document.path === paths.outline || /^05_长篇大纲\/第\d+-\d+章节奏\.md$/.test(document.path)) {
      let values = cache.get(document.hash);
      if (!values) { const doc = read(document.path, document.hash); if (!doc) continue; values = tableIntensities(doc.content); cache.set(document.hash, values); }
      for (const point of values) if (point.chapter >= range[0] && point.chapter <= range[1] && point.strength !== null) {
        Object.assign(row(point.chapter), { plan: point.strength, planSource: { ...document, quote: point.quote } });
      }
    }
    const number = document.path.match(/^08_章后更新\/第(\d+)章记忆更新\.md$/)?.[1];
    if (number && Number(number) >= range[0] && Number(number) <= range[1]) {
      const doc = read(document.path, document.hash), value = doc && chapterIntensity(doc.content);
      if (value) Object.assign(row(Number(number)), { actual: value.strength, actualSource: { ...document, quote: value.quote } });
    }
  }
  if (cache.size > 512) for (const digest of [...cache.keys()].slice(0, cache.size - 512)) cache.delete(digest);
  const detail = detailPath(chapter), bound = run?.manifest?.sources.find(s => s.path === detail);
  const detailHash = bound?.hash ?? store.db.document(detail)?.hash;
  if (detailHash && !project.stale.includes(detail)) {
    result.detail = bound?.mode === 'full' ? { path: detail, hash: bound.hash, content: bound.content } : read(detail, detailHash);
    const value = result.detail && chapterIntensity(result.detail.content);
    if (value) Object.assign(row(chapter), { plan: value.strength, planSource: { path: detail, hash: detailHash, quote: value.quote } });
    const plan = narrativeRecordSchema.safeParse(store.db.get(key('plan', chapter, detailHash)));
    if (plan.success) result.plan = plan.data;
  }
  const prose = prosePath(chapter), digest = run?.pipeline?.proseHash ?? (run?.pipeline?.phase === 'prose' ? undefined : store.db.document(prose)?.hash);
  if (digest) {
    const events = narrativeEventRecordSchema.safeParse(store.db.get(key('events', chapter, digest)));
    if (events.success) result.eventRecord = events.data;
    const actual = narrativeRecordSchema.safeParse(store.db.get(key('actual', chapter, digest)));
    if (actual.success) result.actual = actual.data;
    if (actual.success && actual.data.chapterValues && run?.pipeline && !run.accepted) Object.assign(row(chapter), {
      candidateValues: actual.data.chapterValues, candidateSource: { ...actual.data.source, quote: actual.data.points[0].anchor }
    });
    if (!run?.pipeline) result.savedProse = read(prose, digest);
  }
  result.chapters = [...byChapter.values()].sort((a, b) => a.chapter - b.chapter);
  if (scope === 'book') result.range[1] = Math.max(chapter, result.chapters.at(-1)?.chapter ?? 1, ...project.batches.map(b => b.end));
  return result;
}
