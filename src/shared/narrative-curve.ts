import { z } from 'zod';
import type { SourceRef } from './studio';
import { narrativeEventSchema } from './narrative-events';

const sourceSchema = z.object({ path: z.string(), hash: z.string(), quote: z.string(), start: z.number().optional(), end: z.number().optional() });
const score = z.number().min(1).max(5).nullable().optional();
export const narrativeValuesSchema = z.object({ pressure: score, payoff: score, emotion: score, revelation: score, relationship: score });
export const curvePointSchema = z.object({ label: z.string(), strength: z.number().min(1).max(5), anchor: z.string(),
  values: narrativeValuesSchema.optional() });
export const narrativeRecordSchema = z.object({
  kind: z.enum(['plan', 'actual']), chapter: z.number().int().positive(), source: sourceSchema,
  points: z.array(curvePointSchema).max(16), chapterValues: narrativeValuesSchema.optional(), rubric: z.literal('intensity-1')
});
export type NarrativeRecord = z.infer<typeof narrativeRecordSchema>;
export const narrativeEventRecordSchema = z.object({ version: z.literal(1), source: sourceSchema, events: z.array(narrativeEventSchema).max(32) });
export const narrativeDataSchema = z.object({
  chapter: z.number().int().positive(),
  chapters: z.array(z.object({ chapter: z.number().int().positive(), plan: z.number().nullable(), actual: z.number().nullable(),
    planSource: sourceSchema.optional(), actualSource: sourceSchema.optional(), candidateSource: sourceSchema.optional(),
    planValues: narrativeValuesSchema.optional(), actualValues: narrativeValuesSchema.optional(), candidateValues: narrativeValuesSchema.optional() })),
  detail: z.object({ path: z.string(), hash: z.string(), content: z.string() }).optional(),
  plan: narrativeRecordSchema.optional(), actual: narrativeRecordSchema.optional(),
  eventRecord: narrativeEventRecordSchema.optional(),
  savedProse: z.object({ path: z.string(), hash: z.string(), content: z.string() }).optional(),
  range: z.tuple([z.number(), z.number()]), unavailable: z.number().int().nonnegative()
});
export type NarrativeData = z.infer<typeof narrativeDataSchema>;

/** Intensity is an existing 1–5 story scale, never a quality score. */
export function readIntensity(value: string): number | null {
  const text = value.replace(/[*`]/g, '').trim();
  if (/未评|未知|待定|待评|不适用|\/\s*10|\/\s*100/.test(text)) return null;
  const match = text.match(/^(?:强度\s*[：:]?\s*)?([1-5])(?:\s*\/\s*5)?(?:[级档。；;\s]|$)/)
    ?? text.match(/(?:强度|[（(])\s*[：:]?\s*([1-5])(?:\s*\/\s*5)?(?=[级档）)。；;\s]|$)/)
    ?? text.match(/(?:^|\D)([1-5])\s*\/\s*5(?!\d)/)
    ?? text.match(/(?:强冲突|推进|结算|日常|情绪|转场)[^\d\n]*?([1-5])(?=[级档。；;，、\s]|$)/);
  return match ? Number(match[1]) : null;
}
export function chapterIntensity(content: string): { strength: number; quote: string } | undefined {
  // Stop before scene headings: a scene score must not become a chapter score.
  const intro = content.split(/^#{2,4}\s*(?:场面|场景)\s*[一二三四五六七八九十\d]/m)[0];
  for (const line of intro.split(/\r?\n/)) {
    const match = line.replace(/[*`]/g, '').match(/(?:情节强度|本章强度|章节类型与强度|强度)\s*[：:]\s*(.+)/);
    if (match) { const strength = readIntensity(match[1]); if (strength !== null) return { strength, quote: line }; }
  }
}

export function tableIntensities(content: string): { chapter: number; strength: number | null; quote: string }[] {
  const out: ReturnType<typeof tableIntensities> = [];
  let chapterColumn = -1, strengthColumn = -1;
  for (const line of content.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) { chapterColumn = strengthColumn = -1; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.replace(/[*`]/g, '').trim());
    if (cells.some(c => /^(?:章节|章节单元|章次)$/.test(c))) {
      chapterColumn = cells.findIndex(c => /^(?:章节|章节单元|章次)$/.test(c));
      strengthColumn = cells.findIndex(c => /^(?:强度|情节强度|类型与强度曲线|类型与强度)$/.test(c)); continue;
    }
    if (chapterColumn < 0 || strengthColumn < 0 || /^:?-+:?$/.test(cells[0])) continue;
    const numbers = cells[chapterColumn]?.match(/^(?:第\s*)?(\d{1,5})\s*(?:[-—–~～至]\s*(\d{1,5}))?\s*章?(?:\s|$)/);
    if (!numbers) continue;
    const start = Number(numbers[1]), end = Number(numbers[2] ?? start);
    if (start < 1 || end < start || end - start > 120) continue;
    const raw = cells[strengthColumn] ?? '';
    // Only an explicitly written sequence supplies separate chapter values.
    const sequence = raw.replace(/[*`]/g, '').split(/\s*(?:→|->|、)\s*/).map(readIntensity);
    const named = new Map([...raw.matchAll(/(?:^|[；;])\s*(?:第)?(\d{1,5})(?:章)?([^；;。]*)/g)].map(m => [Number(m[1]), readIntensity(m[2])]));
    for (let chapter = start; chapter <= end; chapter++) out.push({ chapter,
      strength: start === end ? readIntensity(raw) : named.get(chapter) ?? (sequence.length === end - start + 1 ? sequence[chapter - start] : null), quote: line });
  }
  return out;
}

export interface CurveDatum { x: number; value: number | null; label: string; source?: SourceRef; note?: string; estimated?: boolean }
/** Horizontal-tangent cubic joins cannot overshoot ratings. Missing values split paths. */
export function curveSegments(points: { x: number; y: number | null }[], smooth = true): string[] {
  const paths: string[] = []; let current = '', previous: { x: number; y: number } | undefined;
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) { if (current) paths.push(current); current = ''; previous = undefined; continue; }
    if (!previous) current = `M ${point.x} ${point.y}`;
    else if (!smooth) current += ` L ${point.x} ${point.y}`;
    else { const mid = (previous.x + point.x) / 2; current += ` C ${mid} ${previous.y}, ${mid} ${point.y}, ${point.x} ${point.y}`; }
    previous = { x: point.x, y: point.y };
  }
  if (current) paths.push(current);
  return paths;
}

/** A dashed hold carries the latest observation to the displayed prose cursor, never into unwritten text. */
export function curveContinuation(points: { x: number; y: number | null }[], cursor: number): string | undefined {
  const last = points.at(-1);
  if (!last || last.y === null || !Number.isFinite(last.y) || !Number.isFinite(last.x) || !Number.isFinite(cursor) || cursor <= last.x) return;
  return `M ${last.x} ${last.y} L ${cursor} ${last.y}`;
}
