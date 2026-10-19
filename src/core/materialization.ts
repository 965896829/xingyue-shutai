import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, durableCreate, fileHash, safePath, type FileStore } from './storage';
import { hash } from './domain';

export class MaterializationConflict extends Error {}
export function preserveAndMaterialize(store: FileStore, tx: string, change: { path: string; baseHash: string | null; newHash: string }, fault?: (point: string) => void) {
  const file = safePath(store.root, change.path);
  const prefix = `.novelclient/preserved/${tx}-${hash(change.path)}`;
  const previous = safePath(store.root, prefix + '.previous', true);
  const temporary = safePath(store.root, prefix + '.new', true);
  const currentHash = fileHash(file);
  if (currentHash === change.newHash) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.dirname(previous), { recursive: true });
  if (!fs.existsSync(previous)) {
    if (currentHash !== change.baseHash) throw new MaterializationConflict(`外部改稿已保留：${change.path}`);
    fault?.('before-replace:' + change.path);
    if (change.baseHash !== null) fs.renameSync(file, previous);
  }
  if (fs.existsSync(previous) && fileHash(previous) !== change.baseHash) {
    try { fs.linkSync(previous, file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    throw new MaterializationConflict(`文件替换期间发生外部改稿，原件保留于 ${prefix}.previous`);
  }
  if (fs.existsSync(file)) {
    if (fileHash(file) === change.newHash) return;
    throw new MaterializationConflict(`同步期间出现新文件，未覆盖：${change.path}`);
  }
  if (!fs.existsSync(temporary)) durableCreate(temporary, store.object(change.newHash));
  else if (fileHash(temporary) !== change.newHash) atomicWrite(temporary, store.object(change.newHash));
  if (fileHash(temporary) !== change.newHash) throw new MaterializationConflict(`待同步内容校验失败：${change.path}`);
  safePath(store.root, change.path);
  try { fs.linkSync(temporary, file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new MaterializationConflict(`同步期间出现外部文件，未覆盖：${change.path}`);
    throw error;
  }
  if (fileHash(file) !== change.newHash) throw new MaterializationConflict(`同步后文件又发生变化，已保留版本：${change.path}`);
  fs.unlinkSync(temporary);
}
