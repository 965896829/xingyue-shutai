import { useLayoutEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { DocumentInfo } from '../shared/types';

export function ProjectFiles({ documents, selected, current, onOpen, resetKey }: { documents: DocumentInfo[]; selected?: string; current?: string; onOpen: (path: string) => void; resetKey: string }) {
  const container = useRef<HTMLDivElement>(null), firstRow = useRef<HTMLButtonElement>(null), pendingFocus = useRef<number | null>(null);
  const [top, setTop] = useState(0), [height, setHeight] = useState(400), [rowHeight, setRowHeight] = useState(34);
  const virtual = documents.length > 300;
  const currentIndex = current ? documents.findIndex(document => document.path === current) : -1;
  const start = virtual ? Math.max(0, Math.min(documents.length - 1, Math.floor(top / rowHeight) - 8)) : 0;
  const end = virtual ? Math.min(documents.length, start + Math.ceil(height / rowHeight) + 17) : documents.length;
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (element.clientHeight > 0) setHeight(element.clientHeight);
      const measured = firstRow.current?.getBoundingClientRect().height;
      if (measured && measured > 0) setRowHeight(measured);
    });
    observer.observe(element);
    if (firstRow.current) observer.observe(firstRow.current);
    return () => observer.disconnect();
  }, [virtual, documents.length]);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    pendingFocus.current = null;
    // Follow actual stage/chapter changes, never file selection or streaming text.
    const target = element.querySelector<HTMLButtonElement>('[aria-current="step"]');
    const position = currentIndex < 0 ? 0 : virtual ? currentIndex * rowHeight : target
      ? element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top : 0;
    element.scrollTop = Math.max(0, position - (currentIndex < 0 ? 0 : (element.clientHeight - rowHeight) / 2));
    setTop(element.scrollTop);
  }, [resetKey, current, currentIndex, rowHeight, virtual, height]);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const button = container.current?.querySelector<HTMLButtonElement>(`[data-file-index="${pendingFocus.current}"]`);
    if (button) { button.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [start, end, top]);
  return <div className="files" ref={container} style={virtual ? { overflowAnchor: 'none' } : undefined} onScroll={event => { if (virtual) setTop(event.currentTarget.scrollTop); }}>
    {virtual && start > 0 && <div aria-hidden="true" style={{ height: start * rowHeight }} />}
    {documents.slice(start, end).map((document, offset) => {
      const index = start + offset;
      const isCurrent = current === document.path;
      return <button key={document.path} ref={offset === 0 ? firstRow : undefined} title={`${isCurrent ? '当前阶段 · ' : ''}${document.path}`} data-file-index={index}
        className={`${selected === document.path ? 'selected' : ''} ${isCurrent ? 'current-stage' : ''}`.trim()}
        aria-current={isCurrent ? 'step' : undefined} onClick={() => onOpen(document.path)}
        onKeyDown={event => {
          if (!virtual || !container.current) return;
          let target = index;
          if (event.key === 'ArrowDown' || event.key === 'Tab' && !event.shiftKey) target++;
          else if (event.key === 'ArrowUp' || event.key === 'Tab' && event.shiftKey) target--;
          else if (event.key === 'Home') target = 0;
          else if (event.key === 'End') target = documents.length - 1;
          else return;
          if (target < 0 || target >= documents.length) return;
          event.preventDefault();
          const existing = container.current.querySelector<HTMLButtonElement>(`[data-file-index="${target}"]`);
          if (existing) { existing.focus(); return; }
          pendingFocus.current = target;
          container.current.scrollTop = target * rowHeight;
          setTop(container.current.scrollTop);
        }}>
        <FileText size={14} /><span>{document.path.split('/').at(-1)?.replace('.md', '')}</span>
        {isCurrent && <em className="current-stage-badge">当前</em>}
        {document.status !== 'accepted' && <i title="外部修改待确认" />}
      </button>;
    })}
    {virtual && end < documents.length && <div aria-hidden="true" style={{ height: (documents.length - end) * rowHeight }} />}
  </div>;
}
