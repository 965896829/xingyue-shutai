import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { interruptApprovedCommit } from './fixtures/recovery-conflict';
import { refactorFixture } from './fixtures/refactor';

const skill = path.resolve('resources/skill');

test('冲突作品可通过 IPC 打开与比较，明确重试才恢复原批准提交', async () => {
  const { root, store, project, run } = refactorFixture();
  const original = fs.readFileSync(path.join(root, '正文.md'));
  const prepared = interruptApprovedCommit(store, run, { ...project, revision: project.revision + 1 });
  fs.writeFileSync(path.join(root, '正文.md'), '作者在客户端外修改的正文');
  store.close();
  let modelCalls = 0;
  const service = new Service(skill, () => {}, async () => { modelCalls++; throw new Error('不应调用模型'); });
  try {
    const opened = await service.invoke('project.open', { root });
    assert.equal(opened.project?.revision, project.revision);
    assert.equal(opened.studio?.recoveryConflicts?.[0].reason, 'external_edit');
    const preview = await service.invoke('recovery.preview', { transactionId: prepared.transactionId, path: '正文.md' });
    assert.equal(preview.accepted, original.toString('utf8'));
    assert.equal(preview.current, '作者在客户端外修改的正文');
    assert.equal(preview.candidate, '候选稿');
    await assert.rejects(service.invoke('recovery.preview', { transactionId: prepared.transactionId, path: '../其他作品.md' }), /不在待处理提交/);
    const blocked = await service.invoke('recovery.retry', { transactionId: prepared.transactionId });
    assert.equal(blocked.recoveryConflicts?.length, 1);
    assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), preview.current);
    fs.writeFileSync(path.join(root, '正文.md'), original);
    const resolved = await service.invoke('recovery.retry', { transactionId: prepared.transactionId });
    assert.deepEqual(resolved.recoveryConflicts, []);
    assert.equal(service.store!.db.project().revision, project.revision + 1);
    assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '候选稿');
    const again = await service.invoke('recovery.retry', { transactionId: prepared.transactionId });
    assert.deepEqual(again.recoveryConflicts, []);
    assert.equal(service.store!.db.project().revision, project.revision + 1);
    assert.equal(modelCalls, 0);
  } finally { service.close(); }
});

test('IPC 放弃恢复保留候选与外部文件，重新打开不重放该提交', async () => {
  const { root, store, project, run } = refactorFixture();
  const prepared = interruptApprovedCommit(store, run, { ...project, revision: project.revision + 1 });
  fs.writeFileSync(path.join(root, '正文.md'), '应保留的外部原稿');
  store.close();
  const service = new Service(skill, () => {});
  try {
    await service.invoke('project.open', { root });
    const state = await service.invoke('recovery.abandon', { transactionId: prepared.transactionId });
    assert.deepEqual(state.recoveryConflicts, []);
    assert.equal(service.store!.db.run(run.id).changes[0].content, '候选稿');
    assert.deepEqual(fs.readFileSync(prepared.file), prepared.bytes);
    const reopened = await service.invoke('project.open', { root });
    assert.equal(reopened.project?.revision, project.revision);
    assert.deepEqual(reopened.studio?.recoveryConflicts, []);
    assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '应保留的外部原稿');
    await assert.rejects(service.invoke('recovery.retry', { transactionId: prepared.transactionId }), /已放弃/);
  } finally { service.close(); }
});
