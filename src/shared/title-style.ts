import { z } from 'zod';
import type { MarketEvidence } from './market-evidence';

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

/** Host-recorded search evidence, separate from the book's confirmed story facts. */
export interface TitleMarketResearch {
  status: 'searching' | 'ready' | 'partial' | 'stale' | 'unavailable' | 'disabled';
  provider: 'native' | 'public' | 'none';
  genre: string;
  tags: string[];
  query: string;
  alternativeQuery?: string;
  startedAt: string;
  checkedAt?: string;
  sources: { title: string; url: string; excerpt?: string }[];
  /** Search model's editorial observations, not official facts or instructions. */
  styleBrief?: string;
  message: string;
  publicEvidence?: MarketEvidence;
}
