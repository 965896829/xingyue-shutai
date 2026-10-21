import { z } from 'zod';

const note = z.string().trim().min(1).max(1200);

/** Dated editorial observations of public title text; never platform policy or story canon. */
export const titleStyleProfileSchema = z.object({
  version: z.string().trim().min(1).max(80),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: note,
  examples: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    url: z.string().regex(/^https:\/\/fanqienovel\.com\/page\/\d+$/),
    patternNote: note
  }).strict()).min(1).max(12),
  principles: z.array(note).min(1).max(12)
}).strict();

export type TitleStyleProfile = z.infer<typeof titleStyleProfileSchema>;
