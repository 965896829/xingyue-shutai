import { Modal } from './Modal';
import { useDialogs } from './AppDialogs';
import { RunRecoveryButton } from './RunRecoveryButton';
import { handleMarkdownLink } from './markdown-links';
import { ModelControl } from './ModelControl';
import { ContextMeter, ContextCompactions } from './ContextMeter';
import { latestContext, type ContextUsage } from '../shared/context-meter';
import { GenerationStatus, GenerationStep } from './GenerationStatus';
import { WritingStyleField } from './WritingStyleField';
import { defaultWritingStyle, normalizeWritingStyle } from '../shared/writing-style';
import { useStreamSession, proseBinding, proseFile } from './useLiveStream';
import { LiveMarkdown } from './LiveMarkdown';
import { LiveProseEditor, LiveProseCount } from './LiveProseEditor';
import { reasoningLabel } from '../shared/reasoning';
import { invokeCommand } from '../shared/client';
import { newProjectLocationError } from '../shared/project-location';
import { newProjectRequest, type OpeningMode } from '../shared/new-project-request';
import type { Invoke } from '../shared/contracts';
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { resumeArguments } from '../shared/run-capabilities';
import { taskErrorId, taskFileId, taskHelpLink, taskIssueId, taskSectionId } from '../shared/task-links';
import { sendOnEnter } from './composer-keyboard';
import { jumpToChatTarget } from './chat-navigation';
import { ProjectFiles } from './ProjectFiles';
import { currentStageDocument } from '../shared/project-progress';
import { manuscriptDraft } from '../shared/manuscript-target';
import { ObjectWorkbench } from './ObjectWorkbench';
import {
  BookOpen,
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
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Download,
  Upload,
  Layers,
  Image as ImageIcon,
  ArrowRight,
  Terminal,
  MoreHorizontal,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { MonitorCog } from 'lucide-react';
import type { ManagementView } from '../shared/management';
import { MarkdownContent } from './MarkdownContent';
import {
  stageIds,
  type Snapshot,
  type Run,
  type Profile,
  type ContextManifest,
  type ProjectConfig
} from '../shared/types';
import { Editor, Difference } from './Editor';
import { LegacyDialog } from './LegacyDialog';
import { ProviderSettings as ModelSettings } from './ProviderSettings';
import { modelLabel } from './model-label';
import { ThemeToggle } from './ThemeToggle';
import { BrandLogo } from './BrandLogo';
import { brand } from '../shared/brand';
import { DeleteButton } from './DeleteButton';
import { ProximitySidebar, type ProximitySection } from './ProximitySidebar';
import { RecycleBin } from './RecycleBin';
import { RecoveryConflicts } from './RecoveryConflicts';
import { ChatWorkspace } from './ChatWorkspace';
import { TaskDiscussion } from './TaskDiscussion';
import { AssistantSettings } from './AssistantSettings';
import { MemoryStudio, SourceDialog } from './MemoryStudio';
import { CharacterInspector, StoryInspector, ManuscriptCoverage } from './ManuscriptInspector';
import { NarrativePanel } from './NarrativePanel';
import { SkillLauncher } from './SkillLauncher';
import { QualityWorkbench } from './QualityWorkbench';
import { ExpressionSettings } from './ExpressionSettings';
import { TagForm, TagWorkspace, cleanTagInput } from './TagWorkspace';
import { emptyTagInput } from '../shared/tags';
import { emptyBookProfile } from '../shared/publishing';
import { PublishingSettings } from './PublishingSettings';
import { requestErrorText, retryNeedsConfirmation, taskReplyText, documentPreviewText, visibleRunIssues } from '../shared/run-presentation';
import { renderNativeCitations } from '../shared/web-search';
import { WebSearchEvidence } from './WebSearchEvidence';
import { VolumeMarketEvidence } from './VolumeMarketEvidence';
import type { SourceRef } from '../shared/studio';
import { gateEvent, syncEventCursor, type EventCursor } from '../shared/event-gate';

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
  awaiting_review: '查看生成结果',
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
const invoke: Invoke = (command, args) => {
  if (!window.wenxu) throw new Error('请使用桌面客户端，浏览器预览不具备本地文件权限');
  return invokeCommand(command, args);
};
export function App({ management = false, managementView = 'workspace' }: { management?: boolean; managementView?: ManagementView } = {}) {
  const [inspector, setInspector] = useState<'manuscript' | 'characters' | 'story' | 'details'>('manuscript');
  const [source, setSource] = useState<SourceRef | null>(null);
  const [focus, setFocus] = useState(false);
  const refreshSeq = useRef(0),
    eventCursor = useRef<EventCursor>({ seq: 0, waiting: false });
  const [workView, setWorkView] = useState<'chat' | 'tasks' | 'tags' | 'objects'>('chat');
  const [agentSettings, setAgentSettings] = useState(false);
  const [titleConfirmation, setTitleConfirmation] = useState<{ projectId: string; candidate: Run; startNext: boolean; warningReason: string } | null>(null);
  const [snapshot, setSnapshot] = useState(empty),
    [page, setPage] = useState<'work' | 'memory' | 'cover'>('work'),
    [modal, setModal] = useState<'new' | 'settings' | 'project' | 'publishing' | 'transfer' | 'legacy' | 'trash' | null>(
      null
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [actionBusy, setBusy] = useState(false);
  const dialogs = useDialogs(snapshot.projectSessionId);
  const [modelPending, setModelPending] = useState(false);
  const busy = actionBusy || modelPending;
  const [request, setRequest] = useState(''),
    [mode, setMode] = useState('stage'),
    [profileId, setProfileId] = useState(''),
    [selectedRun, setSelectedRun] = useState(''),
    [query, setQuery] = useState(''),
    [editorOpen, setEditorOpen] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [flowExpanded, setFlowExpanded] = useState(false);
  const [doc, setDoc] = useState<{
    projectId: string;
    projectKey: string;
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
  const historyRequest = useRef(0);
  useEffect(() => { historyRequest.current++; setHistories([]); }, [doc?.path, doc?.runId, snapshot.projectSessionId]);
  async function loadDocumentHistory(path: string) {
    const request = ++historyRequest.current, session = snapshot.projectSessionId;
    let result = await invoke('document.historyPage', { path });
    const rows = [...result.items];
    if (request === historyRequest.current && session === eventCursor.current.projectSessionId) setHistories([...rows]);
    while (result.nextBefore !== null && request === historyRequest.current && session === eventCursor.current.projectSessionId) {
      result = await invoke('document.historyPage', { path, before: result.nextBefore, watermark: result.watermark });
      rows.push(...result.items);
      if (request === historyRequest.current && session === eventCursor.current.projectSessionId) setHistories([...rows]);
    }
  }
  const chatScroll = useRef<HTMLDivElement>(null);
  const [discussionContext, setDiscussionContext] = useState<{ runId: string; usage?: ContextUsage }>();
  const receiveDiscussionContext = useCallback((runId: string, usage?: ContextUsage) => setDiscussionContext({ runId, usage }), []);
  const [settingFocus, setSettingFocus] = useState('');
  const actionPending = useRef(false);
  const [olderRuns, setOlderRuns] = useState<Run[]>([]);
  const historyLoading = useRef(false);
  const visibleRuns = [...snapshot.runs, ...olderRuns.filter(row => !snapshot.runs.some(current => current.id === row.id))];
  useEffect(() => { setOlderRuns([]); }, [snapshot.projectSessionId]);
  async function loadRunHistory() {
    if (historyLoading.current) return;
    historyLoading.current = true;
    const session = snapshot.projectSessionId;
    try {
      let result = await invoke('run.page');
      const rows = [...result.items];
      while (result.nextBefore !== null && eventCursor.current.projectSessionId === session) {
        result = await invoke('run.page', { before: result.nextBefore, watermark: result.watermark });
        rows.push(...result.items);
      }
      if (eventCursor.current.projectSessionId === session) setOlderRuns(rows);
    } catch (error) { setError((error as Error).message); }
    finally { historyLoading.current = false; }
  }
  const [answer, setAnswer] = useState(''),
    [timeline, setTimeline] = useState(false);
  useStreamSession(snapshot.projectSessionId);
  const refresh = useCallback(async () => {
    const requestId = ++refreshSeq.current;
    try {
      const s = await invoke('app.snapshot');
      if (requestId !== refreshSeq.current) return;
      syncEventCursor(eventCursor.current, s);
      setSnapshot(s);
      setError(current => /执行内核.*(?:恢复|尚未就绪)|作品会话已改变/.test(current) ? '' : current);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const act = async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
    if (actionPending.current) return undefined;
    actionPending.current = true;
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
      actionPending.current = false;
      setBusy(false);
    }
  };
  async function acceptRun(candidate: Run, startNext: boolean, warningReason = '', title?: string) {
    if (candidate.planning?.workflowVersion === 2 && (!candidate.planning.planApproval || snapshot.project?.titlePending && !candidate.planning.titleSelection)) {
      setWorkView('tags');
      setNotice('请选择满意的作品方案和书名。');
      return;
    }
    if (snapshot.project?.titlePending && candidate.mode === 'stage' && candidate.stage === 'S01' && !candidate.planning?.workflowVersion && title === undefined) {
      setError('');
      setTitleConfirmation({ projectId: snapshot.project.id, candidate, startNext, warningReason });
      return;
    }
    const result = await act(() => invoke('run.accept', {
      proposalHash: candidate.proposalHash,
      id: candidate.id,
      startNext,
      warningReason,
      ...(title !== undefined ? { title } : {})
    }));
    if (!result) return;
    setTitleConfirmation(null);
    setSelectedRun(result.nextRun ?? candidate.id);
    setWorkView('tasks');
    setNotice(result.nextRun ? '本阶段已保存，正在开始下一阶段' : '结果已保存');
    if (result.nextError) setError(result.nextError);
  }
  async function openStartedRun(id?: string) {
    await act(async () => {
      const current = await invoke('app.snapshot');
      const started = current.runs.find(item => item.id === id);
      if (id) setSelectedRun(id);
      setPage('work');
      setWorkView(started?.planning || started?.naming ? 'tags' : 'tasks');
    });
  }
  useEffect(() => {
    void refresh();
    let timeout: ReturnType<typeof setTimeout>;
    let fullRefresh = false;
    const resources = new Set<'runs' | 'chat' | 'documents' | 'studio'>();
    const unsub = window.wenxu?.onEvent((event) => {
      const decision = gateEvent(eventCursor.current, event);
      if (decision === 'ignore') return;
      if (decision === 'refresh') {
        void refresh();
        return;
      }
      // Stream consumers update only their own paragraph and playback cursor.
      // A token is not a request to reload persisted workspace state.
      if (event.type === 'delta' || event.type === 'prose-delta' || event.type === 'narrative-event') return;
      else if (event.type === 'error') setError(event.text ?? '执行错误');
      else {
        if (event.resource) resources.add(event.resource);
        else fullRefresh = true;
        if (!timeout)
          timeout = setTimeout(() => {
            timeout = undefined as any;
            const selected = [...resources];
            resources.clear();
            if (fullRefresh || !selected.length) { fullRefresh = false; void refresh(); return; }
            const sequence = refreshSeq.current;
            void invoke('resource.read', { resources: selected }).then((patch) => {
              if (sequence !== refreshSeq.current) return;
              setSnapshot((current) => current.projectSessionId === patch.projectSessionId ? { ...current, ...patch, eventSeq: Math.max(current.eventSeq ?? 0, patch.eventSeq) } : current);
            }).catch(() => void refresh());
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
    pendingStage = visibleRuns.find((r) => r.mode === 'stage' && !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status)),
    run = visibleRuns.find((r) => r.id === selectedRun) ?? visibleRuns[0],
    running = visibleRuns.find((r) => r.status === 'running'),
    feedbackRun = run && ['stage', 'revision'].includes(run.mode) && !run.accepted && !run.planning && !run.naming && !run.memoryRepair && ['awaiting_review', 'needs_repair'].includes(run.status) ? run : undefined,
    discussionRun = run && (mode === 'stage' || run.mode === 'revision') ? run : undefined,
    dirty = doc && text !== doc.content;
  const taskBusy = busy || !!running || !!snapshot.chatBusy;
  const projectKey = p ? `${p.id}:${encodeURIComponent(p.root.replaceAll('\\', '/').toLowerCase())}` : undefined;
  const activeProjectKey = useRef(projectKey);
  activeProjectKey.current = projectKey;
  useEffect(() => {
    if (titleConfirmation && titleConfirmation.projectId !== p?.id) setTitleConfirmation(null);
  }, [p?.id, titleConfirmation?.projectId]);
  const documentRun = doc?.runId ? visibleRuns.find(item => item.id === doc.runId) : undefined;
  const liveDocumentRun = documentRun?.pipeline && documentRun.status === 'running' && documentRun.pipeline.phase === 'prose' && doc?.path === proseFile(documentRun.chapter) ? documentRun : undefined;
  const documentAccepted = !!documentRun?.accepted;
  useEffect(() => {
    if (!doc?.runId || !documentAccepted) return;
    let cancelled = false;
    const previous = doc;
    void invoke('document.read', { path: previous.path }).then(saved => {
      if (cancelled) return;
      setDoc(current => current && current.runId === previous.runId && current.path === previous.path
        ? { ...current, runId: undefined, hash: saved.hash, content: saved.content, before: saved.content, disk: saved.content }
        : current);
      setText(value => value === previous.content ? saved.content : value);
    }).catch(error => { if (!cancelled) setError(`读取已保存文稿失败：${String(error)}`); });
    return () => { cancelled = true; };
  }, [doc?.runId, doc?.path, documentAccepted, snapshot.projectSessionId]);
  useEffect(() => {
    if (modal !== 'project' || !settingFocus) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`project-setting-${settingFocus}`);
      target?.focus();
      target?.scrollIntoView({ block: 'center' });
      setSettingFocus('');
    });
    return () => cancelAnimationFrame(frame);
  }, [modal, settingFocus]);
  function navigateTask(href: string) {
    if (run) {
      for (const field of ['maxRounds', 'maxTools', 'stageBudget']) {
        if (href !== `#${taskSectionId(run.id, `setting-${field}`)}`) continue;
        setSettingFocus(field);
        setModal('project');
        return;
      }
      if (href === `#${taskSectionId(run.id, 'model-settings')}`) { setModal('settings'); return; }
    }
    const target = href.startsWith('#') ? href.slice(1) : '';
    if (target && jumpToChatTarget(chatScroll.current, target)) return;
    setNotice('这处问题已更新或解决，已定位到当前任务。');
    jumpToChatTarget(chatScroll.current, run ? taskSectionId(run.id, 'recovery') : 'chat-execution') || jumpToChatTarget(chatScroll.current, 'chat-execution');
  }
  useLayoutEffect(() => {
    const active = visibleRuns.find((r) => r.status === 'running' && r.pipeline) ?? (documentRun?.pipeline ? documentRun : undefined);
    const prose = active?.changes.find((c) => c.path.startsWith('07_'));
    if (!active || !prose || dirty || !p || active.accepted) return;
    const firstDisplay = active.status === 'running' && doc?.runId !== active.id;
    if (!firstDisplay && (doc?.runId !== active.id || doc.path !== prose.path)) return;
    setDoc({
      projectId: p.id,
      projectKey: projectKey!,
      path: prose.path,
      content: prose.content,
      hash: prose.baseHash,
      runId: active.id,
      before: doc?.runId === active.id ? doc.before : ''
    });
    setText(prose.content);
    if (firstDisplay) { setEditorOpen(true); setInspector('manuscript'); setEditorTab('edit'); }
  }, [visibleRuns.find((r) => r.status === 'running' && r.pipeline)?.pipeline?.version, documentRun?.pipeline?.version, documentRun?.status]);
  useEffect(() => {
    if (!doc?.runId || doc.projectKey !== projectKey || !dirty || running || documentAccepted || !doc.path.startsWith('07_')) return;
    const timer = setTimeout(() => {
      void invoke('draft.checkpoint', { id: doc.runId!, content: text }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [text, doc?.runId, documentAccepted, !!running, projectKey]);
  useEffect(() => {
    // Other authorized views can switch the active book. Keep cached edits bound
    // to their original project and never carry an editor into the new book.
    setDoc(null); setEditorOpen(false); setText(''); setSource(null); setManifest(null);
    setModal(null); setTitleConfirmation(null);
    const pending = snapshot.runs.find((r) => !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status));
    setSelectedRun(pending?.id ?? '');
    setMode('stage');
    setRequest('');
    setWorkView(pending?.planning || pending?.naming || ((p?.tagEnabled || p?.creationWorkflow === 2) && p.stage === 'S01') ? 'tags' : pending || p?.stage === 'S01' || snapshot.runs.some(r => r.mode === 'stage') ? 'tasks' : 'chat');
  }, [projectKey]);
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
        localStorage.setItem(`draft:${doc.projectKey}:${doc.runId ?? ''}:${doc.path}`, text);
      } catch {
        setError('本地草稿缓存空间不足，请立即保存草稿');
      }
    }
  }, [text, doc?.runId, doc?.path, doc?.projectKey]);
  async function openDoc(relative: string, r?: Run, openMode?: 'edit' | 'diff') {
    const projectId = p?.id;
    if (!projectId || !projectKey) return;
    if (r?.accepted) r = undefined;
    if (dirty && !await dialogs.confirm('编辑内容已保存在本机草稿缓存中。切换文档？', { title: '切换文档？', confirmLabel: '切换文档', cancelLabel: '继续编辑' })) return;
    await act(async () => {
      let old = { content: '', hash: null as string | null };
      try {
        old = await invoke('document.read', { path: relative });
      } catch {
        if (!r) throw new Error('无法读取文件');
      }
      const candidate = r?.changes.find((c) => c.path === relative),
        value = candidate?.content ?? old.content;
      const cacheKey = `draft:${projectKey}:${r?.id ?? ''}:${relative}`;
      const legacyKey = `draft:${projectId}:${r?.id ?? ''}:${relative}`;
      const draft = localStorage.getItem(cacheKey) ?? localStorage.getItem(legacyKey);
      if (draft !== null) {
        localStorage.setItem(cacheKey, draft);
        localStorage.removeItem(legacyKey);
      }
      let baseline = old.content;
      if (candidate?.baseHash) {
        try {
          baseline = (
            await invoke('document.read', { path: relative, hash: candidate.baseHash })
          ).content;
        } catch {
          /* external changes may have no accepted revision yet */
        }
      }
      if (activeProjectKey.current !== projectKey) return;
      if (workView === 'objects') setWorkView('chat');
      setDoc({
        projectId,
        projectKey,
        path: relative,
        hash: candidate ? candidate.baseHash : old.hash,
        content: value,
        runId: r?.id,
        before: baseline,
        disk: old.content
      });
      setText(draft ?? value);
      setEditorOpen(true);
      setInspector('manuscript');
      setEditorTab(openMode ?? (r ? 'diff' : 'edit'));
      setHistories([]);
    });
  }
  async function saveDraft() {
    if (!doc) return;
    if (doc.projectKey !== projectKey) { setError('作品已切换，请重新打开文稿；原编辑仍保留在原作品草稿缓存中。'); return; }
    if (doc.runId && visibleRuns.find((r) => r.id === doc.runId)?.accepted) {
      setError('正在载入已保存版本，请稍后再保存。');
      return;
    }
    const r = await act<Run | string>(
      () =>
        doc.runId
          ? invoke('run.update', { id: doc.runId, path: doc.path, content: text })
          : invoke('document.save', { path: doc.path, baseHash: doc.hash, content: text }),
      '草稿已保存，确认采纳后会更新正式文稿'
    );
    if (r && activeProjectKey.current === doc.projectKey) {
      setWorkView('tasks');
      setSelectedRun(typeof r === 'string' ? r : r.id);
      setDoc({ ...doc, content: text, runId: typeof r === 'string' ? r : r.id });
    }
  }
  async function start(taskMode = mode) {
    if (!p || ((taskMode === 'revision' || feedbackRun) && !request.trim())) return;
    if (feedbackRun) {
      if (retryNeedsConfirmation(feedbackRun) && !await dialogs.confirm('上次请求结果未知，重新请求可能重复计费。确认重新请求？', { title: '重新请求当前任务？', confirmLabel: '确认重新请求', cancelLabel: '暂不重试' })) return;
      const resumed = await act(() => invoke('run.recover', { ...resumeArguments(feedbackRun, request.trim()), ...(profileId ? { profileId } : {}) }));
      if (resumed !== undefined) setRequest('');
      return;
    }
    const id = await act(() =>
      invoke('run.start', {
        request: request.trim() || `请根据已有想法与已确认的内容，完成${names[p.stage]}，展示结果供我确认。`,
        profileId,
        mode: taskMode === 'revision' ? 'revision' : 'stage'
      })
    );
    if (id) {
      setSelectedRun(id);
      setRequest('');
    }
  }
  async function sendTaskMessage() {
    if (taskBusy) return;
    if (!profileId) { setError('请先选择模型'); return; }
    if (!discussionRun) { await start(); return; }
    if (!request.trim() || busy || running || snapshot.chatBusy) return;
    const result = await act(() => invoke('run.discuss', { id: discussionRun.id, text: request.trim(), profileId, displayedError: error.slice(0, 4000), allowCandidateEdits: true }));
    if (result) {
      setRequest('');
      chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight });
    }
  }
  function openProjectDirectory() {
    void act(async () => {
      const root = await invoke('app.chooseDirectory');
      if (root) {
        setDoc(null);
        setSelectedRun('');
        return invoke('project.open', { root });
      }
    });
  }
  useEffect(() => {
    if (!management) return;
    const navigate = (event: Event) => {
      const view = (event as CustomEvent<ManagementView>).detail;
      if (view === 'open') { openProjectDirectory(); return; }
      if (view === 'models') { setModal('settings'); return; }
      if (['project', 'transfer', 'legacy', 'trash', 'new'].includes(view)) { setModal(view as 'project' | 'transfer' | 'legacy' | 'trash' | 'new'); return; }
      setModal(null);
      setPage(view === 'memory' || view === 'cover' ? view : 'work');
      if (view === 'tasks' || view === 'creation' || view === 'workspace') { setWorkView(view === 'creation' ? 'tags' : view === 'tasks' ? 'tasks' : 'chat'); setEditorOpen(false); }
    };
    window.addEventListener('management:navigate', navigate);
    const open = (event: Event) => { setPage('work'); setEditorOpen(true); void openDoc((event as CustomEvent<string>).detail); };
    window.addEventListener('management:document', open);
    return () => { window.removeEventListener('management:navigate', navigate); window.removeEventListener('management:document', open); };
  });
  useEffect(() => {
    if (management) window.dispatchEvent(new CustomEvent('management:navigate', { detail: managementView }));
  }, [management, managementView]);
  async function returnHome() {
    if (!p || busy) return;
    await act(async () => {
      if (running || snapshot.chatBusy)
        throw new Error('任务正在运行，请先停止或等待完成后返回首页。');
      if (dirty && doc) {
        try {
          localStorage.setItem(`draft:${p.id}:${doc.runId ?? ''}:${doc.path}`, text);
        } catch {
          throw new Error('本地草稿缓存空间不足，请先保存编辑内容再返回首页。');
        }
      }
      const reminders = [
        ...(dirty ? ['编辑内容已保存在本机草稿缓存中，尚未保存为正式内容。'] : []),
        ...(request.trim() ? ['当前任务输入尚未发送，返回首页后将清空。'] : [])
      ];
      if (reminders.length && !await dialogs.confirm(`${reminders.join('\n')}\n确认返回首页？`)) return;
      await invoke('project.close');
      setDoc(null);
      setText('');
      setSelectedRun('');
      setEditorOpen(false);
      setSource(null);
      setManifest(null);
      setRequest('');
      setAnswer('');
      setQuery('');
      setFocus(false);
      setNotice('');
      setPage('work');
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
          setManifest(null);
          setRequest('');
          setPage('work');
        }
        return true;
      }, '作品已移入回收站，七天内可恢复，到期自动永久删除本地文件')) === true
    );
  }
  const filteredDocs = useMemo(() => snapshot.documents.filter((d) => !query || d.path.includes(query)), [snapshot.documents, query]);
  const currentDocument = p ? currentStageDocument(p) : undefined;
  async function openProjectDocument(path: string) {
    await openDoc(path, p ? manuscriptDraft(visibleRuns, p, path) : undefined, 'edit');
  }
  useEffect(() => {
    if (!p || !editorOpen || inspector !== 'manuscript' || doc) return;
    const path = p.stage >= 'S10' ? proseFile(p.chapter) : currentDocument;
    if (path) void openProjectDocument(path);
  }, [projectKey, editorOpen, inspector, doc?.path, currentDocument]);
  const taskReply = run?.accepted && (run.planning || run.naming)
    ? '本阶段内容已保存，可以继续下一阶段；想调整时可进入“作品方案与书名”。'
    : run ? taskReplyText(renderNativeCitations(run.responseText, run.webSearch?.citations)) : '';
  const displayedChanges = run?.pipeline && run.status === 'running' && run.pipeline.phase === 'prose' && !run.changes.some(change => change.path === proseFile(run.chapter))
    ? [...run.changes, { path: proseFile(run.chapter), content: '', baseHash: null }] : run?.changes ?? [];
  const displayedIssues = run ? visibleRunIssues(run) : [];
  const chatSections: ProximitySection[] = run
    ? [
        { id: 'chat-request', label: '你的任务', kind: 'title' },
        { id: 'chat-execution', label: '执行与上下文', kind: 'subtitle' },
        ...(taskReply ? [{ id: 'chat-response', label: '模型回复', kind: 'section' as const }] : []),
        ...(run.changes.length
          ? [{ id: 'chat-candidates', label: '候选改动', kind: 'section' as const }]
          : []),
        ...(displayedIssues.some(issue => issue.severity === 'error') ? [{ id: 'chat-issues', label: '需完善内容', kind: 'body' as const }] : []),
        ...(timeline ? [{ id: 'chat-events', label: '执行日志', kind: 'body' as const }] : []),
        ...(['awaiting_input', 'awaiting_permission', 'awaiting_review', 'needs_repair'].includes(
          run.status
        ) && !run.accepted
          ? [{ id: 'chat-decision', label: '待你确认', kind: 'subtitle' as const }]
          : []),
      ]
    : [];
  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${focus && editorOpen && page === 'work' ? 'studio-focus' : ''}`}
    >
      {!management && <aside className="sidebar" aria-label="作品与功能导航">
        <div className="brand">
          <button
            type="button"
            className="brand-home"
            aria-label="返回首页"
            title="返回首页"
            disabled={busy}
            onClick={() => void returnHome()}
          >
            <BrandLogo compact={sidebarCollapsed} />
          </button>
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
            <div className={`current-stage-summary ${p.finished ? 'finished' : ''}`} role="status" aria-label="当前创作阶段">
              <div><span>{p.finished ? '创作进度' : '当前阶段'}</span><b>{p.finished ? '已完成' : p.stage}</b></div>
              <strong>{p.finished ? '全书计划已完成' : names[p.stage]}
                {!p.finished && p.stage >= 'S06' && <small>{p.stage < 'S09' ? activeBatchText(p) : `第 ${String(p.chapter).padStart(3, '0')} 章`}</small>}
              </strong>
            </div>
            <ProjectFiles documents={filteredDocs} selected={doc?.path} current={currentDocument} onOpen={path => void openProjectDocument(path)} resetKey={`${projectKey}:${query}`} />
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
          {!management && window.wenxu?.desktop && <button aria-label="打开网页管理后台" title="打开网页管理后台" onClick={() => void act(() => invoke('management.open'), '已在浏览器打开管理后台')}>
            {btn(<MonitorCog size={16} />, '网页管理后台')}
          </button>}
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
      </aside>}
      <main>
        {!management && <header className="topbar">
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
        </header>}
        {management && p && <div className="management-document-toolbar">
          <span>{p.title}</span>
          <select aria-label="打开作品文档" value={doc?.path ?? ''} onChange={event => { if (event.target.value) { setPage('work'); setEditorOpen(true); void openDoc(event.target.value); } }}>
            <option value="">选择文稿、设定或大纲…</option>
            {snapshot.documents.map(document => <option key={document.path} value={document.path}>{document.path}</option>)}
          </select>
          <button onClick={() => setEditorOpen(!editorOpen)} aria-pressed={editorOpen}>文稿面板</button>
          <button onClick={() => setModal('project')}>作品配置</button>
          <button onClick={() => setModal('publishing')}>题材与发布分类</button>
        </div>}
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
        {p && !!snapshot.studio?.recoveryConflicts?.length && (
          <RecoveryConflicts
            key={p.id}
            conflicts={snapshot.studio.recoveryConflicts}
            disabled={busy || !!running}
            refresh={refresh}
          />
        )}
        {!p ? (
          <div className="welcome">
            <div className="welcome-symbol">
              <BrandLogo symbolOnly />
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
            onRun={id => void openStartedRun(id)}
            profileId={profileId}
          />
        ) : page === 'cover' ? (
          <Cover key={p.id} profiles={snapshot.profiles} title={p.title} act={act} />
        ) : (
          <div className={`workspace ${focus ? 'studio-focus' : ''}`}>
            <div className="work-area">
              <div className="work-tabs">
                <button className={workView === 'objects' ? 'active' : ''} onClick={() => setWorkView('objects')}>共创画布</button>
                <QualityWorkbench key={`quality:${p.id}`} profileId={profileId} onRun={(id) => void openStartedRun(id)} />
                <SkillLauncher
                  key={`skills:${p.id}`}
                  profileId={profileId}
                  onRun={(id) => void openStartedRun(id)}
                />
                <button className={workView === 'chat' ? 'active' : ''} onClick={() => setWorkView('chat')}>
                  创作讨论
                </button>
                <button className={workView === 'tasks' ? 'active' : ''} onClick={() => setWorkView('tasks')}>
                  创作任务
                </button>
                <button className={workView === 'tags' ? 'active' : ''} onClick={() => setWorkView('tags')}>
                  作品方案与书名
                </button>
              </div>
              {workView === 'objects' ? (
                <ObjectWorkbench key={p.id} snapshot={snapshot} profileId={profileId} setProfileId={setProfileId} refresh={refresh} onRun={id => void openStartedRun(id)} onSource={setSource} onDocument={relative => void openDoc(relative)} onSettings={() => setAgentSettings(true)} />
              ) : workView === 'tags' ? (
                <TagWorkspace
                  key={p.id}
                  snapshot={snapshot}
                  profileId={profileId}
                  setProfileId={setProfileId}
                  refresh={refresh}
                  onAccept={acceptRun}
                  onReview={(id) => {
                    setSelectedRun(id);
                    setWorkView('tasks');
                  }}
                />
              ) : workView === 'chat' ? (
                <ChatWorkspace
                  key={p.id}
                  snapshot={snapshot}
                  profileId={profileId}
                  setProfileId={setProfileId}
                  refresh={refresh}
                  onRun={(id) => void openStartedRun(id)}
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
                      待核对关联内容 {p.stale.length} 项
                      <button disabled={taskBusy || !profileId} onClick={() => void act(async () => {
                        const result = await invoke('memory.rebuild', { profileId });
                        if (result.runId) setSelectedRun(result.runId);
                      })}>
                        生成同步后的内容 <ArrowRight size={13} />
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
                      <div className="chat-content">
                      {(!run || (run.accepted && !pendingStage)) && (
                        <div className="start-card">
                          <div className="assistant-mark">
                            <Sparkles size={20} />
                          </div>
                          <h2>下一步：{names[p.stage]}</h2>
                          <button className="primary" disabled={busy || !!running || snapshot.chatBusy || !profileId} onClick={() => void start('stage')}>
                            开始{names[p.stage]}
                          </button>
                          {!profileId && <button onClick={() => setModal('settings')}>先设置模型连接</button>}
                        </div>
                      )}
                      {run && (
                        <>
                          <div className="run-selector">
                            <select
                              aria-label="选择历史任务"
                              onFocus={() => void loadRunHistory()}
                              value={run.id}
                              onChange={(e) => setSelectedRun(e.target.value)}
                            >
                              {visibleRuns.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.creative ? r.request : `${r.stage} · 第 ${r.chapter} 章`} · {r.creative && r.status === 'complete' ? '已完成' : status[r.status]} ·{' '}
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
                                <b>{brand.name}</b>
                                <GenerationStatus variant="elapsed" activity={run.activity} running={run.status === 'running'} label={run.creative && run.status === 'complete' ? '已完成' : status[run.status]} fallbackStart={run.createdAt} />
                              </div>
                              {run.manifest && (
                                <details>
                                  <summary>参考资料</summary>
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
                                </details>
                              )}
                            </div>
                            {(taskReply || run.status === 'running') && (
                              run.accepted && (run.planning || run.naming) ? <MarkdownContent id="chat-response" content={taskReply} label="任务回答" /> :
                              <LiveMarkdown id="chat-response" label="任务回答" format="task" citations={run.webSearch?.citations}
                                binding={{ session: snapshot.projectSessionId, kind: 'runs', id: run.id, text: run.responseText, running: run.status === 'running' }} />
                            )}
                            <GenerationStep activity={run.activity} running={run.status === 'running'} />
                            <WebSearchEvidence state={run.webSearch} running={run.status === 'running'} />
                            <VolumeMarketEvidence research={run.volumeNaming?.research} />
                            <ContextCompactions items={run.contextCompactions} activity={run.activity} running={run.status === 'running'} />
                            {run.documentDrafts?.map(draft => <details key={draft.path} className="saved-document-draft">
                              <summary>已保存草稿 · {draft.path} · {draft.chunks} 段 / {draft.content.length} 字符</summary>
                              <MarkdownContent content={draft.content} label={draft.path.split('/').at(-1)?.replace(/\.md$/, '')} />
                            </details>)}
                            {run.error && <p className="inline-warning" role="alert" id={taskErrorId(run)}>{requestErrorText(run.error)}{' '}<a href={taskHelpLink(run).href} onClick={event => { event.preventDefault(); navigateTask(event.currentTarget.getAttribute('href')!); }}>{taskHelpLink(run).label}</a></p>}
                            {!run.accepted && run.changes.length > 0 && ['unknown', 'paused'].includes(run.status) && (
                              <details>
                                <summary>使用中断前保存的内容</summary>
                              <button
                                disabled={busy || !!running || snapshot.chatBusy}
                                onClick={() =>
                                  void act(
                                    () =>
                                      invoke('run.revalidate', {
                                        id: run.id,
                                        reviewSaved: ['unknown', 'paused'].includes(run.status)
                                      }),
                                    '候选已检查'
                                  )
                                }
                              >
                                检查已保存内容是否完整
                              </button>
                              </details>
                            )}
                            {displayedChanges.length > 0 && (
                              <div className="candidate-list" id="chat-candidates">
                                <div className="section-label">本次生成的文稿 · {displayedChanges.length} 个文件</div>
                                {displayedChanges.map((c, index) => (!run.pipeline || c.path.startsWith('07_正文章节/')) ? (
                                  <details key={c.path} id={taskFileId(run.id, c.path)} open={run.pipeline ? c.path.startsWith('07_正文章节/') : run.planning ? c.path.startsWith('01_') : index === 0}>
                                    <summary>{c.path.split('/').at(-1)?.replace(/\.md$/, '')}</summary>
                                    {run.pipeline && c.path === proseFile(run.chapter) ? <LiveMarkdown
                                      className="markdown-preview" label={c.path.split('/').at(-1)?.replace(/\.md$/, '')}
                                      binding={proseBinding(snapshot.projectSessionId, run)} format="prose"
                                      onClick={event => handleMarkdownLink(event, url => { void act(() => invoke('app.openUrl', { url })); })}
                                    /> : <MarkdownContent
                                      className="markdown-preview"
                                      label={c.path.split('/').at(-1)?.replace(/\.md$/, '')}
                                      content={documentPreviewText(c.content)}
                                      onClick={event => handleMarkdownLink(event, url => { void act(() => invoke('app.openUrl', { url })); })}
                                    />}
                                    <button onClick={() => void openDoc(c.path, run)}>查看差异或编辑</button>
                                  </details>
                                ) : (
                                  <button key={c.path} id={taskFileId(run.id, c.path)} onClick={() => void openDoc(c.path, run)}>
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
                            {displayedIssues.length > 0 && (
                              <details id="chat-issues" open={displayedIssues.some((i) => i.severity === 'error')}>
                                <summary>
                                  {displayedIssues.some(i => i.severity === 'error') ? `${displayedIssues.filter(i => i.severity === 'error').length} 项内容待完善` : `${displayedIssues.filter(i => i.severity === 'warning').length} 条内容建议`}
                                </summary>
                                {displayedIssues.map((i, n) => (
                                  <p
                                    key={n}
                                    id={taskIssueId(run.id, i)}
                                    className={`issue ${i.severity === 'error' ? 'error-text' : ''}`}
                                  >
                                    {i.path && <small>{i.path}</small>}
                                    {i.message}
                                    {i.path && (run.changes.some(change => change.path === i.path) || snapshot.documents.some(document => document.path === i.path)) && <>{' '}<a href={`#${taskFileId(run.id, i.path)}`} onClick={event => {
                                      event.preventDefault();
                                      if (run.changes.some(change => change.path === i.path)) navigateTask(event.currentTarget.getAttribute('href')!);
                                      else void openDoc(i.path!);
                                    }}>查看对应文稿</a></>}
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
                            {(run.naming || run.planning && !run.accepted && run.planning.phase !== 'ready') && (
                              <button className="primary" onClick={() => setWorkView('tags')}>
                                {run.naming ? '返回独立命名' : '继续当前策划'}
                              </button>
                            )}
                            {run.status === 'awaiting_input' && !run.planning && (
                              <div className="approval-box" id="chat-decision">
                                <b>{run.input?.question}</b>
                                <textarea
                                  aria-label="回答作者问题"
                                  value={answer}
                                  onChange={(e) => setAnswer(e.target.value)}
                                />
                                <button
                                  className="primary"
                                  disabled={taskBusy || !answer.trim()}
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
                                    disabled={taskBusy}
                                    onClick={() =>
                                      void act(() => invoke('run.permission', { id: run.id, approved: true }))
                                    }
                                  >
                                    允许这一次
                                  </button>
                                  <button
                                    disabled={taskBusy}
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
                                <h3>{run.issues.some(issue => issue.severity === 'error') ? '本阶段还有问题需要处理' : run.memoryRepair ? '关联修订已准备好' : run.pipeline ? '本章正文与记忆已准备好' : '本阶段结果已准备好'}</h3>
                                <div className="button-row">
                                  {!run.pipeline && (!run.revisionCore || run.issues.some(i => i.severity === 'error')) && run.changes.some(c => c.path.startsWith('07_')) && <button disabled={taskBusy} onClick={() => void act(async () => { const id = await invokeCommand('run.reviewProse', { id: run.id, proposalHash: run.proposalHash!, profileId }); await openStartedRun(id); })}>核对正文与记忆</button>}
                                  <button
                                    className="primary"
                                    disabled={taskBusy || run.issues.some((i) => i.severity === 'error')}
                                    onClick={() => void acceptRun(run, run.mode === 'stage' || !!run.memoryRepair)}
                                  >
                                    {p?.titlePending && run.mode === 'stage' && run.stage === 'S01' ? '满意，确定书名' : run.memoryRepair ? '满意，继续创作' : run.mode === 'stage' ? '满意，继续' : '满意，保存修改'}
                                  </button>
                                  {(run.mode === 'stage' || run.memoryRepair) && (
                                    <details className="message-actions"><summary aria-label="更多保存方式">⋯</summary>
                                    <button
                                      disabled={taskBusy || run.issues.some((i) => i.severity === 'error')}
                                      onClick={() => void acceptRun(run, false)}
                                    >
                                      保存，暂不继续
                                    </button>
                                    </details>
                                  )}
                                </div>
                              </div>
                            )}
                            {!run.accepted && !['running', 'discarded'].includes(run.status) && (
                              <details id={taskSectionId(run.id, 'recovery')} open={['unknown', 'paused', 'failed', 'stale'].includes(run.status)}>
                                <summary>任务恢复与其他操作</summary>
                              <div className="button-row subdued">
                                <RunRecoveryButton run={run} disabled={taskBusy} profileId={profileId || undefined} instruction={request} act={act} onRecovered={id => { setSelectedRun(id); setRequest(''); }} onInspect={() => navigateTask(`#${taskErrorId(run)}`)} />
                                <div className="delete-action">
                                  <DeleteButton
                                    key={run.id}
                                    label="放弃候选"
                                    disabled={taskBusy}
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
                              </details>
                            )}
                            <details className="usage" id="chat-usage"><summary>运行记录</summary>
                              {run.rounds} 轮调用 · {run.toolCount} 次工具 ·{' '}
                              {run.usage.cost === null
                                ? '费用未知'
                                : `估算 ${run.usage.currency} ${run.usage.cost.toFixed(4)}`}{' '}
                              · 输入 {run.usage.input ?? '未知'} / 输出 {run.usage.output ?? '未知'}
                            </details>
                          </article>
                          {error && <p className="inline-warning" role="alert">{requestErrorText(error)}</p>}
                          <TaskDiscussion key={`${p.id}:${run.id}`} conversationId={snapshot.conversations?.find(conversation => conversation.runId === run.id && !conversation.archived)?.id} projectSessionId={snapshot.projectSessionId} run={run} limits={p.config} profileId={profileId} busy={taskBusy} scroll={chatScroll} refresh={refresh} onRun={setSelectedRun} onNavigate={navigateTask} onContext={receiveDiscussionContext} />
                        </>
                      )}
                      </div>
                    </div>
                  </div>
                  <div className="composer">
                    <textarea
                      aria-label="写作任务"
                      placeholder={feedbackRun ? '直接告诉我怎么改；有疑问也可以在这里问。' : '输入创作要求或想讨论的问题…'}
                      value={request}
                      onChange={(e) => setRequest(e.target.value)}
                      onKeyDown={event => sendOnEnter(event, !!request.trim() && !!profileId && !taskBusy, () => void sendTaskMessage())}
                    />
                    <div className="composer-toolbar">
                      <div className="composer-tools">
                        <details className="composer-extra-tools"><summary aria-label="更多创作选项">＋</summary><div>
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
                        </div></details>
                      </div>
                      <div className="composer-actions">
                        <ModelControl profiles={snapshot.profiles} profileId={profileId} onProfileChange={setProfileId} onPendingChange={setModelPending} label="本次模型与推理强度" />
                        <ContextMeter profile={snapshot.profiles.find(profile => profile.id === profileId)} usage={latestContext([
                          { contextUsage: run?.contextUsage }, { contextUsage: discussionContext?.runId === run?.id ? discussionContext?.usage : undefined }
                        ])} />
                        {running || snapshot.chatBusy ? (
                          <button
                            className="stop composer-send"
                            aria-label="停止执行"
                            title="停止执行"
                            onClick={() => void act(() => running ? invoke('run.cancel') : invoke('chat.stop'))}
                          >
                            <Square size={13} fill="currentColor" aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            className="primary composer-send"
                            disabled={busy || !profileId || snapshot.chatBusy || (discussionRun ? !request.trim() : mode === 'stage' ? !!pendingStage : !request.trim())}
                            aria-label={discussionRun ? '发送消息' : mode === 'stage' ? '确认开始本阶段' : '确认开始修订'}
                            title={
                              !profileId
                                ? '请先选择模型'
                                : discussionRun
                                  ? '发送消息'
                                : mode === 'stage'
                                  ? '确认开始本阶段'
                                  : '确认开始修订'
                            }
                            aria-describedby="composer-confirmation"
                            onClick={() => void sendTaskMessage()}
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
                      : discussionRun
                        ? 'Enter 发送消息，Shift+Enter 换行。'
                      : mode === 'stage'
                        ? '点击 ↑ 确认开始本阶段。'
                        : '点击 ↑ 确认开始修订。'}
                  </div>
                </section>
              )}
              {workView !== 'objects' && <NarrativePanel snapshot={snapshot} run={run} onSource={setSource} />}
            </div>
            {editorOpen && workView !== 'objects' && (
              <aside className="editor-panel">
                <nav className="inspector-tabs" aria-label="作品面板">
                  {(
                    [
                      ['manuscript', '文稿'],
                      ['characters', '人物'],
                      ['story', '故事'],
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
                  <CharacterInspector snapshot={snapshot} run={run} onSource={setSource} />
                ) : inspector === 'story' ? (
                  <StoryInspector snapshot={snapshot} run={run} onSource={setSource} />
                ) : inspector === 'details' ? (
                  <div className="diagnostics-inspector">
                    <ManuscriptCoverage snapshot={snapshot} run={run} />
                    <h3>当前任务</h3>
                    <p>{run ? run.creative && run.status === 'complete' ? '已完成' : status[run.status] : '暂无任务'}</p>
                    {run && <p>本任务推理强度：{reasoningLabel(run.reasoningEfforts?.[run.profileId])}</p>}
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
                                    loadDocumentHistory(doc.path)
                                  );
                              }}
                            >
                              {label}
                            </button>
                          ))}
                          <span>{doc.runId ? '待采纳草稿' : '文稿'}</span>
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
                          liveDocumentRun ? <LiveProseEditor session={snapshot.projectSessionId} run={liveDocumentRun} onSelection={setSelection} /> : <Editor
                            value={text}
                            onChange={setText}
                            onSelection={setSelection}
                            readOnly={
                              doc.path === '02_项目配置/标签创作契约.md' ||
                              !!(
                                doc.runId &&
                                (visibleRuns.find((r) => r.id === doc.runId)?.planning ||
                                  visibleRuns.find((r) => r.id === doc.runId)?.status === 'running')
                              )
                            }
                          />
                        ) : editorTab === 'diff' || editorTab === 'disk' ? (
                          <Difference
                            before={editorTab === 'disk' ? (doc.disk ?? doc.before) : doc.before}
                            after={text}
                          />
                        ) : editorTab === 'preview' ? (
                          liveDocumentRun ? <LiveMarkdown binding={proseBinding(snapshot.projectSessionId, liveDocumentRun)} format="prose" className="markdown-preview" label="实时正文" /> : <MarkdownContent
                            className="markdown-preview"
                            label={doc.path.split('/').at(-1)?.replace(/\.md$/, '')}
                            content={documentPreviewText(text)}
                            allowImages
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
                          />
                        ) : (
                          <div className="history-list">
                            {histories.map((h) => (
                              <div key={h.hash}>
                                <time>{new Date(h.createdAt).toLocaleString()}</time>
                                <button
                                  onClick={() =>
                                    void act(async () => {
                                      const old = await invoke('document.read', {
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
                            {liveDocumentRun ? <LiveProseCount session={snapshot.projectSessionId} run={liveDocumentRun} /> : Array.from(text.replace(/\s/g, '')).length.toLocaleString()} 字符 · UTF-8
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
                                !!(doc.runId && visibleRuns.find((r) => r.id === doc.runId)?.accepted)
                              }
                              onClick={() => void saveDraft()}
                            >
                              保存草稿
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
      {titleConfirmation && titleConfirmation.projectId === p?.id && (
        <ConfirmBookTitle
          busy={busy}
          error={error}
          startNext={titleConfirmation.startNext}
          onClose={() => { if (!busy) setTitleConfirmation(null); }}
          onConfirm={title => void acceptRun(titleConfirmation.candidate, titleConfirmation.startNext, titleConfirmation.warningReason, title)}
        />
      )}
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
          profiles={snapshot.profiles}
          initialProfileId={profileId}
          onStarted={(id, tagged) => {
            setSelectedRun(id);
            setWorkView(tagged ? 'tags' : 'tasks');
          }}
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
      {agentSettings && <AssistantSettings profiles={snapshot.profiles} onClose={() => setAgentSettings(false)} />}
      {modal === 'project' && p && (
        <ProjectSettings
          config={p.config}
          projectSessionId={snapshot.projectSessionId}
          initialProfileId={profileId}
          profiles={snapshot.profiles}
          onClose={() => setModal(null)}
          onPublishing={() => setModal('publishing')}
          profileManaged={snapshot.documents.some(document => document.path === '02_项目配置/创作与发布.md')}
          act={act}
        />
      )}
      {modal === 'publishing' && p && <PublishingSettings snapshot={snapshot} onClose={() => setModal(null)} onProposed={id => {
        setModal(null); setSelectedRun(id); setPage('work'); setWorkView('tasks'); void refresh();
      }} />}
      {modal === 'trash' && <RecycleBin onClose={() => setModal(null)} act={act} />}
      {modal === 'transfer' && (
        <Transfer
          snapshot={snapshot}
          act={act}
          onClose={() => setModal(null)}
          onImport={async (file, content) => {
            const r = await act(() =>
              invoke('document.save', { path: file, content, baseHash: null })
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
function ConfirmBookTitle({ busy, error, startNext, onClose, onConfirm }: {
  busy: boolean;
  error: string;
  startNext: boolean;
  onClose: () => void;
  onConfirm: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  return (
    <Modal title="确认书名" onClose={onClose}>
      <form className="modal-body form" onSubmit={event => { event.preventDefault(); if (!busy && title.trim()) onConfirm(title.trim()); }}>
        <label>
          书名
          <input autoFocus required maxLength={80} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="根据刚确认的故事方向填写书名" />
        </label>
        {error && <p role="alert" className="inline-warning">{error}</p>}
        <div className="modal-footer">
          <button type="button" disabled={busy} onClick={onClose}>返回查看方向</button>
          <button className="primary" disabled={busy || !title.trim()}>{busy ? '正在保存…' : startNext ? '确认书名并继续' : '确认书名并保存'}</button>
        </div>
      </form>
    </Modal>
  );
}
function NewProject({ onClose, onCreated, onStarted, profiles, initialProfileId, act }: {
  onClose: () => void;
  onCreated: () => void;
  onStarted: (id: string, tagged: boolean) => void;
  profiles: Profile[];
  initialProfileId: string;
  act: Act;
}) {
  const [tagInput, setTagInput] = useState(() => ({ ...emptyTagInput(), bookProfile: emptyBookProfile() }));
  const [openingMode, setOpeningMode] = useState<OpeningMode>('planning'),
    [title, setTitle] = useState(''),
    [previewEnabled, setPreviewEnabled] = useState(false),
    [style, setStyle] = useState(defaultWritingStyle),
    [styleBusy, setStyleBusy] = useState(false),
    [capacity, setCapacity] = useState({ targetWords: 3_000_000, chapterWords: 2500, minWords: 2300, maxWords: 2700 });
  const [parent, setParent] = useState(''),
    [premise, setPremise] = useState(''),
    [createError, setCreateError] = useState(''),
    [submitting, setSubmitting] = useState(false),
    [reasoningPending, setReasoningPending] = useState(false),
    [profileId, setProfileId] = useState(initialProfileId || profiles.find(p => p.protocol !== 'images')?.id || ''),
    [previewList, setPreviewList] = useState<string[]>([]);
  const locationError = newProjectLocationError(parent);
  const tagged = !!tagInput.selection.reading.main || !!tagInput.bookProfile?.publishing?.reading.main;
  const hasIdea = !!premise.trim() || tagged || !!tagInput.bookProfile?.creativeGenres.length;
  const incompletePublishing = !!tagInput.bookProfile?.publishing && !tagInput.bookProfile.publishing.reading.main;
  return (
    <Modal title="新建作品" onClose={() => { if (!submitting) onClose(); }} wide>
      <form
        className="modal-body form"
        onSubmit={(e) => {
          e.preventDefault();
          if (submitting || reasoningPending || styleBusy || locationError || incompletePublishing) return;
          setCreateError('');
          setSubmitting(true);
          void act(async () => {
            let created: Snapshot;
            try {
              created = await invoke('project.create', newProjectRequest({
                mode: openingMode, parent, premise, title, profileId, capacity, previewEnabled, style,
                creationInput: cleanTagInput({ ...tagInput, premise })
              }));
            } catch (error) {
              setCreateError((error as Error).message);
              return;
            }
            onCreated();
            if (!profileId) return;
            try {
              const id = openingMode === 'existing'
                ? await invoke('run.start', { request: '按原 Skill 执行 S01，完整保留作者提供的设定、硬约束和叙事承诺。', profileId })
                : await invoke('creation.start', { inputHash: created.tagDraft!.inputHash, profileId, requestId: crypto.randomUUID() });
              onStarted(id, openingMode === 'planning');
            } catch (error) {
              throw new Error(`作品已创建，暂未开始生成：${(error as Error).message}。可以在当前作品中继续，无需重新创建。`);
            }
          }).finally(() => setSubmitting(false));
        }}
      >
        <label>
          保存位置
          <div className="input-action">
            <input readOnly required value={parent} title={parent} aria-invalid={!!locationError} aria-describedby="new-project-location-help" placeholder="选择本机目录" />
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void act(async () => {
                  const v = await invoke('app.chooseDirectory', { title: '选择新作品的保存位置' });
                  if (v) { setParent(v); setCreateError(''); }
                })
              }
            >
              选择目录
            </button>
          </div>
        </label>
        <p id="new-project-location-help" role={locationError ? 'alert' : undefined} className={`project-location-feedback ${locationError ? 'error-text' : 'muted'}`}>
          {locationError || '选择存放作品的文件夹，客户端会在里面为新作品建立独立目录。'}
        </p>
        <label>
          开书方式
          <select value={openingMode} disabled={submitting} onChange={e => setOpeningMode(e.target.value as OpeningMode)}>
            <option value="planning">从创意开始策划</option>
            <option value="existing">已有完整设定</option>
          </select>
        </label>
        {openingMode === 'existing' && <label>书名（选填）<input value={title} maxLength={80} disabled={submitting} onChange={e => setTitle(e.target.value)} placeholder="可填写已有书名，也可在确认故事核时确定" /></label>}
        <label>
            {openingMode === 'existing' ? '完整设定与必须保留的内容' : '创作想法'}
            <textarea
              required={openingMode === 'existing' || (!tagged && !tagInput.bookProfile?.creativeGenres.length)}
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              rows={openingMode === 'existing' ? 8 : 4}
              placeholder={openingMode === 'existing' ? '粘贴已有的故事核、规则、人物、分卷和开篇安排。' : '一句话也可以。例如：夜班检修员在电梯故障中发现异常规则。'}
            />
        </label>
        <TagForm value={{ ...tagInput, premise }} onChange={value => { setTagInput({ ...value, bookProfile: value.bookProfile ?? emptyBookProfile() }); setPremise(value.premise); }} disabled={submitting} showPremise={false} optionalTags />
        <div className="new-project-model"><span>创作模型</span><ModelControl profiles={profiles} profileId={profileId} onProfileChange={setProfileId} disabled={submitting} onPendingChange={setReasoningPending} label="创作模型与推理强度" /></div>
        <WritingStyleField value={style} onChange={setStyle} profileId={profileId} disabled={submitting || reasoningPending} onBusyChange={setStyleBusy}
          context={{ premise, genre: tagInput.bookProfile?.creativeGenres.join('、') ?? '', pov: '第三人称',
            bookProfile: tagInput.bookProfile, readingMain: tagInput.selection.reading.main,
            constraints: [...tagInput.mustKeep.map(text => `必须保留：${text}`), ...tagInput.mustAvoid.map(text => `不能出现：${text}`)].join('\n') }} />
        <div className="form-grid">
          {([['targetWords', '目标总字数'], ['chapterWords', '单章目标字数'], ['minWords', '每章最少字数'], ['maxWords', '每章最多字数']] as const).map(([key, label]) => (
            <label key={key}>{label}<input type="number" min={1} step={1} required disabled={submitting} value={capacity[key]} onChange={e => setCapacity(value => ({ ...value, [key]: Number(e.target.value) }))} /></label>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={previewEnabled} disabled={submitting} onChange={e => setPreviewEnabled(e.target.checked)} />实时节奏预览（增加模型调用）</label>
        <details>
          <summary>初始文件</summary>

        <button
          type="button"
          onClick={() =>
            void act(async () => setPreviewList(await invoke('project.preview', { premise })))
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
        </details>
        {createError && <p className="project-location-feedback error-text" role="alert">{createError}</p>}
        <div className="modal-footer">
          <button type="button" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={submitting || reasoningPending || styleBusy || !!locationError || !parent || incompletePublishing || !style.trim() || (openingMode === 'planning' ? !hasIdea : !premise.trim())}>
            {submitting ? '正在创建…' : profileId ? '创建并开始' : '创建作品'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ProjectSettings({
  config,
  projectSessionId,
  initialProfileId,
  profiles,
  onClose,
  onPublishing,
  profileManaged,
  act
}: {
  config: ProjectConfig;
  projectSessionId?: string;
  initialProfileId: string;
  profiles: Profile[];
  onClose: () => void;
  onPublishing: () => void;
  profileManaged: boolean;
  act: Act;
}) {
  const [c, setC] = useState(config),
    [styleBusy, setStyleBusy] = useState(false),
    [advanced, setAdvanced] = useState(JSON.stringify(config.stageProfiles, null, 2));
  const field = (key: keyof ProjectConfig, value: unknown) => setC((s) => ({ ...s, [key]: value }));
  return (
    <Modal title="作品设置" onClose={onClose} wide>
      <form
        className="modal-body form"
        onSubmit={(e) => {
          e.preventDefault();
          if (styleBusy) return;
          void act(async () => {
            await invoke('project.configure', { config: { ...c, style: normalizeWritingStyle(c.style), stageProfiles: JSON.parse(advanced) } });
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
          <label>
            正文生成方式
            <select value={c.proseMode ?? 'chapter'} onChange={e => field('proseMode', e.target.value)}>
              <option value="chapter">整章生成</option>
              <option value="scene">逐场生成（每场一次写作调用，需视角人物）</option>
            </select>
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
                max={key === 'maxRounds' ? 100 : key === 'maxTools' ? 500 : undefined}
                value={c[key as keyof ProjectConfig] as number}
                id={`project-setting-${key}`}
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
            <input value={c.genre} readOnly={profileManaged} onChange={(e) => field('genre', e.target.value)} />
          </label>
        </div>
        <button type="button" onClick={onPublishing}>题材与发布分类</button>
        <WritingStyleField value={c.style} onChange={style => field('style', style)} projectSessionId={projectSessionId}
          profileId={projectSessionId ? c.modelRouting.writing || c.defaultProfileId || initialProfileId : ''} onBusyChange={setStyleBusy}
          context={{ premise: '', genre: c.genre, pov: c.pov, constraints: c.constraints }} />
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
              id="project-setting-stageBudget"
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
                  const value = await invoke('app.chooseDirectory');
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
          <button className="primary" disabled={styleBusy || !c.style.trim()}>保存设置</button>
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
  const dialogs = useDialogs(snapshot.projectSessionId);
  const [preview, setPreview] = useState<{ content: string; warnings: string[]; name: string } | null>(null),
    [file, setFile] = useState(''),
    [checked, setChecked] = useState(false),
    [selection, setSelection] = useState(
      snapshot.documents.filter((d) => d.path.startsWith('07_')).map((d) => d.path)
    );
  return (
    <Modal
      title="导入、导出与备份"
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
                  const source = await invoke('app.chooseDirectory', {
                    title: `选择${brand.name}备份目录`
                  });
                  if (!source) return;
                  const parent = await invoke('app.chooseDirectory', {
                    title: '选择恢复位置'
                  });
                  if (parent) {
                    const result = await invoke('project.restoreBackup', { source, parent });
                    await dialogs.alert(`已恢复到新目录：${result}`);
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
                    const source = await invoke('app.chooseFile');
                    if (source) {
                      const p = await invoke('project.importDocument', { file: source });
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
                    const target = await invoke('app.chooseFile', {
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
                      const files = await invoke('project.repair', { preview: true });
                      if (Array.isArray(files) && await dialogs.confirm('以下文件将作为修复候选，已有文稿不会覆盖：\n' + files.join('\n')))
                        await invoke('project.repair');
                    }, '修复候选已建立，请回工作台审阅')
                  }
                >
                  预览并修复缺失模板 / 索引
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      const report = await invoke('diagnostics.export');
                      const blob = new Blob([report], { type: 'application/json' });
                      const url = URL.createObjectURL(blob),
                        a = document.createElement('a');
                      a.href = url;
                      a.download = `${brand.name}诊断.json`;
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
                      const directory = await invoke('app.chooseDirectory', {
                        title: '选择备份目录'
                      });
                      if (directory) {
                        const target = await invoke('project.backup', { directory });
                        await dialogs.alert(`备份已保存：${target}`);
                      }
                    })
                  }
                >
                  立即完整备份
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      const source = await invoke('app.chooseDirectory', {
                        title: `选择${brand.name}备份目录`
                      });
                      if (!source) return;
                      const parent = await invoke('app.chooseDirectory', {
                        title: '选择恢复位置（创建新目录）'
                      });
                      if (parent) {
                        const result = await invoke('project.restoreBackup', { source, parent });
                        await dialogs.alert(`已恢复到新目录：${result}`);
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
  const dialogs = useDialogs(title);
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
      <div className="cover-layout">
        <div className="form">
          <button
            onClick={() =>
              void act(async () => {
                const files = await invoke('cover.list');
                if (!files.length) throw new Error('尚无已保存封面');
                const name = await dialogs.prompt('输入要打开的配置路径：\n' + files.join('\n'), { title: '打开已保存的封面', inputLabel: '配置路径', defaultValue: files.at(-1) });
                if (name) {
                  const m = await invoke('cover.load', { path: name });
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
                const r = await invoke('cover.generate', { profileId: profile, prompt });
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
