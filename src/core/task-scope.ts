import type { ProjectState, Run } from '../shared/types';
import type { FileStore } from './storage';
import { estimatedChapters } from './domain';
import { writingScope } from './memory-studio';

export function targetBatch(project: ProjectState, chapter: number) {
  if (!Number.isSafeInteger(chapter) || chapter < 1) throw new Error('目标章节无效');
  const recorded = project.batches.find(batch => batch.start <= chapter && batch.end >= chapter);
  if (recorded) return recorded;
  const prior = project.batches.filter(batch => batch.end < chapter).sort((a, b) => b.end - a.end)[0];
  const base = prior ? prior.end + 1 : 1;
  const start = base + Math.floor((chapter - base) / project.config.batchSize) * project.config.batchSize;
  const end = Math.min(estimatedChapters(project.config), start + project.config.batchSize - 1);
  if (end < chapter) throw new Error('目标章节超出当前作品计划范围，请先调整篇幅');
  return { id: `target-${start}-${end}`, start, end, sizeAtCreation: project.config.batchSize };
}

/** A task view never moves the author's saved writing progress. */
export function projectForRun(project: ProjectState, run: Pick<Run, 'chapter' | 'stage' | 'taskScope'>): ProjectState {
  const batch = targetBatch(project, run.chapter);
  if (run.taskScope && (run.taskScope.memory.chapter !== run.chapter ||
      run.taskScope.memory.projectId !== project.id || run.taskScope.branchId !== 'main' ||
      run.taskScope.batch.start !== batch.start || run.taskScope.batch.end !== batch.end))
    throw new Error('任务章节或批次范围已改变，请重新建立当前任务上下文');
  return { ...project, chapter: run.chapter, stage: run.stage,
    batches: project.batches.some(value => value.id === batch.id) ? project.batches : [...project.batches, batch] };
}

export function bindTaskScope(store: FileStore, run: Run) {
  const project = store.db.project(), batch = targetBatch(project, run.chapter);
  run.batch = { ...batch };
  run.taskScope = { version: 1, branchId: 'main', sourceSnapshotId: run.baseSnapshotId,
    sourceRevision: run.baseRevision, batch: { ...batch },
    memory: { ...writingScope({ ...project, chapter: run.chapter }), projectId: project.id } };
}
