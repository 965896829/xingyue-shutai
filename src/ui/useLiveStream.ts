import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { LiveStream, type StreamSeed } from '../shared/live-stream';
import type { Run } from '../shared/types';
import { LiveNarrative } from '../shared/live-narrative';
import { narrativeEventStateSchema, type NarrativeEventState } from '../shared/narrative-events';

export interface StreamBinding extends StreamSeed { session?: string; kind: 'prose' | 'runs' | 'chat'; id: string; conversation?: string }
const streams = new Map<string, LiveStream>();
const pending = new Set<LiveStream>();
const narratives = new Map<string, LiveNarrative>();
const pendingNarratives = new Set<LiveNarrative>();
let frame = 0;
const keyOf = (v: Pick<StreamBinding, 'session' | 'kind' | 'id' | 'conversation'>) => JSON.stringify([v.session, v.kind, v.conversation, v.id]);
function paint(now: number) {
  frame = 0;
  const immediate = document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const stream of pending) if (!stream.frame(now, immediate)) pending.delete(stream);
  for (const stream of pendingNarratives) stream.publish();
  pendingNarratives.clear();
  if (pending.size) frame = requestAnimationFrame(paint);
}
function getNarrative(key: string) {
  let stream = narratives.get(key);
  if (!stream) {
    stream = new LiveNarrative(() => { pendingNarratives.add(stream!); if (!frame) frame = requestAnimationFrame(paint); });
    narratives.set(key, stream);
    if (narratives.size > 128) for (const [oldKey, old] of narratives) {
      if (narratives.size <= 128) break;
      if (oldKey !== key && !old.observed) { narratives.delete(oldKey); pendingNarratives.delete(old); }
    }
  }
  return stream;
}
function getStream(key: string) {
  let stream = streams.get(key);
  if (!stream) {
    stream = new LiveStream(() => { pending.add(stream!); if (!frame) frame = requestAnimationFrame(paint); });
    streams.set(key, stream);
    if (streams.size > 128) for (const [oldKey, old] of streams) {
      if (streams.size <= 128) break;
      if (oldKey !== key && !old.running && !old.observed) { streams.delete(oldKey); pending.delete(old); }
    }
  }
  return stream;
}
/** Mount once at the workspace boundary, so deltas preceding a view's mount are retained. */
export function useStreamSession(session?: string) {
  useEffect(() => {
    for (const [key, stream] of streams) if (JSON.parse(key)[0] !== session) { streams.delete(key); pending.delete(stream); }
    for (const [key, stream] of narratives) if (JSON.parse(key)[0] !== session) { narratives.delete(key); pendingNarratives.delete(stream); }
    if ((pending.size || pendingNarratives.size) && !frame) frame = requestAnimationFrame(paint);
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; paint(performance.now()); } };
    document.addEventListener('visibilitychange', visibility);
    const unsubscribe = window.wenxu?.onEvent(event => {
      if (!session || event.projectSessionId !== session || !event.runId) return;
      if (event.type === 'narrative-event') {
        const state = narrativeEventStateSchema.safeParse(event.data);
        if (!state.success || state.data.epoch !== event.epoch || event.draftVersion === undefined) return;
        getNarrative(keyOf({ session, kind: 'prose', id: event.runId })).push({ epoch: state.data.epoch,
          version: event.draftVersion, events: state.data.events, generation: event.workerGeneration, seq: event.seq, transport: event.streamEpoch });
        return;
      }
      if (typeof event.text !== 'string') return;
      if (event.type !== 'delta' && event.type !== 'prose-delta') return;
      if (event.textOffset === undefined) return;
      const kind = event.type === 'prose-delta' ? 'prose' : event.resource;
      if (kind !== 'prose' && kind !== 'runs' && kind !== 'chat') return;
      const key = keyOf({ session, kind, id: event.runId, conversation: kind === 'chat' ? event.resourceId : undefined });
      if (kind === 'prose') getNarrative(key).beginDraft(event.epoch, event.draftVersion);
      getStream(key).push({ text: event.text, offset: event.textOffset, version: event.draftVersion, epoch: kind === 'prose' ? event.epoch : undefined,
        seq: event.seq, streamEpoch: event.streamEpoch, generation: event.workerGeneration }, performance.now());
    });
    return () => { unsubscribe?.(); document.removeEventListener('visibilitychange', visibility); cancelAnimationFrame(frame); frame = 0; };
  }, [session]);
}
export function useLiveStream(binding: StreamBinding) {
  const key = keyOf(binding);
  const stream = useMemo(() => getStream(key), [key]);
  useLayoutEffect(() => {
    stream.seed(binding, performance.now());
  }, [stream, binding.text, binding.running, binding.version, binding.epoch]);
  return useSyncExternalStore(stream.subscribe, stream.snapshot);
}
export function useLiveNarrative(binding: StreamBinding, state?: NarrativeEventState) {
  const key = keyOf(binding), stream = useMemo(() => getNarrative(key), [key]);
  useLayoutEffect(() => { stream.seed(state, binding.epoch, binding.version); }, [stream, state, binding.epoch, binding.version]);
  return useSyncExternalStore(stream.subscribe, stream.snapshot);
}
export function proseBinding(session: string | undefined, run: Run): StreamBinding {
  return { session, kind: 'prose', id: run.id, version: run.pipeline?.version, epoch: run.pipeline?.epoch,
    text: run.changes.find(change => change.path === proseFile(run.chapter))?.content ?? '',
    running: run.status === 'running' && run.pipeline?.phase === 'prose' };
}
export const proseFile = (chapter: number) => `07_正文章节/第${String(chapter).padStart(3, '0')}章.md`;
