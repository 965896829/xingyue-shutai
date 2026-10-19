import { ApplicationError } from '../../shared/errors';

interface Job {
  id: string; resources: string[]; priority: number; sequence: number;
  run(): Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void;
}
export class ResourceScheduler {
  private queue: Job[] = [];
  private active = new Map<string, Job>();
  private sequence = 0;
  private draining = false;
  get pending() { return this.queue.length; }
  get running() { return this.active.size; }
  run<T>(id: string, resources: string[], priority: number, execute: () => Promise<T>): Promise<T> {
    if (this.draining) return Promise.reject(new ApplicationError('WORKER_UNAVAILABLE', '任务调度器正在关闭'));
    if (!resources.length || new Set(resources).size !== resources.length) throw new Error('任务资源声明无效');
    if (this.active.has(id) || this.queue.some((job) => job.id === id)) throw new Error('同一任务不能重复调度');
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id, resources: [...resources].sort(), priority, sequence: this.sequence++, run: execute, resolve: (result) => resolve(result as T), reject });
      this.pump();
    });
  }
  cancel(id: string) {
    const index = this.queue.findIndex((job) => job.id === id);
    if (index < 0) return false;
    this.queue.splice(index, 1)[0].reject(new ApplicationError('CANCEL_REQUESTED', '排队任务已取消'));
    return true;
  }
  stop() { this.draining = true; for (const job of [...this.queue]) this.cancel(job.id); }
  private pump() {
    const held = new Set([...this.active.values()].flatMap((job) => job.resources));
    this.queue.sort((a, b) => b.priority + (this.sequence - b.sequence) / 10 - (a.priority + (this.sequence - a.sequence) / 10) || a.sequence - b.sequence);
    for (const job of [...this.queue]) {
      if (job.resources.some((resource) => held.has(resource))) continue;
      this.queue.splice(this.queue.indexOf(job), 1);
      this.active.set(job.id, job);
      job.resources.forEach((resource) => held.add(resource));
      let promise: Promise<unknown>;
      try { promise = job.run(); } catch (error) { promise = Promise.reject(error); }
      void promise.then(job.resolve, job.reject).finally(() => { this.active.delete(job.id); this.pump(); });
    }
  }
}
