import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { ApplicationError, errorPayload } from '../src/shared/errors';
import { recoveryDecision } from '../src/shared/recovery';
import { classifyFailure } from '../src/core/failures';
import { computedScore, normalizeCandidate, normalizeToolArguments, scoreFields } from '../src/core/output-normalization';
import { planCandidateRepair, assertRepairWrite, assertRepairFacts, assertStructuredRepair, reviewRepairPointers, planningRepairPointers } from '../src/core/runtime/candidate-repair';
import { factSchema } from '../src/shared/types';
import { callModel, attempts, recoverAttempts } from '../src/core/runtime/model-gateway';
import { canRecoverRequest, recoveryDelay, cancellableDelay } from '../src/core/runtime/network-recovery';
import { invokeModel, RequestError } from '../src/core/provider';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { paths, stageOutputs, prosePath, qualityPath } from '../src/core/domain';
import { prepareRunRecovery, prepareAuthorRevision } from '../src/core/runtime/run-recovery';

test('已完成正文收到作者修改意见后重新写作、审稿及提取记忆，保留原稿和总预算', () => {
  const { store, run } = refactorFixture();
  try {
    run.chapter = 1; run.rounds = 5; run.toolCount = 7;
    run.pipeline = { phase: 'ready', proseHash: 'old-hash', epoch: 'old', version: 3, previewCalls: 0 };
    run.changes = [{ path: prosePath(1), content: '必须保留的当前正文', baseHash: null }, { path: qualityPath(1), content: '旧审稿结果', baseHash: null }];
    run.memoryReview = { fingerprint: 'old', issues: [] };
    run.memoryCompletionHash = 'old-memory';
    prepareAuthorRevision(run, '把结尾改得更有悬念，其他内容保留');
    assert.equal(run.pipeline.phase, 'prose');
    assert.equal(run.pipeline.proseHash, undefined);
    assert.notEqual(run.pipeline.epoch, 'old');
    assert.deepEqual(run.changes.map(change => change.path), [prosePath(1)]);
    assert.equal(run.changes[0].content, '必须保留的当前正文');
    assert.equal(run.memoryReview, undefined);
    assert.equal(run.memoryCompletionHash, undefined);
    assert.equal(run.rounds, 5); assert.equal(run.toolCount, 7);
    assert.match(run.request, /把结尾改得更有悬念/);
  } finally { store.close(); }
});

const skill = path.resolve('resources/skill');
const disconnected = () => new RequestError('连接被拒绝', false, { source: 'transport', code: 'ECONNREFUSED', retryAfterMs: 0 });
const unknown = () => new RequestError('HTTP 502，结果未知', true, { source: 'upstream', code: 'HTTP_502', retryAfterMs: 0 });

test('方案关联修复只沿明确约束展开一层，保留无关计划与旧书正文', () => {
  const task = { origin: 'new', candidate: { constraints: [{ id: 'a' }, { id: 'b' }], premiseDocument: '原稿',
    plan: { statements: [{ sourceRefs: ['a', 'author-input'] }, { sourceRefs: ['a', 'b'] }, { sourceRefs: ['b'] }, { sourceRefs: ['author-input'] }] } },
    contractReview: { result: { issues: [{ severity: 'major', jsonPointer: '/plan/statements/0/text' }] } }
  } as unknown as import('../src/shared/tags').TagPlanning;
  const scope = planningRepairPointers(task, false);
  assert.deepEqual(scope, ['/plan/statements/0', '/plan/statements/1', '/premiseDocument']);
  const changed = structuredClone(task.candidate!);
  changed.plan!.statements[2].text = '不相关改写';
  assert.throws(() => assertStructuredRepair(task.candidate, changed, scope), /未要求调整/);
  task.origin = 'adoption';
  assert.equal(planningRepairPointers(task, false).includes('/premiseDocument'), false);
});

test('未定位错误不扩大已定位的修复范围，不能新增旁路文件或改写其他事实', () => {
  const { store, run } = refactorFixture();
  try {
    run.changes.push({ path: '待修复.md', content: '旧内容', baseHash: null });
    const fact = factSchema.parse({ id: 'fact-1', subject: '甲', predicate: '状态', value: '平安', kind: 'event', category: 'character', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: '正文.md', hash: 'a'.repeat(64), quote: '平安' }] });
    run.facts = [fact, { ...fact, id: 'fact-2', subject: '乙' }];
    run.repairScope = planCandidateRepair(run, [
      { code: 'field', severity: 'error', path: '待修复.md', message: '字段不完整' },
      { code: 'fact_evidence', severity: 'error', factId: 'fact-1', message: '甲的证据不符' },
      { code: 'unknown', severity: 'error', message: '尚未定位' }
    ], 'memory');
    store.db.saveRun(run);
    const restored = store.db.run(run.id);
    assert.deepEqual(restored.repairScope!.paths, ['待修复.md']);
    assert.deepEqual(restored.repairScope!.factIds, ['fact-1']);
    assert.throws(() => assertRepairWrite(restored, [{ ...run.changes[0], path: './正文.md', content: '误改' }]), /已通过检查/);
    assert.throws(() => assertRepairWrite(restored, [{ path: '新增旁路.md', content: '越界', baseHash: null }]), /未授权/);
    assert.doesNotThrow(() => assertRepairWrite(restored, [{ ...run.changes[1], content: '修复' }]));
    assert.doesNotThrow(() => assertRepairFacts(restored, [{ ...fact, value: '修正' }, run.facts[1]]));
    assert.throws(() => assertRepairFacts(restored, [fact, { ...run.facts[1], value: '误改' }]), /未涉及的事实/);
    assert.throws(() => assertRepairFacts(restored, [...run.facts, { ...fact, id: 'extra' }]), /未授权新增/);
    run.repairScope = planCandidateRepair(run, [{ code: 'unknown', severity: 'error', message: '范围未知' }], 'stage');
    assert.deepEqual(run.repairScope.paths, []);
    assert.throws(() => assertRepairWrite(run, [{ ...run.changes[0], content: '全量重写' }]), /已通过检查/);
    const { version: _version, ...legacy } = run.repairScope;
    run.repairScope = legacy;
    assert.doesNotThrow(() => assertRepairWrite(run, [{ path: '尚未提交的原阶段产物.md', content: '补齐', baseHash: null }]), '旧检查点未记录完整白名单，仍由原阶段权限校验新增产物');
    assert.throws(() => assertRepairWrite(run, [{ ...run.changes[0], content: '误改' }]), /已通过检查/);
  } finally { store.close(); }
});

test('网络恢复保留成对的失败提案与工具回执，不清零轮数或内容修复次数', () => {
  const { store, run } = refactorFixture();
  try {
    run.mode = 'stage'; run.stage = 'S05'; run.rounds = 3;
    run.failure = classifyFailure(unknown()); run.status = 'unknown';
    run.issues = [{ code: 'missing_output', severity: 'error', path: '分卷.md', message: '本阶段必需产物尚未生成' }];
    run.repairAttempts = { stage: 1 };
    run.messages = [{ role: 'user', content: '原请求' }, { role: 'assistant', content: '', calls: [
      { id: 'proposal-1', name: 'propose_changes', arguments: '{"changes":[]}' }
    ] }, { role: 'tool', callId: 'proposal-1', content: '{"error":"字段问题，按此修正"}' }];
    const before = structuredClone(run);
    prepareRunRecovery(run);
    assert.deepEqual(run, before, '仅恢复连接，不改变先前内容、失败反馈或预算');
    run.failure = classifyFailure(new ApplicationError('REPAIR_EXHAUSTED', '语义修复已耗尽'));
    prepareRunRecovery(run);
    assert.equal(run.messages.length, 0, '内容修复仍使用原限定修复路径');
  } finally { store.close(); }
});

test('不完整或孤立的工具历史不能作为网络恢复前缀', () => {
  for (const history of [
    [{ role: 'assistant' as const, content: '', calls: [{ id: 'unfinished', name: 'propose_changes', arguments: '{}' }] }],
    [{ role: 'tool' as const, callId: 'missing', content: '孤立回执' }]
  ]) {
    const { store, run } = refactorFixture();
    try {
      run.mode = 'stage'; run.stage = 'S05'; run.failure = classifyFailure(unknown());
      run.issues = [{ code: 'missing_output', severity: 'error', path: '分卷.md', message: '缺失' }];
      run.messages = history;
      prepareRunRecovery(run);
      assert.deepEqual(run.messages, []);
    } finally { store.close(); }
  }
});

test('错误分类区分业务、存储、配置、限额和未知请求，旧记录可恢复展示', () => {
  assert.equal(errorPayload(new Error('一般业务操作未完成')).code, 'OPERATION_FAILED');
  assert.equal(errorPayload(Object.assign(new Error('disk full'), { code: 'ENOSPC' })).code, 'STORAGE_FAILURE');
  assert.equal(errorPayload(new Error('已达到本任务轮数上限')).code, 'ROUND_LIMIT');
  assert.equal(classifyFailure(new ApplicationError('TOOL_LIMIT', '工具已用完')).code, 'TOOL_LIMIT');
  assert.equal(classifyFailure(unknown()).code, 'REMOTE_RESULT_UNKNOWN');
  assert.equal(classifyFailure(new RequestError('拒绝', false, { source: 'upstream', code: 'HTTP_401' })).code, 'MODEL_CONFIGURATION');
  const { store, run } = refactorFixture();
  try {
    run.status = 'paused'; run.error = '已达到本任务轮数上限';
    assert.equal(recoveryDecision(run).setting, 'maxRounds');
    store.db.saveRun(run);
    assert.equal(store.db.run(run.id).failure?.code, 'ROUND_LIMIT');
    run.status = 'unknown';
    assert.equal(recoveryDecision(run).confirmation, true);
    run.status = 'paused'; run.error = '数据库损坏'; run.failure = undefined;
    assert.equal(recoveryDecision(run).kind, 'inspect');
  } finally { store.close(); }
});

test('评分的常见标点、项目符号、单位可自动规范，正文和代码围栏不改写', () => {
  const score = scoreFields.map(label => `* **${label}**: 8 分`).join('\r\n');
  const content = `${score}\r\n+ 总分: 79/100\r\n\r\n原样保留叙述。\r\n\`\`\`md\r\n* 开头有效性: 2 分\r\n\`\`\``;
  assert.equal(computedScore(content), 80);
  const change = { path: '08_章后更新/第001章质量评分.md', content, baseHash: null };
  const normalized = normalizeCandidate(change);
  assert.match(normalized.change.content, /- 总分：80\/100/);
  assert.match(normalized.change.content, /```md\r\n\* 开头有效性: 2 分\r\n```/);
  assert.deepEqual(normalizeCandidate(normalized.change).edits, []);
  assert.equal(normalizeCandidate({ ...change, path: '07_正文章节/第001章.md' }, scoreFields).change.content, content);
  assert.equal(computedScore(score + '\r\n- 开头有效性：8'), null);
  assert.equal(computedScore(score.replace('8 分', '11 分')), null);
  assert.equal(computedScore(score.replace('8 分', '8/100')), null);
  assert.equal(computedScore(score.replace('8 分', '8，因为不错')), null);
});

test('JSON 只去除完整包装，不补齐截断数据或猜测字段', () => {
  const raw = '{"ok":true}';
  assert.equal(normalizeToolArguments('```json\n' + raw + '\n```'), raw);
  assert.equal(normalizeToolArguments('\uFEFF' + raw), raw);
  for (const invalid of ['{"ok":', '{"ok":true,}', '解释：' + raw]) assert.equal(normalizeToolArguments(invalid), invalid);
});

test('局部修复保护已通过的文件和结构化候选，保存重启后仍有效', () => {
  const { store, run, root } = refactorFixture();
  try {
    run.changes.push({ path: '待修复.md', content: '缺字段', baseHash: null });
    run.changes.push({ path: 'Notes.md', content: '保留内容', baseHash: null });
    run.repairScope = planCandidateRepair(run, [{ code: 'missing_field', path: '待修复.md', severity: 'error', message: '缺字段' }], 'stage');
    store.db.saveRun(run);
    const restored = store.db.run(run.id);
    assert.throws(() => assertRepairWrite(restored, [{ ...run.changes[0], content: '偷偷重写' }]), /已通过检查/);
    assert.throws(() => assertRepairWrite(restored, [{ path: 'notes.md', content: '不能用 Windows 大小写别名绕过保护', baseHash: null }]), /已通过检查/);
    assert.doesNotThrow(() => assertRepairWrite(restored, [run.changes[0], { ...run.changes[1], content: '修好' }]));
    const previous = { directions: [{ id: 'a', text: '好方案' }, { id: 'b', text: '待修方案' }], shared: '保留' };
    const pointers = reviewRepairPointers([{ severity: 'major', jsonPointer: '/directions/1/text' }]);
    assert.deepEqual(pointers, ['/directions/1']);
    assert.deepEqual(reviewRepairPointers([{ severity: 'major', jsonPointer: '/plan/statements/8/text' }]), ['/plan/statements/8']);
    assert.doesNotThrow(() => assertStructuredRepair(previous, { ...previous, directions: [previous.directions[0], { id: 'b', text: '修正' }] }, pointers));
    assert.throws(() => assertStructuredRepair(previous, { ...previous, shared: '被改写' }, pointers), /未要求调整/);
    assert.throws(() => assertStructuredRepair(previous, { ...previous, directions: [previous.directions[1], previous.directions[0]] }, pointers), /未要求调整/);
    assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
    assert.ok(root.includes('.test-output'));
  } finally { store.close(); }
});

test('有限恢复的退避、Retry-After 与取消边界', async () => {
  assert.equal(recoveryDelay(1, undefined, () => 0.5), 1000);
  assert.equal(recoveryDelay(8, undefined, () => 1), 10000);
  assert.equal(recoveryDelay(1, 2500), 2500);
  const controller = new AbortController();
  const waiting = cancellableDelay(30_000, controller.signal);
  controller.abort();
  assert.equal(await waiting, false);
  const signal = new AbortController().signal;
  assert.equal(canRecoverRequest(disconnected(), fakeProfile, 3, false, signal), false);
  assert.equal(canRecoverRequest(unknown(), fakeProfile, 1, false, signal), false);
  assert.equal(canRecoverRequest(disconnected(), fakeProfile, 1, true, signal), false);
  assert.equal(canRecoverRequest(new RequestError('稍后再试', false, { source: 'upstream', code: 'HTTP_429', retryAfterMs: 60_000 }), fakeProfile, 1, false, signal), false);
});

test('确认未发送的故障最多恢复两次，每次持久化尝试并计入任务上限', async () => {
  const { store, run } = refactorFixture();
  run.status = 'running'; run.rounds = 1;
  let calls = 0;
  try {
    const result = await callModel(store, run, 'test', async () => { if (++calls < 3) throw disconnected(); return fakeResult(); }, fakeProfile, 'test', [{ role: 'user', content: 'fixture' }], [], new AbortController().signal);
    assert.equal(result.text, '离线结果'); assert.equal(calls, 3); assert.equal(run.rounds, 3);
    assert.deepEqual(attempts(store, run.id).map(a => a.status), ['not_sent', 'not_sent', 'complete']);
    assert.equal(store.db.run(run.id).networkRetries, 2);
    assert.equal(store.db.events().filter(e => e.runId === run.id && e.kind === 'network-retry-scheduled').length, 2);
    assert.equal(store.db.project().revision, run.baseRevision);
    recoverAttempts(store);
    assert.equal(calls, 3, '恢复记录不会自动重发');
  } finally { store.close(); }
});

test('达到恢复次数、任务限额、收到部分内容、永久拒绝或未知结果时停止', async () => {
  for (const kind of ['exhausted', 'round_limit', 'partial', 'auth', 'unknown'] as const) {
    const { store, run, project } = refactorFixture();
    run.status = 'running'; run.rounds = 1;
    if (kind === 'round_limit') { project.config.maxRounds = 1; store.db.set('project', project); }
    let calls = 0, shown = '';
    try {
      await assert.rejects(callModel(store, run, 'test', async (_p, _s, _m, _t, _signal, delta) => {
        calls++;
        if (kind === 'partial') { delta?.('已有片段'); throw unknown(); }
        if (kind === 'auth') throw new RequestError('HTTP 401', false, { source: 'upstream', code: 'HTTP_401' });
        throw kind === 'unknown' ? unknown() : disconnected();
      }, fakeProfile, 'test', [], [], new AbortController().signal, text => { shown += text; }));
      assert.equal(calls, kind === 'exhausted' ? 3 : 1, kind);
      if (kind === 'partial') assert.equal(shown, '已有片段');
    } finally { store.close(); }
  }
});

test('工具参数或推理已经开始时，即使启用未知请求重试也不自动整轮重发', async () => {
  for (const phase of ['tool_input', 'thinking'] as const) {
    const { store, run } = refactorFixture();
    let calls = 0;
    try {
      await assert.rejects(callModel(store, run, 'partial-output', async (...args) => {
        calls++; args[6]?.onActivity?.(phase); throw unknown();
      }, { ...fakeProfile, networkRecovery: { maxRetries: 2, retryUnknown: true } }, '', [], [], new AbortController().signal));
      assert.equal(calls, 1); assert.equal(run.networkRetries ?? 0, 0);
      assert.equal(attempts(store, run.id).length, 1);
    } finally { store.close(); }
  }
});

test('取消恢复等待不会重发，已经记录的失败和候选保留', async () => {
  const { store, run } = refactorFixture();
  const controller = new AbortController(); let calls = 0;
  try {
    await assert.rejects(callModel(store, run, 'test', async () => { calls++; throw disconnected(); }, fakeProfile, 'test', [], [], controller.signal, () => {}, { onActivity: phase => { if (phase === 'retrying') controller.abort(); } }));
    assert.equal(calls, 1); assert.equal(attempts(store, run.id).length, 1);
    assert.equal(store.db.run(run.id).changes[0].content, '候选稿');
  } finally { store.close(); }
});

test('主动启用未知请求恢复仍受费用预算约束，未知费用不被成功回执掩盖', async () => {
  for (const hardBudget of [false, true]) {
    const { store, run, project } = refactorFixture(); run.status = 'running'; run.rounds = 1;
    if (hardBudget) { project.config.stageBudget = 10; store.db.set('project', project); }
    let calls = 0;
    try {
      const promise = callModel(store, run, 'test', async () => { if (++calls === 1) throw unknown(); return fakeResult(); }, { ...fakeProfile, networkRecovery: { maxRetries: 1, retryUnknown: true } }, 'test', [], [], new AbortController().signal);
      if (hardBudget) { await assert.rejects(promise); assert.equal(calls, 1); }
      else { await promise; assert.equal(calls, 2); assert.equal(run.usage.cost, null); assert.equal(attempts(store, run.id)[0].usageState, 'unknown'); }
    } finally { store.close(); }
  }
});

test('真实 HTTP 临时限流可以恢复，余额不足不会循环重试', async () => {
  for (const quota of [false, true]) {
    let calls = 0;
    const server = http.createServer((_req, res) => {
      if (++calls === 1) { res.writeHead(429, { 'retry-after': '0', 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: quota ? 'insufficient_quota' : 'rate_limit_exceeded' } })); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { store, run } = refactorFixture(); run.status = 'running'; run.rounds = 1;
    try {
      const profile = { ...fakeProfile, stream: false, baseUrl: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1` };
      const promise = callModel(store, run, 'test', invokeModel, profile, 'test', [], [], new AbortController().signal);
      if (quota) { await assert.rejects(promise); assert.equal(calls, 1); }
      else { assert.equal((await promise).text, 'ok'); assert.equal(calls, 2); }
    } finally { store.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

test('统一恢复入口补齐遗漏文件，保留已通过候选，绝不自动采纳或推进阶段', async () => {
  let calls = 0, repair = false;
  const model = { ...fakeProfile, outputLimit: 4096, contextLimit: 200000 };
  const service: Service = new Service(skill, () => {}, async () => {
    calls++;
    if (!repair) return fakeResult('还没提交');
    const current = service.store!.db.runs().find(r => r.status === 'running')!;
    if (current.changes.length === 1) {
      const p = service.store!.db.project();
      const file = stageOutputs('S02', p).find(file => file !== paths.config)!;
      return { ...fakeResult(), calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(file, fixture(p, file, service))] }) }], stop: 'tools' as const };
    }
    return fakeResult('已检查');
  });
  service.profiles = [model];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('unified-recovery'), title: '隔离恢复验证', premise: '维修员', config: { defaultProfileId: model.id } });
    const p = service.store!.db.project(); p.stage = 'S02'; p.completed['S01:global'] = 'fixture'; service.store!.db.set('project', p);
    const run = service.makeRun('stage', '完善配置');
    const good = service.change(paths.config, fixture(p, paths.config, service));
    run.changes = [good]; service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    assert.equal(calls, 3); assert.equal(service.store!.db.run(run.id).failure?.code, 'REPAIR_EXHAUSTED');
    repair = true;
    const resumed = await service.invoke('run.recover', { id: run.id });
    for (let i = 0; service.runner?.controller; i++) { assert.ok(i < 2000); await new Promise(r => setTimeout(r, 5)); }
    const result = service.store!.db.run(resumed);
    assert.equal(result.status, 'awaiting_review', result.error ?? '');
    assert.deepEqual(result.changes.find(c => c.path === paths.config), good);
    assert.equal(result.rounds, 4);
    assert.equal(result.accepted, false); assert.equal(service.store!.db.project().stage, 'S02'); assert.equal(service.store!.db.project().revision, 1);
    assert.equal(service.store!.db.events().filter(e => e.runId === result.id && e.kind === 'recovery-requested').length, 1);
  } finally { await service.drain(); }
});
