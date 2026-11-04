import { z } from 'zod';

export const workflowBindingSchema = z
  .object({
    schemaVersion: z.literal(7),
    kind: z.enum(['creation', 'chapter', 'discussion', 'revision']),
    version: z.literal(1),
    handlerVersion: z.literal(1),
    registry: z.enum(['builtin-26-v1', 'creative-v7-v1', 'scoped-design-v1']),
    contextPolicy: z.enum(['author-v1', 'reader_prefix-v1', 'character_turn-v1']),
    executorId: z.string().min(1),
    executorVersion: z.string().min(1),
    checkpointVersion: z.number().int().positive(),
    budgetOwner: z.string().min(1),
    restorePolicy: z.literal('recorded_versions_only')
  })
  .strict();
export type WorkflowBinding = z.infer<typeof workflowBindingSchema>;

export interface FactReadDependency {
  kind: 'predicate';
  worldId: string;
  timelineId: string;
  hash: string;
  selection?: FactSelection;
}

export interface FactSelection {
  query: string;
  entityIds: string[];
  chapter: number;
  includeFuture?: boolean;
  sourcePaths?: string[];
  textSearch?: boolean;
}
