import { useDialogs } from './AppDialogs';
import { invokeCommand } from '../shared/client';
import { GenerationStatus } from './GenerationStatus';
import { LiveMarkdown } from './LiveMarkdown';
import { reasoningLabel } from '../shared/reasoning';
import { mergeRows as merge, readChatUpdates } from '../shared/chat-history';
import type { CommandInput, CommandOutput } from '../shared/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Archive, RotateCcw, Sparkles, FileText } from 'lucide-react';
import type { Command, Snapshot } from '../shared/types';
import type {
  Conversation,
  ConversationMessage,
  ConversationTurn,
  ActionProposal,
  DraftArtifact
} from '../shared/assistant';
import { ProximitySidebar } from './ProximitySidebar';
import { ChatComposer } from './ChatComposer';
import { brand } from '../shared/brand';
import { requestErrorText } from '../shared/run-presentation';
import { jumpToChatTarget } from './chat-navigation';
import { WebSearchEvidence } from './WebSearchEvidence';
import { ContextCompactions } from './ContextMeter';
import { latestContext } from '../shared/context-meter';

interface ChatData {
  conversation: Conversation;
  messages: ConversationMessage[];
  turns: ConversationTurn[];
  proposals: ActionProposal[];
}
type DraftEdit = DraftArtifact & { content: string; currentHash: string };
export function ChatWorkspace({
  snapshot,
  profileId,
  setProfileId,
  onRun,
  onDocument,
  onSettings,
  refresh
}: {
  snapshot: Snapshot;
  profileId: string;
  setProfileId: (id: string) => void;
  onRun: (id?: string) => void;
  onDocument: (path: string) => void;
  onSettings: () => void;
  refresh: () => Promise<void>;
}) {
  const dialogs = useDialogs(snapshot.projectSessionId);
  const [selected, select] = useState(''),
    [data, setData] = useState<ChatData>(),
    [inputs, setInputs] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [archived, setArchived] = useState(false),
    [refs, setRefs] = useState<string[]>([]),
    [drafts, setDrafts] = useState<DraftArtifact[]>([]),
    [draft, setDraft] = useState<DraftEdit>(),
    [showDrafts, setShowDrafts] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; resolve: (value: string | null) => void }>(),
    [dialogText, setDialogText] = useState('');
  const ask = (title: string, initial = '') =>
    new Promise<string | null>((resolve) => {
      setDialogText(initial);
      setDialog({ title, resolve });
    });
  const scroll = useRef<HTMLDivElement>(null),
    request = useRef(0);
  const followReply = useRef(true);
  const scrollAfterRender = useRef(false);
  useLayoutEffect(() => {
    if (!scrollAfterRender.current) return;
    scrollAfterRender.current = false;
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [data]);
  const cursor = useRef<{ nextBefore: number | null; watermark: number; latestWatermark: number; loading: boolean }>({ nextBefore: null, watermark: 0, latestWatermark: 0, loading: false });
  const conversations = (snapshot.conversations ?? []).filter(conversation => !conversation.runId),
    p = snapshot.project!,
    key = `draft:${p.id}:chat-inputs`;
  const currentText = inputs[selected] ?? '',
    modelBusy = snapshot.chatBusy || snapshot.runs.some((r) => r.status === 'running');
  async function openDraft(id: string, useCache = true) {
    try {
      const result = await invokeCommand('draft.read', { id });
      const cacheKey = `draft:${p.id}:free:${id}`;
      const cached = useCache ? JSON.parse(localStorage.getItem(cacheKey) ?? 'null') : null;
      setDraft(cached ? { ...result, content: cached.content, currentHash: cached.baseHash } : result);
      if (!useCache) localStorage.removeItem(cacheKey);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(
        `draft:${p.id}:free:${draft.id}`,
        JSON.stringify({ content: draft.content, baseHash: draft.currentHash })
      );
    } catch {
      setError('草稿缓存空间不足，请及时保存草稿版本');
    }
  }, [draft?.id, draft?.content, draft?.currentHash]);
  useEffect(() => {
    try {
      setInputs(JSON.parse(localStorage.getItem(key) ?? '{}'));
    } catch {}
  }, [key]);
  useEffect(() => {
    if (!conversations.some((c) => c.id === selected))
      select(conversations.find((c) => !c.archived)?.id ?? conversations[0]?.id ?? '');
  }, [conversations, selected]);
  const load = useCallback(async () => {
    if (!selected) return;
    const seq = ++request.current;
    try {
      const result = await readChatUpdates(invokeCommand, selected, cursor.current.latestWatermark);
      if (request.current === seq) {
        const element = scroll.current;
        const follow = followReply.current || !!element && element.scrollHeight - element.scrollTop - element.clientHeight < 120;
        followReply.current = false;
        if (follow) scrollAfterRender.current = true;
        setError(current => /执行内核.*(?:恢复|尚未就绪)|作品会话已改变/.test(current) ? '' : current);
        if (!cursor.current.watermark) cursor.current = { nextBefore: result.nextBefore, watermark: result.watermark, latestWatermark: result.watermark, loading: false };
        cursor.current.latestWatermark = result.watermark;
        setData((previous) => !previous || previous.conversation.id !== selected ? result : { ...result, messages: merge(previous.messages, result.messages), turns: merge(previous.turns, result.turns), proposals: merge(previous.proposals, result.proposals) });
      }
    } catch (e) {
      if (request.current === seq) setError((e as Error).message);
    }
  }, [selected]);
  useEffect(() => {
    setData(undefined);
    followReply.current = true;
    cursor.current = { nextBefore: null, watermark: 0, latestWatermark: 0, loading: false };
    setRefs([]);
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.wenxu!.onEvent((event) => {
      if (event.projectSessionId && event.projectSessionId !== snapshot.projectSessionId) return;
      if (event.resource && (event.resource !== 'chat' || event.resourceId && event.resourceId !== selected)) return;
      if (event.type === 'delta' || event.type === 'prose-delta' || event.type === 'narrative-event' || event.type === 'assessment' || event.type === 'run-event') return;
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void load();
        }, 160);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [load, selected, snapshot.projectSessionId]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const older = () => {
      const current = cursor.current;
      if (element.scrollTop > 80 || current.loading || current.nextBefore === null) return;
      current.loading = true;
      const height = element.scrollHeight;
      const sequence = request.current;
      void invokeCommand('chat.page', { id: selected, before: current.nextBefore, watermark: current.watermark }).then((page) => {
        if (sequence !== request.current) return;
        cursor.current.nextBefore = page.nextBefore;
        setData((previous) => previous && ({ ...previous, messages: merge(page.messages, previous.messages), turns: merge(page.turns, previous.turns), proposals: merge(page.proposals, previous.proposals) }));
        requestAnimationFrame(() => { element.scrollTop += element.scrollHeight - height; });
      }).catch((error) => setError((error as Error).message)).finally(() => { current.loading = false; });
    };
    element.addEventListener('scroll', older);
    return () => element.removeEventListener('scroll', older);
  }, [selected, data?.conversation.id]);
  async function call<C extends Command>(command: C, args?: CommandInput<C>): Promise<CommandOutput<C> | undefined> {
    setBusy(true);
    setError('');
    try {
      const result = await invokeCommand(command, args);
      await refresh();
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function input(value: string) {
    const next = { ...inputs, [selected]: value };
    setInputs(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError('输入缓存空间不足，请将内容保存到本地文稿');
    }
  }
  async function send() {
    if (!currentText.trim() || modelBusy || busy) return;
    followReply.current = true;
    if (
      await call('chat.send', {
        conversationId: selected,
        text: currentText.trim(),
        profileId,
        referenceChats: refs
      })
    ) {
      input('');
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
    }
  }
  async function saveMessage(message: ConversationMessage) {
    const title = await ask(
      '自由草稿名称',
      `讨论草稿-${new Date().toLocaleDateString().replaceAll('/', '-')}`
    );
    if (!title?.trim()) return;
    const saved = await call('draft.save', {
      title,
      content: message.content,
      conversationId: message.conversationId,
      messageId: message.id
    });
    if (saved) {
      setShowDrafts(true);
      setDrafts(await invokeCommand('draft.list'));
      await openDraft(saved.id, false);
    }
  }
  async function proposal(kind: 'stage' | 'revision' | 'draft') {
    if (busy || modelBusy || !profileId || !selected) return;
    const text = currentText.trim() || (kind === 'stage' ? `遵循当前 Skill，完成阶段 ${p.stage}` : '');
    if (!text) {
      setError('请先在输入框写明试写或修订范围');
      return;
    }
    await callAndStartProposal(kind, text);
  }
  async function callAndStartProposal(kind: 'stage' | 'revision' | 'draft', text: string) {
    // The explicit toolbar action starts generation, not a second approval card.
    // Version validation and final content acceptance remain on the host.
    setBusy(true);
    setError('');
    try {
      const card = await invokeCommand('proposal.create', {
      conversationId: selected,
      profileId,
      proposal: {
        kind,
        goal: kind === 'stage' ? '执行当前阶段' : kind === 'draft' ? '自由试写' : '修订正式资料',
        scope: text,
        request: text,
        outputs: [kind === 'draft' ? '独立聊天草稿' : '生成内容，满意后保存']
      }
      });
      const result = await invokeCommand('proposal.confirm', { id: card.id, version: card.version });
      input('');
      if (result.kind !== 'draft') onRun(result.id);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); await refresh(); await load(); }
  }
  const view = data?.conversation.id === selected ? data : undefined;
  const cards = (items: ActionProposal[]) =>
    items.map((card) => (
      <section className="action-proposal" key={card.id} aria-label="创作任务">
        <small>
          {card.kind === 'draft' ? '自由试写' : card.kind === 'revision' ? '正式修订' : 'Skill 阶段'} ·{' '}
          {{ pending: '等待确认', executed: '已启动', stale: '依据已变化', cancelled: '已取消' }[card.status]}
        </small>
        <h3>{card.goal}</h3>
        <p>
          <b>范围：</b>
          {card.scope}
        </p>
        <details>
          <summary>任务详情</summary>
          <p>拟生成：{card.outputs.join('、')}</p>
          <p>模型：{snapshot.profiles.find(x => x.id === card.profileId)?.model ?? '模型已移除'} · 项目版本 {card.projectRevision}</p>
          <small>确认版本 {card.version}</small>
          {card.sources.map((s) => (
            <div key={s.path}>
              <button onClick={() => onDocument(s.path)}>{s.path}</button>
              <small> @ {s.hash.slice(0, 12)}</small>
            </div>
          ))}
        </details>
        <div className="button-row">
          {card.status === 'pending' && (
            <button
              className="primary"
              disabled={busy || modelBusy || view?.conversation.archived}
              onClick={async () => {
                const result = await call('proposal.confirm', {
                  id: card.id,
                  version: card.version
                });
                if (result && result.kind !== 'draft') onRun(result.id);
              }}
            >
              开始生成
            </button>
          )}
          {['pending', 'stale'].includes(card.status) && (
            <details className="message-actions"><summary aria-label="更多任务操作">⋯</summary>
              <button
                disabled={busy || modelBusy}
                onClick={() => void call('proposal.refresh', { id: card.id, profileId })}
              >
                按当前资料与模型刷新
              </button>
              <button disabled={busy} onClick={() => void call('proposal.cancel', { id: card.id })}>
                暂不生成
              </button>
            </details>
          )}
          {card.status === 'executed' && card.kind !== 'draft' && (
            <button onClick={() => onRun(card.executionId)}>查看生成内容</button>
          )}
        </div>
      </section>
    ));
  return (
    <section
      className="assistant-workspace"
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest('a');
        if (anchor) {
          e.preventDefault();
          const href = anchor.getAttribute('href') ?? '';
          if (href.startsWith('#')) {
            if (!jumpToChatTarget(scroll.current, href.slice(1))) setError('该消息不在当前已加载的记录中，请先查看较早对话');
          } else if (/^https?:\/\//i.test(href)) void invokeCommand('app.openUrl', { url: href }).catch(error => setError((error as Error).message));
          else setError('此链接无法打开，请使用资料来源中的文稿入口');
        }
      }}
    >
      {dialog && (
        <div className="scrim">
          <form
            className="modal chat-input-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            onSubmit={(e) => {
              e.preventDefault();
              dialog.resolve(dialogText.trim());
              setDialog(undefined);
            }}
          >
            <h3>{dialog.title}</h3>
            <input
              autoFocus
              aria-label={dialog.title}
              value={dialogText}
              onChange={(e) => setDialogText(e.target.value)}
            />
            <div className="button-row">
              <button type="submit" className="primary" disabled={!dialogText.trim()}>
                确定
              </button>
              <button
                type="button"
                onClick={() => {
                  dialog.resolve(null);
                  setDialog(undefined);
                }}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}
      <aside className="topic-list">
        <div className="topic-heading">
          <b>主题聊天</b>
          <button
            className="icon"
            aria-label="新建主题聊天"
            onClick={async () => {
              const title = await ask('聊天主题', '新的创作讨论');
              if (title) {
                const c = await call('chat.create', { title });
                if (c) {
                  select(c.id);
                  setArchived(false);
                }
              }
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        {conversations
          .filter((c) => c.archived === archived)
          .map((c) => (
            <button
              key={c.id}
              className={`topic-item ${selected === c.id ? 'active' : ''}`}
              onClick={() => select(c.id)}
            >
              {c.title}
            </button>
          ))}
        <button onClick={() => setArchived(!archived)}>
          {archived ? '返回正在使用的聊天' : '查看已归档聊天'}
        </button>
        <div className="topic-footer">
          <button onClick={() => onRun()}>历史任务与阶段执行</button>
          <button
            onClick={async () => {
              setShowDrafts(!showDrafts);
              setDrafts(await invokeCommand('draft.list'));
            }}
          >
            自由草稿
          </button>
          <button onClick={onSettings}>智能体角色与联网</button>
        </div>
      </aside>
      <div className="assistant-conversation">
        <header className="assistant-heading">
          <div>
            <h2>{view?.conversation.title ?? '创作讨论'}</h2>
            <small>第 {p.chapter} 章</small>
          </div>
          <div className="button-row">
            <button
              aria-label="重命名聊天"
              disabled={!view || busy || !!modelBusy}
              onClick={async () => {
                const title = await ask('新的聊天标题', view?.conversation.title);
                if (title) void call('chat.update', { id: selected, title });
              }}
            >
              重命名
            </button>
            <button
              aria-label={view?.conversation.archived ? '恢复聊天' : '归档聊天'}
              disabled={!view || busy || !!modelBusy}
              onClick={() =>
                void call('chat.update', { id: selected, archived: !view?.conversation.archived })
              }
            >
              {view?.conversation.archived ? <RotateCcw size={15} /> : <Archive size={15} />}
            </button>
          </div>
        </header>
        {error && (
          <p className="inline-warning" role="alert">
            {error}
          </p>
        )}
        <div className="chat-layout with-navigation">
          <ProximitySidebar
            key={selected}
            scrollRef={scroll}
            sections={(view?.messages ?? []).map((m) => ({
              id: `message-${m.id}`,
              label: `${m.role === 'user' ? '你的消息' : `${brand.name}回答`}：${m.content.slice(0, 20)}`,
              kind: 'section'
            }))}
          />
          <div className="chat-scroll" ref={scroll}>
            <div className="chat-content">
            {!view?.messages.length && (
              <div className="assistant-welcome">
                <Sparkles size={28} />
                <h2>从你的故事聊起</h2>
              </div>
            )}
            {view?.conversation.summary && (
              <details className="chat-summary">
                <summary>较早聊天已整理为可回查摘要</summary>
                <pre>{view.conversation.summary.text}</pre>
              </details>
            )}
            {view?.messages.map((m) => {
              const turn = view.turns.find((t) => t.id === m.turnId);
              return (
                <article key={m.id} id={`message-${m.id}`} className={`conversation-message ${m.role}`}>
                  <small>
                    {m.role === 'user' ? '你' : brand.name} · {new Date(m.createdAt).toLocaleTimeString()}{' '}
                    {m.role === 'assistant' && <GenerationStatus activity={turn?.activity} running={m.status === 'running'} fallbackStart={m.createdAt}
                      label={{ running: '', complete: '已完成', stopped: '已停止', unknown: '请求结果未知', failed: '未完成' }[m.status]} />}
                  </small>
                  <LiveMarkdown
                    label={m.role === 'user' ? '你的消息' : '助手回答'}
                    allowImages
                    binding={{ session: snapshot.projectSessionId, kind: 'chat', conversation: selected, id: m.role === 'user' ? m.id : m.turnId, text: m.content, running: m.status === 'running' }}
                    citations={m.webSearch?.citations} fallback="没有返回正文"
                  />
                  {m.role === 'assistant' && (
                    <>
                      <WebSearchEvidence state={m.webSearch} running={m.status === 'running'} />
                      <ContextCompactions items={turn?.contextCompactions} activity={turn?.activity} running={m.status === 'running'} />
                      {turn?.error && <p className="inline-warning">{requestErrorText(turn.error)}</p>}
                      {turn?.calls
                        .filter((c) => ['public_search', 'extract_pages'].includes(c.name))
                        .map((c, i) => {
                          const result = JSON.parse(c.result);
                          return result.error || !result.results?.length ? (
                            <p className="inline-warning" key={`web-${i}`}>
                              联网未核实：{result.error ?? result.message ?? '未取得可用正文'}
                            </p>
                          ) : null;
                        })}
                      <details className="message-actions"><summary aria-label="更多消息操作">⋯</summary>
                      {m.citations.length > 0 && (
                        <details>
                          <summary>资料与来源 · {m.citations.length}</summary>
                          {m.citations.map((c, i) => (
                            <div className="chat-source" key={i}>
                              {c.url ? (
                                <a href={c.url} target="_blank" rel="noreferrer">
                                  {c.label}
                                </a>
                              ) : c.path ? (
                                <button onClick={() => onDocument(c.path!)}>{c.label}</button>
                              ) : (
                                <b>{c.label}</b>
                              )}
                              <small>
                                {c.reason} · {new Date(c.at).toLocaleString()} {c.hash?.slice(0, 12)}
                              </small>
                            </div>
                          ))}
                        </details>
                      )}
                      {turn && (
                        <details>
                          <summary>调用、规则与上下文记录 · {turn.calls.length + (turn.webSearch?.calls.length ?? 0)} 次工具</summary>
                          <p>
                            模型：
                            {snapshot.profiles.find((x) => x.id === turn.profileId)?.model ??
                              turn.profileId}{' '}
                            · 输入 {turn.usage.input ?? '未知'} / 输出 {turn.usage.output ?? '未知'} tokens ·
                            费用 {turn.usage.cost ?? '未知'} {turn.usage.currency}
                          </p>
                          <p>本轮推理强度：{reasoningLabel(turn.reasoningEfforts?.[turn.profileId])}</p>
                          {turn.budgets.map((b) => (
                            <p key={b.round}>
                              第 {b.round} 轮：{b.method === 'utf8_upper_bound' ? '字节保守上界' : b.method ? '本地分词估算' : '旧版估算'} {b.estimatedInput} / 输入额度{' '}
                              {b.availableInput}；规则与约定估算 {b.rules}，历史估算 {b.history}，来源{' '}
                              {b.sources} 项
                            </p>
                          ))}
                          {turn.rules.map((r, i) => (
                            <small key={i}>
                              {r.id} @ {r.version.slice(0, 16)}
                              <br />
                            </small>
                          ))}
                          {turn.calls.map((c, i) => (
                            <details key={i}>
                              <summary>
                                {c.name} · {new Date(c.at).toLocaleTimeString()}
                              </summary>
                              <pre>{c.arguments}</pre>
                              <pre>{c.result}</pre>
                            </details>
                          ))}
                        </details>
                      )}
                      {m.content.trim() && m.status !== 'running' && (
                        <button onClick={() => void saveMessage(m)}>
                          <FileText size={14} /> 保存到自由草稿
                        </button>
                      )}
                      </details>
                      {['unknown', 'failed', 'stopped'].includes(m.status) && turn?.kind === 'discussion' && (
                        <button
                          disabled={modelBusy || busy}
                          onClick={async () => {
                            if (await dialogs.confirm('重新发送会产生新的模型请求和费用，是否继续？', { title: '重新发送这条消息？', confirmLabel: '确认重新发送', cancelLabel: '暂不发送' }))
                              void call('chat.retry', {
                                id: turn.id,
                                profileId,
                                confirmRetry: true,
                                referenceChats: refs
                              });
                          }}
                        >
                          确认重新发送
                        </button>
                      )}
                      {cards(view.proposals.filter((card) => card.turnId === m.turnId))}
                    </>
                  )}
                </article>
              );
            })}
            {view && cards(view.proposals.filter((card) => !card.turnId))}
            </div>
          </div>
        </div>
        {view?.conversation.archived ? (
          <p className="composer-note">已归档，可恢复后继续讨论。</p>
        ) : (
          <div className="chat-composer-area">
            <ChatComposer
              contextUsage={latestContext(view?.turns ?? [])}
              conversationId={selected}
              value={currentText}
              onChange={input}
              onSend={() => void send()}
              onStop={() => void call('chat.stop')}
              profiles={snapshot.profiles}
              profileId={profileId}
              onProfileChange={setProfileId}
              online={view?.conversation.online ?? false}
              onlineDisabled={!view || busy || !!modelBusy}
              onOnlineChange={(online) => void call('chat.update', { id: selected, online })}
              canSend={!!view && !!currentText.trim() && !!profileId && !busy && !modelBusy}
              canPropose={!!view && !!profileId && !busy && !modelBusy}
              running={!!snapshot.chatBusy}
              conversations={conversations}
              referenceChats={refs}
              onReferencesChange={setRefs}
              onPropose={(kind) => void proposal(kind)}
            />
          </div>
        )}
      </div>
      {showDrafts && (
        <aside className="free-drafts">
          <header>
            <h3>自由草稿</h3>
            <button aria-label="关闭自由草稿" onClick={() => setShowDrafts(false)}>
              ×
            </button>
          </header>

          <select
            aria-label="选择自由草稿"
            value={draft?.id ?? ''}
            onChange={async (e) => {
              if (e.target.value) await openDraft(e.target.value);
            }}
          >
            <option value="">选择草稿</option>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          {draft && (
            <>
              <p>{draft.path}</p>
              <small>
                来源聊天 {conversations.find((c) => c.id === draft.conversationId)?.title} · 消息{' '}
                {draft.messageId.slice(0, 8)}
              </small>
              <textarea
                aria-label="自由草稿正文"
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
              <button
                disabled={busy}
                onClick={async () => {
                  const result = await call('draft.save', {
                    id: draft.id,
                    title: draft.title,
                    content: draft.content,
                    baseHash: draft.currentHash,
                    conversationId: draft.conversationId,
                    messageId: draft.messageId
                  });
                  if (result) await openDraft(draft.id, false);
                }}
              >
                保存草稿版本
              </button>
              <button
                onClick={async () => {
                  if (await dialogs.confirm('重新读取将替换编辑框里的未保存修改，是否继续？', { title: '重新读取本地修改？', confirmLabel: '重新读取', cancelLabel: '继续编辑' }))
                    await openDraft(draft.id, false);
                }}
              >
                重新读取本地修改
              </button>
              <details>
                <summary>历史版本</summary>
                {[...draft.versions].reverse().map((v) => (
                  <button
                    key={v.hash}
                    onClick={async () => {
                      const old = await invokeCommand('draft.read', {
                        id: draft.id,
                        hash: v.hash
                      });
                      setDraft({ ...draft, content: old.content });
                    }}
                  >
                    {new Date(v.at).toLocaleString()} · {v.hash.slice(0, 8)}
                  </button>
                ))}
              </details>
              <button
                disabled={!profileId || busy || modelBusy}
                onClick={async () => {
                  const scope = await ask('要转入哪些正式资料？请说明目标文件、保留内容及修订范围。');
                  if (!scope) return;
                  const card = await call('draft.promote', {
                    id: draft.id,
                    hash: draft.currentHash,
                    profileId,
                    scope
                  });
                  if (card) select(card.conversationId);
                }}
              >
                建立正式修订任务卡
              </button>
            </>
          )}
        </aside>
      )}
    </section>
  );
}
