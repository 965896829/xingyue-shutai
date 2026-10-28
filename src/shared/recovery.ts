import { legacyErrorCode, type ErrorCode, type ErrorPayload } from './errors';
import type { Run } from './types';

export interface CandidateRepair {
  version?: 2;
  phase: string;
  paths: string[];
  protectedHashes: Record<string, string>;
  fingerprint: string;
  attempts: number;
  factIds?: string[];
  protectedFactHashes?: Record<string, string>;
  allowNewFacts?: boolean;
  unresolvedIssues?: { code: string; message: string }[];
}
export interface RecoveryDecision {
  code: ErrorCode;
  kind: 'resume' | 'settings' | 'author' | 'inspect' | 'none';
  label: string;
  detail: string;
  confirmation: boolean;
  setting?: 'maxRounds' | 'maxTools' | 'stageBudget' | 'model';
}
export function recoveryDecision(run: Pick<Run, 'status' | 'accepted' | 'error' | 'failure' | 'savedCandidateReview' | 'issues' | 'planning'>): RecoveryDecision {
  const code = run.failure?.code ?? (run.error ? legacyErrorCode(run.error) : run.issues?.some(i => i.severity === 'error') ? 'FORMAT_INVALID' : 'OPERATION_FAILED');
  const confirmation = run.status === 'unknown' || run.savedCandidateReview?.requestUnknown === true || code === 'REMOTE_RESULT_UNKNOWN';
  const base = { code, confirmation };
  if (run.accepted || ['running', 'discarded', 'committing', 'complete', 'awaiting_input', 'awaiting_permission'].includes(run.status))
    return { ...base, kind: 'none', label: '', detail: '' };
  if (['STORAGE_FAILURE', 'PROJECT_VERSION_UNSUPPORTED', 'PERMISSION_DENIED'].includes(code))
    return { ...base, kind: 'inspect', label: '查看需要处理的问题', detail: '需要先处理存储、版本或权限问题，当前内容已保留。' };
  const planning = run.planning;
  if (code !== 'AUTHOR_DECISION_REQUIRED' && planning?.report && (['reviewing_report', 'awaiting_direction'].includes(planning.phase) || planning.phase === 'planning' && planning.repair?.phase === 'planning'))
    return { ...base, kind: 'resume', label: confirmation ? '核对后查看已有方向' : '继续查看已有方向',
      detail: '旧版请求的记录会保留。恢复时只在本地检查并展示已保存的方向，不追加方向审核或自动修订。' };
  const setting = code === 'ROUND_LIMIT' ? 'maxRounds' : code === 'TOOL_LIMIT' ? 'maxTools' : ['BUDGET_EXCEEDED', 'BUDGET_UNCONFIRMED'].includes(code) ? 'stageBudget' : ['MODEL_CONFIGURATION', 'PROTOCOL_MISMATCH', 'RATE_LIMITED'].includes(code) ? 'model' : undefined;
  if (setting) return { ...base, kind: 'settings', label: '调整设置后继续', detail: '先核对对应设置，再从已保存的位置继续；不会自动提高限额。', setting };
  if (code === 'AUTHOR_DECISION_REQUIRED') return { ...base, kind: 'author', label: '查看待确认事项', detail: '涉及作品设定或修订影响，需要你决定后再继续。' };
  return { ...base, kind: 'resume', label: confirmation ? '核对后恢复任务' : '恢复任务', detail: confirmation ? '结果与费用尚未确认。恢复会发起新请求，可能重复计费。' : '先检查已保存内容；需要时只修复当前问题，保留通过检查的候选。' };
}
export function syncRunFailure(run: Run) {
  if (!run.error) { run.failure = undefined; return; }
  if (run.failure?.message === run.error.slice(0, 2000)) return;
  run.failure = { code: legacyErrorCode(run.error), message: run.error.slice(0, 2000), traceId: crypto.randomUUID(), actions: ['resume_local'] };
}
export function setFailure(owner: { error?: string; failure?: ErrorPayload }, failure: ErrorPayload) {
  owner.error = failure.message;
  owner.failure = failure;
}
