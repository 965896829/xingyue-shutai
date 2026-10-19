import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Service } from '../src/core/service';
import { FileStore } from '../src/core/storage';
import { newProject, hash } from '../src/core/domain';
import { ProjectRecycleBin } from '../src/core/recycle-bin';
import { createBackup, restoreBackup } from '../src/core/documents';
import { buildVersion } from '../src/shared/build';
import { resumeArguments } from '../src/shared/run-capabilities';
import { fakeProfile, fakeResult } from './fixtures/refactor';

test('T-001 version 2 identity survives trash, restore and backup without changing content', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-harness-'));
  const root = path.join(parent, '作品');
  fs.mkdirSync(root);
  const store = new FileStore(root);
  const project = newProject('版本二', root, {});
  project.schemaVersion = 2;
  store.commit([{ path: '正文.md', content: '原稿𠮷\r\n', baseHash: null }], project);
  const before = hash(fs.readFileSync(path.join(root, '正文.md')));
  const backup = await createBackup(store, path.join(parent, '备份'));
  store.close();
  const bin = new ProjectRecycleBin(path.join(parent, 'userdata'));
  bin.trash(root, project.title);
  const entry = bin.list()[0];
  const restored = bin.restore(entry.id);
  assert.equal(hash(fs.readFileSync(path.join(restored.root, '正文.md'))), before);
  const restoredBackup = restoreBackup(backup, parent);
  assert.equal(hash(fs.readFileSync(path.join(restoredBackup, '正文.md'))), before);
});

test('T-057 future project structure is rejected before SQLite mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-harness-'));
  fs.mkdirSync(path.join(root, '.novelclient'));
  const filename = path.join(root, '.novelclient/state.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=3');
  db.prepare('INSERT INTO kv VALUES(?,?)').run('project', JSON.stringify({ id: 'future', schemaVersion: 99 }));
  db.close();
  const before = hash(fs.readFileSync(filename));
  assert.throws(() => new FileStore(root), /版本/);
  assert.equal(hash(fs.readFileSync(filename)), before);
});

test('T-002 planning resume omits unsupported input and backend rejects forged instruction', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-harness-'));
  const service = new Service(path.resolve('resources/skill'), () => {});
  try {
    await service.invoke('project.create', {
      parent, title: '恢复测试', premise: '',
      tagInput: {
        selection: { reading: { main: 'reading.main.003', theme: [], role: [], plot: [] }, content: { plot: [], emotion: [], persona: [], world: [] } },
        premise: '维修师建立供水网络', mustKeep: [], mustAvoid: []
      }
    });
    const run = service.makeRun('stage', '规划');
    service.store!.db.saveRun(run);
    assert.equal('instruction' in resumeArguments(run, '继续'), false);
    await assert.rejects(service.invoke('run.resume', { id: run.id, instruction: '改变输入' }), /恢复只继续/);
    assert.equal(service.store!.db.run(run.id).messages.length, 0);
  } finally {
    service.close();
  }
});

test('T-003 diagnostics use the trusted build version', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-harness-'));
  const service = new Service(path.resolve('resources/skill'), () => {});
  try {
    await service.invoke('project.create', { parent, title: '诊断测试', premise: '合成数据' });
    const report = JSON.parse(await service.invoke('diagnostics.export'));
    assert.equal(report.version, buildVersion);
  } finally {
    service.close();
  }
});

test('旧总控规则下暂停的策划可直接继续，保留输入绑定与累计预算', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-planning-resume-'));
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => fakeResult());
  service.profiles = [{ ...fakeProfile, contextLimit: 200000 }];
  try {
    await service.invoke('project.create', {
      parent, title: '旧策划恢复', premise: '', config: { defaultProfileId: fakeProfile.id },
      tagInput: { selection: { reading: { main: 'reading.main.003', theme: [], role: [], plot: [] }, content: { plot: [], emotion: [], persona: [], world: [] } }, premise: '维修师建立供水网络', mustKeep: [], mustAvoid: [] }
    });
    const run = service.makeRun('stage', '规划');
    run.status = 'paused';
    run.agentRulesHash = 'old-controller';
    run.rounds = 2;
    run.toolCount = 3;
    service.store!.db.saveRun(run);
    const nextId = await service.invoke('run.resume', resumeArguments(run, ''));
    assert.notEqual(nextId, run.id);
    const next = service.store!.db.run(nextId);
    assert.equal(next.parentRunId, run.id);
    assert.equal(next.planning?.spec.inputHash, run.planning?.spec.inputHash);
    assert.equal(next.planning?.binding, run.planning?.binding);
    assert.ok(next.rounds >= run.rounds);
    assert.ok(next.toolCount >= run.toolCount);
    assert.equal(service.store!.db.run(run.id).status, 'discarded');
  } finally { await service.drain(); }
});
