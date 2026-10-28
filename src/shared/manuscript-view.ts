import { z } from 'zod';

export const projectionSourceSchema = z.object({ path: z.string(), hash: z.string(), quote: z.string(), start: z.number().optional(), end: z.number().optional() });
const track = z.enum(['saved', 'draft']);
export const projectionFieldSchema = z.object({ label: z.string(), value: z.string(), previous: z.string().optional(), source: projectionSourceSchema, track });
export const projectionCharacterSchema = z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()), fields: z.array(projectionFieldSchema), source: projectionSourceSchema, track });
export const projectionCategories = ['relation', 'timeline', 'hook', 'promise', 'item', 'injury', 'knowledge', 'term', 'behavior', 'fact'] as const;
export const projectionEntrySchema = z.object({ id: z.string(), category: z.enum(projectionCategories), title: z.string(), fields: z.array(projectionFieldSchema), source: projectionSourceSchema, track,
  from: z.string().optional(), to: z.string().optional(), chapter: z.string().optional(), storyTime: z.string().optional(), kind: z.string().optional() });
export const manuscriptViewSchema = z.object({ projectId: z.string(), revision: z.number(), chapter: z.number(), runId: z.string().optional(), draftAvailable: z.boolean(),
  characters: z.array(projectionCharacterSchema), entries: z.array(projectionEntrySchema), unavailable: z.array(z.string()) });
export type ProjectionField = z.infer<typeof projectionFieldSchema>;
export type ProjectionCharacter = z.infer<typeof projectionCharacterSchema>;
export type ProjectionEntry = z.infer<typeof projectionEntrySchema>;
export type ManuscriptView = z.infer<typeof manuscriptViewSchema>;
export const projectionCategoryNames: Record<ProjectionEntry['category'], string> = { relation: '人物关系', timeline: '双时间线', hook: '伏笔', promise: '目标与承诺', item: '物品', injury: '伤势', knowledge: '知情边界', term: '世界规则', behavior: '行动与情绪', fact: '正文记录' };
