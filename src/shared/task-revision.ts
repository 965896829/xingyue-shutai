import type { ProjectConfig, Run } from './types';

/** An author-requested new chapter candidate is distinct from resuming a request.
 * Call only after confirming the bound proposal; ordinary recovery keeps its counters. */
export function needsNewChapterCandidate(run: Run, limits: Pick<ProjectConfig, 'maxRounds' | 'maxTools'>) {
  return run.mode === 'stage' && run.stage === 'S10' && !!run.pipeline && !run.accepted &&
    !run.planning && !run.naming && !run.memoryRepair &&
    (run.rounds >= limits.maxRounds || run.toolCount >= limits.maxTools);
}
