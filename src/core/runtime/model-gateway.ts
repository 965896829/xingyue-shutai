import type { FileStore } from '../storage';
import type { ModelResult, Run, Usage } from '../../shared/types';
import { invokeModel, requestBody, RequestError, type RequestDiagnostic } from '../provider';
import { ApplicationError } from '../../shared/errors';
import { fingerprint } from './canonical';
import { assertRequestFits } from '../context-budget';
import { withTaskReasoning } from '../../shared/reasoning';

export interface Attempt {
  version: 1; id: string; runId: string; purpose: string; parentRunId: string;
  status: 'dispatching' | 'complete' | 'unknown' | 'not_sent';
  provider: string; model: string; configVersion: number; configHash: string; pricingVersion: string;
  currency: string; reservedUnits: string | null; settledUnits: string | null;
  usageState: 'pending' | 'known' | 'unknown'; usage?: Usage;
  requestHash: string; requestRef?: string; responseRef?: string; createdAt: string; completedAt?: string;
  failure?: RequestDiagnostic;
}
export type AttemptOwner = Pick<Run, 'id' | 'usage' | 'parentRunId' | 'reasoningEfforts'>;
export function moneyUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error('无效金额');
  const [digits, exponent = '0'] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = digits.split('.');
  const power = 9 + Number(exponent) - fraction.length;
  const raw = BigInt(whole + fraction);
  return power >= 0 ? raw * 10n ** BigInt(power) : (raw + 10n ** BigInt(-power) - 1n) / 10n ** BigInt(-power);
}
export function estimatedUnits(input: number, output: number, inputPrice: number, outputPrice: number) {
  return (BigInt(input) * moneyUnits(inputPrice) + BigInt(output) * moneyUnits(outputPrice) + 999_999n) / 1_000_000n;
}
export function attempts(store: FileStore, runId: string): Attempt[] {
  return store.db.sql.prepare("SELECT data FROM model_attempts WHERE run_id=? OR json_extract(data,'$.parentRunId')=? ORDER BY rowid").all(runId, runId).map((row) => JSON.parse(String(row.data)));
}
function save(store: FileStore, attempt: Attempt) {
  store.db.sql.prepare('INSERT INTO model_attempts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(attempt.id, attempt.runId, attempt.status, JSON.stringify(attempt));
}
export function recoverAttempts(store: FileStore) {
  for (const row of store.db.sql.prepare("SELECT data FROM model_attempts WHERE status='dispatching'").all()) {
    const attempt: Attempt = JSON.parse(String(row.data));
    attempt.status = 'unknown';
    attempt.usageState = 'unknown';
    save(store, attempt);
  }
}
export async function callExternal<T>(
  store: FileStore, owner: AttemptOwner, purpose: string,
  config: { provider: string; model: string; version: number; identity: unknown; pricing: unknown; currency: string },
  request: unknown, reserved: bigint | null, signal: AbortSignal,
  send: () => Promise<T>, usage: (result: T) => Usage
): Promise<T> {
  if (signal.aborted) throw new RequestError('请求尚未发送，任务已停止', false);
  const budget = store.db.project()?.config.stageBudget ?? null;
  const attempt: Attempt = {
    version: 1, id: crypto.randomUUID(), runId: owner.id, parentRunId: owner.parentRunId ?? owner.id, purpose,
    status: 'dispatching', provider: config.provider, model: config.model, configVersion: config.version,
    configHash: fingerprint(config.identity), pricingVersion: fingerprint(config.pricing), currency: config.currency, reservedUnits: reserved?.toString() ?? null,
    settledUnits: null, usageState: 'pending', requestHash: fingerprint(request), createdAt: new Date().toISOString()
  };
  store.db.transaction(() => {
    const rows = attempts(store, attempt.parentRunId);
    const baselineKey = `budgetBaseline:${attempt.parentRunId}`;
    let baseline = store.db.get<Usage>(baselineKey);
    if (!baseline) {
      const parent = owner.parentRunId ? store.db.sql.prepare('SELECT data FROM runs WHERE id=?').get(owner.parentRunId) : undefined;
      baseline = structuredClone(parent ? store.db.run(owner.parentRunId!).usage : owner.usage);
      store.db.set(baselineKey, baseline);
    }
    if (budget !== null) {
      if (baseline.cost === null || reserved === null || baseline.currency !== config.currency || rows.some((row) => row.status !== 'not_sent' && (row.currency !== config.currency || row.usageState === 'unknown')))
        throw new ApplicationError('BUDGET_UNCONFIRMED', '费用未知或币种不一致，已暂停预算内调用');
      let total = moneyUnits(baseline.cost) + reserved;
      for (const row of rows) {
        if (row.status === 'not_sent') continue;
        const amount = row.status === 'complete' ? row.settledUnits : row.reservedUnits;
        if (amount === null) throw new ApplicationError('BUDGET_UNCONFIRMED', '在途请求缺少价格，不能继续保证预算');
        total += BigInt(amount);
      }
      if (total > moneyUnits(budget)) throw new ApplicationError('BUDGET_EXCEEDED', '下一次请求会超过任务费用上限');
    }
    attempt.requestRef = store.putObject(JSON.stringify({ version: 1, request }));
    save(store, attempt);
    store.db.event(owner.id, 'attempt-dispatch', '远端请求发送意图已持久化', { attemptId: attempt.id, purpose, requestHash: attempt.requestHash });
  });
  try {
    const result = await send();
    const settled = usage(result);
    attempt.responseRef = store.putObject(JSON.stringify({ version: 1, result }));
    attempt.status = 'complete';
    attempt.usage = settled;
    attempt.usageState = settled.cost === null ? 'unknown' : 'known';
    attempt.settledUnits = settled.cost === null ? null : moneyUnits(settled.cost).toString();
    attempt.completedAt = new Date().toISOString();
    store.db.transaction(() => {
      save(store, attempt);
      store.db.event(owner.id, 'attempt-result', '远端请求结果已持久化', { attemptId: attempt.id, usageState: attempt.usageState, responseRef: attempt.responseRef });
    });
    return result;
  } catch (error) {
    if (error instanceof RequestError && error.diagnostic) attempt.failure = error.diagnostic;
    attempt.status = error instanceof RequestError && !error.uncertain ? 'not_sent' : 'unknown';
    attempt.usageState = attempt.status === 'not_sent' ? 'known' : 'unknown';
    attempt.completedAt = new Date().toISOString();
    try { save(store, attempt); }
    catch { throw new RequestError('请求结果未能持久化，已停止后续工具执行，请查询原请求', true); }
    throw error instanceof RequestError ? error : new RequestError('请求结果未知，未自动重发：' + (error instanceof Error ? error.message : '未知错误'), true);
  }
}

export async function callModel(
  store: FileStore, owner: AttemptOwner, purpose: string,
  caller: typeof invokeModel, ...args: Parameters<typeof invokeModel>
): Promise<ModelResult> {
  const [profile, system, messages, tools, signal, , options] = args;
  const bound = withTaskReasoning(profile, owner);
  args[0] = bound;
  const body = requestBody(bound, system, messages, tools, options).body;
  const sizing = assertRequestFits(profile, body, tools.length + (options?.webSearch ? 1 : 0));
  const pricing = { input: profile.inputPrice, output: profile.outputPrice, currency: profile.currency };
  if (options?.webSearch && store.db.project()?.config.stageBudget !== null && store.db.project()?.config.stageBudget !== undefined)
    throw new ApplicationError('BUDGET_UNCONFIRMED', '原生联网搜索包含额外工具费用，当前无法保证费用上限；请关闭联网或调整预算设置后重试');
  const reserved = options?.webSearch || profile.inputPrice === null || profile.outputPrice === null ? null : estimatedUnits(sizing.tokens + sizing.providerReserve + sizing.safetyReserve, profile.outputLimit, profile.inputPrice, profile.outputPrice);
  return callExternal(store, owner, purpose, {
    provider: profile.protocol, model: profile.model, version: profile.version,
    identity: { id: profile.id, version: profile.version, baseUrl: profile.baseUrl, model: profile.model, protocol: profile.protocol, reasoningEffort: bound.reasoningEffort },
    pricing, currency: profile.currency
  }, body, reserved, signal, async () => {
    options?.onActivity?.('waiting');
    const delta = args[5];
    args[5] = text => { options?.onActivity?.('responding'); delta?.(text); };
    const result = await caller(...args);
    if (!signal.aborted) options?.onActivity?.('checking');
    return result;
  }, (result) => result.usage);
}
