import { useEffect, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { useLiveStream, type StreamBinding } from './useLiveStream';
import { renderNativeCitations, type NativeWebCitation } from '../shared/web-search';
import { documentPreviewText, taskReplyText } from '../shared/run-presentation';

export function LiveMarkdown({ binding, citations, format, fallback = '', ...props }: Omit<ComponentProps<typeof MarkdownContent>, 'content'> & {
  binding: StreamBinding; citations?: NativeWebCitation[]; format?: 'prose' | 'task'; fallback?: string;
}) {
  const text = useLiveStream(binding), root = useRef<HTMLDivElement>(null), following = useRef(false);
  useEffect(() => {
    if (binding.kind !== 'prose') return;
    const locate = (event: Event) => {
      const detail = (event as CustomEvent<{ runId: string; quote: string }>).detail;
      const element = root.current;
      if (!element || !element.getClientRects().length || detail?.runId !== binding.id || !detail.quote || event.defaultPrevented) return;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const joined = nodes.map(node => node.data).join(''), offset = joined.indexOf(detail.quote);
      if (offset < 0) return;
      let position = 0; const range = document.createRange();
      for (const node of nodes) {
        if (offset >= position && offset < position + node.length) range.setStart(node, offset - position);
        if (offset + detail.quote.length > position && offset + detail.quote.length <= position + node.length) {
          range.setEnd(node, offset + detail.quote.length - position); break;
        }
        position += node.length;
      }
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      following.current = false;
      range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' });
      event.preventDefault();
    };
    window.addEventListener('wenxu:locate-prose', locate);
    return () => window.removeEventListener('wenxu:locate-prose', locate);
  }, [binding.kind, binding.id]);
  useEffect(() => {
    if (!binding.running) return;
    const scroll = root.current?.closest<HTMLElement>('.chat-scroll');
    if (!scroll) return;
    const track = () => { following.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100; };
    track(); scroll.addEventListener('scroll', track, { passive: true });
    return () => scroll.removeEventListener('scroll', track);
  }, [binding.running, binding.id]);
  useLayoutEffect(() => {
    const scroll = root.current?.closest<HTMLElement>('.chat-scroll');
    if (binding.running && following.current && scroll && window.getSelection()?.isCollapsed !== false)
      scroll.scrollTop = scroll.scrollHeight;
  }, [text, binding.running]);
  const cited = renderNativeCitations(text, citations);
  const content = format === 'prose' ? documentPreviewText(text) : format === 'task' ? taskReplyText(cited) : cited;
  return <div ref={root} className="live-markdown" data-stream-kind={binding.kind} data-stream-length={text.length} data-stream-id={binding.id}>
    <MarkdownContent {...props} incremental content={content || (binding.running ? '' : fallback)} />
  </div>;
}
