import type { Run, RunStatus } from '../../shared/types';
import { ApplicationError } from '../../shared/errors';

export const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  running: ['awaiting_review', 'needs_repair', 'paused', 'unknown', 'stale', 'failed', 'awaiting_input', 'awaiting_permission'],
  awaiting_review: ['running', 'needs_repair', 'paused', 'stale', 'complete', 'committing', 'discarded'],
  needs_repair: ['running', 'awaiting_review', 'paused', 'stale', 'discarded'],
  paused: ['running', 'unknown', 'awaiting_review', 'needs_repair', 'stale', 'discarded'],
  unknown: ['running', 'paused', 'awaiting_review', 'needs_repair', 'stale', 'discarded'],
  stale: ['discarded'], failed: ['running', 'discarded'],
  committing: ['complete', 'paused', 'unknown'],
  complete: [], discarded: [],
  awaiting_input: ['running', 'paused', 'stale', 'discarded'],
  awaiting_permission: ['running', 'paused', 'stale', 'discarded']
};
export function assertRunTransition(from: RunStatus, to: RunStatus) {
  if (from !== to && !runTransitions[from].includes(to))
    throw new ApplicationError('VERSION_CONFLICT', `任务状态不允许从 ${from} 变为 ${to}`, ['refresh']);
}
export function setRunStatus(run: Run, status: RunStatus) {
  assertRunTransition(run.status, status);
  run.status = status;
}
export function recoveryActions(run: Run) {
  if (run.executorVersion && run.checkpointVersion !== 1) return ['read'] as const;
  if (run.accepted || run.status === 'committing') return ['read', 'resume_local'] as const;
  if (run.status === 'unknown' || run.savedCandidateReview?.requestUnknown) return ['read', 'authorize_attempt', 'abandon'] as const;
  if (['complete', 'discarded', 'stale'].includes(run.status)) return ['read', 'create_successor'] as const;
  return ['read', 'resume', 'abandon'] as const;
}
