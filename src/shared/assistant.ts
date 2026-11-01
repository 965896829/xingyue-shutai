import { z } from 'zod';
import type { ModelMessage, Usage } from './types';

export const roleIds = ['editor', 'tomato', 'qidian'] as const;
export type RoleId = (typeof roleIds)[number];
export interface RoleVersion {
  id: string;
  text: string;
  at: string;
  reason: string;
}
export interface RoleRule {
  id: RoleId;
  title: string;
  summary: string;
  defaultText: string;
  current: RoleVersion;
  history: RoleVersion[];
}
export const searchSettingsSchema = z.object({
  provider: z.enum(['auto', 'openai', 'tavily']).default('auto'),
  nativeToolLimit: z.enum(['auto', 'server', 'compatible']).default('auto'),
  baseUrl: z.string().url().default('https://api.tavily.com'),
  enabled: z.boolean().default(true),
  maxResults: z.number().int().min(1).max(20).default(5),
  maxSearches: z.number().int().min(1).max(10).default(3),
  maxExtracts: z.number().int().min(1).max(10).default(3),
  timeoutSeconds: z.number().int().min(5).max(120).default(30)
});
export type SearchSettings = z.infer<typeof searchSettingsSchema>;
export interface Conversation {
  id: string;
  objectBinding?: import('./workbench').WorkbenchBinding;
  runId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  online: boolean;
  summary?: { through: string; text: string; messageIds: string[] };
}
export interface Citation {
  kind: 'document' | 'memory' | 'rule' | 'history' | 'web';
  label: string;
  path?: string;
  hash?: string;
  url?: string;
  at: string;
  reason: string;
}
export interface ConversationMessage {
  webSearch?: import('./web-search').NativeWebSearchState;
  id: string;
  conversationId: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'running' | 'complete' | 'stopped' | 'unknown' | 'failed';
  citations: Citation[];
}
export interface ConversationTurn {
  executorId?: 'legacy' | 'pi';
  executorVersion?: string;
  contextUsage?: import('./context-meter').ContextUsage;
  contextCompactions?: import('./context-meter').ContextCompaction[];
  activity?: import('./generation').GenerationActivity;
  reasoningEfforts?: import('./reasoning').ReasoningSnapshot;
  webSearch?: import('./web-search').NativeWebSearchState;
  manifest?: import('./types').ContextManifest;
  taskContext?: string;
  displayedError?: string;
  /** Host-bound permission to revise this unsaved candidate when explicitly requested in this turn. */
  candidateEdit?: { runId: string; runHash: string };
  objectEdit?: { bindingHash: string };
  tagBinding?: { inputHash: string; contractRevision: number; knowledgeVersion: string };
  expressionRules?: import('./expression').ExpressionBinding;
  id: string;
  conversationId: string;
  messageId: string;
  profileId: string;
  profileVersion: number;
  status: ConversationMessage['status'];
  createdAt: string;
  updatedAt: string;
  error?: string;
  failure?: import('./errors').ErrorPayload;
  networkRetries?: number;
  rules: { id: string; version: string }[];
  citations: Citation[];
  messages: ModelMessage[];
  usage: Usage;
  calls: { name: string; arguments: string; result: string; at: string }[];
  budgets: {
    round: number;
    estimatedInput: number;
    availableInput: number;
    rules: number;
    history: number;
    sources: number;
    method?: 'o200k_base' | 'cl100k_base' | 'utf8_upper_bound';
    inputBytes?: number;
    providerReserve?: number;
    safetyReserve?: number;
    toolReserve?: number;
  }[];
  proposalId?: string;
  kind: 'discussion' | 'draft';
  request: string;
}
export interface ActionProposal {
  id: string;
  baseSnapshotId?: string;
  resumeRunId?: string;
  resumeRunHash?: string;
  resumeRunHashVersion?: 2;
  conversationId: string;
  turnId: string;
  version: string;
  status: 'pending' | 'executed' | 'stale' | 'cancelled';
  kind: 'stage' | 'revision' | 'draft';
  goal: string;
  scope: string;
  outputs: string[];
  request: string;
  stage: string;
  chapter: number;
  projectRevision: number;
  profileId: string;
  profileVersion: number;
  sources: { path: string; hash: string }[];
  rulesHash: string;
  createdAt: string;
  executionId?: string;
  executionSource?: 'author_message';
  executionError?: string;
}
export interface DraftArtifact {
  parent?: { id: string; hash: string };
  id: string;
  title: string;
  path: string;
  conversationId: string;
  messageId: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
  versions: { hash: string; at: string }[];
}
