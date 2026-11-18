import type { ProjectState, Run } from '../shared/types';
import type { FileStore } from './storage';
import { writingTarget } from '../shared/writing-target';
import { writingScope } from './memory-studio';

export function targetBatch(project: ProjectState, chapter: number, documents: string[] = []) {
  return writingTarget(project, chapter, documents, false).batch;
}

/** A task view never moves the author's saved writing progress. */
export function projectForRun(project: ProjectState, run: Pick<Run, 'chapter' | 'stage' | 'taskScope'>): ProjectState {
  const bound = run.taskScope?.batch;
  const registered = project.batches.find(b => b.start <= run.chapter && run.chapter <= b.end);
  const batch = registered ?? (bound && bound.start <= run.chapter && run.chapter <= bound.end ? bound : targetBatch(project, run.chapter));
  if (run.taskScope && (run.taskScope.memory.chapter !== run.chapter ||
      run.taskScope.memory.projectId !== project.id || run.taskScope.branchId !== 'main' ||
      run.taskScope.batch.start !== batch.start || run.taskScope.batch.end !== batch.end))
    throw new Error('任务章节或批次范围已改变，请重新建立当前任务上下文');
  return { ...project, chapter: run.chapter, stage: run.stage,
    batches: project.batches.some(value => value.id === batch.id) ? project.batches : [...project.batches, batch] };
}

export function bindTaskScope(store: FileStore, run: Run) {
  const project = store.db.project(), batch = targetBatch(project, run.chapter, store.db.acceptedDocuments().map(d => d.path));
  run.batch = { ...batch };
  run.taskScope = { version: 1, branchId: 'main', sourceSnapshotId: run.baseSnapshotId,
    sourceRevision: run.baseRevision, batch: { ...batch },
    memory: { ...writingScope({ ...project, chapter: run.chapter }), projectId: project.id } };
}
