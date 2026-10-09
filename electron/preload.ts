import { contextBridge, ipcRenderer } from 'electron';
import { commands, type Command, type AppEvent } from '../src/shared/types';
import type { DesktopApi } from '../src/shared/desktop';
contextBridge.exposeInMainWorld('wenxu', {
  desktop: {
    setAppearance: (appearance) => ipcRenderer.invoke('wenxu:appearance', appearance),
    openMenu: (menu, position) => ipcRenderer.invoke('wenxu:menu', menu, position)
  } satisfies DesktopApi,
  invoke: (command: Command, args: Record<string, unknown> = {}) => {
    if (!commands.includes(command)) return Promise.reject(new Error('不支持此操作'));
    return ipcRenderer.invoke('wenxu:invoke', command, args);
  },
  onEvent: (listener: (event: AppEvent) => void) => {
    const handler = (_: unknown, event: AppEvent) => listener(event);
    ipcRenderer.on('wenxu:event', handler);
    return () => ipcRenderer.removeListener('wenxu:event', handler);
  }
});
