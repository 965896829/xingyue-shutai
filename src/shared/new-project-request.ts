import type { CommandInput } from './contracts';
import type { TagInput } from './tags';

export type OpeningMode = 'planning' | 'existing';

/** Keep the original Skill entry point available when the author already has a full setting. */
export function newProjectRequest(input: {
  mode: OpeningMode;
  parent: string;
  premise: string;
  title: string;
  profileId: string;
  previewEnabled?: boolean;
  capacity: { targetWords: number; chapterWords: number; minWords: number; maxWords: number };
  creationInput: TagInput;
}): CommandInput<'project.create'> {
  return {
    parent: input.parent,
    premise: input.premise,
    config: { ...input.capacity, defaultProfileId: input.profileId, preview: { enabled: input.previewEnabled ?? false, maxCalls: 8 } },
    ...(input.mode === 'existing'
      ? { title: input.title.trim() || undefined }
      : { creationInput: input.creationInput })
  };
}
