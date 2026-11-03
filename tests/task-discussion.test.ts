import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { professionalMethod } from '../src/core/creation-policy';
import { hash, paths, renderProgress } from '../src/core/domain';
import { recordUsage } from '../src/core/telemetry';
import { profileSchema, type ModelResult, type Run, type SecretProfile } from '../src/shared/types';
import type { Caller } from '../src/core/runner';
import { fixture as contentFixture } from './fixtures/workflow';

const profile: SecretProfile = { ...profileSchema.parse({ id: 'dialogue-test', name: '任务对话模拟', protocol: 'chat', baseUrl: 'http://127.0.0.1:9999/v1', model: 'fixture', contextLimit: 128000, outputLimit: 4096 }), apiKey: 'local-fixture-only' };
const response = (text: string, calls: { name: string; args: unknown }[] = []): ModelResult => ({ text, calls: calls.map((call, index) => ({ id: `tool-${index}`, name: call.name, arguments: JSON.stringify(call.args) })), native: null, usage: { input: 100, output: 30, cost: 0, currency: 'USD' }, stop: calls.length ? 'tools' : 'complete' });
const repair = { kind: 'stage', goal: '补齐项目配置和文风', scope: '只处理当前阶段缺失的两个候选', request: '保留原有要求，补齐本阶段候选并重新检查', outputs: ['项目配置', '文风样本与规则'] };

async function fixture(caller: Caller, status: Run['status'] = 'needs_repair') {
  const scope = path.resolve('.test-output/task-discussion-tests');
  fs.mkdirSync(scope, { recursive: true });
  const parent = fs.mkdtempSync(path.join(scope, 'case-'));
  const service = new Service(path.resolve('resources/skill'), () => {}, caller);
  service.profiles = [structuredClone(profile)];
  await service.invoke('project.create', { parent, title: '任务对话验收', premise: '检修员发现异常规则', config: { defaultProfileId: profile.id } });
  const project = service.store!.db.project();
  project.stage = 'S02';
  project.completed.S01 = '已确认';
  project.revision++;
  service.store!.commit([service.change(paths.progress, renderProgress(project))], project);
  const run = service.makeRun('stage', '整理项目与文风');
  run.status = status;
  run.responseText = '旧模型判断：缺少授权封装，不能生成。';
  run.issues = [
    { code: 'required_output', severity: 'error', path: paths.config, message: '本阶段必需产物尚未生成' },
    { code: 'required_output', severity: 'error', path: paths.style, message: '本阶段必需产物尚未生成' }
  ];
  service.store!.db.saveRun(run);
  return { service, run, root: service.store!.root };
}

async function done(service: Service) {
  const deadline = Date.now() + 10000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Task did not finish');
    await new Promise(resolve => setTimeout(resolve, 5));
    if (!service.chat?.controller && !service.runner?.controller) return;
  }
}

test('阶段内明确修改直接执行当前候选，只一次讨论请求，不再要求确认任务卡或发送结束回执', async () => {
  let discussions = 0, executions = 0, prompt = '';
  let service: Service;
  const f = await fixture(async (_profile, system, _messages, tools) => {
    if (tools.some(tool => tool.name === 'propose_action')) {
      discussions++; prompt = system;
      assert.match(tools.find(tool => tool.name === 'propose_action')!.description, /直接执行，不要求再次确认/);
      return response('', [{ name: 'propose_action', args: repair }]);
    }
    executions++;
    const p = service.store!.db.project();
    return response('', [{ name: 'propose_changes', args: { changes: [paths.config, paths.style].map(file => ({ path: file, content: contentFixture(p, file, service), baseHash: service.store!.db.document(file)?.hash ?? null })) } }]);
  });
  service = f.service;
  try {
    const formal = hash(fs.readFileSync(path.join(f.root, paths.config)));
    const operationId = 'author-edit-message';
    const turnId = await service.invoke('run.discuss', { id: f.run.id, text: '帮我补齐当前阶段的内容', profileId: profile.id, allowCandidateEdits: true }, { operationId });
    await done(service);
    const conversation = service.snapshot().conversations!.find(item => item.runId === f.run.id)!;
    const data = await service.invoke('chat.read', { id: conversation.id });
    assert.equal(discussions, 1);
    assert.equal(executions, 1);
    assert.match(prompt, /直接执行，不需要再次让作者点击确认/);
    assert.equal(data.proposals.length, 1);
    assert.equal(data.proposals[0].status, 'executed');
    assert.equal(data.proposals[0].executionId, f.run.id);
    assert.equal(service.store!.db.run(f.run.id).status, 'awaiting_review');
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(hash(fs.readFileSync(path.join(f.root, paths.config))), formal);
    const repeated = await service.invoke('run.discuss', { id: f.run.id, text: '帮我补齐当前阶段的内容', profileId: profile.id, allowCandidateEdits: true }, { operationId });
    assert.equal(repeated, turnId, '自动执行必须使用独立回执，不能覆盖原消息回执');
    await service.invoke('proposal.confirm', { id: data.proposals[0].id, version: data.proposals[0].version });
    assert.equal(executions, 1, '重复确认不能重复请求');
  } finally { await service.drain(); }
});

test('简化流程仍区分提问与执行，未知请求不获得自动修改权限', async () => {
  const first = await fixture(async () => response('这里只解释当前结果。'));
  try {
    const before = JSON.stringify(first.service.store!.db.run(first.run.id));
    await first.service.invoke('run.discuss', { id: first.run.id, text: '为什么这个阶段要这样写？', allowCandidateEdits: true });
    await done(first.service);
    assert.equal(JSON.stringify(first.service.store!.db.run(first.run.id)), before);
    assert.equal(first.service.chat!.records.all('action_proposals').length, 0);
  } finally { await first.service.drain(); }
  let executions = 0, discussionCalls = 0;
  const second = await fixture(async (_p, _s, _m, tools) => {
    if (tools.some(tool => tool.name === 'propose_action')) return ++discussionCalls === 1 ? response('', [{ name: 'propose_action', args: repair }]) : response('上次请求结果未知，需要先确认是否重新请求。');
    executions++; return response('不应执行');
  }, 'unknown');
  try {
    await second.service.invoke('run.discuss', { id: second.run.id, text: '帮我修改', allowCandidateEdits: true });
    await done(second.service);
    assert.equal(executions, 0);
    const proposal = second.service.chat!.records.all('action_proposals')[0];
    assert.equal(proposal.executionSource, undefined);
    await assert.rejects(second.service.invoke('proposal.confirm', { id: proposal.id, version: proposal.version }), /结果与费用未知/);
  } finally { await second.service.drain(); }
});

test('任务报错提问带入真实状态和上一阶段确认记录，不重跑或修改候选', async () => {
  let system = '', calls = 0;
  const { service, run, root } = await fixture(async (_profile, prompt) => { system = prompt; calls++; return response('上一阶段已经确认；本阶段尚未生成项目配置和文风候选。'); });
  try {
    const before = JSON.stringify(service.store!.db.run(run.id));
    const formal = hash(fs.readFileSync(path.join(root, paths.config)));
    const general = service.snapshot().conversations![0];
    service.chat!.records.save('conversation_messages', { id: 'private-chat', conversationId: general.id, turnId: '', role: 'user', content: '其他聊天不可自动读的内容', createdAt: new Date().toISOString(), status: 'complete', citations: [] });
    await service.invoke('run.discuss', { id: run.id, text: '为什么会出现这些报错？', profileId: profile.id, displayedError: '当前有两项阻断' });
    await done(service);
    const conversation = service.snapshot().conversations!.find(item => item.runId === run.id)!;
    const data = await service.invoke('chat.read', { id: conversation.id });
    assert.equal(calls, 1);
    assert.equal(data.messages.length, 2);
    assert.equal(data.proposals.length, 0);
    assert.ok(system.includes(professionalMethod(path.resolve('resources/skill'), 'task-discussion').content));
    const context = JSON.parse(data.turns[0].taskContext!);
    assert.equal(context.project.completed.S01, '已确认');
    assert.equal(context.task.status, 'needs_repair');
    assert.deepEqual(context.task.missingCandidates, [paths.config, paths.style]);
    assert.equal(context.displayedError, '当前有两项阻断');
    assert.doesNotMatch(system, /其他聊天不可自动读的内容/);
    assert.equal(JSON.stringify(service.store!.db.run(run.id)), before);
    assert.equal(hash(fs.readFileSync(path.join(root, paths.config))), formal);
    assert.equal(service.snapshot().runs.length, 1);
    assert.equal(conversation.online, false);
  } finally { await service.drain(); }
});

test('任务连续追问沿用本任务历史并读取新状态，重新打开后记录仍在', async () => {
  const requests: string[] = [];
  const { service, run, root } = await fixture(async (_profile, _system, messages) => { requests.push(JSON.stringify(messages)); return response('依据当前任务回答。'); });
  try {
    await service.invoke('run.discuss', { id: run.id, text: '缺了什么？', profileId: profile.id });
    await done(service);
    const changed = service.store!.db.run(run.id);
    changed.error = '候选检查仍未通过';
    service.store!.db.saveRun(changed);
    await service.invoke('run.discuss', { id: run.id, text: '那下一步怎么办？', profileId: profile.id });
    await done(service);
    assert.match(requests[1], /缺了什么/);
    const conversations = service.snapshot().conversations!.filter(item => item.runId === run.id);
    assert.equal(conversations.length, 1);
    service.close();
    await service.invoke('project.open', { root });
    const data = await service.invoke('chat.page', { id: conversations[0].id });
    assert.equal(data.messages.length, 4);
    assert.match(data.turns[1].taskContext!, /候选检查仍未通过/);
  } finally { await service.drain(); }
});

test('对话本身失败后可继续问原因，并带上此前错误而不重试原任务', async () => {
  let calls = 0, system = '';
  const { service, run } = await fixture(async (_profile, prompt) => {
    if (++calls === 1) throw new Error('模拟连接故障：服务暂不可用');
    system = prompt;
    return response('刚才的请求连接失败，作品和当前任务没有变化。');
  });
  try {
    await service.invoke('run.discuss', { id: run.id, text: '为什么报错？', profileId: profile.id });
    await done(service);
    await service.invoke('run.discuss', { id: run.id, text: '刚才这条消息又怎么了？', profileId: profile.id });
    await done(service);
    assert.match(system, /本任务对话近期请求错误/);
    assert.match(system, /模拟连接故障：服务暂不可用/);
    assert.equal(calls, 2);
    assert.equal(service.store!.db.run(run.id).status, 'needs_repair');
  } finally { await service.drain(); }
});

test('不支持工具的文字模型仍可解释任务报错且不伪造执行', async () => {
  let toolsCount = -1;
  const { service, run } = await fixture(async (_profile, _system, _messages, tools) => { toolsCount = tools.length; return response('这个模型可以回答问题，但不能执行工具来生成阶段候选。'); });
  try {
    service.profiles[0].tools = false;
    service.profiles[0].capabilities.tools = 'failed';
    await service.invoke('run.discuss', { id: run.id, text: '为什么这个模型做不了任务？', profileId: profile.id });
    await done(service);
    assert.equal(toolsCount, 0);
    assert.equal(service.store!.db.run(run.id).status, 'needs_repair');
    assert.equal(service.snapshot().runs.length, 1);
  } finally { await service.drain(); }
});

test('任务对话可读取自己的未接受候选并标明候选状态', async () => {
  let count = 0, toolOutput = '';
  const { service, run } = await fixture(async (_profile, _system, messages) => {
    if (++count === 1) return response('', [{ name: 'read_task_candidate', args: { path: paths.config } }]);
    toolOutput = messages.filter(message => message.role === 'tool').at(-1)!.content;
    return response('候选里还有空字段，尚未采纳。');
  });
  try {
    run.changes = [{ path: paths.config, content: '尚未接受的项目候选', baseHash: null }];
    service.store!.db.saveRun(run);
    await service.invoke('run.discuss', { id: run.id, text: '这个候选哪里有问题？', profileId: profile.id });
    await done(service);
    assert.deepEqual(JSON.parse(toolOutput), { path: paths.config, accepted: false, content: '尚未接受的项目候选', nextLine: null });
    assert.equal(service.store!.db.run(run.id).accepted, false);
  } finally { await service.drain(); }
});

async function proposedRepair(status: Run['status'] = 'needs_repair') {
  let discussionCalls = 0, executions = 0;
  const f = await fixture(async (_profile, _system, _messages, tools) => {
    if (tools.some(tool => tool.name === 'propose_action')) return ++discussionCalls === 1 ? response('', [{ name: 'propose_action', args: repair }]) : response('可以按此方案补齐本阶段候选。');
    executions++;
    return response('本地模拟执行完成，候选仍需检查。');
  }, status);
  await f.service.invoke('run.discuss', { id: f.run.id, text: '帮我补齐缺少的内容', profileId: profile.id });
  await done(f.service);
  const conversation = f.service.snapshot().conversations!.find(item => item.runId === f.run.id)!;
  const data = await f.service.invoke('chat.read', { id: conversation.id });
  return { ...f, proposal: data.proposals[0], executions: () => executions };
}

test('修复方案确认前不执行，确认后继续原任务且不推进或改正式文件', async () => {
  const { service, run, proposal, root, executions } = await proposedRepair();
  try {
    assert.equal(executions(), 0);
    assert.equal(proposal.resumeRunId, run.id);
    const formal = hash(fs.readFileSync(path.join(root, paths.config)));
    const result = await service.invoke('proposal.confirm', { id: proposal.id, version: proposal.version });
    assert.equal(result.id, run.id);
    await done(service);
    assert.ok(executions() > 0);
    assert.equal(service.snapshot().runs.length, 1);
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.db.run(run.id).accepted, false);
    assert.equal(hash(fs.readFileSync(path.join(root, paths.config))), formal);
  } finally { await service.drain(); }
});

test('任务变化后旧修复方案失效；结果未知时不能绕过重新请求确认', async () => {
  const first = await proposedRepair();
  try {
    const changed = first.service.store!.db.run(first.run.id);
    changed.issues.push({ code: 'new', severity: 'error', message: '新增问题' });
    first.service.store!.db.saveRun(changed);
    await assert.rejects(first.service.invoke('proposal.confirm', { id: first.proposal.id, version: first.proposal.version }), /已变化/);
    assert.equal(first.executions(), 0);
  } finally { await first.service.drain(); }
  const second = await proposedRepair('unknown');
  try {
    await assert.rejects(second.service.invoke('proposal.confirm', { id: second.proposal.id, version: second.proposal.version }), /结果与费用未知/);
    assert.equal(second.executions(), 0);
    const result = await second.service.invoke('proposal.confirm', { id: second.proposal.id, version: second.proposal.version, retryUnknown: true });
    assert.equal(result.id, second.run.id);
    await done(second.service);
    assert.ok(second.executions() > 0);
  } finally { await second.service.drain(); }
});

test('预算调整和后台费用入账不会使待确认修复卡失效，仍由作者启动执行', async () => {
  const { service, run, proposal, executions } = await proposedRepair();
  try {
    await service.invoke('project.configure', { config: { ...service.store!.db.project().config, maxRounds: 32 } });
    const current = service.store!.db.run(run.id);
    const usage = { input: 20, output: 10, cost: 0.2, currency: 'USD' };
    recordUsage(service.store!, current, usage, { phase: 'assessment', profileId: profile.id, profileVersion: 1, usage });
    assert.equal(executions(), 0);
    const result = await service.invoke('proposal.confirm', { id: proposal.id, version: proposal.version });
    await done(service);
    assert.equal(result.id, run.id);
    assert.ok(executions() > 0);
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.db.run(run.id).accepted, false);
    assert.ok(service.store!.db.run(run.id).usage.cost! >= 0.2);
  } finally { await service.drain(); }
});

test('旧版待确认任务卡沿用原指纹协议，升级本身不会使未变化的卡片失效', async () => {
  const { service, run, proposal, executions } = await proposedRepair();
  try {
    delete proposal.resumeRunHashVersion;
    proposal.resumeRunHash = hash(JSON.stringify(service.store!.db.run(run.id)));
    service.chat!.records.save('action_proposals', proposal);
    const result = await service.invoke('proposal.confirm', { id: proposal.id, version: proposal.version });
    await done(service);
    assert.equal(result.id, run.id);
    assert.ok(executions() > 0);
  } finally { await service.drain(); }
});
