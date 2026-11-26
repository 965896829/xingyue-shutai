import { recoveryDecision } from '../shared/recovery';
import type { Run } from '../shared/types';
import type { FileStore } from './storage';
import { prosePath } from './domain';

function modelRequest(store: FileStore, id: string) {
  const rows = store.db.sql.prepare('SELECT DISTINCT status FROM model_attempts WHERE run_id=?').all(id);
  if (rows.some(row => row.status === 'unknown' || row.status === 'dispatching')) return 'unknown';
  return rows.some(row => row.status === 'complete') ? 'sent' : 'not_sent';
}

export function runDiagnostic(store: FileStore, run: Run, authorAction?: string) {
  const recovery = recoveryDecision(run);
  const localAction = authorAction && ['run.accept','workbench.accept','run.update','document.save','draft.save'].includes(authorAction);
  const request = localAction ? 'not_sent' : modelRequest(store, run.id);
  const committed = !!store.db.sql.prepare('SELECT 1 FROM candidate_commits WHERE run_id=?').get(run.id) || run.accepted;
  const phase = run.pipeline?.phase ?? run.planning?.phase ?? run.stage;
  const action = authorAction ?? (run.selectedDraft ? 'draft.chapter' : run.memoryRepair ? 'memory.repair' : run.mode === 'manual' ? 'document.save' : 'run.start');
  return { action, phase, ...(run.error || run.issues.some(issue => issue.severity === 'error') ? { failureCode: recovery.code } : {}), formallyCommitted: committed,
    draftSaved: run.changes.some(change => change.path === prosePath(run.chapter) && !!change.content.trim()) ||
      !!(run.selectedDraft || run.pipeline?.proseHash || run.responseText?.trim() || run.documentDrafts?.length || run.mode === 'manual' && run.changes.length),
    modelRequest: request,
    nextStep: committed || authorAction === 'run.accept' || authorAction === 'workbench.accept' ? 'local' :
      request === 'unknown' || recovery.confirmation ? 'confirm_before_resend' :
      recovery.kind === 'settings' ? 'adjust_settings_locally' :
      run.status === 'awaiting_review' || recovery.kind === 'author' || recovery.kind === 'inspect' ? 'local' : 'resume_model' };
}

export function chatDiagnostics(store: FileStore) {
  return store.db.sql.prepare(`SELECT id,json_extract(data,'$.kind') AS kind,json_extract(data,'$.draftTask.kind') AS task,
    json_extract(data,'$.status') AS status,json_extract(data,'$.messageId') AS messageId
    FROM conversation_turns WHERE json_extract(data,'$.status') IN ('unknown','failed','stopped') ORDER BY rowid DESC LIMIT 100`).all().map(turn => {
    const message = store.db.sql.prepare("SELECT length(trim(json_extract(data,'$.content'))) AS chars FROM conversation_messages WHERE id=?").get(turn.messageId);
    const request = modelRequest(store, String(turn.id));
    return { id: turn.id, action: turn.task ? 'draft.write' : 'chat.send', phase: turn.task ?? turn.kind, status: turn.status,
      draftSaved: Number(message?.chars ?? 0) > 0, formallyCommitted: false, modelRequest: request,
      nextStep: request === 'unknown' ? 'confirm_before_resend' : message?.chars ? 'local' : 'resume_model' };
  });
}

export function savedActionFailures(store: FileStore) {
  // Use an allowlist of columns so an older event cannot include prose or provider messages in an export.
  return store.db.sql.prepare(`SELECT at,run_id AS runId,json_extract(data,'$.command') AS action,
    json_extract(data,'$.code') AS code,json_extract(data,'$.phase') AS phase,json_extract(data,'$.draftSaved') AS draftSaved,
    json_extract(data,'$.formallyCommitted') AS formallyCommitted,json_extract(data,'$.modelRequest') AS modelRequest,
    json_extract(data,'$.nextStep') AS nextStep FROM events WHERE kind='author-operation-failed' ORDER BY seq DESC LIMIT 100`).all();
}
