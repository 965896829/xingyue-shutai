import type { Run } from './types';
import { retryNeedsConfirmation } from './run-presentation';

export function runCapabilities(run: Run) {
  return {
    acceptsInstruction: !run.planning,
    canResume: !run.accepted && ['paused', 'unknown', 'needs_repair', 'awaiting_review', 'failed', 'stale'].includes(run.status)
  };
}

export function resumeArguments(run: Run, instruction: string) {
  return {
    id: run.id,
    retryUnknown: retryNeedsConfirmation(run),
    ...(runCapabilities(run).acceptsInstruction ? { instruction } : {})
  };
}
