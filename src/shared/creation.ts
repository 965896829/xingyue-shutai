import { z } from 'zod';
import type { ProjectState } from './types';

const text = z.string().trim().min(1).max(6000);
const ids = z.array(z.string().min(1).max(100)).max(40);
export const planKinds = {
  reader_promise: '核心阅读承诺',
  fusion_causality: '元素分工与融合因果',
  protagonist: '主角身份与行动方式',
  stage_goal: '阶段目标',
  long_term_goal: '长期方向',
  advantage_and_limits: '优势、代价与能力边界',
  story_loop: '持续剧情机制',
  escalation: '阶段变化',
  opening: '开篇卖点展示',
  boundaries: '情绪、感情线与内容边界'
} as const;
export const payoffStages = {
  opening: '开篇',
  stage: '阶段成果',
  long_term: '长期方向',
  ongoing: '持续适用'
} as const;
export const creationPlanSchema = z
  .object({
    statements: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            kind: z.enum(Object.keys(planKinds) as [keyof typeof planKinds, ...(keyof typeof planKinds)[]]),
            text,
            optionIds: ids,
            sourceRefs: ids,
            payoffStage: z.enum(['opening', 'stage', 'long_term', 'ongoing'])
          })
          .strict()
      )
      .min(10)
      .max(60),
    tagRoles: z
      .array(
        z
          .object({
            optionId: z.string().min(1).max(100),
            roles: z
              .array(z.enum(['world', 'action', 'conflict', 'advantage', 'cast', 'emotion', 'romance']))
              .min(1)
              .max(7),
            implementation: text,
            claimIds: ids
          })
          .strict()
      )
      .max(30)
  })
  .strict();
export type CreationPlan = z.infer<typeof creationPlanSchema>;

export const titleRules = {
  local: { label: '本地作品名', maxCharacters: 80, source: '本地显示与保存限制', checkedAt: '2026-10-16' },
  fanqie_experiment: {
    label: '番茄多书名实验',
    maxCharacters: 15,
    source: 'https://fanqienovel.com/writer/zone/article/7187613183626969147',
    checkedAt: '2026-10-16'
  }
} as const;
export const titleCandidateSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(160),
    angle: text,
    readerPromise: text,
    supportingClaimIds: ids.min(1),
    payoffStage: z.enum(['opening', 'stage', 'long_term', 'ongoing']),
    riskNotes: z.array(text).max(10)
  })
  .strict();
export type TitleCandidate = z.infer<typeof titleCandidateSchema>;
export const titleBatchSchema = z
  .object({
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    candidates: z.array(titleCandidateSchema).min(1).max(12),
    recommendedIds: ids.min(1).max(3)
  })
  .strict();
export type TitleBatch = z.infer<typeof titleBatchSchema>;
export const titleReviewSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            candidateId: z.string().min(1).max(100),
            verdict: z.enum(['keep', 'revise', 'reject']),
            reason: text
          })
          .strict()
      )
      .min(1)
      .max(12)
  })
  .strict();
export type TitleReview = z.infer<typeof titleReviewSchema>;
export interface TitleSelection {
  candidate: TitleCandidate;
  batchRunId: string;
  batchHash: string;
  planHash: string;
  sourceHash: string;
  rule: keyof typeof titleRules;
  at: string;
}
export interface AcceptedTitle extends TitleSelection {
  needsReview: boolean;
  reason?: string;
}
export interface TitlePlanning {
  sourceRunId?: string;
  planHash: string;
  sourceHash: string;
  inputHash: string;
  contractRevision?: number;
  rule: keyof typeof titleRules;
  manualTitle?: string;
  instruction: string;
  phase: 'generating' | 'reviewing' | 'ready';
  batch?: TitleBatch;
  review?: { hash: string; result: TitleReview };
  regenerate?: { candidateId: string; instruction: string; original: TitleBatch };
  history: { batch: TitleBatch; review?: TitleReview }[];
  formatRepairs: number;
  semanticRevisions: number;
}

/** New projects have one authority. Legacy snapshots retain their original tag record. */
export function approvedCreation(p: Pick<ProjectState, 'creation' | 'tags'>) {
  return p.creation ?? p.tags;
}
