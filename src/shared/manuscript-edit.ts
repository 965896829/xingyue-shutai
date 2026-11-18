import { z } from 'zod';

export const manuscriptEditSchema = z.strictObject({
  projectId: z.string().min(1),
  path: z.string().regex(/^07_正文章节\/第\d+章\.md$/),
  mode: z.enum(['passage', 'chapter']),
  from: z.number().int().nonnegative(),
  original: z.string().max(120000),
  before: z.string().max(160),
  after: z.string().max(160),
  freeTrial: z.literal(true).optional(),
  suppliedOutline: z.string().trim().min(1).max(30000).optional()
});

export type ManuscriptEdit = z.infer<typeof manuscriptEditSchema>;

export function manuscriptTarget(projectId: string, path: string, text: string, range?: { from: number; to: number }): ManuscriptEdit {
  const from = range?.from ?? 0, to = range?.to ?? text.length;
  return { projectId, path, mode: range ? 'passage' : 'chapter', from, original: text.slice(from, to),
    before: text.slice(Math.max(0, from - 160), from), after: text.slice(to, to + 160) };
}

/** Apply only to the captured passage, including when a preceding edit moved it. */
export function replaceManuscriptPassage(text: string, target: ManuscriptEdit, replacement: string, basis?: string): string | null {
  if (target.mode === 'chapter') return text === target.original ? replacement : null;
  if (!target.original) return null;
  if (basis !== undefined && basis.slice(target.from, target.from + target.original.length) === target.original) {
    // Removing one of several identical passages can make either survivor look like the original.
    if (basis !== text && basis.indexOf(target.original) !== basis.lastIndexOf(target.original) &&
        text.split(target.original).length < basis.split(target.original).length) return null;
    const edit = changedRange(basis, text);
    let offset = target.from;
    if (basis !== text && edit.to <= offset) offset += edit.insert.length - (edit.to - edit.from);
    else if (basis !== text && edit.from < offset + target.original.length) return null;
    return text.slice(0, offset) + replacement + text.slice(offset + target.original.length);
  }
  const anchor = target.before + target.original + target.after;
  const start = text.indexOf(anchor);
  if (start < 0) return null;
  const from = start + target.before.length;
  if (text.indexOf(anchor, start + 1) >= 0) {
    // Two identical neighborhoods have no stable identity after an edit.
    return null;
  }
  return text.slice(0, from) + replacement + text.slice(from + target.original.length);
}

function changedRange(base: string, value: string) {
  let from = 0, to = base.length, end = value.length;
  while (from < to && from < end && base[from] === value[from]) from++;
  while (to > from && end > from && base[to - 1] === value[end - 1]) { to--; end--; }
  return { from, to, insert: value.slice(from, end) };
}

/** Reconcile the last shared text, a local edit and the latest streamed revision. */
export function mergeManuscript(base: string, local: string, incoming: string) {
  if (base === local || incoming === local) return { text: incoming, conflict: false };
  if (incoming === base) return { text: local, conflict: false };
  const author = changedRange(base, local), ai = changedRange(base, incoming);
  const [first, last] = author.from < ai.from ? [author, ai] : [ai, author];
  if (first.to > last.from || first.from === last.from)
    return { text: local, conflict: true };
  return { text: base.slice(0, first.from) + first.insert + base.slice(first.to, last.from) +
    last.insert + base.slice(last.to), conflict: false };
}

function writingDirective(instruction: string) {
  const text = instruction.trim();
  if (/[?？]\s*$/.test(text)) return;
  const command = text.replace(/^(?:请|帮我|给我|直接|现在|先|开始|继续|\s)+/, '')
    .replace(/^(?:按照?|根据|接着|紧接)(?:上章|前章|上一章|本章|现有|当前|已有|给定)(?:的)?(?:结尾|细纲|大纲|安排|原文|剧情|要求)[，,、\s]*/, '');
  return command.match(/^(?:(?:请|帮我|给我|直接|现在|先|开始|继续)\s*)*(?:写|续写|撰写|重写|生成|试写|扩写)(?:一下|一版|一段|出)?\s*(第([零〇一二两三四五六七八九十百千\d]+)章|本章|这[一]?章|下一章|正文|章节正文)/);
}
export function requestsManuscript(instruction: string) {
  return !!writingDirective(instruction);
}

export function requestedChapter(instruction: string, current: number): number {
  const match = writingDirective(instruction);
  if (!match) return current;
  if (match[1] === '下一章') return current + 1;
  if (!match[2]) return current;
  const literal = match[2].replaceAll('两', '二').replaceAll('〇', '零');
  const digits = '零一二三四五六七八九';
  if (/^\d+$/.test(literal)) return Number(literal) || current;
  if (![...literal].some(c => '十百千'.includes(c))) return Number([...literal].map(c => digits.indexOf(c)).join('')) || current;
  let total = 0, digit = 0;
  for (const c of literal) {
    const unit = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[c];
    if (unit) { total += (digit || 1) * unit; digit = 0; }
    else digit = Math.max(0, digits.indexOf(c));
  }
  return total + digit || current;
}
