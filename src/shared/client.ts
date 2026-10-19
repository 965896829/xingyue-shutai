import { bridgeOptionsSchema, commandContracts, isCommand, parseInput, parseOutput, type Invoke } from './contracts';
import { ApplicationError, errorPayload, errorSchema } from './errors';
import { waitForResponse } from './wait-for-response';
import type { ClientApi } from './types';

export function createClient(bridge: Pick<ClientApi, 'invoke' | 'cancelWait'>): Invoke {
  return async (command, args, options) => {
    const operationId = options?.operationId ?? crypto.randomUUID();
    try {
      if (!isCommand(command)) throw new ApplicationError('VALIDATION_ERROR', '不支持此操作');
      if (options?.signal?.aborted) throw new ApplicationError('CANCEL_REQUESTED', '已取消等待响应');
      const waitId = crypto.randomUUID();
      const timeoutMs = Math.min(commandContracts[command].timeout, options?.timeoutMs ?? commandContracts[command].timeout);
      const transport = bridgeOptionsSchema.parse({ operationId, waitId, timeoutMs });
      const response = await waitForResponse(bridge.invoke(command, parseInput(command, args ?? {}), transport), operationId, timeoutMs, options?.signal, () => bridge.cancelWait(waitId));
      if (!response.ok) {
        const error = errorSchema.parse(response.error);
        throw new ApplicationError(error.code, error.message, error.actions, { ...error.details, operationId });
      }
      return parseOutput(command, response.result);
    } catch (error) {
      const payload = errorPayload(error);
      throw new ApplicationError(payload.code, payload.message, payload.actions, { ...payload.details, operationId });
    }
  };
}

export const invokeCommand: Invoke = (command, args, options) => {
  if (!window.wenxu) return Promise.reject(new Error('请使用桌面客户端，浏览器预览不具备本地文件权限'));
  return createClient(window.wenxu)(command, args, options);
};
