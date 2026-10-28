import { memo, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEventHandler, type UIEvent } from 'react';
import { Expand, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { tableColumnLayout, type TableColumnContent } from './markdown-tables';
import { markdownBlocks, type MarkdownBlock } from './markdown-blocks';

function renderMarkdown(content: string, allowImages: boolean, html?: string, prefix = '') {
  const fragment = DOMPurify.sanitize(html ?? marked.parse(content, { async: false }), {
    FORBID_TAGS: ['style', 'iframe', ...(allowImages ? [] : ['img'])],
    RETURN_DOM_FRAGMENT: true
  });
  const tables = [...fragment.querySelectorAll('table')];
  tables.forEach((table, index) => {
    const columns: TableColumnContent[] = [];
    const occupiedUntil: number[] = [];
    let rowGroup: Element | null = null;
    let hasSpans = false;
    [...table.rows].forEach((row, rowIndex) => {
      if (row.parentElement !== rowGroup) { occupiedUntil.length = 0; rowGroup = row.parentElement; }
      let columnIndex = 0;
      [...row.cells].forEach(cell => {
        while ((occupiedUntil[columnIndex] ?? 0) > rowIndex) columnIndex++;
        const span = cell.colSpan;
        hasSpans ||= span > 1 || cell.rowSpan !== 1;
        for (let offset = 0; offset < span; offset++) {
          const column = columns[columnIndex + offset] ??= { heading: '', values: [] };
          // A merged heading describes a group rather than the individual
          // column. Keep it intact, without giving every column that width.
          if (span === 1) {
            if (rowIndex === 0 && cell.tagName === 'TH') column.heading = cell.textContent ?? '';
            else column.values.push(cell.textContent ?? '');
          }
          occupiedUntil[columnIndex + offset] = cell.rowSpan === 0 ? table.rows.length : rowIndex + cell.rowSpan;
        }
        columnIndex += span;
      });
    });
    const { widths, stickyFirst } = tableColumnLayout(columns);
    table.classList.add('readable-table');
    if (stickyFirst && !hasSpans) table.classList.add('readable-table-sticky');
    table.style.setProperty('--table-reading-width', `${widths.reduce((sum, width) => sum + width, 0)}px`);
    // Replace presentation-only column sizing. The rows, cells, links, emphasis
    // and all source text stay untouched; saved Markdown is never rewritten.
    [...table.children].filter(child => child.tagName === 'COLGROUP').forEach(child => child.remove());
    const colgroup = document.createElement('colgroup');
    widths.forEach(width => {
      const col = document.createElement('col');
      col.style.width = `${width}px`;
      colgroup.append(col);
    });
    const caption = table.querySelector(':scope > caption');
    if (caption) caption.after(colgroup);
    else table.prepend(colgroup);
    const viewport = document.createElement('div');
    viewport.className = 'markdown-table-viewport';
    viewport.dataset.tableIndex = prefix + String(index);
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    const label = columns.map(column => column.heading).filter(Boolean).slice(0, 3).join('、');
    viewport.setAttribute('aria-label', `表格 ${index + 1}${label ? `：${label}` : ''}，可左右滚动`);
    table.replaceWith(viewport);
    viewport.append(table);
  });
  const container = document.createElement('div');
  container.append(fragment);
  return { html: container.innerHTML, tableCount: tables.length };
}

const StableBlock = memo(function StableBlock({ block, allowImages, index }: { block: MarkdownBlock; allowImages: boolean; index: number }) {
  const rendered = useMemo(() => renderMarkdown('', allowImages, block.html, `${index}-`), [block, allowImages, index]);
  return <div className="markdown-stream-block" dangerouslySetInnerHTML={{ __html: rendered.html }} />;
});

export function MarkdownContent({ content, className = 'markdown-body', id, label = '内容', allowImages = false, incremental = false, onClick }: {
  content: string;
  className?: string;
  id?: string;
  label?: string;
  allowImages?: boolean;
  incremental?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const cache = useRef<MarkdownBlock[]>([]);
  const blocks = useMemo(() => {
    if (!incremental) return [];
    return cache.current = markdownBlocks(content, cache.current);
  }, [content, incremental]);
  const { html, tableCount } = useMemo(() => incremental
    ? { html: '', tableCount: blocks.filter(block => block.html.includes('<table')).length }
    : renderMarkdown(content, allowImages), [content, allowImages, incremental, blocks]);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const positions = useRef(new Map<string, { left: number; top: number }>());
  const titleId = useId();
  useLayoutEffect(() => {
    if (expanded && !dialog.current?.open) dialog.current?.showModal();
  }, [expanded]);
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('.markdown-table-viewport').forEach(viewport => {
      const position = positions.current.get(`${viewport.closest('dialog') ? 'expanded' : 'inline'}-${viewport.dataset.tableIndex}`);
      if (position) { viewport.scrollLeft = position.left; viewport.scrollTop = position.top; }
    });
  }, [html, blocks, expanded]);
  const recordScroll = (event: UIEvent<HTMLDivElement>) => {
    const viewport = event.target;
    if (!(viewport instanceof HTMLElement) || !viewport.classList.contains('markdown-table-viewport')) return;
    positions.current.set(`${viewport.closest('dialog') ? 'expanded' : 'inline'}-${viewport.dataset.tableIndex}`, { left: viewport.scrollLeft, top: viewport.scrollTop });
  };
  return <div ref={root} id={id} className={`markdown-content ${className}`} onClick={onClick} onScrollCapture={recordScroll}>
    {tableCount > 0 && <div className="markdown-reading-tools">
      <span>表格可左右滚动</span>
      <button ref={trigger} type="button" onClick={() => setExpanded(true)} aria-haspopup="dialog" aria-label={`展开阅读${label}`}>
        <Expand size={14} aria-hidden="true" />展开阅读
      </button>
    </div>}
    {incremental ? <div className="markdown-rendered">{blocks.map((block, index) => <StableBlock key={index} block={block} index={index} allowImages={allowImages} />)}</div>
      : <div className="markdown-rendered" dangerouslySetInnerHTML={{ __html: html }} />}
    {expanded && <dialog ref={dialog} className="markdown-reading-dialog" aria-labelledby={titleId} onClose={() => {
      setExpanded(false);
      trigger.current?.focus({ preventScroll: true });
    }}>
      <header className="markdown-reading-heading">
        <div><strong id={titleId}>{label} · 展开阅读</strong><span>表格可左右滚动 · 按 Esc 收起</span></div>
        <button type="button" aria-label="收起阅读" onClick={() => dialog.current?.close()} autoFocus><X size={18} aria-hidden="true" />收起</button>
      </header>
      {incremental ? <div className="markdown-reading-body markdown-rendered">{blocks.map((block, index) => <StableBlock key={index} block={block} index={index} allowImages={allowImages} />)}</div>
        : <div className="markdown-reading-body markdown-rendered" dangerouslySetInnerHTML={{ __html: html }} />}
    </dialog>}
  </div>;
}
