import { invokeCommand } from '../shared/client';
import { useEffect, useRef, useState } from 'react';
import { useDialog } from './useDialog';
function resultText(value: any): string {
  if (Array.isArray(value)) return value.map((v) => String(v).split('/').at(-1)).join('\n') || '检查完成';
  const issues = value.issues?.map((v: any) => (typeof v === 'string' ? v : v.message)).filter(Boolean) ?? [];
  if (issues.length) return issues.join('\n');
  if (value.sources)
    return `已整理 ${value.sources.length} 份资料 · ${value.retrievedFacts?.length ?? 0} 条记忆`;
  if (value.documents)
    return `检查完成 · ${value.documents.length} 份文稿${value.facts ? ` · ${value.facts.length} 条记忆` : ''}`;
  if (value.batch)
    return `第 ${value.batch.start}—${value.batch.end} 章 · ${value.complete ? '已完成' : '进行中'}`;
  return '检查完成';
}
export function SkillLauncher({ profileId, onRun }: { profileId: string; onRun: (id?: string) => void }) {
  const [open, setOpen] = useState(false),
    [skills, setSkills] = useState<{ id: string; title: string; host: boolean }[]>([]),
    [selected, setSelected] = useState('webnovel-continuity-audit'),
    [request, setRequest] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const [feedback, setFeedback] = useState({ source: '', window: '', sampleSize: 0, synthetic: false });
  const dialog = useRef<HTMLElement | null>(null);
  useDialog(dialog, open, () => setOpen(false));
  useEffect(() => {
    void invokeCommand('skills.list')
      .then(setSkills)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <button onClick={() => setOpen(true)}>创作工具</button>
      {open && (
        <div className="scrim">
          <section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label="创作工具">
            <header>
              <h2>创作工具</h2>
              <button aria-label="关闭创作工具" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <form
              className="modal-body form"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                void invokeCommand('skill.run', {
                    skillId: selected,
                    request: request || skills.find((s) => s.id === selected)?.title,
                    profileId,
                    ...(selected === 'webnovel-reader-feedback' ? { feedback } : {})
                  })
                  .then((r) => {
                    if (typeof r === 'string') {
                      onRun(r);
                      setOpen(false);
                    } else setResult(resultText(r));
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                工具
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setResult('');
                  }}
                >
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                任务
                <textarea
                  aria-label="工具任务"
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder="目标与范围"
                />
              </label>
              {selected === 'webnovel-reader-feedback' && (
                <>
                  <label>
                    反馈来源
                    <input
                      required
                      value={feedback.source}
                      onChange={(e) => setFeedback({ ...feedback, source: e.target.value })}
                    />
                  </label>
                  <label>
                    采集时间
                    <input
                      required
                      value={feedback.window}
                      onChange={(e) => setFeedback({ ...feedback, window: e.target.value })}
                    />
                  </label>
                  <label>
                    样本量
                    <input
                      type="number"
                      min={0}
                      value={feedback.sampleSize}
                      onChange={(e) => setFeedback({ ...feedback, sampleSize: Number(e.target.value) })}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={feedback.synthetic}
                      onChange={(e) => setFeedback({ ...feedback, synthetic: e.target.checked })}
                    />
                    模拟读者反馈
                  </label>
                </>
              )}
              {error && <p role="alert">{error}</p>}
              {result && (
                <details open>
                  <summary>结果</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{result}</pre>
                </details>
              )}
              <div className="modal-footer">
                <button type="button" onClick={() => setOpen(false)}>
                  取消
                </button>
                <button className="primary" disabled={busy}>
                  开始
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
