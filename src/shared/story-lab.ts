import { z } from 'zod';

const id = z.string().uuid();
const text = z.string().max(1_000_000);
export const labActionSchema = z.enum(['blueprint', 'discuss', 'revise', 'expand', 'prose', 'continue']);
export const labKindSchema = z.enum(['blueprint', 'prose', 'discussion']);
export const labRequirementsSchema = z.strictObject({
  idea: z.string().trim().min(1).max(30_000),
  targetWords: z.string().max(100).default(''),
  chapterWords: z.string().max(100).default(''),
  keep: z.string().max(20_000).default(''),
  avoid: z.string().max(20_000).default(''),
  existing: z.string().max(100_000).default('')
});
export const labSessionSchema = z.object({
  id,
  title: z.string(),
  requirements: labRequirementsSchema,
  profileId: z.string(),
  outputLimit: z.number().int().min(128).max(1_000_000),
  pins: z.array(z.string().max(20_000)).max(100),
  currentVersionId: id.nullable(),
  currentProseId: id.nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export const labVersionSchema = z.object({
  id,
  sessionId: id,
  kind: labKindSchema,
  title: z.string(),
  content: text,
  baseVersionId: id.nullable(),
  requestId: id.nullable(),
  createdAt: z.string(),
  source: z.enum(['model', 'edit']),
  partial: z.boolean()
});
export const labMessageSchema = z.object({
  id,
  sessionId: id,
  requestId: id,
  role: z.enum(['user', 'assistant']),
  content: text,
  versionId: id.nullable(),
  action: labActionSchema,
  createdAt: z.string()
});
export const labSelectionSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text
});
export const labGenerateSchema = z.strictObject({
  sessionId: id,
  requestId: id,
  action: labActionSchema,
  instruction: z.string().max(30_000).default(''),
  baseVersionId: id.nullable(),
  sourceVersionId: id.optional(),
  selection: labSelectionSchema.optional(),
  sectionIndexes: z.array(z.number().int().nonnegative()).max(100).optional(),
  recentMessageIds: z.array(id).max(20).optional(),
  concealed: z.string().max(20_000).default(''),
  blueprintScope: z.enum(['full', 'core']).default('full'),
  acknowledgeUnknown: z.boolean().default(false),
  maxRequests: z.literal(1).default(1)
});
export const labContextSchema = z.object({
  system: z.string(),
  user: text,
  sources: z.array(z.string()),
  baseVersionId: id.nullable(),
  estimatedInput: z.number(),
  availableInput: z.number(),
  outputLimit: z.number(),
  requestCount: z.literal(1),
  warning: z.string(),
  fingerprint: z.string()
});
// Only connection metadata crosses IPC. Do not expose raw errors, headers or
// the provider's private reasoning/partial native response in the UI.
const diagnosticId = z.string().regex(/^[a-zA-Z0-9_.:-]{1,180}$/);
const milliseconds = z.number().finite().nonnegative();
export const labFailureSchema = z.object({
  source: z.enum(['upstream', 'transport', 'protocol', 'client']),
  code: diagnosticId,
  requestId: diagnosticId.optional(),
  clientRequestId: diagnosticId.optional(),
  responseId: diagnosticId.optional(),
  elapsedMs: milliseconds.optional(),
  idleMs: milliseconds.optional(),
  progressIdleMs: milliseconds.optional(),
  headersMs: milliseconds.optional(),
  firstEventMs: milliseconds.optional(),
  httpStatus: z.number().int().optional(),
  closeCode: z.number().int().optional(),
  eventCount: z.number().int().nonnegative().optional(),
  lastEventType: diagnosticId.optional(),
  timeoutMode: z.enum(['idle', 'total']).optional()
});
export function labFailure(value: unknown) {
  const parsed = labFailureSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export const labRequestSchema = z.object({
  id,
  sessionId: id,
  action: labActionSchema,
  inputHash: z.string(),
  input: labGenerateSchema,
  status: z.enum(['running', 'complete', 'length', 'cancelled', 'unknown', 'not_sent', 'filtered']),
  context: labContextSchema,
  model: z.object({
    profileId: z.string(),
    name: z.string(),
    model: z.string(),
    protocol: z.string(),
    version: z.number(),
    outputLimit: z.number(),
    reasoningEffort: z.string().nullable(),
    transport: z.enum(['http', 'websocket']).optional(),
    timeoutSeconds: z.number().positive().optional()
  }),
  response: text,
  versionId: id.nullable(),
  error: z.string(),
  failure: labFailureSchema.optional(),
  sequence: z.number().int(),
  usage: z.object({
    input: z.number().nullable(),
    output: z.number().nullable(),
    cost: z.number().nullable(),
    currency: z.string()
  }),
  attempts: z.number().int(),
  baseRevision: z.number().int(),
  baseProseVersionId: id.nullable(),
  startedAt: z.string(),
  endedAt: z.string().optional()
});
export const labDetailSchema = z.object({
  session: labSessionSchema,
  versions: z.array(labVersionSchema),
  messages: z.array(labMessageSchema),
  requests: z.array(labRequestSchema)
});
export const labCreateSchema = z.strictObject({
  id,
  requirements: labRequirementsSchema,
  profileId: z.string().min(1),
  outputLimit: z.number().int().min(128).max(1_000_000)
});
export const labUpdateSchema = z.strictObject({
  sessionId: id,
  expectedRevision: z.number().int(),
  profileId: z.string().min(1),
  outputLimit: z.number().int().min(128).max(1_000_000),
  pins: z.array(z.string().min(1).max(20_000)).max(100)
});
export const labEditSchema = z.strictObject({
  sessionId: id,
  baseVersionId: id,
  content: text.min(1),
  title: z.string().max(120),
  expectedRevision: z.number().int()
});
export const labSelectSchema = z.strictObject({
  sessionId: id,
  versionId: id,
  expectedRevision: z.number().int(),
  reviewedStale: z.boolean().default(false)
});
export const labExportSchema = z.strictObject({
  sessionId: id,
  versionId: id.optional(),
  requirementsOnly: z.boolean().default(false),
  format: z.enum(['md', 'txt']).default('md')
});
export type LabSession = z.infer<typeof labSessionSchema>;
export type LabVersion = z.infer<typeof labVersionSchema>;
export type LabMessage = z.infer<typeof labMessageSchema>;
export type LabRequest = z.infer<typeof labRequestSchema>;
export type LabGenerate = z.infer<typeof labGenerateSchema>;
export type LabContext = z.infer<typeof labContextSchema>;
export type LabDetail = z.infer<typeof labDetailSchema>;
export type LabEvent = {
  type: 'story-lab';
  workspace: 'story-lab';
  sessionId: string;
  requestId: string;
  sequence: number;
  text?: string;
  data?: { status: LabRequest['status']; offset: number };
};

export const labSections = [
  '一句话核心设定',
  '世界核心与隐藏真相',
  '主角',
  '独特优势与能力',
  '成长体系',
  '长期故事机制',
  '核心人物与关系',
  '开篇事件',
  '篇幅与全书路线',
  '长期变化策略',
  '人物表现与对白',
  '前30章或近期故事单元',
  '第一卷完整路线',
  '主要阅读体验',
  '本书文风',
  '结局方向',
  '下一步创作'
];
export interface LabHeading {
  title: string;
  start: number;
  end: number;
  level: number;
}
/** Navigation is optional metadata. Offsets always refer to the original, unmodified Markdown. */
export function labHeadings(content: string): LabHeading[] {
  const headings: LabHeading[] = [];
  let fence = '',
    offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
    } else if (!fence) {
      const match = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\r?\n?$/);
      if (match)
        headings.push({ title: match[2].trim(), level: match[1].length, start: offset, end: content.length });
    }
    offset += line.length;
  }
  for (let i = 0; i < headings.length; i++)
    headings[i].end =
      headings.slice(i + 1).find((h) => h.level <= headings[i].level)?.start ?? content.length;
  return headings;
}
export function labStale(session: LabSession, version: LabVersion) {
  const current = version.kind === 'prose' ? session.currentProseId : session.currentVersionId;
  return version.id !== current && version.baseVersionId !== current;
}
