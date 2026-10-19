import { z } from 'zod';
import type { TagCatalog, TagInput } from './tags';

const text = z.string().min(1).max(4000);
const sourceIds = z.array(z.string().min(1).max(100)).max(20);
const readingGroups = ['reading.main', 'reading.theme', 'reading.role', 'reading.plot'] as const;
const readingLabels: Record<(typeof readingGroups)[number], string> = {
  'reading.main': '阅读标签 · 主分类数量',
  'reading.theme': '阅读标签 · 主题数量',
  'reading.role': '阅读标签 · 角色数量',
  'reading.plot': '阅读标签 · 情节数量'
};
const unverifiedStatement = z.object({
  verification: z.literal('unverified'),
  sourceIds,
  message: text
}).strict();

export const tagPolicySourceSchema = z.object({
  id: z.string().min(1).max(100),
  title: text,
  publisher: text,
  kind: z.enum(['official_platform', 'user_snapshot', 'architecture_reference']).optional(),
  url: z.url().optional(),
  publishedAt: z.iso.date().optional(),
  accessedAt: z.iso.date().optional(),
  notes: text.optional()
}).strict();
export type TagPolicySource = z.infer<typeof tagPolicySourceSchema>;

export const tagPolicyProfileSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  version: text,
  platform: z.literal('fanqie'),
  scope: z.literal('original_long_form'),
  scopeLabel: text,
  verifiedAt: z.iso.date(),
  readingCardinality: z.array(z.object({
    id: z.string().min(1).max(100),
    groupId: z.enum(readingGroups),
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    verification: z.enum(['verified', 'unverified']),
    sourceIds,
    message: text
  }).strict().refine(rule => rule.min <= rule.max, '标签数量范围无效')).length(4),
  contentCardinality: unverifiedStatement,
  optionAvailability: unverifiedStatement,
  combinationRules: unverifiedStatement,
  notes: z.array(text).max(20)
}).strict().refine(
  profile => new Set(profile.readingCardinality.map(rule => rule.groupId)).size === readingGroups.length,
  '阅读标签数量规则必须覆盖四个独立分组'
);
export type TagPolicyProfile = z.infer<typeof tagPolicyProfileSchema>;

export type TagPolicyStatus = 'allowed' | 'forbidden' | 'unknown';
export interface TagPolicyCheck {
  id: string;
  category: 'reading_cardinality' | 'content_cardinality' | 'option_availability' |
    'combination_rules' | 'local_selection' | 'profile';
  status: TagPolicyStatus;
  label: string;
  message: string;
  groupId?: string;
  optionIds: string[];
  sourceIds: string[];
}
export interface TagPolicyAssessment {
  mode: 'creative' | 'tagged';
  status: TagPolicyStatus;
  profileVersion: string | null;
  verifiedAt: string | null;
  scope: string;
  message: string;
  checks: TagPolicyCheck[];
  sources: TagPolicySource[];
}

/** Evidence assessment only: it never edits input, supplies tag IDs, or blocks creation. */
export function assessTagPolicy(catalog: TagCatalog, selection: TagInput['selection']): TagPolicyAssessment {
  const groups: Record<string, string[]> = {
    'reading.main': selection.reading.main ? [selection.reading.main] : [],
    'reading.theme': selection.reading.theme,
    'reading.role': selection.reading.role,
    'reading.plot': selection.reading.plot,
    'content.plot': selection.content.plot,
    'content.emotion': selection.content.emotion,
    'content.persona': selection.content.persona,
    'content.world': selection.content.world
  };
  const selected = Object.values(groups).flat();
  const profile = catalog.policy;
  const base = {
    profileVersion: profile?.version ?? null,
    verifiedAt: profile?.verifiedAt ?? null,
    scope: profile?.scopeLabel ?? '番茄原创长篇小说'
  };
  if (!selected.length) return {
    ...base,
    mode: 'creative',
    status: 'unknown',
    message: '按创意策划，尚未应用平台标签规则；后续可以补充平台标签。',
    checks: [],
    sources: []
  };

  const checks: TagPolicyCheck[] = [];
  const invalidGroups = new Set<string>();
  for (const [groupId, ids] of Object.entries(groups)) {
    if (new Set(ids).size !== ids.length || ids.some(id => !catalog.options.some(
      option => option.id === id && option.group === groupId && option.status !== 'retired'
    ))) {
      invalidGroups.add(groupId);
      checks.push({
        id: `local-selection.${groupId}`,
        category: 'local_selection',
        status: 'unknown',
        label: '本地选择需要修正',
        message: '选择含未知、停用、错分组或重复的本地标签 ID；这不代表平台禁止该题材。',
        groupId,
        optionIds: [...ids],
        sourceIds: []
      });
    }
  }

  if (!profile) {
    checks.push({
      id: 'platform-policy.missing', category: 'profile', status: 'unknown',
      label: '平台规则资料待核实',
      message: '本标签库没有带来源的官方规则资料。本地选项和数量范围不能代替平台允许性判断。',
      optionIds: [...selected], sourceIds: []
    });
  } else {
    for (const rule of profile.readingCardinality) {
      const ids = groups[rule.groupId];
      const hasEvidence = rule.verification === 'verified' && rule.sourceIds.length > 0 &&
        rule.sourceIds.every(id => catalog.sources?.some(source =>
          source.id === id && source.kind === 'official_platform' &&
          source.url?.startsWith('https://fanqienovel.com/')
        ));
      const status: TagPolicyStatus = !hasEvidence || invalidGroups.has(rule.groupId) ? 'unknown' :
        ids.length < rule.min || ids.length > rule.max ? 'forbidden' : 'allowed';
      checks.push({
        id: rule.id,
        category: 'reading_cardinality',
        status,
        label: readingLabels[rule.groupId],
        message: status === 'unknown'
          ? '此项缺少可核验的规则来源，或本地选择尚未通过分组检查，暂不判断平台是否允许。'
          : `${rule.message}本组已选 ${ids.length} 项，${status === 'allowed' ? '符合' : '不符合'}这项公开数量规则；该结论不证明具体词条或组合在当前后台可用。`,
        groupId: rule.groupId,
        optionIds: [...ids],
        sourceIds: [...rule.sourceIds]
      });
    }
    checks.push({
      id: 'content.cardinality', category: 'content_cardinality', status: 'unknown',
      label: '内容标签数量待核实', message: profile.contentCardinality.message,
      optionIds: Object.entries(groups).filter(([id]) => id.startsWith('content.')).flatMap(([, ids]) => ids),
      sourceIds: [...profile.contentCardinality.sourceIds]
    }, {
      id: 'options.availability', category: 'option_availability', status: 'unknown',
      label: '词条来自用户快照', message: profile.optionAvailability.message,
      optionIds: [...selected], sourceIds: [...profile.optionAvailability.sourceIds]
    }, {
      id: 'combinations.rules', category: 'combination_rules', status: 'unknown',
      label: '平台组合规则待核实', message: profile.combinationRules.message,
      optionIds: [...selected], sourceIds: [...profile.combinationRules.sourceIds]
    });
  }
  const status: TagPolicyStatus = checks.some(check => check.status === 'forbidden') ? 'forbidden' :
    checks.some(check => check.status === 'unknown') ? 'unknown' : 'allowed';
  const usedSources = new Set(checks.flatMap(check => check.sourceIds));
  return {
    ...base,
    mode: 'tagged',
    status,
    message: status === 'forbidden'
      ? '所选标签不符合已核实的公开数量规则；可调整平台标签，创意内容仍可保留。'
      : status === 'unknown'
        ? '部分平台规则或词条状态待核实，仍可继续创作；本地校验通过不等于平台已经允许该组合。'
        : '所选标签符合这份资料覆盖的规则；适用范围与核对日期见资料说明。',
    checks,
    sources: (catalog.sources ?? []).filter(source => usedSources.has(source.id)).map(source => ({ ...source }))
  };
}
