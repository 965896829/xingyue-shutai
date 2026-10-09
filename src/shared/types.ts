import { z } from 'zod';

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
    style: z.string().default('清晰、快节奏；人物主动选择；强弱节奏交替'),
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
    tools: z.boolean().default(true),
    temperature: z.number().min(0).max(2).nullable().default(null),
    inputPrice: z.number().nonnegative().nullable().default(null),
    outputPrice: z.number().nonnegative().nullable().default(null),
    currency: z.string().default('USD'),
    timeoutSeconds: z.number().int().min(10).max(1800).default(180),
    proxy: z.string().default(''),
    headers: z.record(z.string(), z.string()).default({}),
    version: z.number().int().positive().default(1),
    hasKey: z.boolean().default(false),
    capabilities: z.record(z.string(), z.enum(['unknown', 'verified', 'failed'])).default({}),
    imageSize: z.string().default('1024x1536'),
    imageQuality: z.string().default('auto')
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
  root: string;
  schemaVersion: 1;
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
    kind: z.enum(['event', 'world_rule', 'author_constraint', 'plan', 'belief', 'inference']),
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
    storyTime: z.string().default('未知'),
    revealedAt: z.number().int().min(0),
    knowledge: z
      .array(
        z.object({
          who: z.string(),
          mode: z.enum(['seen', 'told', 'inferred', 'misunderstood', 'unknown']),
          fromChapter: z.number().int().min(0)
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
    acceptedRunId: z.string().optional()
  })
  .refine((v) => v.toChapter === null || v.toChapter >= v.fromChapter, '记忆有效范围不能倒置');
export type Fact = z.infer<typeof factSchema>;
export interface ContextSource {
  path: string;
  hash: string;
  reason: string;
  content: string;
  required: boolean;
  mode: 'full' | 'excerpt';
}
export interface ContextManifest {
  snapshotId?: string;
  coverage?: import('./studio').LedgerCoverage[];
  retrievedFacts?: Fact[];
  id: string;
  projectRevision: number;
  chapter: number;
  stage: StageId;
  sources: ContextSource[];
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
  expressionRules?: Partial<
    Record<import('./expression').ExpressionMode, import('./expression').ExpressionBinding>
  >;
  candidateWrites?: Record<string, number>;
  modelBindings?: Record<string, { id: string; version: number }>;
  proposalHash?: string;
  baseSnapshotId?: string;
  skillId?: string;
  pipeline?: {
    phase: 'prose' | 'review' | 'memory' | 'ready';
    proseHash?: string;
    epoch: string;
    version: number;
    previewCalls: number;
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
export interface ModelResult {
  text: string;
  calls: ToolCall[];
  native: unknown;
  usage: Usage;
  stop: 'complete' | 'tools' | 'length' | 'filtered';
}
export interface Snapshot {
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
export const commands = [
  'studio.read',
  'snapshot.list',
  'memory.retrieve',
  'memory.list',
  'memory.trace',
  'state.getCharacter',
  'state.proposeCorrection',
  'embedding.settings.save',
  'embedding.test',
  'embedding.reindex',
  'embedding.cancel',
  'assessment.refresh',
  'draft.checkpoint',
  'skills.list',
  'expression.catalog',
  'skill.run',
  'outbox.retry',
  'chat.list',
  'chat.create',
  'chat.update',
  'chat.read',
  'chat.send',
  'chat.stop',
  'chat.retry',
  'proposal.confirm',
  'proposal.refresh',
  'proposal.cancel',
  'proposal.create',
  'draft.list',
  'draft.save',
  'draft.read',
  'draft.promote',
  'assistant.settings',
  'assistant.role.save',
  'assistant.role.reset',
  'assistant.role.rollback',
  'search.settings.save',
  'search.test',
  'run.revalidate',
  'app.snapshot',
  'project.create',
  'project.preview',
  'project.repair',
  'project.importLegacy',
  'project.open',
  'project.close',
  'project.trash',
  'project.listTrash',
  'project.restoreTrash',
  'project.configure',
  'project.scan',
  'project.importAccept',
  'document.read',
  'document.save',
  'document.history',
  'document.restore',
  'run.start',
  'run.resume',
  'run.cancel',
  'run.accept',
  'run.discard',
  'run.update',
  'run.answer',
  'run.permission',
  'run.handoff',
  'memory.search',
  'memory.rebuild',
  'context.preview',
  'project.backup',
  'project.restoreBackup',
  'project.export',
  'project.importDocument',
  'profiles.save',
  'profiles.saveGroup',
  'profiles.deleteGroup',
  'profiles.delete',
  'profiles.test',
  'profiles.models',
  'cover.generate',
  'cover.cancel',
  'cover.save',
  'cover.list',
  'cover.load',
  'terminal.cancel',
  'impact.review',
  'app.chooseDirectory',
  'app.chooseFile',
  'app.reveal',
  'app.openUrl',
  'diagnostics.export'
] as const;
export type Command = (typeof commands)[number];
export interface AppEvent {
  type: 'snapshot' | 'run-event' | 'delta' | 'error' | 'prose-delta' | 'assessment';
  projectId?: string;
  snapshotId?: string;
  epoch?: string;
  streamEpoch?: string;
  seq?: number;
  draftVersion?: number;
  runId?: string;
  text?: string;
  data?: unknown;
}
export interface ClientApi {
  desktop?: import('./desktop').DesktopApi;
  invoke<T = unknown>(command: Command, args?: Record<string, unknown>): Promise<T>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
declare global {
  interface Window {
    wenxu?: ClientApi;
  }
}
