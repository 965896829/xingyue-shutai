import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, FolderOpen, RefreshCw, Trash2, X } from 'lucide-react';
import type { TrashRecord } from '../core/recycle-bin';
const displayError = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  );

export function RecycleBin({
  onClose,
  act
}: {
  onClose: () => void;
  act: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
}) {
  const [entries, setEntries] = useState<TrashRecord[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => {
    try {
      setEntries(await window.wenxu!.invoke<TrashRecord[]>('project.listTrash'));
      setNow(Date.now());
      setError('');
    } catch (e) {
      setError(displayError(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function restore(entry: TrashRecord, elsewhere: boolean) {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const restored = await act(async () => {
        try {
          const parent = elsewhere
            ? await window.wenxu!.invoke<string | null>('app.chooseDirectory', {
                title: '选择原作品所在磁盘的其他目录恢复'
              })
            : undefined;
          if (elsewhere && !parent) return false;
          await window.wenxu!.invoke('project.restoreTrash', { id: entry.id, ...(parent ? { parent } : {}) });
          return true;
        } catch (e) {
          setError(displayError(e));
          throw e;
        }
      });
      if (restored) await refresh();
    } finally {
      setWorking(false);
    }
  }
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !working) onClose();
      }}
    >
      <section className="modal wide recycle-dialog" role="dialog" aria-modal="true" aria-label="作品回收站">
        <header>
          <div>
            <h2>作品回收站</h2>
            <p>删除后保留七天，可在到期前恢复。</p>
          </div>
          <button className="icon" aria-label="关闭回收站" disabled={working} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="recycle-body">
          <div className="recycle-intro">
            <Trash2 size={20} />
            <p>
              七天后自动永久删除回收站内的本地作品。客户端关闭时不运行清理，下次打开时处理到期作品。文稿、候选和历史一起保留；你另存的独立备份不会被清理。
            </p>
          </div>
          <button disabled={working} onClick={() => void refresh()}>
            <RefreshCw size={14} />
            刷新回收站
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {!error && entries.length === 0 && <p className="empty-state">回收站为空</p>}
          {entries.map((entry) => {
            const hours = Math.max(0, Math.ceil((entry.expiresAt - now) / 3600000));
            return (
              <article className="recycle-entry" key={entry.id}>
                <div className="recycle-entry-heading">
                  <h3>{entry.title}</h3>
                  <span className={hours ? 'tag' : 'tag error-text'}>
                    {hours ? `剩余 ${Math.floor(hours / 24)} 天 ${hours % 24} 小时` : '已到期，等待清理'}
                  </span>
                </div>
                <p className="muted">原位置：{entry.originalRoot}</p>
                <small>
                  删除时间：{new Date(entry.deletedAt).toLocaleString()}
                  <br />
                  到期时间：{new Date(entry.expiresAt).toLocaleString()}
                </small>
                {entry.error && (
                  <p role="alert" className="form-error">
                    操作未完成，已保留记录以便重试：{entry.error}
                  </p>
                )}
                <div className="button-row">
                  <button
                    disabled={working || !hours || entry.state === 'purging'}
                    onClick={() => void restore(entry, false)}
                  >
                    <ArchiveRestore size={15} />
                    恢复到原位置
                  </button>
                  <button
                    disabled={working || !hours || entry.state === 'purging'}
                    onClick={() => void restore(entry, true)}
                  >
                    <FolderOpen size={15} />
                    选择其他目录恢复
                  </button>
                </div>
                <small>其他目录须与原作品在同一磁盘；存在同名目录时不会覆盖。</small>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
