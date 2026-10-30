import type { CommandInput } from './contracts';
import type { TagInput } from './tags';
import { normalizeWritingStyle } from './writing-style';

export type OpeningMode = 'planning' | 'existing';

/** Keep the original Skill entry point available when the author already has a full setting. */
export function newProjectRequest(input: {
  mode: OpeningMode;
  parent: string;
  premise: string;
  title: string;
  profileId: string;
  previewEnabled?: boolean;
  style?: string;
  capacity: { targetWords: number; chapterWords: number; minWords: number; maxWords: number };
  creationInput: TagInput;
}): CommandInput<'project.create'> {
  return {
    parent: input.parent,
    premise: input.premise,
    config: { ...input.capacity, defaultProfileId: input.profileId, preview: { enabled: input.previewEnabled ?? false, maxCalls: 8 },
      ...(input.style !== undefined ? { style: normalizeWritingStyle(input.style) } : {}),
      ...(input.mode === 'existing' && (input.creationInput.mustKeep.length || input.creationInput.mustAvoid.length) ? {
        constraints: [...input.creationInput.mustKeep.map(text => `必须保留：${text}`), ...input.creationInput.mustAvoid.map(text => `不能出现：${text}`)].join('\n')
      } : {}) },
    ...(input.mode === 'existing'
      ? { title: input.title.trim() || undefined, ...(input.creationInput.bookProfile ? { bookProfile: input.creationInput.bookProfile } : {}) }
      : { creationInput: input.creationInput })
  };
}
