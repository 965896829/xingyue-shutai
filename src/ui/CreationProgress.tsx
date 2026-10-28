import { useEffect, useState } from 'react';
import type { Run } from '../shared/types';
import { creationProgress, creationTimeText } from '../shared/creation-progress';

export function CreationProgress({ run }: { run: Run }) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (run.status !== 'running') return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.id, run.status, run.creationTiming?.startedAt]);
  const progress = creationProgress(run);
  if (!progress) return null;
  return <div className="creation-progress">
    <ol className="creation-progress-steps" aria-label="生成阶段进度" style={{ gridTemplateColumns: `repeat(${progress.labels.length}, minmax(0, 1fr))` }}>
      {progress.labels.map((label, index) => <li key={index}
        className={`${index < progress.current ? 'done' : index === progress.current ? 'current' : 'pending'} ${progress.running && index === progress.current ? 'moving' : ''}`}
        aria-current={index === progress.current ? 'step' : undefined}>
        <span className="creation-progress-track" aria-hidden="true" />
        <span>{index + 1}. {label}</span>
      </li>)}
    </ol>
    {progress.running && <p className="creation-time-estimate" aria-live="off"
      title={`依据近 30 天同类任务、相同模型与推理强度的 ${run.creationTiming?.samples ?? 0} 条正常完成记录估算，至少需要 3 条。统计本次生成及必要处理，不包含作者确认等待；网络、内容篇幅和追加修订会影响用时。`}>
      {creationTimeText(run.creationTiming, clock)}
    </p>}
  </div>;
}
