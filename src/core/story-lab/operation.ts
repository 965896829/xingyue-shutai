import { labProseTarget, labHeadings, type LabGenerate, type LabOperation, type LabVersion } from '../../shared/story-lab';
import { numeral, parseChapterNumber } from '../../shared/chapter-range';
import type { LabStore } from './store';

const sectionNumber = new RegExp(`第\\s*(${numeral})\\s*([卷章])`, 'g');
function normalizeSectionNumbers(text: string) {
  return text.normalize('NFKC').replace(sectionNumber, (_, number: string, unit: string) => `第${parseChapterNumber(number)}${unit}`);
}

function expansionTarget(content: string, command: string): { end: number; newHeading?: LabOperation['newHeading'] } {
  const headings = labHeadings(content).map(h => ({ ...h, name: normalizeSectionNumbers(h.title) }));
  const numbers = [...new Set(command.match(/第\d+[卷章]/g))];
  const volume = numbers.find(n => n.endsWith('卷'));
  const chapter = numbers.find(n => n.endsWith('章'));
  const target = chapter ?? volume;
  const ambiguous = () => new Error('请写明要补充的卷章完整标题，或在方案里选中要修改的原文。');
  if (numbers.some(number => number !== volume && number !== chapter)) throw ambiguous();

  const volumes = volume ? headings.filter(h => h.name.includes(volume)) : [];
  const candidates = target ? headings.filter(h => h.name.includes(target) && (!volume || !chapter ||
    volumes.some(v => v.start <= h.start && h.start < v.end))) : headings;
  const named = candidates.filter(h => command.includes(h.name));
  const matches = named.length ? named : target ? candidates : [];
  if (matches.length === 1) return { end: matches[0].end };
  if (matches.length > 1) throw ambiguous();

  // A missing numbered section needs its own heading so it cannot become the last volume's body.
  const quoted = command.match(/「([^」\r\n]+)」/)?.[1];
  if (chapter && volume && volumes.length > 1) throw ambiguous();
  const parent = chapter && volume ? volumes[0] : undefined;
  const nested = parent && parent.level < 6;
  const numberedTitle = nested ? chapter : [volume, chapter].filter(Boolean).join(' ');
  const title = quoted && (!target || quoted.includes(target)) ? quoted : numberedTitle;
  return title ? { end: nested ? parent.end : content.length, newHeading: { title, level: nested ? parent.level + 1 : 1 } } : { end: content.length };
}

export function describeOperation(store: LabStore, input: LabGenerate, adoptedProse: string | null): LabOperation {
  const read = (id?: string | null) => id ? store.version(input.sessionId, id) : undefined;
  const base = read(input.baseVersionId);
  if (input.action === 'continue') {
    const source = read(input.sourceVersionId);
    if (!source?.operation) throw new Error('无法确定原始任务，请重新选择有生成记录的版本');
    if (!source.partial && source.operation.action === 'blueprint' && source.operation.scope === 'core')
      return { ...source.operation, scope: 'full', segment: 'tail' };
    return source.operation;
  }
  const prior = input.action === 'prose' ? read(input.previousProseId ?? adoptedProse) : undefined;
  const { proseMode, chapter } = labProseTarget(input.instruction, input.proseMode, prior ? prior.operation?.chapter ?? 1 : undefined, input.targetChapter);
  const previous = input.action === 'prose' && ['next', 'rewrite'].includes(proseMode) ? prior : undefined;
  if (input.action === 'prose' && ['next', 'rewrite'].includes(proseMode) && (!previous || previous.kind !== 'prose' || previous.partial))
    throw new Error('请先选择完整的前章正文版本，或选择独立试写。');
  const expansionCommand = input.action === 'expand' ? normalizeSectionNumbers(input.instruction) : '';
  const expansion = input.action === 'expand' && base && !input.selection ? expansionTarget(base.content, expansionCommand) : undefined;
  const selected = input.selection ?? (expansion && { start: expansion.end, end: expansion.end, text: '' });
  if (selected && (!base || selected.end < selected.start || selected.end > base.content.length || base.content.slice(selected.start, selected.end) !== selected.text))
    throw new Error('选区与基准版本不一致，请重新选择原文');
  if (input.action === 'expand' && (!base || base.partial || base.kind !== 'blueprint')) throw new Error('请先选择完整方案作为补充位置');
  return { rootRequestId: input.requestId, action: input.action, instruction: input.instruction, scope: input.blueprintScope,
    category: input.action === 'prose' ? 'prose' : input.action === 'discuss' ? 'discussion' : input.action === 'revise' ? 'replace' :
      input.action === 'expand' ? (/第\d+章/.test(expansionCommand) ? 'chapter' : /第\d+卷/.test(expansionCommand) ? 'volume' : 'insert') : 'full',
    baseId: base?.id ?? null, planId: base?.kind === 'prose' ? base.operation?.planId ?? null : base?.id ?? null,
    proseParentId: base?.kind === 'prose' ? base.id : previous?.id ?? adoptedProse,
    selected, ...(expansion?.newHeading && { newHeading: expansion.newHeading }),
    chapter: input.action === 'revise' ? base?.operation?.chapter : chapter, proseMode: input.action === 'prose' ? proseMode : undefined };
}

export function mergeLabFragment(operation: LabOperation, base: LabVersion | undefined, raw: string) {
  if (!operation.selected || !base) return raw;
  const { start, end, text } = operation.selected;
  if (base.content.slice(start, end) !== text) throw new Error('原始修改位置已变化');
  if (operation.action !== 'expand' || start !== end) return base.content.slice(0, start) + raw + base.content.slice(end);
  const before = base.content.slice(0, start), after = base.content.slice(end);
  const newline = base.content.includes('\r\n') ? '\r\n' : '\n';
  let fragment = raw;
  if (operation.newHeading) {
    const { title, level } = operation.newHeading;
    const first = labHeadings(raw)[0];
    const marker = '#'.repeat(level);
    fragment = first && !raw.slice(0, first.start).trim() && normalizeSectionNumbers(first.title).includes(normalizeSectionNumbers(title))
      ? raw.slice(0, first.start) + raw.slice(first.start).replace(/^#{1,6}/, marker)
      : `${marker} ${title}${newline}${newline}${raw}`;
  }
  const separator = (left: string, right: string) => {
    if (!left || !right) return '';
    const breaks = (left.match(/(?:\r?\n)+$/)?.[0] ?? '') + (right.match(/^(?:\r?\n)+/)?.[0] ?? '');
    const count = breaks.match(/\n/g)?.length ?? 0;
    return newline.repeat(Math.max(0, 2 - count));
  };
  return before + separator(before, fragment) + fragment + separator(fragment, after) + after;
}
