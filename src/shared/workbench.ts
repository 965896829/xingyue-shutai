import { z } from 'zod';
import { memoryScopeSchema } from './studio';
import { projectionSourceSchema } from './manuscript-view';
import { plotViewSchema, type PlotNode } from './workbench-visual';
import { worldModelSchema } from './quality';

const key = z.string().min(1).max(500);
export const workbenchBindingSchema = z.strictObject({
  projectId: key,
  snapshotId: key,
  objectId: key,
  fieldId: key.optional(),
  scope: memoryScopeSchema
});
export const workbenchFieldSchema = z.strictObject({
  id: key,
  label: key,
  value: z.string(),
  editable: z.boolean(),
  locked: z.boolean(),
  source: projectionSourceSchema.extend({ snapshotId: z.string().optional() }),
  kind: z.string().optional(),
  unrevealed: z.boolean().optional()
});
export const workbenchObjectSchema = z.strictObject({
  id: key,
  title: key,
  kind: z.enum([
    'character',
    'relation',
    'timeline',
    'hook',
    'promise',
    'item',
    'injury',
    'knowledge',
    'term',
    'behavior',
    'fact',
    'world',
    'plot'
  ]),
  entityIds: z.array(key),
  fields: z.array(workbenchFieldSchema),
  track: z.enum(['saved', 'plan']),
  from: z.string().optional(),
  to: z.string().optional(),
  chapter: z.string().optional(),
  storyTime: z.string().optional()
});
export const workbenchViewSchema = z.strictObject({
  projectId: key,
  snapshotId: key,
  revision: z.number().int(),
  scope: memoryScopeSchema,
  editable: z.boolean(),
  objects: z.array(workbenchObjectSchema),
  unavailable: z.array(z.string()),
  plot: plotViewSchema.optional(),
  world: worldModelSchema.optional(),
  worldHash: z.string().optional()
});
export const workbenchLocksSchema = z.array(
  z.strictObject({ objectId: key, fieldId: key, path: key, value: z.string(), label: key })
);
export type WorkbenchBinding = z.infer<typeof workbenchBindingSchema>;
export type WorkbenchField = z.infer<typeof workbenchFieldSchema>;
export type WorkbenchObject = z.infer<typeof workbenchObjectSchema>;
export type WorkbenchView = z.infer<typeof workbenchViewSchema>;
export function plotWorkbenchObject(node: PlotNode): WorkbenchObject {
  return {
    id: node.id,
    title: node.title,
    kind: 'plot',
    entityIds: [],
    track: node.track,
    ...(node.chapter
      ? { chapter: node.endChapter ? `第 ${node.chapter}—${node.endChapter} 章` : `第 ${node.chapter} 章` }
      : {}),
    storyTime: node.storyTime,
    fields: node.sources.length
      ? Object.entries({
          title: node.title,
          goal: node.goal,
          obstacle: node.obstacle,
          choice: node.choice,
          outcome: node.outcome,
          promise: node.promise
        })
          .filter(([, value]) => value)
          .map(([id, value]) => ({
            id,
            label: (
              {
                title: '标题',
                goal: '目标',
                obstacle: '阻力',
                choice: '选择',
                outcome: '结果',
                promise: '承诺'
              } as Record<string, string>
            )[id],
            value,
            source: node.sources[0],
            editable: false,
            locked: false
          }))
      : []
  };
}
