import type { TextSlice } from './context-slices';
import { parseCharacterCards } from './manuscript-view';

const labels = new Set(['说话风格', '做事风格', '语言习惯', '口吻', '对话风格', '语言风格']);

/** Only copy exact voice/behaviour lines for characters named by this task.
 * Secrets, future plot, state ledgers and embedded fact blocks are not voice rules. */
export function characterVoiceSlice(content: string, query: string): TextSlice | undefined {
  const visible: { plain: string; start: number; end: number }[] = [];
  let offset = 0, fence = '';
  for (const line of content.split(/(?<=\n)/)) {
    const plain = line.replace(/\r?\n$/, '');
    if (/<!--\s*wenxu-facts:v1\s*-->/.test(plain)) break;
    const boundary = plain.match(/^\s*(`{3,}|~{3,})/);
    const end = offset + Array.from(line).length;
    if (boundary) {
      if (!fence) fence = boundary[1];
      else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = '';
      offset = end; continue;
    }
    if (fence) { offset = end; continue; }
    visible.push({ plain, start: offset, end });
    offset = end;
  }
  const cards = parseCharacterCards({ path: '', hash: '', content: visible.map(line => line.plain).join('\n'), track: 'saved' });
  const selected = cards.filter(card => [card.name, ...card.aliases, card.id].some(name => name.length >= 2 && query.includes(name)));
  const headings = new Map(selected.map(card => [card.source.quote, new Set(card.fields.filter(field => labels.has(field.label)).map(field => field.source.quote))]));
  const ranges: TextSlice['ranges'] = [];
  let current: Set<string> | undefined;
  for (const { plain, start, end } of visible) {
    if (/^#{2,3}\s/.test(plain)) current = headings.get(plain);
    if (current?.size && (headings.has(plain) || current.has(plain))) {
      const previous = ranges.at(-1);
      if (previous?.end === start) previous.end = end; else ranges.push({ start, end });
    }
  }
  if (!ranges.length) return;
  const chars = Array.from(content);
  return { content: ranges.map(range => chars.slice(range.start, range.end).join('')).join('\n'), ranges, omitted: true };
}
