import { z } from 'zod';
import type { Fact, ProjectState, Change, Usage } from './types';

export interface SnapshotRef {
  id: string;
  projectId: string;
  revision: number;
  createdAt: string;
}
export interface CanonicalSnapshot extends SnapshotRef {
  parentId: string | null;
  project: ProjectState;
  documents: Record<string, string>;
  facts: Fact[];
}
export interface SourceRef {
  path: string;
  hash: string;
  quote: string;
  start?: number;
  end?: number;
  snapshotId?: string;
}
export interface ChangeSet {
  id: string;
  projectId: string;
  baseSnapshotId: string | null;
  payloadHash: string;
  changes: Change[];
  createdAt: string;
  expiresAt: string;
  actor: 'local-author';
  runId?: string;
  scope: string[];
}
export const memoryScopeSchema = z
  .object({
    projectId: z.string().optional(),
    chapter: z.number().int().nonnegative(),
    snapshotId: z.string().optional(),
    mode: z.enum(['current', 'historical']).default('current'),
    viewpoint: z.enum(['author', 'reader', 'character']).default('author'),
    characterId: z.string().optional(),
    worldId: z.string().default('main'),
    timelineId: z.string().default('main')
  })
  .refine((v) => v.viewpoint !== 'character' || !!v.characterId, '请选择视角人物');
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export interface LedgerCoverage {
  ledger: 'timeline' | 'hooks' | 'items' | 'terms' | 'knowledge';
  status: 'covered' | 'irrelevant' | 'missing';
  count: number;
}
export interface EntityState {
  id: string;
  name: string;
  aliases: string[];
  chapter: number;
  snapshotId: string;
  facts: Fact[];
  unknown: string[];
}
export const embeddingSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().default('https://api.openai.com/v1'),
  model: z.string().default(''),
  dimensions: z.number().int().min(1).max(65536).nullable().default(null),
  sendDimensions: z.boolean().default(false),
  inputBudget: z.number().int().min(128).max(1000000).default(8000),
  price: z.number().nonnegative().nullable().default(null),
  currency: z.string().default('USD'),
  dataScope: z.enum(['prose', 'prose-and-memory']).default('prose'),
  timeoutSeconds: z.number().int().min(10).max(300).default(60),
  hasKey: z.boolean().default(false)
});
export type EmbeddingSettings = z.infer<typeof embeddingSettingsSchema>;
export const dimensions = ['pressure', 'payoff', 'emotion', 'revelation', 'relationship'] as const;
export type Dimension = (typeof dimensions)[number];
export interface DraftIdentity {
  projectId: string;
  snapshotId: string;
  draftId: string;
  draftVersion: number;
  hash: string;
  epoch: string;
}
export interface Assessment extends DraftIdentity {
  id: string;
  chapter: number;
  track: 'plan' | 'accepted' | 'candidate';
  rubric: 'narrative-1';
  createdAt: string;
  profileId: string;
  values: Record<Dimension, number | null>;
  evidence: SourceRef[];
  note: string;
  usage: Usage;
  stale?: boolean;
}
export interface StudioState {
  snapshot: SnapshotRef | null;
  snapshots: SnapshotRef[];
  outbox: { id: string; status: string; error: string | null }[];
  assessments: Assessment[];
  index: {
    generation: string;
    status: string;
    watermark: string | null;
    count: number;
    error?: string;
  } | null;
  reviewQueue: { id: string; source: string; dependent: string; status: string }[];
}
