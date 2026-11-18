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
export const numeral = '[零〇一二两三四五六七八九十百千万\\d]+';
export function chapterSpan(text: string, bare = false): [number, number] | undefined {
  const match = text.match(new RegExp(`第?\\s*(${numeral})\\s*章?\\s*[—–\\-~～至到]\\s*第?\\s*(${numeral})\\s*章`))
    ?? text.match(new RegExp(`第\\s*(${numeral})\\s*章`))
    ?? (bare ? text.trim().match(new RegExp(`^第?\\s*(${numeral})(?:\\s*章?\\s*[—–\\-~～至到]\\s*第?\\s*(${numeral}))?\\s*章?$`)) : null);
  return match ? [numberOf(match[1]), numberOf(match[2] ?? match[1])] : undefined;
}

export function hasOutlineContent(text: string) {
  return text.split(/\r?\n/).some(line => {
    const value = line.trim().replace(/^[-*>]\s*/, '').replace(/^[^：:]{1,35}[：:]\s*/, '').trim();
    return value && !/^(?:#|\||<!--|待填|待定|暂无|示例|TODO|[-—]+$)/i.test(value) && !/^[^：:]{1,35}[：:]$/.test(value);
  });
}
export function hasChapterPlan(text: string, chapter: number) {
  const lines = text.split(/\r?\n/);
  return lines.some((line, i) => {
    const table = line.match(/^\s*\|\s*([^|]+?)\s*\|\s*(.+)/);
    const title = line.match(/^\s*(?:#{1,6}\s+|[-*]\s+)?(第[^：:|。\n]{1,20}章)(.*)/);
    const entry = table?.[1] ?? title?.[1];
    const span = entry && chapterSpan(entry.trim(), true);
    if (!span || span[0] !== chapter || span[1] !== chapter) return false;
    if (table) return table[2].split('|').some(value => hasOutlineContent(value));
    const body: string[] = [];
    for (let n = i + 1; n < lines.length && !/^\s*(?:#{1,6}\s+)?第.+?章/.test(lines[n]); n++) body.push(lines[n]);
    return hasOutlineContent(body.join('\n')) || !!title?.[2].replace(/^[：:\s]+/, '').trim();
  });
}
