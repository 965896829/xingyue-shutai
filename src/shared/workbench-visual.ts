import { z } from 'zod';
import { memoryScopeSchema } from './studio';
import { projectionSourceSchema } from './manuscript-view';

const key = z.string().min(1).max(500);
const text = z.string().max(12000);
const source = projectionSourceSchema.extend({ snapshotId: z.string().optional() });
const chapter = z.number().int().min(1).max(100000);
export const plotSceneSchema = z.strictObject({
  id: key,
  chapter,
  title: key,
  goal: text,
  obstacle: text,
  choice: text,
  outcome: text,
  promise: text,
  storyTime: text,
  protected: z.boolean().default(false)
});
export const plotLinkSchema = z.strictObject({
  id: key,
  from: key,
  to: key,
  kind: z.enum(['causes', 'requires', 'reveals', 'echoes']),
  label: z.string().min(1).max(2000),
  nonlinear: z.boolean().default(false)
});
export const plotDocumentSchema = z.strictObject({
  version: z.literal(1),
  scenes: z.array(plotSceneSchema).max(10000),
  links: z.array(plotLinkSchema).max(20000)
});
export const plotNodeSchema = z.strictObject({
  id: key,
  parentId: key.nullable(),
  level: z.enum(['project', 'volume', 'chapter', 'scene']),
  title: key,
  chapter: chapter.optional(),
  endChapter: chapter.optional(),
  track: z.enum(['saved', 'plan']),
  goal: text,
  obstacle: text,
  choice: text,
  outcome: text,
  promise: text,
  storyTime: text,
  sources: z.array(source),
  editable: z.boolean(),
  sceneId: key.optional()
});
export const plotViewSchema = z.strictObject({
  nodes: z.array(plotNodeSchema),
  links: z.array(plotLinkSchema),
  baseHash: z.string().nullable(),
  document: plotDocumentSchema.nullable()
});
export const plotMutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('scene'), scene: plotSceneSchema }),
  z.strictObject({ kind: z.literal('deleteScene'), id: key }),
  z.strictObject({ kind: z.literal('link'), link: plotLinkSchema }),
  z.strictObject({ kind: z.literal('deleteLink'), id: key })
]);
export const reorderIssueSchema = z.strictObject({
  id: key,
  objectId: key.optional(),
  category: z.enum(['knowledge', 'hook', 'item', 'character', 'causality', 'source']),
  severity: z.enum(['review', 'error']),
  message: text,
  from: chapter.optional(),
  to: chapter.optional(),
  sources: z.array(source)
});
export const reorderDecisionSchema = z.strictObject({
  issueId: key,
  action: z.enum(['nonlinear', 'revise']),
  reason: z.string().min(2).max(2000)
});
export const reorderPreviewSchema = z.strictObject({
  projectId: key,
  snapshotId: key,
  fingerprint: key,
  before: z.array(chapter),
  after: z.array(chapter),
  requiresRevision: z.boolean(),
  issues: z.array(reorderIssueSchema),
  paths: z.array(key),
  coverage: z.array(z.strictObject({ category: key, records: z.number().int().nonnegative() }))
});
export const workbenchCandidateSchema = z.strictObject({
  version: z.literal(1),
  projectId: key,
  snapshotId: key,
  kind: z.enum(['field', 'plot', 'world', 'media', 'reorder']),
  objectIds: z.array(key),
  groups: z.array(z.strictObject({ id: key, title: key, paths: z.array(key), objectIds: z.array(key) })),
  sourceHashes: z.record(z.string(), z.string().nullable()),
  fieldTargets: z.array(z.strictObject({ objectId: key, fieldId: key, path: key })).optional(),
  reorder: z
    .strictObject({
      before: z.array(chapter),
      after: z.array(chapter),
      fingerprint: key,
      decisions: z.array(reorderDecisionSchema)
    })
    .optional()
});
export const candidateViewSchema = z.strictObject({
  id: key,
  title: text,
  fingerprint: key,
  stale: z.boolean(),
  requiresRevision: z.boolean(),
  atomic: z.boolean(),
  groups: z.array(
    z.strictObject({
      id: key,
      title: key,
      paths: z.array(key),
      objectIds: z.array(key),
      changes: z.array(z.strictObject({ path: key, before: z.string(), after: z.string() }))
    })
  )
});
export const stateHistorySchema = z.strictObject({
  projectId: key,
  snapshotId: key,
  objectId: key,
  changes: z.array(
    z.strictObject({
      id: key,
      chapter: z.number().int().nonnegative(),
      storyTime: text,
      label: key,
      value: text,
      kind: key,
      state: key,
      source
    })
  ),
  comparison: z
    .strictObject({
      snapshotId: key,
      revision: z.number().int(),
      fields: z.array(
        z.strictObject({ label: key, before: z.string().nullable(), after: z.string().nullable() })
      )
    })
    .nullable()
});
export const workbenchMediaSchema = z.strictObject({
  objectId: key,
  entityId: key.optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  name: key,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  revealedAt: z.number().int().nonnegative().nullable()
});
export const workbenchMediaDocumentSchema = z.strictObject({
  version: z.literal(1),
  avatars: z.array(workbenchMediaSchema).max(10000)
});
export const workbenchScopeBindingSchema = z.strictObject({
  projectId: key,
  snapshotId: key,
  scope: memoryScopeSchema
});
export type PlotDocument = z.infer<typeof plotDocumentSchema>;
export type PlotNode = z.infer<typeof plotNodeSchema>;
export type PlotView = z.infer<typeof plotViewSchema>;
export type PlotMutation = z.infer<typeof plotMutationSchema>;
export type ReorderIssue = z.infer<typeof reorderIssueSchema>;
export type ReorderDecision = z.infer<typeof reorderDecisionSchema>;
export type ReorderPreview = z.infer<typeof reorderPreviewSchema>;
export type WorkbenchCandidate = z.infer<typeof workbenchCandidateSchema>;
export type WorkbenchScopeBinding = z.infer<typeof workbenchScopeBindingSchema>;
export type CandidateView = z.infer<typeof candidateViewSchema>;
export type StateHistory = z.infer<typeof stateHistorySchema>;
