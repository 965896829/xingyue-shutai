import { diff } from '@codemirror/merge';
import { chapterSpan } from '../shared/chapter-range';
import { memoryPaths } from './domain';
import type { TextSlice } from './context-slices';

export const isLedger = (file: string) => memoryPaths.some(path => path === file);

/** Preserve exact offsets for the shown rows. Old unrelated rows stay in the local ledger. */
export function ledgerMaterial(content: string, chapter: number, names: string[] = [], quotes: string[] = []): TextSlice {
  const body = content.split(/<!--\s*wenxu-facts:v1\s*-->/, 1)[0];
  const lines = body.split(/(?<=\n)/), anchors = names.filter(Boolean);
  const selected = new Set<number>(), related: number[] = [];
  let header = false, table = false, start = 0;
  const ranges: TextSlice['ranges'] = [];
  for (const [i, line] of lines.entries()) {
    if (!header && /^#\s/.test(line)) { header = true; selected.add(i); }
    if (!table && /^\s*\|/.test(line) && /^\s*\|\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      table = true; selected.add(i); selected.add(i + 1);
    }
    const span = chapterSpan(line);
    if (span && span[0] > chapter) continue;
    if (quotes.some(q => q && line.includes(q))) selected.add(i);
    else if (anchors.some(name => line.includes(name)) || span && chapter >= span[0] && chapter <= span[1]) related.push(i);
  }
  for (const index of related.slice(-24)) selected.add(index);
  const pieces: string[] = [];
  for (const [i, line] of lines.entries()) {
    const end = start + Array.from(line).length;
    if (selected.has(i)) { ranges.push({ start, end }); pieces.push(line); }
    start = end;
  }
  return { content: pieces.join(''), ranges, omitted: body.length !== content.length || selected.size < lines.length };
}

/** Send both sides of the actual change to an auditor, retaining full-file hashes for adoption. */
export function ledgerChange(before: string, after: string) {
  const chunks = diff(before, after).map(c => {
    const line = (s: string, start: number, end: number) => {
      const from = start === 0 ? 0 : s.lastIndexOf('\n', start - 1) + 1;
      const to = end > start && s[end - 1] === '\n' ? end : s.indexOf('\n', end);
      return s.slice(from, to < 0 ? undefined : to);
    };
    return { before: line(before, c.fromA, c.toA), after: line(after, c.fromB, c.toB) };
  });
  return { before: [...new Set(chunks.map(c => c.before))].join('\n'), after: [...new Set(chunks.map(c => c.after))].join('\n') };
}
