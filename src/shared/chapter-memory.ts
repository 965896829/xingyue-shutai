import { z } from 'zod';

export const chapterCoverageSchema = z
  .object({
    schemaVersion: z.literal(1),
    proseHash: z.string().regex(/^[a-f0-9]{64}$/),
    characters: z
      .array(
        z
          .object({
            entityId: z.string().min(1).max(200),
            name: z.string().min(1).max(100),
            outcome: z.enum(['changed', 'reviewed_no_change', 'insufficient_evidence', 'mentioned_only']),
            reason: z.string().min(1).max(2000),
            factIds: z.array(z.string().min(1)).max(100),
            evidence: z
              .array(
                z
                  .object({
                    quote: z.string().min(1),
                    start: z.number().int().nonnegative(),
                    end: z.number().int().positive()
                  })
                  .strict()
              )
              .min(1)
              .max(20)
          })
          .strict()
      )
      .max(200)
  })
  .strict();
export type ChapterCoverage = z.infer<typeof chapterCoverageSchema>;
