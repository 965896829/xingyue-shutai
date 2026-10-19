import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  appearanceSchema,
  WindowAppearanceTransition,
  userDataDirectory,
  type StoredAppearance
} from '../electron/window-appearance';
import { brand, windowThemes } from '../src/shared/brand';

function harness(persisted: StoredAppearance | undefined = windowThemes.dark) {
  let now = 0,
    nextId = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const cancelled: (() => void)[] = [],
    rendered: StoredAppearance[] = [],
    written: StoredAppearance[] = [];
  const transition = new WindowAppearanceTransition(
    windowThemes.dark,
    (value) => rendered.push({ ...value }),
    (value) => written.push({ ...value }),
    {
      now: () => now,
      schedule: (fn, delay) => {
        const id = ++nextId;
        jobs.set(id, { at: now + delay, fn });
        return id;
      },
      cancel: (handle) => {
        const job = jobs.get(handle as number);
        if (job) cancelled.push(job.fn);
        jobs.delete(handle as number);
      }
    },
    persisted
  );
  const advance = (elapsed: number) => {
    const end = now + elapsed;
    for (;;) {
      const entry = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      jobs.delete(entry[0]);
      now = entry[1].at;
      entry[1].fn();
    }
    now = end;
  };
  // A delayed timer lets us inspect an exact wall-clock point without exposing private state.
  const frameAfter = (elapsed: number) => {
    const [id, job] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
    now += elapsed;
    assert.ok(now >= job.at);
    jobs.delete(id);
    job.fn();
  };
  return { transition, rendered, written, advance, frameAfter, cancelled, jobs };
}

function assertColorBetween(actual: string, from: string, to: string, fraction: number) {
  for (const offset of [1, 3, 5]) {
    const a = parseInt(from.slice(offset, offset + 2), 16);
    const b = parseInt(to.slice(offset, offset + 2), 16);
    const channel = parseInt(actual.slice(offset, offset + 2), 16);
    assert.ok(
      Math.abs(channel - (a + (b - a) * fraction)) <= 1,
      `${actual} is not at ${fraction} of the palette distance`
    );
  }
}

function assertPaletteFraction(value: StoredAppearance, fraction: number) {
  assertColorBetween(value.background, windowThemes.dark.background, windowThemes.light.background, fraction);
  assertColorBetween(value.foreground, windowThemes.dark.foreground, windowThemes.light.foreground, fraction);
}

test('native colors animate for 320ms without persisting intermediate colors', () => {
  const h = harness();
  h.transition.set({ ...windowThemes.light, animate: true });
  h.advance(160);
  assert.equal(h.written.length, 0);
  assert.ok(h.rendered.length > 2);
  assert.notEqual(h.rendered.at(-1)!.background, windowThemes.dark.background);
  assert.notEqual(h.rendered.at(-1)!.background, windowThemes.light.background);
  h.advance(160);
  assert.deepEqual(h.rendered.at(-1), windowThemes.light);
  assert.deepEqual(h.written, [windowThemes.light]);
  assert.equal(h.jobs.size, 0);
  assert.equal('animate' in h.written[0], false);
});

test('rapid toggles continue from current frame and only the final choice can win', () => {
  const h = harness();
  h.transition.set({ ...windowThemes.light, animate: true });
  h.advance(96);
  const mid = h.rendered.at(-1)!.background;
  h.transition.set({ ...windowThemes.dark, animate: true });
  assert.equal(h.rendered.at(-1)!.background, mid);
  h.advance(48);
  h.transition.set({ ...windowThemes.light, animate: true });
  // Even if a queued timer gets delivered despite cancellation it must be inert.
  const count = h.rendered.length;
  for (const fn of h.cancelled) fn();
  assert.equal(h.rendered.length, count);
  h.advance(200);
  assert.equal(h.written.length, 0);
  h.advance(120);
  assert.deepEqual(h.written, [windowThemes.light]);
  h.advance(500);
  assert.deepEqual(h.rendered.at(-1), windowThemes.light);
});

test('an interrupted half-distance transition reverses in 160ms like CSS, with matching intermediate colors', () => {
  const h = harness();
  h.transition.set({ ...windowThemes.light, animate: true });
  // For cubic-bezier(0,0,.58,1), parameter t=.5 gives x=.3425, y=.5 exactly.
  h.frameAfter(109.6); // 320 * .3425
  assertPaletteFraction(h.rendered.at(-1)!, 0.5);
  h.transition.set({ ...windowThemes.dark, animate: true });
  assertPaletteFraction(h.rendered.at(-1)!, 0.5);
  h.frameAfter(54.8); // shortened 160 * .3425; halfway back in color distance
  assertPaletteFraction(h.rendered.at(-1)!, 0.25);
  h.advance(105.19);
  assert.notEqual(h.jobs.size, 0);
  h.advance(0.02);
  assert.equal(h.jobs.size, 0);
  assert.deepEqual(h.rendered.at(-1), windowThemes.dark);
  assert.equal(h.written.length, 0, 'returning to the saved mode needs no redundant write');
});

test('repeated CSS reversals retain the adjusted endpoints and shorten to 160, 240 then 200ms', () => {
  const h = harness();
  h.transition.set({ ...windowThemes.light, animate: true });
  h.frameAfter(109.6);
  h.transition.set({ ...windowThemes.dark, animate: true }); // factor .5, duration 160
  h.frameAfter(54.8);
  assertPaletteFraction(h.rendered.at(-1)!, 0.25);
  h.transition.set({ ...windowThemes.light, animate: true }); // factor .75, duration 240
  h.frameAfter(82.2); // 240 * .3425; color is halfway from .25 to 1
  assertPaletteFraction(h.rendered.at(-1)!, 0.625);
  h.transition.set({ ...windowThemes.dark, animate: true }); // factor .625, duration 200
  h.frameAfter(68.5); // 200 * .3425
  assertPaletteFraction(h.rendered.at(-1)!, 0.3125);
  h.advance(131.49);
  assert.notEqual(h.jobs.size, 0);
  h.advance(0.02);
  assert.equal(h.jobs.size, 0);
  assert.deepEqual(h.rendered.at(-1), windowThemes.dark);
  assert.equal(h.written.length, 0);
});

test('a new color target is not treated as a reversal and receives the full duration', () => {
  const h = harness();
  h.transition.set({ ...windowThemes.light, animate: true });
  h.frameAfter(109.6);
  const custom = { mode: 'light' as const, background: '#334455', foreground: '#aabbcc' };
  h.transition.set({ ...custom, animate: true });
  h.advance(319);
  assert.equal(h.written.length, 0);
  h.advance(1);
  assert.deepEqual(h.written, [custom]);
});

test('quit flushes final target once and cancelled frames cannot restore partial colors', () => {
  const h = harness();
  h.transition.set({ ...windowThemes.light, animate: true });
  h.advance(47);
  h.transition.flush();
  h.transition.flush();
  h.advance(1000);
  for (const fn of h.cancelled) fn();
  assert.deepEqual(h.written, [windowThemes.light]);
  assert.deepEqual(h.rendered.at(-1), windowThemes.light);
  assert.equal(h.jobs.size, 0);
});

test('startup and reduced-motion callers apply immediately; old appearance records remain valid', () => {
  const h = harness();
  const legacy = appearanceSchema.parse({ mode: 'light', background: '#FFF', foreground: '#123' });
  h.transition.set(legacy);
  assert.equal(h.jobs.size, 0);
  assert.deepEqual(h.written, [{ mode: 'light', background: '#ffffff', foreground: '#112233' }]);
  h.transition.set({ ...legacy, animate: false });
  assert.equal(h.written.length, 1);
  assert.equal(appearanceSchema.safeParse({ ...legacy, animate: 'yes' }).success, false);
  assert.equal(appearanceSchema.safeParse({ ...legacy, foreground: 'red' }).success, false);
});

test('a duplicate animated request does not prolong the switch or write twice', () => {
  const h = harness();
  h.transition.set({ ...windowThemes.light, animate: true });
  h.advance(200);
  h.transition.set({ ...windowThemes.light, animate: true });
  h.advance(120);
  assert.deepEqual(h.written, [windowThemes.light]);
});

test('an asynchronous persistence failure is reported and can be retried on quit', () => {
  let time = 0,
    scheduled: (() => void) | undefined,
    fail = true;
  const errors: unknown[] = [],
    written: StoredAppearance[] = [];
  const transition = new WindowAppearanceTransition(
    windowThemes.dark,
    () => {},
    (value) => {
      if (fail) throw new Error('disk full');
      written.push(value);
    },
    {
      now: () => time,
      schedule: (fn) => {
        scheduled = fn;
        return 1;
      },
      cancel: () => {
        scheduled = undefined;
      }
    },
    windowThemes.dark,
    (error) => errors.push(error)
  );
  transition.set({ ...windowThemes.light, animate: true });
  time = 320;
  scheduled!();
  assert.equal(errors.length, 1);
  assert.equal(written.length, 0);
  fail = false;
  transition.flush();
  assert.deepEqual(written, [windowThemes.light]);
});

test('renamed executable keeps installer identity and the original profile directory', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'wenxu-desktop');
  assert.equal(pkg.build.appId, 'local.wenxu.desktop');
  assert.equal(pkg.build.nsis.guid, 'abaa7e0a-484b-5222-a08b-20b012130b6d');
  assert.equal(pkg.build.win.executableName, '星月书台');
  assert.equal(pkg.build.win.executableName, brand.executableName);
  assert.equal(pkg.build.productName, brand.name);
  assert.equal(
    userDataDirectory(path.resolve('legacy-appdata')),
    path.resolve('legacy-appdata/wenxu-desktop')
  );
  assert.equal(
    userDataDirectory(path.resolve('legacy-appdata'), 'isolated-profile'),
    path.resolve('isolated-profile')
  );
});
