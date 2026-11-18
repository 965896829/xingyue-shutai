import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDown, FileText, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { invokeCommand } from '../shared/client';
import type { CommandOutput } from '../shared/contracts';
import type { Run, Snapshot } from '../shared/types';
import { manuscriptTarget, mergeManuscript, replaceManuscriptPassage, requestsManuscript, type ManuscriptEdit } from '../shared/manuscript-edit';
import { Editor } from './Editor';
import { proseBinding, proseFile, useLiveStream } from './useLiveStream';

export interface WritingDeskHandle {
  target(instruction: string, explicit?: boolean): ManuscriptEdit | undefined;
  show(id: string, target: ManuscriptEdit): void;
  clear(): void;
}
export interface WritingComposer {
  target(instruction: string, explicit?: boolean): Promise<ManuscriptEdit | undefined>;
  show(id: string, target: ManuscriptEdit): void;
  count: number;
  clear(): void;
}
export function SelectionChip({ desk }: { desk: WritingComposer }) {
  return desk.count > 0 ? <div className="desk-selection"><button type="button" onClick={desk.clear} title="取消选区">
    已选中 {desk.count} 字 · 改写选区 <X size={12} /></button></div> : null;
}

type Pending = { id: string; target: ManuscriptEdit; basis?: string };
type LocalDraft = { base: string; text: string };
type Reply = CommandOutput<'chat.manuscript'>;
const lf = (value: string) => value.replace(/\r\n?/g, '\n');
function cached<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
export function readWorkingDraft(projectKey: string, projectId: string, path: string, runId: string | undefined, source: string): LocalDraft | null {
  const draft = cached<LocalDraft>('draft:' + projectKey + ':manuscript:' + path);
  if (draft && typeof draft.text === 'string' && typeof draft.base === 'string') return draft;
  try {
    const suffix = ':' + (runId ?? '') + ':' + path;
    const text = localStorage.getItem('draft:' + projectKey + suffix) ?? localStorage.getItem('draft:' + projectId + suffix);
    if (text !== null && lf(text) !== source) return { base: source, text: lf(text) };
  } catch { /* The accepted document is still available. */ }
  return null;
}
function useManuscriptReply(pending: Pending | null, session: string | undefined, report: (message: string) => void) {
  const [result, setResult] = useState<Reply>();
  const id = pending?.id;
  useEffect(() => {
    if (!id) return;
    let alive = true, sequence = 0, done = false;
    const read = async () => {
      const ticket = ++sequence;
      try {
        const next = await invokeCommand('chat.manuscript', { id });
        if (!alive || ticket !== sequence) return;
        done = next.message.status !== 'running';
        setResult(next);
      } catch (error) { if (alive && ticket === sequence) report((error as Error).message); }
    };
    void read();
    const timer = window.setInterval(() => { if (!done) void read(); }, 1000);
    const unsubscribe = window.wenxu?.onEvent(event => {
      if (!done && event.projectSessionId === session && event.resource === 'chat' && event.type === 'snapshot') void read();
    });
    return () => { alive = false; clearInterval(timer); unsubscribe?.(); };
  }, [id, session, report]);
  const reply = result?.message.turnId === id ? result : undefined;
  const text = useLiveStream({ session, kind: 'chat', id: id ?? '', conversation: reply?.message.conversationId, text: reply?.message.content ?? '', running: reply?.message.status === 'running' });
  return { text: lf(text), status: reply?.message.status };
}

export const WritingManuscript = forwardRef<WritingDeskHandle, {
  snapshot: Snapshot; path: string; storageKey: string; run?: Run; collapsed: boolean;
  onToggle: () => void; onSelection: (count: number) => void;
  onDetails: (text: string) => void; onSaved: (id: string) => void; refresh: () => Promise<void>;
}>(function WritingManuscript({ snapshot, path, storageKey, run, collapsed, onToggle, onDetails, onSelection, onSaved, refresh }, ref) {
  const project = snapshot.project!;
  const cacheKey = 'draft:' + storageKey + ':manuscript:' + path;
  const requestKey = cacheKey + ':request';
  const [draft, setDraft] = useState(() => cached<LocalDraft>(cacheKey));
  const [pending, setPending] = useState(() => cached<Pending>(requestKey));
  const [official, setOfficial] = useState<{ content: string; hash: string | null }>();
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [follow, setFollow] = useState(true), [undoStep, setUndoStep] = useState(0), [saving, setSaving] = useState(false);
  const range = useRef<{ from: number; to: number } | undefined>(undefined);
  const captured = useRef<{ target: ManuscriptEdit; basis: string } | undefined>(undefined);
  const [clearSelection, setClearSelection] = useState(0), [undoBase, setUndoBase] = useState<string>();
  const restored = useRef(false);
  const lastEdit = useRef({ count: 0, text: '' });
  const acceptedHash = snapshot.documents.find(item => item.path === path)?.acceptedHash ?? null;
  useEffect(() => {
    let active = true;
    if (!acceptedHash) setOfficial({ content: '', hash: null });
    else void invokeCommand('document.read', { path, hash: acceptedHash }).then(doc => {
      if (active) setOfficial(doc);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path, acceptedHash, snapshot.projectSessionId]);
  const ready = !!official && official.hash === acceptedHash;
  const sourceChange = run?.changes.find(c => c.path === path);
  const streamed = useLiveStream(run?.pipeline ? proseBinding(snapshot.projectSessionId, run) :
    { session: snapshot.projectSessionId, kind: 'prose', id: '', text: '', running: false });
  const primaryProse = !!run?.pipeline && path === proseFile(run.chapter);
  const running = primaryProse && run.status === 'running' && run.pipeline!.phase === 'prose';
  const raw = (primaryProse && (running || sourceChange) ? streamed : sourceChange?.content) ?? official?.content ?? '';
  const source = lf(raw);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    if (draft) return;
    const previous = readWorkingDraft(storageKey, project.id, path, run?.id, source);
    if (previous) storeDraft(previous);
  }, [ready, source, draft, storageKey, project.id, path, run?.id]);
  const working = draft ? mergeManuscript(draft.base, draft.text, source) : { text: source, conflict: false };
  const reply = useManuscriptReply(pending, snapshot.projectSessionId, setError);
  const fullPreview = pending?.target.mode === 'chapter' && !!reply.text && working.text === pending.target.original;
  const value = fullPreview ? reply.text : working.text;
  const onRange = useCallback(({ from, to }: { from: number; to: number }) => {
    range.current = from === to ? undefined : { from, to };
    onSelection(Array.from(value.slice(from, to)).length);
  }, [onSelection, value]);
  useEffect(() => () => onSelection(0), [onSelection]);
  function storeDraft(next: LocalDraft) {
    setDraft(next);
    try { localStorage.setItem(cacheKey, JSON.stringify(next)); setNotice('手稿已在本机保存'); }
    catch { setError('本机草稿空间不足，请保存为候选。'); }
  }
  function edit(next: string) {
    lastEdit.current = { count: lastEdit.current.count + 1, text: next };
    storeDraft({ base: working.conflict && draft ? draft.base : source, text: next });
  }
  function storeRequest(next: Pending | null) {
    setPending(next);
    try { if (next) localStorage.setItem(requestKey, JSON.stringify(next)); else localStorage.removeItem(requestKey); }
    catch { setError('正文候选的位置暂时无法保存在本机，可从右侧对话重新打开。'); }
  }
  useImperativeHandle(ref, () => ({
    target(instruction, explicit) {
      if (!range.current && !explicit && !requestsManuscript(instruction)) return;
      if (!ready) throw new Error('正在读取本章，请稍后发送。');
      const target = manuscriptTarget(project.id, path, value, range.current);
      captured.current = { target, basis: value };
      return target;
    },
    show(id, target) {
      if (target.path !== path || target.projectId !== project.id) return;
      const basis = captured.current?.target === target ? captured.current.basis : undefined;
      storeRequest({ id, target, basis });
      setError(''); setNotice(''); setFollow(true);
      range.current = undefined; setClearSelection(n => n + 1); onSelection(0);
    },
    clear() { range.current = undefined; setClearSelection(n => n + 1); onSelection(0); }
  }));
  const editableReply = pending && reply.status === 'complete' && !!reply.text;
  const replacement = editableReply ? replaceManuscriptPassage(working.text, pending.target, reply.text, pending.basis) : null;
  function applyReply() {
    if (replacement === null) return;
    setUndoBase(working.text);
    setUndoStep(n => n + 1);
    storeDraft({ base: source, text: replacement });
    storeRequest(null);
    setNotice('改写已应用到手稿');
  }
  async function save() {
    if (!ready || saving || running || working.conflict) return;
    setSaving(true); setError('');
    const editCount = lastEdit.current.count;
    const content = /\r\n/.test(raw) ? value.replace(/\n/g, '\r\n') : value;
    try {
      const expectedHash = sourceChange && Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(sourceChange.content))), byte => byte.toString(16).padStart(2, '0')).join('');
      const result = run && sourceChange
        ? await invokeCommand('run.update', { id: run.id, path, content, expectedHash })
        : await invokeCommand('document.save', { path, baseHash: official!.hash, content });
      // The saved candidate now includes both the stream and the author's edits.
      storeDraft({ base: value, text: lastEdit.current.count === editCount ? value : lastEdit.current.text });
      onSaved(typeof result === 'string' ? result : result.id);
      await refresh();
      setNotice('已保存为候选，可在创作任务中审阅');
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  const active = running || (!!pending && (!reply.status || reply.status === 'running'));
  const pause = useCallback(() => setFollow(false), []);
  const candidate = pending && !fullPreview ? reply.text : working.conflict ? source : '';
  return <section className="desk-manuscript" aria-label="正文编辑区">
    <header className="desk-heading">
      <div><FileText size={17}/><h2>{path.split('/').at(-1)?.replace(/\.md$/, '')}</h2><small>正文</small></div>
      <div><button className="desk-doc-tools" onClick={() => onDetails(working.text)}>文稿与历史</button>
        <button className="icon" aria-label={collapsed ? '展开 AI 对话' : '收起 AI 对话'} title={collapsed ? '展开 AI 对话' : '收起 AI 对话'} aria-expanded={!collapsed} onClick={onToggle}>
          {collapsed ? <PanelRightOpen size={17}/> : <PanelRightClose size={17}/>}
        </button></div>
    </header>
    {error && <p role="alert" className="inline-warning">{error}</p>}
    {ready || running ? <Editor label="正文手稿" value={value} onChange={edit} onRange={onRange} undoStep={undoStep} undoBase={undoBase} clearSelection={clearSelection}
      playback={{ active: !!active, follow, pause }} /> : <p className="muted">正在读取正文…</p>}
    {(pending || working.conflict) && <section className="desk-candidate" aria-label="AI 改写候选">
      <div><strong>{pending?.target.mode === 'passage' ? '选区改写' : 'AI 正文候选'}</strong>
        <small>{working.conflict || (editableReply && replacement === null) ? '手稿有修改，已保留两版' : active ? '正在生成' : reply.status && reply.status !== 'complete' ? '仅收到部分内容' : '待采用'}</small></div>
      {candidate && <div className="desk-candidate-text" tabIndex={0}>{candidate}</div>}
      <div>{pending ? <>
        <button disabled={!editableReply || replacement === null} onClick={applyReply}>{pending.target.mode === 'passage' ? '采用选区改写' : '采用正文候选'}</button>
        <button onClick={() => storeRequest(null)}>保留手稿</button>
      </> : <>
        <button onClick={() => { setUndoBase(working.text); setUndoStep(n => n + 1); storeDraft({ base: source, text: source }); }}>采用 AI 候选</button>
        <button onClick={() => storeDraft({ base: source, text: working.text })}>保留手稿</button>
      </>}</div>
    </section>}
    <footer><small role="status">{notice || (active ? '正在生成' : draft ? '本机草稿' : '当前文稿')} · {Array.from(value.replace(/\s/g, '')).length} 字</small>
      <div>{!follow && active && <button onClick={() => setFollow(true)}><ArrowDown size={13}/>回到生成处</button>}
        <button disabled={!ready || saving || run?.status === 'running' || !!fullPreview || working.conflict || !draft || value === source} onClick={() => void save()}>保存为候选</button></div></footer>
  </section>;
});
