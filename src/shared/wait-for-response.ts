import { ApplicationError } from './errors';

export function waitForResponse<T>(response: Promise<T>, operationId: string, timeoutMs: number, signal?: AbortSignal, cancel?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      action();
    };
    const stop = (code: 'CANCEL_REQUESTED' | 'TIMEOUT_WAITING_RESPONSE', message: string) => finish(() => {
      cancel?.();
      reject(new ApplicationError(code, message, ['query_operation'], { operationId }));
    });
    const abort = () => stop('CANCEL_REQUESTED', '已取消等待响应；后台操作可能已经执行，请查询原操作');
    const timer = setTimeout(() => stop('TIMEOUT_WAITING_RESPONSE', '等待响应超时；后台操作可能已经执行，请查询原操作'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    response.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    if (signal?.aborted) abort();
  });
}
