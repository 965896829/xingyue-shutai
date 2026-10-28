import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { KeyboardEvent } from 'react';
import { Service } from '../src/core/service';
import { profileSchema, type ModelResult, type Run, type SecretProfile } from '../src/shared/types';
import type { Caller } from '../src/core/runner';
import { hash, paths } from '../src/core/domain';
import { sendOnEnter } from '../src/ui/composer-keyboard';
import { taskProblemLinks, taskIssueId } from '../src/shared/task-links';
import { taskDiscussionContext } from '../src/core/task-discussion';
import { fixture as documentFixture } from './fixtures/workflow';
import { creationDirectionId, creationStep, creationTaskState, creationValidationIssues, retryNeedsConfirmation } from '../src/shared/run-presentation';

const profile: SecretProfile = { ...profileSchema.parse({ id: 'controls', name: '交互验收', protocol: 'chat', baseUrl: 'http://127.0.0.1:9999/v1', model: 'fixture', contextLimit: 180000, outputLimit: 4000, stream: false }), apiKey: 'fixture-only' };
const response = (text = '已按要求处理。'): ModelResult => ({ text, calls: [], native: null, usage: { input: 20, output: 20, cost: 0, currency: 'USD' }, stop: 'complete' });

test('保留非推荐案或单案重做后恢复同一方向，但不会替作者确认', () => {
  for (const id of ['d1', 'd2']) for (const keepDirectionIds of [[id], undefined]) {
    const run = { planning: { phase: 'awaiting_direction',
      report: { directions: [{ id: 'd0' }, { id: 'd1' }, { id: 'd2' }], recommendedDirectionId: 'd0' },
      regenerate: { directionId: id, keepDirectionIds }
    } } as Run;
    const saved = JSON.stringify(run);
    assert.equal(creationDirectionId(run), id);
    assert.equal(creationDirectionId(JSON.parse(saved)), id, '刷新后仍从持久化任务恢复保留案');
    assert.equal(JSON.stringify(run), saved);
    assert.equal(run.planning!.selectedDirectionId, undefined);
    assert.equal(creationStep(run), 1);
  }
});

test('整组三案重抽使用新推荐，失效方向与旧任务安全回退', () => {
  assert.equal(creationDirectionId(), '');
  assert.equal(creationDirectionId({ planning: {} } as Run), '');
  const run = { planning: { phase: 'awaiting_direction',
    report: { directions: [{ id: 'd0' }, { id: 'd1' }, { id: 'd2' }], recommendedDirectionId: 'd2' },
    regenerate: { directionId: '', keepDirectionIds: [] }
  } } as unknown as Run;
  assert.equal(creationDirectionId(run), 'd2', '即使新三案复用旧 ID，也不能沿用旧保留案');
  run.planning!.regenerate!.directionId = 'removed';
  assert.equal(creationDirectionId(run), 'd2');
  delete run.planning!.regenerate;
  assert.equal(creationDirectionId(run), 'd2');
});

test('作者最终确认的方向优先于重做记录和模型推荐', () => {
  const run = { planning: { selectedDirectionId: 'd2',
    report: { directions: [{ id: 'd0' }, { id: 'd1' }, { id: 'd2' }], recommendedDirectionId: 'd0' },
    regenerate: { directionId: 'd1', keepDirectionIds: ['d1'] }
  } } as Run;
  assert.equal(creationDirectionId(run), 'd2');
});

test('开书步骤以方案确认作为命名入口，生成候选或选择方向不会跳到保存', () => {
  assert.equal(creationStep(), 1);
  const run = { planning: { phase: 'awaiting_direction', selectedDirectionId: 'd0' } } as Run;
  assert.equal(creationStep(run), 1);
  run.planning!.phase = 'contract';
  assert.equal(creationStep(run), 2);
  run.planning!.phase = 'ready';
  assert.equal(creationStep(run), 2);
  run.planning!.planApproval = { hash: 'approval', planHash: 'plan', binding: 'input', at: new Date().toISOString() };
  assert.equal(creationStep(run), 3);
});

test('开书故障覆盖保存的生成阶段，未知请求仍要求核对费用', () => {
  const run = { status: 'failed', error: '模型返回 HTTP 502。模型服务或中转暂时异常。', planning: { phase: 'contract' } } as Run;
  assert.equal(creationTaskState(run).title, '模型服务暂时不可用');
  assert.equal(creationTaskState(run).recovery, 'resume');
  assert.equal(retryNeedsConfirmation(run), false);
  run.status = 'unknown';
  assert.equal(creationTaskState(run).title, '上次请求结果尚未确认');
  assert.equal(retryNeedsConfirmation(run), true);
  run.status = 'paused'; run.error = undefined;
  assert.equal(creationTaskState(run).title, '当前步骤已暂停');
  run.status = 'running';
  assert.equal(creationTaskState(run).recovery, null);
});

test('开书审核耗尽可从统一入口授权局部修复，任务预算耗尽仍需先调整设置', () => {
  const run = { status: 'needs_repair', planning: { phase: 'reviewing_contract', semanticRevisions: 1,
    contractReview: { result: { issues: [{ severity: 'major' }] } } } } as Run;
  assert.equal(creationTaskState(run).recovery, 'resume');
  run.error = '任务已达到轮数上限';
  assert.equal(creationTaskState(run).recovery, 'review');
});

test('旧开书任务的普通建议不再重复要求理由，其他警告和错误仍显示', () => {
  const run = { issues: [
    { code: 'detail', severity: 'warning', message: '可在章节中补充细节' },
    { code: 'detail', severity: 'warning', message: '可在章节中补充细节', path: paths.seed },
    { code: 'other', severity: 'warning', message: '另一个需要确认的提醒' },
    { code: 'detail', severity: 'error', message: '可在章节中补充细节' }
  ], planning: { contractReview: { result: { issues: [{ code: 'detail', severity: 'minor', explanation: '可在章节中补充细节' }] } } } } as Run;
  assert.deepEqual(creationValidationIssues(run), run.issues.slice(1));
  delete run.planning;
  assert.deepEqual(creationValidationIssues(run), run.issues);
});

async function fixture(caller: Caller, status: Run['status'] = 'paused') {
  const base = path.resolve('.test-output/chat-controls-tests');
  fs.mkdirSync(base, { recursive: true });
  const service = new Service(path.resolve('resources/skill'), () => {}, caller);
  service.profiles = [structuredClone(profile)];
  await service.invoke('project.create', { parent: fs.mkdtempSync(path.join(base, 'case-')), title: '按钮验收', premise: '检修员发现异常规则', config: { defaultProfileId: profile.id } });
  const run = service.makeRun('stage', '整理设定');
  run.status = status;
  service.store!.db.saveRun(run);
  return { service, run };
}
async function done(service: Service) {
  const end = Date.now() + 10000;
  while (service.runner?.controller || service.chat?.controller) {
    if (Date.now() > end) throw new Error('Execution did not finish');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('Enter 发送，Shift+Enter 换行，输入法确认和长按不会误发送', () => {
  for (const [overrides, enabled, sends, prevents] of [
    [{}, true, 1, 1], [{ shiftKey: true }, true, 0, 0], [{ nativeEvent: { isComposing: true } }, true, 0, 0],
    [{ nativeEvent: { keyCode: 229 } }, true, 0, 0], [{ repeat: true }, true, 0, 1], [{}, false, 0, 1],
    [{ ctrlKey: true }, true, 1, 1], [{ key: 'a' }, true, 0, 0]
  ] as const) {
    let sent = 0, prevented = 0;
    sendOnEnter({ key: 'Enter', nativeEvent: {}, preventDefault: () => prevented++, ...overrides } as unknown as KeyboardEvent<HTMLTextAreaElement>, enabled, () => sent++);
    assert.equal(sent, sends);
    assert.equal(prevented, prevents);
  }
});

test('旧规则恢复会建立可运行的后续任务并保留对话、候选与正式版本', async () => {
  let requests = 0, content = '';
  const { service, run } = await fixture(async (_profile, _system, messages) => { requests++; content = JSON.stringify(messages); return response(); });
  try {
    run.skillHash = 'outdated-rules';
    run.error = '任务规则或工具契约发生变化，请重新组装上下文';
    run.responseText = '旧任务回复';
    run.changes = [service.change(paths.seed, '未接受的旧候选')];
    service.store!.db.saveRun(run);
    const conversation = service.chat!.records.create('任务讨论', false, run.id);
    const before = hash(fs.readFileSync(path.join(service.store!.root, paths.seed)));
    const next = await service.invoke('run.resume', { id: run.id, instruction: '保留主人公的检修员身份' });
    await done(service);
    assert.notEqual(next, run.id);
    assert.ok(requests > 0);
    assert.match(content, /保留主人公的检修员身份/);
    assert.match(content, /未接受的旧候选/);
    assert.equal(service.store!.db.run(run.id).status, 'discarded');
    assert.equal(service.store!.db.run(run.id).responseText, '旧任务回复');
    assert.equal(service.chat!.records.get('conversations', conversation.id).runId, next);
    assert.equal(service.store!.db.project().revision, 1);
    assert.equal(hash(fs.readFileSync(path.join(service.store!.root, paths.seed))), before);
    assert.equal(service.store!.db.run(next).failure?.code, 'REPAIR_EXHAUSTED', '模拟模型没有补齐候选，应报告本次校验问题');
    assert.doesNotMatch(service.store!.db.run(next).error ?? '', /规则或工具契约发生变化/);
  } finally { await service.drain(); }
});

test('普通恢复保留任务身份，移除旧错误，并分隔前后回复', async () => {
  const { service, run } = await fixture(async () => response('新的回复'));
  try {
    run.error = '旧连接故障';
    run.responseText = '旧回复';
    run.changes = [service.change(paths.seed, documentFixture(service.store!.db.project(), paths.seed, service))];
    service.store!.db.saveRun(run);
    assert.equal(await service.invoke('run.resume', { id: run.id, instruction: '继续修复' }), run.id);
    await done(service);
    const current = service.store!.db.run(run.id);
    assert.equal(current.error, undefined);
    assert.equal(current.responseText, '旧回复\n\n新的回复');
  } finally { await service.drain(); }
});

test('确认聊天修复方案也能接续旧规则任务，并保持方案执行记录一致', async () => {
  let requests = 0;
  const { service, run } = await fixture(async () => { requests++; return response(); });
  try {
    run.skillHash = 'old-rules';
    service.store!.db.saveRun(run);
    const conversation = service.chat!.records.create('旧任务修复', false, run.id);
    const card = await service.invoke('proposal.create', { conversationId: conversation.id, profileId: profile.id, proposal: { kind: 'stage', goal: '整理设定', scope: '当前阶段', request: '保留已有要求并补齐候选', outputs: ['设定拆解'] } });
    const result = await service.invoke('proposal.confirm', { id: card.id, version: card.version });
    await done(service);
    assert.notEqual(result.id, run.id);
    assert.ok(requests > 0);
    const executed = service.chat!.records.get('action_proposals', card.id);
    assert.equal(executed.status, 'executed');
    assert.equal(executed.executionId, result.id);
    assert.equal(service.chat!.records.get('conversations', conversation.id).runId, result.id);
    assert.equal(service.store!.db.project().revision, 1);
  } finally { await service.drain(); }
});

test('用所选模型继续会带入输入框修改意见，失败任务能恢复', async () => {
  let text = '';
  const { service, run } = await fixture(async (_profile, _system, messages) => { text = JSON.stringify(messages); return response(); }, 'failed');
  try {
    const next = await service.invoke('run.handoff', { id: run.id, profileId: profile.id, instruction: '只调整叙述视角' });
    await done(service);
    assert.notEqual(next, run.id);
    assert.match(text, /只调整叙述视角/);
    assert.equal(service.store!.db.run(next).failure?.code, 'REPAIR_EXHAUSTED', '新任务已实际执行，遗漏产物不能静默成功');
  } finally { await service.drain(); }
});

test('回答作者问题时模型配置已更新，重建任务仍携带本次答案和原候选', async () => {
  let text = '';
  const { service, run } = await fixture(async (_profile, _system, messages) => { text = JSON.stringify(messages); return response(); }, 'awaiting_input');
  try {
    run.input = { question: '是否保留检修员身份？' };
    run.changes = [service.change(paths.seed, '待核对的原有设定')];
    service.store!.db.saveRun(run);
    service.profiles[0].version++;
    const next = await service.invoke('run.answer', { id: run.id, answer: '保留检修员身份，擅长现场排障' });
    await done(service);
    assert.notEqual(next, run.id);
    assert.match(text, /保留检修员身份，擅长现场排障/);
    assert.match(text, /待核对的原有设定/);
    assert.equal(service.store!.db.run(run.id).input?.answer, '保留检修员身份，擅长现场排障');
    assert.equal(service.store!.db.run(run.id).status, 'discarded');
    assert.equal(service.store!.db.run(next).profileVersion, service.profiles[0].version);
    assert.equal(service.store!.db.project().stage, 'S01');
  } finally { await service.drain(); }
});

test('未知结果仍要求确认，达到轮数上限不会悄悄增加请求', async () => {
  let requests = 0;
  const { service, run } = await fixture(async () => { requests++; return response(); }, 'unknown');
  try {
    await assert.rejects(service.invoke('run.resume', { id: run.id }), /未知/);
    run.rounds = service.store!.db.project().config.maxRounds;
    service.store!.db.saveRun(run);
    const resumed = await service.invoke('run.resume', { id: run.id, retryUnknown: true });
    await done(service);
    assert.equal(requests, 0);
    assert.match(service.store!.db.run(resumed).error!, /轮数上限/);
    assert.equal(service.store!.db.run(resumed).rounds, run.rounds);
  } finally { await service.drain(); }
});

test('报错上下文提供稳定可点击的定位，问题重排不指向别的问题', async () => {
  const { service, run } = await fixture(async () => response());
  try {
    run.error = '规则已更新';
    run.issues = [
      { code: 'required', path: paths.config, message: '项目配置未生成', severity: 'error' },
      { code: 'required', path: paths.style, message: '文风未生成', severity: 'error' }
    ];
    service.store!.db.saveRun(run);
    const context = JSON.parse(taskDiscussionContext(service.store!, run.id));
    const links = taskProblemLinks(run);
    assert.equal(links.length, 4);
    assert.ok(context.navigation.some((link: { href: string }) => link.href === links[2].href));
    assert.notEqual(links[2].href, links[3].href);
    const issue = run.issues[0], target = taskIssueId(run.id, issue);
    run.issues.reverse();
    assert.equal(taskProblemLinks(run)[3].href, `#${target}`);
    assert.notEqual(taskIssueId(run.id, { ...issue, message: '已更新的问题' }), target);
  } finally { await service.drain(); }
});
