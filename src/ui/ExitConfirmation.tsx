import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { brand } from '../shared/brand';
import { BrandLogo } from './BrandLogo';
import './dialogs.css';

export function ExitConfirmation() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(
    () =>
      window.wenxu?.desktop?.onCloseRequested?.((id) => {
        setRequestId(id);
        setError('');
      }),
    []
  );

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (requestId && !element.open) {
      previousFocus.current = document.activeElement as HTMLElement;
      element.showModal();
      stay.current?.focus();
    } else if (!requestId && element.open) {
      element.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    }
  }, [requestId]);

  async function respond(action: 'cancel' | 'quit') {
    if (!requestId || busy) return;
    setBusy(true);
    try {
      const desktop = window.wenxu?.desktop;
      if (!desktop) throw new Error('桌面连接不可用');
      const accepted = await desktop.respondToClose(requestId, action);
      if (action === 'cancel' || !accepted) {
        setRequestId(null);
        setBusy(false);
      }
    } catch {
      setError('退出操作未完成，请重试。');
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="exit-dialog"
      aria-labelledby="exit-title"
      aria-describedby="exit-description"
      onCancel={(event) => {
        event.preventDefault();
        void respond('cancel');
      }}
    >
      <header>
        <BrandLogo symbolOnly />
        <button className="icon" aria-label="取消退出" disabled={busy} onClick={() => void respond('cancel')}>
          <X size={18} />
        </button>
      </header>
      <h2 id="exit-title">退出{brand.name}？</h2>
      <p id="exit-description">未提交的编辑草稿会保留在本机。正在运行的请求将中断，费用状态可能需要核对。</p>
      {error && (
        <p className="exit-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button ref={stay} className="primary" disabled={busy} onClick={() => void respond('cancel')}>
          继续写作
        </button>
        <button disabled={busy} onClick={() => void respond('quit')}>
          {busy ? '正在退出…' : '退出'}
        </button>
      </footer>
    </dialog>
  );
}
