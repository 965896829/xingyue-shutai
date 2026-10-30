import { useEffect, useRef, useState } from 'react';
import { invokeCommand } from '../shared/client';
import { normalizeWritingStyle, writingStylePresets, type WritingStyleContext, type WritingStyleReport } from '../shared/writing-style';
import { GenerationStatus, GenerationStep } from './GenerationStatus';
import type { GenerationActivity } from '../shared/generation';

export function WritingStyleField({ value, onChange, context, profileId, projectSessionId, disabled = false, onBusyChange }: {
  value: string; onChange: (style: string) => void; context: WritingStyleContext; profileId: string;
  projectSessionId?: string; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [report, setReport] = useState<WritingStyleReport>(), [error, setError] = useState('');
  const [activity, setActivity] = useState<GenerationActivity>();
  const active = useRef<{ id: string; cancelled: boolean } | undefined>(undefined);
  const onBusy = useRef(onBusyChange); onBusy.current = onBusyChange;
  const contextKey = JSON.stringify({ context, profileId, projectSessionId });
  useEffect(() => {
    setReport(undefined); setError(''); setActivity(undefined); onBusy.current?.(false);
    return () => {
      const pending = active.current;
      active.current = undefined;
      if (pending) void invokeCommand('style.cancel', { requestId: pending.id }).catch(() => {});
      onBusy.current?.(false);
    };
  }, [contextKey]);
  const preset = writingStylePresets.find(option => normalizeWritingStyle(option.style) === normalizeWritingStyle(value));
  const busy = !!activity;
  const incompletePublishing = !!context.bookProfile?.publishing && !context.bookProfile.publishing.reading.main;
  const hasContext = !!projectSessionId || !!context.premise.trim() || !!context.genre.trim() ||
    !!context.readingMain || !!context.bookProfile?.creativeGenres.length || !!context.bookProfile?.publishing?.reading.main;
  async function recommend() {
    if (active.current || disabled || !profileId || !hasContext || incompletePublishing) return;
    const pending = { id: crypto.randomUUID(), cancelled: false };
    active.current = pending; setError(''); setReport(undefined); onBusy.current?.(true);
    const at = new Date().toISOString(); setActivity({ startedAt: at, updatedAt: at, phase: 'waiting' });
    try {
      const result = await invokeCommand('style.recommend', { requestId: pending.id, profileId, context, currentStyle: value, projectSessionId });
      if (active.current === pending && !pending.cancelled) setReport(result);
    } catch (cause) {
      if (active.current === pending && !pending.cancelled) setError((cause as Error).message);
    } finally {
      if (active.current === pending) { active.current = undefined; setActivity(undefined); onBusy.current?.(false); }
    }
  }
  return <section className="writing-style-field" aria-label="创作风格">
    <div className="writing-style-heading">
      <strong>创作风格</strong>
      {busy ? <div className="button-row">
        <GenerationStatus variant="elapsed" running activity={activity} />
        <button type="button" onClick={async () => {
          const pending = active.current; if (!pending) return;
          pending.cancelled = true;
          try { await invokeCommand('style.cancel', { requestId: pending.id }); }
          catch (cause) { if (active.current === pending) { pending.cancelled = false; setError((cause as Error).message); } }
        }}>停止推荐</button>
      </div> : <button type="button" disabled={disabled || !profileId || !hasContext || incompletePublishing} onClick={() => void recommend()}
        title={!profileId ? '先选择创作模型' : incompletePublishing ? '先选择发布主分类' : !hasContext ? '先填写创作想法或选择题材' : '使用当前模型生成三个候选，调用一次模型'}>{report ? '重新推荐' : 'AI 推荐风格'}</button>}
    </div>
    <label>风格选择<select aria-label="风格选择" value={preset?.id ?? 'custom'} disabled={disabled || busy}
      onChange={e => onChange(writingStylePresets.find(option => option.id === e.target.value)?.style ?? '')}>
      {writingStylePresets.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      <option value="custom">自定义</option>
    </select></label>
    <label>风格要求<textarea aria-label="风格要求" required rows={3} maxLength={2000} value={value} disabled={disabled || busy}
      placeholder="写下希望的节奏、语气、叙述方式与对白特点" onChange={e => onChange(e.target.value)} /></label>
    <GenerationStep running={busy} activity={activity} />
    {error && <p className="inline-warning" role="alert">{error}</p>}
    {report && <div className="writing-style-candidates" aria-label="AI 风格推荐">
      {report.options.map(option => {
        const selected = normalizeWritingStyle(value) === option.style;
        return <article key={option.id} className={`writing-style-candidate${selected ? ' is-selected' : ''}`}>
          <div className="writing-style-heading"><strong>{option.name}</strong>{report.recommendedId === option.id && <span className="writing-style-recommended">优先推荐</span>}</div>
          <p>{option.style}</p>
          <details><summary>推荐理由与取舍</summary><p>{option.reason}</p><p>{option.tradeoff}</p></details>
          <button type="button" disabled={disabled || busy || selected} aria-pressed={selected} onClick={() => onChange(option.style)}>{selected ? '已选择' : '选择此风格'}</button>
        </article>;
      })}
      <p className="muted writing-style-note">根据本书题材与读者定位推荐，选择后可继续调整。</p>
    </div>}
  </section>;
}
