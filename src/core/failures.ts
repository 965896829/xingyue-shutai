import { errorPayload, legacyErrorCode, type ErrorCode, type ErrorPayload } from '../shared/errors';
import { RequestError } from './provider';

export function classifyFailure(error: unknown): ErrorPayload {
  if (!(error instanceof RequestError)) return errorPayload(error);
  const diagnostic = error.diagnostic;
  const code: ErrorCode = diagnostic?.code === 'CANCELLED' || !diagnostic && !error.uncertain && legacyErrorCode(error.message) === 'CANCEL_REQUESTED' ? 'CANCEL_REQUESTED'
    : /^HTTP_(400|401|403|404|422)$/.test(diagnostic?.code ?? '') ? 'MODEL_CONFIGURATION'
    : diagnostic?.code === 'HTTP_429' ? 'RATE_LIMITED'
    : diagnostic?.source === 'protocol' ? 'OUTPUT_INCOMPLETE'
    : error.uncertain ? 'REMOTE_RESULT_UNKNOWN' : 'NETWORK_UNAVAILABLE';
  return {
    ...errorPayload(error), code,
    actions: error.uncertain ? ['query_operation', 'authorize_attempt'] : ['resume_local'],
    details: { uncertain: error.uncertain, ...(diagnostic ?? {}) }
  };
}
