import path from 'node:path';
import { z } from 'zod';
import { brand } from '../src/shared/brand';
import type { WindowAppearance } from '../src/shared/desktop';

const color = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
export const appearanceSchema = z.object({
  mode: z.enum(['dark', 'light']),
  background: color,
  foreground: color,
  animate: z.boolean().optional()
});
export type StoredAppearance = Omit<WindowAppearance, 'animate'>;

export function userDataDirectory(appData: string, override?: string) {
  return override ? path.resolve(override) : path.join(appData, brand.internalName);
}

const normalize = (hex: string) =>
  (hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex).toLowerCase();
const stored = (value: WindowAppearance): StoredAppearance => ({
  mode: value.mode,
  background: normalize(value.background),
  foreground: normalize(value.foreground)
});
const sameColors = (a: StoredAppearance | undefined, b: StoredAppearance) =>
  a?.background === b.background && a.foreground === b.foreground;
const same = (a: StoredAppearance | undefined, b: StoredAppearance) => a?.mode === b.mode && sameColors(a, b);

// CSS ease-out, cubic-bezier(0, 0, .58, 1), shared with the renderer's 320ms transition.
function easeOut(progress: number) {
  if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress));
  let low = 0,
    high = 1;
  for (let i = 0; i < 32; i++) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) * t * t * 0.58 + t * t * t;
    if (x < progress) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) * t * t + t * t * t;
}
function blend(from: string, to: string, progress: number) {
  return (
    '#' +
    [1, 3, 5]
      .map((i) => {
        const a = parseInt(from.slice(i, i + 2), 16),
          b = parseInt(to.slice(i, i + 2), 16);
        return Math.round(a + (b - a) * progress)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

interface Clock {
  now(): number;
  schedule(callback: () => void, delay: number): unknown;
  cancel(handle: unknown): void;
}
const clock: Clock = {
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** Native title-bar animation owns no renderer state and writes only settled choices. */
export class WindowAppearanceTransition {
  private displayed: StoredAppearance;
  private target: StoredAppearance;
  private persisted?: StoredAppearance;
  private start?: {
    at: number;
    from: StoredAppearance;
    duration: number;
    reversingAdjustedStartValue: StoredAppearance;
    reversingShorteningFactor: number;
  };
  private timer?: unknown;
  private generation = 0;

  constructor(
    initial: StoredAppearance,
    private readonly apply: (appearance: StoredAppearance) => void,
    private readonly persist: (appearance: StoredAppearance) => void,
    private readonly timing: Clock = clock,
    persisted?: StoredAppearance,
    private readonly onError: (error: unknown) => void = () => {}
  ) {
    this.displayed = stored(initial);
    this.target = stored(initial);
    this.persisted = persisted && stored(persisted);
  }

  set(input: WindowAppearance) {
    const next = stored(input);
    if (same(this.target, next) && this.start && input.animate) return;
    // Sample the old curve now, rather than jumping back to the last rendered timer tick.
    const oldStart = this.start;
    const oldTarget = this.target;
    const oldProgress = this.sample();
    // Match CSS Transitions §3 faster reversal, including repeated reversals.
    // The distance is based on eased progress, not elapsed time or rounded RGB.
    // https://drafts.csswg.org/css-transitions/#reversing
    const reversing = oldStart && sameColors(oldStart.reversingAdjustedStartValue, next);
    const factor = reversing
      ? Math.min(
          1,
          Math.abs(oldProgress * oldStart.reversingShorteningFactor + 1 - oldStart.reversingShorteningFactor)
        )
      : 1;
    this.cancel();
    this.target = next;
    if (!input.animate || sameColors(this.displayed, next) || factor === 0) {
      this.finish();
      return;
    }
    this.start = {
      at: this.timing.now(),
      from: { ...this.displayed },
      duration: 320 * factor,
      reversingAdjustedStartValue: { ...(reversing ? oldTarget : this.displayed) },
      reversingShorteningFactor: factor
    };
    this.frame(this.generation);
  }

  /** A quit during a transition persists the user's last choice, never an intermediate RGB. */
  flush() {
    this.cancel();
    this.finish();
  }

  private sample() {
    if (!this.start) return 1;
    const progress = Math.min(1, Math.max(0, (this.timing.now() - this.start.at) / this.start.duration));
    const eased = easeOut(progress);
    this.displayed = {
      mode: this.target.mode,
      background: blend(this.start.from.background, this.target.background, eased),
      foreground: blend(this.start.from.foreground, this.target.foreground, eased)
    };
    return eased;
  }

  private frame(generation: number) {
    if (generation !== this.generation || !this.start) return;
    this.sample();
    const elapsed = this.timing.now() - this.start.at;
    if (elapsed >= this.start.duration) {
      this.finish();
      return;
    }
    this.apply(this.displayed);
    this.timer = this.timing.schedule(
      () => {
        try {
          this.frame(generation);
        } catch (error) {
          // An asynchronous disk failure must not crash the process or discard the last choice.
          this.cancel();
          this.onError(error);
        }
      },
      Math.min(16, this.start.duration - elapsed)
    );
  }

  private cancel() {
    this.generation++;
    if (this.timer !== undefined) this.timing.cancel(this.timer);
    this.timer = undefined;
    this.start = undefined;
  }

  private finish() {
    this.start = undefined;
    this.timer = undefined;
    this.displayed = { ...this.target };
    this.apply(this.displayed);
    if (!same(this.persisted, this.target)) {
      this.persist(this.target);
      this.persisted = { ...this.target };
    }
  }
}
