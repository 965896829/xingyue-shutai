import { labHeadings, type LabGenerate, type LabOperation, type LabVersion } from '../../shared/story-lab';
import { chapterSpan } from '../../shared/chapter-range';
import type { LabStore } from './store';

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
  const proseMode = input.proseMode ?? (/独立|单独试写/.test(input.instruction) ? 'independent' :
    /重写|重做/.test(input.instruction) ? 'rewrite' :
    /下一章|接着|紧接|继续写|续写/.test(input.instruction) ? 'next' :
    adoptedProse && chapterSpan(input.instruction) ? (chapterSpan(input.instruction)![0] === (read(adoptedProse)?.operation?.chapter ?? 1) ? 'rewrite' : 'next') : 'first');
  const previous = input.action === 'prose' && ['next', 'rewrite'].includes(proseMode) ? read(input.previousProseId ?? adoptedProse) : undefined;
  if (input.action === 'prose' && ['next', 'rewrite'].includes(proseMode) && (!previous || previous.kind !== 'prose' || previous.partial))
    throw new Error('请先选择完整的前章正文版本，或选择独立试写。');
  const headings = input.action === 'expand' && base ? labHeadings(base.content) : [];
  const name = input.instruction.match(/第[零〇一二两三四五六七八九十百千\d]+[卷章]/)?.[0];
  const heading = headings.find(h => input.instruction.includes(h.title)) ?? (name && headings.find(h => h.title.includes(name)));
  const insertion = heading ? heading.end : base?.content.length ?? 0;
  const selected = input.selection ?? (input.action === 'expand' && base ? { start: insertion, end: insertion, text: '' } : undefined);
  if (selected && (!base || selected.end < selected.start || selected.end > base.content.length || base.content.slice(selected.start, selected.end) !== selected.text))
    throw new Error('选区与基准版本不一致，请重新选择原文');
  if (input.action === 'expand' && (!base || base.partial || base.kind !== 'blueprint')) throw new Error('请先选择完整方案作为补充位置');
  const chapter = input.targetChapter ?? (proseMode === 'next' ? (previous?.operation?.chapter ?? 1) + 1 :
    proseMode === 'rewrite' ? previous?.operation?.chapter ?? 1 : chapterSpan(input.instruction)?.[0] ?? 1);
  return { rootRequestId: input.requestId, action: input.action, instruction: input.instruction, scope: input.blueprintScope,
    category: input.action === 'prose' ? 'prose' : input.action === 'discuss' ? 'discussion' : input.action === 'revise' ? 'replace' :
      input.action === 'expand' ? (name?.endsWith('卷') ? 'volume' : name?.endsWith('章') ? 'chapter' : 'insert') : 'full',
    baseId: base?.id ?? null, planId: base?.kind === 'prose' ? base.operation?.planId ?? null : base?.id ?? null,
    proseParentId: base?.kind === 'prose' ? base.id : previous?.id ?? adoptedProse,
    selected, chapter: input.action === 'revise' ? base?.operation?.chapter : chapter, proseMode: input.action === 'prose' ? proseMode : undefined };
}

export function mergeLabFragment(operation: LabOperation, base: LabVersion | undefined, raw: string) {
  if (!operation.selected || !base) return raw;
  const { start, end, text } = operation.selected;
  if (base.content.slice(start, end) !== text) throw new Error('原始修改位置已变化');
  if (operation.action !== 'expand' || start !== end) return base.content.slice(0, start) + raw + base.content.slice(end);
  const before = base.content.slice(0, start), after = base.content.slice(end);
  return before + (before && !before.endsWith('\n\n') ? '\n\n' : '') + raw + (after && !raw.endsWith('\n\n') ? '\n\n' : '') + after;
}
