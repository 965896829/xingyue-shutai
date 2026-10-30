import type { FileStore } from './storage';
import type { Change } from '../shared/types';
import { workbenchBindingSchema } from '../shared/workbench';
import { workbenchMediaDocumentSchema } from '../shared/workbench-visual';
import { resolveWorkbenchObject, readWorkbench } from './workbench';
import { scopeSnapshot } from './memory-studio';
import { now } from './domain';

export const mediaPath = '11_创作素材/人物外观.md';
const parse = (text: string) => {
  const match = text.match(/^# 人物外观\s+```json\s*([\s\S]*?)```\s*$/);
  if (!match) throw new Error('人物外观资料格式不完整');
  const data = workbenchMediaDocumentSchema.parse(JSON.parse(match[1]));
  if (new Set(data.avatars.map((a) => a.objectId)).size !== data.avatars.length)
    throw new Error('人物头像记录重复');
  return data;
};
function mimeOf(buffer: Buffer) {
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.readUInt32BE(16) > 0 &&
    buffer.readUInt32BE(16) <= 16384 &&
    buffer.readUInt32BE(20) > 0 &&
    buffer.readUInt32BE(20) <= 16384
  )
    return 'image/png';
  if (
    buffer.length > 4 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer.at(-2) === 255 &&
    buffer.at(-1) === 217
  )
    return 'image/jpeg';
  if (
    buffer.length >= 20 &&
    buffer.subarray(0, 4).toString() === 'RIFF' &&
    buffer.subarray(8, 12).toString() === 'WEBP' &&
    buffer.readUInt32LE(4) + 8 === buffer.length
  )
    return 'image/webp';
  throw new Error('请选择有效的 PNG、JPEG 或 WebP 图片');
}
export function proposeAvatar(
  store: FileStore,
  raw: unknown,
  dataUrl: string | null,
  name: string,
  revealedAt: number | null
) {
  const { object } = resolveWorkbenchObject(store, raw);
  if (object.kind !== 'character') throw new Error('只能为人物设置头像');
  const baseHash = store.db.document(mediaPath)?.hash ?? null;
  const document = baseHash
    ? parse(store.readAccepted(mediaPath).content)
    : { version: 1 as const, avatars: [] };
  const previous = document.avatars.find((a) => a.objectId === object.id);
  document.avatars = document.avatars.filter((a) => a.objectId !== object.id);
  if (dataUrl !== null) {
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[2].length > 4_200_000) throw new Error('头像图片应小于 3 MB');
    const bytes = Buffer.from(match[2], 'base64'),
      mime = mimeOf(bytes);
    if (mime !== match[1] || bytes.length > 3 * 1024 * 1024) throw new Error('图片类型或大小不符');
    document.avatars.push({
      objectId: object.id,
      entityId: object.entityIds.find((id) => !id.startsWith('card-')) ?? object.id,
      hash: store.putObject(bytes),
      mime,
      name: name.slice(0, 200) || object.title,
      version: (previous?.version ?? 0) + 1,
      createdAt: now(),
      revealedAt
    });
  } else if (!previous) throw new Error('人物还没有头像');
  return {
    path: mediaPath,
    baseHash,
    content: `# 人物外观\n\n\`\`\`json\n${JSON.stringify(document, null, 2)}\n\`\`\`\n`
  };
}
export function readAvatar(store: FileStore, raw: unknown) {
  const binding = workbenchBindingSchema.parse(raw);
  const scope = { ...binding.scope, projectId: binding.projectId, snapshotId: binding.snapshotId };
  const view = readWorkbench(store, scope);
  const object = view.objects.find((o) => o.id === binding.objectId && o.kind === 'character');
  if (!object) throw new Error('人物不在当前查看范围');
  const snapshot = scopeSnapshot(store, scope);
  const version = snapshot?.documents[mediaPath];
  if (!version) return null;
  const item = parse(store.object(version).toString('utf8')).avatars.find(
    (a) => a.objectId === binding.objectId || object.entityIds.includes(a.entityId ?? a.objectId)
  );
  if (
    !item ||
    (scope.viewpoint !== 'author' && (item.revealedAt === null || item.revealedAt > scope.chapter))
  )
    return null;
  return {
    metadata: item,
    dataUrl: `data:${item.mime};base64,${store.object(item.hash).toString('base64')}`
  };
}
export function validateMediaChanges(store: FileStore, changes: Change[]) {
  const change = changes.find((c) => c.path === mediaPath);
  if (!change) return;
  for (const image of parse(change.content).avatars) {
    const bytes = store.object(image.hash);
    if (bytes.length > 3 * 1024 * 1024 || mimeOf(bytes) !== image.mime) throw new Error('头像对象不完整');
  }
}
