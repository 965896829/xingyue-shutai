import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { SkillRegistry } from '../src/core/skill-registry';
import { controllerRules } from '../src/core/agent-control';
import { recordUsage, NarrativeTelemetry } from '../src/core/telemetry';
import { attempts, callExternal } from '../src/core/runtime/model-gateway';
import { RequestError } from '../src/core/provider';
import { paths, id, stageOutputs, hash, activeBatch, batchPath, prosePath, qualityPath } from '../src/core/domain';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture as documentFixture } from './fixtures/workflow';
import type { Caller } from '../src/core/runner';
import type { ModelResult, Usage } from '../src/shared/types';
import { documentPreviewText } from '../src/shared/run-presentation';

const skill = path.resolve('resources/skill');
const model = { ...fakeProfile, contextLimit: 200000, outputLimit: 4096, stream: false };
const reply = (text = '已完成检查', changes?: unknown): ModelResult => ({ ...fakeResult(text), native: null, ...(changes ? {
  calls: [{ id: id(), name: 'propose_changes', arguments: JSON.stringify({ changes }) }], stop: 'tools' as const
} : {}) });

async function setup(caller: Caller = async () => reply(), root = skill) {
  const service = new Service(root, () => {}, caller);
  service.profiles = [structuredClone(model)];
  await service.invoke('project.create', { parent: isolatedRoot('agent-control'), title: '总控验收', premise: '维修员追查停电原因', config: { defaultProfileId: model.id } });
  const p = service.store!.db.project();
  p.stage = 'S02';
  p.completed['S01:global'] = 'accepted-in-fixture';
  service.store!.db.set('project', p);
  const run = service.makeRun('stage', '保留现有创作要求，整理项目与文风');
  service.store!.db.saveRun(run);
  return { service, run };
}

test('总控实际装入全部技能，支持本机修改且其他内置资源仍受锁保护', () => {
  const root = path.join(isolatedRoot('rules'), 'skill');
  fs.cpSync(skill, root, { recursive: true });
  const registry = new SkillRegistry(root), before = registry.load('webnovel-project-config');
  for (const entry of registry.entries) {
    const loaded = registry.load(entry.id);
    assert.match(loaded.content, /总控优先级与工作模式/);
    assert.ok(entry.tools.includes('propose_changes'));
    assert.ok(entry.tools.every(tool => !tool.includes('.')));
  }
  fs.appendFileSync(path.join(root, 'runtime/agent.md'), '\n本地总控标记：保持维修员身份。\n');
  const after = registry.load('webnovel-project-config');
  assert.notEqual(after.hash, before.hash);
  assert.match(after.content, /本地总控标记/);
  fs.appendFileSync(path.join(root, 'runtime/references/shared-contract.md'), '\n更改');
  assert.throws(() => registry.load('webnovel-project-config'), /完整性/);
});

test('S02 获得真实授权与版本资料，遗漏产物自动补齐后停在作者审阅，不改正式文件', async () => {
  let calls = 0;
  let service: Service;
  const created = await setup(async (_profile, system, messages, tools) => {
    calls++;
    assert.match(system, /总控优先级与工作模式/);
    assert.doesNotMatch(system, /本客户端拟实现的接口/);
    assert.ok(tools.some(tool => tool.name === 'propose_changes'));
    const envelope = JSON.parse(messages[0].content);
    for (const key of ['project_id', 'branch_id', 'run_id', 'stage', 'chapter_no', 'expected_revision', 'authorization', 'context_manifest', 'skill_lock']) assert.ok(key in envelope, key);
    assert.equal(envelope.authorization.accepted_stages['S01:global'], 'accepted-in-fixture');
    assert.equal(envelope.authorization.generate, true);
    assert.equal(envelope.authorization.can_commit, false);
    assert.equal(envelope.skill_lock.agent_hash, controllerRules(skill).hash);
    if (calls === 1) return reply('只给了说明，尚未提交内容');
    if (calls === 2) {
      assert.match(messages.at(-1)!.content, /补齐或修复/);
      const p = service.store!.db.project();
      return reply('', stageOutputs('S02', p).map(file => service.change(file, documentFixture(p, file, service))));
    }
    return reply();
  });
  service = created.service;
  try {
    const before = service.store!.readAccepted(paths.config).hash;
    await service.runner!.drive(created.run.id);
    const run = service.store!.db.run(created.run.id);
    assert.equal(calls, 3);
    assert.equal(run.status, 'awaiting_review', run.error ?? '');
    assert.equal(run.repairAttempts?.stage, 1);
    assert.equal(run.changes.length, 2);
    assert.equal(run.issues.filter(issue => issue.severity === 'error').length, 0);
    assert.equal(service.store!.readAccepted(paths.config).hash, before);
    assert.equal(service.store!.db.project().revision, 1);
    assert.equal(run.usage.input, 30);
  } finally { await service.drain(); }
});

test('重复遗漏最多自动修复两轮，交接保留费用、轮数、工具数、修复次数与根任务', async () => {
  let calls = 0;
  const { service, run } = await setup(async () => { calls++; return reply('尚无产物'); });
  try {
    await service.runner!.drive(run.id);
    const old = service.store!.db.run(run.id);
    assert.equal(calls, 3);
    assert.equal(old.status, 'needs_repair');
    assert.equal(old.repairAttempts?.stage, 2);
    const next = service.rebuildRun(old, model.id, '继续补齐');
    assert.equal(next.parentRunId, old.id);
    assert.equal(next.rounds, old.rounds);
    assert.equal(next.toolCount, old.toolCount);
    assert.deepEqual(next.usage, old.usage);
    assert.deepEqual(next.repairAttempts, old.repairAttempts);
    const last = service.rebuildRun(next, model.id, '沿用现有范围');
    assert.equal(last.parentRunId, old.id);
    assert.deepEqual(last.usage, old.usage);
  } finally { await service.drain(); }
});

test('同状态保存也执行版本校验，旧副本不能覆盖新内容', () => {
  const { store, run } = refactorFixture();
  try {
    const first = store.db.run(run.id), stale = store.db.run(run.id);
    first.responseText = '先保存的新内容';
    store.db.saveRun(first);
    assert.equal(first.stateVersion, stale.stateVersion! + 1);
    stale.error = '来自旧副本';
    assert.throws(() => store.db.saveRun(stale), /状态已改变/);
    assert.equal(store.db.run(run.id).responseText, '先保存的新内容');
    assert.equal(store.db.run(run.id).error, undefined);
  } finally { store.close(); }
});

test('后台用量只追加账本，不覆盖前台状态；全部读取入口返回已结算用量', () => {
  const { store, run } = refactorFixture();
  try {
    const background = store.db.run(run.id), foreground = store.db.run(run.id);
    foreground.responseText = '正在写入的新段落';
    store.db.saveRun(foreground);
    const version = foreground.stateVersion;
    const usage: Usage = { input: 20, output: 10, cost: 0.25, currency: 'USD' };
    recordUsage(store, background, usage, { phase: 'assessment', profileId: model.id, profileVersion: 1, usage });
    assert.equal(store.db.run(run.id).stateVersion, version);
    foreground.responseText += '继续';
    store.db.saveRun(foreground);
    for (const current of [store.db.run(run.id), store.db.runs()[0], store.db.runPage().items[0], [...store.db.allRuns()][0]]) {
      assert.equal(current.usage.cost, 0.25);
      assert.equal(current.responseText, '正在写入的新段落继续');
    }
  } finally { store.close(); }
});

test('交接继续共享预算账本，既不清零也不重复累计旧费用', async () => {
  const { service, run } = await setup();
  const store = service.store!;
  let calls = 0;
  const config = { provider: 'fixture', model: 'fixture', version: 1, identity: {}, pricing: 1, currency: 'USD' };
  try {
    const p = store.db.project();
    p.config.stageBudget = 0.5;
    store.db.set('project', p);
    const receipt = await callExternal(store, run, 'test', config, {}, 250000000n, new AbortController().signal, async () => { calls++; return { ...reply(), usage: { input: 10, output: 10, cost: 0.25, currency: 'USD' } }; }, result => result.usage);
    recordUsage(store, run, receipt.usage, { phase: 'test', profileId: model.id, profileVersion: 1, usage: receipt.usage });
    const next = service.rebuildRun(store.db.run(run.id), model.id);
    await assert.rejects(callExternal(store, next, 'continued', config, {}, 300000000n, new AbortController().signal, async () => { calls++; return reply(); }, result => result.usage), /费用上限/);
    await callExternal(store, next, 'continued', config, {}, 200000000n, new AbortController().signal, async () => { calls++; return reply(); }, result => result.usage);
    assert.equal(calls, 2);
    assert.equal(attempts(store, run.id).length, 2);
    assert.equal(attempts(store, run.id)[1].parentRunId, run.id);
    assert.equal(store.db.get<Usage>(`budgetBaseline:${run.id}`)!.cost, 0);
  } finally { await service.drain(); }
});

test('未知远端结果不会进入自动修复循环', async () => {
  let calls = 0;
  const { service, run } = await setup(async () => { calls++; throw new RequestError('已发送但连接中断', true); });
  try {
    await service.runner!.drive(run.id);
    assert.equal(calls, 1);
    const current = service.store!.db.run(run.id);
    assert.equal(current.status, 'unknown');
    assert.equal(current.usage.cost, null);
    assert.equal(current.repairAttempts, undefined);
  } finally { await service.drain(); }
});

test('修改总控使旧上下文失效，空规则阻止发送请求', async () => {
  const root = path.join(isolatedRoot('editable-rules'), 'skill');
  fs.cpSync(skill, root, { recursive: true });
  let calls = 0;
  const { service, run } = await setup(async () => { calls++; return reply(); }, root);
  try {
    run.agentRulesHash = controllerRules(root).hash;
    service.store!.db.saveRun(run);
    fs.appendFileSync(path.join(root, 'runtime/agent.md'), '\n新要求：不改变主人公身份。\n');
    assert.equal(service.runner!.needsFreshContext(run), true);
    await assert.rejects(service.invoke('run.accept', { id: run.id, proposalHash: run.proposalHash }), /总控规则已更新/);
    await service.runner!.drive(run.id);
    assert.equal(calls, 0);
    fs.writeFileSync(path.join(root, 'runtime/agent.md'), '');
    const next = service.makeRun('stage', '测试空规则');
    service.store!.db.saveRun(next);
    await service.runner!.drive(next.id);
    assert.equal(calls, 0);
    assert.match(service.store!.db.run(next.id).error!, /总控规则/);
  } finally { await service.drain(); }
});

test('讨论和叙事评估均加载总控，保留各自输出模式', async () => {
  let prompt = '';
  const { service, run } = await setup(async (_profile, system) => { prompt = system; return reply('这是解释，不代表已执行'); });
  try {
    const conv = service.chat!.records.create('总控讨论', false);
    const turn = service.chat!.prepare(conv.id, '什么是待确认内容？', model.id);
    await service.chat!.drive(turn.id);
    assert.match(prompt, /总控优先级与工作模式/);
    assert.match(prompt, /"mode":"discussion","generate":false/);
    assert.equal(service.store!.db.runs().length, 1);
    const telemetry = new NarrativeTelemetry(service.store!, () => {}, async (_profile, system, messages) => {
      prompt = system;
      assert.equal(JSON.parse(messages[0].content).authorization.mode, 'assessment');
      return reply(JSON.stringify({ values: { pressure: 1, payoff: 1, emotion: 1, revelation: 1, relationship: 1 }, quotes: ['维修员检查电表'], note: '只有检查动作' }));
    }, skill);
    const result = await telemetry.final(run, '维修员检查电表', model);
    await telemetry.stop();
    assert.ok(result);
    assert.match(prompt, /总控优先级与工作模式/);
    assert.match(prompt, /本次仅做阅读评估/);
  } finally { await service.drain(); }
});

test('运行中停止不会因状态版本校验而丢失取消记录或锁死控制器', async () => {
  let reached!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const { service, run } = await setup(async (_profile, _system, _messages, _tools, signal) => {
    reached();
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new RequestError('作者停止，远端结果未知', true);
  });
  try {
    const running = service.runner!.drive(run.id);
    await ready;
    service.runner!.requestControl(run.id, 'pause');
    await running;
    const current = service.store!.db.run(run.id);
    assert.equal(current.status, 'unknown');
    assert.ok(current.cancelRequestedAt);
    assert.equal(service.runner!.controller, null);
    assert.doesNotMatch(current.error!, /状态已改变/);
  } finally { await service.drain(); }
});

test('正文审稿缺失时自动修复，未完成不能跳到记忆或被接受', async () => {
  let calls = 0;
  const { service } = await setup(async (_profile, system, messages) => {
    calls++;
    assert.match(system, /总控优先级与工作模式/);
    assert.match(system, /本阶段为 review/);
    assert.equal(JSON.parse(messages[0].content).authorization.generate, true);
    return reply('只解释，没有审稿文件');
  });
  try {
    const p = service.store!.db.project();
    p.stage = 'S10';
    p.revision++;
    service.store!.commit([service.change(batchPath(activeBatch(p)), documentFixture(p, batchPath(activeBatch(p)), service))], p);
    const run = service.makeRun('stage', '核对正文');
    const prose = service.change(prosePath(p.chapter), documentFixture(p, prosePath(p.chapter), service));
    run.pipeline!.phase = 'review';
    run.pipeline!.proseHash = hash(prose.content);
    run.changes = [prose];
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const current = service.store!.db.run(run.id);
    assert.equal(calls, 3, current.error ?? '');
    assert.equal(current.status, 'needs_repair');
    assert.equal(current.pipeline!.phase, 'review');
    assert.equal(current.repairAttempts?.review, 2);
    assert.ok(current.issues.some(issue => issue.path === qualityPath(p.chapter) && issue.code === 'missing_output'));
    assert.equal(service.store!.db.project().stage, 'S10');
    const next = service.rebuildRun(current, model.id);
    assert.equal(next.pipeline!.phase, 'review');
    assert.equal(next.pipeline!.proseHash, hash(prose.content));
    assert.deepEqual(next.changes, [prose]);
    assert.equal(next.parentRunId, current.id);
  } finally { await service.drain(); }
});

test('阅读预览隐藏机器配置，普通 JSON 和作者说明仍保留', () => {
  for (const newline of ['\n', '\r\n']) {
    const content = ['# 项目配置', '', '- 目标字数：300万', '', '## 客户端设置', '```json wenxu-config', '{"stageBudget":null}', '```', '', '## 作者备注', '保留日常场面。', '```json', '{"示例":"小说中的线索"}', '```'].join(newline);
    const visible = documentPreviewText(content);
    assert.doesNotMatch(visible, /wenxu-config|stageBudget|客户端设置/);
    assert.match(visible, /目标字数：300万/);
    assert.match(visible, /保留日常场面/);
    assert.match(visible, /小说中的线索/);
    assert.match(content, /stageBudget/);
  }
});
