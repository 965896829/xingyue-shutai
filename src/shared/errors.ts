import { z } from 'zod';

export const errorCodes = ['VALIDATION_ERROR', 'PROTOCOL_MISMATCH', 'PROJECT_SESSION_STALE', 'PROJECT_VERSION_UNSUPPORTED', 'VERSION_CONFLICT', 'APPROVAL_STALE', 'PERMISSION_DENIED', 'BUDGET_UNCONFIRMED', 'BUDGET_EXCEEDED', 'REMOTE_RESULT_UNKNOWN', 'WORKER_UNAVAILABLE', 'TIMEOUT_WAITING_RESPONSE', 'STORAGE_FAILURE', 'CANCEL_REQUESTED', 'OPERATION_FAILED', 'MODEL_CONFIGURATION', 'NETWORK_UNAVAILABLE', 'RATE_LIMITED', 'OUTPUT_INCOMPLETE', 'FORMAT_INVALID', 'REPAIR_EXHAUSTED', 'AUTHOR_DECISION_REQUIRED', 'ROUND_LIMIT', 'TOOL_LIMIT'] as const;
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
    code: error instanceof ApplicationError ? error.code : legacyErrorCode(error instanceof Error ? error.message : '', error),
    message: redact(error instanceof Error ? error.message : '操作失败', secrets),
    traceId: error instanceof ApplicationError ? error.traceId : crypto.randomUUID(),
    actions: error instanceof ApplicationError ? error.actions : ['refresh'],
    details: error instanceof ApplicationError ? error.details : undefined
  };
}

/** Compatibility for pre-classification records. New failures should carry a stable code. */
export function legacyErrorCode(message: string, error?: unknown): ErrorCode {
  const native = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (/^(?:SQLITE_|ERR_SQLITE|ENOSPC|EIO|EROFS)/.test(native) || /database (?:is locked|disk image is malformed)|磁盘空间不足|数据库损坏/i.test(message)) return 'STORAGE_FAILURE';
  if (/轮数上限|请求次数.*上限|请求次数达到|本阶段达到调用上限/.test(message)) return 'ROUND_LIMIT';
  if (/工具调用.*上限/.test(message)) return 'TOOL_LIMIT';
  if (/费用未知|价格|费用.*不确定|费用.*未知|币种|费用上界.*未知/.test(message)) return 'BUDGET_UNCONFIRMED';
  if (/预算.*(?:用完|超过|不足)|(?:超过|不足|达到).*预算|费用上限|费用上界/.test(message)) return 'BUDGET_EXCEEDED';
  if (/HTTP (?:400|401|403|404|422)|API Key|模型不可用|工具调用未启用|配置.*模型|模型.*配置/.test(message)) return 'MODEL_CONFIGURATION';
  if (/HTTP 429|限流/.test(message)) return 'RATE_LIMITED';
  if (/HTTP 50\d|连接中断|网络|等待模型超过|连接失败/.test(message)) return 'NETWORK_UNAVAILABLE';
  if (/输出.*(?:不完整|未完成|上限)|内容被服务端中止|响应.*不完整/.test(message)) return 'OUTPUT_INCOMPLETE';
  if (/结构.*校验连续失败/.test(message)) return 'FORMAT_INVALID';
  if (/自动修复已达|修复次数|独立审核仍有重要问题/.test(message)) return 'REPAIR_EXHAUSTED';
  if (/未核对的修订影响|核对书名承诺/.test(message)) return 'AUTHOR_DECISION_REQUIRED';
  if (/已停止|已取消/.test(message)) return 'CANCEL_REQUESTED';
  if (/(?:项目|作品|资料|依据|版本|规则|契约|上下文).*(?:改变|变化|修改|不一致)|未确认.*外部/.test(message)) return 'VERSION_CONFLICT';
  return 'OPERATION_FAILED';
}
