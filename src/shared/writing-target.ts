import type { Batch, ProjectState } from './types';

/** Resolve the requested chapter against registered batches and accepted outlines, without changing progress. */
export function writingTarget(project: ProjectState, chapter: number, paths: string[], allowBeyondPlan = true) {
  if (!Number.isSafeInteger(chapter) || chapter < 1) throw new Error('目标章号无效');
  const known = project.batches.find(b => b.start <= chapter && chapter <= b.end);
  const ranges = paths.flatMap(path => {
    const match = /^(?:06_章节设计\/第(\d+)-(\d+)章细纲|05_长篇大纲\/第(\d+)-(\d+)章节奏)\.md$/.exec(path);
    if (!match) return [];
    const start = Number(match[1] ?? match[3]), end = Number(match[2] ?? match[4]);
    return start <= chapter && chapter <= end ? [{ start, end }] : [];
  });
  if (!known && new Set(ranges.map(r => r.start + '-' + r.end)).size > 1)
    throw new Error('目标章节对应多份相互重叠的批次资料，请先核对章节范围');
  const size = project.config.batchSize;
  const previous = Math.max(0, ...project.batches.filter(b => b.end < chapter).map(b => b.end));
  const start = previous + 1 + Math.floor((chapter - previous - 1) / size) * size;
  if (!known && !allowBeyondPlan && chapter > Math.ceil(project.config.targetWords / project.config.chapterWords))
    throw new Error('目标章节超出当前作品计划范围，请先调整篇幅');
  const range = ranges[0] ?? { start, end: Math.max(chapter, Math.min(start + size - 1, Math.ceil(project.config.targetWords / project.config.chapterWords))) };
  const batch: Batch = known ?? { ...range, id: 'target-' + range.start + '-' + range.end, sizeAtCreation: ranges.length ? range.end - range.start + 1 : size };
  const num = (n: number) => String(n).padStart(3, '0');
  const tag = '第' + num(batch.start) + '-' + num(batch.end) + '章';
  return { chapter, batch, outline: '06_章节设计/第' + num(chapter) + '章细纲.md', batchOutline: '06_章节设计/' + tag + '细纲.md',
    rhythm: '05_长篇大纲/' + tag + '节奏.md' };
}
