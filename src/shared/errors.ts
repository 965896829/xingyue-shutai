import { z } from 'zod';

export const errorCodes = ['VALIDATION_ERROR', 'PROTOCOL_MISMATCH', 'PROJECT_SESSION_STALE', 'PROJECT_VERSION_UNSUPPORTED', 'VERSION_CONFLICT', 'APPROVAL_STALE', 'PERMISSION_DENIED', 'BUDGET_UNCONFIRMED', 'BUDGET_EXCEEDED', 'REMOTE_RESULT_UNKNOWN', 'WORKER_UNAVAILABLE', 'TIMEOUT_WAITING_RESPONSE', 'STORAGE_FAILURE', 'CANCEL_REQUESTED'] as const;
export type ErrorCode = typeof errorCodes[number];
export const errorSchema = z.strictObject({
  code: z.enum(errorCodes), message: z.string().max(2000), traceId: z.string(),
  actions: z.array(z.enum(['query_operation', 'refresh', 'resume_local', 'authorize_attempt', 'retry_read'])),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
});
export type ErrorPayload = z.infer<typeof errorSchema>;
export class ApplicationError extends Error {
  readonly traceId = crypto.randomUUID();
  constructor(readonly code: ErrorCode, message: string, readonly actions: ErrorPayload['actions'] = [], readonly details?: ErrorPayload['details']) {
    super(message);
  }
}
export function redact(text: string, secrets: string[] = []) {
  let value = text;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) value = value.replaceAll(secret, '[已隐藏]');
  return value.replace(/(Bearer\s+)[^\s"',;]+/gi, '$1[已隐藏]').replace(/((?:api[_-]?key|authorization|cookie|token)\s*[=:]\s*)[^\s,;}]+/gi, '$1[已隐藏]').slice(0, 2000);
}
export function errorPayload(error: unknown, secrets: string[] = []): ErrorPayload {
  if (error instanceof z.ZodError) return { code: 'VALIDATION_ERROR', message: '参数或返回结果不符合命令契约', traceId: crypto.randomUUID(), actions: ['refresh'] };
  return {
    code: error instanceof ApplicationError ? error.code : 'STORAGE_FAILURE',
    message: redact(error instanceof Error ? error.message : '操作失败', secrets),
    traceId: error instanceof ApplicationError ? error.traceId : crypto.randomUUID(),
    actions: error instanceof ApplicationError ? error.actions : ['refresh'],
    details: error instanceof ApplicationError ? error.details : undefined
  };
}
