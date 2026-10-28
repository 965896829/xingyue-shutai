import { z } from 'zod';
import type { Run } from '../../shared/types';
import type { FileStore } from '../storage';
import { hash } from '../domain';
import { fingerprint } from './canonical';
import { changeSubmissionSchema } from './source-reuse';

type Submission = z.infer<typeof changeSubmissionSchema>;
interface SavedProposal { id: string; binding: string; changes: Submission[] }
const key = (run: Run) => `failedProposal:v1:${run.id}`;
function binding(store: FileStore, run: Run) {
  return fingerprint({ run: run.id, project: run.projectId, revision: store.db.project().revision,
    snapshot: run.baseSnapshotId, baseRevision: run.baseRevision, skill: run.skillHash, agent: run.agentRulesHash,
    epoch: run.pipeline?.epoch, phase: run.pipeline?.phase, proseHash: run.pipeline?.proseHash,
    changes: run.changes.map(c => ({ path: c.path, hash: hash(c.content), baseHash: c.baseHash })),
    drafts: run.documentDrafts, facts: run.facts });
}
export class RejectedFactProposal extends Error {
  constructor(readonly receipt: { error: string; saved: false; candidateWrites: 'none';
    reuseChangesFrom: string; versions: { path: string; hash: string | null; baseHash: string | null }[]; next: string }) {
    super(receipt.error);
  }
}
/** Called only after file/version/permission validation, before any candidate or fact mutation. */
export function rejectFactProposal(store: FileStore, run: Run, changes: Submission[], error: Error): RejectedFactProposal {
  const state = binding(store, run), id = fingerprint({ state, changes });
  store.db.set(key(run), { id, binding: state, changes } satisfies SavedProposal);
  return new RejectedFactProposal({ error: error.message, saved: false, candidateWrites: 'none', reuseChangesFrom: id,
    versions: changes.map(c => ({ path: c.path, baseHash: c.baseHash,
      hash: run.changes.find(old => old.path === c.path) ? hash(run.changes.find(old => old.path === c.path)!.content) : c.baseHash })),
    next: '本批文件和事实均未写入，原有候选及正式版本不变。只修正事实后调用 propose_changes：changes:[]、reuseChangesFrom:上述编号、facts:修正后的本批事实、complete:true。无需重读这些未变台账或重发原补丁；宿主重用文件提案并重新执行所有版本、权限和证据校验。事件evidence只放正文原文；身份对应使用entityIds/aliases，不能把规划作为事件发生证据。' });
}
export function reuseFailedChanges(store: FileStore, run: Run, id: string): Submission[] {
  const saved = store.db.get<SavedProposal>(key(run));
  if (run.pipeline?.phase !== 'memory' || !saved || saved.id !== id || saved.binding !== binding(store, run))
    throw new Error('失败提案已失效或不属于当前任务/版本；请按当前来源重新提交');
  // The caller re-runs materialization, formal file hash, permission, and fact
  // checks. A reference never supplies accepted content or skips validation.
  return saved.changes.map(c => changeSubmissionSchema.parse(c));
}
export function clearFailedChanges(store: FileStore, run: Run) { store.db.set(key(run), null); }
