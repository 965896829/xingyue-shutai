import type { Change, ProjectState, Run } from '../../shared/types';
import { FileStore, proposalHash } from '../storage';
import { ApplicationError } from '../../shared/errors';
import { id, now, hash } from '../domain';
import { fingerprint as contentFingerprint } from './canonical';

export class ProjectCommitService {
  constructor(private readonly store: FileStore) {}
  commit(changes: Change[], project: ProjectState, run?: Run) {
    if (!run) return this.store.commit(changes, project);
    const fingerprint = proposalHash(run);
    const prior = this.store.db.sql.prepare('SELECT fingerprint,transaction_id FROM candidate_commits WHERE run_id=?').get(run.id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ApplicationError('APPROVAL_STALE', '此候选的批准内容已改变');
      this.store.materialize(String(prior.transaction_id));
      return String(prior.transaction_id);
    }
    const current = this.store.db.run(run.id);
    if (current.accepted || proposalHash(current) !== fingerprint)
      throw new ApplicationError('APPROVAL_STALE', '候选已改变，请重新审阅');
    const approvalId = id();
    const approval = { version: 1, id: approvalId, runId: run.id, fingerprint, projectId: project.id,
      baseSnapshotId: this.store.db.get<string>('headSnapshot') ?? null, scope: changes.map((change) => change.path),
      commitHash: contentFingerprint({ project, changes: changes.map((change) => ({ path: change.path, baseHash: change.baseHash, newHash: hash(change.content) })) }),
      actor: 'local-author', issuedAt: now(), revokedAt: null, consumedByCommit: null };
    this.store.db.sql.prepare('INSERT INTO approvals VALUES(?,?,?,?)').run(approvalId, run.id, fingerprint, JSON.stringify(approval));
    return this.store.commit(changes, project, run, undefined, approvalId);
  }
}
