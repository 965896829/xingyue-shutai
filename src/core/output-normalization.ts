import type { Change } from '../shared/types';
import { normalizeSkillNotation } from './skill-output-contract';

export const scoreFields = ['开头有效性', '强度与章节功能匹配', '主角主动性', '阅读回报', '设定使用', '状态变化', '人物一致性', '节奏可读性', '留白与非总结化', '章末牵引'];
function fields(content: string) {
  let fence = '';
  return content.split(/\r?\n/).flatMap((line, index) => {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; return []; }
    if (fence) return [];
    const match = line.match(/^ {0,3}[-*+]\s+(?:\*\*)?([^：:\r\n]+?)(?:\*\*)?[：:]\s*(.*)$/);
    return match ? [{ index, indent: line.match(/^ */)![0], label: match[1].replace(/\*\*/g, '').trim(), value: match[2].replace(/^\*\*\s*/, '').trim() }] : [];
  });
}
function scoreParts(value: string, maximum: number) {
  // Parse the score independently of its editorial explanation. A complete
  // denominator/full-mark annotation still has to agree with the field scale.
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(分|[\/／]\s*(\d+)\s*分?)?\s*(.*)$/);
  if (!match || match[3] && Number(match[3]) !== maximum) return null;
  const suffix = match[4];
  let explanation = suffix;
  const fullMarks = explanation.match(/^(?:（满分\s*(\d+)\s*分?）|\(满分\s*(\d+)\s*分?\))\s*/);
  if (fullMarks) {
    if (Number(fullMarks[1] ?? fullMarks[2]) !== maximum) return null;
    explanation = explanation.slice(fullMarks[0].length);
  }
  // A dash followed by a number could be a score range, not an explanation.
  if (explanation) {
    const reason = explanation.match(/^([；;。：:]|——|—|–|--)(.*)$/);
    if (!reason && !(match[2] && /^[，,]/.test(explanation))) return null;
    if (reason && /^[—–-]/.test(reason[1]) && /^\s*\d/.test(reason[2])) return null;
  }
  const number = Number(match[1]);
  return Number.isFinite(number) && number <= maximum ? { score: number, suffix } : null;
}
export function declaredTotalScore(content: string): number | null {
  const totals = fields(content).filter(field => field.label === '总分');
  return totals.length === 1 ? scoreParts(totals[0].value, 100)?.score ?? null : null;
}
export function computedScore(content: string): number | null {
  const parsed = fields(content);
  let total = 0;
  for (const label of scoreFields) {
    const matches = parsed.filter(field => field.label === label);
    if (matches.length !== 1) return null;
    const value = scoreParts(matches[0].value, 10);
    if (value === null) return null;
    total += value.score;
  }
  return Math.round(total * 10) / 10;
}
/** Only generated structured Markdown is changed. Prose, fences and unknown fields are untouched. */
export function normalizeCandidate(change: Change, labels: readonly string[] = []): { change: Change; edits: string[] } {
  if (!change.path.endsWith('.md') || /(?:^|\/)07_正文章节\//.test(change.path)) return { change, edits: [] };
  const quality = /质量评分\.md$/.test(change.path);
  const allowed = new Set([...labels, ...(quality ? [...scoreFields, '总分'] : [])]);
  const lines = change.content.split(/\r?\n/), parsed = fields(change.content), edits: string[] = [];
  const total = quality ? computedScore(change.content) : null;
  for (const field of parsed) {
    if (!allowed.has(field.label) || parsed.filter(f => f.label === field.label).length !== 1) continue;
    let value = field.value;
    if (quality && scoreFields.includes(field.label)) {
      const score = scoreParts(value, 10);
      if (score === null) continue;
      value = `${score.score}/10${score.suffix}`;
    } else if (quality && field.label === '总分' && total !== null) {
      const score = scoreParts(value, 100);
      if (score !== null) value = `${total}/100${score.suffix}`;
    }
    const normalized = `${field.indent}- ${field.label}：${value}`;
    if (lines[field.index] !== normalized) { lines[field.index] = normalized; edits.push(field.label); }
  }
  const notation = normalizeSkillNotation(edits.length ? { ...change, content: lines.join(change.content.includes('\r\n') ? '\r\n' : '\n') } : change);
  return { change: notation.change, edits: [...edits, ...notation.edits] };
}
/** Remove an unambiguous transport wrapper only; never invent JSON or repair truncated data. */
export function normalizeToolArguments(raw: string): string {
  try { JSON.parse(raw); return raw; } catch { /* test a whole-document wrapper */ }
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  const candidate = fence ? fence[1] : trimmed;
  try { const value = JSON.parse(candidate); return value && typeof value === 'object' ? candidate : raw; } catch { return raw; }
}
