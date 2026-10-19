import { ApplicationError } from '../src/shared/errors';

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}
export class PendingRequests {
  private requests = new Map<string, Pending>();
  get size() { return this.requests.size; }
  create(requestId: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.requests.has(requestId)) throw new Error('重复运输请求编号');
    if (signal?.aborted) return Promise.reject(new ApplicationError('CANCEL_REQUESTED', '已取消等待响应', ['query_operation']));
    return new Promise((resolve, reject) => {
      const finish = (error: Error) => this.reject(requestId, error);
      const timer = setTimeout(() => finish(new ApplicationError('TIMEOUT_WAITING_RESPONSE', '等待响应超时；操作可能已经执行，请查询原操作结果', ['query_operation'])), timeoutMs);
      const abort = () => finish(new ApplicationError('CANCEL_REQUESTED', '已取消等待响应；后台操作状态请查询原操作', ['query_operation']));
      signal?.addEventListener('abort', abort, { once: true });
      this.requests.set(requestId, { resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } });
    });
  }
  resolve(id: string, result: unknown) {
    const job = this.take(id);
    job?.resolve(result);
    return !!job;
  }
  reject(id: string, error: Error) {
    const job = this.take(id);
    job?.reject(error);
    return !!job;
  }
  private take(id: string) {
    const job = this.requests.get(id);
    if (job) { this.requests.delete(id); job.cleanup(); }
    return job;
  }
  clear(error: Error) { for (const id of this.requests.keys()) this.reject(id, error); }
}
