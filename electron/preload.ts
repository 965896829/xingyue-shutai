import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent } from '../src/shared/types';
import type { DesktopApi } from '../src/shared/desktop';
import { bridgeOptionsSchema, commandContracts, isCommand, parseInput, parseOutput, type BridgeInvoke } from '../src/shared/contracts';
import { waitForResponse } from '../src/shared/wait-for-response';
import { z } from 'zod';
import { errorSchema, errorPayload, ApplicationError } from '../src/shared/errors';
let projectSessionId: string | undefined;
let workerGeneration: number | undefined;
contextBridge.exposeInMainWorld('wenxu', {
  desktop: {
    setAppearance: (appearance) => ipcRenderer.invoke('wenxu:appearance', appearance),
    openMenu: (menu, position) => ipcRenderer.invoke('wenxu:menu', menu, position),
    onCloseRequested: (listener) => {
      let active = true;
      const handler = (_: unknown, requestId: string) => listener(requestId);
      ipcRenderer.on('wenxu:close-requested', handler);
      // Recover a close click received before React subscribed, including a reload.
      void ipcRenderer
        .invoke('wenxu:close-ready')
        .then((requestId: string | null) => {
          if (active && requestId) listener(requestId);
        })
        .catch(() => {});
      return () => {
        active = false;
        ipcRenderer.removeListener('wenxu:close-requested', handler);
      };
    },
    respondToClose: (requestId, action) => ipcRenderer.invoke('wenxu:close-response', { requestId, action })
  } satisfies DesktopApi,
  invoke: (async (command, args, options) => {
    try {
    if (!isCommand(command)) throw new ApplicationError('VALIDATION_ERROR', '不支持此操作');
    options = bridgeOptionsSchema.parse(options ?? {});
    const operationId = options.operationId ?? crypto.randomUUID();
    const waitId = options.waitId ?? crypto.randomUUID();
    const timeoutMs = Math.min(commandContracts[command].timeout, Math.max(1, options?.timeoutMs ?? commandContracts[command].timeout));
    const response: unknown = await waitForResponse(ipcRenderer.invoke('wenxu:invoke', command, parseInput(command, args ?? {}), { operationId, projectSessionId, workerGeneration, waitId, timeoutMs }), operationId, timeoutMs, undefined, () => ipcRenderer.send('wenxu:cancel-wait', waitId));
    const envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), error: errorSchema.optional(), projectSessionId: z.string().optional(), workerGeneration: z.number().optional() }).parse(response);
    if (envelope.workerGeneration === undefined || workerGeneration === undefined || envelope.workerGeneration >= workerGeneration) {
      projectSessionId = envelope.projectSessionId;
      workerGeneration = envelope.workerGeneration;
    }
    if (!envelope.ok) throw new ApplicationError(envelope.error!.code, envelope.error!.message, envelope.error!.actions, { ...envelope.error!.details, operationId });
    const result = parseOutput(command, envelope.result);
    if (command === 'app.snapshot' && result && typeof result === 'object') Object.assign(result, { projectSessionId, workerGeneration });
    return { ok: true, result };
    } catch (error) {
      return { ok: false, error: errorPayload(error) };
    }
  }) satisfies BridgeInvoke,
  cancelWait: (waitId: string) => { if (z.string().uuid().safeParse(waitId).success) ipcRenderer.send('wenxu:cancel-wait', waitId); },
  onEvent: (listener: (event: AppEvent) => void) => {
    const handler = (_: unknown, event: AppEvent) => listener(event);
    ipcRenderer.on('wenxu:event', handler);
    return () => ipcRenderer.removeListener('wenxu:event', handler);
  }
});
