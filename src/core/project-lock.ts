import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface ProjectLock {
  pid: number;
  createdAt?: string;
  processStartedAt?: number;
}

export function parseProjectLock(text: string): ProjectLock {
  const value = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
      (value.processStartedAt !== undefined && (!Number.isSafeInteger(value.processStartedAt) || value.processStartedAt <= 0)))
    throw new Error('作品锁身份无效，已停止自动接管');
  return value;
}

let ownStart: number | null | undefined;
export function processStartedAt(pid: number): number | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (pid === process.pid && ownStart !== undefined) return ownStart ?? undefined;
  let startedAt: number | undefined;
  try {
    const options = { encoding: 'utf8' as const, windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };
    if (process.platform === 'win32') {
      const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const output = execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; ([DateTimeOffset](Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`], options);
      const value = Number(output.trim());
      if (Number.isSafeInteger(value) && value > 0) startedAt = value;
    } else {
      const output = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { ...options, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
      const value = Date.parse(`${output.trim()} UTC`);
      if (Number.isSafeInteger(value) && value > 0) startedAt = value;
    }
  } catch {
    // An inaccessible process is not proof that its writer has exited.
  }
  if (pid === process.pid) ownStart = startedAt ?? null;
  return startedAt;
}

type ProcessPresence = 'alive' | 'exited' | 'unknown';
function presence(pid: number): ProcessPresence {
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'exited' : 'unknown'; }
}

export function classifyProjectLock(lock: ProjectLock, owner: { presence: ProcessPresence; startedAt?: number }): 'active' | 'stale' | 'unknown' {
  if (owner.presence === 'exited') return 'stale';
  if (owner.presence !== 'alive' || owner.startedAt === undefined) return 'unknown';
  if (lock.processStartedAt !== undefined) return lock.processStartedAt === owner.startedAt ? 'active' : 'stale';
  // Older clients stored a JS runtime timeOrigin, not the OS process birth time.
  // A process born after the lock was written cannot be that lock's owner.
  const createdAt = typeof lock.createdAt === 'string' ? Date.parse(lock.createdAt) : NaN;
  return Number.isFinite(createdAt) && owner.startedAt > createdAt + 1000 ? 'stale' : 'active';
}

export function assertProjectLockInactive(lock: ProjectLock, message = '这部作品正在另一个窗口或进程中打开，请先关闭它') {
  let state = presence(lock.pid);
  const startedAt = state === 'alive' ? processStartedAt(lock.pid) : undefined;
  if (state === 'alive' && startedAt === undefined) state = presence(lock.pid);
  const status = classifyProjectLock(lock, { presence: state, startedAt });
  if (status === 'active') throw new Error(message);
  if (status === 'unknown') throw new Error('暂时无法核实作品的占用进程，已保留作品和占用记录，请稍后重试');
}
