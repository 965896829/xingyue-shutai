import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
  BookOpen,
  Feather,
  Plus,
  FolderOpen,
  Settings,
  Sparkles,
  Search,
  FileText,
  ArrowUp,
  Square,
  Check,
  ChevronRight,
  X,
  History,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Download,
  Upload,
  Shield,
  Layers,
  Image as ImageIcon,
  ArrowRight,
  RotateCcw,
  Terminal,
  MoreHorizontal,
  AlertCircle,
  Trash2
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  configSchema,
  stageIds,
  type Snapshot,
  type Run,
  type Profile,
  type Command,
  type ContextManifest,
  type ProjectConfig
} from '../shared/types';
import { Editor, Difference } from './Editor';
import { LegacyDialog } from './LegacyDialog';
import { ProviderSettings as ModelSettings } from './ProviderSettings';
import { modelLabel } from './model-label';
import { ThemeToggle } from './ThemeToggle';
import { DeleteButton } from './DeleteButton';
import { ProximitySidebar, type ProximitySection } from './ProximitySidebar';
import { RecycleBin } from './RecycleBin';
import { ChatWorkspace } from './ChatWorkspace';
import { AssistantSettings } from './AssistantSettings';
import { MemoryStudio, CharacterInspector, SourceDialog } from './MemoryStudio';
import { NarrativePanel } from './NarrativePanel';
import { SkillLauncher } from './SkillLauncher';
import { ExpressionSettings } from './ExpressionSettings';
import type { SourceRef } from '../shared/studio';
import { gateEvent, syncEventCursor, type EventCursor } from '../shared/event-gate';
import './studio.css';
import './assistant.css';

const names = {
  S01: '设定拆解',
  S02: '项目与文风',
  S03: '世界规则',
  S04: '人物与连续性',
  S05: '分卷大纲',
  S06: '章节总纲',
  S07: '批次节奏',
  S08: '批量细纲',
  S09: '单章设计',
  S10: '正文生成',
  S11: '章后更新'
};
const status: Record<string, string> = {
  running: '正在执行',
  awaiting_review: '等待审阅',
  needs_repair: '需要修改',
  paused: '已暂停',
  unknown: '请求结果未知',
  stale: '需重新核对',
  failed: '失败',
  committing: '正在提交',
  complete: '已接受',
  discarded: '已放弃',
  awaiting_input: '等待回答',
  awaiting_permission: '等待授权'
};
const empty: Snapshot = {
  project: null,
  documents: [],
  runs: [],
  events: [],
  profiles: [],
  recent: [],
  facts: [],
  issues: []
};
const btn = (icon: ReactNode, text: string) => (
  <>
    {icon}
    <span>{text}</span>
  </>
);
const invoke = <T,>(command: Command, args: Record<string, unknown> = {}) => {
  if (!window.wenxu) throw new Error('请使用桌面客户端，浏览器预览不具备本地文件权限');
  return window.wenxu.invoke<T>(command, args);
};
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function App() {
  const [inspector, setInspector] = useState<'manuscript' | 'characters' | 'details'>('manuscript');
  const [source, setSource] = useState<SourceRef | null>(null);
  const [focus, setFocus] = useState(false);
  const refreshSeq = useRef(0),
    eventCursor = useRef<EventCursor>({ seq: 0, waiting: false });
  const [workView, setWorkView] = useState<'chat' | 'tasks'>('chat');
  const [agentSettings, setAgentSettings] = useState(false);
  const [snapshot, setSnapshot] = useState(empty),
    [page, setPage] = useState<'work' | 'memory' | 'cover'>('work'),
    [modal, setModal] = useState<'new' | 'settings' | 'project' | 'transfer' | 'legacy' | 'trash' | null>(
      null
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [request, setRequest] = useState(''),
    [mode, setMode] = useState('stage'),
    [profileId, setProfileId] = useState(''),
    [selectedRun, setSelectedRun] = useState(''),
    [query, setQuery] = useState(''),
    [editorOpen, setEditorOpen] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [flowExpanded, setFlowExpanded] = useState(false);
  const [doc, setDoc] = useState<{
      path: string;
      content: string;
      hash: string | null;
      runId?: string;
      before: string;
      disk?: string;
    } | null>(null),
    [text, setText] = useState(''),
    [selection, setSelection] = useState(''),
    [editorTab, setEditorTab] = useState('edit'),
    [histories, setHistories] = useState<{ hash: string; createdAt: string }[]>([]),
    [manifest, setManifest] = useState<ContextManifest | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const chatScroll = useRef<HTMLDivElement>(null);
  const [answer, setAnswer] = useState(''),
    [memory, setMemory] = useState<any>(null),
    [memoryChapter, setMemoryChapter] = useState(''),
    [timeline, setTimeline] = useState(false),
    [deltas, setDeltas] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    const requestId = ++refreshSeq.current;
    try {
      const s = await invoke<Snapshot>('app.snapshot');
      if (requestId !== refreshSeq.current) return;
      syncEventCursor(eventCursor.current, s);
      setSnapshot(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const act = async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setError('');
    setBusy(true);
    try {
      const r = await action();
      if (success) setNotice(success);
      await refresh();
      return r;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
    let timeout: ReturnType<typeof setTimeout>;
    const unsub = window.wenxu?.onEvent((event) => {
      const decision = gateEvent(eventCursor.current, event);
      if (decision === 'ignore') return;
      if (decision === 'refresh') {
        setDeltas({});
        void refresh();
        return;
      }
      if (event.type === 'delta')
        setDeltas((d) => ({ ...d, [event.runId!]: ((d[event.runId!] ?? '') + event.text).slice(-20000) }));
      else if (event.type === 'error') setError(event.text ?? '执行错误');
      else {
        if (!timeout)
          timeout = setTimeout(() => {
            timeout = undefined as any;
            void refresh();
          }, 350);
      }
    });
    return () => {
      unsub?.();
      clearTimeout(timeout);
    };
  }, [refresh]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 6500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    try {
      for (const item of snapshot.purgedDrafts ?? []) {
        const marker = `trash-drafts-cleaned:${item.entryId}`;
        if (localStorage.getItem(marker)) continue;
        for (const key of Object.keys(localStorage))
          if (key.startsWith(`draft:${item.projectId}:`)) localStorage.removeItem(key);
        localStorage.setItem(marker, '1');
      }
    } catch {
      setError('回收站作品已清理，但本机编辑草稿缓存清理未完成，请重新启动后检查。');
    }
  }, [snapshot.purgedDrafts]);
  const p = snapshot.project,
    run = snapshot.runs.find((r) => r.id === selectedRun) ?? snapshot.runs[0],
    running = snapshot.runs.find((r) => r.status === 'running'),
    dirty = doc && text !== doc.content;
  useEffect(() => {
    const active = snapshot.runs.find((r) => r.status === 'running' && r.pipeline);
    const prose = active?.changes.find((c) => c.path.startsWith('07_'));
    if (!active || !prose || (dirty && doc?.runId !== active.id)) return;
    setDoc({
      path: prose.path,
      content: prose.content,
      hash: prose.baseHash,
      runId: active.id,
      before: doc?.runId === active.id ? doc.before : ''
    });
    setText(prose.content);
    setEditorOpen(true);
    setInspector('manuscript');
    setEditorTab('edit');
  }, [snapshot.runs.find((r) => r.status === 'running' && r.pipeline)?.pipeline?.version]);
  useEffect(() => {
    if (!doc?.runId || !dirty || running || !doc.path.startsWith('07_')) return;
    const timer = setTimeout(() => {
      void invoke('draft.checkpoint', { id: doc.runId, content: text }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [text, doc?.runId]);
  useEffect(() => {
    setWorkView('chat');
  }, [p?.id]);
  useEffect(() => {
    if (!profileId || !snapshot.profiles.some((p) => p.id === profileId))
      setProfileId(
        (snapshot.profiles.some((x) => x.id === p?.config.defaultProfileId)
          ? p?.config.defaultProfileId
          : '') ||
          snapshot.profiles.find((p) => p.protocol !== 'images')?.id ||
          ''
      );
  }, [snapshot.profiles, p?.id]);
  useEffect(() => {
    if (doc) {
      try {
        localStorage.setItem(`draft:${p?.id}:${doc.runId ?? ''}:${doc.path}`, text);
      } catch {
        setError('本地草稿缓存空间不足，请立即保存候选');
      }
    }
  }, [text]);
  async function openDoc(relative: string, r?: Run) {
    if (dirty && !confirm('编辑内容已保存在本机草稿缓存中。切换文档？')) return;
    await act(async () => {
      let old = { content: '', hash: null as string | null };
      try {
        old = await invoke('document.read', { path: relative });
      } catch {
        if (!r) throw new Error('无法读取文件');
      }
      const candidate = r?.changes.find((c) => c.path === relative),
        value = candidate?.content ?? old.content;
      const draft = localStorage.getItem(`draft:${p?.id}:${r?.id ?? ''}:${relative}`);
      let baseline = old.content;
      if (candidate?.baseHash) {
        try {
          baseline = (
            await invoke<{ content: string }>('document.read', { path: relative, hash: candidate.baseHash })
          ).content;
        } catch {
          /* external changes may have no accepted revision yet */
        }
      }
      setDoc({
        path: relative,
        hash: candidate ? candidate.baseHash : old.hash,
        content: value,
        runId: r?.id,
        before: baseline,
        disk: old.content
      });
      setText(draft ?? value);
      setEditorOpen(true);
      setEditorTab(r ? 'diff' : 'edit');
      setHistories([]);
    });
  }
  async function saveDraft() {
    if (!doc) return;
    if (doc.runId && snapshot.runs.find((r) => r.id === doc.runId)?.accepted) {
      setError('该候选已经接受。请从左侧重新打开正式文件后创建新的修订。');
      return;
    }
    const r = await act<Run | string>(
      () =>
        doc.runId
          ? invoke<Run>('run.update', { id: doc.runId, path: doc.path, content: text })
          : invoke<string>('document.save', { path: doc.path, baseHash: doc.hash, content: text }),
      '已保存为候选，请在结果区审阅并接受'
    );
    if (r) {
      setWorkView('tasks');
      setSelectedRun(typeof r === 'string' ? r : r.id);
      setDoc({ ...doc, content: text, runId: typeof r === 'string' ? r : r.id });
    }
  }
  async function start() {
    if (!p || !request.trim()) return;
    const id = await act(() =>
      invoke<string>('run.start', {
        request: request.trim(),
        profileId,
        mode
      })
    );
    if (id) {
      setSelectedRun(id);
      setRequest('');
    }
  }
  function openProjectDirectory() {
    void act(async () => {
      const root = await invoke<string | null>('app.chooseDirectory');
      if (root) {
        setDoc(null);
        setSelectedRun('');
        return invoke('project.open', { root });
      }
    });
  }
  async function trashProject(root: string) {
    return (
      (await act(async () => {
        await invoke('project.trash', { root });
        if (p?.root === root) {
          setDoc(null);
          setText('');
          setSelectedRun('');
          setEditorOpen(false);
          setMemory(null);
          setManifest(null);
          setRequest('');
          setPage('work');
        }
        return true;
      }, '作品已移入回收站，七天内可恢复，到期自动永久删除本地文件')) === true
    );
  }
  const filteredDocs = snapshot.documents.filter((d) => !query || d.path.includes(query));
  const chatSections: ProximitySection[] = run
    ? [
        { id: 'chat-request', label: '你的任务', kind: 'title' },
        { id: 'chat-execution', label: '执行与上下文', kind: 'subtitle' },
        ...(run.responseText || deltas[run.id]
          ? [{ id: 'chat-response', label: '模型回复', kind: 'section' as const }]
          : []),
        ...(run.changes.length
          ? [{ id: 'chat-candidates', label: '候选改动', kind: 'section' as const }]
          : []),
        ...(run.facts.length ? [{ id: 'chat-facts', label: '候选记忆', kind: 'body' as const }] : []),
        ...(run.issues.length ? [{ id: 'chat-issues', label: '检查结果', kind: 'body' as const }] : []),
        ...(timeline ? [{ id: 'chat-events', label: '执行日志', kind: 'body' as const }] : []),
        ...(['awaiting_input', 'awaiting_permission', 'awaiting_review', 'needs_repair'].includes(
          run.status
        ) && !run.accepted
          ? [{ id: 'chat-decision', label: '待你确认', kind: 'subtitle' as const }]
          : []),
        { id: 'chat-usage', label: '调用统计', kind: 'body' }
      ]
    : [];
  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${focus && editorOpen && page === 'work' ? 'studio-focus' : ''}`}
    >
      <aside className="sidebar" aria-label="作品与功能导航">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Feather size={24} strokeWidth={1.7} />
          </div>
          <div>
            <b>文序</b>
          </div>
          <button
            className="icon sidebar-toggle"
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <div className="sidebar-action">
          <button aria-label="新建作品" title="新建作品" onClick={() => setModal('new')}>
            {btn(<Plus size={16} />, '新建作品')}
          </button>
          <button
            className="icon"
            aria-label="打开作品目录"
            title="打开作品目录"
            onClick={openProjectDirectory}
          >
            <FolderOpen size={18} />
          </button>
        </div>
        <div className="section-label">创作空间</div>
        <nav>
          {[
            ['work', BookOpen, '写作工作台'],
            ['memory', Layers, '记忆与连续性'],
            ['cover', ImageIcon, '封面设计']
          ].map(([key, Icon, label]) => (
            <button
              key={String(key)}
              className={page === key ? 'active' : ''}
              aria-label={String(label)}
              title={String(label)}
              onClick={() => setPage(key as any)}
            >
              {btn(<Icon size={17} />, String(label))}
              {page === key && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <div className="section-label spaced">
          当前作品{' '}
          {p && (
            <button className="icon" aria-label="作品设置" onClick={() => setModal('project')}>
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
        {p ? (
          <>
            <div className="current-book">
              <FolderOpen className="book-folder" size={18} />
              <div className="current-book-title">
                <b>{p.title}</b>
                <small>
                  {Object.values(p.chapters).filter((s) => s === 'complete').length} 章完整完成 · 本地作品
                </small>
              </div>
              <DeleteButton
                compact
                disabled={busy || !!running}
                label={`删除作品 ${p.title}`}
                description="关闭并移入回收站，七天内可恢复；七天后自动永久删除本地文稿、候选和历史。当前任务输入会清空。"
                onConfirm={() => trashProject(p.root)}
              />
            </div>
            <div className="file-search">
              <Search size={14} />
              <input
                aria-label="筛选作品文件"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="查找章节与资料"
              />
            </div>
            <div className="files">
              {filteredDocs.map((d) => (
                <button
                  key={d.path}
                  title={d.path}
                  className={doc?.path === d.path ? 'selected' : ''}
                  onClick={() => void openDoc(d.path)}
                >
                  <FileText size={14} />
                  <span>{d.path.split('/').at(-1)?.replace('.md', '')}</span>
                  {d.status !== 'accepted' && <i title="外部修改待确认" />}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="sidebar-empty">
            创建一部作品，
            <br />
            从你的第一个设定开始。
          </div>
        )}
        {!p && snapshot.recent.length > 0 && (
          <div className="recent">
            {snapshot.recent.map((r) => (
              <div className="recent-book-row" key={r.root}>
                <button onClick={() => void act(() => invoke('project.open', { root: r.root }))}>
                  <BookOpen size={14} />
                  <span>{r.title}</span>
                </button>
                <DeleteButton
                  compact
                  disabled={busy}
                  label={`删除作品 ${r.title}`}
                  description={`将「${r.title}」移入回收站，保留七天；到期自动永久删除本地文稿、候选和历史。`}
                  onConfirm={() => trashProject(r.root)}
                />
              </div>
            ))}
          </div>
        )}
        <div className="sidebar-bottom">
          <button
            aria-label="智能体与联网设置"
            title="智能体与联网设置"
            onClick={() => setAgentSettings(true)}
          >
            {btn(<Sparkles size={16} />, '智能体与联网设置')}
          </button>
          <button aria-label="作品回收站" title="作品回收站" onClick={() => setModal('trash')}>
            {btn(<Trash2 size={16} />, '回收站')}
          </button>
          <button aria-label="导入旧 Skill 档案" title="导入旧 Skill 档案" onClick={() => setModal('legacy')}>
            {btn(<FolderOpen size={16} />, '导入旧 Skill 档案')}
          </button>
          <button aria-label="导入、导出与备份" title="导入、导出与备份" onClick={() => setModal('transfer')}>
            {btn(<Download size={16} />, '导入、导出与备份')}
          </button>
          <button aria-label="模型与连接设置" title="模型与连接设置" onClick={() => setModal('settings')}>
            {btn(<Settings size={16} />, '模型与连接设置')}
          </button>
          <div className="local">
            <span />
            本地创作空间
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            创作空间 <ChevronRight size={14} />
            <b>{p?.title ?? '我的工作台'}</b>
          </div>
          <div className="top-actions">
            <ThemeToggle />
            <span className="save-state">
              <span />
              {running ? '任务执行中' : '文稿保存在本机'}
            </span>
            {p && (
              <button
                className="icon"
                aria-label="打开作品文件夹"
                onClick={() => void act(() => invoke('app.reveal'))}
              >
                <FolderOpen size={17} />
              </button>
            )}
            <button
              className="panel-toggle"
              aria-label="切换编辑面板"
              disabled={!p || page !== 'work'}
              aria-pressed={editorOpen}
              title="文稿、差异与历史"
              onClick={() => setEditorOpen(!editorOpen)}
            >
              {editorOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              <span>文稿面板</span>
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="banner error">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button className="icon" aria-label="关闭错误" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="banner notice">
            <Check size={16} />
            {notice}
          </div>
        )}
        {!p ? (
          <div className="welcome">
            <div className="welcome-symbol">
              <Feather size={32} strokeWidth={1.7} />
            </div>
            <h1>今天，写下哪一段故事？</h1>
            <div className="welcome-actions">
              <button className="primary large" onClick={() => setModal('new')}>
                {btn(<Plus size={18} />, '创建我的第一部作品')}
              </button>
              <button className="large" onClick={openProjectDirectory}>
                {btn(<FolderOpen size={18} />, '打开已有作品')}
              </button>
            </div>
          </div>
        ) : page === 'memory' ? (
          <MemoryStudio
            key={p.id}
            snapshot={snapshot}
            onSource={setSource}
            onRefresh={() => void refresh()}
          />
        ) : page === 'cover' ? (
          <Cover key={p.id} profiles={snapshot.profiles} title={p.title} act={act} />
        ) : (
          <div className={`workspace ${focus ? 'studio-focus' : ''}`}>
            <div className="work-area">
              <div className="work-tabs">
                <SkillLauncher
                  profileId={profileId}
                  onRun={(id) => {
                    if (id) setSelectedRun(id);
                    setWorkView('tasks');
                    void refresh();
                  }}
                />
                <button className={workView === 'chat' ? 'active' : ''} onClick={() => setWorkView('chat')}>
                  创作讨论
                </button>
                <button className={workView === 'tasks' ? 'active' : ''} onClick={() => setWorkView('tasks')}>
                  创作任务
                </button>
              </div>
              {workView === 'chat' ? (
                <ChatWorkspace
                  key={p.id}
                  snapshot={snapshot}
                  profileId={profileId}
                  setProfileId={setProfileId}
                  refresh={refresh}
                  onRun={(id) => {
                    if (id) setSelectedRun(id);
                    setWorkView('tasks');
                  }}
                  onDocument={(relative) => void openDoc(relative)}
                  onSettings={() => setAgentSettings(true)}
                />
              ) : (
                <section className="conversation">
                  <div className="workflow-heading">
                    <div>
                      <h1>
                        {names[p.stage]}
                        <span className="stage-number">{p.stage}</span>
                      </h1>
                      <p>
                        第 {String(p.chapter).padStart(3, '0')} 章 · {p.config.chapterWords.toLocaleString()}{' '}
                        字 / 章 · 当前批次 {activeBatchText(p)}
                      </p>
                    </div>
                    <div className="workflow-actions">
                      <button
                        className="flow-toggle"
                        aria-expanded={flowExpanded}
                        aria-controls="writing-stages"
                        onClick={() => setFlowExpanded(!flowExpanded)}
                      >
                        创作流程 {stageIds.indexOf(p.stage) + 1} / {stageIds.length}
                        <ChevronDown size={14} />
                      </button>
                      <button
                        aria-label="写作参数"
                        title="写作参数"
                        className="icon"
                        onClick={() => setModal('project')}
                      >
                        <Settings size={16} />
                      </button>
                    </div>
                  </div>
                  <div id="writing-stages" className="stage-strip" hidden={!flowExpanded}>
                    {stageIds.map((s, i) => (
                      <div
                        key={s}
                        className={`${s === p.stage ? 'current' : ''} ${i < stageIds.indexOf(p.stage) ? 'past' : ''}`}
                        title={names[s]}
                      >
                        <span>
                          {i < stageIds.indexOf(p.stage) ? (
                            <Check size={12} />
                          ) : (
                            String(i + 1).padStart(2, '0')
                          )}
                        </span>
                        <small>{names[s]}</small>
                      </div>
                    ))}
                  </div>
                  {p.stale.length > 0 && (
                    <div className="inline-warning">
                      {p.stale.length} 项修订影响尚未闭环。
                      <button onClick={() => setPage('memory')}>
                        前往核对 <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                  <div className={`chat-layout ${run ? 'with-navigation' : ''}`}>
                    <ProximitySidebar
                      key={run?.id ?? 'empty'}
                      sections={chatSections}
                      scrollRef={chatScroll}
                    />
                    <div className="chat-scroll" ref={chatScroll}>
                      {!run ? (
                        <div className="start-card">
                          <div className="assistant-mark">
                            <Sparkles size={20} />
                          </div>
                          <h2>开始这一段创作</h2>
                        </div>
                      ) : (
                        <>
                          <div className="run-selector">
                            <select
                              aria-label="选择历史任务"
                              value={run.id}
                              onChange={(e) => setSelectedRun(e.target.value)}
                            >
                              {snapshot.runs.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.stage} · 第 {r.chapter} 章 · {status[r.status]} ·{' '}
                                  {new Date(r.createdAt).toLocaleTimeString()}
                                </option>
                              ))}
                            </select>
                            <button
                              className="icon"
                              onClick={() => setTimeline(!timeline)}
                              aria-label="显示执行日志"
                            >
                              <Terminal size={16} />
                            </button>
                          </div>
                          <div className="user-message" id="chat-request">
                            <small>你的任务</small>
                            <p>{run.request}</p>
                          </div>
                          <article className="assistant-message">
                            <div id="chat-execution">
                              <div className="assistant-label">
                                <div className="assistant-mark">
                                  <Sparkles size={16} />
                                </div>
                                <b>文序</b>
                                <span className={`status ${run.status}`}>{status[run.status]}</span>
                              </div>
                              {run.manifest && (
                                <button className="context-card" onClick={() => setManifest(run.manifest)}>
                                  <Layers size={16} />
                                  <div>
                                    <b>资料详情</b>
                                    <small>
                                      {run.manifest.sources.length} 份资料 · {run.manifest.factIds.length}{' '}
                                      条关联事实 · 项目版本 {run.manifest.projectRevision}
                                    </small>
                                  </div>
                                  <ChevronRight size={16} />
                                </button>
                              )}
                            </div>
                            {(run.responseText || deltas[run.id]) && (
                              <div className="model-text" id="chat-response">
                                {run.responseText || deltas[run.id]}
                              </div>
                            )}
                            {run.error && <p className="inline-warning">{run.error}</p>}
                            {!run.accepted && run.changes.length > 0 && (
                              <button
                                disabled={busy || !!running || snapshot.chatBusy}
                                onClick={() =>
                                  void act(
                                    () => invoke('run.revalidate', { id: run.id }),
                                    '已重新检查候选；未发起模型调用，也未自动接受'
                                  )
                                }
                              >
                                重新检查候选
                              </button>
                            )}
                            {run.changes.length > 0 && (
                              <div className="candidate-list" id="chat-candidates">
                                <div className="section-label">候选改动 · {run.changes.length} 个文件</div>
                                {run.changes.map((c) => (
                                  <button key={c.path} onClick={() => void openDoc(c.path, run)}>
                                    <FileText size={15} />
                                    <span title={c.path}>{c.path.split('/').at(-1)}</span>
                                    <span className="diff-count">
                                      {c.content.length.toLocaleString()} 字符
                                    </span>
                                    <ChevronRight size={14} />
                                  </button>
                                ))}
                              </div>
                            )}
                            {run.facts.length > 0 && (
                              <details id="chat-facts">
                                <summary>{run.facts.length} 条候选记忆 · 接受时同步</summary>
                                {run.facts.map((f) => (
                                  <p key={f.id}>
                                    {f.subject} · {f.predicate}：{f.value}
                                  </p>
                                ))}
                              </details>
                            )}
                            {run.issues.length > 0 && (
                              <details id="chat-issues" open={run.issues.some((i) => i.severity === 'error')}>
                                <summary>
                                  {run.issues.filter((i) => i.severity === 'error').length} 项阻断 ·{' '}
                                  {run.issues.filter((i) => i.severity === 'warning').length} 项审阅提醒
                                </summary>
                                {run.issues.map((i, n) => (
                                  <p
                                    key={n}
                                    className={`issue ${i.severity === 'error' ? 'error-text' : ''}`}
                                  >
                                    {i.path && <small>{i.path}</small>}
                                    {i.message}
                                  </p>
                                ))}
                              </details>
                            )}
                            {timeline && (
                              <div className="event-list" id="chat-events">
                                {snapshot.events
                                  .filter((e) => e.runId === run.id)
                                  .map((e) => (
                                    <div key={e.seq}>
                                      <time>{new Date(e.at).toLocaleTimeString()}</time>
                                      <span>{e.text}</span>
                                    </div>
                                  ))}
                              </div>
                            )}
                            {run.status === 'awaiting_input' && (
                              <div className="approval-box" id="chat-decision">
                                <b>{run.input?.question}</b>
                                <textarea
                                  aria-label="回答作者问题"
                                  value={answer}
                                  onChange={(e) => setAnswer(e.target.value)}
                                />
                                <button
                                  className="primary"
                                  onClick={() => void act(() => invoke('run.answer', { id: run.id, answer }))}
                                >
                                  提交回答并继续
                                </button>
                              </div>
                            )}
                            {run.status === 'awaiting_permission' && (
                              <div className="approval-box" id="chat-decision">
                                <h3>确认具体动作</h3>
                                <p>
                                  {run.permission?.kind === 'terminal'
                                    ? '终端具有当前 Windows 用户权限，项目目录不是系统沙箱。'
                                    : '即将访问以下地址。'}
                                </p>
                                <pre>{JSON.stringify(run.permission?.args, null, 2)}</pre>
                                <div className="button-row">
                                  <button
                                    className="primary"
                                    onClick={() =>
                                      void act(() => invoke('run.permission', { id: run.id, approved: true }))
                                    }
                                  >
                                    允许这一次
                                  </button>
                                  <button
                                    onClick={() =>
                                      void act(() =>
                                        invoke('run.permission', { id: run.id, approved: false })
                                      )
                                    }
                                  >
                                    拒绝并继续
                                  </button>
                                </div>
                              </div>
                            )}
                            {!run.accepted && ['awaiting_review', 'needs_repair'].includes(run.status) && (
                              <div className="approval-box" id="chat-decision">
                                <h3>{run.pipeline ? '正文与记忆待验收' : '候选待验收'}</h3>
                                {run.issues.some((i) => i.severity === 'warning') && (
                                  <label>
                                    保留警告的审阅理由
                                    <textarea
                                      value={reviewReason}
                                      onChange={(e) => setReviewReason(e.target.value)}
                                      placeholder="例如：已核对相关台词属于人物反驳，保留；连续性检查无冲突。"
                                    />
                                  </label>
                                )}
                                <div className="button-row">
                                  <button
                                    className="primary"
                                    disabled={busy || run.issues.some((i) => i.severity === 'error')}
                                    onClick={() =>
                                      void act(
                                        () =>
                                          invoke('run.accept', {
                                            proposalHash: run.proposalHash,
                                            id: run.id,
                                            startNext: run.mode === 'stage',
                                            warningReason: reviewReason
                                          }),
                                        run.mode === 'stage' ? '已接受结果，并授权下一阶段' : '已接受修订'
                                      )
                                    }
                                  >
                                    {run.mode === 'stage' ? '接受并继续' : '接受修改'}
                                  </button>
                                  {run.mode === 'stage' && (
                                    <button
                                      disabled={busy || run.issues.some((i) => i.severity === 'error')}
                                      onClick={() =>
                                        void act(
                                          () =>
                                            invoke('run.accept', {
                                              proposalHash: run.proposalHash,
                                              id: run.id,
                                              startNext: false,
                                              warningReason: reviewReason
                                            }),
                                          '已接受并暂停'
                                        )
                                      }
                                    >
                                      接受并暂停
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                            {!run.accepted && !['running', 'discarded'].includes(run.status) && (
                              <div className="button-row subdued">
                                <button
                                  onClick={() => {
                                    if (!profileId) return;
                                    if (
                                      run.status === 'unknown' &&
                                      !confirm('原请求状态未知，换模型继续可能产生新的费用。确认？')
                                    )
                                      return;
                                    void act(async () =>
                                      setSelectedRun(
                                        await invoke('run.handoff', {
                                          id: run.id,
                                          profileId,
                                          retryUnknown: run.status === 'unknown'
                                        })
                                      )
                                    );
                                  }}
                                >
                                  重建上下文 / 用所选模型继续
                                </button>
                                {['paused', 'unknown', 'needs_repair', 'awaiting_review'].includes(
                                  run.status
                                ) && (
                                  <button
                                    onClick={() => {
                                      if (
                                        run.status === 'unknown' &&
                                        !confirm('上次请求结果未知，重新请求可能重复计费。确认重新请求？')
                                      )
                                        return;
                                      void act(() =>
                                        invoke('run.resume', {
                                          id: run.id,
                                          retryUnknown: run.status === 'unknown',
                                          instruction: request || '请继续任务，修复校验问题并完成全部候选。'
                                        })
                                      );
                                    }}
                                  >
                                    {btn(
                                      <RotateCcw size={14} />,
                                      run.status === 'unknown' ? '确认重新请求' : '继续修改 / 恢复'
                                    )}
                                  </button>
                                )}
                                <div className="delete-action">
                                  <DeleteButton
                                    key={run.id}
                                    label="放弃候选"
                                    disabled={busy}
                                    description="放弃此任务的候选，保留正式文件与任务记录。"
                                    onConfirm={async () =>
                                      (await act(async () => {
                                        await invoke('run.discard', { id: run.id });
                                        return true;
                                      }, '候选已放弃，正式文件未修改')) === true
                                    }
                                  />
                                  <span>放弃候选</span>
                                </div>
                              </div>
                            )}
                            <div className="usage" id="chat-usage">
                              {run.rounds} 轮调用 · {run.toolCount} 次工具 ·{' '}
                              {run.usage.cost === null
                                ? '费用未知'
                                : `估算 ${run.usage.currency} ${run.usage.cost.toFixed(4)}`}{' '}
                              · 输入 {run.usage.input ?? '未知'} / 输出 {run.usage.output ?? '未知'}
                            </div>
                          </article>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="composer">
                    <textarea
                      aria-label="写作任务"
                      placeholder={
                        mode === 'stage' ? '描述本阶段的写作要求…' : '说明要修订的文件、范围与希望保留的内容…'
                      }
                      value={request}
                      onChange={(e) => setRequest(e.target.value)}
                    />
                    <div className="composer-toolbar">
                      <div className="composer-tools">
                        <button
                          className="composer-context"
                          aria-label="查看召回资料"
                          title="查看本次任务将使用的召回资料"
                          onClick={() =>
                            void act(async () =>
                              setManifest(await invoke('context.preview', { profileId, request }))
                            )
                          }
                        >
                          <BookOpen size={16} aria-hidden="true" />
                        </button>
                        <label
                          className="composer-select composer-mode"
                          title={mode === 'stage' ? `当前阶段 · ${names[p.stage]}` : '修订已有资料'}
                        >
                          <Layers size={14} aria-hidden="true" />
                          <select
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                            aria-label="任务类型"
                          >
                            <option value="stage">{names[p.stage]}</option>
                            <option value="revision">修订资料</option>
                          </select>
                          <ChevronDown size={12} aria-hidden="true" />
                        </label>
                      </div>
                      <div className="composer-actions">
                        <label
                          className="composer-select composer-model"
                          title={
                            snapshot.profiles.find((p) => p.id === profileId)
                              ? modelLabel(
                                  snapshot.profiles.find((p) => p.id === profileId)!,
                                  snapshot.profiles
                                )
                              : '选择本次任务的模型'
                          }
                        >
                          <select
                            value={profileId}
                            onChange={(e) => setProfileId(e.target.value)}
                            aria-label="本次模型"
                          >
                            <option value="">选择模型</option>
                            {snapshot.profiles
                              .filter((p) => p.protocol !== 'images')
                              .map((p) => (
                                <option key={p.id} value={p.id} title={`${p.name} · ${p.baseUrl}`}>
                                  {modelLabel(p, snapshot.profiles)}
                                </option>
                              ))}
                          </select>
                          <ChevronDown size={12} aria-hidden="true" />
                        </label>
                        {running ? (
                          <button
                            className="stop composer-send"
                            aria-label="停止执行"
                            title="停止执行"
                            onClick={() => void act(() => invoke('run.cancel'))}
                          >
                            <Square size={13} fill="currentColor" aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            className="primary composer-send"
                            disabled={busy || !profileId || !request.trim() || snapshot.chatBusy}
                            aria-label={mode === 'stage' ? '确认开始本阶段' : '确认开始修订'}
                            title={
                              !profileId
                                ? '请先选择模型'
                                : mode === 'stage'
                                  ? '确认开始本阶段'
                                  : '确认开始修订'
                            }
                            aria-describedby="composer-confirmation"
                            onClick={() => void start()}
                          >
                            <ArrowUp size={18} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="sr-only" id="composer-confirmation">
                    {running
                      ? '正在执行，可点击 ■ 停止。'
                      : mode === 'stage'
                        ? '点击 ↑ 确认开始本阶段。'
                        : '点击 ↑ 确认开始修订。'}
                    AI 提交候选，由你确认采纳。
                  </div>
                </section>
              )}
              <NarrativePanel snapshot={snapshot} onSource={setSource} />
            </div>
            {editorOpen && (
              <aside className="editor-panel">
                <nav className="inspector-tabs" aria-label="作品面板">
                  {(
                    [
                      ['manuscript', '文稿'],
                      ['characters', '人物'],
                      ['details', '详情']
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      className={inspector === key ? 'active' : ''}
                      onClick={() => setInspector(key)}
                    >
                      {label}
                    </button>
                  ))}
                  <button aria-pressed={focus} onClick={() => setFocus(!focus)}>
                    {focus ? '退出专注' : '专注'}
                  </button>
                </nav>
                {inspector === 'characters' ? (
                  <CharacterInspector snapshot={snapshot} onSource={setSource} />
                ) : inspector === 'details' ? (
                  <div className="diagnostics-inspector">
                    <h3>当前任务</h3>
                    <p>{run ? status[run.status] : '暂无任务'}</p>
                    {run?.manifest && (
                      <>
                        <p>上下文 · {run.manifest.estimatedTokens.toLocaleString()}（保守估计）</p>
                        <p>记忆 · {run.manifest.factIds.length}</p>
                        <details>
                          <summary>来源</summary>
                          {run.manifest.sources.map((s) => (
                            <p key={s.path}>
                              {s.path} · {s.hash.slice(0, 8)}
                            </p>
                          ))}
                        </details>
                      </>
                    )}
                    {run?.steps?.map((s, i) => (
                      <p key={i}>
                        {s.phase} · {snapshot.profiles.find((p) => p.id === s.profileId)?.name ?? s.profileId}
                      </p>
                    ))}
                    {snapshot.studio?.outbox.map((o) => (
                      <p key={o.id}>
                        {o.error || '文件同步待完成'}
                        <button onClick={() => void act(() => invoke('outbox.retry'))}>重试同步</button>
                      </p>
                    ))}
                  </div>
                ) : (
                  <>
                    <header>
                      <div>
                        <FileText size={16} />
                        <b title={doc?.path}>{doc?.path.split('/').at(-1) ?? '文稿与差异'}</b>
                        {dirty && <span className="draft-dot" />}
                      </div>
                      <button className="icon" aria-label="关闭编辑面板" onClick={() => setEditorOpen(false)}>
                        <X size={15} />
                      </button>
                    </header>
                    {doc ? (
                      <>
                        <div className="editor-tabs">
                          {[
                            ['edit', '编辑'],
                            ['preview', '预览'],
                            ['diff', '基础差异'],
                            ['disk', '磁盘差异'],
                            ['history', '历史']
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              className={editorTab === key ? 'active' : ''}
                              onClick={() => {
                                setEditorTab(key);
                                if (key === 'history')
                                  void act(async () =>
                                    setHistories(await invoke('document.history', { path: doc.path }))
                                  );
                              }}
                            >
                              {label}
                            </button>
                          ))}
                          <span>{doc.runId ? '候选' : '文稿'}</span>
                        </div>
                        {snapshot.documents.find((d) => d.path === doc.path)?.status === 'external' && (
                          <div className="inline-warning">
                            发现外部改稿
                            <button
                              onClick={() =>
                                void act(async () =>
                                  setSelectedRun(await invoke('project.importAccept', { path: doc.path }))
                                )
                              }
                            >
                              建立待审候选
                            </button>
                          </div>
                        )}
                        {editorTab === 'edit' ? (
                          <Editor
                            value={text}
                            onChange={setText}
                            onSelection={setSelection}
                            readOnly={
                              !!(
                                doc.runId &&
                                snapshot.runs.find((r) => r.id === doc.runId)?.status === 'running'
                              )
                            }
                          />
                        ) : editorTab === 'diff' || editorTab === 'disk' ? (
                          <Difference
                            before={editorTab === 'disk' ? (doc.disk ?? doc.before) : doc.before}
                            after={text}
                          />
                        ) : editorTab === 'preview' ? (
                          <div
                            className="markdown-preview"
                            onClick={(e) => {
                              const anchor = (e.target as HTMLElement).closest('a');
                              if (anchor) {
                                e.preventDefault();
                                const href = anchor.getAttribute('href') ?? '';
                                if (!/^[a-z]+:/i.test(href) && !href.startsWith('#')) {
                                  const relative = decodeURIComponent(
                                    new URL(href, 'https://local/' + doc.path).pathname.slice(1)
                                  );
                                  void openDoc(relative);
                                }
                              }
                            }}
                            dangerouslySetInnerHTML={{
                              __html: DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
                            }}
                          />
                        ) : (
                          <div className="history-list">
                            {histories.map((h) => (
                              <div key={h.hash}>
                                <time>{new Date(h.createdAt).toLocaleString()}</time>
                                <small>{h.hash.slice(0, 12)}</small>
                                <button
                                  onClick={() =>
                                    void act(async () => {
                                      const old = await invoke<{ content: string }>('document.read', {
                                        path: doc.path,
                                        hash: h.hash
                                      });
                                      setDoc({ ...doc, before: old.content });
                                      setEditorTab('diff');
                                    })
                                  }
                                >
                                  比较
                                </button>
                                <button
                                  onClick={() =>
                                    void act(async () =>
                                      setSelectedRun(
                                        await invoke('document.restore', {
                                          path: doc.path,
                                          hash: h.hash,
                                          baseHash: doc.hash
                                        })
                                      )
                                    )
                                  }
                                >
                                  恢复为候选
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <footer>
                          <small>
                            {Array.from(text.replace(/\s/g, '')).length.toLocaleString()} 字符 · UTF-8
                          </small>
                          <div>
                            {selection && (
                              <button
                                onClick={() => {
                                  setMode('revision');
                                  setRequest(
                                    `仅修改 ${doc.path} 中以下选区，保持其他内容不变。修改目标：\n\n${selection}`
                                  );
                                }}
                              >
                                修改选区
                              </button>
                            )}
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                !dirty ||
                                !!(doc.runId && snapshot.runs.find((r) => r.id === doc.runId)?.accepted)
                              }
                              onClick={() => void saveDraft()}
                            >
                              保存候选
                            </button>
                          </div>
                        </footer>
                      </>
                    ) : (
                      <div className="editor-empty">
                        <FileText size={32} strokeWidth={1} />
                        <h3>选择文稿</h3>
                        <div className="paper-illustration">
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </aside>
            )}
          </div>
        )}
      </main>
      {source && <SourceDialog source={source} onClose={() => setSource(null)} />}
      {modal === 'legacy' && (
        <LegacyDialog
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setDoc(null);
            setSelectedRun('');
            void refresh();
          }}
        />
      )}
      {modal === 'new' && (
        <NewProject
          onClose={() => setModal(null)}
          act={act}
          onCreated={() => {
            setModal(null);
            setDoc(null);
            setSelectedRun('');
            setPage('work');
          }}
        />
      )}
      {modal === 'settings' && (
        <ModelSettings
          profiles={snapshot.savedProfiles ?? snapshot.profiles}
          onClose={() => setModal(null)}
          act={act}
        />
      )}
      {agentSettings && <AssistantSettings onClose={() => setAgentSettings(false)} />}
      {modal === 'project' && p && (
        <ProjectSettings
          config={p.config}
          profiles={snapshot.profiles}
          onClose={() => setModal(null)}
          act={act}
        />
      )}
      {modal === 'trash' && <RecycleBin onClose={() => setModal(null)} act={act} />}
      {modal === 'transfer' && (
        <Transfer
          snapshot={snapshot}
          act={act}
          onClose={() => setModal(null)}
          onImport={async (file, content) => {
            const r = await act(() =>
              invoke<string>('document.save', { path: file, content, baseHash: null })
            );
            if (r) {
              setSelectedRun(r);
              setModal(null);
              setPage('work');
            }
          }}
        />
      )}
      {manifest && (
        <Modal
          title="本次召回资料"
          subtitle={`项目版本 ${manifest.projectRevision} · 保守输入估计 ${manifest.estimatedTokens.toLocaleString()} / ${manifest.availableTokens.toLocaleString()}`}
          onClose={() => setManifest(null)}
          wide
        >
          <div className="modal-body">
            {manifest.sources.map((s) => (
              <details key={s.path}>
                <summary>
                  <span className={`tag ${s.required ? 'green' : ''}`}>{s.required ? '必读' : '按需'}</span>
                  {s.path}
                  <small> · {s.hash.slice(0, 8)}</small>
                </summary>
                <p>
                  {s.reason} · {s.mode === 'full' ? '全文' : '原文摘录'}
                </p>
                <pre>{s.content}</pre>
              </details>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function activeBatchText(p: Snapshot['project']) {
  const b = p?.batches.find((b) => p.chapter >= b.start && p.chapter <= b.end);
  return b ? `${b.start}—${b.end} 章` : '—';
}
type Act = <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
function NewProject({ onClose, onCreated, act }: { onClose: () => void; onCreated: () => void; act: Act }) {
  const [title, setTitle] = useState(''),
    [parent, setParent] = useState(''),
    [premise, setPremise] = useState(''),
    [previewList, setPreviewList] = useState<string[]>([]);
  return (
    <Modal title="新建作品" subtitle="先保存你的想法，再逐步完成创作规划。" onClose={onClose}>
      <form
        className="modal-body form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await invoke('project.create', { title, parent, premise });
            onCreated();
          });
        }}
      >
        <label>
          作品名称
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="可以先用暂定名"
            maxLength={80}
          />
        </label>
        <label>
          保存位置
          <div className="input-action">
            <input readOnly required value={parent} placeholder="选择本机目录" />
            <button
              type="button"
              onClick={() =>
                void act(async () => {
                  const v = await invoke<string | null>('app.chooseDirectory');
                  if (v) setParent(v);
                })
              }
            >
              选择目录
            </button>
          </div>
        </label>
        <label>
          原始设定
          <textarea
            required
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            rows={6}
            placeholder="主角是谁？遇到了什么困境？你最想写的场面是什么？"
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void act(async () => setPreviewList(await invoke('project.preview', { title, premise })))
          }
        >
          查看初始文件
        </button>
        {previewList.length > 0 && (
          <details open>
            <summary>{previewList.length} 个初始文件</summary>
            <pre>{previewList.join('\n')}</pre>
          </details>
        )}
        <div className="modal-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!parent}>
            创建作品
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ProjectSettings({
  config,
  profiles,
  onClose,
  act
}: {
  config: ProjectConfig;
  profiles: Profile[];
  onClose: () => void;
  act: Act;
}) {
  const [c, setC] = useState(config),
    [advanced, setAdvanced] = useState(JSON.stringify(config.stageProfiles, null, 2));
  const field = (key: keyof ProjectConfig, value: unknown) => setC((s) => ({ ...s, [key]: value }));
  return (
    <Modal title="作品设置" onClose={onClose} wide>
      <form
        className="modal-body form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await invoke('project.configure', { config: { ...c, stageProfiles: JSON.parse(advanced) } });
            onClose();
          }, '作品设置已保存');
        }}
      >
        <div className="form-grid">
          {(
            [
              ['writing', '写作模型'],
              ['extraction', '记忆提取'],
              ['review', '质量评估']
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <select
                value={c.modelRouting[key]}
                onChange={(e) => field('modelRouting', { ...c.modelRouting, [key]: e.target.value })}
              >
                <option value="">{key === 'writing' ? '沿用本次模型' : '沿用写作模型'}</option>
                {profiles
                  .filter((p) => p.protocol !== 'images')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {modelLabel(p, profiles)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label>
            视角人物
            <input
              value={c.viewpointCharacterId}
              onChange={(e) => field('viewpointCharacterId', e.target.value)}
              placeholder="人物编号或姓名"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={c.preview.enabled}
              onChange={(e) => field('preview', { ...c.preview, enabled: e.target.checked })}
            />
            实时评估
          </label>
          <label>
            每章预览次数
            <input
              type="number"
              min={0}
              max={30}
              value={c.preview.maxCalls}
              onChange={(e) => field('preview', { ...c.preview, maxCalls: Number(e.target.value) })}
            />
          </label>
          {[
            ['targetWords', '目标总字数'],
            ['chapterWords', '单章目标字数'],
            ['minWords', '每章最少字数'],
            ['maxWords', '每章最多字数'],
            ['batchSize', '每批章数'],
            ['recentChapters', '近期变化窗口（章）'],
            ['maxRounds', '任务最多模型轮数'],
            ['maxTools', '任务最多工具调用']
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={1}
                value={c[key as keyof ProjectConfig] as number}
                onChange={(e) => field(key as any, Number(e.target.value))}
              />
            </label>
          ))}
          <label>
            叙述视角
            <input value={c.pov} onChange={(e) => field('pov', e.target.value)} />
          </label>
          <label>
            题材
            <input value={c.genre} onChange={(e) => field('genre', e.target.value)} />
          </label>
        </div>
        <label>
          文风
          <input value={c.style} onChange={(e) => field('style', e.target.value)} />
        </label>
        <ExpressionSettings value={c.expressionRules} onChange={(value) => field('expressionRules', value)} />
        <label>
          作者硬约束
          <textarea value={c.constraints} onChange={(e) => field('constraints', e.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            默认模型
            <select value={c.defaultProfileId} onChange={(e) => field('defaultProfileId', e.target.value)}>
              <option value="">每次选择</option>
              {profiles
                .filter((p) => p.protocol !== 'images')
                .map((p) => (
                  <option key={p.id} value={p.id} title={`${p.name} · ${p.baseUrl}`}>
                    {modelLabel(p, profiles)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            阶段费用上限（留空不限）
            <input
              type="number"
              min={0}
              step="any"
              value={c.stageBudget ?? ''}
              onChange={(e) => field('stageBudget', e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          自动备份目录
          <div className="input-action">
            <input readOnly value={c.backupDirectory} placeholder="未设置；本地历史始终保留" />
            <button
              type="button"
              onClick={() =>
                void act(async () => {
                  const value = await invoke<string | null>('app.chooseDirectory');
                  if (value) field('backupDirectory', value);
                })
              }
            >
              选择
            </button>
            <button type="button" onClick={() => field('backupDirectory', '')}>
              清除
            </button>
          </div>
        </label>
        <details>
          <summary>按阶段指定模型（可选）</summary>
          {stageIds.map((s) => (
            <label key={s}>
              {s} {names[s]}
              <select
                value={c.stageProfiles[s] ?? ''}
                onChange={(e) => {
                  const stageProfiles = { ...c.stageProfiles };
                  if (e.target.value) stageProfiles[s] = e.target.value;
                  else delete stageProfiles[s];
                  setC({ ...c, stageProfiles });
                  setAdvanced(JSON.stringify(stageProfiles, null, 2));
                }}
              >
                <option value="">沿用默认 / 本次选择</option>
                {profiles
                  .filter((p) => p.protocol !== 'images')
                  .map((p) => (
                    <option key={p.id} value={p.id} title={`${p.name} · ${p.baseUrl}`}>
                      {modelLabel(p, profiles)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </details>
        <div className="modal-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary">保存设置</button>
        </div>
      </form>
    </Modal>
  );
}
function Transfer({
  snapshot,
  act,
  onClose,
  onImport
}: {
  snapshot: Snapshot;
  act: Act;
  onClose: () => void;
  onImport: (file: string, content: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ content: string; warnings: string[]; name: string } | null>(null),
    [file, setFile] = useState(''),
    [checked, setChecked] = useState(false),
    [selection, setSelection] = useState(
      snapshot.documents.filter((d) => d.path.startsWith('07_')).map((d) => d.path)
    );
  return (
    <Modal
      title="导入、导出与备份"
      subtitle="导入先预览，导出使用已接受版本，备份恢复创建新目录。"
      onClose={onClose}
      wide
    >
      <div className="modal-body form">
        {!snapshot.project ? (
          <>
            <p>导入文稿和导出需要先创建或打开作品。作品损坏时可直接恢复完整备份。</p>
            <button
              onClick={() =>
                void act(async () => {
                  const source = await invoke<string | null>('app.chooseDirectory', {
                    title: '选择文序备份目录'
                  });
                  if (!source) return;
                  const parent = await invoke<string | null>('app.chooseDirectory', {
                    title: '选择恢复位置'
                  });
                  if (parent) {
                    const result = await invoke('project.restoreBackup', { source, parent });
                    alert(`已恢复到新目录：${result}`);
                  }
                })
              }
            >
              校验备份并恢复到新目录
            </button>
          </>
        ) : (
          <>
            <section>
              <h3>导入文字资料</h3>
              <button
                onClick={() =>
                  void act(async () => {
                    const source = await invoke<string | null>('app.chooseFile');
                    if (source) {
                      const p = await invoke<any>('project.importDocument', { file: source });
                      setPreview(p);
                      setFile(`00_导入资料/${p.name}.md`);
                      setChecked(false);
                    }
                  })
                }
              >
                {btn(<Upload size={15} />, '选择 MD / TXT / DOCX')}
              </button>
              {preview && (
                <>
                  <label>
                    项目内保存路径
                    <input value={file} onChange={(e) => setFile(e.target.value)} />
                  </label>
                  {preview.warnings.map((w) => (
                    <p className="inline-warning" key={w}>
                      {w}
                    </p>
                  ))}
                  <textarea
                    rows={9}
                    value={preview.content}
                    onChange={(e) => setPreview({ ...preview, content: e.target.value })}
                  />
                  <label className="check">
                    <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                    已核对导入预览与可能丢失的排版
                  </label>
                  <button
                    className="primary"
                    disabled={!checked}
                    onClick={() => void onImport(file, preview.content)}
                  >
                    建立导入候选
                  </button>
                </>
              )}
            </section>
            <section>
              <h3>导出正式文稿</h3>
              <div className="export-list">
                {snapshot.documents.map((d) => (
                  <label className="check" key={d.path}>
                    <input
                      type="checkbox"
                      checked={selection.includes(d.path)}
                      onChange={(e) =>
                        setSelection(
                          e.target.checked ? [...selection, d.path] : selection.filter((x) => x !== d.path)
                        )
                      }
                    />
                    {d.path}
                  </label>
                ))}
              </div>
              <button
                disabled={!selection.length}
                onClick={() =>
                  void act(async () => {
                    const target = await invoke<string | null>('app.chooseFile', {
                      save: true,
                      name: `${snapshot.project!.title}.docx`
                    });
                    if (target) return invoke('project.export', { paths: selection, target });
                  }, '导出完成')
                }
              >
                选择格式和位置并导出
              </button>
            </section>
            <section>
              <h3>历史与备份</h3>
              <div className="button-row">
                <button
                  onClick={() =>
                    void act(async () => {
                      const files = await invoke<string[]>('project.repair', { preview: true });
                      if (confirm('以下文件将作为修复候选，已有文稿不会覆盖：\n' + files.join('\n')))
                        await invoke('project.repair');
                    }, '修复候选已建立，请回工作台审阅')
                  }
                >
                  预览并修复缺失模板 / 索引
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      const report = await invoke<string>('diagnostics.export');
                      const blob = new Blob([report], { type: 'application/json' });
                      const url = URL.createObjectURL(blob),
                        a = document.createElement('a');
                      a.href = url;
                      a.download = '文序诊断.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  导出脱敏诊断
                </button>
              </div>
              <p className="muted">
                每次提交都保留本地历史。完整备份包含正式文件、候选、记忆、历史对象和运行记录，不含 API Key。
              </p>
              <div className="button-row">
                <button
                  onClick={() =>
                    void act(async () => {
                      const directory = await invoke<string | null>('app.chooseDirectory', {
                        title: '选择备份目录'
                      });
                      if (directory) {
                        const target = await invoke('project.backup', { directory });
                        alert(`备份已保存：${target}`);
                      }
                    })
                  }
                >
                  立即完整备份
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      const source = await invoke<string | null>('app.chooseDirectory', {
                        title: '选择文序备份目录'
                      });
                      if (!source) return;
                      const parent = await invoke<string | null>('app.chooseDirectory', {
                        title: '选择恢复位置（创建新目录）'
                      });
                      if (parent) {
                        const result = await invoke('project.restoreBackup', { source, parent });
                        alert(`已恢复到新目录：${result}`);
                      }
                    })
                  }
                >
                  校验并恢复备份
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
function Cover({ profiles, title, act }: { profiles: Profile[]; title: string; act: Act }) {
  const [prompt, setPrompt] = useState(''),
    [profile, setProfile] = useState(''),
    [picture, setPicture] = useState(''),
    [book, setBook] = useState(title),
    [author, setAuthor] = useState(''),
    [font, setFont] = useState('Microsoft YaHei'),
    [color, setColor] = useState('#ffffff'),
    [size, setSize] = useState(100),
    [x, setX] = useState(512),
    [authorX, setAuthorX] = useState(512),
    [y, setY] = useState(320),
    [authorY, setAuthorY] = useState(1300),
    [generating, setGenerating] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const draw = (image?: HTMLImageElement) => {
      ctx.fillStyle = '#203b38';
      ctx.fillRect(0, 0, 1024, 1536);
      if (image) {
        const scale = Math.max(1024 / image.width, 1536 / image.height);
        ctx.drawImage(
          image,
          (1024 - image.width * scale) / 2,
          (1536 - image.height * scale) / 2,
          image.width * scale,
          image.height * scale
        );
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.shadowColor = '#0007';
      ctx.shadowBlur = 10;
      ctx.font = `700 ${size}px "${font}"`;
      const chars = Array.from(book);
      let line = '',
        row = 0;
      for (const ch of chars) {
        if (ctx.measureText(line + ch).width > 900) {
          ctx.fillText(line, x, y + row * size * 1.3);
          line = ch;
          row++;
        } else line += ch;
      }
      ctx.fillText(line, x, y + row * size * 1.3);
      ctx.font = `36px "${font}"`;
      ctx.fillText(author ? `${author} 著` : '', authorX, authorY);
      ctx.shadowBlur = 0;
    };
    if (picture) {
      const image = new window.Image();
      image.onload = () => draw(image);
      image.src = picture;
    } else draw();
  }, [picture, book, author, font, color, size, x, y, authorX, authorY]);
  return (
    <div className="page-content">
      <div className="eyebrow">COVER STUDIO</div>
      <h1>先有画面，再写书名。</h1>
      <p className="muted">AI 生成背景，中文文字在本机叠加。每次保存使用独立文件名。</p>
      <div className="cover-layout">
        <div className="form">
          <button
            onClick={() =>
              void act(async () => {
                const files = await invoke<string[]>('cover.list');
                if (!files.length) throw new Error('尚无已保存封面');
                const name = window.prompt('输入要打开的配置路径：\n' + files.join('\n'), files.at(-1));
                if (name) {
                  const m = await invoke<any>('cover.load', { path: name });
                  setBook(m.book ?? '');
                  setAuthor(m.author ?? '');
                  setFont(m.font ?? 'Microsoft YaHei');
                  setColor(m.color ?? '#ffffff');
                  setSize(m.size ?? 100);
                  setX(m.x ?? 512);
                  setAuthorX(m.authorX ?? 512);
                  setY(m.y ?? 320);
                  setAuthorY(m.authorY ?? 1300);
                  setPrompt(m.prompt ?? '');
                  setPicture(m.picture ?? '');
                }
              })
            }
          >
            打开已保存的可编辑封面
          </button>
          <label>
            图像模型
            <select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">选择图像模型</option>
              {profiles
                .filter((p) => p.protocol === 'images')
                .map((p) => (
                  <option key={p.id} value={p.id} title={`${p.name} · ${p.baseUrl}`}>
                    {modelLabel(p, profiles)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            画面描述
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="主体、场景、色调、氛围；无需让 AI 写文字"
            />
          </label>
          <button
            className="primary"
            disabled={generating || !profile || !prompt}
            onClick={() => {
              setGenerating(true);
              void act(async () => {
                const r = await invoke<any>('cover.generate', { profileId: profile, prompt });
                setPicture(r.dataUrl);
              }).finally(() => setGenerating(false));
            }}
          >
            {generating ? '正在请求图像…' : '确认生成画面（调用 API）'}
          </button>
          {generating && (
            <button onClick={() => void invoke('cover.cancel')}>停止请求（服务端费用状态可能未知）</button>
          )}
          <label>
            书名
            <input value={book} onChange={(e) => setBook(e.target.value)} />
          </label>
          <label>
            作者名
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <label>
            字体
            <select value={font} onChange={(e) => setFont(e.target.value)}>
              {['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong'].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label>
            文字颜色
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label>
            书名字号 {size}
            <input
              type="range"
              min="40"
              max="160"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
          <label>
            书名纵向位置
            <input
              type="range"
              min="100"
              max="1200"
              value={y}
              onChange={(e) => setY(Number(e.target.value))}
            />
          </label>
          <label>
            书名横向位置
            <input
              type="range"
              min="100"
              max="924"
              value={x}
              onChange={(e) => setX(Number(e.target.value))}
            />
          </label>
          <label>
            作者名横向位置
            <input
              type="range"
              min="100"
              max="924"
              value={authorX}
              onChange={(e) => setAuthorX(Number(e.target.value))}
            />
          </label>
          <label>
            作者名纵向位置
            <input
              type="range"
              min="100"
              max="1450"
              value={authorY}
              onChange={(e) => setAuthorY(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() =>
              void act(
                () =>
                  invoke('cover.save', {
                    dataUrl: canvas.current!.toDataURL('image/png'),
                    metadata: { book, author, font, color, size, x, y, authorX, authorY, prompt, picture }
                  }),
                '封面和文字配置已保存到作品的 10_封面 目录'
              )
            }
          >
            保存 PNG 与可编辑配置
          </button>
        </div>
        <div className="cover-preview">
          <canvas ref={canvas} width={1024} height={1536} />
          <small>预览 · 1024 × 1536</small>
        </div>
      </div>
    </div>
  );
}
