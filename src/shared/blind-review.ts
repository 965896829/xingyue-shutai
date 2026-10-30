import { z } from 'zod';

const key = z.string().trim().min(1).max(300);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();
export const reviewAnnotationSchema = z
  .strictObject({
    alias: z.string().regex(/^[A-F]$/),
    hash: digest,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    coordinateUnit: z.literal('unicode_codepoint'),
    quote: z.string().min(1).max(2000),
    note: z.string().max(2000)
  })
  .refine((v) => v.end > v.start);
export const reviewFeedbackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packetId: digest,
  participant: key,
  origin: z.enum(['human_author', 'human_target_reader', 'model_simulation']),
  recruitment: z.string().max(2000),
  startedAt: timestamp,
  exportedAt: timestamp,
  presentations: z
    .array(z.strictObject({ caseId: key, order: z.array(digest).min(2).max(6) }))
    .min(1)
    .max(100),
  observations: z
    .array(
      z.strictObject({
        caseId: key,
        choice: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'tie', 'both_unsatisfactory', 'abstained']),
        reason: z.string().max(4000),
        nextQuestion: z.string().max(2000),
        reading: z.string().max(4000),
        annotations: z.array(reviewAnnotationSchema).max(20),
        submittedAt: timestamp
      })
    )
    .min(1)
    .max(100)
});
export const reviewPacketSchema = z.strictObject({
  id: digest,
  createdAt: timestamp,
  cases: z
    .array(
      z.strictObject({
        id: key,
        experimentId: key,
        title: key,
        questions: z.array(z.string().min(1).max(12000)).min(1).max(20),
        candidates: z
          .array(z.strictObject({ candidateId: key, text: z.string().min(1).max(12000), hash: digest }))
          .min(2)
          .max(6)
      })
    )
    .min(1)
    .max(100)
});
export const reviewImportSchema = z.strictObject({
  id: key,
  hash: digest,
  packetId: digest,
  participant: key,
  createdAt: timestamp,
  observationIds: z.array(key)
});
export type ReviewFeedback = z.infer<typeof reviewFeedbackSchema>;
export type ReviewPacket = z.infer<typeof reviewPacketSchema>;
export type PublicReviewPacket = {
  packetId: string;
  cases: { id: string; title: string; questions: string[]; candidates: { text: string; hash: string }[] }[];
};
