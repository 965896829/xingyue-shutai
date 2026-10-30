import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

// Older executors must not reopen a forward-only review as an unrestricted revision.
export const databaseVersion = 8;
export const projectIdentitySchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)])
});

export function assertProjectVersion(value: unknown) {
  const result = projectIdentitySchema.safeParse(value);
  if (!result.success) throw new Error('无法确认作品身份或项目版本不受支持，已停止操作');
  return result.data;
}

export function checkDatabaseCompatibility(db: DatabaseSync, requireProject = false) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (version > databaseVersion)
    throw new Error(`数据库版本 ${version} 高于本客户端支持版本，已停止打开且未修改原数据库`);
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kv'").get();
  const row = table ? db.prepare("SELECT value FROM kv WHERE key='project'").get() : undefined;
  if (!row) {
    if (requireProject) throw new Error('作品数据库没有项目记录');
    return { databaseVersion: version, project: null };
  }
  return { databaseVersion: version, project: assertProjectVersion(JSON.parse(String(row.value))) };
}

export function inspectProjectDatabase(filename: string) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    return checkDatabaseCompatibility(db, true);
  } finally {
    db.close();
  }
}
