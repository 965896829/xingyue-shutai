import { z } from 'zod';
import {
  bridgeOptionsSchema,
  commandContracts,
  isCommand,
  parseInput,
  parseOutput
} from '../shared/contracts';
import { ApplicationError, errorPayload, errorSchema } from '../shared/errors';
import { managementStatusSchema, type ManagementStatus } from '../shared/management';
import type { AppEvent, ClientApi } from '../shared/types';
import { chooseLocalFile } from './FilePicker';

export interface ManagementSession {
  csrf: string;
  client: ManagementStatus;
}
export async function connectManagement(pair?: string): Promise<ManagementSession> {
  const response = await fetch(
    '/api/session',
    pair
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: pair })
        }
      : {}
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '连接客户端失败');
  return z.object({ csrf: z.string(), client: managementStatusSchema }).parse(data);
}
export function installManagementBridge(session: ManagementSession) {
  const base = `/api/clients/${session.client.clientId}/`;
  let projectSessionId: string | undefined, workerGeneration: number | undefined;
  let sequence = 0,
    snapshotSequence = 0;
  const listeners = new Set<(event: AppEvent) => void>();
  const requests = new Map<string, AbortController>();
  let events: EventSource | undefined;
  const emit = (event: AppEvent) => {
    for (const listener of listeners) listener(event);
  };
  const api = async <T>(route: string, input?: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(route.startsWith('/') ? route : base + route, {
      ...(input === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Wenxu-Csrf': session.csrf },
            body: JSON.stringify(input)
          }),
      signal
    });
    const value = await response.json();
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new CustomEvent('management:expired'));
      throw new ApplicationError(
        response.status === 401 || response.status === 403 ? 'PERMISSION_DENIED' : 'VALIDATION_ERROR',
        value.error ?? '管理请求失败'
      );
    }
    return value as T;
  };
  const bridge: ClientApi = {
    invoke: async (command, rawArgs, rawOptions) => {
      let waitId: string | undefined;
      try {
        if (!isCommand(command)) throw new ApplicationError('VALIDATION_ERROR', '不支持此操作');
        const args = parseInput(command, rawArgs ?? {});
        const options = bridgeOptionsSchema.parse(rawOptions ?? {});
        const operationId = options.operationId ?? crypto.randomUUID();
        waitId = options.waitId ?? crypto.randomUUID();
        const controller = new AbortController();
        requests.set(waitId, controller);
        if (command === 'app.chooseDirectory' || command === 'app.chooseFile') {
          const input = args as { title?: string; name?: string; save?: boolean };
          return {
            ok: true,
            result: await chooseLocalFile(api, {
              mode: command === 'app.chooseDirectory' ? 'directory' : input.save ? 'save' : 'open',
              title: input.title,
              name: input.name,
              signal: controller.signal
            })
          };
        }
        const currentSequence = ++sequence;
        let response: unknown;
        try {
          response = await api(
            'rpc',
            {
              command,
              args,
              context: {
                ...options,
                operationId,
                waitId,
                projectSessionId,
                workerGeneration,
                timeoutMs: Math.min(
                  commandContracts[command].timeout,
                  options.timeoutMs ?? commandContracts[command].timeout
                )
              }
            },
            controller.signal
          );
        } catch (error) {
          if (error instanceof ApplicationError) throw error;
          throw new ApplicationError(
            commandContracts[command].access === 'read' ? 'WORKER_UNAVAILABLE' : 'REMOTE_RESULT_UNKNOWN',
            '与客户端的连接中断。已发送的操作可能仍在执行，请重新连接后核对原任务；不会自动重发。',
            ['refresh', 'query_operation'],
            { operationId }
          );
        }
        const envelope = z
          .object({
            ok: z.boolean(),
            result: z.unknown().optional(),
            error: errorSchema.optional(),
            projectSessionId: z.string().optional(),
            workerGeneration: z.number().optional()
          })
          .parse(response);
        if (!envelope.ok) return { ok: false, error: envelope.error! };
        const result = parseOutput(command, envelope.result);
        // Only a snapshot actually displayed by this view may move its project binding.
        if (
          (command === 'app.snapshot' || commandContracts[command].access === 'lifecycle') &&
          currentSequence >= snapshotSequence &&
          (workerGeneration === undefined || (envelope.workerGeneration ?? 0) >= workerGeneration)
        ) {
          snapshotSequence = currentSequence;
          projectSessionId = envelope.projectSessionId;
          workerGeneration = envelope.workerGeneration;
        }
        if (command === 'app.snapshot' && result && typeof result === 'object')
          Object.assign(result, {
            projectSessionId: envelope.projectSessionId,
            workerGeneration: envelope.workerGeneration
          });
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: errorPayload(error) };
      } finally {
        if (waitId) requests.delete(waitId);
      }
    },
    cancelWait: (waitId) => {
      requests.get(waitId)?.abort();
      void api('cancel-wait', { waitId }).catch(() => {});
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
  window.wenxu = bridge;
  events = new EventSource(base + 'events');
  events.onmessage = (message) => {
    try {
      emit(JSON.parse(message.data) as AppEvent);
    } catch {
      emit({ type: 'snapshot' });
    }
  };
  events.onopen = () => window.dispatchEvent(new CustomEvent('management:connected'));
  events.onerror = () => window.dispatchEvent(new CustomEvent('management:disconnected'));
  events.addEventListener('expired', () => {
    events?.close();
    window.dispatchEvent(new CustomEvent('management:expired'));
  });
  return {
    api,
    close: () => {
      events?.close();
      for (const controller of requests.values()) controller.abort();
    },
    bridge
  };
}
export type ManagementTransport = ReturnType<typeof installManagementBridge>;
