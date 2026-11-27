import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

function preference(key: string) {
  try { return localStorage.getItem('writing-desk:' + key); } catch { return null; }
}
export function useDeskLayout() {
  const [width, setWidth] = useState(() => {
    const saved = Number(preference('width'));
    return saved >= 260 && saved <= 720 ? saved : 368;
  });
  const [collapsed, setCollapsed] = useState(() => preference('collapsed') === 'true');
  useEffect(() => {
    try {
      localStorage.setItem('writing-desk:width', String(width));
      localStorage.setItem('writing-desk:collapsed', String(collapsed));
    } catch { /* Current window still keeps the preference. */ }
  }, [width, collapsed]);
  return { width, setWidth, collapsed, expand: () => setCollapsed(false), toggle: () => setCollapsed(v => !v),
    style: { '--desk-chat-width': width + 'px' } as CSSProperties };
}
export function DeskDivider({ width, setWidth }: { width: number; setWidth: (v: number) => void }) {
  const origin = useRef<{ x: number; width: number; max: number } | null>(null);
  const clamp = (value: number, max: number) => Math.round(Math.max(260, Math.min(max, value)));
  const maximum = (el: HTMLElement) => Math.min(720, Math.max(260, (el.parentElement?.clientWidth ?? 900) * (window.innerWidth <= 900 ? 0.43 : 0.46)));
  const release = (e: PointerEvent<HTMLDivElement>) => {
    origin.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return <div className="desk-divider" role="separator" tabIndex={0} aria-label="调整对话栏宽度"
    aria-orientation="vertical" aria-valuemin={260} aria-valuemax={720} aria-valuenow={width}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const shell = e.currentTarget.parentElement!;
      const actual = shell.querySelector('.work-area')?.getBoundingClientRect().width ?? width;
      origin.current = { x: e.clientX, width: actual, max: maximum(e.currentTarget) };
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => { const drag = origin.current; if (drag) setWidth(clamp(drag.width + drag.x - e.clientX, drag.max)); }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => { origin.current = null; }}
    onKeyDown={e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const actual = e.currentTarget.parentElement?.querySelector('.work-area')?.getBoundingClientRect().width ?? width;
      setWidth(clamp(actual + (e.key === 'ArrowLeft' ? 24 : -24), maximum(e.currentTarget)));
    }}/>;
}
