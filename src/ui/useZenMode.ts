import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ManuscriptPrefs {
  font: 'sans' | 'serif';
  size: 15 | 16 | 17 | 18;
  leading: 1.75 | 1.9 | 2.05;
}

const PREFS_KEY = 'xingyue:manuscript-prefs';
const DEFAULT_PREFS: ManuscriptPrefs = { font: 'sans', size: 16, leading: 1.9 };
const fontSizes: ManuscriptPrefs['size'][] = [15, 16, 17, 18];

function loadPrefs(): ManuscriptPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const saved = raw && JSON.parse(raw);
    return {
      font: saved?.font === 'serif' ? 'serif' : 'sans',
      size: fontSizes.includes(saved?.size) ? saved.size : DEFAULT_PREFS.size,
      leading: [1.75, 1.9, 2.05].includes(saved?.leading) ? saved.leading : DEFAULT_PREFS.leading,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const overlaySelector = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], :popover-open';
function overlayIsOpen() {
  return Array.from(document.querySelectorAll(overlaySelector)).some(el => el.checkVisibility());
}

export function useZenMode(enabled: boolean) {
  const [zenMode, setZenMode] = useState(false);
  const [prefs, setPrefs] = useState<ManuscriptPrefs>(loadPrefs);
  const entryButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const wasZen = useRef(false);

  const toggleZen = useCallback(() => {
    if (!enabled || overlayIsOpen()) return;
    setZenMode(prev => !prev);
  }, [enabled]);

  useLayoutEffect(() => {
    if (wasZen.current === zenMode) return;
    wasZen.current = zenMode;
    if (!enabled) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.checkVisibility()) return;
    const target = zenMode
      ? document.querySelector<HTMLElement>('.writing-desk .cm-content[contenteditable="true"]') ?? exitButton.current
      : entryButton.current;
    target?.focus({ preventScroll: true });
  }, [zenMode, enabled]);

  // 离开写作台时自动退出专注模式
  useEffect(() => {
    if (!enabled && zenMode) setZenMode(false);
  }, [enabled, zenMode]);

  // 将正文排版偏好同步到 CSS Token 并持久化
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty(
      '--manuscript-font',
      prefs.font === 'serif' ? 'var(--font-manuscript-serif)' : 'var(--font-manuscript-sans)',
    );
    root.setProperty('--manuscript-size', `${prefs.size}px`);
    root.setProperty('--manuscript-leading', String(prefs.leading));
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage errors
    }
  }, [prefs]);

  // 快捷键：Cmd/Ctrl + Shift + F 切换，Esc 退出
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const toggle = (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
      if (!toggle && !(zenMode && e.key === 'Escape')) return;
      if (e.defaultPrevented || e.isComposing || e.repeat || overlayIsOpen() ||
          e.composedPath().some(node => node instanceof Element && node.matches('dialog, [role="dialog"], [role="alertdialog"], [popover]'))) return;
      e.preventDefault();
      if (toggle) setZenMode(prev => !prev);
      else setZenMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, zenMode]);

  const cycleSize = useCallback(() => {
    setPrefs(p => ({ ...p, size: fontSizes[(fontSizes.indexOf(p.size) + 1) % fontSizes.length] }));
  }, []);

  const toggleFont = useCallback(() => {
    setPrefs(p => ({ ...p, font: p.font === 'sans' ? 'serif' : 'sans' }));
  }, []);

  return { zenMode, setZenMode, toggleZen, entryButton, exitButton, prefs, cycleSize, toggleFont };
}
