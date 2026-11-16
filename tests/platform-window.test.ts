import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWindowColors, windowChrome } from '../electron/platform-window';
import { windowThemes } from '../src/shared/brand';

test('macOS changes theme without calling the unavailable title-bar overlay API', () => {
  const backgrounds: string[] = [];
  const window = {
    isDestroyed: () => false,
    setBackgroundColor: (color: string) => backgrounds.push(color),
    setTitleBarOverlay: () => { throw new Error('not available on macOS'); }
  };
  assert.equal(windowChrome('darwin', windowThemes.dark).titleBarOverlay, undefined);
  assert.equal(windowChrome('darwin', windowThemes.dark).titleBarStyle, 'default');
  for (const colors of [windowThemes.light, windowThemes.dark]) applyWindowColors(window, 'darwin', colors);
  assert.deepEqual(backgrounds, [windowThemes.light.background, windowThemes.dark.background]);
});

test('Windows keeps overlay colors in sync, and destroyed windows receive no updates', () => {
  let destroyed = false;
  const calls: unknown[] = [];
  const window = {
    isDestroyed: () => destroyed,
    setBackgroundColor: (color: string) => calls.push(color),
    setTitleBarOverlay: (colors: unknown) => calls.push(colors)
  };
  const chrome = windowChrome('win32', windowThemes.light);
  assert.equal(chrome.titleBarStyle, 'hidden');
  applyWindowColors(window, 'win32', windowThemes.light);
  assert.deepEqual(calls, [windowThemes.light.background, chrome.titleBarOverlay]);
  destroyed = true;
  applyWindowColors(window, 'win32', windowThemes.dark);
  assert.equal(calls.length, 2);
});
