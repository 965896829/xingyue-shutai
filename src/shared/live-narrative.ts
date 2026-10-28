import type { NarrativeEvent, NarrativeEventState } from './narrative-events';

const empty: NarrativeEvent[] = [];
/** Presentation store. A node may arrive before its animated anchor is visible;
 * the view gates it against exactly the same text prefix used by the manuscript. */
export class LiveNarrative {
  private events: NarrativeEvent[] = empty;
  private epoch?: string;
  private version = -1;
  private generation = 0;
  private seq = 0;
  private transport?: string;
  private retired = new Set<string>();
  private retiredTransports = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(private schedule: () => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.events;
  get observed() { return this.listeners.size > 0; }
  beginDraft(epoch: string | undefined, version: number | undefined) {
    // Clear on the FIRST prose delta of a rewrite, before any annotation arrives.
    // Identical opening sentences in two drafts must not reuse the old judgment.
    if (epoch && epoch !== this.epoch && version !== undefined) this.seed(undefined, epoch, version);
  }
  seed(state: NarrativeEventState | undefined, epoch?: string, version = 0) {
    if (!epoch || this.retired.has(epoch) || version < this.version || this.epoch && epoch !== this.epoch && version === this.version) return;
    if (this.epoch && epoch !== this.epoch) this.retired.add(this.epoch);
    const incoming = state?.epoch === epoch ? state.events : empty;
    // An equally-versioned disk snapshot may lag a just-arrived node.
    const next = epoch === this.epoch && version === this.version && incoming.length < this.events.length ? this.events : incoming;
    this.epoch = epoch; this.version = version;
    this.replace(next);
  }
  push(input: { epoch: string; version: number; events: NarrativeEvent[]; generation?: number; seq?: number; transport?: string }) {
    if (this.retired.has(input.epoch) || (input.generation ?? this.generation) < this.generation || input.transport && this.retiredTransports.has(input.transport)) return;
    const changedTransport = (input.generation ?? this.generation) > this.generation || !!(this.transport && input.transport && input.transport !== this.transport);
    if (!changedTransport && input.seq !== undefined && input.seq <= this.seq) return;
    if (input.version < this.version || this.epoch && input.epoch !== this.epoch && input.version === this.version) return;
    if (changedTransport && this.transport && this.transport !== input.transport) this.retiredTransports.add(this.transport);
    if (this.epoch && this.epoch !== input.epoch) this.retired.add(this.epoch);
    this.epoch = input.epoch; this.version = input.version;
    this.generation = input.generation ?? this.generation; this.seq = input.seq ?? 0; this.transport = input.transport ?? this.transport;
    this.replace(input.events);
  }
  publish() { this.listeners.forEach(listener => listener()); }
  private replace(events: NarrativeEvent[]) {
    if (JSON.stringify(this.events) === JSON.stringify(events)) return;
    this.events = events; this.schedule();
  }
}
