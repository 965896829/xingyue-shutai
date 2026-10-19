import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FileStore } from '../src/core/storage';
import { hash } from '../src/core/domain';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { refactorFixture } from './fixtures/refactor';
import { interruptApprovedCommit } from './fixtures/recovery-conflict';

const approval = (store: FileStore, approvalId: string) =>
  JSON.parse(String(store.db.sql.prepare('SELECT data FROM approvals WHERE id=?').get(approvalId)!.data));
const applied = (store: FileStore) => Number(store.db.sql.prepare('SELECT COUNT(*) AS n FROM applied_transactions').get()!.n);

test('接受期间的外部改稿立即形成可处理冲突，不必重启才发现 prepared 日志', () => {
  const { store, root, project, run } = refactorFixture();
  const original = store.commit;
  try {
    const target = path.join(root, '正文.md');
    store.commit = function(changes, state, candidate, _fault, approvalId) {
      return original.call(this, changes, state, candidate, (point) => {
        if (point === 'prepared') fs.writeFileSync(target, '接受时作者正在外部改稿');
      }, approvalId);
    };
    assert.throws(() => new ProjectCommitService(store).commit(run.changes, { ...project, revision: 1 },
      { ...run, accepted: true, status: 'complete' }), /外部改稿/);
    const conflict = store.recoveryConflicts()[0];
    assert.equal(conflict.reason, 'external_edit');
    assert.equal(store.recoveryPreview(conflict.transactionId, '正文.md').candidate, '候选稿');
    assert.equal(store.db.project().revision, 0);
    assert.equal(applied(store), 1);
    assert.equal(fs.readFileSync(target, 'utf8'), '接受时作者正在外部改稿');
  } finally { store.commit = original; store.close(); }
});

test('prepared 提交遇外部改稿可打开正式版本并比较原提案，不消费批准或覆写字节', () => {
  const fixture = refactorFixture();
  let store = fixture.store;
  try {
    const prepared = interruptApprovedCommit(store, fixture.run, { ...fixture.project, revision: 1 });
    const target = path.join(fixture.root, '正文.md'), external = Buffer.from('外部改稿𠮷\r\n');
    fs.writeFileSync(target, external);
    store.close(); store = new FileStore(fixture.root);
    assert.doesNotThrow(() => store.recover());
    assert.equal(store.db.project().revision, 0);
    assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
    assert.equal(applied(store), 1);
    assert.equal(store.recoveryConflicts().length, 1);
    assert.equal(store.recoveryConflicts()[0].reason, 'external_edit');
    assert.equal(store.recoveryConflicts()[0].runId, fixture.run.id);
    assert.deepEqual(store.recoveryPreview(prepared.transactionId, '正文.md'), {
      path: '正文.md', accepted: '原稿𠮷\r\n', current: external.toString('utf8'), candidate: '候选稿'
    });
    assert.throws(() => store.recoveryPreview(prepared.transactionId, '.novelclient/state.sqlite'), /不在待处理提交/);
    assert.equal(approval(store, prepared.journal.approvalId).consumedByCommit, null);
    assert.equal(approval(store, prepared.journal.approvalId).revokedAt, null);
    assert.deepEqual(fs.readFileSync(prepared.file), prepared.bytes);
    assert.deepEqual(fs.readFileSync(target), external);
    assert.equal(store.retryRecovery(prepared.transactionId).recovered, false);
    assert.equal(applied(store), 1);
    assert.throws(() => store.commit([{ path: '新文件.md', content: '不能交织新提交', baseHash: null }],
      { ...fixture.project, revision: 1 }), /未处理的提交恢复冲突/);
    assert.equal(fs.existsSync(path.join(fixture.root, '新文件.md')), false);
  } finally { store.close(); }
});

test('冲突消失后重开仍保留待处理状态，作者显式恢复只生效一次', () => {
  const fixture = refactorFixture();
  let store = fixture.store;
  try {
    const prepared = interruptApprovedCommit(store, fixture.run, { ...fixture.project, revision: 1 });
    const target = path.join(fixture.root, '正文.md');
    fs.writeFileSync(target, '外部临时改稿');
    store.recover();
    fs.writeFileSync(target, '原稿𠮷\r\n');
    store.close(); store = new FileStore(fixture.root); store.recover();
    assert.equal(store.db.project().revision, 0);
    assert.equal(store.recoveryConflicts().length, 1);
    assert.equal(store.retryRecovery(prepared.transactionId).recovered, true);
    assert.equal(store.db.project().revision, 1);
    assert.equal(store.db.run(fixture.run.id).accepted, true);
    assert.equal(store.db.run(fixture.run.id).status, 'complete');
    assert.equal(store.readAccepted('正文.md').content, '候选稿');
    assert.equal(fs.readFileSync(target, 'utf8'), '候选稿');
    assert.equal(approval(store, prepared.journal.approvalId).consumedByCommit, prepared.transactionId);
    assert.equal(store.recoveryConflicts().length, 0);
    assert.equal(store.retryRecovery(prepared.transactionId).recovered, true);
    store.close(); store = new FileStore(fixture.root); store.recover();
    assert.equal(applied(store), 2);
    assert.equal(store.db.sql.prepare('SELECT COUNT(*) AS n FROM candidate_commits').get()!.n, 1);
    assert.equal(store.recoveryConflicts().length, 0);
  } finally { store.close(); }
});

test('放弃仅撤销未消费的批准并保留原日志、候选与外部文件，随后可以提出新提交', () => {
  const fixture = refactorFixture();
  let store = fixture.store;
  try {
    const prepared = interruptApprovedCommit(store, fixture.run, { ...fixture.project, revision: 1 });
    const target = path.join(fixture.root, '正文.md'), external = Buffer.from('作者保留这段外部正文\r\n');
    fs.writeFileSync(target, external);
    store.recover();
    store.abandonRecovery(prepared.transactionId);
    store.abandonRecovery(prepared.transactionId);
    assert.equal(store.recoveryConflicts().length, 0);
    assert.ok(approval(store, prepared.journal.approvalId).revokedAt);
    assert.equal(approval(store, prepared.journal.approvalId).consumedByCommit, null);
    assert.deepEqual(fs.readFileSync(prepared.file), prepared.bytes);
    assert.deepEqual(fs.readFileSync(target), external);
    assert.equal(store.object(prepared.journal.changes[0].newHash).toString('utf8'), '候选稿');
    assert.equal(store.db.run(fixture.run.id).accepted, false);
    assert.throws(() => store.retryRecovery(prepared.transactionId), /已放弃/);
    store.close(); store = new FileStore(fixture.root); store.recover();
    assert.equal(store.db.project().revision, 0);
    assert.equal(store.recoveryConflicts().length, 0);
    const run = store.db.run(fixture.run.id);
    run.changes = [{ path: '正文.md', baseHash: hash(external), content: '作者重新审阅后的正文' }];
    store.db.saveRun(run);
    new ProjectCommitService(store).commit(run.changes, { ...fixture.project, revision: 1 },
      { ...run, accepted: true, status: 'complete' });
    store.close(); store = new FileStore(fixture.root); store.recover();
    assert.equal(store.readAccepted('正文.md').content, '作者重新审阅后的正文');
    assert.equal(applied(store), 2);
    assert.deepEqual(fs.readFileSync(prepared.file), prepared.bytes);
  } finally { store.close(); }
});

test('显式恢复在数据库生效后中断，重开仅完成本地恢复并清除旧冲突', () => {
  const fixture = refactorFixture();
  let store = fixture.store;
  try {
    const prepared = interruptApprovedCommit(store, fixture.run, { ...fixture.project, revision: 1 });
    const target = path.join(fixture.root, '正文.md');
    fs.writeFileSync(target, '外部待比较内容'); store.recover();
    fs.writeFileSync(target, '原稿𠮷\r\n');
    const materialize = store.materialize;
    store.materialize = function(transactionId, fault) {
      if (transactionId === prepared.transactionId) throw new Error('fixture interruption after recovery database commit');
      return materialize.call(this, transactionId, fault);
    };
    assert.throws(() => store.retryRecovery(prepared.transactionId), /fixture interruption/);
    assert.equal(store.db.project().revision, 1);
    assert.equal(store.recoveryConflicts().length, 1);
    store.materialize = materialize;
    store.close(); store = new FileStore(fixture.root); store.recover();
    assert.equal(store.recoveryConflicts().length, 0);
    assert.equal(store.db.project().revision, 1);
    assert.equal(applied(store), 2);
    assert.equal(fs.readFileSync(target, 'utf8'), '候选稿');
    assert.equal(store.retryRecovery(prepared.transactionId).recovered, true);
    assert.equal(applied(store), 2);
  } finally { store.close(); }
});

test('旧快照提交保持冲突，重试不会覆盖已经生效的新快照', () => {
  const { store, project, run } = refactorFixture();
  try {
    const prepared = interruptApprovedCommit(store, run, { ...project, revision: 1 });
    store.commit([{ path: '已生效的补充.md', content: '另一次作者确认', baseHash: null }], { ...project, revision: 1 });
    const head = store.db.get('headSnapshot');
    store.recover();
    assert.equal(store.recoveryConflicts()[0].reason, 'snapshot_changed');
    assert.equal(store.retryRecovery(prepared.transactionId).recovered, false);
    assert.equal(store.db.get('headSnapshot'), head);
    assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
    assert.equal(store.readAccepted('已生效的补充.md').content, '另一次作者确认');
    assert.equal(applied(store), 2);
  } finally { store.close(); }
});

test('任务状态或候选改变使原批准保持冲突，预览仍展示 prepared 原提案', () => {
  const { store, root, project, run } = refactorFixture();
  try {
    const prepared = interruptApprovedCommit(store, run, { ...project, revision: 1 });
    run.status = 'paused'; store.db.saveRun(run);
    store.recover();
    assert.equal(store.recoveryConflicts()[0].reason, 'candidate_changed');
    run.changes[0].content = '后来修改但尚未批准的候选'; store.db.saveRun(run);
    assert.equal(store.recoveryPreview(prepared.transactionId, '正文.md').candidate, '候选稿');
    assert.equal(store.retryRecovery(prepared.transactionId).recovered, false);
    assert.equal(store.db.run(run.id).changes[0].content, '后来修改但尚未批准的候选');
    assert.equal(store.db.run(run.id).status, 'paused');
    assert.equal(store.db.project().revision, 0);
    assert.equal(fs.readFileSync(path.join(root, '正文.md'), 'utf8'), '原稿𠮷\r\n');
    assert.equal(approval(store, prepared.journal.approvalId).consumedByCommit, null);
  } finally { store.close(); }
});

test('已撤销批准可作为冲突展示，但不能重新签发或自动消费', () => {
  const { store, project, run } = refactorFixture();
  try {
    const prepared = interruptApprovedCommit(store, run, { ...project, revision: 1 });
    const record = approval(store, prepared.journal.approvalId);
    record.revokedAt = new Date().toISOString();
    store.db.sql.prepare('UPDATE approvals SET data=? WHERE id=?').run(JSON.stringify(record), prepared.journal.approvalId);
    store.recover();
    assert.equal(store.recoveryConflicts()[0].reason, 'approval_changed');
    assert.equal(store.retryRecovery(prepared.transactionId).recovered, false);
    assert.deepEqual(approval(store, prepared.journal.approvalId), record);
    assert.equal(applied(store), 1);
    store.abandonRecovery(prepared.transactionId);
    assert.deepEqual(approval(store, prepared.journal.approvalId), record);
  } finally { store.close(); }
});

for (const damage of ['payload', 'envelope', 'object', 'approval', 'missing_journal'] as const)
  test(`已记录外部冲突仍核验 ${damage} 完整性，损坏不会被降级成可重试冲突`, () => {
    const { store, root, project, run } = refactorFixture();
    try {
      const prepared = interruptApprovedCommit(store, run, { ...project, revision: 1 });
      const target = path.join(root, '正文.md'), external = Buffer.from('不可覆盖的外部原稿\r\n');
      fs.writeFileSync(target, external);
      store.recover();
      if (damage === 'payload') {
        prepared.journal.changes[0].newHash = store.putObject('被偷换的提案');
        fs.writeFileSync(prepared.file, JSON.stringify(prepared.journal));
      } else if (damage === 'envelope') {
        prepared.journal.run.stateVersion = (prepared.journal.run.stateVersion ?? 0) + 1;
        fs.writeFileSync(prepared.file, JSON.stringify(prepared.journal));
      } else if (damage === 'object') {
        fs.writeFileSync(path.join(root, '.novelclient/objects', prepared.journal.changes[0].newHash), '损坏对象');
      } else if (damage === 'approval') {
        const record = approval(store, prepared.journal.approvalId); record.commitHash = 'wrong';
        store.db.sql.prepare('UPDATE approvals SET data=? WHERE id=?').run(JSON.stringify(record), prepared.journal.approvalId);
      } else fs.unlinkSync(prepared.file);
      assert.throws(() => store.recover(), /不一致|校验失败|日志缺失/);
      assert.throws(() => store.retryRecovery(prepared.transactionId));
      assert.throws(() => store.abandonRecovery(prepared.transactionId));
      assert.equal(store.db.project().revision, 0);
      assert.equal(applied(store), 1);
      assert.deepEqual(fs.readFileSync(target), external);
    } finally { store.close(); }
  });
