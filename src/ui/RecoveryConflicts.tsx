import { useState } from 'react';
import { invokeCommand as invoke } from '../shared/client';
import type { CommitRecoveryConflict } from '../shared/studio';
import { Difference } from './Editor';

type Preview = { path: string; accepted: string; current: string | null; candidate: string };

export function RecoveryConflicts({ conflicts, disabled, refresh }: {
  conflicts: CommitRecoveryConflict[];
  disabled: boolean;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<(Preview & { transactionId: string }) | null>(null);
  const [showAccepted, setShowAccepted] = useState(false);
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        await refresh();
      } catch (e) {
        setError(previous => previous || (e as Error).message);
      }
      setBusy(false);
    }
  };
  return (
    <section className="recovery-conflicts" aria-label="处理未完成的作品提交">
      <details open>
        <summary>有 {conflicts.length} 次作品提交需要处理</summary>
        <p>作品已打开。请先比较变动；处理完成后即可继续接受新的正式文稿。</p>
        {error && <p role="alert" className="creation-action-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {conflicts.map(conflict => (
          <article key={conflict.transactionId}>
            <p>{conflict.message}</p>
            <p className="muted">{conflict.reason === 'external_edit'
              ? '可先保留现稿并放弃旧提交；如果已把文件恢复到提交前的内容，可重新检查并恢复。'
              : '原先批准的依据已经改变。请保留候选，放弃此次提交后重新审阅。'}</p>
            <div className="recovery-files">
              {conflict.paths.map(file => (
                <button key={file} disabled={busy} onClick={() => void act(async () => {
                  const result = await invoke('recovery.preview', { transactionId: conflict.transactionId, path: file });
                  setPreview({ ...result, transactionId: conflict.transactionId });
                  setShowAccepted(false);
                })}>
                  比较 {file}
                </button>
              ))}
            </div>
            <div className="recovery-actions">
              <button disabled={disabled || busy || conflict.reason !== 'external_edit'} onClick={() => void act(async () => {
                const state = await invoke('recovery.retry', { transactionId: conflict.transactionId });
                const remaining = state.recoveryConflicts?.find(item => item.transactionId === conflict.transactionId);
                setNotice(remaining ? `尚未恢复：${remaining.message}` : '这次提交已恢复。');
                setPreview(null);
              })}>重新检查并恢复提交</button>
              <button disabled={disabled || busy} onClick={() => void act(async () => {
                await invoke('recovery.abandon', { transactionId: conflict.transactionId });
                setPreview(null);
                setNotice('已放弃这次未完成的提交，候选和当前文件均已保留。');
              })}>保留候选，放弃此次提交</button>
            </div>
          </article>
        ))}
        {preview && conflicts.some(conflict => conflict.transactionId === preview.transactionId) && (
          <div className="recovery-preview">
            <div className="recovery-preview-heading">
              <strong>{preview.path}</strong>
              <label>
                <input type="checkbox" checked={showAccepted} onChange={e => setShowAccepted(e.target.checked)} />
                对照上次接受的文稿
              </label>
              <button onClick={() => setPreview(null)}>关闭比较</button>
            </div>
            <div className="recovery-columns">
              <span>{showAccepted ? '上次接受的文稿' : preview.current === null ? '当前文件已不存在' : '当前文件'}</span>
              <span>这次待提交的候选</span>
            </div>
            <Difference before={showAccepted ? preview.accepted : preview.current ?? ''} after={preview.candidate} />
          </div>
        )}
      </details>
    </section>
  );
}
