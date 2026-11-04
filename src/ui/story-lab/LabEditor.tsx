import { useRef, useState } from 'react';
import { MarkdownContent } from '../MarkdownContent';
import { labHeadings, labStale, type LabDetail, type LabVersion } from '../../shared/story-lab';

export interface LabSelection {
  start: number;
  end: number;
  text: string;
}
export function LabEditor({
  detail,
  version,
  busy,
  onEdit,
  onSelectVersion,
  onSelection,
  onRevise,
  onPin,
  onExport
}: {
  detail: LabDetail;
  version: LabVersion;
  busy: boolean;
  onEdit: (content: string) => Promise<void>;
  onSelectVersion: (reviewed: boolean) => Promise<void>;
  onSelection: (selection: LabSelection) => void;
  onRevise: (selection: LabSelection) => void;
  onPin: (text: string) => void;
  onExport: (format: 'md' | 'txt', copy?: boolean) => void;
}) {
  const key = `story-lab:edit:${version.sessionId}:${version.id}`;
  const [content, setContent] = useState(() => {
    try {
      return localStorage.getItem(key) ?? version.content;
    } catch {
      return version.content;
    }
  });
  const [editing, setEditing] = useState(content !== version.content),
    [reviewed, setReviewed] = useState(false),
    [compare, setCompare] = useState(false);
  const [error, setError] = useState(''),
    [selection, setSelection] = useState<LabSelection>();
  const editor = useRef<HTMLTextAreaElement>(null),
    reading = useRef<HTMLDivElement>(null);
  const currentId =
    version.kind === 'prose' ? detail.session.currentProseId : detail.session.currentVersionId;
  const current = detail.versions.find((v) => v.id === currentId);
  const request = detail.requests.find((r) => r.id === version.requestId);
  const stale =
    labStale(detail.session, version) ||
    (version.kind === 'prose' &&
      !!request &&
      request.input.baseVersionId !== detail.session.currentVersionId);
  const headings = labHeadings(version.content);
  const dirty = content !== version.content;
  function choose(value: LabSelection) {
    setSelection(value);
    onSelection(value);
  }
  function selectedReading() {
    const value = window.getSelection();
    if (!value?.anchorNode || !reading.current?.contains(value.anchorNode)) return;
    const text = value.toString();
    const start = version.content.indexOf(text);
    if (text.trim() && start >= 0 && version.content.indexOf(text, start + 1) < 0)
      choose({ start, end: start + text.length, text });
  }
  return (
    <section className="lab-editor" aria-label="方案与试稿版本">
      <div className="lab-toolbar">
        <strong>{version.title}</strong>
        <span className="lab-tag">
          {version.kind === 'prose' ? '正文' : version.kind === 'discussion' ? '讨论' : '方案'} ·{' '}
          {version.source === 'edit' ? '手改' : '候选'}
        </span>
        {currentId === version.id && <span className="lab-tag">当前选定</span>}
        {version.partial && <span className="lab-tag">未完整结束 · 可继续</span>}
      </div>
      <div className="lab-toolbar">
        <button onClick={() => setEditing(!editing)}>{editing ? '阅读' : '编辑 / 选择原文'}</button>
        <button
          onClick={() => {
            setCompare(!compare);
            setReviewed(false);
          }}
          disabled={!current || current.id === version.id}
        >
          {compare ? '收起比较' : '与当前版本比较'}
        </button>
        <button onClick={() => onExport('md', true)}>复制</button>
        <button onClick={() => onExport('md')}>导出 Markdown</button>
        <button onClick={() => onExport('txt')}>导出文本</button>
      </div>
      {stale && <p className="lab-warning">这份候选基于较早版本。查看差异后再采用，较新原稿始终保留。</p>}
      {compare && current && (
        <div className="lab-compare">
          <section>
            <h4>当前选定 · {current.title}</h4>
            <pre>{current.content}</pre>
          </section>
          <section>
            <h4>此候选 · {version.title}</h4>
            <pre>{version.content}</pre>
          </section>
        </div>
      )}
      {stale && compare && (
        <label className="lab-check">
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          我已比较，选用此候选并保留历史版本
        </label>
      )}
      {stale && !current && (
        <label className="lab-check">
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          我已检查来源版本，选用此候选
        </label>
      )}
      {version.kind !== 'discussion' && (
        <button
          className="primary"
          disabled={busy || dirty || currentId === version.id || (!!stale && !reviewed)}
          onClick={() => void onSelectVersion(reviewed)}
        >
          选为当前{version.kind === 'prose' ? '试稿' : '方案'}
        </button>
      )}
      {!!headings.length && (
        <details className="lab-toc">
          <summary>方案目录 · {headings.length} 个标题（点击选择原文范围）</summary>
          <nav aria-label="文稿目录">
            {headings.map((h) => (
              <button
                key={h.start}
                onClick={() => {
                  choose({ start: h.start, end: h.end, text: version.content.slice(h.start, h.end) });
                  setEditing(true);
                  requestAnimationFrame(() => {
                    editor.current?.focus();
                    editor.current?.setSelectionRange(h.start, h.end);
                  });
                }}
              >
                {h.title}
              </button>
            ))}
          </nav>
        </details>
      )}
      {editing ? (
        <>
          <textarea
            ref={editor}
            className="lab-manuscript"
            aria-label="编辑实验室文稿"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setSelection(undefined);
              try {
                localStorage.setItem(key, e.target.value);
              } catch {
                setError('本机编辑缓存保存失败，请及时保存候选。');
              }
            }}
            onSelect={(e) => {
              if (dirty) return;
              const { selectionStart: start, selectionEnd: end } = e.currentTarget;
              if (end > start) choose({ start, end, text: content.slice(start, end) });
            }}
          />
          <button
            disabled={busy || !dirty || !content.trim()}
            onClick={() =>
              void onEdit(content)
                .then(() => {
                  localStorage.removeItem(key);
                })
                .catch((e) => setError(String(e)))
            }
          >
            保存手改候选
          </button>
          <small>手改保留为新版本，满意后选为当前方案。</small>
        </>
      ) : (
        <div ref={reading} onMouseUp={selectedReading}>
          <MarkdownContent content={version.content} />
        </div>
      )}
      {selection && !dirty && (
        <div className="lab-selection">
          <small>已选择 {selection.text.length} 字符 · 局部修改会保留其余原文</small>
          <button onClick={() => onPin(selection.text)}>后续保留</button>
          <button onClick={() => onRevise(selection)}>用这段做局部修改</button>
        </div>
      )}
      {dirty && <p className="muted">请先保存手改候选，再选择局部修改范围。</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
