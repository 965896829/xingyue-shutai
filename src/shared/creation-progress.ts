import type { Run } from './types';

/** Presentation metadata, not an execution deadline or a model-reported percentage. */
export interface CreationTiming {
  startedAt: string;
  samples: number;
  expectedSeconds?: { low: number; high: number };
  unavailable?: 'history' | 'resumed' | 'repair';
}

export function creationProgress(run: Run) {
  const planning = run.planning, naming = run.naming;
  if (!planning && !naming) return null;
  const contract = planning && ['contract', 'reviewing_contract', 'ready'].includes(planning.phase);
  const phase = planning?.phase ?? naming!.phase;
  const ready = ['awaiting_direction', 'ready'].includes(phase);
  const reviewing = phase.startsWith('reviewing');
  const review = planning
    ? (contract ? planning.contractReview : planning.reportReview)?.result.issues.some(issue => issue.severity !== 'minor')
    : naming?.review?.result.decisions.every(decision => decision.verdict !== 'keep');
  const repairing = !ready && !!review;
  const labels = [
    naming ? (naming.manualTitle ? '核对自填书名' : '生成书名') : contract ? '完善作品方案' : '生成三个方向',
    naming ? '检查书名' : '检查方案',
    '等待你确认'
  ];
  if (repairing) labels[reviewing ? 1 : 0] = reviewing ? '复查修订结果' : '按检查意见修订';
  const finished = ready && ['awaiting_input', 'awaiting_review', 'complete'].includes(run.status);
  // A saved candidate is not proof of success after cancellation, failure or invalidation.
  const current = finished ? 2 : reviewing || ready ? 1 : 0;
  return { labels, current, finished, repairing, running: run.status === 'running' };
}

export function creationTimeText(timing: CreationTiming | undefined, now = Date.now()) {
  if (timing?.unavailable === 'repair') return '正在追加修订或校验，暂无法估计剩余时间。';
  if (timing?.unavailable === 'resumed') return '正在继续已保存的步骤，暂无法估计剩余时间。';
  if (!timing?.expectedSeconds) return '历史样本不足，暂无法估计完成时间。';
  const elapsed = Math.max(0, (now - Date.parse(timing.startedAt)) / 1000);
  if (!Number.isFinite(elapsed)) return '暂无法估计完成时间。';
  const { low, high } = timing.expectedSeconds;
  if (elapsed >= high) return '已超过近期常见用时，任务仍在进行，暂无法估计剩余时间。';
  const upper = Math.ceil((high - elapsed) / 60);
  const lower = Math.max(1, Math.ceil((low - elapsed) / 60));
  if (upper <= 1) return '预计还需不到 1 分钟（含检查，仅供参考）。';
  return `预计还需约 ${lower === upper ? upper : `${lower}–${upper}`} 分钟（含检查，仅供参考）。`;
}
