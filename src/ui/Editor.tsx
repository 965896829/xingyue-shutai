import { useEffect, useLayoutEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Annotation, EditorState, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { MergeView } from '@codemirror/merge';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// CSS variables update in place so switching themes preserves selection and undo history.
const editorAppearance = [
  EditorView.theme({
    '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--panel)', fontSize: '15px' },
    '.cm-scroller': { overflow: 'auto', fontFamily: '"Microsoft YaHei",sans-serif', lineHeight: '1.9' },
    '.cm-content': { padding: '22px 10px', caretColor: 'var(--accent)' },
    '.cm-gutters': { background: 'var(--inset)', color: 'var(--muted)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { background: 'var(--active-line)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: 'var(--selection)' },
    '.cm-selectionMatch': { background: 'var(--accent-wash)' },
    '.cm-panels': { background: 'var(--raised)', color: 'var(--ink)' },
    '.cm-panels-top': { borderBottom: '1px solid var(--line)' },
    '.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
    '.cm-tooltip': {
      background: 'var(--raised)',
      color: 'var(--ink)',
      border: '1px solid var(--line-strong)'
    },
    '.cm-textfield': {
      background: 'var(--panel)',
      color: 'var(--ink)',
      border: '1px solid var(--line-strong)'
    },
    '.cm-button': { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--line-strong)' },
    '.cm-searchMatch': { background: 'var(--warning-bg)', outline: '1px solid var(--warning-line)' },
    '.cm-searchMatch.cm-searchMatch-selected': { background: 'var(--selection)' },
    '.cm-foldPlaceholder': {
      background: 'var(--raised)',
      color: 'var(--muted)',
      border: '1px solid var(--line)'
    },
    '.cm-matchingBracket': { background: 'var(--accent-wash)', color: 'var(--accent)' }
  }),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading, color: 'var(--accent)', fontWeight: '600' },
      { tag: tags.emphasis, fontStyle: 'italic' },
      { tag: tags.strong, fontWeight: 'bold' },
      { tag: tags.strikethrough, textDecoration: 'line-through' },
      { tag: [tags.link, tags.url], color: 'var(--info)', textDecoration: 'underline' },
      { tag: [tags.quote, tags.string, tags.monospace], color: 'var(--success)' },
      { tag: [tags.meta, tags.comment, tags.processingInstruction], color: 'var(--muted)' },
      { tag: [tags.keyword, tags.number, tags.bool, tags.atom], color: 'var(--accent)' }
    ])
  )
];
const fromParent = Annotation.define<boolean>();

export function Editor({
  value,
  onChange,
  onSelection,
  onRange,
  playback,
  undoStep,
  undoBase,
  clearSelection,
  label,
  highlight,
  readOnly = false
}: {
  value: string;
  onChange?: (v: string) => void;
  onSelection?: (v: string) => void;
  onRange?: (range: { from: number; to: number }) => void;
  playback?: { active: boolean; follow: boolean; pause: () => void };
  undoStep?: number;
  undoBase?: string;
  clearSelection?: number;
  label?: string;
  readOnly?: boolean;
  highlight?: { start: number; end: number };
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callback = useRef(onChange),
    select = useRef(onSelection);
  callback.current = onChange;
  select.current = onSelection;
  const options = useRef({ onRange, playback }), previousUndo = useRef(undoStep);
  options.current = { onRange, playback };
  useEffect(() => {
    view.current = new EditorView({
      parent: parent.current!,
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        EditorView.contentAttributes.of(label ? { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' } : {}),
        EditorView.updateListener.of((u) => {
          const external = u.transactions.some(t => t.annotation(fromParent));
          if (u.docChanged && !external) callback.current?.(u.state.doc.toString());
          if (options.current.onRange && (u.selectionSet || u.docChanged)) {
            const { from, to } = u.state.selection.main;
            options.current.onRange({ from, to });
            if (u.selectionSet && !external && from !== to) options.current.playback?.pause();
          }
          if (u.selectionSet)
            select.current?.(u.state.sliceDoc(u.state.selection.main.from, u.state.selection.main.to));
        }),
        editorAppearance
      ]
    });
    const scroller = view.current.scrollDOM;
    let dragging = false;
    const pause = () => { if (options.current.playback?.active) options.current.playback.pause(); };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) pause(); };
    const pointer = () => { dragging = true; };
    const release = () => { dragging = false; };
    const scroll = () => { if (dragging && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 8) pause(); };
    const key = (event: KeyboardEvent) => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause(); };
    scroller.addEventListener('wheel', wheel, { passive: true });
    scroller.addEventListener('pointerdown', pointer);
    window.addEventListener('pointerup', release);
    scroller.addEventListener('scroll', scroll);
    scroller.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerup', release);
      scroller.removeEventListener('pointerdown', pointer);
      scroller.removeEventListener('scroll', scroll);
      scroller.removeEventListener('wheel', wheel);
      scroller.removeEventListener('keydown', key);
      view.current?.destroy();
    };
  }, [readOnly, label]);
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const record = undoStep !== previousUndo.current;
    previousUndo.current = undoStep;
    if (record && undoBase !== undefined && v.state.doc.toString() !== undoBase) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: undoBase },
        annotations: [fromParent.of(true), Transaction.addToHistory.of(false)] });
    }
    const previous = v.state.doc.toString();
    if (previous === value) return;
    // Preserve the already laid-out prefix, selection and history during streaming.
    let from = 0, oldEnd = previous.length, newEnd = value.length;
    while (from < oldEnd && from < newEnd && previous[from] === value[from]) from++;
    while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === value[newEnd - 1]) { oldEnd--; newEnd--; }
    v.dispatch({ changes: { from, to: oldEnd, insert: value.slice(from, newEnd) },
      annotations: [fromParent.of(true), record ? isolateHistory.of('full') : Transaction.addToHistory.of(false)] });
  }, [value, undoStep, undoBase]);
  useLayoutEffect(() => {
    const v = view.current;
    if (clearSelection && v && !v.state.selection.main.empty) {
      v.dispatch({ selection: { anchor: v.state.selection.main.head }, annotations: fromParent.of(true) });
    }
  }, [clearSelection]);
  useLayoutEffect(() => {
    if (!playback?.active || !playback.follow) return;
    const id = requestAnimationFrame(() => {
      const el = view.current?.scrollDOM;
      if (el && options.current.playback?.follow) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [value, playback?.active, playback?.follow]);
  useEffect(() => {
    if (!highlight || !view.current) return;
    const chars = Array.from(value),
      from = chars.slice(0, highlight.start).join('').length,
      to = chars.slice(0, highlight.end).join('').length;
    view.current.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' })
    });
  }, [highlight?.start, highlight?.end, value]);
  return <div className="editor" ref={parent} />;
}
export function Difference({ before, after }: { before: string; after: string }) {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = new MergeView({
      parent: parent.current!,
      a: {
        doc: before,
        extensions: [markdown(), editorAppearance, EditorView.editable.of(false), EditorView.lineWrapping]
      },
      b: {
        doc: after,
        extensions: [markdown(), editorAppearance, EditorView.editable.of(false), EditorView.lineWrapping]
      },
      highlightChanges: true,
      gutter: true
    });
    return () => v.destroy();
  }, [before, after]);
  return <div className="merge" ref={parent} />;
}
