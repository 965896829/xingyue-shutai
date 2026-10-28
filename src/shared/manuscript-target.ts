import type { ProjectState, Run } from './types';

/** A pending chapter stays in its task until accepted; opening its placeholder must not hide the draft. */
export function manuscriptDraft(runs: Run[], project: ProjectState, path: string): Run | undefined {
  if (!/^07_正文章节\/第\d+章\.md$/.test(path)) return undefined;
  return runs.find(run => run.projectId === project.id && run.pipeline && !run.accepted && !['discarded', 'stale'].includes(run.status) &&
    (run.basisRevision === undefined ? run.baseRevision : run.basisRevision) === project.revision &&
    run.changes.some(change => change.path === path && !!change.content.trim()));
}
