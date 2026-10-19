/** Public branding changes must not change the installed application's data identity. */
export const brand = {
  name: '星月书台',
  windowTitle: '星月书台 · 创作工作台',
  internalName: 'wenxu-desktop',
  appId: 'local.wenxu.desktop',
  executableName: '星月书台'
} as const;

export const windowThemes = {
  dark: { mode: 'dark', background: '#111522', foreground: '#f3f0ea' },
  light: { mode: 'light', background: '#fbf9f5', foreground: '#263049' }
} as const;
