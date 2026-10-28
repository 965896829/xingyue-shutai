import type { Run } from '../../shared/types';
import { planCandidateRepair, planningRepairPointers } from './candidate-repair';
import { legacyErrorCode } from '../../shared/errors';
import { id, prosePath } from '../domain';

/** Author feedback is a new candidate revision, not a replay of a completed pipeline. */
export function prepareAuthorRevision(run: Run, instruction: string) {
  if (instruction.trim()) run.request += `\n\n作者本轮修改意见（修改当前候选，保留无关内容）：${instruction}`;
  run.messages = [];
  run.candidateWrites = {};
  run.repairScope = undefined;
  run.memoryReview = undefined;
  run.memoryCompletionHash = undefined;
  run.futurePlanReview = undefined;
  run.repairAttempts = {};
  if (run.pipeline) {
    run.pipeline.phase = 'prose';
    run.pipeline.proseHash = undefined;
    run.pipeline.epoch = id();
    run.pipeline.version++;
    run.pipeline.narrative = undefined;
    run.sourceProseHash = undefined;
    run.proseReviewFeedback = undefined;
    run.changes = run.changes.filter(change => change.path === prosePath(run.chapter));
    run.facts = [];
  }
  // Total model/tool/cost budgets deliberately remain unchanged.
}

/** Only complete, paired history is reusable; interrupted tool dispatch is not replayed here. */
function pairedHistory(run: Run) {
  const pending = new Set<string>(), seen = new Set<string>();
  for (const message of run.messages) {
    if (message.role === 'tool') {
      if (!message.callId || !pending.delete(message.callId)) return false;
    } else {
      if (pending.size) return false;
      for (const call of message.calls ?? []) {
        if (!call.id || seen.has(call.id)) return false;
        seen.add(call.id); pending.add(call.id);
      }
    }
  }
  return pending.size === 0;
}

/** Called only after an explicit recovery request; never refreshes the task's total budget. */
export function prepareRunRecovery(run: Run) {
  const failure = run.failure?.code ?? legacyErrorCode(run.error ?? '');
  // Missing outputs are expected after a transport interruption, not a reason
  // to erase the model's previous proposal and its exact validation feedback.
  // Source/rule freshness and request authorization are checked by the caller.
  if (['REMOTE_RESULT_UNKNOWN', 'NETWORK_UNAVAILABLE', 'RATE_LIMITED'].includes(failure) && pairedHistory(run)) return;
  const planning = run.planning;
  if (planning) {
    planning.consecutiveFormatFailures = 0;
    // Legacy direction-review checkpoints are completed locally by the planning
    // executor. Only the selected full plan can enter semantic repair.
    const receipt = planning.phase === 'reviewing_contract' ? planning.contractReview : undefined;
    if (receipt?.result.issues.some(i => i.severity !== 'minor')) {
      planning.repair = { phase: 'contract', original: structuredClone(planning.candidate!), pointers: planningRepairPointers(planning, false) };
      planning.history.push({ kind: 'contract', value: structuredClone(planning.repair.original) });
      planning.phase = planning.repair.phase;
      planning.semanticRevisions = 0;
    }
    run.messages = [];
  } else if (run.naming) {
    run.naming.consecutiveFormatFailures = 0;
    run.messages = [];
  } else if (run.issues.some(i => i.severity === 'error' && i.code !== 'pipeline_pending')) {
    const phase = run.pipeline?.phase ?? 'stage';
    if (phase === 'review' && run.issues.some(i => i.severity === 'error' && (i.code === 'quality_rewrite' || i.code === 'review_finding')))
      (run.repairAttempts ??= {}).prose = 0;
    run.repairScope = planCandidateRepair(run, run.issues.filter(i => i.code !== 'pipeline_pending'), phase);
    (run.repairAttempts ??= {})[phase] = 0;
    for (const path of run.repairScope.paths) if (run.candidateWrites) delete run.candidateWrites[path];
    // Rebuild prompt from saved candidates; an incomplete tool batch is not replayed here.
    run.messages = [];
  }
}
