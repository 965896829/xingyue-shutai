import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { elapsedGeneration, formatElapsed, generationActivityLabel, type GenerationActivity } from '../shared/generation';

export function GenerationStatus({ activity, running, label, fallbackStart, variant = 'activity' }: {
  activity?: GenerationActivity; running: boolean; label?: string; fallbackStart?: string; variant?: 'activity' | 'elapsed';
}) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, activity?.startedAt, fallbackStart]);
  const current = activity ?? (running && fallbackStart ? { startedAt: fallbackStart, updatedAt: fallbackStart, phase: 'preparing' as const } : undefined);
  const duration = current ? formatElapsed(elapsedGeneration(current, clock)) : undefined;
  if (variant === 'elapsed') return <span className="generation-status generation-status-elapsed">
    {running ? <span className="generation-elapsed" aria-live="off">{duration ? `已处理 ${duration}` : '处理中'}</span>
      : <><span role="status">{label ?? '已完成'}</span>{duration && <span className="generation-elapsed">· {duration}</span>}</>}
  </span>;
  const text = running ? generationActivityLabel(current) : label ?? '已完成';
  return <span className={`generation-status ${running ? 'is-running' : ''}`}>
    {running && <LoaderCircle size={14} className="generation-spinner" aria-hidden="true" />}
    <span role="status">{text}</span>
    {duration && <span className="generation-elapsed" aria-live="off">· {duration}</span>}
  </span>;
}

export function GenerationStep({ activity, running }: { activity?: GenerationActivity; running: boolean }) {
  if (!running || activity?.stoppedAt) return null;
  return <div className="generation-step" role="status" aria-live="polite" aria-atomic="true">
    <span className="generation-step-text">{generationActivityLabel(activity)}</span>
  </div>;
}
