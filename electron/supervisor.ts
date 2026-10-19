import { buildVersion, protocolVersion } from '../src/shared/build';
import { ApplicationError } from '../src/shared/errors';

export class WorkerSupervisor {
  state: 'stopped' | 'starting' | 'ready' | 'draining' | 'exited' | 'degraded' = 'stopped';
  generation = 0;
  failures = 0;
  private startedAt = 0;
  constructor(private readonly clock = Date.now, private readonly random = Math.random) {}
  start() {
    if (!['stopped', 'exited'].includes(this.state)) throw new Error('旧执行内核尚未退出，拒绝同时启动');
    this.state = 'starting';
    this.startedAt = this.clock();
    return ++this.generation;
  }
  ready(message: { protocolVersion: number; buildVersion: string; workerGeneration: number }) {
    if (this.state !== 'starting' || message.protocolVersion !== protocolVersion || message.buildVersion !== buildVersion || message.workerGeneration !== this.generation)
      throw new ApplicationError('PROTOCOL_MISMATCH', '执行内核版本不兼容，未启动业务操作');
    this.state = 'ready';
  }
  drain() { this.state = 'draining'; }
  exited(expected: boolean) {
    if (expected) { this.state = 'stopped'; return null; }
    if (this.clock() - this.startedAt > 60_000) this.failures = 0;
    this.failures++;
    if (this.failures > 3) { this.state = 'degraded'; return null; }
    this.state = 'exited';
    return Math.round(500 * 2 ** (this.failures - 1) * (0.8 + this.random() * 0.4));
  }
}
