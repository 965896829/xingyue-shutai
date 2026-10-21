import { useEffect, useRef, useState } from 'react';
import { streamText, visibleStreamText, type StreamText } from '../shared/generation';

/** Keep transient deltas separate so a slower persisted snapshot cannot roll text back. */
export function useLiveText(projectSessionId?: string, conversationId?: string) {
  const [live, setLive] = useState<{ key: string; rows: Record<string, StreamText> }>({ key: '', rows: {} });
  const key = `${projectSessionId}:${conversationId}`, sequence = useRef({ epoch: '', seq: 0, generation: 0 });
  useEffect(() => {
    setLive({ key, rows: {} });
    sequence.current = { epoch: '', seq: 0, generation: 0 };
    return window.wenxu?.onEvent(event => {
      if (event.projectSessionId !== projectSessionId || event.resource !== 'chat' || event.resourceId !== conversationId) return;
      if (event.type !== 'delta' || !event.runId || typeof event.text !== 'string' || event.textOffset === undefined) return;
      const previous = sequence.current;
      if (event.workerGeneration !== undefined && event.workerGeneration < previous.generation) return;
      if (event.streamEpoch === previous.epoch && event.seq && event.seq <= previous.seq) return;
      sequence.current = { epoch: event.streamEpoch ?? '', seq: event.seq ?? 0, generation: event.workerGeneration ?? previous.generation };
      setLive(current => ({ key, rows: { ...(current.key === key ? current.rows : {}), [event.runId!]: streamText(current.key === key ? current.rows[event.runId!] : undefined, { offset: event.textOffset!, text: event.text! }) } }));
    });
  }, [key, projectSessionId, conversationId]);
  return (id: string, saved: string, running: boolean) => visibleStreamText(saved, running && live.key === key ? live.rows[id] : undefined);
}
