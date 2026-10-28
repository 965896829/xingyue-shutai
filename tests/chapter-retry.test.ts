import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { RequestError } from '../src/core/provider';
import { needsNewChapterCandidate } from '../src/shared/task-revision';
import { createChapterRetryFixture } from './fixtures/chapter-retry';
import { fakeProfile, isolatedRoot } from './fixtures/refactor';

async function setup() {
  let calls = 0;
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => {
    calls++;
    throw new RequestError('离线测试在新正文请求处结束', false);
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 4096 }];
  const state = await createChapterRetryFixture(service, isolatedRoot('chapter-retry'), fakeProfile.id);
  return { ...state, service, calls: () => calls };
}
async function done(service: Service) {
  for (let at = 0; at < 2000; at++) {
    if (!service.runner?.controller && !service.chat?.controller) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Offline request did not finish');
}

test('确认重写已耗尽轮数的章节建立新候选，旧稿、费用和上限保留，重复点击不重发', async () => {
  const f = await setup();
  try {
    const before = structuredClone(f.service.store!.db.run(f.run.id));
    const docHash = f.service.store!.db.document(f.prose.path)?.hash;
    const result = await f.service.invoke('proposal.confirm', { id: f.proposal.id, version: f.proposal.version });
    assert.notEqual(result.id, f.run.id);
    await done(f.service);
    const next = f.service.store!.db.run(result.id), old = f.service.store!.db.run(f.run.id);
    assert.equal(f.calls(), 1, next.error ?? '新候选应发送一次正文请求');
    assert.equal(next.rounds, 1);
    assert.equal(next.pipeline!.phase, 'prose');
    assert.equal(next.parentRunId, old.id);
    assert.ok(next.usage.cost! >= 0.25, '新候选不能清空历史费用');
    assert.equal(old.rounds, 12); assert.equal(old.toolCount, 7);
    assert.deepEqual(old.changes, before.changes);
    assert.equal(old.status, 'discarded');
    assert.equal(f.service.store!.db.project().stage, 'S10');
    assert.equal(f.service.store!.db.project().config.maxRounds, 12);
    assert.equal(f.service.store!.db.document(f.prose.path)?.hash, docHash);
    assert.equal(f.service.chat!.records.get('conversations', f.conversation.id).runId, next.id);
    const again = await f.service.invoke('proposal.confirm', { id: f.proposal.id, version: f.proposal.version });
    assert.equal(again.id, next.id); assert.equal(f.calls(), 1);
  } finally { await f.service.drain(); }
});

test('普通恢复仍保留累计上限，不因上下文重建获得新请求额度', async () => {
  const f = await setup();
  try {
    const rebuilt = f.service.rebuildRun(f.run, fakeProfile.id);
    assert.equal(rebuilt.rounds, 12); assert.equal(rebuilt.toolCount, 7);
    await f.service.runner!.drive(rebuilt.id);
    assert.equal(f.calls(), 0);
  } finally { await f.service.drain(); }
});

test('未知结果仍要求确认，有限费用预算不会被新的章节候选绕过', async () => {
  const f = await setup();
  try {
    const run = f.service.store!.db.run(f.run.id);
    run.status = 'unknown'; run.error = '上次请求结果与费用未知';
    f.service.store!.db.saveRun(run);
    const proposal = f.service.chat!.propose(f.conversation.id, '', fakeProfile.id, f.proposal);
    await assert.rejects(f.service.invoke('proposal.confirm', { id: proposal.id, version: proposal.version }), /结果与费用未知/);
    assert.equal(f.calls(), 0);
    assert.equal(f.service.store!.db.runs().length, 1);
  } finally { await f.service.drain(); }
  const limited = await setup();
  try {
    const p = limited.service.store!.db.project();
    p.config.stageBudget = 0.1; limited.service.store!.db.set('project', p);
    limited.service.profiles[0].inputPrice = 0; limited.service.profiles[0].outputPrice = 0;
    await limited.service.invoke('proposal.confirm', { id: limited.proposal.id, version: limited.proposal.version });
    await done(limited.service);
    assert.equal(limited.calls(), 0, '旧费用超过预算时不能继续发送');
  } finally { await limited.service.drain(); }
});

test('新候选判定不影响其他阶段、未耗尽任务或已经采纳的章节', async () => {
  const f = await setup();
  try {
    assert.equal(needsNewChapterCandidate(f.run, f.p.config), true);
    assert.equal(needsNewChapterCandidate({ ...f.run, rounds: 0, toolCount: f.p.config.maxTools }, f.p.config), true);
    for (const patch of [{ stage: 'S08' as const }, { accepted: true }, { rounds: 0, toolCount: 0 }])
      assert.equal(needsNewChapterCandidate({ ...f.run, ...patch }, f.p.config), false);
  } finally { await f.service.drain(); }
});
