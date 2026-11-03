import { type ProjectState, type Run, type SecretProfile } from '../../shared/types';
import { automaticRepairLimit } from '../agent-control';
import { applyMemoryRepairResponse, finishMemoryRepairReport, memoryRepairRequest } from '../memory-repair';
import type { AgentRunner } from '../runner';
import { setRunStatus } from '../runtime/run-state';
import { professionalMethod } from '../creation-policy';

export type RevisionWorkflowHost = Pick<
  AgentRunner,
  'save' | 'memoryCall' | 'store' | 'skillRoot' | 'event' | 'auditMemory' | 'check'
>;

export async function driveRevisionWorkflow(
  host: RevisionWorkflowHost,
  r: Run,
  p: ProjectState,
  profile: SecretProfile,
  signal: AbortSignal
) {
  setRunStatus(r, 'running');
  r.error = undefined;
  host.save(r);
  // Applying one file invalidates its review receipt; keep the batch feedback
  // available to the remaining files throughout this correction pass.
  const repairFeedback = r.memoryReview?.issues.join('；') ?? '';
  while (r.memoryRepair!.cursor < r.memoryRepair!.paths.length) {
    const file = r.memoryRepair!.paths[r.memoryRepair!.cursor];
    let error = repairFeedback;
    for (let attempt = 0; attempt <= automaticRepairLimit; attempt++) {
      const raw = await host.memoryCall(
        r,
        p,
        profile,
        signal,
        'memory-synchronization',
        professionalMethod(host.skillRoot, 'memory').content + '\n按本次记忆同步任务处理一个文件。不把待核对文稿当作事实。逐条依据新版本复核；只有确实受影响时才修改，保留其余内容。遵守 formatRequirements，字段名称及原分节保持一致，已经完成的状态写在字段内容中。records 和 withdrawn 必须是数组。',
        { ...memoryRepairRequest(host.store, r, file, host.skillRoot), correction: error }
      );
      try {
        applyMemoryRepairResponse(host.store, r, file, raw, host.skillRoot);
        host.save(r);
        error = '';
        break;
      } catch (failure) {
        error = (failure as Error).message;
        host.event(r, 'memory-sync-repair', `${file}：${error}`);
        if (attempt === automaticRepairLimit) throw failure;
      }
    }
    if (error) throw new Error(error);
  }
  finishMemoryRepairReport(host.store, r);
  await host.auditMemory(r, p, profile, signal);
  host.check(r, p);
  if (
    r.issues.some((issue) => issue.severity === 'error') &&
    (r.repairAttempts?.memory_sync ?? 0) < automaticRepairLimit
  ) {
    (r.repairAttempts ??= {}).memory_sync = (r.repairAttempts?.memory_sync ?? 0) + 1;
    const issues = r.issues.map((issue) => issue.message);
    r.memoryRepair!.cursor = 0;
    r.memoryRepair!.completed = [];
    r.changes = [];
    r.facts = [];
    r.factRetractions = [];
    r.memoryReview = { fingerprint: '', issues };
    host.save(r);
    await driveRevisionWorkflow(host, r, p, profile, signal);
    return;
  }
  r.responseText = r.issues.some((issue) => issue.severity === 'error')
    ? '记忆同步已生成，但仍有需要修正的证据或内容。正式文稿尚未改变。'
    : '已核对受影响的原文和记忆，并保留无需修改的内容。请统一审阅这次修正，接受后恢复正常创作。';
  setRunStatus(r, r.issues.some((issue) => issue.severity === 'error') ? 'needs_repair' : 'awaiting_review');
  host.save(r);
}
