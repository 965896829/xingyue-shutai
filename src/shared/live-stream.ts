import { streamText, visibleStreamText, type StreamText } from './generation';

export interface StreamSeed { text: string; running: boolean; version?: number; epoch?: string }
export interface StreamChunk { text: string; offset: number; version?: number; epoch?: string; seq?: number; streamEpoch?: string; generation?: number }

/** Presentation only: saved text remains authoritative and generation never waits for animation. */
export class LiveStream {
  text = '';
  target = '';
  running = true;
  private saved = '';
  private pending?: StreamText;
  private version = -1;
  private epoch?: string;
  private streamEpoch?: string;
  private retiredEpochs = new Set<string>();
  private retiredTransports = new Set<string>();
  private generation = 0;
  private seq = 0;
  private deadline = 0;
  private previousFrame = 0;
  private listeners = new Set<() => void>();
  constructor(private schedule: () => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.text;
  get observed() { return this.listeners.size > 0; }
  seed(seed: StreamSeed, now: number) {
    if (seed.epoch && this.retiredEpochs.has(seed.epoch)) return;
    if (seed.epoch && this.epoch && seed.epoch !== this.epoch && (seed.version ?? -1) <= this.version) return;
    if (seed.version !== undefined && seed.version < this.version) return;
    if (seed.version !== undefined) this.pending = undefined;
    if (seed.epoch && this.epoch && seed.epoch !== this.epoch) this.retiredEpochs.add(this.epoch);
    this.epoch = seed.epoch ?? this.epoch;
    this.version = seed.version ?? this.version;
    this.saved = seed.text;
    this.running = seed.running;
    const next = seed.running ? visibleStreamText(seed.text, this.pending) : seed.text;
    if (!seed.running) { this.pending = undefined; this.target = next; this.publish(next); return; }
    if (!this.seq && !this.pending) { this.target = next; this.publish(next); return; }
    this.change(next, now);
  }
  push(chunk: StreamChunk, now: number) {
    if ((chunk.generation ?? this.generation) < this.generation) return;
    if (chunk.epoch && this.retiredEpochs.has(chunk.epoch)) return;
    if (chunk.streamEpoch && this.retiredTransports.has(chunk.streamEpoch)) return;
    const transportChanged = (chunk.generation ?? this.generation) > this.generation ||
      !!(this.streamEpoch && chunk.streamEpoch && this.streamEpoch !== chunk.streamEpoch);
    if (!transportChanged && chunk.seq !== undefined && chunk.seq <= this.seq) return;
    if (transportChanged) {
      if (this.streamEpoch && this.streamEpoch !== chunk.streamEpoch) this.retiredTransports.add(this.streamEpoch);
      this.seq = 0; this.pending = undefined;
    }
    this.generation = chunk.generation ?? this.generation;
    this.streamEpoch = chunk.streamEpoch ?? this.streamEpoch;
    this.seq = chunk.seq ?? this.seq;
    const newDraft = !!(chunk.epoch && this.epoch && chunk.epoch !== this.epoch);
    if (!newDraft && chunk.version !== undefined && chunk.version <= this.version) return;
    if (newDraft || (chunk.version !== undefined && chunk.offset === 0)) {
      if (newDraft && this.epoch) this.retiredEpochs.add(this.epoch);
      this.pending = undefined; this.saved = ''; this.target = ''; this.publish('');
    }
    this.epoch = chunk.epoch ?? this.epoch;
    this.version = chunk.version ?? this.version;
    this.running = true;
    this.pending = streamText(this.pending, { offset: chunk.offset, text: chunk.text });
    // Use the complete received prefix as a checkpoint too. Long replies must
    // not depend on the next disk flush when the bounded delta buffer rolls over.
    const base = chunk.offset <= this.target.length ? this.target : this.saved;
    const next = visibleStreamText(base, this.pending);
    this.change(next, now);
  }
  private change(next: string, now: number) {
    if (next === this.target) return;
    const wasCaughtUp = this.text.length >= this.target.length;
    this.target = next;
    if (!next.startsWith(this.text)) this.publish('');
    if (wasCaughtUp || now >= this.deadline) { this.previousFrame = now; this.deadline = now + 100; }
    this.schedule();
  }
  /** One shared presented prefix feeds the prose and its narrative cursor. */
  frame(now: number, immediate = false) {
    let end = this.target.length;
    // A transport chunk may split a UTF-16 pair. Never paint a replacement glyph.
    if (end && /[\uD800-\uDBFF]/.test(this.target[end - 1])) end--;
    if (!immediate && now < this.deadline) {
      const ratio = Math.min(1, Math.max(1, now - this.previousFrame) / Math.max(1, this.deadline - this.previousFrame));
      end = Math.min(end, this.text.length + Math.max(1, Math.ceil((end - this.text.length) * ratio)));
      if (end && /[\uD800-\uDBFF]/.test(this.target[end - 1])) end--;
    }
    this.previousFrame = now;
    this.publish(this.target.slice(0, end));
    const available = this.target.length - (/[\uD800-\uDBFF]$/.test(this.target) ? 1 : 0);
    return this.text.length < available;
  }
  private publish(text: string) {
    if (text === this.text) return;
    this.text = text;
    this.listeners.forEach(listener => listener());
  }
}
