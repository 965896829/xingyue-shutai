import fs from 'node:fs';
import { brand } from '../shared/brand';
import path from 'node:path';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import { backup, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { verifyObjects } from './integrity';
import { checkDatabaseCompatibility } from './compatibility';
import { FileStore, atomicWrite, createProjectDirectory, durableCreate, safePath, fileHash } from './storage';
import { hash, id, now } from './domain';

export { importDocument } from './document-import';

export async function exportDocument(content: string, target: string) {
  const ext = path.extname(target).toLowerCase();
  if (fs.existsSync(target)) throw new Error('目标文件已存在，请选择新文件名以免覆盖');
  let output: Buffer | string;
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
    output = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  } else if (ext === '.md' || ext === '.txt')
    output = ext === '.txt' ? content.replace(/^#{1,6} /gm, '') : content;
  else throw new Error('请选择 .md、.txt 或 .docx 文件名');
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(parent, '.xingyue-export-'));
  const temporary = path.join(temporaryDirectory, 'document');
  try {
    durableCreate(temporary, output);
    try {
      fs.linkSync(temporary, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code ?? '')) throw error;
      // Removable media may not support hard links. The exclusive copy also protects existing files.
      fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('目标文件已存在，请选择新文件名以免覆盖');
    throw error;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return target;
}

function backupDirectoryOutside(root: string, directory: string) {
  const requested = path.resolve(directory);
  let ancestor = requested;
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
  const destination = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, requested));
  const relative = path.relative(fs.realpathSync(root), destination);
  if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
    throw new Error('备份目录必须位于作品目录之外');
  return destination;
}

const manifestName = 'wenxu-backup.json';
const backupManifest = z.object({
  schema: z.union([z.literal(1), z.literal(2)]),
  manifest: z.array(z.object({ path: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) }))
});

export async function createBackup(store: FileStore, directory: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  checkDatabaseCompatibility(store.db.sql, true);
  const destination = backupDirectoryOutside(store.root, directory);
  const target = path.join(
    destination,
    `${brand.name}备份_${new Date().toISOString().replace(/[:.]/g, '-')}_${id().slice(0, 8)}`
  );
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(target);
  // Existing readers can restore schema 1. Only a colliding author filename needs a separate payload.
  const schema = fs.readdirSync(store.root).some(name => name.toLowerCase() === manifestName) ? 2 : 1;
  const payload = schema === 2 ? path.join(target, 'files') : target;
  const manifest: { path: string; hash: string }[] = [];
  const checkpoint = target + '.pending.json';
  const saveCheckpoint = () => atomicWrite(checkpoint, JSON.stringify({ schema, projectId: store.db.project().id, manifest }));
  async function walk(dir: string, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (entry.isSymbolicLink()) continue;
      const rel = prefix + entry.name;
      if (/^\.novelclient\/(?:(?:state|lock-recovery)\.sqlite(?:-wal|-shm|-journal)?|write-lock\.json)$/i.test(rel)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel + '/');
      else {
        if (!entry.isFile()) throw new Error(`无法备份特殊文件：${rel}`);
        const bytes = fs.readFileSync(safePath(store.root, rel, true));
        durableCreate(path.join(payload, rel), bytes);
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
  const dbTarget = path.join(payload, '.novelclient/state.sqlite');
  fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
  await backup(store.db.sql, dbTarget);
  signal?.throwIfAborted();
  const copied = new DatabaseSync(dbTarget, { readOnly: true });
  try { verifyObjects(payload, copied); } finally { copied.close(); }
  manifest.push({ path: '.novelclient/state.sqlite', hash: fileHash(dbTarget)! });
  atomicWrite(
    path.join(target, manifestName),
    JSON.stringify({ schema, createdAt: now(), projectId: store.db.project().id, manifest }, null, 2)
  );
  fs.unlinkSync(checkpoint);
  return target;
}
export function restoreBackup(source: string, parent: string) {
  const result = backupManifest.safeParse(JSON.parse(fs.readFileSync(safePath(source, manifestName, true), 'utf8')));
  if (!result.success) throw new Error(`不是有效${brand.name}备份`);
  const { schema, manifest } = result.data;
  const payload = schema === 2 ? safePath(source, 'files', true) : source;
  const names = new Set(manifest.map(entry => entry.path));
  if (!names.has('.novelclient/state.sqlite'))
    throw new Error('备份缺少作品数据库');
  return createProjectDirectory(path.join(parent, `恢复的作品_${id()}`), staged => {
    for (const entry of manifest) {
      const file = safePath(payload, entry.path, true);
      if (!fs.lstatSync(file).isFile()) throw new Error(`备份文件无效：${entry.path}`);
      const bytes = fs.readFileSync(file);
      if (hash(bytes) !== entry.hash) throw new Error(`备份校验失败：${entry.path}`);
      durableCreate(safePath(staged, entry.path, true), bytes);
    }
    const database = safePath(staged, '.novelclient/state.sqlite', true);
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      checkDatabaseCompatibility(db, true);
      verifyObjects(staged, db, names);
    } finally { db.close(); }
  });
}
