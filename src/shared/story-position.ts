import { z } from 'zod';

export const storyPositionSchema = z.object({
  chapter: z.number().int().nonnegative(),
  scene: z.number().int().positive().optional(),
  event: z.number().int().positive().optional()
}).strict().refine(value => value.event === undefined || value.scene !== undefined, '事件位置需要场景位置');
export type StoryPosition = z.infer<typeof storyPositionSchema>;

/** Missing precision is unknown, never a fabricated ordering within a chapter. */
export function compareStoryPosition(a: StoryPosition, b: StoryPosition): number | undefined {
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  if (a.scene === undefined || b.scene === undefined) return a.scene === b.scene ? 0 : undefined;
  if (a.scene !== b.scene) return a.scene - b.scene;
  if (a.event === undefined || b.event === undefined) return a.event === b.event ? 0 : undefined;
  return a.event - b.event;
}
