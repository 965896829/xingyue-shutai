import { z } from 'zod';
import { publishingChannelSchema } from './publishing';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const category = z.object({ channel: publishingChannelSchema, platformId: z.string().regex(/^\d+$/), label: z.string().min(1).max(100) }).strict();
export const marketRequestSchema = z.object({
  catalogId: digest, channel: publishingChannelSchema, categoryId: z.string().regex(/^\d+$/),
  rankType: z.enum(['new_book', 'reading']).default('reading'),
  referenceCategoryId: z.string().regex(/^\d+$/).optional()
}).strict();
export type MarketRequest = z.infer<typeof marketRequestSchema>;
export const marketEvidenceSchema = z.object({
  id: digest, status: z.enum(['ready', 'partial', 'stale', 'unavailable', 'disabled']), observedAt: z.string(),
  requested: category, effective: category.nullable(), rankType: z.enum(['new_book', 'reading']),
  match: z.enum(['exact', 'nearby', 'none']), reason: z.string(),
  board: z.object({ url: z.string().regex(/^https:\/\/fanqienovel\.com\/rank\/[01]_[12]_\d+$/), sourceHash: digest,
    observedAt: z.string(), statsCutoffRaw: z.string().nullable(), rankVersionRaw: z.string().nullable(),
    totalReported: z.number().int().nonnegative().nullable(), itemsFetched: z.number().int().nonnegative(), fullRankCoverage: z.boolean()
  }).strict().nullable(),
  samples: z.array(z.object({
    id: z.string(), bookId: z.string().regex(/^\d+$/), title: z.string().max(160).nullable(),
    url: z.string().regex(/^https:\/\/fanqienovel\.com\/page\/\d+$/), rankPosition: z.number().int().positive(),
    titleSource: z.object({ kind: z.literal('official_book_detail_title'), sourceHash: digest, observedAt: z.string() }).strict().nullable(),
    readCount: z.object({ value: z.number().nonnegative(), sourceField: z.literal('rank.book_list[].read_count') }).strict().nullable(),
    wordCount: z.number().nonnegative().nullable(), statusRaw: z.string().nullable(),
    firstPublishedAt: z.string().nullable(), missing: z.array(z.string()).max(10)
  }).strict()).max(10),
  sampleSelections: z.array(z.object({ sampleId: z.string(), relation: z.enum(['exact', 'nearby']), reason: z.string() }).strict()).max(10),
  limitations: z.array(z.string()).max(10)
}).strict();
export type MarketEvidence = z.infer<typeof marketEvidenceSchema>;
