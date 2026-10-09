export type ColorMode = 'dark' | 'light';
const storageKey = 'wenxu-color-mode';
const changeEvent = 'wenxu:color-mode';

export function getColorMode(): ColorMode {
  return document.documentElement.dataset.colorMode === 'light' ? 'light' : 'dark';
}

export function applyColorMode(mode: ColorMode) {
  document.documentElement.dataset.colorMode = mode;
  const colors = getComputedStyle(document.documentElement);
  void window.wenxu?.desktop
    ?.setAppearance({
      mode,
      background: colors.getPropertyValue('--bg').trim(),
      foreground: colors.getPropertyValue('--ink').trim()
    })
    .catch(() => console.warn('窗口主题未同步；重新打开客户端后可重试'));
  window.dispatchEvent(new Event(changeEvent));
}

// Called before React mounts. A theme change never recreates the editor or its undo history.
export function initializeColorMode() {
  let mode: ColorMode = 'dark';
  try {
    if (localStorage.getItem(storageKey) === 'light') mode = 'light';
  } catch {
    // Storage can be unavailable; switching still works for the current session.
  }
  applyColorMode(mode);
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null)
      applyColorMode(event.newValue === 'light' ? 'light' : 'dark');
  });
}

export function setColorMode(mode: ColorMode) {
  applyColorMode(mode);
  try {
    localStorage.setItem(storageKey, mode);
  } catch {
    // Do not interrupt writing when appearance preferences cannot be persisted.
  }
}

export function subscribeColorMode(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  return () => window.removeEventListener(changeEvent, listener);
}
