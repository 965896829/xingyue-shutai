import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { paths } from '../src/core/domain';
import { ProjectRecycleBin, RETENTION_MS } from '../src/core/recycle-bin';
import { FileStore } from '../src/core/storage';

async function fixture() {
  const scope = path.resolve('.test-output/recycle-tests');
  fs.mkdirSync(scope, { recursive: true });
  const parent = fs.mkdtempSync(path.join(scope, 'case-'));
  const data = path.join(parent, 'appdata');
  const time = { now: Date.UTC(2026, 9, 8) };
  const bin = new ProjectRecycleBin(data, () => time.now);
  const service = new Service(path.resolve('resources/skill'), () => {});
  service.recycleBin = bin;
  await service.invoke('project.create', {
    parent,
    title: '回收验证',
    premise: '测试作品的原始设定，不能丢失。'
  });
  const root = service.store!.root;
  const original = fs.readFileSync(path.join(root, paths.seed), 'utf8');
  const candidate = service.makeRun('revision', '尚未接受的修改');
  candidate.changes = [service.change(paths.seed, '# 待审候选\n测试内容')];
  service.store!.db.saveRun(candidate);
  const payload = (id: string) => path.join(parent, '.文序回收站', id, '作品');
  function cleanup() {
    if (service.runner) service.runner.controller = null;
    service.coverController = null;
    service.close();
    // Explicit resolved scope check before every recursive test cleanup on Windows.
    assert.equal(path.dirname(fs.realpathSync(parent)), fs.realpathSync(scope));
    fs.rmSync(parent, { recursive: true, force: true });
  }
  return { parent, data, time, bin, service, root, original, candidate, payload, cleanup };
}

test('trash moves the complete book, restores manuscripts, candidates and revision history', async () => {
  const f = await fixture();
  try {
    const history = await f.service.invoke('document.history', { path: paths.seed });
    const snapshot = await f.service.invoke('project.trash', { root: f.root });
    assert.equal(snapshot.project, null);
    assert.equal(snapshot.recent.length, 0);
    const entry = f.bin.list()[0];
    assert.equal(entry.expiresAt - entry.deletedAt, RETENTION_MS);
    assert.equal(fs.existsSync(f.root), false);
    assert.equal(fs.readFileSync(path.join(f.payload(entry.id), paths.seed), 'utf8'), f.original);
    await assert.rejects(f.service.invoke('project.open', { root: f.payload(entry.id) }), /回收站恢复/);
    await f.service.invoke('project.restoreTrash', { id: entry.id });
    const restored = await f.service.invoke('project.open', { root: f.root });
    assert.equal(restored.runs[0].changes[0].content, f.candidate.changes[0].content);
    assert.deepEqual(await f.service.invoke('document.history', { path: paths.seed }), history);
    assert.equal(fs.readFileSync(path.join(f.root, paths.seed), 'utf8'), f.original);
    assert.equal(f.bin.list().length, 0);
  } finally {
    f.cleanup();
  }
});

test('a recreated book at the same path can be trashed and both versions restored independently', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const oldEntry = f.bin.list()[0];
    const created = await f.service.invoke('project.create', {
      parent: f.parent,
      title: oldEntry.title,
      premise: '同名新作品，内容需要独立保留。'
    });
    const newId = created.project!.id;
    const newContent = fs.readFileSync(path.join(f.root, paths.seed), 'utf8');
    assert.notEqual(newId, oldEntry.projectId);
    assert.deepEqual(created.recent, [{ root: f.root, title: oldEntry.title }]);
    const removed = await f.service.invoke('project.trash', { root: f.root });
    assert.equal(removed.project, null);
    assert.deepEqual(removed.recent, []);
    assert.equal(fs.existsSync(f.root), false);
    const entries = f.bin.list();
    assert.equal(entries.length, 2);
    const newEntry = entries.find((entry) => entry.projectId === newId)!;
    assert.notEqual(newEntry.id, oldEntry.id);
    assert.equal(fs.readFileSync(path.join(f.payload(oldEntry.id), paths.seed), 'utf8'), f.original);
    assert.equal(fs.readFileSync(path.join(f.payload(newEntry.id), paths.seed), 'utf8'), newContent);
    assert.throws(() => f.bin.trash(f.root, oldEntry.title), /已在回收站/);
    f.service.recycleBin = new ProjectRecycleBin(f.data, () => f.time.now);
    assert.deepEqual(f.service.snapshot().recent, []);
    await f.service.invoke('project.restoreTrash', { id: newEntry.id });
    const restoredNew = await f.service.invoke('project.open', { root: f.root });
    assert.equal(restoredNew.project!.id, newId);
    assert.equal(fs.readFileSync(path.join(f.root, paths.seed), 'utf8'), newContent);
    await assert.rejects(f.service.invoke('project.restoreTrash', { id: oldEntry.id }), /同名目录/);
    const alternate = path.join(f.parent, '旧作品恢复位置');
    fs.mkdirSync(alternate);
    await f.service.invoke('project.restoreTrash', { id: oldEntry.id, parent: alternate });
    const restoredRoot = path.join(alternate, path.basename(f.root));
    const restoredOld = await f.service.invoke('project.open', { root: restoredRoot });
    assert.equal(restoredOld.project!.id, oldEntry.projectId);
    assert.equal(fs.readFileSync(path.join(restoredRoot, paths.seed), 'utf8'), f.original);
    assert.equal(restoredOld.runs[0].changes[0].content, f.candidate.changes[0].content);
    assert.equal(f.service.recycleBin.list().length, 0);
  } finally {
    f.cleanup();
  }
});

test('expiry of an older same-path book preserves the later deleted book and its retention period', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const oldEntry = f.bin.list()[0];
    f.time.now += 24 * 60 * 60 * 1000;
    const created = await f.service.invoke('project.create', {
      parent: f.parent,
      title: oldEntry.title,
      premise: '旧作品过期时仍应保留的新作品。'
    });
    const newId = created.project!.id;
    const newContent = fs.readFileSync(path.join(f.root, paths.seed), 'utf8');
    await f.service.invoke('project.trash', { root: f.root });
    const newEntry = f.bin.list().find((entry) => entry.projectId === newId)!;
    assert.equal(newEntry.expiresAt - newEntry.deletedAt, RETENTION_MS);
    f.time.now = oldEntry.expiresAt;
    const reopened = new ProjectRecycleBin(f.data, () => f.time.now);
    reopened.sweep();
    assert.equal(fs.existsSync(f.payload(oldEntry.id)), false);
    assert.deepEqual(reopened.list().map((entry) => entry.id), [newEntry.id]);
    assert.equal(fs.readFileSync(path.join(f.payload(newEntry.id), paths.seed), 'utf8'), newContent);
    f.service.recycleBin = reopened;
    await f.service.invoke('project.restoreTrash', { id: newEntry.id });
    const restored = await f.service.invoke('project.open', { root: f.root });
    assert.equal(restored.project!.id, newId);
    assert.equal(fs.readFileSync(path.join(f.root, paths.seed), 'utf8'), newContent);
  } finally {
    f.cleanup();
  }
});

test('never purges before seven days; a fresh startup purges at expiry and preserves unrelated files', async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(path.join(f.parent, '独立备份.txt'), '保留');
    await f.service.invoke('project.trash', { root: f.root });
    const entry = f.bin.list()[0];
    f.time.now = entry.expiresAt - 1;
    f.bin.sweep();
    assert.equal(fs.existsSync(f.payload(entry.id)), true);
    f.time.now = entry.expiresAt;
    const reopened = new ProjectRecycleBin(f.data, () => f.time.now);
    reopened.sweep();
    assert.equal(reopened.list().length, 0);
    assert.equal(fs.existsSync(f.payload(entry.id)), false);
    assert.equal(fs.readFileSync(path.join(f.parent, '独立备份.txt'), 'utf8'), '保留');
    assert.equal(reopened.purgedDrafts()[0].projectId, entry.projectId);
    assert.equal(reopened.reconcileRecent([{ root: f.root, title: entry.title }]).length, 0);
  } finally {
    f.cleanup();
  }
});

test('active request, cover request, backup and unknown recent entry cannot be trashed', async () => {
  const f = await fixture();
  try {
    f.service.runner!.controller = new AbortController();
    await assert.rejects(f.service.invoke('project.trash', { root: f.root }), /停止当前任务/);
    f.service.runner!.controller = null;
    f.service.coverController = new AbortController();
    await assert.rejects(f.service.invoke('project.trash', { root: f.root }), /封面请求/);
    f.service.coverController = null;
    f.service.backingUp = true;
    await assert.rejects(f.service.invoke('project.trash', { root: f.root }), /一致备份/);
    f.service.backingUp = false;
    await assert.rejects(f.service.invoke('project.trash', { root: f.parent }), /不在最近列表/);
    assert.equal(f.bin.list().length, 0);
    assert.equal(fs.existsSync(f.root), true);
  } finally {
    f.cleanup();
  }
});

test('restore conflict never overwrites the new directory; another same-volume directory works', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const entry = f.bin.list()[0];
    fs.mkdirSync(f.root);
    fs.writeFileSync(path.join(f.root, 'keep.txt'), '不能覆盖');
    assert.throws(() => f.bin.restore(entry.id), /同名目录/);
    assert.equal(fs.readFileSync(path.join(f.root, 'keep.txt'), 'utf8'), '不能覆盖');
    const other = path.join(f.parent, '另一目录');
    fs.mkdirSync(other);
    const restored = f.bin.restore(entry.id, other);
    assert.equal(fs.readFileSync(path.join(restored.root, paths.seed), 'utf8'), f.original);
    assert.equal(f.bin.list().length, 0);
  } finally {
    f.cleanup();
  }
});

test('tampered ownership and junctions suspend destructive cleanup', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const entry = f.bin.list()[0];
    const marker = path.join(path.dirname(f.payload(entry.id)), 'entry.json');
    const original = fs.readFileSync(marker, 'utf8');
    fs.writeFileSync(
      marker,
      JSON.stringify({ id: 'wrong', projectId: entry.projectId, originalRoot: f.root })
    );
    f.time.now = entry.expiresAt;
    f.bin.sweep();
    assert.match(f.bin.list()[0].error!, /身份校验/);
    assert.equal(fs.existsSync(f.payload(entry.id)), true);
    fs.writeFileSync(marker, original);
    const outside = path.join(f.parent, '保留目录');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), '不能删');
    const link = path.join(f.payload(entry.id), 'linked');
    fs.symlinkSync(outside, link, 'junction');
    f.bin.sweep();
    assert.match(f.bin.list()[0].error!, /联接|符号链接/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), '不能删');
    fs.unlinkSync(link);
    f.bin.sweep();
    assert.equal(f.bin.list().length, 0);
  } finally {
    f.cleanup();
  }
});

test('another process lock keeps an expired book recoverable until the lock is released', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const entry = f.bin.list()[0];
    const held = new FileStore(f.payload(entry.id));
    try {
      f.time.now = entry.expiresAt;
      f.bin.sweep();
      assert.match(f.bin.list()[0].error!, /另一个窗口/);
    } finally {
      held.close();
    }
    f.bin.sweep();
    assert.equal(f.bin.list().length, 0);
  } finally {
    f.cleanup();
  }
});

test('journal recovers a completed move and a completed restore after interruption', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const entry = f.bin.list()[0];
    const file = f.bin.indexFile;
    const records = JSON.parse(fs.readFileSync(file, 'utf8'));
    records[0].state = 'moving';
    fs.writeFileSync(file, JSON.stringify(records));
    const recovered = new ProjectRecycleBin(f.data, () => f.time.now);
    recovered.sweep();
    assert.equal(recovered.list()[0].state, 'ready');
    records[0].state = 'restoring';
    records[0].restoreRoot = f.root;
    fs.writeFileSync(file, JSON.stringify(records));
    fs.renameSync(f.payload(entry.id), f.root);
    const restored = new ProjectRecycleBin(f.data, () => f.time.now);
    restored.sweep();
    assert.equal(restored.list().length, 0);
    assert.equal(restored.reconcileRecent([])[0].root, f.root);
    assert.equal(fs.readFileSync(path.join(f.root, paths.seed), 'utf8'), f.original);
  } finally {
    f.cleanup();
  }
});

test('partially interrupted purge resumes within the owned trash payload only', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const entry = f.bin.list()[0];
    const records = JSON.parse(fs.readFileSync(f.bin.indexFile, 'utf8'));
    records[0].state = 'purging';
    fs.writeFileSync(f.bin.indexFile, JSON.stringify(records));
    fs.unlinkSync(path.join(f.payload(entry.id), '.novelclient', 'state.sqlite'));
    f.time.now = entry.expiresAt;
    const reopened = new ProjectRecycleBin(f.data, () => f.time.now);
    reopened.sweep();
    assert.equal(reopened.list().length, 0);
    assert.equal(fs.existsSync(f.payload(entry.id)), false);
  } finally {
    f.cleanup();
  }
});

test('expiry does not invalidate editor drafts shared with a live restored backup', async () => {
  const f = await fixture();
  try {
    await f.service.invoke('project.trash', { root: f.root });
    const entry = f.bin.list()[0];
    await f.service.invoke('project.create', {
      parent: f.parent,
      title: '独立备份副本',
      premise: '保留这个副本的编辑草稿'
    });
    const copy = f.service.store!.db.project();
    copy.id = entry.projectId;
    f.service.store!.db.set('project', copy);
    f.time.now = entry.expiresAt;
    f.bin.sweep();
    assert.equal(f.bin.purgedDrafts(f.service.recent).length, 0);
    assert.equal(fs.existsSync(f.service.store!.root), true);
    assert.equal(f.bin.purgedDrafts([]).length, 1);
  } finally {
    f.cleanup();
  }
});
