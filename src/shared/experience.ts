import { z } from 'zod';
export const maxExperienceChapter = 100000;
const item = z.object({ id: z.string(), text: z.string(), source: z.string(), stale: z.boolean() });
export const experienceSchema = z.object({
  snapshotId: z.string(),
  firstReadPage: z.object({ watermark: z.number().int().nonnegative(), nextBefore: z.number().int().positive().nullable() }).optional(),
  feedback: z.array(item),
  chapters: z.array(z.object({ chapter: z.number(), planned: z.array(item), realized: z.array(item), simulated: z.array(item), feedback: z.array(item) })),
  characters: z.array(z.object({ id: z.string(), name: z.string(), stable: z.array(item), current: z.array(item), experiences: z.array(item).default([]) }))
});
