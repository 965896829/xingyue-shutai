import type { BrowserWindowConstructorOptions } from 'electron';
import type { WindowAppearance } from '../src/shared/desktop';

export function usesNativeTitleBar(platform: NodeJS.Platform) {
  return platform === 'darwin';
}

export function windowChrome(platform: NodeJS.Platform, colors: WindowAppearance): BrowserWindowConstructorOptions {
  return usesNativeTitleBar(platform)
    ? { titleBarStyle: 'default' }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: colors.background, symbolColor: colors.foreground, height: 38 } };
}

interface WindowColors {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void;
}

export function applyWindowColors(window: WindowColors, platform: NodeJS.Platform, colors: WindowAppearance) {
  if (window.isDestroyed()) return;
  window.setBackgroundColor(colors.background);
  // Electron exposes setTitleBarOverlay only on Windows/Linux.
  if (!usesNativeTitleBar(platform))
    window.setTitleBarOverlay({ color: colors.background, symbolColor: colors.foreground, height: 38 });
}
