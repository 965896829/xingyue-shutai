import { buildVersion } from './build';

/** Public branding changes must not change the installed application's data identity. */
export const brand = {
  name: '星月书台',
  windowTitle: `星月书台 · v${buildVersion}`,
  internalName: 'wenxu-desktop',
  appId: 'local.wenxu.desktop',
  executableName: '星月书台'
} as const;

export const windowThemes = {
  dark: { mode: 'dark', background: '#1b1c20', foreground: '#eeeff3' },
  light: { mode: 'light', background: '#ffffff', foreground: '#24252b' }
} as const;
