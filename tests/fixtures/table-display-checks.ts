/** Run through the global Playwright MCP on the disposable UI server. No model calls. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { marked } from 'marked';
import { MarkdownContent } from '../../src/ui/MarkdownContent';
import { chapterTableFixture, volumeTableFixture, tableEdgeFixture } from './readable-tables';

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const cells = (root: ParentNode) => [...root.querySelectorAll('table')].map(table => [...table.rows].map(row =>
  [...row.cells].map(cell => ({ content: cell.innerHTML, colSpan: cell.colSpan, rowSpan: cell.rowSpan, align: cell.getAttribute('align') }))));

export async function verifyTableDisplay() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:420px;height:600px;overflow:auto;background:var(--panel);z-index:9999';
  document.body.append(host);
  const root = createRoot(host);
  const render = (content: string, allowImages = false) => flushSync(() => root.render(createElement(MarkdownContent, { content, allowImages })));
  try {
    const fixture = [chapterTableFixture, volumeTableFixture, tableEdgeFixture].join('\n\n');
    const expected = document.createElement('div');
    expected.innerHTML = marked.parse(fixture, { async: false });
    const started = performance.now();
    render(fixture);
    const renderMs = performance.now() - started;
    check(JSON.stringify(cells(host)) === JSON.stringify(cells(expected)), 'Table cells, inline markup, spans and alignment must be preserved');
    check(host.querySelectorAll('pre code').length === 1, 'A table inside a code fence must remain code');
    check(host.querySelectorAll('.markdown-table-viewport').length === 5, 'Both Markdown and raw HTML tables must use the same reader');
    const viewport = host.querySelector<HTMLElement>('.markdown-table-viewport')!;
    const table = viewport.querySelector('table')!;
    check(host.scrollWidth === host.clientWidth, 'The containing panel must not grow wider than its viewport');
    check(viewport.scrollWidth > viewport.clientWidth && viewport.tabIndex === 0, 'Wide tables must be keyboard-scrollable');
    check([...table.rows[0].cells].slice(3).every(cell => cell.getBoundingClientRect().width >= 224), 'Long text needs a readable column width');
    check(table.rows[1].getBoundingClientRect().height < 200, 'The 13-column fixture must not become a vertical strip');
    viewport.scrollLeft = 650; viewport.scrollTop = 300;
    await frame(); await frame();
    const initialPosition = { left: viewport.scrollLeft, top: viewport.scrollTop };
    render(fixture + '\n\n正文继续生成，新段落不改变已有表格。');
    const updatedViewport = host.querySelector<HTMLElement>('.markdown-table-viewport')!;
    check(updatedViewport.scrollLeft === initialPosition.left && updatedViewport.scrollTop === initialPosition.top, 'Streaming updates must preserve the reading position');
    const bounds = updatedViewport.getBoundingClientRect();
    check(Math.abs(updatedViewport.querySelector('thead')!.getBoundingClientRect().top - bounds.top - 1) < 2, 'Header must stay visible while scrolling');
    check(Math.abs(updatedViewport.querySelector('tbody tr td')!.getBoundingClientRect().left - bounds.left - 1) < 2, 'Chapter number must stay visible while scrolling');
    // These are local inert strings used to verify the existing HTML safety boundary.
    render('<table><tr><th>内容</th></tr><tr><td onclick="window.untrustedHandler=1">保留正文<script>window.untrustedScript=1</script><img src="data:," onerror="window.untrustedImage=1"><a href="javascript:alert(1)">危险链接</a></td></tr></table><iframe src="about:blank"></iframe><style>body{display:none}</style>');
    check(!host.querySelector('script, img, iframe, style, [onclick], [onerror], a[href^="javascript:"]'), 'Untrusted HTML must remain sanitized');
    check(host.querySelector('td')?.textContent === '保留正文危险链接', 'Safe cell text must survive sanitization');
    render('没有表格的普通正文。\n\n- 一项内容');
    check(!host.querySelector('.markdown-reading-tools, .markdown-reading-dialog'), 'Plain prose must not get extra reader controls');
    render('<img src="data:," alt="已有图片" onerror="window.untrustedImage=1">', true);
    check(host.querySelector('img')?.alt === '已有图片' && !host.querySelector('[onerror]'), 'Existing image-enabled views retain safe images');
    return { passed: true, tables: 5, cells: cells(expected).flat(2).length, width: 420, chapterRows: 30,
      firstRenderMs: Math.round(renderMs * 10) / 10, preservedScroll: initialPosition,
      checks: ['cell-content-and-markup', 'code-fences', 'raw-html-and-spans', 'bounded-width', 'keyboard-focus', 'readable-columns', 'row-height', 'streaming-scroll', 'sticky-heading', 'sticky-identity', 'html-safety', 'plain-prose', 'allowed-images'] };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
