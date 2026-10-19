import { Worker } from 'node:worker_threads';
import type { ImportedDocument } from '../document-import';
import { parseOutput } from '../../shared/contracts';
import { ApplicationError } from '../../shared/errors';

export class DocumentImporter {
  private active = new Set<Worker>();
  constructor(readonly entry: string | URL, readonly timeoutMs = 25_000) {}
  get running() { return this.active.size; }
  async read(file: string, signal?: AbortSignal): Promise<ImportedDocument> {
    if (signal?.aborted) throw new ApplicationError('CANCEL_REQUESTED', '文档导入已停止');
    const worker = new Worker(this.entry, { workerData: { file }, execArgv: /\.tsx?$/.test(String(this.entry)) ? ['--import', 'tsx'] : [], resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 4 } });
    this.active.add(worker);
    return await new Promise<ImportedDocument>((resolve, reject) => {
      let result: ImportedDocument | undefined;
      let failure: Error | undefined;
      let received = false;
      let settled = false;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.active.delete(worker);
        if (failure) reject(failure);
        else if (code !== 0 || !result) reject(new ApplicationError('WORKER_UNAVAILABLE', '文档解析线程中断，原文件未修改', ['retry_read']));
        else resolve(result);
      };
      const stop = (error: Error) => {
        failure ??= error;
        void worker.terminate().catch(() => finish(1));
      };
      const abort = () => stop(new ApplicationError('CANCEL_REQUESTED', '文档导入已停止，原文件未修改'));
      const timer = setTimeout(() => stop(new ApplicationError('TIMEOUT_WAITING_RESPONSE', '文档解析超时，原文件未修改', ['retry_read'])), this.timeoutMs);
      timer.unref();
      worker.on('message', (message: unknown) => {
        if (failure) return;
        try {
          if (received || !message || typeof message !== 'object' || !('ok' in message)) throw new Error('文档解析返回格式不正确');
          received = true;
          if (message.ok === true && 'result' in message) result = parseOutput('project.importDocument', message.result);
          else if (message.ok === false && 'error' in message && typeof message.error === 'string') failure = new Error(message.error);
          else throw new Error('文档解析返回格式不正确');
        } catch {
          stop(new ApplicationError('VALIDATION_ERROR', '文档解析返回格式不正确'));
        }
      });
      worker.on('error', (error) => { failure ??= new ApplicationError('WORKER_UNAVAILABLE', `文档解析线程异常：${error instanceof Error ? error.message : String(error)}`, ['retry_read']); });
      worker.once('exit', finish);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}
