import { useEffect, useState } from 'react';
import type { WorkbenchBinding } from '../shared/workbench';
import type { StateHistory } from '../shared/workbench-visual';
import type { SourceRef } from '../shared/studio';
import { invokeCommand } from '../shared/client';
import type { CommandOutput } from '../shared/contracts';

export function CharacterWorkbench({
  binding,
  editable,
  title,
  versions,
  onCandidate,
  onSource
}: {
  binding: WorkbenchBinding;
  editable: boolean;
  title: string;
  versions: { id: string; revision: number }[];
  onCandidate: (id: string) => Promise<void>;
  onSource: (source: SourceRef) => void;
}) {
  const [avatar, setAvatar] = useState<CommandOutput<'workbench.avatar'>>(null),
    [history, setHistory] = useState<StateHistory>(),
    [compare, setCompare] = useState(''),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reveal, setReveal] = useState(false);
  const key = JSON.stringify(binding);
  useEffect(() => {
    setAvatar(null);
    setHistory(undefined);
    setCompare('');
    setError('');
    let active = true;
    void invokeCommand('workbench.avatar', { binding })
      .then((v) => {
        if (active) setAvatar(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setHistory(undefined);
    void invokeCommand('workbench.history', { binding, compareSnapshotId: compare || undefined })
      .then((v) => {
        if (active) setHistory(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [key, compare, open]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="character-workbench" aria-label="人物外观与状态">
      <div className="character-avatar-row">
        {avatar ? (
          <img className="character-avatar" src={avatar.dataUrl} alt={`${title}的头像`} />
        ) : (
          <div className="character-avatar placeholder" aria-label="未设置头像">
            {title.slice(0, 1)}
          </div>
        )}
        {editable && (
          <details>
            <summary>{avatar ? '更换头像' : '添加头像'}</summary>
            <label className="inline-check">
              <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
              从本章起公开外观
            </label>
            <label>
              上传图片
              <input
                type="file"
                disabled={busy}
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  void act(async () => {
                    if (file.size > 3 * 1024 * 1024) throw new Error('头像图片应小于 3 MB');
                    const dataUrl = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onerror = () => reject(new Error('图片读取失败'));
                      reader.onload = () => resolve(String(reader.result));
                      reader.readAsDataURL(file);
                    });
                    const id = await invokeCommand('workbench.avatarPropose', {
                      binding,
                      dataUrl,
                      name: file.name.slice(0, 200),
                      revealedAt: reveal ? binding.scope.chapter : null
                    });
                    await onCandidate(id);
                  });
                }}
              />
            </label>
            {avatar && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const id = await invokeCommand('workbench.avatarPropose', {
                      binding,
                      dataUrl: null,
                      name: title,
                      revealedAt: null
                    });
                    await onCandidate(id);
                  })
                }
              >
                移除头像
              </button>
            )}
          </details>
        )}
        <button aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          状态与版本
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {open && (
        <div className="character-history">
          <div className="workbench-form-grid">
            <label>
              比较版本
              <select aria-label="人物比较版本" value={compare} onChange={(e) => setCompare(e.target.value)}>
                <option value="">上一版本</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    第 {v.revision} 版
                  </option>
                ))}
              </select>
            </label>
          </div>
          {history?.comparison && (
            <details open>
              <summary>与第 {history.comparison.revision} 版比较</summary>
              {!history.comparison.fields.length ? (
                <p>字段没有变化</p>
              ) : (
                history.comparison.fields.map((field, i) => (
                  <div key={i} className="history-diff">
                    <h4>{field.label}</h4>
                    <div className="workbench-diff">
                      <p>{field.before ?? '未记录'}</p>
                      <p>{field.after ?? '未记录'}</p>
                    </div>
                  </div>
                ))
              )}
            </details>
          )}
          {history?.changes.length ? (
            <ol className="state-history">
              {history.changes.map((item) => (
                <li key={item.id}>
                  <header>
                    <b>第 {item.chapter} 章</b>
                    <span>{item.storyTime || '故事时间未记录'}</span>
                  </header>
                  <h4>{item.label}</h4>
                  <p>{item.value}</p>
                  <button onClick={() => onSource(item.source)}>查看原文</button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">{history ? '当前范围没有已确认的状态变化' : '正在读取…'}</p>
          )}
        </div>
      )}
    </section>
  );
}
