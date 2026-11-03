import { z } from 'zod';
import { storyPositionSchema, compareStoryPosition } from './story-position';
import { reasoningEffortSchema, type ReasoningSnapshot } from './reasoning';
import { defaultWritingStyle } from './writing-style';

export const stageIds = [
  'S01',
  'S02',
  'S03',
  'S04',
  'S05',
  'S06',
  'S07',
  'S08',
  'S09',
  'S10',
  'S11'
] as const;
export type StageId = (typeof stageIds)[number];
export const configSchema = z
  .object({
    targetWords: z.number().int().positive().default(3_000_000),
    chapterWords: z.number().int().positive().default(2500),
    minWords: z.number().int().positive().default(2300),
    maxWords: z.number().int().positive().default(2700),
    batchSize: z.number().int().positive().default(30),
    pov: z.string().min(1).default('第三人称'),
    genre: z.string().default('脑洞玄幻'),
    style: z.string().default(defaultWritingStyle),
    constraints: z.string().default(''),
    expressionRules: z
      .object({
        enabled: z.boolean().default(true),
        modules: z
          .array(z.string().regex(/^[A-Z]+$/))
          .max(145)
          .default([])
      })
      .default({ enabled: true, modules: [] }),
    recentChapters: z.number().int().min(1).max(30).default(3),
    defaultProfileId: z.string().default(''),
    stageProfiles: z.record(z.string(), z.string()).default({}),
    modelRouting: z
      .object({
        writing: z.string().default(''),
        extraction: z.string().default(''),
        review: z.string().default('')
      })
      .default({ writing: '', extraction: '', review: '' }),
    preview: z
      .object({ enabled: z.boolean().default(true), maxCalls: z.number().int().min(0).max(30).default(8) })
      .default({ enabled: true, maxCalls: 8 }),
    viewpointCharacterId: z.string().default(''),
    proseMode: z.enum(['chapter', 'scene']).default('chapter'),
    maxRounds: z.number().int().min(1).max(100).default(12),
    maxTools: z.number().int().min(1).max(500).default(64),
    stageBudget: z.number().nonnegative().nullable().default(null),
    terminalPolicy: z.enum(['ask', 'disabled']).default('ask'),
    networkPolicy: z.enum(['ask', 'disabled']).default('ask'),
    backupDirectory: z.string().default('')
  })
  .refine(
    (v) => v.minWords <= v.chapterWords && v.chapterWords <= v.maxWords,
    '章长必须位于最少与最多字数之间'
  );
export type ProjectConfig = z.infer<typeof configSchema>;
export const protocolSchema = z.enum(['chat', 'responses', 'anthropic', 'gemini', 'images']);
export type Protocol = z.infer<typeof protocolSchema>;
export const modelLimitsSchema = z
  .object({
    model: z.string().min(1),
    contextLimit: z.number().int().min(1024).max(10_000_000),
    inputLimit: z.number().int().min(1024).max(10_000_000).nullable(),
    outputLimit: z.number().int().min(128).max(1_000_000),
    windowKind: z.enum(['shared', 'separate']),
    source: z.string().url(),
    checkedAt: z.string(),
    origin: z.enum(['official-docs', 'official-api']),
    note: z.string().optional()
  })
  .refine((v) => v.outputLimit < v.contextLimit && (v.inputLimit === null || v.inputLimit <= v.contextLimit));
export type ModelLimits = z.infer<typeof modelLimitsSchema>;
export const contextPolicySchema = z.object({
  tokenizer: z.enum(['auto', 'o200k_base', 'cl100k_base', 'conservative']).default('auto'),
  effectiveInputLimit: z.number().int().min(1024).max(10_000_000).nullable().default(null),
  providerOverhead: z.number().int().min(0).max(65536).default(256),
  safetyRatio: z.number().min(0.01).max(0.3).default(0.03),
  safetyTokens: z.number().int().min(64).max(65536).default(256),
  toolResultReserve: z.number().int().min(0).max(65536).default(2048)
});
export const profileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    connectionId: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    protocol: protocolSchema,
    baseUrl: z.string().url(),
    model: z.string().min(1),
    contextLimit: z.number().int().min(1024).max(10_000_000).default(128000),
    outputLimit: z.number().int().min(128).max(1_000_000).default(8192),
    inputLimit: z.number().int().min(1024).max(10_000_000).nullable().default(null),
    limitMode: z.enum(['official', 'manual']).default('manual'),
    modelLimits: modelLimitsSchema.nullable().default(null),
    stream: z.boolean().default(true),
    responsesTransport: z.enum(['http', 'websocket']).optional(),
    tools: z.boolean().default(true),
    temperature: z.number().min(0).max(2).nullable().default(null),
    reasoningEffort: reasoningEffortSchema.nullable().optional(),
    reasoningRevision: z.number().int().nonnegative().optional(),
    inputPrice: z.number().nonnegative().nullable().default(null),
    outputPrice: z.number().nonnegative().nullable().default(null),
    currency: z.string().default('USD'),
    timeoutSeconds: z.number().int().min(10).max(1800).default(180),
    networkRecovery: z.object({
      maxRetries: z.number().int().min(0).max(3).default(2),
      retryUnknown: z.boolean().default(false)
    }).optional(),
    proxy: z.string().default(''),
    headers: z.record(z.string(), z.string()).default({}),
    version: z.number().int().positive().default(1),
    hasKey: z.boolean().default(false),
    capabilities: z.record(z.string(), z.enum(['unknown', 'verified', 'failed'])).default({}),
    imageSize: z.string().default('1024x1536'),
    imageQuality: z.string().default('auto'),
    contextPolicy: contextPolicySchema.optional()
  })
  .refine((v) => v.outputLimit < v.contextLimit, '输出上限必须小于上下文容量')
  .refine((v) => v.inputLimit === null || v.inputLimit <= v.contextLimit, '输入上限不能大于上下文容量');
export type Profile = z.infer<typeof profileSchema>;
export type SecretProfile = Profile & { apiKey: string };
export interface ModelCatalogEntry {
  id: string;
  name: string;
  owner: string;
  limits?: ModelLimits;
}
export interface ModelCatalog {
  models: ModelCatalogEntry[];
  truncated: boolean;
}
export interface Batch {
  id: string;
  start: number;
  end: number;
  sizeAtCreation: number;
}
export interface ProjectState {
  id: string;
  title: string;
  titlePending?: boolean;
  root: string;
  schemaVersion: 1 | 2 | 3;
  creationWorkflow?: 2;
  creation?: import('./tags').ApprovedTags;
  titleBinding?: import('./creation').AcceptedTitle;
  titleReviewRequired?: boolean;
  tagEnabled?: boolean;
  tags?: import('./tags').ApprovedTags;
  revision: number;
  createdAt: string;
  config: ProjectConfig;
  stage: StageId;
  chapter: number;
  batches: Batch[];
  completed: Record<string, string>;
  chapters: Record<string, 'prose_accepted_pending_aftermath' | 'complete' | 'stale'>;
  finished: boolean;
  stale: string[];
  storyImpacts?: import('./continuity').StoryImpact[];
  chapterStatesBeforeReview?: Record<string, 'prose_accepted_pending_aftermath' | 'complete'>;
  acceptedImport: boolean;
}
export interface DocumentInfo {
  id: string;
  path: string;
  hash: string | null;
  acceptedHash: string | null;
  status: 'accepted' | 'external' | 'new' | 'missing';
  bytes: number;
}
export interface Change {
  path: string;
  content: string;
  baseHash: string | null;
}
export interface Issue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  line?: number;
  factId?: string;
}
export const evidenceSchema = z.object({
  path: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  quote: z.string().min(1),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  snapshotId: z.string().optional()
});
export const factSchema = z
  .object({
    id: z.string().min(1),
    subject: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    predicate: z.string().min(1),
    value: z.string().min(1),
    kind: z.enum(['event', 'state', 'world_rule', 'author_constraint', 'plan', 'belief', 'inference', 'expression_sample']),
    characterLayer: z.enum(['stable', 'current', 'experience']).optional(),
    subjectiveResponse: z.object({
      trigger: z.string().max(2000).optional(), interpretation: z.string().max(2000).optional(),
      emotionOrIntent: z.string().max(2000).optional(), actionEffect: z.string().max(2000).optional()
    }).optional(),
    category: z.enum([
      'character',
      'relation',
      'timeline',
      'hook',
      'item',
      'injury',
      'term',
      'knowledge',
      'promise'
    ]),
    state: z.enum(['active', 'resolved', 'superseded', 'disputed']).default('active'),
    reviewStatus: z.enum(['candidate', 'accepted', 'disputed', 'retracted']).default('candidate'),
    fromChapter: z.number().int().min(0),
    toChapter: z.number().int().min(0).nullable().default(null),
    fromPosition: storyPositionSchema.optional(),
    untilPosition: storyPositionSchema.optional(),
    storyTime: z.string().default('未知'),
    revealedAt: z.number().int().min(0),
    knowledge: z
      .array(
        z.object({
          who: z.string(),
          mode: z.enum(['seen', 'told', 'inferred', 'misunderstood', 'unknown']),
          fromChapter: z.number().int().min(0),
          fromPosition: storyPositionSchema.optional()
        })
      )
      .default([]),
    evidence: z.array(evidenceSchema).min(1),
    supersedes: z.string().nullable().default(null),
    mandatory: z.boolean().default(false),
    scope: z.enum(['entity', 'global']).default('entity'),
    entityIds: z.array(z.string()).default([]),
    worldId: z.string().default('main'),
    timelineId: z.string().default('main'),
    relatedIds: z.array(z.string()).default([]),
    replacementReason: z.string().default(''),
    acceptedAt: z.string().optional(),
    acceptedRunId: z.string().optional(),
    planRefs: z.object({
      inputHash: z.string().regex(/^[a-f0-9]{64}$/), contractRevision: z.number().int().positive(),
      planHash: z.string().regex(/^[a-f0-9]{64}$/), claimIds: z.array(z.string().min(1)).min(1).max(60)
    }).strict().optional(),
    tagRefs: z
      .object({
        inputHash: z.string().regex(/^[a-f0-9]{64}$/),
        contractRevision: z.number().int().positive(),
        optionIds: z.array(z.string().min(1)).min(1).max(30),
        constraintIds: z.array(z.string().min(1)).max(100)
      })
      .strict()
      .optional()
  })
  .refine((v) => v.toChapter === null || v.toChapter >= v.fromChapter, '记忆有效范围不能倒置')
  .refine(v => !v.fromPosition || v.fromPosition.chapter === v.fromChapter, '记忆起点与章节不一致')
  .refine(v => !v.untilPosition || v.toChapter === null || v.untilPosition.chapter <= v.toChapter, '记忆结束位置超出有效章节')
  .refine(v => !v.untilPosition || (compareStoryPosition(v.fromPosition ?? { chapter: v.fromChapter }, v.untilPosition) ?? -1) < 0, '记忆结束位置必须晚于起点')
  .refine(v => v.knowledge.every(k => !k.fromPosition || k.fromPosition.chapter === k.fromChapter), '获知位置与章节不一致');
export type Fact = z.infer<typeof factSchema>;
export interface ContextSource {
  layer?: 'author_rules' | 'chapter_plan' | 'character_knowledge' | 'prose' | 'summary';
  ranges?: { start: number; end: number }[];
  category?: 'author_instruction' | 'plan' | 'formal_fact' | 'accepted_prose' | 'derived_summary' | 'external_reference';
  sourceSnapshotId?: string;
  path: string;
  hash: string;
  reason: string;
  content: string;
  required: boolean;
  mode: 'full' | 'excerpt';
}
export interface ContextManifest {
  readPlan?: import('./context-reading').ContextReadPlan;
  writingMaterials?: import('./scene-material').WritingMaterials;
  qualityReadHash?: string;
  voicePreferences?: { scope: import('./quality').VoiceScope; statement: string; exceptions: string[]; samples?: { kind: 'expression_sample'; text: string; source: { path: string; hash: string }; instruction: string }[] }[];
  factReadDependency?: import('./workflow').FactReadDependency;
  projectId?: string;
  inputHash?: string;
  selectedBy?: 'legacy-context-v4' | 'context-compiler-v1';
  purpose?: 'stage' | 'revision' | 'draft' | 'discussion';
  scope?: import('./studio').MemoryScope;
  entityIds?: string[];
  hardConstraints?: Fact[];
  requiredFactIds?: string[];
  revelation?: {
    allowed: string[];
    withheld: { id: string; subject: string; predicate: string; value: string; revealedAt: number; reason: string; evidence: import('./studio').SourceRef[] }[];
    characterUnknown: string[];
  };
  budget?: {
    method: 'o200k_base' | 'cl100k_base' | 'utf8_upper_bound';
    inputBytes: number;
    modelInputLimit: number;
    effectiveInputLimit: number;
    outputReserve: number;
    providerReserve: number;
    safetyReserve: number;
    toolReserve: number;
    residentTokens: number;
    effectiveLimitSource: 'model' | 'configured';
  };
  snapshotId?: string;
  coverage?: import('./studio').LedgerCoverage[];
  retrievedFacts?: Fact[];
  disputedFacts?: Fact[];
  id: string;
  projectRevision: number;
  chapter: number;
  stage: StageId;
  sources: ContextSource[];
  /** Source versions used for local comparisons; their full text is not sent. */
  referenceSources?: { path: string; hash: string; reason: 'editorial-comparison' | 'mechanism-comparison' }[];
  factIds: string[];
  conflicts: string[];
  estimatedTokens: number;
  availableTokens: number;
  createdAt: string;
  omitted?: { path: string; reason: string }[];
  assemblyVersion?: string;
}
export type RunStatus =
  | 'running'
  | 'awaiting_review'
  | 'needs_repair'
  | 'paused'
  | 'unknown'
  | 'stale'
  | 'failed'
  | 'committing'
  | 'complete'
  | 'discarded'
  | 'awaiting_input'
  | 'awaiting_permission';
export interface Run {
  taskScope?: import('./task-scope').TaskScope;
  revisionCoreRequired?: 1;
  revisionCore?: { version: 1; sourceRunId: string; chapters: number[]; proseHashes: Record<string, string>; coverage: Record<string, import('./chapter-memory').ChapterCoverage>; reports: Record<string, string>; phase: 'extract' | 'review' | 'ready' };
  worldContract?: 1 | 2;
  workflowVersion?: 1;
  workflowBinding?: import('./workflow').WorkflowBinding;
  chapterCoverage?: import('./chapter-memory').ChapterCoverage;
  creative?: import('./creative').CreativeTask;
  design?: import('./design').DesignBinding;
  contextUsage?: import('./context-meter').ContextUsage;
  contextCompactions?: import('./context-meter').ContextCompaction[];
  activity?: import('./generation').GenerationActivity;
  /** Derived for display by the host; never used to advance or time out a task. */
  creationTiming?: import('./creation-progress').CreationTiming;
  webSearch?: import('./web-search').NativeWebSearchState;
  stateVersion?: number;
  projectId?: string;
  operationId?: string;
  executorId?: string;
  executorVersion?: string;
  executionId?: string;
  checkpointVersion?: number;
  cancelRequestedAt?: string;
  parentRunId?: string;
  workbench?: import('./workbench-visual').WorkbenchCandidate;
  agentRulesHash?: string;
  repairAttempts?: Record<string, number>;
  networkRetries?: number;
  repairScope?: import('./recovery').CandidateRepair;
  proseReviewFeedback?: { review: Change; proseHash: string };
  proseIntent?: 'draft' | 'rewrite' | 'revision' | 'continue';
  failure?: import('./errors').ErrorPayload;
  memoryReview?: { fingerprint: string; issues: string[]; targets?: Issue[]; sources?: { path: string; hash: string }[] };
  /** Explicit extractor completion, bound to the complete candidate and fact set. */
  memoryCompletionHash?: string;
  futurePlanReview?: {
    fingerprint: string;
    decisions: { path: string; hash: string; verdict: 'consistent' | 'needs_review'; reason: string; planQuote: string; proseQuote: string }[];
  };
  factRetractions?: { id: string; reason: string }[];
  continuity?: import('./continuity').ContinuityScope;
  memoryRepair?: {
    paths: string[];
    sources: string[];
    completed: { path: string; hash: string; reason: string }[];
    cursor: number;
    impacts?: import('./continuity').StoryImpact[];
    sourceHashes?: Record<string, string>;
    readonlySources?: string[];
  };
  planning?: import('./tags').TagPlanning;
  naming?: import('./creation').TitlePlanning;
  /** New S05 runs only; absence preserves historic prompt and recovery behavior. */
  volumeNaming?: import('./volume-style').VolumeNaming;
  chapterNaming?: import('./chapter-naming').ChapterNaming;
  tagBinding?: { inputHash: string; contractRevision: number; knowledgeVersion: string };
  conversationId?: string;
  savedCandidateReview?: { at: string; requestUnknown: boolean; error?: string };
  expressionRules?: Partial<
    Record<import('./expression').ExpressionMode, import('./expression').ExpressionBinding>
  >;
  candidateWrites?: Record<string, number>;
  documentDrafts?: (Change & { hash: string; chunks: number })[];
  modelBindings?: Record<string, { id: string; version: number }>;
  reasoningEfforts?: ReasoningSnapshot;
  proposalHash?: string;
  candidateFormat?: 2;
  baseSnapshotId?: string;
  /** Derived by the host for UI gating; null means the current project is incompatible. */
  basisRevision?: number | null;
  skillId?: string;
  pipeline?: {
    coverageVersion?: 1;
    phase: 'prose' | 'review' | 'memory' | 'ready';
    proseHash?: string;
    epoch: string;
    version: number;
    previewCalls: number;
    narrative?: import('./narrative-events').NarrativeEventState;
  };
  steps?: { phase: string; profileId: string; profileVersion: number; usage: Usage }[];
  skillHash?: string;
  id: string;
  stage: StageId;
  chapter: number;
  batch: Batch;
  mode: 'stage' | 'revision' | 'manual' | 'import' | 'analysis';
  request: string;
  status: RunStatus;
  profileId: string;
  profileVersion: number;
  createdAt: string;
  updatedAt: string;
  baseRevision: number;
  manifest: ContextManifest | null;
  changes: Change[];
  facts: Fact[];
  issues: Issue[];
  messages: ModelMessage[];
  responseText: string;
  rounds: number;
  toolCount: number;
  usage: Usage;
  accepted: boolean;
  input?: { question: string; answer?: string };
  permission?: {
    kind: 'terminal' | 'network';
    args: Record<string, unknown>;
    callId: string;
    status: 'pending' | 'approved' | 'denied';
  };
  sourceProseHash?: string;
  toolResults: Record<string, { argsHash: string; result: string }>;
  error?: string;
}
export interface Usage {
  input: number | null;
  output: number | null;
  /** Subsets of input/output, not additional tokens. Missing means unreported. */
  cachedInput?: number | null;
  cacheWriteInput?: number | null;
  reasoningOutput?: number | null;
  cost: number | null;
  currency: string;
}
export interface RunEvent {
  seq: number;
  runId: string;
  kind: string;
  text: string;
  at: string;
  data?: unknown;
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ModelMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  calls?: ToolCall[];
  callId?: string;
  native?: unknown;
}
/** Optional arrival times from the client clock. Missing means unobserved, not zero.
 * generationEvents counts nonempty content events, never model tokens. */
export interface StreamTiming {
  firstGenerationMs?: number;
  firstTextMs?: number;
  firstReasoningMs?: number;
  firstToolInputMs?: number;
  lastGenerationMs?: number;
  generationEvents?: number;
}
export interface ModelResult {
  /** Observed response metadata only; never replayed as prompt content. */
  provider?: StreamTiming & {
    responseId?: string;
    requestId?: string;
    clientRequestId?: string;
    model?: string;
    serviceTier?: string;
    reasoningContext?: string;
    reasoningEffort?: string;
    cacheDiagnostics?: { type?: string; reason?: string; comparisonReusableTokens?: number; cacheMissedTokens?: number };
    headersMs?: number;
    firstEventMs?: number;
    elapsedMs?: number;
  };
  webSearch?: import('./web-search').NativeWebSearchState;
  text: string;
  calls: ToolCall[];
  native: unknown;
  usage: Usage;
  stop: 'complete' | 'tools' | 'length' | 'filtered';
}
export interface Snapshot {
  projectSessionId?: string;
  workerGeneration?: number;
  tagDraft?: import('./tags').BookSpec;
  studio?: import('./studio').StudioState;
  eventSeq?: number;
  epoch?: string;
  conversations?: import('./assistant').Conversation[];
  chatBusy?: boolean;
  purgedDrafts?: { entryId: string; projectId: string }[];
  project: ProjectState | null;
  documents: DocumentInfo[];
  runs: Run[];
  events: RunEvent[];
  profiles: Profile[];
  savedProfiles?: Profile[];
  recent: { title: string; root: string }[];
  facts: Fact[];
  issues: Issue[];
}
export type { Command } from './contracts';
export interface AppEvent {
  resource?: 'runs' | 'chat' | 'documents' | 'studio';
  projectSessionId?: string;
  workerGeneration?: number;
  resourceId?: string;
  resourceVersion?: number;
  type: 'snapshot' | 'run-event' | 'delta' | 'error' | 'prose-delta' | 'narrative-event' | 'assessment';
  projectId?: string;
  snapshotId?: string;
  epoch?: string;
  streamEpoch?: string;
  seq?: number;
  draftVersion?: number;
  runId?: string;
  text?: string;
  textOffset?: number;
  data?: unknown;
}
export interface ClientApi {
  desktop?: import('./desktop').DesktopApi;
  invoke: import('./contracts').BridgeInvoke;
  cancelWait(waitId: string): void;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
declare global {
  interface Window {
    wenxu?: ClientApi;
  }
}
