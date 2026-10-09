import registry from './official-model-limits.json';
import { modelLimitsSchema, type ModelLimits, type Profile, type Protocol } from './types';

// Exact, documented IDs only. Never infer a new snapshot or vendor alias from a prefix.
export function officialModelLimits(model: string, protocol: Protocol): ModelLimits | null {
  if (protocol === 'images') return null;
  const row = registry.find((r) => r.models.includes(model));
  return row ? modelLimitsSchema.parse({ ...row, model }) : null;
}

export function applyModelLimits<T extends Profile>(p: T, spec: ModelLimits | null): T {
  if (p.protocol === 'images') return { ...p, modelLimits: null };
  if (p.limitMode !== 'official') return { ...p, modelLimits: spec?.model === p.model ? spec : null };
  return spec && spec.model === p.model
    ? {
        ...p,
        contextLimit: spec.contextLimit,
        inputLimit: spec.inputLimit,
        outputLimit: spec.outputLimit,
        modelLimits: spec
      }
    : { ...p, modelLimits: null };
}

// Gemini declares independent input/output caps. Its displayed total is a local
// budgeting sum, not an invented official shared context-window specification.
export function inputTokenBudget(p: Profile): number {
  return Math.min(p.contextLimit - p.outputLimit, p.inputLimit ?? Infinity);
}

export function requireModelLimits(p: Profile) {
  if (p.protocol !== 'images' && p.limitMode === 'official' && !p.modelLimits)
    throw new Error(`${p.model} 尚未核实官方上限。请刷新模型列表，或切换为手动配置后填写供应商确认的容量。`);
}
