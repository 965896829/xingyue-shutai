import { useDialogs } from '../ui/AppDialogs';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import type { FileSelection, LocalFileList } from '../shared/management';
import './file-picker.css';

type Api = <T>(route: string, input?: unknown) => Promise<T>;
type Options = { mode: FileSelection['mode']; title?: string; name?: string; signal?: AbortSignal };
export function chooseLocalFile(api: Api, options: Options): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', aborted);
      root.unmount();
      host.remove();
      resolve(value);
    };
    const aborted = () => finish(null);
    options.signal?.addEventListener('abort', aborted, { once: true });
    if (options.signal?.aborted) {
      finish(null);
      return;
    }
    root.render(<FilePicker api={api} options={options} finish={finish} />);
  });
}
function FilePicker({
  api,
  options,
  finish
}: {
  api: Api;
  options: Options;
  finish(value: string | null): void;
}) {
  const dialogs = useDialogs();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [listing, setListing] = useState<LocalFileList>();
  const [address, setAddress] = useState('');
  const [name, setName] = useState(options.name ?? '');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load(directory?: string) {
    const seq = ++request.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<LocalFileList>(
        'files' + (directory ? `?path=${encodeURIComponent(directory)}` : '')
      );
      if (seq !== request.current) return;
      setListing(result);
      setAddress(result.path);
      setSelected('');
    } catch (e) {
      if (seq === request.current) setError((e as Error).message);
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    void load();
  }, []);
  async function choose() {
    if (!listing) return;
    const separator = listing.path.includes('\\') ? '\\' : '/';
    const target =
      options.mode === 'save'
        ? listing.path.replace(/[\\/]$/, '') + separator + name
        : selected || listing.path;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ path: string; exists: boolean }>('files/select', {
        mode: options.mode,
        path: target
      });
      if (options.mode === 'save' && result.exists && !await dialogs.confirm('此文件已存在，确认导出时覆盖它？', { title: '覆盖已有文件？', confirmLabel: '覆盖文件' })) return;
      finish(result.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="local-file-picker"
      aria-label={
        options.title ??
        (options.mode === 'directory'
          ? '选择本机文件夹'
          : options.mode === 'save'
            ? '保存到本机'
            : '选择本机文件')
      }
      onCancel={(e) => {
        e.preventDefault();
        finish(null);
      }}
    >
      <header>
        <div>
          <h2>
            {options.title ??
              (options.mode === 'directory'
                ? '选择本机文件夹'
                : options.mode === 'save'
                  ? '保存到本机'
                  : '选择本机文件')}
          </h2>
          <p>浏览这台客户端所在电脑的文件</p>
        </div>
        <button onClick={() => finish(null)} aria-label="关闭文件选择">
          ×
        </button>
      </header>
      <form
        className="picker-address"
        onSubmit={(e) => {
          e.preventDefault();
          void load(address);
        }}
      >
        <select aria-label="本机磁盘" value="" onChange={(e) => void load(e.target.value)}>
          <option value="">磁盘</option>
          {listing?.roots.map((root) => (
            <option key={root}>{root}</option>
          ))}
        </select>
        <input
          aria-label="目录路径"
          disabled={loading}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="输入文件夹完整路径"
        />
        <button disabled={loading}>前往</button>
      </form>
      <div className="picker-tools">
        <button
          disabled={!listing?.parent || loading}
          onClick={() => void load(listing?.parent ?? undefined)}
        >
          上一级
        </button>
        <button
          disabled={loading}
          onClick={async () => {
            const folder = await dialogs.prompt('在当前目录下创建一个文件夹。', { title: '新建文件夹', inputLabel: '文件夹名称', confirmLabel: '创建' });
            if (!folder || !listing) return;
            try {
              await api('files/mkdir', { parent: listing.path, name: folder });
              await load(listing.path);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          新建文件夹
        </button>
      </div>
      {error && (
        <p className="picker-error" role="alert">
          {error}
        </p>
      )}
      <div className="picker-entries" aria-busy={loading}>
        {listing?.entries
          .filter((entry) => entry.directory || options.mode !== 'directory')
          .map((entry) => (
            <div className="picker-row" key={entry.path}>
              <button
                type="button"
                disabled={loading}
                className={selected === entry.path ? 'selected' : ''}
                aria-pressed={selected === entry.path}
                onClick={() => {
                  setSelected(entry.path);
                  if (!entry.directory) setName(entry.name);
                }}
                onDoubleClick={() => (entry.directory ? void load(entry.path) : undefined)}
              >
                <span>{entry.directory ? '▸' : '·'}</span>
                <span>{entry.name}</span>
                <small>{entry.directory ? '文件夹 · 双击打开' : '文件'}</small>
              </button>
              {entry.directory && (
                <button
                  className="picker-enter"
                  disabled={loading}
                  aria-label={`打开文件夹 ${entry.name}`}
                  onClick={() => void load(entry.path)}
                >
                  打开
                </button>
              )}
            </div>
          ))}
        {!loading && !listing?.entries.length && <p>此文件夹为空</p>}
      </div>
      {listing?.truncated && <p>目录较大，显示前 1000 项。可通过上方路径直接进入子目录。</p>}
      {options.mode === 'save' && (
        <label className="picker-filename">
          文件名
          <input aria-label="保存文件名" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <footer>
        <span title={selected || listing?.path}>{selected || listing?.path}</span>
        <button onClick={() => finish(null)}>取消</button>
        <button
          className="picker-primary"
          disabled={
            loading ||
            !listing ||
            !!error ||
            address !== listing.path ||
            (options.mode === 'open' && !selected) ||
            (options.mode === 'save' && (!name.trim() || /[/\\]/.test(name)))
          }
          onClick={() => void choose()}
        >
          {options.mode === 'save' ? '保存到这里' : '选择'}
        </button>
      </footer>
    </dialog>
  );
}
