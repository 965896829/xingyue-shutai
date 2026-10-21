import { ApplicationError } from '../shared/errors';
import { validateReasoning, type ReasoningSelection } from '../shared/reasoning';
import type { Profile } from '../shared/types';
import { connectionFields, modelExecutionFields } from '../shared/provider-groups';

export function sameModelExecution(left: Profile, right: Profile) {
  const shape = (profile: Profile) => ({
    ...connectionFields(profile),
    ...modelExecutionFields(profile),
    enabled: profile.enabled
  });
  return JSON.stringify(shape(left)) === JSON.stringify(shape(right));
}

export function updateReasoningPreference<T extends Profile>(
  profile: T,
  effort: ReasoningSelection,
  expectedVersion: number,
  expectedRevision: number
): T {
  if (profile.version !== expectedVersion || (profile.reasoningRevision ?? 0) !== expectedRevision)
    throw new ApplicationError('VERSION_CONFLICT', '模型设置已在另一处修改，请重新打开模型选择器后再试。', [
      'refresh'
    ]);
  validateReasoning({ ...profile, reasoningEffort: effort });
  if ((profile.reasoningEffort ?? null) === effort) return profile;
  return { ...profile, reasoningEffort: effort, reasoningRevision: expectedRevision + 1 };
}

export function checkReasoningRevision(incoming: Profile, saved: Profile) {
  if ((incoming.reasoningRevision ?? 0) !== (saved.reasoningRevision ?? 0))
    throw new ApplicationError('VERSION_CONFLICT', '推理强度已在另一处修改，请载入最新模型设置后再保存。', [
      'refresh'
    ]);
}
