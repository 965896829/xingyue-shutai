// Delay/cancellation routines adapted from DeepSeek Harness (MIT), commit
// 687f282e8625c6b8d11ff58211a90524be2e4317. See THIRD_PARTY_NOTICES.md.
import { RequestError } from '../provider';
import type { Profile } from '../../shared/types';

export function recoveryDelay(retry: number, retryAfterMs?: number, random = Math.random) {
  if (retryAfterMs !== undefined) return Math.max(0, retryAfterMs);
  const exponential = Math.min(1000 * 2 ** Math.min(retry - 1, 10), 10_000);
  return Math.round(Math.min(exponential * (0.8 + 0.4 * random()), 10_000));
}
export function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true); }, delayMs);
    function onAbort() { clearTimeout(timer); resolve(false); }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
export function canRecoverRequest(error: unknown, profile: Profile, retry: number, partial: boolean, signal: AbortSignal) {
  if (signal.aborted || partial || !(error instanceof RequestError)) return false;
  if (retry > (profile.networkRecovery?.maxRetries ?? 2)) return false;
  if (error.uncertain && !profile.networkRecovery?.retryUnknown) return false;
  const diagnostic = error.diagnostic;
  if (!diagnostic || diagnostic.retryable === false || (diagnostic.retryAfterMs ?? 0) > 30_000) return false;
  if (diagnostic.code === 'CANCELLED' || /^HTTP_4\d\d$/.test(diagnostic.code) && !['HTTP_408', 'HTTP_429'].includes(diagnostic.code)) return false;
  return diagnostic.retryable === true || ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'UND_ERR_SOCKET', 'NETWORK_INTERRUPTED', 'WEBSOCKET_CLOSED', 'WEBSOCKET_CONNECTION_ERROR', 'REQUEST_TIMEOUT', 'HTTP_408', 'HTTP_429', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504', 'upstream_http2_stream_error', 'upstream_stream_read_error', 'upstream_stream_truncated', 'stream_timeout', 'stream_read_error'].includes(diagnostic.code);
}
