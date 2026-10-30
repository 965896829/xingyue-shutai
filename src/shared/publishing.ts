import { z } from 'zod';

export const publishingChannelSchema = z.enum(['male', 'female']);
export type PublishingChannel = z.infer<typeof publishingChannelSchema>;
export const publishingGroups = ['reading.main', 'reading.theme', 'reading.role', 'reading.plot'] as const;
export const publishingOptionSchema = z.object({
  id: z.string().min(1).max(160),
  platformId: z.string().regex(/^\d+$/),
  channel: publishingChannelSchema,
  group: z.enum(publishingGroups),
  label: z.string().min(1).max(100),
  legacyId: z.string().optional(),
  conceptId: z.string().optional()
}).strict();
export const publishingSnapshotSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.string().datetime({ offset: true }),
  extractorVersion: z.literal(1),
  sources: z.array(z.object({ channel: publishingChannelSchema, url: z.string().url(), observedAt: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).length(2),
  options: z.array(publishingOptionSchema).min(2).max(4000),
  ranks: z.array(z.object({ id: z.string(), channel: publishingChannelSchema, platformId: z.string(), label: z.string(), url: z.string().url() }).strict()).max(200),
  ranksObservedAt: z.string(),
  source: z.enum(['bundled', 'refreshed'])
}).strict();
export type PublishingSnapshot = z.infer<typeof publishingSnapshotSchema>;
export const publishingSelectionSchema = z.object({
  platform: z.literal('fanqie'),
  form: z.literal('original_long'),
  channel: publishingChannelSchema,
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  reading: z.object({ main: z.string().min(1).max(160), theme: z.array(z.string()).max(2), role: z.array(z.string()).max(2), plot: z.array(z.string()).max(2) }).strict()
}).strict();
export const bookProfileSchema = z.object({
  creativeGenres: z.array(z.string().trim().min(1).max(100)).max(12),
  publishing: publishingSelectionSchema.nullable()
}).strict();
export type BookProfile = z.infer<typeof bookProfileSchema>;
export const emptyBookProfile = (): BookProfile => ({ creativeGenres: [], publishing: null });
export const bookProfileStateSchema = z.object({
  profile: bookProfileSchema,
  catalog: publishingSnapshotSchema.nullable(),
  baseHash: z.string().nullable(),
  legacy: z.boolean()
}).strict();
export type BookProfileState = z.infer<typeof bookProfileStateSchema>;
export const publishingGroupLabels = { 'reading.main': '主分类', 'reading.theme': '主题', 'reading.role': '角色', 'reading.plot': '情节' };
export function publishingOptions(profile: BookProfile, catalog: PublishingSnapshot) {
  const choice = profile.publishing;
  if (!choice) return [];
  if (choice.snapshotId !== catalog.id) throw new Error('分类目录版本不匹配，请保留原版本或重新选择');
  return publishingGroups.flatMap(group => {
    const field = group.split('.')[1] as keyof typeof choice.reading;
    const raw = choice.reading[field], ids = typeof raw === 'string' ? [raw] : raw;
    if (new Set(ids).size !== ids.length) throw new Error('分类标签不能重复选择');
    return ids.map(id => {
      const option = catalog.options.find(o => o.id === id && o.channel === choice.channel && o.group === group);
      if (!option) throw new Error('所选分类不属于当前频道或目录版本');
      return option;
    });
  });
}
export function comparePublishingSnapshots(before: PublishingSnapshot, after: PublishingSnapshot) {
  const old = new Map(before.options.map(o => [o.id, o]));
  const next = new Map(after.options.map(o => [o.id, o]));
  return {
    added: after.options.filter(o => !old.has(o.id)),
    removed: before.options.filter(o => !next.has(o.id)),
    renamed: after.options.filter(o => old.has(o.id) && old.get(o.id)!.label !== o.label)
  };
}
