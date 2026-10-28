import { z } from 'zod';
import { creationPlanSchema, type TitleSelection } from './creation';
import type { TagPolicyAssessment, TagPolicyProfile, TagPolicySource } from './tag-policy';

const text = z.string().trim().min(1).max(12000);
const ids = (max = 30) => z.array(z.string().min(1).max(100)).max(max);
export const tagSelectionSchema = z
  .object({
    reading: z.object({ main: z.string().max(100), theme: ids(2), role: ids(2), plot: ids(2) }).strict(),
    content: z.object({ plot: ids(4), emotion: ids(2), persona: ids(4), world: ids(1) }).strict()
  })
  .strict();
export const tagInputSchema = z
  .object({
    selection: tagSelectionSchema,
    premise: z.string().max(20000),
    mustKeep: z.array(text).max(30),
    mustAvoid: z.array(text).max(30)
  })
  .strict();
export type TagInput = z.infer<typeof tagInputSchema>;
export const emptyTagInput = (): TagInput => ({
  selection: {
    reading: { main: '', theme: [], role: [], plot: [] },
    content: { plot: [], emotion: [], persona: [], world: [] }
  },
  premise: '',
  mustKeep: [],
  mustAvoid: []
});
export interface TagOption {
  id: string;
  group: string;
  label: string;
  conceptId: string;
  editorialFlags: string[];
  status: string;
  sourceRef?: string;
  sourceLabel?: string;
  definitionStatus?: string;
}
export interface TagCatalog {
  taxonomyVersion: string;
  counts?: { reading: number; content: number; total: number };
  groups: {
    id: string;
    count: number;
    min: number;
    max: number;
    minimumSource?: string;
    maximumSource?: string;
  }[];
  options: TagOption[];
  provenance: unknown;
  policy?: TagPolicyProfile;
  sources?: TagPolicySource[];
}
export interface BookSpec extends TagInput {
  projectId: string;
  revision: number;
  taxonomyVersion: string;
  preferences: { targetWords: number; pov: string; style: string; constraints: string };
  inputHash: string;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const bookSpecSchema = tagInputSchema
  .extend({
    projectId: text,
    revision: z.number().int().positive(),
    taxonomyVersion: text,
    preferences: z
      .object({
        targetWords: z.number().positive(),
        pov: z.string(),
        style: z.string(),
        constraints: z.string()
      })
      .strict(),
    inputHash: digest
  })
  .strict();
export interface TagKnowledge {
  version: string;
  options: TagOption[];
  genre: unknown;
  cards: unknown[];
  rules: unknown[];
  recipes: unknown[];
  candidates: unknown[];
  coverage: { optionId: string; level: 'genre_draft' | 'detailed_draft' | 'registry_only' }[];
  // Optional so previously approved, hashed knowledge snapshots remain unchanged.
  policy?: TagPolicyAssessment;
}
const coverageSchema = z
  .array(
    z
      .object({
        optionId: text,
        implementation: text,
        firstDemonstration: text,
        risk: text
      })
      .strict()
  )
  .max(30);
export const planningReportSchema = z
  .object({
    positioning: text,
    diagnosis: z
      .array(
        z
          .object({
            code: text,
            severity: z.enum(['note', 'warning', 'needs_confirmation']),
            message: text,
            optionIds: ids(),
            assumptionIds: ids(40)
          })
          .strict()
      )
      .max(50),
    assumptions: z
      .array(z.object({ id: text, text, critical: z.boolean(), directionIds: ids(3) }).strict())
      .max(40),
    directions: z
      .array(
        z
          .object({
            id: text,
            title: text,
            logline: text,
            storyEngine: text,
            differenceFromOtherDirections: text,
            openingDecision: text,
            firstVolumeChange: text,
            longRunRisk: text,
            intentChanges: z.array(text).max(20),
            tagCoverage: coverageSchema
          })
          .strict()
      )
      .length(3),
    recommendedDirectionId: text,
    recommendationReasons: z.array(text).min(1).max(10),
    marketClaims: z.array(text).length(0),
    unresolvedQuestions: z.array(text).max(40)
  })
  .strict();
export type PlanningReport = z.infer<typeof planningReportSchema>;
/** New direction requests omit editorial bookkeeping. Persisted reports retain
 * the established shape so selection, history and contract work stay compatible. */
export const concisePlanningReportSchema = planningReportSchema
  .omit({ diagnosis: true, marketClaims: true, unresolvedQuestions: true })
  .extend({
    directions: z.array(planningReportSchema.shape.directions.element.omit({ tagCoverage: true })).length(3)
  });
export const tagConstraintSchema = z
  .object({
    id: text,
    optionIds: ids(),
    text,
    scope: z
      .object({
        entityIds: ids(),
        fromChapter: z.number().int().nonnegative().nullable(),
        toChapter: z.number().int().nonnegative().nullable()
      })
      .strict(),
    evidenceRef: text
  })
  .strict();
export const contractCandidateSchema = z
  .object({
    directionId: text,
    constraints: z.array(tagConstraintSchema).min(1).max(100),
    tagCoverage: coverageSchema,
    openQuestions: z.array(text).max(40),
    plan: creationPlanSchema.optional(),
    premiseDocument: z.string().min(1).max(120000)
  })
  .strict();
export type ContractCandidate = z.infer<typeof contractCandidateSchema>;
export const planningReviewSchema = z
  .object({
    issues: z
      .array(
        z
          .object({
            code: text,
            severity: z.enum(['blocker', 'major', 'minor']),
            jsonPointer: z.string().max(500),
            explanation: text,
            suggestedFix: text
          })
          .strict()
      )
      .max(60)
  })
  .strict();
export type PlanningReview = z.infer<typeof planningReviewSchema>;
export interface CreationContract extends Omit<ContractCandidate, 'constraints'> {
  planHash?: string;
  effectiveFromChapter?: number;
  constraints: (ContractCandidate['constraints'][number] & { authorConfirmed: true })[];
  revision: number;
  inputHash: string;
  knowledgeVersion: string;
  approval: { runId: string; proposalHash: string; at: string; actor: 'local-author' };
  resolutions: Record<string, string>;
}
export interface ApprovedTags {
  spec: BookSpec;
  knowledge: TagKnowledge;
  contract: CreationContract;
}
export const creationContractSchema = contractCandidateSchema
  .extend({
    planHash: digest.optional(),
    effectiveFromChapter: z.number().int().positive().optional(),
    constraints: z
      .array(tagConstraintSchema.extend({ authorConfirmed: z.literal(true) }).strict())
      .min(1)
      .max(100),
    revision: z.number().int().positive(),
    inputHash: digest,
    knowledgeVersion: digest,
    approval: z
      .object({ runId: text, proposalHash: digest, at: text, actor: z.literal('local-author') })
      .strict(),
    resolutions: z.record(z.string(), text)
  })
  .strict();
export interface TagPlanning {
  workflowVersion?: 2;
  /** Absent on existing tasks: keep their original prompt and output contract. */
  directionFormatVersion?: 1;
  planApproval?: { hash: string; planHash: string; binding: string; at: string };
  titleSelection?: TitleSelection;
  binding: string;
  promptHashes: Record<string, string>;
  spec: BookSpec;
  knowledge: TagKnowledge;
  phase: 'planning' | 'reviewing_report' | 'awaiting_direction' | 'contract' | 'reviewing_contract' | 'ready';
  report?: PlanningReport;
  reportHash?: string;
  candidate?: ContractCandidate;
  authorRevision?: { instruction: string; original: ContractCandidate };
  /** Legacy direction-review record; retained for history, never a selection gate. */
  reportReview?: { hash: string; binding: string; result: PlanningReview };
  contractReview?: { hash: string; binding: string; result: PlanningReview };
  selectedDirectionId?: string;
  resolutions: Record<string, string>;
  semanticRevisions: number;
  formatRepairs: number;
  consecutiveFormatFailures?: number;
  repair?: { phase: 'planning' | 'contract'; original: PlanningReport | ContractCandidate; pointers: string[] };
  regenerate?: {
    directionId: string;
    instruction: string;
    original: PlanningReport;
    keepDirectionIds?: string[];
  };
  origin: 'new' | 'adoption' | 'revision';
  history: { kind: string; value: unknown }[];
}
export const tagGroupNames: Record<string, string> = {
  'reading.main': '阅读 · 主分类',
  'reading.theme': '阅读 · 主题',
  'reading.role': '阅读 · 角色',
  'reading.plot': '阅读 · 情节',
  'content.plot': '内容 · 情节',
  'content.emotion': '内容 · 情感',
  'content.persona': '内容 · 人设',
  'content.world': '内容 · 世界观'
};
export const planningPhaseNames: Record<TagPlanning['phase'], string> = {
  planning: '生成三个方向',
  reviewing_report: '正在整理已有方向',
  awaiting_direction: '等待你确认方向',
  contract: '正在整理设定方案',
  reviewing_contract: '正在检查设定方案',
  ready: '等待你确认结果'
};
