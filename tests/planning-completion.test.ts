import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { stageOutputs, batchPath, activeBatch, hash, paths, prosePath, qualityPath } from '../src/core/domain';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import type { Caller } from '../src/core/runner';
import { factSchema, type Run, type StageId } from '../src/shared/types';
import { draftCompletionChanges } from '../src/core/runtime/document-drafts';
import { assembleContext } from '../src/core/context-compiler';
import { RequestError } from '../src/core/provider';

const skill = path.resolve('resources/skill');
const profile = { ...fakeProfile, contextLimit: 1000000, outputLimit: 4096 };
const stages: StageId[] = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'];
const proposal = (changes: unknown, extras: { id: string; name: string; arguments: string }[] = []) => ({
  ...fakeResult(''), native: null, stop: 'tools' as const,
  calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes }) }, ...extras]
});

async function setup(stage: StageId, caller: Caller, previewEnabled = true) {
  const service = new Service(skill, () => {}, caller);
  service.profiles = [profile];
  await service.invoke('project.create', { parent: isolatedRoot('planning-completion'), title: '完整候选本地收尾', premise: '伤员求医',
    config: { defaultProfileId: profile.id, targetWords: 6000, chapterWords: 200, minWords: 200, maxWords: 200, batchSize: 30, maxRounds: 12, maxTools: 64, preview: { enabled: previewEnabled } } });
  let p = service.store!.db.project();
  for (const prior of stages.slice(0, stages.includes(stage) ? stages.indexOf(stage) : stages.length)) {
    service.store!.commit(stageOutputs(prior, p).map(file => service.change(file, fixture(p, file, service))), p);
    p = service.store!.db.project();
  }
  p.stage = stage;
  service.store!.db.set('project', p);
  const run = service.makeRun('stage', '完成已授权阶段，保留全部必要字段');
  service.store!.db.saveRun(run);
  return { service, run, p };
}

for (const stage of stages.slice(1)) test(`${stage} 完整候选在工具批次后进入审阅，不追加纯校验与结束说明模型轮`, async () => {
  let service: Service, calls = 0;
  const created = await setup(stage, async () => {
    calls++;
    const p = service.store!.db.project();
    return proposal(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))));
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(calls, 1);
    assert.equal(done.accepted, false);
    assert.equal(service.store!.db.project().stage, stage);
    assert.ok(service.store!.db.events().some(e => e.runId === done.id && e.kind === 'local-recovery'));
  } finally { await service.drain(); }
});

test('S04 按文件组持久化，断流重开后只补缺失文件，九份齐全才进入审阅', async () => {
  let service: Service, calls = 0;
  const submitted: string[][] = [];
  const created = await setup('S04', async () => {
    calls++;
    const current = service.store!.db.runs().find(run => run.status === 'running')!;
    const required = stageOutputs('S04', created.p);
    const saved = new Set(current.changes.map(change => change.path));
    if (calls === 3) {
      assert.equal(saved.size, 4, '已返回的前两组必须在下一请求失败之前持久保存');
      throw new RequestError('中转读取上游模型响应时连接中断', true,
        { source: 'upstream', code: 'upstream_stream_read_error' });
    }
    assert.ok(calls <= 5, '完整九份候选之后不得再发完成说明轮');
    const group = calls === 1 ? [paths.roles] : required.filter(file => !saved.has(file)).slice(0, 3);
    assert.ok(group.length > 0);
    assert.ok(group.every(file => !saved.has(file)), '后续只提交尚未保存的文件');
    if (calls === 2) assert.equal(saved.size, 1, '仅角色卡不能提前结束');
    if (calls === 4) assert.equal(saved.size, 4, '重开恢复必须保留前两组候选');
    if (calls === 5) assert.equal(saved.size, 7, '最后两份仍缺失时不得提前结束');
    submitted.push(group);
    return proposal(group.map(file => service.change(file, fixture(created.p, file, service))));
  });
  service = created.service;
  try {
    const required = stageOutputs('S04', created.p);
    assert.equal(required.length, 9);
    const formalHashes = required.map(file => [file, service.store!.db.document(file)?.hash]);
    await service.runner!.drive(created.run.id);
    const interrupted = service.store!.db.run(created.run.id);
    assert.equal(interrupted.status, 'unknown', interrupted.error ?? '');
    assert.equal(calls, 3);
    assert.equal(interrupted.rounds, 3);
    assert.equal(interrupted.changes.length, 4);
    assert.equal(interrupted.usage.cost, null, '未知收费请求不能当成零费用');
    assert.ok(!service.store!.db.events().some(event => event.runId === interrupted.id && event.kind === 'local-recovery'));
    const saved = structuredClone(interrupted.changes), root = service.store!.root;
    service.close(); await service.open(root);
    const reopened = service.store!.db.run(interrupted.id);
    assert.equal(reopened.status, 'unknown');
    assert.equal(calls, 3, '打开档案不得隐式重发未知请求');
    assert.deepEqual(reopened.changes, saved);
    assert.equal(reopened.rounds, 3);
    await assert.rejects(service.invoke('run.recover', { id: reopened.id }), /费用未知|收费请求/);
    assert.equal(calls, 3);
    const resumed = await service.invoke('run.recover', { id: reopened.id, retryUnknown: true });
    for (let i = 0; service.runner?.controller; i++) {
      assert.ok(i < 2000, '分组恢复执行超时');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const done = service.store!.db.run(resumed);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(calls, 5);
    assert.equal(done.rounds, 5, '恢复须继承已经消耗的三轮');
    assert.equal(done.changes.length, 9);
    assert.deepEqual(done.changes.filter(change => saved.some(old => old.path === change.path)), saved);
    assert.equal(done.usage.cost, null);
    assert.equal(new Set(submitted.flat()).size, 9);
    assert.deepEqual(submitted.map(group => group.length), [1, 3, 3, 2]);
    for (const file of required) assert.equal(done.candidateWrites?.[file], 1, `已保存文件不得重复写入：${file}`);
    assert.deepEqual(required.map(file => [file, service.store!.db.document(file)?.hash]), formalHashes);
    assert.equal(done.accepted, false);
    assert.equal(service.store!.db.project().stage, 'S04');
    assert.equal(service.store!.db.project().revision, created.p.revision);
  } finally { await service.drain(); }
});

for (const startingRounds of [4, 11]) test(`S08 三十章 final:false ${startingRounds === 11 ? '仅在预算耗尽后本地合成完整候选' : '日常执行仍等待明确 final:true'}`, async () => {
  let service: Service, calls = 0;
  const created = await setup('S08', async () => {
    calls++;
    const r = service.store!.db.runs().find(x => x.status === 'running')!;
    const file = batchPath(activeBatch(created.p)), full = fixture(created.p, file, service) + '。\n', draft = r.documentDrafts![0];
    return proposal([{ path: file, content: full.slice(draft.content.length), baseHash: draft.baseHash, append: true, final: calls > 1, draftHash: draft.hash }]);
  });
  service = created.service;
  try {
    const { run, p } = created, file = batchPath(activeBatch(p)), full = fixture(p, file, service) + '。\n';
    const first = full.slice(0, -150);
    run.documentDrafts = [{ path: file, content: first, baseHash: service.store!.db.document(file)?.hash ?? null, hash: hash(first), chunks: 5 }];
    run.rounds = startingRounds;
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const done = service.store!.db.run(run.id);
    assert.equal(calls, startingRounds === 11 ? 1 : 2);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(done.rounds, startingRounds + calls);
    assert.equal(done.documentDrafts, undefined);
    assert.equal(done.changes[0].content, full.replace(/^## 第(\d+)章/gm, (_, n) => `## 第${n.padStart(3, '0')}章`));
    assert.equal(done.candidateWrites?.[file], 1);
    assert.equal(done.accepted, false);
    assert.equal(service.store!.db.project().stage, 'S08');
  } finally { await service.drain(); }
});

for (const missing of ['chapter', 'field', 'source', 'sentence', 'colon'] as const) test(`S08 分段缺${missing}不以本地收尾绕过检查或丢弃草稿`, async () => {
  let service: Service;
  const created = await setup('S08', async () => {
    const run = service.store!.db.runs().find(x => x.status === 'running')!;
    const draft = run.documentDrafts![0];
    if (missing === 'source') fs.appendFileSync(path.join(service.store!.root, paths.outline), '\n作者未确认的外部改稿\n');
    return proposal([{ path: draft.path, content: '\n', baseHash: draft.baseHash, append: true, final: false, draftHash: draft.hash }]);
  });
  service = created.service;
  try {
    const { run, p } = created, file = batchPath(activeBatch(p));
    let content = fixture(p, file, service) + '。';
    if (missing === 'chapter') content = content.slice(0, content.indexOf('## 第30章'));
    if (missing === 'field') content = content.replace(/- 章末牵引：[^\n]+/, '');
    if (missing === 'sentence') content = content.replace(/[^\n]+$/, '- 章末牵引：顾平安必须在');
    if (missing === 'colon') content = content.replace(/[^\n]+$/, '- 章末牵引：顾平安看到：');
    run.documentDrafts = [{ path: file, content, baseHash: service.store!.db.document(file)?.hash ?? null, hash: hash(content), chunks: 5 }];
    run.rounds = 11;
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const done = service.store!.db.run(run.id);
    assert.equal(done.status, 'paused');
    assert.equal(done.rounds, 12);
    assert.equal(done.documentDrafts![0].content, content + '\n');
    assert.equal(done.changes.length, 0);
    assert.equal(done.accepted, false);
  } finally { await service.drain(); }
});

test('完整候选不能越过同一工具批次后续的作者问题', async () => {
  let service: Service;
  const created = await setup('S05', async () => proposal(stageOutputs('S05', created.p).map(file => service.change(file, fixture(created.p, file, service))), [
    { id: 'author-question', name: 'ask_author', arguments: JSON.stringify({ question: '结局方向需作者决定' }) }
  ]));
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_input');
    assert.equal(done.input?.question, '结局方向需作者决定');
    assert.equal(done.accepted, false);
  } finally { await service.drain(); }
});

test('本地快捷收尾不接管正文审核、章后证据审查和修订任务', async () => {
  const { service, run, p } = await setup('S05', async () => { throw new Error('不得调用模型'); });
  try {
    run.status = 'running'; run.changes = stageOutputs('S05', p).map(file => service.change(file, fixture(p, file, service)));
    for (const change of [
      { stage: 'S10' as const }, { stage: 'S11' as const }, { mode: 'revision' as const },
      { factRetractions: [{ id: 'fact', reason: '必须核对撤回' }] }
    ]) {
      assert.equal(service.runner!.recoverReadyCandidate({ ...structuredClone(run), ...change } as Run, p, 'checkpoint'), false);
    }
  } finally { await service.drain(); }
});

test('S08 重启恢复完整 final:false 草稿，保留累计轮数及用量且不再调用模型', async () => {
  const { service, run, p } = await setup('S08', async () => { throw new Error('不得调用模型'); });
  try {
    const file = batchPath(activeBatch(p)), content = fixture(p, file, service) + '。\n';
    run.documentDrafts = [{ path: file, content, baseHash: service.store!.db.document(file)?.hash ?? null, hash: hash(content), chunks: 6 }];
    run.manifest = assembleContext(service.store!, p, run.stage, run.request, profile);
    run.status = 'paused'; run.error = '已达到本任务轮数上限'; run.rounds = 12; run.toolCount = 22;
    run.usage = { input: 1000, output: 200, cost: 0.01, currency: 'USD' };
    run.messages = [{ role: 'assistant', content: '', calls: [{ id: 'last-chunk', name: 'propose_changes', arguments: '{}' }] },
      { role: 'tool', callId: 'last-chunk', content: JSON.stringify({ saved: true }) }];
    service.store!.db.saveRun(run);
    const root = service.store!.root;
    service.close(); await service.open(root);
    const done = service.store!.db.run(run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? '');
    assert.equal(done.documentDrafts, undefined);
    assert.equal(done.changes[0].content, content.replace(/^## 第(\d+)章/gm, (_, n) => `## 第${n.padStart(3, '0')}章`));
    assert.equal(done.rounds, 12); assert.equal(done.toolCount, 22);
    assert.deepEqual(done.usage, run.usage);
    assert.equal(done.accepted, false); assert.equal(service.store!.db.project().stage, 'S08');
  } finally { await service.drain(); }
});

test('完整预算草稿缺少上游 manifest 时不能推断收尾', async () => {
  const { service, run, p } = await setup('S08', async () => { throw new Error('不得调用模型'); });
  try {
    const file = batchPath(activeBatch(p)), content = fixture(p, file, service) + '。\n';
    run.documentDrafts = [{ path: file, content, baseHash: service.store!.db.document(file)?.hash ?? null, hash: hash(content), chunks: 6 }];
    run.status = 'running'; run.rounds = 12;
    run.messages = [{ role: 'assistant', content: '', calls: [{ id: 'last', name: 'propose_changes', arguments: '{}' }] }, { role: 'tool', callId: 'last', content: '{}' }];
    assert.ok(draftCompletionChanges(run));
    assert.equal(service.runner!.recoverReadyCandidate(run, p, 'budget'), false);
    assert.equal(run.changes.length, 0); assert.equal(run.documentDrafts[0].content, content);
  } finally { await service.drain(); }
});

test('单独 S11 不能用文件齐全且 facts 为空推断记忆提取已结束', async () => {
  const { service, p } = await setup('S11', async () => { throw new Error('不得调用模型'); });
  try {
    service.store!.commit([service.change(prosePath(p.chapter), fixture(p, prosePath(p.chapter), service))], p);
    const current = service.makeRun('stage', '完成章后记忆');
    current.changes = stageOutputs('S11', p).map(file => service.change(file, fixture(p, file, service)));
    current.status = 'running'; current.rounds = p.config.maxRounds;
    current.manifest = assembleContext(service.store!, p, current.stage, current.request, profile);
    current.messages = [{ role: 'assistant', content: '', calls: [{ id: 'files-only', name: 'propose_changes', arguments: '{}' }] }, { role: 'tool', callId: 'files-only', content: '{}' }];
    assert.equal(current.facts.length, 0);
    assert.equal(service.runner!.recoverReadyCandidate(current, p, 'budget'), false);
    assert.equal(current.status, 'running');
    assert.equal(current.changes.length, stageOutputs('S11', p).length);
  } finally { await service.drain(); }
});

test('预算草稿收尾拒绝半句与未闭合围栏，且不修改已保存的草稿', async () => {
  const { service, run, p } = await setup('S08', async () => { throw new Error('不得调用模型'); });
  try {
    const file = batchPath(activeBatch(p)), full = fixture(p, file, service);
    for (const content of [full + '\n', full + '\n```markdown\n未完成的附录。\n']) {
      run.documentDrafts = [{ path: file, content, baseHash: null, hash: hash(content), chunks: 6 }];
      const before = structuredClone(run);
      assert.equal(draftCompletionChanges(run), null);
      assert.deepEqual(run, before);
    }
  } finally { await service.drain(); }
});

test('恢复后的读取工具不会把尚待按作者要求修改的旧候选提前结束', async () => {
  let service: Service, calls = 0;
  const created = await setup('S05', async () => {
    calls++;
    if (calls === 1) return { ...fakeResult(''), stop: 'tools' as const, calls: [{ id: 'read-first', name: 'read_document', arguments: JSON.stringify({ path: paths.volumes, candidate: true }) }] };
    return proposal(stageOutputs('S05', created.p).map(file => service.change(file, fixture(created.p, file, service) + '\n作者补充要求已落实。\n')));
  });
  service = created.service;
  try {
    created.run.changes = stageOutputs('S05', created.p).map(file => service.change(file, fixture(created.p, file, service)));
    service.store!.db.saveRun(created.run);
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? '');
    assert.equal(calls, 2);
    assert.match(done.changes[0].content, /作者补充要求已落实/);
  } finally { await service.drain(); }
});

for (const candidate of [true, false]) test(`read_document ${candidate ? '候选缺失回退' : '旧式普通读取'}的正式基础哈希可直接提交，无需重复读取`, async () => {
  let service: Service, calls = 0;
  const created = await setup('S05', async (_profile, _system, messages, tools) => {
    calls++;
    if (calls === 1) {
      assert.match(tools.find(tool => tool.name === 'read_document')!.description, /未完成草稿→当前候选→正式文档/);
      return { ...fakeResult(''), stop: 'tools', calls: [{ id: 'read-base', name: 'read_document',
        arguments: JSON.stringify({ path: paths.volumes, ...(candidate ? { candidate: true } : {}) }) }] };
    }
    assert.equal(calls, 2, '正式回执足以提交，不应再请求同一正式文件');
    const receipt = JSON.parse(messages.find(message => message.role === 'tool' && message.callId === 'read-base')!.content);
    const formal = service.store!.readAccepted(paths.volumes);
    assert.equal(receipt.source, 'accepted'); assert.equal(receipt.status, 'accepted');
    assert.deepEqual({ path: receipt.path, hash: receipt.hash, content: receipt.content }, formal, '旧字段和快照内容保持兼容');
    assert.equal(receipt.baseHash, formal.hash);
    assert.equal(receipt.candidateAvailable, candidate ? false : undefined);
    return proposal([{ path: paths.volumes, content: fixture(created.p, paths.volumes, service),
      baseHash: candidate ? receipt.baseHash : receipt.hash }]);
  });
  service = created.service;
  try {
    const before = service.store!.readAccepted(paths.volumes);
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(calls, 2); assert.equal(done.changes.length, 1); assert.equal(done.accepted, false);
    assert.deepEqual(service.store!.readAccepted(paths.volumes), before, '提出候选仍不改正式文档');
  } finally { await service.drain(); }
});

for (const withDraft of [true, false]) test(`read_document 保持${withDraft ? '未完成草稿优先于候选' : '候选优先于正式'}且区分内容哈希与正式基础哈希`, async () => {
  let service: Service, calls = 0;
  const created = await setup('S05', async () => {
    calls++;
    assert.equal(calls, 1, '读取同批工具随后暂停，不需追加模型轮');
    return { ...fakeResult(''), stop: 'tools', calls: [
      { id: 'read-current', name: 'read_document', arguments: JSON.stringify({ path: paths.volumes, candidate: true }) },
      { id: 'read-formal', name: 'read_document', arguments: JSON.stringify({ path: paths.volumes }) },
      { id: 'pause', name: 'ask_author', arguments: JSON.stringify({ question: '测试保留候选待作者确认。' }) }
    ] };
  });
  service = created.service;
  try {
    const formal = service.store!.readAccepted(paths.volumes);
    const candidateContent = '# 保存的候选\n候选内容。\n', draftContent = '# 未完成草稿\n草稿内容。\n';
    created.run.changes = [{ path: paths.volumes, content: candidateContent, baseHash: formal.hash }];
    if (withDraft) created.run.documentDrafts = [{ path: paths.volumes, content: draftContent, baseHash: formal.hash, hash: hash(draftContent), chunks: 1 }];
    service.store!.db.saveRun(created.run);
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    const receipt = (id: string) => JSON.parse(done.messages.find(message => message.role === 'tool' && message.callId === id)!.content);
    const current = receipt('read-current'), accepted = receipt('read-formal');
    assert.equal(current.source, withDraft ? 'incomplete_draft' : 'candidate');
    assert.equal(current.status, current.source); assert.equal(current.candidateAvailable, true);
    assert.equal(current.content, withDraft ? draftContent : candidateContent);
    assert.equal(current.hash, hash(current.content)); assert.equal(current.baseHash, formal.hash);
    assert.notEqual(current.hash, current.baseHash);
    if (withDraft) assert.equal(current.draftHash, current.hash);
    assert.equal(accepted.source, 'accepted'); assert.equal(accepted.content, formal.content);
    assert.equal(accepted.baseHash, formal.hash); assert.equal(done.accepted, false);
  } finally { await service.drain(); }
});

for (const editBeforeRead of [true, false]) test(`候选回退契约仍拒绝${editBeforeRead ? '读取前的外部变更' : '读取后提交时的过期baseHash'}`, async () => {
  let service: Service, calls = 0;
  const external = '\n作者在磁盘修改的内容。\n';
  const created = await setup('S05', async (_profile, _system, messages) => {
    calls++;
    if (calls === 1) {
      if (editBeforeRead) fs.appendFileSync(path.join(service.store!.root, paths.volumes), external);
      return { ...fakeResult(''), stop: 'tools', calls: [{ id: 'read-stale', name: 'read_document', arguments: JSON.stringify({ path: paths.volumes, candidate: true }) }] };
    }
    if (calls === 2 && !editBeforeRead) {
      const receipt = JSON.parse(messages.find(message => message.role === 'tool' && message.callId === 'read-stale')!.content);
      assert.equal(receipt.source, 'accepted');
      fs.appendFileSync(path.join(service.store!.root, paths.volumes), external);
      return proposal([{ path: paths.volumes, content: fixture(created.p, paths.volumes, service), baseHash: receipt.baseHash }]);
    }
    return { ...fakeResult(''), stop: 'tools', calls: [{ id: 'pause-after-conflict', name: 'ask_author', arguments: JSON.stringify({ question: '请核对磁盘版本。' }) }] };
  });
  service = created.service;
  try {
    const formal = service.store!.readAccepted(paths.volumes);
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    const receipts = done.messages.filter(message => message.role === 'tool').map(message => message.content).join('\n');
    assert.match(receipts, editBeforeRead ? /文件有未确认外部变化/ : /版本已改变/);
    assert.equal(done.changes.length, 0); assert.equal(done.accepted, false);
    assert.deepEqual(service.store!.readAccepted(paths.volumes), formal);
    assert.equal(fs.readFileSync(path.join(service.store!.root, paths.volumes), 'utf8'), formal.content + external);
  } finally { await service.drain(); }
});

test('关闭实时预览后不请求自动评分，本地正文线索并入既有审稿且不追加请求或强制重写', async () => {
  let service: Service, proseCalls = 0, reviewCalls = 0, memoryCalls = 0, evidenceCalls = 0;
  const created = await setup('S10', async (_profile, system, messages, tools, _signal, delta) => {
    assert.ok(!system.includes('rubric narrative-1'), '关闭预览后不得发送自动预览评分');
    if (system.includes('你独立核对本章实际正文')) {
      const input = JSON.parse(messages[0].content);
      return fakeResult(JSON.stringify({ decisions: input.plans.map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '合成夹具的后续求医计划保留伤势与行动。', planQuote: plan.content.slice(0, 30), proseQuote: input.prose.content.slice(0, 30) })) }));
    }
    if (system.includes('你独立检查')) {
      evidenceCalls++;
      const input = JSON.parse(messages[0].content);
      return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '原文明确递出记录本', evidence: item.fact.evidence.map((e: any) => ({ path: e.path, quote: e.quote })) })) }));
    }
    const p = service.store!.db.project();
    if (!tools.length) {
      proseCalls++;
      const body = Array.from(fixture(p, prosePath(p.chapter), service).split('\n\n')[1]);
      const repeated = body.slice(80, 125).join('');
      const prose = '# 本章正文\n\n' + [body.slice(0, 80).join(''), repeated, repeated, body.slice(170).join('')].join('\n\n');
      delta?.(prose);
      return fakeResult(prose);
    }
    const current = service.store!.db.runs().find(r => r.status === 'running')!;
    if (messages.at(-1)?.role === 'tool') return fakeResult('当前阶段提交完成');
    if (current.pipeline?.phase === 'review') {
      reviewCalls++;
      const input = JSON.parse(messages[0].content);
      assert.equal(input.editorial.proseHash, current.pipeline.proseHash);
      assert.equal(input.editorial.findings[0].code, 'repeated_paragraph');
      assert.match(input.editorial.policy, /不是判错/);
      assert.equal(input.sources.find((source: any) => source.path === paths.roles)?.mode, 'excerpt', '首章无正文事实时仍有本章人物的口吻字段');
      return proposal([service.change(qualityPath(p.chapter), fixture(p, qualityPath(p.chapter), service))]);
    }
    assert.equal(current.pipeline?.phase, 'memory'); memoryCalls++;
    const prose = current.changes.find(change => change.path === prosePath(p.chapter))!;
    const fact = factSchema.parse({ id: 'record-book', subject: '阿宁', predicate: '递出记录本', value: '向医生递出记录本', kind: 'event', category: 'item', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '阿宁推开诊室的门，把记录本递到灯下。' }] });
    return proposal(stageOutputs('S11', p).map(file => service.change(file, fixture(p, file, service))), [
      { id: 'memory-fact', name: 'propose_memory', arguments: JSON.stringify({ facts: [fact] }) }
    ]);
  }, false);
  service = created.service;
  try {
    created.run.request = '续写阿宁当前章，保留全部必要字段';
    service.store!.db.saveRun(created.run);
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(proseCalls, 1); assert.equal(reviewCalls, 1); assert.equal(memoryCalls, 1); assert.equal(evidenceCalls, 1);
    assert.equal(done.pipeline?.phase, 'ready'); assert.equal(done.memoryReview?.issues.length, 0);
    assert.equal(done.facts.length, 1); assert.equal(done.accepted, false);
    assert.ok(!done.steps?.some(step => step.phase.startsWith('assessment:')));
    assert.ok(!done.repairAttempts?.prose, '线索本身不能触发自动重写');
    assert.equal(service.store!.db.events().filter(event => event.runId === done.id && event.kind === 'editorial-evidence').length, 1);
  } finally { await service.drain(); }
});
