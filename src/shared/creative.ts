import { z } from 'zod';
import { voiceScopeSchema } from './quality';

export const creativeInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('learn-edits'), evidenceIds: z.array(z.string().min(1)).min(1).max(50) }).strict(),
  z.object({ operation: z.literal('patterns'), chapters: z.array(z.number().int().positive()).min(1).max(12), request: z.string().max(8000).default('') }).strict(),
  z.object({ operation: z.literal('compare-feedback'), experimentId: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('voice-pilot'), prompt: z.string().min(1).max(12000), scope: voiceScopeSchema, protocolId: z.string().optional(), sources: z.array(z.string().min(1)).max(20).default([]) }).strict(),
  z
    .object({
      operation: z.literal('first-read'),
      throughChapter: z.number().int().min(1).max(100000),
      fromChapter: z.number().int().min(1).max(100000).optional(),
      end: z.number().int().positive().optional(),
      displayedTitle: z.string().max(200).default(''),
      displayedDescription: z.string().max(5000).default('')
    })
    .strict(),
  z
    .object({
      operation: z.literal('rehearse'),
      characterId: z.string().min(1).max(200),
      chapter: z.number().int().min(1).max(100000),
      parentRunId: z.string().min(1).optional(),
      observations: z.string().min(1).max(12000)
    })
    .strict(),
  z
    .object({
      operation: z.literal('explore'),
      protocolId: z.string().optional(),
      prompt: z.string().min(1).max(12000),
      preferences: z.string().max(4000).optional(),
      exploration: z.string().max(4000).optional(),
      sources: z.array(z.string().min(1)).max(20).default([])
    })
    .strict()
]);
export type CreativeInput = z.infer<typeof creativeInputSchema>;
export type CreativeOperation = CreativeInput['operation'];
export type CreativeAudience = 'reader_prefix' | 'character_turn' | 'author';
export interface CreativeTask {
  version: 1;
  input: CreativeInput;
  audience: CreativeAudience;
  rulesHash: string;
  packetHash: string;
  audienceHash: string;
  branchId: string;
  snapshotId: string;
  sourceVersions: { path: string; hash: string }[];
  factReadDependency?: import('./workflow').FactReadDependency;
  parentResultHash?: string;
  selectionTrace?: { version: 1; entityId: string; displayName: string; identityBasis: string; snapshotId: string;
    selected: { id: string; kind: string; reason: string; readerRevealed: boolean }[];
    excluded: { id: string; reason: string }[] };
  result?: { content: string; hash: string; createdAt: string; synthetic: true; draftId?: string; turn?: { speech: string; action: string } };
}
export const creativeOperations: {
  id: CreativeOperation;
  title: string;
  audience: CreativeAudience;
  skill: string;
}[] = [
  { id: 'learn-edits', title: '学习编辑偏好', audience: 'author', skill: 'voice-calibration' },
  { id: 'patterns', title: '剧情解法比较', audience: 'author', skill: 'canon-audit' },
  { id: 'compare-feedback', title: '分析试读反馈', audience: 'author', skill: 'reader-feedback' },
  { id: 'voice-pilot', title: '声音试写', audience: 'author', skill: 'voice-calibration' },
  { id: 'first-read', title: '模拟读者首读', audience: 'reader_prefix', skill: 'chapter-review' },
  { id: 'rehearse', title: '人物单回合试演', audience: 'character_turn', skill: 'co-creation' },
  { id: 'explore', title: '探索场景草稿', audience: 'author', skill: 'chapter-draft' }
];
