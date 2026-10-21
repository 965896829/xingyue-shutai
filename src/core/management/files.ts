import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { FileSelection, LocalFileList } from '../../shared/management';

function localPath(value: string) {
  if (
    !path.isAbsolute(value) ||
    value.includes('\0') ||
    /^[/\\]{2}/.test(value) ||
    (process.platform === 'win32' && /:/.test(value.slice(2)))
  )
    throw new Error('请选择本机磁盘的绝对路径');
  return path.resolve(value);
}
export async function localRoots() {
  if (process.platform !== 'win32') return [os.homedir(), '/'];
  const candidates = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`);
  const found = await Promise.all(
    candidates.map(async (root) => {
      try {
        await fs.access(root);
        return root;
      } catch {
        return null;
      }
    })
  );
  return found.filter((root): root is string => root !== null);
}
export async function listLocalFiles(input?: string): Promise<LocalFileList> {
  const directory = await fs.realpath(localPath(input || os.homedir()));
  localPath(directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const visible = entries
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN')
    );
  return {
    path: directory,
    parent: path.dirname(directory) === directory ? null : path.dirname(directory),
    roots: await localRoots(),
    truncated: visible.length > 1000,
    entries: visible
      .slice(0, 1000)
      .map((entry) => ({
        name: entry.name,
        path: path.join(directory, entry.name),
        directory: entry.isDirectory()
      }))
  };
}
export async function validateLocalSelection(selection: FileSelection) {
  const selected = localPath(selection.path);
  if (selection.mode === 'save') {
    const parent = await fs.realpath(path.dirname(selected));
    localPath(parent);
    const basename = path.basename(selected);
    if (
      process.platform === 'win32' &&
      /[<>:"|?*]|[. ]$|^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(basename)
    )
      throw new Error('文件名无效');
    const target = path.join(parent, basename);
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('目标必须是普通文件');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return target;
  }
  const actual = await fs.realpath(selected);
  localPath(actual);
  const stat = await fs.stat(actual);
  if (selection.mode === 'directory' ? !stat.isDirectory() : !stat.isFile())
    throw new Error(selection.mode === 'directory' ? '请选择文件夹' : '请选择文件');
  return actual;
}
export async function makeLocalDirectory(parent: string, name: string) {
  if (
    !name.trim() ||
    name === '.' ||
    name === '..' ||
    /[/\\\0]/.test(name) ||
    (process.platform === 'win32' && /[<>:"|?*]|[. ]$|^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(name))
  )
    throw new Error('文件夹名称无效');
  const directory = await validateLocalSelection({ mode: 'directory', path: parent });
  const target = path.join(directory, name);
  await fs.mkdir(target);
  return target;
}
