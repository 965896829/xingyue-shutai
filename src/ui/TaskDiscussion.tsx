import { useDialogs } from './AppDialogs';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { LiveMarkdown } from './LiveMarkdown';
import { invokeCommand } from '../shared/client';
import { mergeRows, readChatUpdates } from '../shared/chat-history';
import type { CommandOutput } from '../shared/contracts';
import type { ProjectConfig, Run } from '../shared/types';
import { needsNewChapterCandidate } from '../shared/task-revision';
import { requestErrorText, retryNeedsConfirmation } from '../shared/run-presentation';
import { taskProblemLinks, taskTurnId } from '../shared/task-links';
import { WebSearchEvidence } from './WebSearchEvidence';
import { GenerationStatus, GenerationStep } from './GenerationStatus';
import { ContextCompactions } from './ContextMeter';
import { latestContext, type ContextUsage } from '../shared/context-meter';

type ChatPage = CommandOutput<'chat.page'>;

export function TaskDiscussion({ conversationId, projectSessionId, run, limits, profileId, busy, scroll, refresh, onRun, onNavigate, onContext }: {
  onContext?: (runId: string, usage?: ContextUsage) => void;
  conversationId?: string;
  projectSessionId?: string;
  run: Run;
  limits: Pick<ProjectConfig, 'maxRounds' | 'maxTools'>;
  profileId: string;
  busy: boolean;
  scroll: RefObject<HTMLDivElement | null>;
  refresh: () => Promise<void>;
  onRun: (id: string) => void;
  onNavigate: (href: string) => void;
}) {
  const dialogs = useDialogs(projectSessionId);
  const [data, setData] = useState<ChatPage>();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [proposalFeedback, setProposalFeedback] = useState<{ id: string; state: 'starting' | 'started' | 'error'; message: string }>();
  const feedbackElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (proposalFeedback?.state === 'error') {
      feedbackElement.current?.scrollIntoView({ block: 'nearest' });
      feedbackElement.current?.focus({ preventScroll: true });
    }
  }, [proposalFeedback]);
  const cursor = useRef({ generation: 0, latest: 0, request: 0 });
  const pending = useRef(false);
  useEffect(() => { onContext?.(run.id, latestContext(data?.turns ?? [])); }, [data, onContext, run.id]);
  const load = useCallback(async () => {
    if (!conversationId) return;
    const generation = cursor.current.generation;
    const request = ++cursor.current.request;
    try {
      const page = await readChatUpdates(invokeCommand, conversationId, cursor.current.latest);
      if (generation !== cursor.current.generation || request !== cursor.current.request) return;
      const element = scroll.current;
      const follow = cursor.current.latest === 0 || !!element && element.scrollHeight - element.scrollTop - element.clientHeight < 120;
      cursor.current.latest = Math.max(cursor.current.latest, page.watermark);
      setData(previous => previous ? {
        ...page, watermark: previous.watermark, nextBefore: previous.nextBefore,
        messages: mergeRows(previous.messages, page.messages), turns: mergeRows(previous.turns, page.turns), proposals: mergeRows(previous.proposals, page.proposals)
      } : page);
      if (follow) requestAnimationFrame(() => scroll.current?.scrollTo({ top: scroll.current.scrollHeight }));
    } catch (error) {
      if (generation === cursor.current.generation && request === cursor.current.request) setError((error as Error).message);
    }
  }, [conversationId, scroll]);
  useEffect(() => {
    cursor.current = { generation: cursor.current.generation + 1, latest: 0, request: 0 };
    setData(undefined);
    setError('');
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.wenxu?.onEvent(event => {
      if (event.projectSessionId && event.projectSessionId !== projectSessionId) return;
      if (event.resource && (event.resource !== 'chat' || event.resourceId && event.resourceId !== conversationId)) return;
      if (event.type === 'delta' || event.type === 'prose-delta' || event.type === 'narrative-event' || event.type === 'assessment' || event.type === 'run-event') return;
      if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 160);
    });
    return () => { cursor.current.generation++; unsubscribe?.(); clearTimeout(timer); };
  }, [load, projectSessionId, conversationId]);
  async function act(action: () => Promise<void>, proposalId?: string) {
    if (pending.current || busy) return;
    pending.current = true;
    setWorking(true);
    setError('');
    if (proposalId) setProposalFeedback({ id: proposalId, state: 'starting', message: '正在启动修改…' });
    try {
      await action();
      if (proposalId) setProposalFeedback({ id: proposalId, state: 'started', message: '已开始修改，生成结果会显示在当前任务中。' });
    } catch (error) {
      if (proposalId) setProposalFeedback({ id: proposalId, state: 'error', message: requestErrorText((error as Error).message) });
      else setError((error as Error).message);
    } finally {
      // A rejected stale proposal may still have changed its stored status.
      // Refresh it as well, keeping the action error beside the clicked button.
      try { await refresh(); await load(); } catch (error) { setError((error as Error).message); }
      pending.current = false; setWorking(false);
    }
  }
  async function older() {
    if (!conversationId || working || data?.nextBefore === null || data?.nextBefore === undefined) return;
    setWorking(true);
    const generation = cursor.current.generation, element = scroll.current, height = element?.scrollHeight ?? 0;
    try {
      const page = await invokeCommand('chat.page', { id: conversationId, before: data.nextBefore, watermark: data.watermark });
      if (generation !== cursor.current.generation) return;
      setData(previous => previous && ({ ...previous, nextBefore: page.nextBefore, messages: mergeRows(page.messages, previous.messages), turns: mergeRows(page.turns, previous.turns), proposals: mergeRows(page.proposals, previous.proposals) }));
      requestAnimationFrame(() => { if (element) element.scrollTop += element.scrollHeight - height; });
    } catch (error) { setError((error as Error).message); }
    finally { setWorking(false); }
  }
  const problems = taskProblemLinks(run);
  return <div aria-label="当前任务对话" onClick={event => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (anchor) {
      event.preventDefault();
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#')) onNavigate(href);
      else if (/^https?:\/\//i.test(href)) void invokeCommand('app.openUrl', { url: href }).catch(error => setError((error as Error).message));
      else setError('此链接无法打开，请使用问题索引或文稿入口');
    }
  }}>
    {error && <p className="inline-warning" role="alert">{requestErrorText(error)}</p>}
    {data?.nextBefore !== null && data?.nextBefore !== undefined && <button disabled={working} onClick={() => void older()}>查看较早对话</button>}
    {data?.messages.map(message => {
      const turn = data.turns.find(turn => turn.id === message.turnId);
      return <article key={message.id} id={message.role === 'assistant' ? taskTurnId(message.turnId) : undefined} className={message.role === 'user' ? 'user-message' : 'assistant-message'}>
        <small>{message.role === 'user' ? '你' : '任务助手'}{' '}
          {message.role === 'assistant' && <GenerationStatus variant="elapsed" activity={turn?.activity} running={message.status === 'running'} fallbackStart={message.createdAt}
            label={{ running: '', complete: '已完成', stopped: '已停止', unknown: '请求结果未知', failed: '未完成' }[message.status]} />}
        </small>
        <LiveMarkdown label="任务对话" binding={{ session: projectSessionId, kind: 'chat', conversation: conversationId, id: message.role === 'user' ? message.id : message.turnId, text: message.content, running: message.status === 'running' }} citations={message.webSearch?.citations} fallback="本次没有返回回答" />
        {message.role === 'assistant' && <>
          <GenerationStep activity={turn?.activity} running={message.status === 'running'} />
          <WebSearchEvidence state={message.webSearch} running={message.status === 'running'} />
          <ContextCompactions items={turn?.contextCompactions} activity={turn?.activity} running={message.status === 'running'} />
          {turn?.error && <p className="inline-warning">{requestErrorText(turn.error)}</p>}
          {turn && ['unknown', 'failed', 'stopped'].includes(message.status) && <button disabled={working || busy} onClick={async () => {
            if (await dialogs.confirm('重新发送会产生新的模型请求和费用，是否继续？', { title: '重新发送这条消息？', confirmLabel: '确认重新发送', cancelLabel: '暂不发送' })) void act(async () => { await invokeCommand('chat.retry', { id: turn.id, profileId, confirmRetry: true }); });
          }}>重新发送这条消息</button>}
          {data.proposals.filter(proposal => proposal.turnId === message.turnId).map(proposal => {
            const newCandidate = proposal.resumeRunId === run.id && needsNewChapterCandidate(run, limits);
            const feedback = proposalFeedback?.id === proposal.id ? proposalFeedback : undefined;
            return proposal.executionSource === 'author_message' && !proposal.executionError ? <p key={proposal.id} role="status" className="muted">{proposal.status === 'executed' ? '已按你的意见开始修改，完成后查看新结果。' : proposal.status === 'pending' && busy ? '正在准备修改当前内容…' : '这次修改尚未开始，可在下方重新提交修改意见。'}</p> : <section className="approval-box" key={proposal.id} aria-label="任务修改方案" aria-busy={feedback?.state === 'starting'}>
            <h3>{proposal.goal}</h3>
            <p>{proposal.scope}</p>
            {newCandidate && proposal.status === 'pending' && <p className="muted">保留当前稿和运行记录，重新生成新一版。</p>}
            {proposal.executionError && <p role="alert">暂未开始修改：{requestErrorText(proposal.executionError)}</p>}
            {proposal.status === 'pending' ? <div className="button-row">
              <button className="primary" disabled={working || busy} onClick={async () => {
                const retryUnknown = !!proposal.resumeRunId && retryNeedsConfirmation(run);
                if (retryUnknown && !await dialogs.confirm('上次请求结果未知，修复会产生新的请求，可能重复计费。确认继续？', { title: '重新请求并修复？', confirmLabel: '确认开始修复', cancelLabel: '暂不重试' })) return;
                void act(async () => {
                  const result = await invokeCommand('proposal.confirm', { id: proposal.id, version: proposal.version, retryUnknown });
                  if (result.kind !== 'draft') onRun(result.id);
                }, proposal.id);
              }}>{feedback?.state === 'starting' ? '正在启动…' : newCandidate ? '重新生成这一章' : proposal.resumeRunId ? '开始修改' : '确认并开始任务'}</button>
              <button disabled={working || busy} onClick={() => void act(async () => { await invokeCommand('proposal.cancel', { id: proposal.id }); })}>暂不执行</button>
            </div> : <small>{{ executed: '已开始处理，结果仍需你确认', stale: '任务已有变化，请继续对话确认新方案', cancelled: '暂不执行' }[proposal.status]}</small>}
            {feedback && <p ref={feedbackElement} tabIndex={-1} className={feedback.state === 'error' ? 'inline-warning' : 'muted'} role={feedback.state === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
          </section>; })}
        </>}
      </article>;
    })}
    {problems.length > 0 && <details><summary>相关内容与记录</summary><nav aria-label="问题索引" className="button-row">{problems.map(problem => <a key={problem.href} href={problem.href}>{problem.label}</a>)}</nav></details>}
  </div>;
}
