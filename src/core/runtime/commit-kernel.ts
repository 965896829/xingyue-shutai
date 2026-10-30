import type { Change, ProjectState, Run } from '../../shared/types';
import { FileStore, proposalHash } from '../storage';
import { ApplicationError } from '../../shared/errors';
import { id, now, hash, prosePath, paths } from '../domain';
import { fingerprint as contentFingerprint } from './canonical';
import { validateChapterCoverage, assertCoreMemoryIncluded } from '../chapter-memory';
import { memoryReviewIssues } from '../memory-review';
import { revisionCoreIssues, requiresRevisionCore } from '../workflows/revision-core';
import { worldCandidateIssues } from '../world-model';
import { assertDesign } from '../design-operations';
import { assertWorkbenchCandidate } from '../workbench-candidates';
import { volumeRenameIssues } from '../volume-naming';
import { chapterRenameIssues, chapterTitleIssues } from '../chapter-naming';

export class ProjectCommitService {
  constructor(private readonly store: FileStore) {}
  commit(changes: Change[], project: ProjectState, run?: Run) {
    if (!run) return this.store.commit(changes, project);
    assertDesign(this.store, run);
    // Host projections include progress, index and rebased evidence records; the authored scope stays frozen.
    const chapterPaths = run.chapterNaming?.renameOnly?.documents.map(document => document.path) ?? [];
    const renameIssues = [...volumeRenameIssues(run), ...volumeRenameIssues(run, changes.filter(change => change.path === paths.volumes)), ...chapterRenameIssues(run), ...chapterRenameIssues(run, changes.filter(change => chapterPaths.includes(change.path))), ...chapterTitleIssues(this.store, run, changes)];
    if (chapterPaths.some(file => !changes.some(change => change.path === file))) throw new ApplicationError('APPROVAL_STALE', '章名候选尚未完整提交');
    if (run.volumeNaming?.renameOnly && !changes.some(change => change.path === paths.volumes)) throw new ApplicationError('APPROVAL_STALE', '卷名候选尚未完整提交');
    if (renameIssues.length) throw new ApplicationError('APPROVAL_STALE', renameIssues[0].message);
    if (run.creative) throw new ApplicationError('APPROVAL_STALE', '独立创作产物只能先转为候选，不能直接写入正式作品');
    if (worldCandidateIssues(this.store, changes, run.mode === 'manual', !!run.worldContract).length) throw new ApplicationError('APPROVAL_STALE', '世界模块来源、格式或固定设定已变化');
    if (requiresRevisionCore(this.store, { ...run, changes })) throw new ApplicationError('APPROVAL_STALE', '请先完成修订正文与人物记忆核对');
    if (run.revisionCore) {
      if (revisionCoreIssues(this.store, run).length || run.revisionCore.chapters.some(chapter => !changes.some(change => change.path === prosePath(chapter) && hash(change.content) === run.revisionCore!.proseHashes[chapter]))) throw new ApplicationError('APPROVAL_STALE', '修订正文与核心记忆尚未完成同版本核对');
      assertCoreMemoryIncluded(run, changes);
    }
    const fingerprint = proposalHash(run);
    const prior = this.store.db.sql.prepare('SELECT fingerprint,transaction_id FROM candidate_commits WHERE run_id=?').get(run.id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ApplicationError('APPROVAL_STALE', '此候选的批准内容已改变');
      this.store.materialize(String(prior.transaction_id));
      return String(prior.transaction_id);
    }
    assertWorkbenchCandidate(this.store, run);
    if (run.pipeline?.coverageVersion === 1) {
      validateChapterCoverage(this.store, run, run.chapterCoverage);
      assertCoreMemoryIncluded(run, changes);
      if (!changes.some(change => change.path === prosePath(run.chapter) && hash(change.content) === run.chapterCoverage!.proseHash) ||
          memoryReviewIssues(this.store, run).length)
        throw new ApplicationError('APPROVAL_STALE', '正文与人物记忆尚未完成同版本核验');
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
