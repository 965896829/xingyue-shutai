import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareDocumentDrafts, maxDraftChunk } from '../src/core/runtime/document-drafts';
import { refactorFixture, fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { Service } from '../src/core/service';
import { stageOutputs, batchPath, activeBatch, hash } from '../src/core/domain';
import { RequestError, requestBody } from '../src/core/provider';
import { profileSchema, type StageId } from '../src/shared/types';
import { AgentRunner } from '../src/core/runner';
import { proposalHash } from '../src/core/storage';

test('整份候选的冗余final:true不触发重写，未完成标记和草稿版本仍严格校验', () => {
  const { store, run } = refactorFixture();
  try {
    run.stage = 'S05'; run.mode = 'stage';
    const content = '# 分卷大纲\n\n' + '已有完整内容，不应为删除标记而重新生成。'.repeat(420);
    const full = { path: '05_长篇大纲/分卷大纲.md', baseHash: null, content };
    assert.deepEqual(prepareDocumentDrafts(run, [{ ...full, final: true }]).completed, [full]);
    assert.deepEqual(prepareDocumentDrafts(run, [{ ...full, append: false, final: true }]).completed, [full]);
    assert.throws(() => prepareDocumentDrafts(run, [{ ...full, final: false }]), /未完成内容/);
    run.documentDrafts = [{ ...full, hash: hash(content), chunks: 1 }];
    assert.throws(() => prepareDocumentDrafts(run, [{ ...full, final: true, draftHash: 'stale' }]), /草稿版本/);
    assert.equal(run.documentDrafts[0].content, content);
    assert.deepEqual(prepareDocumentDrafts(run, [{ ...full, final: true, draftHash: hash(content) }]).completed, [full]);
  } finally { store.close(); }
});

test('完整S05带final:true只需一次生成，按原校验进入审阅且不自动采纳', async () => {
  let calls = 0;
  const service: Service = new Service(path.resolve('resources/skill'), () => {}, async () => {
    calls++;
    const p = service.store!.db.project(), file = stageOutputs('S05', p)[0];
    return { ...fakeResult(''), calls: [{ id: crypto.randomUUID(), name: 'propose_changes',
      arguments: JSON.stringify({ changes: [{ ...service.change(file, fixture(p, file, service)), final: true }] }) }], stop: 'tools' };
  });
  service.profiles = [{ ...fakeProfile, outputLimit: 20000, contextLimit: 200000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('full-final'), title: '完整候选验证', premise: '调查员寻找死亡权', config: { defaultProfileId: fakeProfile.id } });
    const p = service.store!.db.project(); p.stage = 'S05'; service.store!.db.set('project', p);
    const run = service.makeRun('stage', '生成完整分卷大纲');
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const done = service.store!.db.run(run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(calls, 1); assert.equal(done.rounds, 1); assert.equal(done.accepted, false);
    assert.equal(done.issues.filter(i => i.severity === 'error').length, 0);
  } finally { await service.drain(); }
});

test('分段保存要求精确草稿版本，拒绝重复、路径别名、过长和跨阶段写入', () => {
  const { store, run } = refactorFixture();
  try {
    run.stage = 'S08'; run.mode = 'stage';
    const part = { path: '06_章节设计/第001-030章细纲.md', baseHash: null, content: '# 第一段\n', append: true, final: false, draftHash: null };
    const first = prepareDocumentDrafts(run, [part]);
    assert.equal(first.completed.length, 0); assert.equal(run.documentDrafts, undefined);
    run.documentDrafts = first.drafts;
    assert.throws(() => prepareDocumentDrafts(run, [part]), /草稿版本/);
    assert.throws(() => prepareDocumentDrafts(run, [{ ...part, draftHash: first.drafts[0].hash, content: 'x'.repeat(maxDraftChunk + 1) }]), /每段/);
    assert.throws(() => prepareDocumentDrafts(run, [{ ...part, path: part.path.replaceAll('/', '\\'), draftHash: first.drafts[0].hash }]), /原始文件路径/);
    assert.throws(() => prepareDocumentDrafts(run, [part, part]), /草稿版本|重复/);
    const second = prepareDocumentDrafts(run, [{ ...part, content: '## 结束\n', draftHash: first.drafts[0].hash, final: true }]);
    assert.deepEqual(second.drafts, []); assert.equal(second.completed[0].content, '# 第一段\n## 结束\n');
    assert.equal(run.documentDrafts[0].content, part.content);
    run.stage = 'S10'; assert.throws(() => prepareDocumentDrafts(run, [{ ...part, draftHash: first.drafts[0].hash }]), /分段候选/);
  } finally { store.close(); }
});

test('完整S02以精确patch提交配置和文风，一次生成即通过原模板检查', async () => {
  let calls = 0;
  const service: Service = new Service(path.resolve('resources/skill'), () => {}, async () => {
    calls++;
    const p = service.store!.db.project();
    return { ...fakeResult(''), calls: [{ id: crypto.randomUUID(), name: 'propose_changes',
      arguments: JSON.stringify({ changes: stageOutputs('S02', p).map(file => {
        const original = service.store!.readAccepted(file);
        return { path: file, baseHash: original.hash, patch: { sourceHash: original.hash,
          edits: [{ before: original.content, after: fixture(p, file, service) }] }, final: true };
      }) }) }], stop: 'tools' };
  });
  service.profiles = [{ ...fakeProfile, outputLimit: 20000, contextLimit: 200000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('planning-patch'), title: '规划增量验证', premise: '调查员寻找死亡权', config: { defaultProfileId: fakeProfile.id } });
    const p = service.store!.db.project(); p.stage = 'S02'; service.store!.db.set('project', p);
    const run = service.makeRun('stage', '完成项目配置与文风'); service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const done = service.store!.db.run(run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(calls, 1); assert.equal(done.rounds, 1); assert.equal(done.accepted, false);
    assert.equal(done.issues.filter(i => i.severity === 'error').length, 0);
    for (const file of stageOutputs('S02', p)) assert.equal(done.changes.find(c => c.path === file)!.content, fixture(p, file, service));
  } finally { await service.drain(); }
});

test('Responses 和 Chat 的分段任务关闭并行工具调用，普通任务参数保持兼容', () => {
  const tool = [{ name: 'propose_changes', description: 'test', parameters: { type: 'object', properties: {} } }];
  for (const protocol of ['responses', 'chat'] as const) {
    const profile = { ...profileSchema.parse({ ...fakeProfile, protocol }), apiKey: 'fixture' };
    assert.equal(requestBody(profile, '', [], tool, { singleToolCall: true }).body.parallel_tool_calls, false);
    assert.equal(requestBody(profile, '', [], tool).body.parallel_tool_calls, undefined);
  }
});

test('分段工具参数保持稳定，执行仍限长篇规划；草稿绑定审阅指纹且旧记录兼容', () => {
  const { store, run } = refactorFixture();
  try {
    run.mode = 'stage'; run.skillId = undefined; run.stage = 'S08';
    const runner = new AgentRunner(store, path.resolve('resources/skill'), () => [fakeProfile], () => {});
    const properties = () => (runner.toolsFor(run).find(t => t.name === 'propose_changes')!.parameters as any).properties.changes.items.properties;
    assert.ok(properties().append);
    const stable = properties();
    const before = proposalHash(run);
    run.documentDrafts = [];
    assert.equal(proposalHash(run), before);
    run.documentDrafts = [{ path: '草稿.md', content: '片段', baseHash: null, chunks: 1, hash: hash('片段') }];
    assert.notEqual(proposalHash(run), before);
    const part = { path: '新草稿.md', content: '片段', baseHash: null, append: true, draftHash: null, final: false };
    run.stage = 'S09'; assert.deepEqual(properties(), stable);
    assert.throws(() => prepareDocumentDrafts(run, [part]), /分段候选/);
    run.stage = 'S08'; run.mode = 'revision'; assert.deepEqual(properties(), stable);
    assert.throws(() => prepareDocumentDrafts(run, [part]), /分段候选/);
  } finally { store.close(); }
});

test('真实阶段运行分段落盘，断流和重启保留前段；恢复仅追加，未完成不能采纳', async () => {
  let service: Service, calls = 0, breakConnection = true;
  const profile = { ...fakeProfile, outputLimit: 4096, contextLimit: 1000000, networkRecovery: { maxRetries: 0, retryUnknown: false } };
  const caller: ConstructorParameters<typeof Service>[2] = async (_profile, system, messages, _tools, _signal, _delta, options) => {
    calls++;
    const run = service.store!.db.runs().find(r => r.status === 'running')!;
    assert.match(system, /分段保存/); assert.equal(options?.singleToolCall, true);
    const p = service.store!.db.project(), file = batchPath(activeBatch(p));
    const full = fixture(p, file, service), saved = run.documentDrafts?.find(d => d.path === file);
    if (saved && breakConnection) {
      const feedback = messages.findLast(m => m.role === 'tool' && m.content.includes('pendingOutputs'));
      assert.ok(feedback, '草稿保存后返回继续生成的待办');
      const receipt = JSON.parse(feedback.content);
      assert.equal(receipt.saved, true);
      assert.equal(receipt.pendingOutputs.length, 1);
      assert.equal(receipt.pendingOutputs[0].path, file);
      assert.equal(receipt.issues.some((issue: { code: string }) => ['missing_output', 'document_draft_pending'].includes(issue.code)), false);
    }
    if (run.changes.some(c => c.path === file)) return fakeResult('候选已完整');
    if (saved && breakConnection) { breakConnection = false; throw new RequestError('fixture websocket closed', true, { source: 'transport', code: 'WEBSOCKET_CLOSED' }); }
    if (saved) assert.match(JSON.stringify(messages), /documentDrafts/);
    const start = saved?.content.length ?? 0, content = full.slice(start, start + 300);
    return { ...fakeResult(''), calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: [{ path: file, baseHash: service.store!.db.document(file)?.hash ?? null, content, append: true, final: start + content.length === full.length, draftHash: saved?.hash ?? null }] }) }], stop: 'tools' };
  };
  const create = () => { const s = new Service(path.resolve('resources/skill'), () => {}, caller); s.profiles = [profile]; return s; };
  service = create();
  try {
    await service.invoke('project.create', { parent: isolatedRoot('chunk-recovery'), title: '分段临时作品', premise: '伤员求医', config: { defaultProfileId: profile.id, targetWords: 400, chapterWords: 200, minWords: 200, maxWords: 200, batchSize: 2, maxRounds: 30, maxTools: 50 } });
    let p = service.store!.db.project();
    for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'] as StageId[]) {
      const changes = stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service)));
      if (stage === 'S07') p.stage = 'S08';
      service.store!.commit(changes, p); p = service.store!.db.project();
    }
    const run = service.makeRun('stage', '完成当前批次细纲'); service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const stopped = service.store!.db.run(run.id), file = batchPath(activeBatch(p));
    assert.equal(stopped.status, 'unknown'); assert.equal(stopped.documentDrafts?.[0].content.length, 300); assert.equal(stopped.changes.length, 0);
    service.runner!.check(stopped, p); assert.ok(stopped.issues.some(i => i.code === 'document_draft_pending'));
    assert.equal(service.runner!.recoverReadyCandidate(stopped, p, 'accept'), false);
    const savedHash = stopped.documentDrafts![0].hash;
    service.close(); service = create(); await service.open(p.root);
    assert.equal(service.store!.db.run(run.id).documentDrafts![0].hash, savedHash);
    const reopened = service.store!.db.run(run.id);
    const rebuilt = service.rebuildRun(reopened, profile.id, '仅重新组装上下文，不重新生成已保存内容');
    assert.equal(rebuilt.documentDrafts![0].hash, savedHash);
    assert.equal(rebuilt.rounds, stopped.rounds); assert.equal(rebuilt.parentRunId, run.id);
    const id = await service.invoke('run.recover', { id: rebuilt.id, retryUnknown: true });
    for (let i = 0; service.runner!.controller; i++) { assert.ok(i < 3000); await new Promise(r => setTimeout(r, 5)); }
    const done = service.store!.db.run(id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(done.documentDrafts, undefined); assert.equal(calls, Math.ceil(fixture(p, file, service).length / 300) + 1);
    assert.equal(done.changes.find(c => c.path === file)!.content, fixture(p, file, service).replace(/^## 第(\d+)章/gm, (_, n) => `## 第${n.padStart(3, '0')}章`));
    assert.equal(done.candidateWrites?.[file], 1);
    assert.equal(done.accepted, false); assert.equal(service.store!.db.project().stage, 'S08');
    assert.equal(hash(service.store!.readAccepted(file).content), service.store!.db.document(file)!.hash);
    assert.notEqual(service.store!.db.document(file)!.hash, hash(done.changes[0].content));
  } finally { await service.drain(); }
});
