import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { elapsedGeneration, formatElapsed, generationLabels, type GenerationActivity } from '../shared/generation';

export function GenerationStatus({ activity, running, label, fallbackStart }: {
  activity?: GenerationActivity; running: boolean; label?: string; fallbackStart?: string;
}) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, activity?.startedAt, fallbackStart]);
  const current = activity ?? (running && fallbackStart ? { startedAt: fallbackStart, updatedAt: fallbackStart, phase: 'preparing' as const } : undefined);
  const text = running ? generationLabels[current?.phase ?? 'preparing'] : label ?? '已完成';
  return <span className={`generation-status ${running ? 'is-running' : ''}`}>
    {running && <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />}
    <span role="status" title={running && current?.phase === 'waiting' ? '请求已发送，正在等待模型返回。此状态不表示已收到模型的推理内容。' : undefined}>{text}</span>
    {current && <span className="generation-elapsed" aria-live="off" title="本次执行用时；暂停后停止计时，继续执行后重新计时">· {formatElapsed(elapsedGeneration(current, clock))}</span>}
  </span>;
}
