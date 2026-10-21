import { z } from 'zod';

export const managementStatusSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  version: z.string(),
  running: z.boolean(),
  url: z.string().nullable(),
  startedAt: z.string().nullable(),
  sessions: z.number().int(),
  workerState: z.string(),
  workerGeneration: z.number().int(),
  protocolVersion: z.literal(1),
  transport: z.literal('local-http')
});
export type ManagementStatus = z.infer<typeof managementStatusSchema>;
export type ManagementView =
  | 'workspace'
  | 'tasks'
  | 'creation'
  | 'memory'
  | 'cover'
  | 'models'
  | 'assistant'
  | 'project'
  | 'transfer'
  | 'legacy'
  | 'trash'
  | 'new'
  | 'open';
export const managementViews: ManagementView[] = [
  'workspace',
  'tasks',
  'creation',
  'memory',
  'cover',
  'models',
  'assistant',
  'project',
  'transfer',
  'legacy',
  'trash',
  'new',
  'open'
];
export interface ManagementLog {
  seq: number;
  at: string;
  source: 'desktop' | 'browser' | 'system';
  command: string;
  status: 'ok' | 'error';
  durationMs: number;
  operationId?: string;
  projectSessionId?: string;
  errorCode?: string;
}
export interface ManagementLogPage {
  items: ManagementLog[];
  nextBefore: number | null;
}
export interface LocalFileList {
  path: string;
  parent: string | null;
  roots: string[];
  entries: { name: string; path: string; directory: boolean }[];
  truncated: boolean;
}
export type FileSelection = { mode: 'directory' | 'open' | 'save'; path: string };
