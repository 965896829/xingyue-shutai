import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, ArrowLeft, ArrowUp, Square, Sparkles, Settings, ChevronDown, Zap } from 'lucide-react';
import { invokeCommand as invoke } from '../../shared/client';
import {
  labGenerateSchema,
  labRequirementsSchema,
  labHeadings,
  labSections,
  type LabContext,
  type LabDetail,
  type LabGenerate,
  type LabRequest,
  type LabSession
} from '../../shared/story-lab';
import type { Profile } from '../../shared/types';
import { MarkdownContent } from '../MarkdownContent';
import { LabEditor, type LabSelection } from './LabEditor';
import { GenerationStatus } from '../GenerationStatus';
import { ContextMeter } from '../ContextMeter';
import { reasoningLabel } from '../../shared/reasoning';
import { sendOnEnter } from '../composer-keyboard';
import '../model-control.css';
import './story-lab.css';

const statusLabels: Record<LabRequest['status'], string> = {
  running: '正在生成',
  complete: '请求已完成',
  length: '输出额度用完 · 可继续展开',
  cancelled: '已停止本地接收',
  unknown: '远端结果未知 · 未自动重发',
  not_sent: '未发送 / 未被服务端接受',
  filtered: '服务端中止输出'
};
const actionLabels: Record<LabGenerate['action'], string> = {
  blueprint: '完整作品构想',
  discuss: '自由讨论',
  revise: '局部修改',
  expand: '展开大纲',
  prose: '正文试写',
  continue: '继续展开'
};
const money = (r: LabRequest) =>
  r.usage.cost === null ? '费用未知' : `${r.usage.cost.toFixed(6)} ${r.usage.currency}`;
function readDraft(key: string) {
  try {
    return localStorage.getItem(`story-lab:${key}`) ?? '';
  } catch {
    return '';
  }
}

export function StoryLab({
  active,
  profiles,
  formalBusy,
  onBack,
  onSettings,
  onHide
}: {
  active: boolean;
  profiles: Profile[];
  formalBusy: boolean;
  onBack: () => void;
  onSettings: () => void;
  onHide: () => void;
}) {
  const [sessions, setSessions] = useState<LabSession[]>([]),
    [selectedId, setSelectedId] = useState(''),
    [detail, setDetail] = useState<LabDetail>();
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [idea, setIdea] = useState(() => readDraft('idea')),
    [targetWords, setTargetWords] = useState(''),
    [chapterWords, setChapterWords] = useState('');
  const [keep, setKeep] = useState(''),
    [avoid, setAvoid] = useState(''),
    [existing, setExisting] = useState('');
  const [profileId, setProfileId] = useState(''),
    [outputLimit, setOutputLimit] = useState(16384);
  const [instruction, setInstruction] = useState(''),
    [action, setAction] = useState<LabGenerate['action']>('discuss');
  const [scope, setScope] = useState<'full' | 'core'>('full'),
    [viewId, setViewId] = useState(''),
    [selection, setSelection] = useState<LabSelection>();
  const [sectionIndexes, setSectionIndexes] = useState<number[]>(),
    [concealed, setConcealed] = useState(''),
    [recentIds, setRecentIds] = useState<string[]>();
  const [preview, setPreview] = useState<LabContext>(),
    [acknowledgeUnknown, setAcknowledgeUnknown] = useState(false),
    [pin, setPin] = useState('');
  const [sessionsOpen, setSessionsOpen] = useState(false),
    [workspaceView, setWorkspaceView] = useState<'conversation' | 'document'>('conversation');
  const pageRef = useRef<HTMLDivElement>(null),
    composerRef = useRef<HTMLTextAreaElement>(null),
    settingsRef = useRef<HTMLDetailsElement>(null),
    optionsRef = useRef<HTMLDetailsElement>(null);
  const currentId = useRef(selectedId);
  currentId.current = selectedId;
  const busyRef = useRef(false),
    refreshSeq = useRef(0);
  const models = profiles.filter((p) => p.enabled && p.protocol !== 'images');
  const model = models.find((p) => p.id === (detail?.session.profileId ?? profileId));
  const version = detail?.versions.find((v) => v.id === viewId) ?? detail?.versions.at(-1);
  const plan = detail?.versions.find((v) => v.id === detail.session.currentVersionId);
  const running = detail?.requests.find((r) => r.status === 'running');
  const unknown = detail?.requests.some(
    (r) => r.status === 'unknown' || (r.status === 'cancelled' && r.usage.cost === null)
  );
  const contextVersion = action === 'revise' ? version : plan;
  const headings = labHeadings(contextVersion?.content ?? '');
  const latestUserIndex =
    detail?.messages.reduce((last, message, index) => (message.role === 'user' ? index : last), 0) ?? 0;
  function openDocument(id?: string) {
    if (id) setViewId(id);
    setWorkspaceView('document');
    requestAnimationFrame(() => pageRef.current?.scrollTo({ top: 0 }));
  }
  function focusComposer() {
    setWorkspaceView('conversation');
    if (optionsRef.current) optionsRef.current.open = false;
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ block: 'center' });
      composerRef.current?.focus({ preventScroll: true });
    });
  }
  function openSettings() {
    if (settingsRef.current) settingsRef.current.open = true;
    requestAnimationFrame(() => {
      pageRef.current?.scrollTo({ top: 0 });
      settingsRef.current?.querySelector('summary')?.focus();
    });
  }
  const canSend =
    !busy &&
    !running &&
    (action === 'blueprint' || !!instruction.trim()) &&
    (action !== 'revise' || !!selection) &&
    (!unknown || acknowledgeUnknown);
  async function stopRequest() {
    if (!detail || !running) return;
    await invoke('lab.cancel', { sessionId: detail.session.id, requestId: running.id });
    await refresh(detail.session.id);
  }
  function renderMessage(message: LabDetail['messages'][number]) {
    const request = detail?.requests.find((row) => row.id === message.requestId);
    return (
      <article className={message.role === 'user' ? 'user-message' : 'assistant-message'} key={message.id}>
        <small>
          {message.role === 'user' ? '你' : '创作伙伴'}{' '}
          {message.role === 'assistant' && request && (
            <GenerationStatus
              variant="elapsed"
              running={false}
              label={statusLabels[request.status]}
              activity={{
                startedAt: request.startedAt,
                updatedAt: request.endedAt ?? request.startedAt,
                stoppedAt: request.endedAt,
                phase: 'preparing'
              }}
            />
          )}
        </small>
        <MarkdownContent content={message.content} />
        {message.versionId && (
          <div className="button-row subdued">
            <button onClick={() => openDocument(message.versionId!)}>查看 / 编辑这份候选</button>
          </div>
        )}
      </article>
    );
  }
  const refresh = useCallback(async (id: string) => {
    const seq = ++refreshSeq.current;
    const result = await invoke('lab.read', { sessionId: id });
    if (currentId.current === id && seq === refreshSeq.current) setDetail(result);
    return result;
  }, []);
  async function perform<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!profileId && models.length) {
      setProfileId(models[0].id);
      setOutputLimit(Math.min(16384, models[0].outputLimit));
    }
  }, [profiles, profileId]);
  useEffect(() => {
    if (!active || loaded) return;
    void invoke('lab.list')
      .then((rows) => {
        setSessions(rows);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [active, loaded]);
  useEffect(() => {
    setWorkspaceView('conversation');
    setSessionsOpen(false);
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    setDetail(undefined);
    setViewId('');
    setSelection(undefined);
    setPreview(undefined);
    setSectionIndexes(undefined);
    setRecentIds(undefined);
    setAcknowledgeUnknown(false);
    setConcealed('');
    setInstruction(readDraft(`composer:${selectedId}`));
    void refresh(selectedId).catch((e) => setError(e.message));
  }, [selectedId, refresh]);
  useEffect(() => {
    if (!active || !selectedId) return;
    void refresh(selectedId).catch((e) => setError(e.message));
    // Reconciliation survives dropped events, a renderer reload, or worker restart. It never reissues a generation.
    const timer = setInterval(() => {
      void refresh(selectedId).catch((e) => setError(e.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [active, selectedId, refresh]);
  useEffect(
    () =>
      window.wenxu?.onEvent((event) => {
        if (
          event.type !== 'story-lab' ||
          event.workspace !== 'story-lab' ||
          event.sessionId !== currentId.current
        )
          return;
        const data = event.data as { status: LabRequest['status']; offset: number } | undefined;
        if (!data || data.status !== 'running' || !event.text) {
          void refresh(event.sessionId!).catch((e) => setError(e.message));
          return;
        }
        setDetail((current) => {
          if (!current || current.session.id !== event.sessionId) return current;
          const request = current.requests.find((r) => r.id === event.requestId);
          if (
            !request ||
            request.sequence >= (event.sequence ?? 0) ||
            request.response.length !== data.offset
          )
            return current;
          return {
            ...current,
            requests: current.requests.map((r) =>
              r.id === request.id ? { ...r, response: r.response + event.text, sequence: event.sequence! } : r
            )
          };
        });
      }),
    [refresh]
  );
  useEffect(() => {
    setPreview(undefined);
  }, [instruction, action, scope, selection, sectionIndexes, recentIds, concealed, detail?.session.revision]);
  useEffect(() => {
    setSelection(undefined);
    setSectionIndexes(undefined);
  }, [version?.id]);
  useEffect(() => {
    if (!viewId && detail?.session.id === selectedId && detail.versions.length)
      setViewId(detail.versions.at(-1)!.id);
  }, [viewId, detail?.versions.length, selectedId]);
  useEffect(() => {
    if (action !== 'prose' && !(action === 'continue' && version?.kind === 'prose')) return;
    setSectionIndexes(
      headings.flatMap((h, i) =>
        /核心设定|主角|独特优势|核心人物|群像|开篇|人物表现|文风|作品声音/.test(h.title) ? [i] : []
      )
    );
  }, [action, plan?.id, version?.id]);
  function setDraft(text: string) {
    setInstruction(text);
    try {
      localStorage.setItem(`story-lab:composer:${selectedId}`, text);
    } catch {
      setError('输入缓存保存失败，请复制保留未发送的文字。');
    }
  }
  async function replaceDetail(next: LabDetail) {
    if (currentId.current === next.session.id) setDetail(next);
    setSessions(await invoke('lab.list'));
  }
  async function create() {
    const requirements = labRequirementsSchema.parse({
      idea,
      targetWords,
      chapterWords,
      keep,
      avoid,
      existing
    });
    const created = await invoke('lab.create', {
      id: crypto.randomUUID(),
      requirements,
      profileId,
      outputLimit
    });
    setSelectedId(created.session.id);
    currentId.current = created.session.id;
    await replaceDetail(created);
    return created;
  }
  function inputFor(state: LabDetail, requestedAction = action): LabGenerate {
    return labGenerateSchema.parse({
      sessionId: state.session.id,
      requestId: crypto.randomUUID(),
      action: requestedAction,
      instruction: requestedAction === 'blueprint' ? '' : instruction,
      baseVersionId: requestedAction === 'revise' ? (version?.id ?? null) : state.session.currentVersionId,
      sourceVersionId: requestedAction === 'continue' ? version?.id : undefined,
      selection: requestedAction === 'revise' ? selection : undefined,
      sectionIndexes,
      recentMessageIds: recentIds,
      concealed,
      blueprintScope: scope,
      acknowledgeUnknown,
      maxRequests: 1
    });
  }
  async function generate(first = false) {
    const state = detail ?? (await create());
    const input = inputFor(state, first ? 'blueprint' : action);
    setPreview(await invoke('lab.preview', input));
    await invoke('lab.generate', input);
    setAcknowledgeUnknown(false);
    await refresh(state.session.id);
  }
  async function updateSettings(changes: { profileId?: string; outputLimit?: number; pins?: string[] }) {
    if (!detail) return;
    const next = await invoke('lab.update', {
      sessionId: detail.session.id,
      expectedRevision: detail.session.revision,
      profileId: detail.session.profileId,
      outputLimit: detail.session.outputLimit,
      pins: detail.session.pins,
      ...changes
    });
    await replaceDetail(next);
  }
  async function exportContent(format: 'md' | 'txt', copy = false, requirementsOnly = false) {
    if (!detail) return;
    const result = await invoke('lab.export', {
      sessionId: detail.session.id,
      versionId: requirementsOnly ? undefined : version?.id,
      requirementsOnly,
      format
    });
    if (copy) {
      await navigator.clipboard.writeText(result.content);
      setNotice('已复制。');
      return;
    }
    const url = URL.createObjectURL(new Blob([result.content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`已导出，实验室备份：${result.path}`);
  }
  const modelControls = (
    <div className="lab-fields">
      <label>
        模型
        <select
          aria-label="实验室模型"
          value={detail?.session.profileId ?? profileId}
          disabled={busy}
          onChange={(e) => {
            const chosen = models.find((p) => p.id === e.target.value)!;
            if (detail)
              void perform(() =>
                updateSettings({ profileId: chosen.id, outputLimit: Math.min(16384, chosen.outputLimit) })
              );
            else {
              setProfileId(chosen.id);
              setOutputLimit(Math.min(16384, chosen.outputLimit));
            }
          }}
        >
          {!models.length && <option value="">尚无可用模型</option>}
          {models.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.model}
            </option>
          ))}
        </select>
      </label>
      <button onClick={onSettings}>模型连接设置</button>
    </div>
  );
  return (
    <div className="story-lab" hidden={!active}>
      <section className="conversation lab-page">
        <header className="workflow-heading">
          <div>
            <h1>
              自由创作实验室<span className="stage-number">实验</span>
            </h1>
            <p>
              {detail
                ? `${detail.session.requirements.targetWords || detail.session.title} · 每章 ${detail.session.requirements.chapterWords || '未指定字数'}`
                : '从一个题材组合，直接展开一本书。'}
            </p>
          </div>
          <div className="workflow-actions">
            <button
              className="flow-toggle"
              aria-expanded={sessionsOpen}
              aria-controls="lab-sessions"
              onClick={() => {
                setSessionsOpen(!sessionsOpen);
                pageRef.current?.scrollTo({ top: 0 });
              }}
            >
              我的实验 {sessions.length}
              <ChevronDown size={14} />
            </button>
            <button
              className="icon"
              aria-label="实验参数"
              title="实验参数"
              onClick={detail ? openSettings : onSettings}
            >
              <Settings size={16} />
            </button>
          </div>
        </header>
        <div className="chat-layout">
          <div className="chat-scroll" ref={pageRef}>
            <div className="chat-content">
              {formalBusy && (
                <p className="lab-warning">
                  正式作品任务仍在后台运行。实验室与其独立并发，停止实验室请求只影响本次实验。
                </p>
              )}
              {error && (
                <div role="alert" className="lab-error">
                  {error}
                  <button
                    onClick={() => {
                      setError('');
                      if (!loaded)
                        void perform(async () => {
                          setSessions(await invoke('lab.list'));
                          setLoaded(true);
                        });
                    }}
                  >
                    关闭 / 重试读取
                  </button>
                </div>
              )}
              {notice && (
                <div role="status" className="lab-notice">
                  {notice}
                  <button onClick={() => setNotice('')}>关闭</button>
                </div>
              )}
              <div className="lab-layout">
                <aside
                  className="lab-sessions"
                  id="lab-sessions"
                  hidden={!sessionsOpen}
                  aria-label="我的实验"
                >
                  <button
                    onClick={() => {
                      setSelectedId('');
                      setError('');
                      setSessionsOpen(false);
                    }}
                  >
                    <Plus size={15} />
                    新建实验
                  </button>
                  {!sessions.length && <p className="muted">每个想法都有独立的对话与版本。</p>}
                  {sessions.map((s) => (
                    <button
                      className={s.id === selectedId ? 'active' : ''}
                      key={s.id}
                      onClick={() => {
                        setSelectedId(s.id);
                        setSessionsOpen(false);
                      }}
                    >
                      <strong>{s.title}</strong>
                      <small>{new Date(s.updatedAt).toLocaleDateString('zh-CN')}</small>
                    </button>
                  ))}
                </aside>
                <div className="lab-main">
                  {!selectedId ? (
                    <section className="lab-create">
                      <span className="lab-eyebrow">从一句想法开始</span>
                      <h2>这次，想写一个怎样的故事？</h2>
                      <label>
                        创作想法或题材组合
                        <textarea
                          aria-label="创作想法或题材组合"
                          rows={5}
                          value={idea}
                          placeholder="东方玄幻＋脑洞＋规则怪谈，给我一套有强烈辨识度的完整设定。"
                          onChange={(e) => {
                            setIdea(e.target.value);
                            try {
                              localStorage.setItem('story-lab:idea', e.target.value);
                            } catch {
                              setError('输入缓存保存失败');
                            }
                          }}
                        />
                      </label>
                      <div className="lab-fields">
                        <label>
                          全书目标字数（可选）
                          <input
                            value={targetWords}
                            onChange={(e) => setTargetWords(e.target.value)}
                            placeholder="例如：300万字"
                          />
                        </label>
                        <label>
                          单章字数范围（可选）
                          <input
                            value={chapterWords}
                            onChange={(e) => setChapterWords(e.target.value)}
                            placeholder="例如：2300—2700字"
                          />
                        </label>
                      </div>
                      {modelControls}
                      <details>
                        <summary>补充要求（可选）</summary>
                        <label>
                          必须保留
                          <textarea value={keep} onChange={(e) => setKeep(e.target.value)} />
                        </label>
                        <label>
                          不想出现的内容
                          <textarea value={avoid} onChange={(e) => setAvoid(e.target.value)} />
                        </label>
                        <label>
                          已有文字
                          <textarea value={existing} onChange={(e) => setExisting(e.target.value)} />
                        </label>
                      </details>
                      <details>
                        <summary>输出与请求</summary>
                        <label>
                          本次输出上限（tokens）
                          <input
                            type="number"
                            min={128}
                            max={models.find((p) => p.id === profileId)?.outputLimit ?? 1000000}
                            value={outputLimit}
                            onChange={(e) => setOutputLimit(Number(e.target.value))}
                          />
                        </label>
                      </details>
                      {Math.min(outputLimit, model?.outputLimit ?? outputLimit) < 8192 && (
                        <p className="lab-warning">
                          此输出空间可能不足。可以先生成核心构想，再主动继续长篇展开，预计共2次请求。
                        </p>
                      )}
                      <label>
                        生成范围
                        <select value={scope} onChange={(e) => setScope(e.target.value as 'full' | 'core')}>
                          <option value="full">完整构想 · 本次1次请求</option>
                          <option value="core">先生成核心构想（1—8项）· 本次1次，后续1次</option>
                        </select>
                      </label>
                      <button
                        className="primary large"
                        disabled={busy || !idea.trim() || !profileId}
                        onClick={() => void perform(() => generate(true))}
                      >
                        <Sparkles size={17} />
                        生成完整作品构想
                      </button>
                      <p className="muted">一次生成，流式阅读。构想、讨论和试稿保存在此实验中。</p>
                    </section>
                  ) : !detail ? (
                    <p role="status">正在读取实验…</p>
                  ) : (
                    <>
                      <details className="lab-settings" ref={settingsRef}>
                        <summary>实验要求与模型</summary>
                        <div className="lab-toolbar">
                          <button onClick={onBack}>
                            <ArrowLeft size={15} />
                            原有创作工作台
                          </button>
                          <button onClick={onHide}>隐藏实验室入口</button>
                        </div>
                        <p>{detail.session.requirements.idea}</p>
                        <p>
                          {detail.session.requirements.targetWords} · 每章{' '}
                          {detail.session.requirements.chapterWords || '未指定'}
                        </p>
                        {modelControls}
                        <label>
                          后续请求输出上限（tokens）
                          <input
                            aria-label="后续请求输出上限"
                            type="number"
                            min={128}
                            max={model?.outputLimit ?? 1000000}
                            defaultValue={detail.session.outputLimit}
                            key={`${detail.session.id}:${detail.session.outputLimit}`}
                            onBlur={(e) => {
                              const limit = Number(e.target.value);
                              if (limit !== detail.session.outputLimit)
                                void perform(() => updateSettings({ outputLimit: limit }));
                            }}
                          />
                        </label>
                        <small>更改仅用于后续实验请求。每次最多1次请求；无自动重试或额外审核。</small>
                        <button onClick={() => void perform(() => exportContent('md', false, true))}>
                          导出创作要求与保留点
                        </button>
                      </details>
                      <div className="lab-work">
                        <div className="lab-conversation" hidden={workspaceView !== 'conversation'}>
                          <div className="lab-thread">
                            {latestUserIndex > 0 && (
                              <details className="lab-history">
                                <summary>较早对话 · {latestUserIndex} 条</summary>
                                {detail.messages.slice(0, latestUserIndex).map(renderMessage)}
                              </details>
                            )}
                            {detail.messages.slice(latestUserIndex).map(renderMessage)}
                            {running && (
                              <article className="assistant-message lab-live">
                                <small>
                                  创作伙伴{' '}
                                  <GenerationStatus
                                    variant="elapsed"
                                    running
                                    fallbackStart={running.startedAt}
                                  />
                                </small>
                                <MarkdownContent content={running.response || '等待模型响应…'} incremental />
                              </article>
                            )}
                            {!running &&
                              detail.requests.at(-1) &&
                              detail.requests.at(-1)!.status !== 'complete' && (
                                <div className="lab-receipt">
                                  <strong>{statusLabels[detail.requests.at(-1)!.status]}</strong>
                                  <span>
                                    请求 {detail.requests.at(-1)!.attempts} 次 ·{' '}
                                    {money(detail.requests.at(-1)!)}
                                  </span>
                                  {detail.requests.at(-1)!.error && <p>{detail.requests.at(-1)!.error}</p>}
                                  {detail.requests.at(-1)!.status === 'cancelled' && (
                                    <p>已保存收到的内容；停止本地接收不保证远端停止计费。</p>
                                  )}
                                  {detail.requests.at(-1)!.versionId && (
                                    <button
                                      onClick={() => {
                                        openDocument(detail.requests.at(-1)!.versionId!);
                                      }}
                                    >
                                      查看最新候选
                                    </button>
                                  )}
                                </div>
                              )}
                          </div>
                          <details className="lab-related">
                            <summary>相关内容与记录</summary>
                            <button onClick={() => openDocument()}>
                              方案与试稿 · {detail.versions.length}
                            </button>
                            <details className="lab-context">
                              <summary>本次使用了哪些内容</summary>
                              <p>
                                作者原始要求、明确保留点
                                {plan ? `、当前选定方案「${plan.title}」` : '；尚未选定方案'}。
                              </p>
                              {!!headings.length && (
                                <fieldset>
                                  <legend>方案资料（不勾选的部分不会发送）</legend>
                                  {headings.map((h, i) => (
                                    <label className="lab-check" key={h.start}>
                                      <input
                                        type="checkbox"
                                        checked={sectionIndexes === undefined || sectionIndexes.includes(i)}
                                        onChange={(e) => {
                                          const indexes = sectionIndexes ?? headings.map((_, index) => index);
                                          setSectionIndexes(
                                            e.target.checked
                                              ? [...indexes, i]
                                              : indexes.filter((index) => index !== i)
                                          );
                                        }}
                                      />
                                      {h.title}
                                    </label>
                                  ))}
                                </fieldset>
                              )}
                              {!!detail.messages.filter((m) => m.action === 'discuss').length && (
                                <fieldset>
                                  <legend>近期讨论（默认最近6条讨论消息）</legend>
                                  {detail.messages
                                    .filter((m) => m.action === 'discuss')
                                    .slice(-20)
                                    .map((m) => {
                                      const ids =
                                        recentIds ??
                                        detail.messages
                                          .filter((row) => row.action === 'discuss')
                                          .slice(-6)
                                          .map((row) => row.id);
                                      return (
                                        <label className="lab-check" key={m.id}>
                                          <input
                                            type="checkbox"
                                            checked={ids.includes(m.id)}
                                            onChange={(e) =>
                                              setRecentIds(
                                                e.target.checked
                                                  ? [...ids, m.id]
                                                  : ids.filter((id) => id !== m.id)
                                              )
                                            }
                                          />
                                          {m.role === 'user' ? '你' : '伙伴'}：{m.content.slice(0, 70)}
                                        </label>
                                      );
                                    })}
                                </fieldset>
                              )}
                              <label>
                                本场不应提前揭示的信息
                                <textarea value={concealed} onChange={(e) => setConcealed(e.target.value)} />
                              </label>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void perform(async () =>
                                    setPreview(await invoke('lab.preview', inputFor(detail)))
                                  )
                                }
                              >
                                查看完整请求（不调用模型）
                              </button>
                              {preview && (
                                <>
                                  <p>
                                    输入估算 {preview.estimatedInput} / {preview.availableInput} · 输出预留{' '}
                                    {preview.outputLimit} · 本次 {preview.requestCount} 次请求
                                  </p>
                                  {preview.warning && <p className="lab-warning">{preview.warning}</p>}
                                  <ul>
                                    {preview.sources.map((s, i) => (
                                      <li key={i}>{s}</li>
                                    ))}
                                  </ul>
                                  <details>
                                    <summary>实际提示词与资料</summary>
                                    <pre>{preview.system + '\n\n' + preview.user}</pre>
                                  </details>
                                </>
                              )}
                            </details>

                            <details>
                              <summary>后续保留 · {detail.session.pins.length} 条</summary>
                              {detail.session.pins.map((p, i) => (
                                <div className="lab-pin" key={i}>
                                  <p>{p}</p>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void perform(() =>
                                        updateSettings({
                                          pins: detail.session.pins.filter((_, index) => index !== i)
                                        })
                                      )
                                    }
                                  >
                                    移除
                                  </button>
                                </div>
                              ))}
                              <textarea
                                aria-label="新增保留点"
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                placeholder="例如：不改主角职业；不增加感情线。"
                              />
                              <button
                                disabled={busy || !pin.trim()}
                                onClick={() =>
                                  void perform(async () => {
                                    await updateSettings({ pins: [...detail.session.pins, pin.trim()] });
                                    setPin('');
                                  })
                                }
                              >
                                添加保留点
                              </button>
                            </details>
                            <details>
                              <summary>请求记录 · {detail.requests.length} 次操作</summary>
                              {detail.requests.map((r) => (
                                <article className="lab-request" key={r.id}>
                                  <b>
                                    {actionLabels[r.action]} · {statusLabels[r.status]}
                                  </b>
                                  <p>
                                    {r.model.model} · 输出上限 {r.model.outputLimit} · 实际请求 {r.attempts}{' '}
                                    次
                                  </p>
                                  {r.model.transport && (
                                    <p>
                                      {r.model.transport === 'http' ? 'HTTP / SSE' : 'WebSocket'}
                                      {r.model.timeoutSeconds
                                        ? ` · 无进展等待上限 ${r.model.timeoutSeconds} 秒`
                                        : ''}
                                    </p>
                                  )}
                                  <p>
                                    输入 {r.usage.input ?? '未知'} / 输出 {r.usage.output ?? '未知'} tokens ·{' '}
                                    {money(r)}
                                  </p>
                                  <small>{r.id}</small>
                                  {r.error && <p>{r.error}</p>}
                                  {r.failure && (
                                    <details>
                                      <summary>连接诊断</summary>
                                      <pre>{JSON.stringify(r.failure, null, 2)}</pre>
                                    </details>
                                  )}
                                  <details>
                                    <summary>本次完整输入与原始回答</summary>
                                    <pre>
                                      {r.context.system +
                                        '\n\n' +
                                        r.context.user +
                                        '\n\n原始回答：\n' +
                                        r.response}
                                    </pre>
                                  </details>
                                </article>
                              ))}
                            </details>
                          </details>
                        </div>
                        <div className="lab-document" hidden={workspaceView !== 'document'}>
                          <button onClick={focusComposer}>
                            <ArrowLeft size={15} />
                            返回对话，继续创作
                          </button>
                          <label>
                            方案与试稿历史
                            <select
                              aria-label="方案与试稿历史"
                              value={version?.id ?? ''}
                              onChange={(e) => {
                                setViewId(e.target.value);
                                setSelection(undefined);
                              }}
                            >
                              {!detail.versions.length && <option value="">生成后在这里查看</option>}
                              {[...detail.versions].reverse().map((v, i) => (
                                <option key={v.id} value={v.id}>
                                  {detail.versions.length - i}. {v.title}{' '}
                                  {v.id === detail.session.currentVersionId ||
                                  v.id === detail.session.currentProseId
                                    ? '（当前选定）'
                                    : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          {version ? (
                            <LabEditor
                              key={version.id}
                              detail={detail}
                              version={version}
                              busy={busy}
                              onSelection={(value) => {
                                setSelection(value);
                                setAction('revise');
                              }}
                              onRevise={(value) => {
                                setSelection(value);
                                setAction('revise');
                                focusComposer();
                              }}
                              onPin={(text) =>
                                void perform(() => updateSettings({ pins: [...detail.session.pins, text] }))
                              }
                              onExport={(format, copy) => void perform(() => exportContent(format, copy))}
                              onEdit={async (content) => {
                                const result = await perform(async () => {
                                  const next = await invoke('lab.edit', {
                                    sessionId: detail.session.id,
                                    baseVersionId: version.id,
                                    content,
                                    title: `${version.title} · 手改`,
                                    expectedRevision: detail.session.revision
                                  });
                                  await replaceDetail(next);
                                  setViewId(next.versions.at(-1)!.id);
                                  return true;
                                });
                                if (!result) throw new Error('手改尚未保存，请保留编辑内容。');
                              }}
                              onSelectVersion={async (reviewedStale) => {
                                await perform(async () => {
                                  await replaceDetail(
                                    await invoke('lab.select', {
                                      sessionId: detail.session.id,
                                      versionId: version.id,
                                      expectedRevision: detail.session.revision,
                                      reviewedStale
                                    })
                                  );
                                  setNotice('已选定实验室版本，原稿保留。');
                                });
                              }}
                            />
                          ) : (
                            <div className="lab-empty">
                              <Sparkles size={28} />
                              <h3>先让故事长出来</h3>
                              <p>完整回答会保留为 Markdown 候选。目录仅用于导航，不是关卡。</p>
                            </div>
                          )}
                          {version?.kind === 'blueprint' && (
                            <details>
                              <summary>构想目录参考（缺项可主动补充）</summary>
                              <p>标题识别不等于创作质量，未识别的原文完整保留。</p>
                              <ol>
                                {labSections.map((title) => (
                                  <li key={title}>
                                    {title}{' '}
                                    {!labHeadings(version.content).some((h) => h.title.includes(title)) && (
                                      <button
                                        onClick={() => {
                                          setAction('expand');
                                          setDraft(`补充或展开「${title}」，沿用当前选定方案。`);
                                          focusComposer();
                                        }}
                                      >
                                        补充这一部分
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            </details>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        {detail && selectedId && (
          <div className="composer" hidden={workspaceView !== 'conversation'}>
            {action === 'revise' && (
              <p className="muted">
                {selection
                  ? `已选择 ${selection.text.length} 字符，基于当前查看的候选。`
                  : '请打开“方案与试稿”，从目录或编辑器中选择原文。'}
              </p>
            )}
            {action === 'continue' && (
              <p className="muted">
                继续当前查看的「{version?.title ?? '请选择版本'}」，新内容追加为独立片段。
              </p>
            )}
            {unknown && (
              <label className="lab-check lab-warning">
                <input
                  type="checkbox"
                  checked={acknowledgeUnknown}
                  onChange={(e) => setAcknowledgeUnknown(e.target.checked)}
                />
                此前请求的结果或费用未知。我已知晓，仍发送1次新请求。
              </label>
            )}
            <textarea
              ref={composerRef}
              aria-label="继续讨论或创作要求"
              onKeyDown={(event) => sendOnEnter(event, canSend, () => void perform(() => generate()))}
              value={instruction}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="输入创作要求或想讨论的问题…"
            />
            <div className="composer-toolbar">
              <div className="composer-tools">
                <details className="composer-extra-tools" ref={optionsRef}>
                  <summary aria-label="更多创作选项">＋</summary>
                  <div className="lab-compose-options">
                    <label className="lab-option-label">
                      <span>本次创作</span>
                      <select
                        aria-label="本次创作"
                        value={action}
                        onChange={(e) => {
                          setAction(e.target.value as LabGenerate['action']);
                          setSelection(undefined);
                          setSectionIndexes(undefined);
                          if (e.target.value !== 'blueprint') focusComposer();
                        }}
                      >
                        {Object.entries(actionLabels).map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {action === 'blueprint' && (
                      <label>
                        生成范围
                        <select value={scope} onChange={(e) => setScope(e.target.value as 'full' | 'core')}>
                          <option value="full">完整构想 · 本次1次请求</option>
                          <option value="core">先生成1—8项 · 本次1次，后续另1次</option>
                        </select>
                      </label>
                    )}
                    {action === 'blueprint' &&
                      Math.min(detail.session.outputLimit, model?.outputLimit ?? detail.session.outputLimit) <
                        8192 && (
                        <p className="lab-warning">
                          当前输出空间可能不足。可先生成核心构想，再主动继续长篇展开；预计共2次请求，不会自动发送第二次。
                        </p>
                      )}
                    <div className="lab-toolbar">
                      <button
                        onClick={() => {
                          setAction('prose');
                          setDraft('用当前选定方案试写第一章，遵守单章字数范围。');
                          focusComposer();
                        }}
                      >
                        试写第一章
                      </button>
                      <button
                        onClick={() => {
                          setAction('continue');
                          setDraft('从中断处继续展开尚未完成的部分。');
                          focusComposer();
                        }}
                      >
                        继续展开
                      </button>
                      {detail.requests.some((r) => r.input.blueprintScope === 'core') && (
                        <button
                          onClick={() => {
                            setAction('continue');
                            setDraft('沿用核心构想，继续第9—17项的长篇展开。');
                            focusComposer();
                          }}
                        >
                          展开第9—17项
                        </button>
                      )}
                    </div>
                    <small>每次只发送1次请求；继续和补充均会产生新请求。</small>
                  </div>
                </details>
              </div>
              <div className="composer-actions">
                <button
                  className="model-control-trigger"
                  aria-label="实验室模型与推理强度"
                  title="查看实验室模型设置"
                  onClick={openSettings}
                >
                  <Zap size={14} aria-hidden="true" />
                  <span className="model-control-current">{model?.model ?? '选择模型'}</span>
                  {model && (
                    <span className="model-control-effort">{reasoningLabel(model.reasoningEffort)}</span>
                  )}
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
                <ContextMeter
                  profile={
                    model
                      ? { ...model, outputLimit: Math.min(model.outputLimit, detail.session.outputLimit) }
                      : undefined
                  }
                />
                {running ? (
                  <button
                    className="composer-send stop"
                    aria-label="停止本次请求"
                    title="停止本次请求"
                    onClick={() => void perform(stopRequest)}
                  >
                    <Square size={16} />
                  </button>
                ) : (
                  <button
                    className="composer-send primary"
                    disabled={!canSend}
                    aria-label={`${actionLabels[action]} · 发送1次请求`}
                    title={`${actionLabels[action]} · 发送1次请求`}
                    onClick={() => void perform(() => generate())}
                  >
                    <ArrowUp size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
