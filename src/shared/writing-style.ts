import { z } from 'zod';
import { bookProfileSchema } from './publishing';

export const defaultWritingStyle = '清晰、快节奏；人物主动选择；强弱节奏交替';
export const writingStylePresets = [
  { id: 'clear', name: '清爽快节奏', style: defaultWritingStyle },
  { id: 'passionate', name: '热血爽感', style: '语言明快有力；以人物行动推进冲突；突出成长与反击的情绪回报；高潮与蓄势交替，避免持续堆叠刺激' },
  { id: 'suspense', name: '悬疑紧张', style: '克制叙述；用可观察的细节和人物选择制造疑问；线索逐步兑现；信息留白服从人物知情，避免故意隐瞒已知事实' },
  { id: 'humorous', name: '轻松幽默', style: '语言轻快自然；幽默来自人物性格、处境和反差；对白鲜活有区分；笑点不打断关键情绪，不强行玩梗' },
  { id: 'emotional', name: '细腻情感', style: '以细微动作、感官与对白表现关系变化；情绪层层递进；允许必要停顿与留白；细腻但不反复解释人物感受' },
  { id: 'immersive', name: '沉浸写实', style: '叙述具体可信；用有用的生活细节、行动与环境营造现场感；因果清楚、人物动机自然；控制说明密度，避免资料堆砌' },
  { id: 'ensemble', name: '鲜活群像', style: '由人物各自的目标与选择推动故事；说话和做事方式有区分；用互动呈现关系与立场；视角转换清楚，不让所有人物共享一种口吻' }
] as const;

export function normalizeWritingStyle(value: string) { return value.replace(/\s+/gu, ' ').trim(); }

export const writingStyleContextSchema = z.object({
  premise: z.string().max(20000).default(''),
  genre: z.string().max(1200).default(''),
  pov: z.string().max(200).default('第三人称'),
  constraints: z.string().max(12000).default(''),
  bookProfile: bookProfileSchema.optional(),
  readingMain: z.string().max(160).optional()
}).strict();
export type WritingStyleContext = z.infer<typeof writingStyleContextSchema>;

export const writingStyleRequestSchema = z.object({
  requestId: z.string().uuid(),
  profileId: z.string().min(1),
  projectSessionId: z.string().optional(),
  currentStyle: z.string().max(6000),
  context: writingStyleContextSchema
}).strict();
export type WritingStyleRequest = z.infer<typeof writingStyleRequestSchema>;

const candidateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  name: z.string().trim().min(1).max(60),
  style: z.string().trim().min(1).max(2000),
  reason: z.string().trim().min(1).max(1200),
  tradeoff: z.string().trim().min(1).max(800)
}).strict();
export const writingStyleReportSchema = z.object({
  recommendedId: z.string().min(1).max(60),
  options: z.array(candidateSchema).length(3)
}).strict().refine(report => new Set(report.options.map(option => option.id)).size === 3 &&
  new Set(report.options.map(option => normalizeWritingStyle(option.style))).size === 3 &&
  report.options.some(option => option.id === report.recommendedId), '推荐风格必须是三个不同候选之一');
export type WritingStyleReport = z.infer<typeof writingStyleReportSchema>;
