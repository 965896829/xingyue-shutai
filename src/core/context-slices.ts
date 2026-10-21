export interface TextSlice { content: string; ranges: { start: number; end: number }[]; omitted: boolean }

function numberOf(text: string) {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0, value = 0;
  for (const char of text) {
    if (char in digits) value = digits[char];
    else if (char === '万') { total = (total + value) * 10000; value = 0; }
    else if (char in units) { total += (value || 1) * units[char]; value = 0; }
    else return NaN;
  }
  return total + value;
}
const numeral = '[零〇一二两三四五六七八九十百千万\\d]+';
export function chapterSpan(text: string, bare = false): [number, number] | undefined {
  const match = text.match(new RegExp(`第?\\s*(${numeral})\\s*章?\\s*[—–\\-~～至到]\\s*第?\\s*(${numeral})\\s*章`))
    ?? text.match(new RegExp(`第\\s*(${numeral})\\s*章`))
    ?? (bare ? text.trim().match(new RegExp(`^第?\\s*(${numeral})(?:\\s*章?\\s*[—–\\-~～至到]\\s*第?\\s*(${numeral}))?\\s*章?$`)) : null);
  return match ? [numberOf(match[1]), numberOf(match[2] ?? match[1])] : undefined;
}

/** A chapter reference in a source/notes cell does not make that row a chapter plan. */
function tableChapterSpan(cells: string[], column: number) {
  const label = (cells[column >= 0 ? column : 0] ?? '').replace(/^[*_\x60]+|[*_\x60]+$/g, '').trim();
  if (/\.md(?:$|[\s#?])/i.test(label)) return undefined;
  const explicit = new RegExp(`^第?\\s*${numeral}\\s*(?:章|[—–\\-~～至到])`).test(label);
  const numbered = column >= 0 && new RegExp(`^${numeral}$`).test(label);
  return explicit || numbered ? chapterSpan(label, column >= 0) : undefined;
}

function selectLines(text: string, selected: boolean[]): TextSlice {
  const lines = text.split(/(?<=\n)/), ranges: TextSlice['ranges'] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = offset + Array.from(lines[i]).length;
    if (selected[i]) {
      const last = ranges.at(-1);
      if (last?.end === offset) last.end = end;
      else ranges.push({ start: offset, end });
    }
    offset = end;
  }
  const points = Array.from(text);
  return { content: ranges.map(r => points.slice(r.start, r.end).join('')).join('\n\n'), ranges, omitted: selected.some(v => !v) };
}

export function chapterSlice(text: string, chapter: number): TextSlice {
  const lines = text.split(/(?<=\n)/), selected: boolean[] = [];
  const sections: { level: number; included: boolean }[] = [];
  let tableColumn = -1, matched = false, recognized = false;
  for (const line of lines) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+)/);
    if (heading) {
      while (sections.length && sections.at(-1)!.level >= heading[1].length) sections.pop();
      const span = chapterSpan(heading[2]);
      if (span) { recognized = true; matched ||= span[0] <= chapter && chapter <= span[1]; }
      sections.push({ level: heading[1].length, included: (sections.at(-1)?.included ?? true) && (!span || (span[0] <= chapter && chapter <= span[1])) });
      tableColumn = -1;
    }
    let include = sections.at(-1)?.included ?? true;
    if (line.trim().startsWith('|')) {
      const cells = line.trim().split('|').slice(1, -1).map(c => c.trim());
      const header = cells.findIndex(c => /^(?:章节|章次|章号|章节范围|覆盖章节|起止章节|章节区间|章范围|覆盖章数)$/.test(c));
      if (header >= 0) tableColumn = header;
      else if (!cells.every(c => /^:?-+:?$/.test(c))) {
        const span = tableChapterSpan(cells, tableColumn);
        if (span) { recognized = true; matched ||= span[0] <= chapter && chapter <= span[1]; include &&= span[0] <= chapter && chapter <= span[1]; }
      }
    } else if (line.trim()) tableColumn = -1;
    selected.push(include);
  }
  if (!recognized || !matched) return { content: text, ranges: [{ start: 0, end: Array.from(text).length }], omitted: false };
  return selectLines(text, selected);
}

export function endingSlice(text: string, points = 1800): TextSlice {
  const chars = Array.from(text);
  if (chars.length <= points) return { content: text, ranges: [{ start: 0, end: chars.length }], omitted: false };
  let start = chars.length - points;
  const paragraph = chars.slice(start, start + 400).join('').indexOf('\n\n');
  if (paragraph >= 0) start += Array.from(chars.slice(start, start + 400).join('').slice(0, paragraph + 2)).length;
  else {
    const sentence = chars.slice(start, start + 200).findIndex(c => /[。！？]/.test(c));
    if (sentence >= 0) start += sentence + 1;
  }
  return { content: chars.slice(start).join(''), ranges: [{ start, end: chars.length }], omitted: true };
}

/** Recognized past chapter sections/rows are immutable during a forward-only adjustment. */
export function pastPlanText(text: string, fromChapter: number): string {
  const selected: string[] = [], sections: { level: number; past: boolean }[] = [];
  let tableColumn = -1;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+)/);
    if (heading) {
      while (sections.length && sections.at(-1)!.level >= heading[1].length) sections.pop();
      const span = chapterSpan(heading[2]);
      sections.push({ level: heading[1].length, past: (sections.at(-1)?.past ?? false) || !!span && span[1] < fromChapter });
      tableColumn = -1;
    }
    let past = sections.at(-1)?.past ?? false;
    if (line.trim().startsWith('|')) {
      const cells = line.trim().split('|').slice(1, -1).map(cell => cell.trim());
      const header = cells.findIndex(cell => /^(?:章节|章次|章号|章节范围|覆盖章节|起止章节|章节区间|章范围|覆盖章数)$/.test(cell));
      if (header >= 0) tableColumn = header;
      else {
        const span = tableChapterSpan(cells, tableColumn);
        past ||= !!span && span[1] < fromChapter;
      }
    } else if (line.trim()) tableColumn = -1;
    if (past && line.trim()) selected.push(line);
  }
  return selected.join('\n');
}
