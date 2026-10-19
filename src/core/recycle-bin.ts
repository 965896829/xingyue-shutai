import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { atomicWrite, FileStore } from './storage';
import { checkDatabaseCompatibility } from './compatibility';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BIN = '.文序回收站';
const recordSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().min(1),
    title: z.string().min(1),
    originalRoot: z.string().min(1),
    deletedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    state: z.enum(['moving', 'ready', 'restoring', 'restored', 'purging', 'purged']),
    restoreRoot: z.string().optional(),
    error: z.string().optional()
  })
  .refine((r) => r.expiresAt === r.deletedAt + RETENTION_MS, '回收站保留时间记录不完整，停止自动清理');
export type TrashRecord = z.infer<typeof recordSchema>;
export function isRecyclePath(root: string) {
  return path.resolve(root).split(path.sep).includes(BIN);
}
export function samePath(a: string, b: string) {
  const normalize = (p: string) =>
    process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  return normalize(a) === normalize(b);
}
// Every move/delete checks resolved ancestry. Never traverse junctions or symlinks.
function checked(root: string) {
  if (!path.isAbsolute(root)) throw new Error('回收站记录路径必须是绝对路径');
  let current = path.parse(root).root;
  for (const part of path.resolve(root).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error('回收站路径包含符号链接或目录联接，已停止操作');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return path.resolve(root);
}
function projectId(root: string) {
  const file = checked(path.join(root, '.novelclient', 'state.sqlite'));
  if (!fs.existsSync(file)) throw new Error('作品数据库不存在，已停止操作');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return checkDatabaseCompatibility(db, true).project!.id;
  } finally {
    db.close();
  }
}
function assertNoLinks(root: string) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error('作品包含目录联接或符号链接，不能自动清理');
  if (stat.isDirectory()) for (const child of fs.readdirSync(root)) assertNoLinks(path.join(root, child));
}
function removeOwnedTree(root: string, target = root) {
  const relative = path.relative(root, checked(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('清理范围超出回收站作品');
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('清理途中发现目录联接，已停止');
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) removeOwnedTree(root, path.join(target, name));
    fs.rmdirSync(target);
  } else fs.unlinkSync(target);
}
function assertUnlocked(root: string) {
  const lock = path.join(root, '.novelclient', 'write-lock.json');
  if (!fs.existsSync(lock)) return;
  const { pid } = JSON.parse(fs.readFileSync(checked(lock), 'utf8'));
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw e;
  }
  throw new Error('这部作品正在另一个窗口或进程中打开，暂缓清理');
}

export class ProjectRecycleBin {
  private records: TrashRecord[];
  readonly indexFile: string;
  constructor(
    readonly dataRoot: string,
    private clock: () => number = Date.now
  ) {
    this.indexFile = path.join(dataRoot, 'recycle-bin.json');
    this.records = fs.existsSync(this.indexFile)
      ? z.array(recordSchema).parse(JSON.parse(fs.readFileSync(this.indexFile, 'utf8')))
      : [];
  }
  private save() {
    atomicWrite(this.indexFile, JSON.stringify(this.records, null, 2));
  }
  private locations(record: TrashRecord) {
    const root = checked(record.originalRoot);
    if (root === path.parse(root).root || isRecyclePath(root)) throw new Error('无效的原作品目录');
    const parent = checked(path.dirname(root));
    const bin = checked(path.join(parent, BIN));
    const entry = checked(path.join(bin, record.id));
    const payload = checked(path.join(entry, '作品'));
    if (path.dirname(entry) !== bin || path.dirname(payload) !== entry)
      throw new Error('回收站路径越界，已停止操作');
    return { root, parent, bin, entry, payload, marker: path.join(entry, 'entry.json') };
  }
  private owned(record: TrashRecord) {
    const p = this.locations(record);
    const marker = JSON.parse(fs.readFileSync(checked(p.marker), 'utf8'));
    if (
      marker.id !== record.id ||
      marker.projectId !== record.projectId ||
      !samePath(marker.originalRoot, record.originalRoot)
    )
      throw new Error('回收站目录身份校验失败，已停止操作');
    return p;
  }
  list(): TrashRecord[] {
    return this.records.filter((r) => !['restored', 'purged'].includes(r.state)).map((r) => ({ ...r }));
  }
  purgedDrafts(recent: { root: string }[] = []) {
    // Legacy editor caches use project ID, which can also belong to a restored backup.
    // Keep shared drafts while another live copy is registered; its files are independent.
    return this.records
      .filter((r) => r.state === 'purged')
      .filter(
        (r) =>
          !recent.some((entry) => {
            if (!fs.existsSync(entry.root)) return false;
            try {
              return projectId(entry.root) === r.projectId;
            } catch {
              return true;
            }
          })
      )
      .map((r) => ({ entryId: r.id, projectId: r.projectId }));
  }
  reconcileRecent(recent: { root: string; title: string }[]) {
    const held = this.records.filter((r) => r.state !== 'restored');
    const restored = this.records
      .filter((r) => r.state === 'restored' && r.restoreRoot && fs.existsSync(r.restoreRoot))
      .filter((r) => !recent.some((entry) => samePath(entry.root, r.restoreRoot!)))
      .filter((r) => {
        try {
          return projectId(r.restoreRoot!) === r.projectId;
        } catch {
          return false;
        }
      })
      .map((r) => ({ root: r.restoreRoot!, title: r.title }));
    return [...recent, ...restored]
      .filter(
        (r, i, all) =>
          !held.some(
            (t) =>
              samePath(t.originalRoot, r.root) &&
              (!fs.existsSync(r.root) ||
                (t.state !== 'purged' &&
                  (() => {
                    try {
                      return projectId(r.root) === t.projectId;
                    } catch {
                      return false;
                    }
                  })()))
          ) && all.findIndex((v) => samePath(v.root, r.root)) === i
      )
      .slice(0, 20);
  }
  trash(root: string, title: string): TrashRecord {
    root = checked(path.resolve(root));
    const previous = this.records.filter(
      (r) => !['restored', 'purged'].includes(r.state) && samePath(r.originalRoot, root)
    );
    if (isRecyclePath(root) || (previous.length > 0 && !fs.existsSync(root)))
      throw new Error('这部作品已在回收站中');
    const identity = projectId(root);
    if (previous.some((r) => r.projectId === identity)) throw new Error('这部作品已在回收站中');
    const store = new FileStore(root); // Checks the existing project write lock before moving.
    store.close();
    const deletedAt = this.clock();
    const record: TrashRecord = {
      id: randomUUID(),
      projectId: identity,
      title,
      originalRoot: root,
      deletedAt,
      expiresAt: deletedAt + RETENTION_MS,
      state: 'moving'
    };
    const p = this.locations(record);
    if (!fs.existsSync(p.parent)) throw new Error('作品所在磁盘不可用');
    fs.mkdirSync(p.bin, { recursive: true });
    fs.mkdirSync(p.entry); // A unique, same-volume destination; never overwrite an existing entry.
    atomicWrite(p.marker, JSON.stringify({ id: record.id, projectId: identity, originalRoot: root }));
    this.records.push(record);
    this.save(); // The journal precedes the directory rename.
    try {
      this.owned(record);
      fs.renameSync(p.root, p.payload);
      record.state = 'ready';
      this.save();
      return { ...record };
    } catch (e) {
      record.error = (e as Error).message;
      // A rename that failed leaves the source intact; an interrupted successful rename is
      // recovered from the moving record on the next sweep. Never erase either side here.
      try {
        this.save();
      } catch {
        /* preserve the prior journal on disk */
      }
      throw e;
    }
  }
  restore(id: string, parent?: string) {
    const record = this.records.find((r) => r.id === id && !['restored', 'purged'].includes(r.state));
    if (!record) throw new Error('回收站项目不存在');
    if (record.state === 'purging') throw new Error('到期清理已经开始，不能恢复不完整作品');
    if (this.clock() >= record.expiresAt) throw new Error('七天保留期已到，请刷新回收站查看清理结果');
    const p = this.owned(record);
    if (projectId(p.payload) !== record.projectId) throw new Error('回收站内作品身份不一致');
    const target = checked(parent ? path.join(path.resolve(parent), path.basename(p.root)) : p.root);
    if (!samePath(path.parse(target).root, path.parse(p.payload).root))
      throw new Error('请选择原作品所在磁盘的目录恢复；跨磁盘迁移请在恢复后使用备份功能');
    if (isRecyclePath(target)) throw new Error('不能恢复到回收站内部');
    if (!fs.existsSync(path.dirname(target))) throw new Error('原目录不可用，请选择其他目录恢复');
    if (fs.existsSync(target))
      throw new Error('恢复位置已存在同名目录，请选择其他目录恢复；不会覆盖已有内容');
    const store = new FileStore(p.payload);
    store.close();
    record.state = 'restoring';
    record.restoreRoot = target;
    delete record.error;
    this.save();
    fs.renameSync(p.payload, target);
    record.state = 'restored';
    this.save();
    try {
      fs.unlinkSync(p.marker);
      fs.rmdirSync(p.entry);
    } catch {
      /* only optional empty metadata cleanup */
    }
    return { root: target, title: record.title };
  }
  sweep() {
    let changed = false;
    for (const record of [...this.records]) {
      if (['restored', 'purged'].includes(record.state)) continue;
      const before = JSON.stringify(record);
      try {
        const p = this.owned(record);
        if (record.state === 'moving') {
          if (fs.existsSync(p.payload) && !fs.existsSync(p.root)) {
            if (projectId(p.payload) !== record.projectId) throw new Error('移动后的作品身份不一致');
            record.state = 'ready';
          } else if (!fs.existsSync(p.payload) && fs.existsSync(p.root)) {
            // Failed before the move: return the project to the list; leave the original alone.
            this.records = this.records.filter((r) => r.id !== record.id);
            changed = true;
            this.save();
            continue;
          } else throw new Error('移动状态不明确，请检查原目录和回收站；未自动删除文件');
        }
        if (record.state === 'restoring') {
          const target = checked(record.restoreRoot!);
          if (!fs.existsSync(p.payload) && fs.existsSync(target) && projectId(target) === record.projectId) {
            record.state = 'restored';
            changed = true;
            this.save();
            continue;
          }
          if (fs.existsSync(p.payload)) {
            record.state = 'ready';
            delete record.restoreRoot;
          } else throw new Error('恢复状态不明确，未自动清理');
        }
        if (record.state !== 'purging' && this.clock() < record.expiresAt) {
          if (record.error) delete record.error;
          if (before !== JSON.stringify(record)) {
            changed = true;
            this.save();
          }
          continue;
        }
        if (fs.existsSync(p.payload)) {
          // Before the first destructive pass, verify identity and ensure no process holds the book.
          if (record.state !== 'purging') {
            if (projectId(p.payload) !== record.projectId) throw new Error('到期作品身份不一致');
            const store = new FileStore(p.payload);
            store.close();
          }
          assertNoLinks(p.payload);
          assertUnlocked(p.payload);
          record.state = 'purging';
          delete record.error;
          this.save();
          // The checked, owned payload is an exact child of this entry's private trash folder.
          this.owned(record);
          // Node 24.11.1 on this Win10 host silently leaves non-ASCII rmSync roots behind.
          // Use the Unicode-safe individual operations and verify the final filesystem state.
          removeOwnedTree(p.payload);
          if (fs.existsSync(p.payload)) throw new Error('回收站目录仍存在，保留清理记录以便重试');
        }
        record.state = 'purged';
        delete record.error;
        this.save();
        changed = true;
        // Remove only the two known empty control paths. Unknown files are never swept here.
        fs.unlinkSync(p.marker);
        try {
          fs.rmdirSync(p.entry);
        } catch {
          /* unknown files: preserve */
        }
      } catch (e) {
        const error = (e as Error).message;
        if (record.error !== error) {
          record.error = error;
          changed = true;
        }
        this.save();
      }
    }
    return changed;
  }
}
