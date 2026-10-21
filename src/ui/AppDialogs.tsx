import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { X } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import './dialogs.css';

type DialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  inputLabel?: string;
  multiline?: boolean;
};
type DialogKind = 'confirm' | 'alert' | 'prompt';
type DialogResult = boolean | string | null;
// A double click must never create two approvals for the same paid request.
let activeDialog = false;

function openDialog(
  kind: DialogKind,
  message: string,
  options: DialogOptions,
  signal: AbortSignal
): Promise<DialogResult> {
  const cancelled = kind === 'prompt' ? null : false;
  if (signal.aborted || activeDialog) return Promise.resolve(cancelled);
  activeDialog = true;
  return new Promise((resolve) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let settled = false;
    const finish = (value: DialogResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      host.querySelector('dialog')?.close();
      // An owner can unmount during React's commit; dispose the separate root afterwards.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        activeDialog = false;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(signal.aborted ? cancelled : value);
      });
    };
    const abort = () => finish(cancelled);
    signal.addEventListener('abort', abort, { once: true });
    root.render(<AppDialog kind={kind} message={message} options={options} finish={finish} />);
  });
}

/** Cancel pending approval when its owning view or project changes. */
export function useDialogs(scope?: unknown) {
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
    };
  }, [scope]);
  return useMemo(() => {
    const request = (kind: DialogKind, message: string, options: DialogOptions = {}) => {
      const signal = lifetime.current?.signal;
      if (!signal) return Promise.resolve(kind === 'prompt' ? null : false);
      return openDialog(kind, message, options, signal);
    };
    return {
      confirm: async (message: string, options?: DialogOptions) =>
        (await request('confirm', message, options)) === true,
      alert: async (message: string, options?: DialogOptions) => {
        await request('alert', message, options);
      },
      prompt: async (message: string, options?: DialogOptions) => {
        const result = await request('prompt', message, options);
        return typeof result === 'string' ? result : null;
      }
    };
  }, []);
}

function AppDialog({
  kind,
  message,
  options,
  finish
}: {
  kind: DialogKind;
  message: string;
  options: DialogOptions;
  finish: (result: DialogResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [value, setValue] = useState(options.defaultValue ?? '');
  const cancel = () => finish(kind === 'prompt' ? null : false);
  useEffect(() => {
    dialog.current?.showModal();
    if (kind === 'prompt') {
      input.current?.focus();
      input.current?.select();
    } else cancelButton.current?.focus();
  }, [kind]);
  return (
    <dialog
      ref={dialog}
      className="exit-dialog app-dialog"
      aria-labelledby="app-dialog-title"
      aria-describedby="app-dialog-description"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
          )
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <header>
        <BrandLogo symbolOnly />
        <button type="button" className="icon" aria-label="关闭弹窗" onClick={cancel}>
          <X size={18} />
        </button>
      </header>
      <h2 id="app-dialog-title">
        {options.title ?? (kind === 'confirm' ? '确认操作' : kind === 'prompt' ? '填写内容' : '操作完成')}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          finish(kind === 'prompt' ? value : true);
        }}
      >
        <div className="app-dialog-content">
          <p id="app-dialog-description">{message}</p>
          {kind === 'prompt' && (
            <label className="app-dialog-field">
              <span>{options.inputLabel ?? '内容'}</span>
              {options.multiline ? (
                <textarea
                  ref={(element) => {
                    input.current = element;
                  }}
                  rows={4}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <input
                  ref={(element) => {
                    input.current = element;
                  }}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
                      event.preventDefault();
                  }}
                />
              )}
            </label>
          )}
        </div>
        <footer>
          {kind !== 'alert' && (
            <button ref={cancelButton} type="button" onClick={cancel}>
              {options.cancelLabel ?? '取消'}
            </button>
          )}
          <button ref={kind === 'alert' ? cancelButton : undefined} type="submit" className="primary">
            {options.confirmLabel ?? (kind === 'alert' ? '知道了' : '确认')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
