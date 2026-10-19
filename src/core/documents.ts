import fs from 'node:fs';
import { brand } from '../shared/brand';
import path from 'node:path';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import { backup, DatabaseSync } from 'node:sqlite';
import { verifyObjects } from './integrity';
import { checkDatabaseCompatibility, inspectProjectDatabase } from './compatibility';
import { FileStore, atomicWrite, durableCreate, safePath, fileHash } from './storage';
import { hash, id, now } from './domain';

export { importDocument } from './document-import';

export async function exportDocument(content: string, target: string) {
  const ext = path.extname(target).toLowerCase();
  if (fs.existsSync(target)) throw new Error('目标文件已存在，请选择新文件名以免覆盖');
  if (ext === '.docx') {
    const children: (Paragraph | Table)[] = [],
      lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('|')) {
        const rows = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          const cells = lines[i]
            .split('|')
            .slice(1, -1)
            .map((s) => s.trim());
          if (!cells.every((c) => /^:?-+:?$/.test(c)))
            rows.push(
              new TableRow({ children: cells.map((c) => new TableCell({ children: [new Paragraph(c)] })) })
            );
          i++;
        }
        i--;
        if (rows.length) children.push(new Table({ rows }));
        continue;
      }
      const title = line.match(/^(#{1,6}) (.*)$/);
      children.push(
        new Paragraph(
          title
            ? {
                text: title[2],
                heading: [
                  HeadingLevel.HEADING_1,
                  HeadingLevel.HEADING_2,
                  HeadingLevel.HEADING_3,
                  HeadingLevel.HEADING_4,
                  HeadingLevel.HEADING_5,
                  HeadingLevel.HEADING_6
                ][title[1].length - 1]
              }
            : line.startsWith('- ')
              ? { text: line.slice(2), bullet: { level: 0 } }
              : { text: line }
        )
      );
    }
    atomicWrite(target, await Packer.toBuffer(new Document({ sections: [{ children }] })));
  } else if (ext === '.md' || ext === '.txt')
    atomicWrite(target, ext === '.txt' ? content.replace(/^#{1,6} /gm, '') : content);
  else throw new Error('请选择 .md、.txt 或 .docx 文件名');
  return target;
}
export async function createBackup(store: FileStore, directory: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  checkDatabaseCompatibility(store.db.sql, true);
  const relative = path.relative(store.root, path.resolve(directory));
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative)))
    throw new Error('备份目录必须位于作品目录之外');
  const target = path.join(
    directory,
    `${brand.name}备份_${new Date().toISOString().replace(/[:.]/g, '-')}_${id().slice(0, 8)}`
  );
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(target);
  const manifest: { path: string; hash: string }[] = [];
  const checkpoint = target + '.pending.json';
  const saveCheckpoint = () => atomicWrite(checkpoint, JSON.stringify({ schema: 1, projectId: store.db.project().id, manifest }));
  async function walk(dir: string, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (entry.isSymbolicLink()) continue;
      const rel = prefix + entry.name;
      if (/(?:state\.sqlite(?:-wal|-shm)?|write-lock\.json)$/.test(rel)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel + '/');
      else {
        const bytes = fs.readFileSync(safePath(store.root, rel, true));
        durableCreate(path.join(target, rel), bytes);
        manifest.push({ path: rel, hash: hash(bytes) });
        if (manifest.length % 32 === 0) {
          saveCheckpoint();
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }
  }
  await walk(store.root);
  signal?.throwIfAborted();
  saveCheckpoint();
  const dbTarget = path.join(target, '.novelclient/state.sqlite');
  fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
  await backup(store.db.sql, dbTarget);
  signal?.throwIfAborted();
  const copied = new DatabaseSync(dbTarget, { readOnly: true });
  try { verifyObjects(target, copied); } finally { copied.close(); }
  manifest.push({ path: '.novelclient/state.sqlite', hash: fileHash(dbTarget)! });
  atomicWrite(
    path.join(target, 'wenxu-backup.json'),
    JSON.stringify({ schema: 1, createdAt: now(), projectId: store.db.project().id, manifest }, null, 2)
  );
  fs.unlinkSync(checkpoint);
  return target;
}
export function restoreBackup(source: string, parent: string) {
  const record = JSON.parse(fs.readFileSync(path.join(source, 'wenxu-backup.json'), 'utf8')) as {
    schema: number;
    manifest: { path: string; hash: string }[];
  };
  if (record.schema !== 1 || !Array.isArray(record.manifest)) throw new Error(`不是有效${brand.name}备份`);
  for (const entry of record.manifest)
    if (fileHash(safePath(source, entry.path, true)) !== entry.hash)
      throw new Error(`备份校验失败：${entry.path}`);
  if (!record.manifest.some((entry) => entry.path === '.novelclient/state.sqlite'))
    throw new Error('备份缺少作品数据库');
  inspectProjectDatabase(safePath(source, '.novelclient/state.sqlite', true));
  const db = new DatabaseSync(safePath(source, '.novelclient/state.sqlite', true), { readOnly: true });
  try { verifyObjects(source, db, new Set(record.manifest.map((entry) => entry.path))); } finally { db.close(); }
  const target = path.join(parent, `恢复的作品_${id().slice(0, 8)}`);
  fs.mkdirSync(target);
  for (const e of record.manifest)
    atomicWrite(safePath(target, e.path, true), fs.readFileSync(safePath(source, e.path, true)));
  return target;
}
