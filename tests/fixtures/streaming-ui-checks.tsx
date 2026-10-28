/** Runs only through Playwright against the isolated UI fixture, without a model. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { marked } from 'marked';
import { EditorView } from 'codemirror';
import type { AppEvent, Run, Snapshot } from '../../src/shared/types';
import { useStreamSession, proseBinding } from '../../src/ui/useLiveStream';
import { LiveMarkdown } from '../../src/ui/LiveMarkdown';
import { NarrativePlayback } from '../../src/ui/NarrativePlayback';
import { MarkdownContent } from '../../src/ui/MarkdownContent';
import { playbackPlan, playbackProse } from './streaming-content';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
export function editorValue() { const element = document.querySelector<HTMLElement>('.editor .cm-editor'); return element ? EditorView.findFromDOM(element)?.state.doc.toString() : undefined; }
export async function verifyPlaybackPerformance() {
  const metrics = () => fetch('/__test/metrics').then(response => response.json());
  const before = await metrics(), samples: { ms: number; length: number }[] = [], lags: number[] = [], pending: { end: number; at: number }[] = [];
  let done = false, last = -1, stableParagraph: Element | undefined, replacements = 0, mismatchFrames = 0, editorMismatchFrames = 0, frames = 0;
  const start = performance.now();
  const unsubscribe = window.wenxu!.onEvent(event => {
    if (event.type === 'prose-delta') pending.push({ end: event.textOffset! + event.text!.length, at: performance.now() });
  });
  const sample = () => {
    const element = document.querySelector('.candidate-list .markdown-rendered'), length = element?.textContent?.length ?? 0;
    if (length !== last) { samples.push({ ms: Math.round(performance.now() - start), length }); last = length; }
    const paragraphs = element?.querySelectorAll('p');
    if (stableParagraph && paragraphs?.[0] !== stableParagraph) replacements++;
    if (paragraphs && paragraphs.length > 1) stableParagraph = paragraphs[0];
    const prose = document.querySelector<HTMLElement>('[data-stream-kind="prose"]'), rhythm = document.querySelector<HTMLElement>('.narrative-playback');
    if (prose && rhythm) {
      frames++; if (prose.dataset.streamLength !== rhythm.dataset.streamLength) mismatchFrames++;
      const shown = Number(prose.dataset.streamLength), editor = document.querySelector<HTMLElement>('[data-editor-stream-length]');
      if (editor && (Number(editor.dataset.editorStreamLength) !== shown || editorValue()?.length !== shown)) editorMismatchFrames++;
      while (pending.length && shown >= pending[0].end) lags.push(performance.now() - pending.shift()!.at);
    }
    if (!done) requestAnimationFrame(sample);
  };
  try {
    await fetch('/__test/playback'); requestAnimationFrame(sample);
    let after;
    do { await wait(150); after = await metrics(); } while (after.playback.running);
    await wait(700); done = true;
    const gaps = samples.slice(1).map((sample, index) => sample.ms - samples[index].ms), sorted = [...lags].sort((a, b) => a - b);
    const expected = document.createElement('div'); expected.innerHTML = marked.parse(after.playback.expectedText, { async: false });
    return { before: before.localRequests, after: after.localRequests, afterSettled: (await metrics()).localRequests,
      modelRequests: after.modelRequests, expectedLength: after.playback.expectedLength, elapsedMs: after.playback.elapsedMs, samples,
      completedParagraphReplacements: replacements, maxPaintGapMs: Math.max(...gaps), frames, mismatchFrames, editorMismatchFrames,
      receiveToPaintMs: { median: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], max: Math.max(...sorted), chunks: sorted.length },
      finalStreamLength: document.querySelector<HTMLElement>('[data-stream-kind="prose"]')?.dataset.streamLength,
      finalEditorExact: editorValue() === after.playback.expectedText,
      finalMarkdownExact: document.querySelector('.candidate-list .markdown-rendered')?.textContent === expected.textContent,
      narrative: document.querySelector('.narrative-panel')?.textContent };
  } finally { done = true; unsubscribe(); }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function verifyChatStreamingUI() {
  const original = window.wenxu!, listeners = new Set<(event: AppEvent) => void>(), host = document.createElement('div');
  document.body.append(host); const root = createRoot(host); let renders = 0;
  window.wenxu = { ...original, onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  function View({ saved = '', running = true }: { saved?: string; running?: boolean }) {
    renders++; useStreamSession('chat-regression');
    return <><LiveMarkdown binding={{ session: 'chat-regression', kind: 'chat', conversation: 'conversation', id: 'author', text: '用户的原始要求', running: false }} />
      <LiveMarkdown binding={{ session: 'chat-regression', kind: 'chat', conversation: 'conversation', id: 'reply', text: saved, running }} /></>;
  }
  try {
    flushSync(() => root.render(<StrictMode><View /></StrictMode>)); await frame();
    const initialRenders = renders; let offset = 0;
    for (let i = 0; i < 16; i++) {
      const event: AppEvent = { type: 'delta', resource: 'chat', resourceId: 'conversation', projectSessionId: 'chat-regression', runId: 'reply',
        textOffset: offset, text: '流式回复。', seq: i + 1, streamEpoch: 'chat-transport' };
      listeners.forEach(listener => listener(event)); offset += event.text!.length; await frame();
    }
    await wait(130);
    const blocks = host.querySelectorAll('.markdown-rendered');
    check(blocks[0].textContent?.trim() === '用户的原始要求', 'Assistant deltas must not change the author message');
    check(blocks[1].textContent?.trim() === '流式回复。'.repeat(16), 'Chat reply must stream losslessly in its own conversation');
    check(renders === initialRenders, 'Token frames must not rerender the conversation parent');
    flushSync(() => root.render(<StrictMode><View saved="流式回复。" /></StrictMode>)); await frame();
    check(blocks[1].textContent?.trim() === '流式回复。'.repeat(16), 'Delayed persisted chat pages must not roll text back');
    flushSync(() => root.render(<StrictMode><View saved="最终回答。" running={false} /></StrictMode>)); await frame();
    check(host.querySelectorAll('.markdown-rendered')[1].textContent?.trim() === '最终回答。', 'Terminal chat content must be authoritative');
    return { parentRendersDuringStream: renders - initialRenders - 4, authorUnchanged: true, exactReply: true, delayedPageIgnored: true, finalReplyAuthoritative: true };
  } finally { root.unmount(); host.remove(); window.wenxu = original; }
}

export async function verifyStreamingUI(snapshot: Snapshot) {
  const original = window.wenxu!, listeners = new Set<(event: AppEvent) => void>();
  const session = 'local-ui-regression';
  window.wenxu = { ...original, onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:20px auto auto 20px;width:700px;background:var(--panel);z-index:9999';
  document.body.append(host);
  const root = createRoot(host);
  const run: Run = { ...snapshot.runs.find(item => item.pipeline)!, id: 'isolated-prose', status: 'running', changes: [],
    pipeline: { phase: 'prose', epoch: 'execution-1', version: 0, previewCalls: 0 },
    manifest: { ...snapshot.runs.find(item => item.pipeline)!.manifest!, sources: [{ path: '06_章节设计/第001章细纲.md', hash: 'fixture', content: playbackPlan, mode: 'full', reason: '本地验收', required: true }] } };
  const view = { ...snapshot, projectSessionId: session };
  function View({ current }: { current: Run }) {
    useStreamSession(session);
    return <><div className="chat-scroll" style={{ height: 210, overflow: 'auto', display: 'block' }}>
      <LiveMarkdown binding={proseBinding(session, current)} format="prose" />
    </div><NarrativePlayback snapshot={view} run={current} data={{ chapter: 1, chapters: [], range: [1, 30], unavailable: 0,
      detail: { path: '06_章节设计/第001章细纲.md', hash: 'fixture', content: playbackPlan } }} onSource={() => {}} /></>;
  }
  let seq = 0, version = 0;
  const emit = (text: string, offset: number, epoch = 'execution-1') => {
    const event: AppEvent = { type: 'prose-delta', resource: 'runs', projectSessionId: session, runId: run.id, streamEpoch: 'transport', epoch,
      workerGeneration: 1, seq: ++seq, draftVersion: ++version, textOffset: offset, text };
    listeners.forEach(listener => listener(event));
  };
  const render = (current: Run) => flushSync(() => root.render(<StrictMode><View current={current} /></StrictMode>));
  const results: Record<string, boolean | number> = {};
  try {
    render(run); await frame();
    const scroll = host.querySelector<HTMLElement>('.chat-scroll')!;
    const first = '# 章节\n\n第一段已经完整结束。\n\n';
    emit(first, 0); await wait(150);
    const stableParagraph = host.querySelector('.markdown-rendered p');
    const started = performance.now(); let mismatches = 0, samples = 0, offset = first.length;
    for (let i = 0; i < 32; i++) {
      const text = '后续段落中，人物完成了这一步选择。\n\n';
      emit(text, offset); offset += text.length; await frame();
      const prose = host.querySelector<HTMLElement>('[data-stream-kind="prose"]')!, rhythm = host.querySelector<HTMLElement>('.narrative-playback')!;
      samples++; if (prose.dataset.streamLength !== rhythm.dataset.streamLength) mismatches++;
    }
    await wait(150);
    check(stableParagraph === host.querySelector('.markdown-rendered p'), 'Completed paragraphs must retain their DOM nodes');
    check(mismatches === 0, 'Narrative cursor and prose must share every presented prefix');
    check(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 3, 'Reading at the bottom should follow the streaming text');
    results.strictModeAndSynchronizedFrames = samples; results.retainedCompletedParagraph = true; results.followBottom = true;
    results.burstRenderMs = Math.round(performance.now() - started);
    scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll'));
    emit('用户翻到前文时不应被拉回底部。\n\n', offset); offset += '用户翻到前文时不应被拉回底部。\n\n'.length;
    await wait(150); check(scroll.scrollTop === 0, 'Streaming must respect a reader who scrolled up'); results.respectsScrollUp = true;
    const stopped: Run = { ...run, status: 'paused', pipeline: { ...run.pipeline!, version }, changes: [{ path: '07_正文章节/第001章.md', content: '中断前保存正文。', baseHash: null }] };
    render(stopped); await frame();
    check(host.querySelector('.markdown-rendered')?.textContent?.trim() === '中断前保存正文。', 'Stopped text must immediately match the saved checkpoint');
    results.stopIsAuthoritative = true;
    emit('恢复后的正文𠮷👩‍🔧。', 0, 'execution-2'); await wait(150);
    check(host.querySelector('.markdown-rendered')?.textContent?.trim() === '恢复后的正文𠮷👩‍🔧。', 'A resumed execution must replace the previous draft, preserving Unicode');
    results.newEpochAndUnicode = true;
    const before = host.querySelector('.markdown-rendered')?.textContent;
    listeners.forEach(listener => listener({ type: 'prose-delta', resource: 'runs', projectSessionId: 'other-project', runId: run.id, text: '污染', textOffset: 0, seq: ++seq, draftVersion: ++version }));
    await frame(); check(host.querySelector('.markdown-rendered')?.textContent === before, 'Other projects must not change the text'); results.projectIsolation = true;
    const exact: Run = { ...run, status: 'awaiting_review', pipeline: { ...run.pipeline!, epoch: 'execution-2', phase: 'ready', proseHash: 'fixture', version: ++version }, changes: [{ path: '07_正文章节/第001章.md', content: playbackProse, baseHash: null }] };
    render(exact); await frame();
    const expected = document.createElement('div'); expected.innerHTML = marked.parse(playbackProse, { async: false });
    check(host.querySelector('.markdown-rendered')?.textContent === expected.textContent, 'Completed rendered text must exactly match the saved Markdown');
    results.exactFinalContent = true;
    root.unmount();
    const markdownRoot = createRoot(host);
    try {
      const a = '# 书名\n\n已经完成的段落。\n\n| 章节 | 正文 |\n|---|---|\n| 001 | ' + '一段内容'.repeat(20) + ' |\n\n```ts\nconst a = 1;\n```';
      flushSync(() => markdownRoot.render(<MarkdownContent incremental content={a} />));
      const viewport = host.querySelector<HTMLElement>('.markdown-table-viewport')!;
      viewport.scrollLeft = 200; viewport.dispatchEvent(new Event('scroll', { bubbles: false }));
      const table = viewport.querySelector('table'), left = viewport.scrollLeft;
      flushSync(() => markdownRoot.render(<MarkdownContent incremental content={a + '\n\n新段落<script>alert(1)</script>[不安全](javascript:alert(1))'} />));
      check(host.querySelector('table') === table, 'Completed table DOM must remain stable');
      check(host.querySelector<HTMLElement>('.markdown-table-viewport')!.scrollLeft === left, 'Table scroll position must remain stable');
      check(!host.querySelector('script, a[href^="javascript:"]'), 'Incremental content must stay sanitized');
      check(host.querySelector('pre code')?.textContent?.includes('const a = 1'), 'Fenced code must retain code formatting');
      results.tableScrollAndCode = true; results.sanitizedStream = true;
    } finally { markdownRoot.unmount(); }
    return results;
  } finally { try { root.unmount(); } catch {} host.remove(); window.wenxu = original; }
}
