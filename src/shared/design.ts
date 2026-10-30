import { z } from 'zod';

export const designInputSchema = z
  .object({
    id: z.string().regex(/^[a-z-]+\.[a-z-]+$/),
    request: z.string().max(12000).default(''),
    sources: z.array(z.string().min(1)).max(20).default([]),
    targets: z.array(z.string().min(1)).max(20).default([]),
    chapter: z.number().int().positive().optional(),
    runId: z.string().optional(),
    directionId: z.string().optional(),
    targetKind: z.enum(['book_title', 'entity_name', 'blurb']).optional(),
    feedback: z
      .object({
        source: z.string().min(1),
        window: z.string().min(1),
        sampleSize: z.number().int().nonnegative(),
        synthetic: z.boolean()
      })
      .strict()
      .optional()
  })
  .strict();
export type DesignInput = z.infer<typeof designInputSchema>;
export interface DesignBinding {
  version: 1;
  input: DesignInput;
  promptHash: string;
  targets: { path: string; hash: string | null }[];
  sources: { path: string; hash: string }[];
}
export const designEntrySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    group: z.string(),
    adapter: z.enum(['scoped-task', 'planning', 'title', 'revision-core']),
    targetSelection: z.boolean(),
    targetKind: z.boolean(),
    feedback: z.boolean()
  })
  .strict();
