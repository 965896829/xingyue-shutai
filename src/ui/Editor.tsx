import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
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
export function Editor({
  value,
  onChange,
  onSelection,
  readOnly = false
}: {
  value: string;
  onChange?: (v: string) => void;
  onSelection?: (v: string) => void;
  readOnly?: boolean;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callback = useRef(onChange),
    select = useRef(onSelection);
  callback.current = onChange;
  select.current = onSelection;
  useEffect(() => {
    view.current = new EditorView({
      parent: parent.current!,
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) callback.current?.(u.state.doc.toString());
          if (u.selectionSet)
            select.current?.(u.state.sliceDoc(u.state.selection.main.from, u.state.selection.main.to));
        }),
        editorAppearance
      ]
    });
    return () => view.current?.destroy();
  }, [readOnly]);
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
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
