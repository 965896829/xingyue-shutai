import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { SkillRegistry } from '../src/core/skill-registry';
import { controllerRules, taskEnvelope } from '../src/core/agent-control';
import { recordUsage, NarrativeTelemetry } from '../src/core/telemetry';
import { attempts, callExternal } from '../src/core/runtime/model-gateway';
import { RequestError } from '../src/core/provider';
import { paths, id, stageOutputs, hash, activeBatch, batchPath, prosePath, qualityPath, renderProgress, parseConfig, updateConfigDocument } from '../src/core/domain';
import { compatibleRunBase } from '../src/core/runtime-settings';
import { contextChanged } from '../src/core/context-compiler';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture as documentFixture } from './fixtures/workflow';
import type { Caller } from '../src/core/runner';
import type { ModelResult, Usage } from '../src/shared/types';
import { factSchema } from '../src/shared/types';
import { memoryCompletionHash } from '../src/core/memory-review';
import { validateEvidence } from '../src/core/memory';
import { documentPreviewText, runHasCurrentBasis } from '../src/shared/run-presentation';

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
    assert.equal(loaded.content.split(registry.controller().content).length - 1, 1);
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
    assert.equal(system.split(controllerRules(skill).content).length - 1, 1);
    assert.doesNotMatch(system, /本客户端拟实现的接口/);
    assert.ok(tools.some(tool => tool.name === 'propose_changes'));
    const envelope = JSON.parse(messages[0].content);
    for (const key of ['project_id', 'branch_id', 'run_id', 'stage', 'chapter_no', 'expected_revision', 'authorization', 'context_manifest', 'skill_lock']) assert.ok(key in envelope, key);
    assert.equal(envelope.authorization.accepted_stages['S01:global'], 'accepted-in-fixture');
    assert.match(envelope.authorization.accepted_design_policy, /宿主实际采纳记录/);
    assert.match(envelope.authorization.accepted_design_policy, /作者明确保留的决定/);
    assert.equal(envelope.authorization.generate, true);
    assert.equal(envelope.authorization.can_commit, false);
    assert.equal(envelope.skill_lock.agent_hash, controllerRules(skill).hash);
    if (calls === 1) return reply('只给了说明，尚未提交内容');
    if (calls === 2) {
      const p = service.store!.db.project();
      const repair = JSON.parse(messages.at(-1)!.content).repairScope;
      assert.deepEqual(new Set(repair.paths), new Set(stageOutputs('S02', p)));
      assert.deepEqual(repair.protectedPaths, []);
      return reply('', stageOutputs('S02', p).map(file => service.change(file, documentFixture(p, file, service))));
    }
    return reply();
  });
  service = created.service;
  try {
    const before = service.store!.readAccepted(paths.config).hash;
    await service.runner!.drive(created.run.id);
    const run = service.store!.db.run(created.run.id);
    assert.equal(calls, 2);
    assert.equal(run.status, 'awaiting_review', run.error ?? '');
    assert.equal(run.repairAttempts?.stage, 1);
    assert.equal(run.changes.length, 2);
    assert.equal(run.issues.filter(issue => issue.severity === 'error').length, 0);
    assert.equal(service.store!.readAccepted(paths.config).hash, before);
    assert.equal(service.store!.db.project().revision, 1);
    assert.equal(run.usage.input, 20);
  } finally { await service.drain(); }
});

test('设计采纳说明使用实际记录，未采纳阶段不被自动授权，当前候选仍待作者审阅', async () => {
  const { service, run } = await setup();
  try {
    const before = taskEnvelope(service.store!, skill, run);
    assert.deepEqual(before.authorization.accepted_stages, { 'S01:global': 'accepted-in-fixture' });
    assert.equal(before.authorization.can_approve, false);
    assert.equal(before.authorization.can_commit, false);
    const p = service.store!.db.project(); p.completed = {};
    service.store!.db.set('project', p);
    const after = taskEnvelope(service.store!, skill, run);
    assert.deepEqual(after.authorization.accepted_stages, {});
    assert.match(after.authorization.accepted_design_policy, /本轮新候选也未因此被采纳/);
    assert.match(after.authorization.accepted_design_policy, /实际缺失条件或硬约束冲突/);
    assert.match(after.authorization.accepted_design_policy, /原始要求优先于生成的规划和摘要/);
    assert.match(after.authorization.accepted_design_policy, /不能把与原始要求冲突的模型建议变成作者硬约束/);
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
    assert.equal(prompt.split(controllerRules(skill).content).length - 1, 1);
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
    assert.equal(prompt.split(controllerRules(skill).content).length - 1, 1);
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
    assert.equal(system.split(controllerRules(skill).content).length - 1, 1);
    assert.match(system, /本阶段为 review/);
    assert.match(system, /使用 propose_changes 提交完整质量报告候选/);
    assert.match(system, /json wenxu-review/);
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

test('审核要求重写时只修订当前正文并重新审核，最多两次且不会让审核模型改口放行', async () => {
  let service: Service, reviews = 0, rewrites = 0;
  const created = await setup(async (_profile, system, messages, tools) => {
    const p = service.store!.db.project();
    if (system.includes('本阶段为 review')) {
      reviews++;
      const file = qualityPath(p.chapter);
      return reply('', [service.change(file, documentFixture(p, file, service).replace('是否需要重写：否', '是否需要重写：是'))]);
    }
    assert.equal(tools.length, 0, '只有正文生成器参与修改，不启动记忆或下一阶段');
    assert.ok(JSON.parse(messages[0].content).reviewFeedback);
    rewrites++;
    return reply(documentFixture(p, prosePath(p.chapter), service) + '\n门外的风渐渐停了。');
  });
  service = created.service;
  try {
    const p = service.store!.db.project();
    p.stage = 'S10'; p.revision++; p.config.preview.enabled = false;
    service.store!.commit([service.change(batchPath(activeBatch(p)), documentFixture(p, batchPath(activeBatch(p)), service))], p);
    const run = service.makeRun('stage', '核对当前章');
    const prose = service.change(prosePath(p.chapter), documentFixture(p, prosePath(p.chapter), service));
    run.pipeline!.phase = 'review'; run.pipeline!.proseHash = hash(prose.content); run.changes = [prose];
    run.steps = [{ phase: 'assessment:plan', profileId: model.id, profileVersion: 1, usage: { input: 0, output: 0, cost: 0, currency: 'USD' } }];
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const current = service.store!.db.run(run.id);
    assert.equal(current.status, 'needs_repair', current.error ?? '');
    assert.equal(current.failure?.code, 'REPAIR_EXHAUSTED');
    assert.equal(rewrites, 2); assert.equal(reviews, 3);
    assert.equal(current.pipeline!.phase, 'review');
    assert.ok(current.proseReviewFeedback?.review.content.includes('是否需要重写：是'));
    assert.equal(current.facts.length, 0); assert.equal(current.accepted, false);
    assert.equal(service.store!.db.project().stage, 'S10');
    assert.equal(service.store!.db.document(prose.path)?.hash ?? null, prose.baseHash);
  } finally { await service.drain(); }
});

test('恢复正文审核清除旧错误，新请求失败时显示本次错误并保留历史', async () => {
  let service: Service, runId = '';
  const previousError = '上次模型连接中断，已保留收到的内容';
  const currentError = '本次审核请求返回 HTTP 502';
  const created = await setup(async () => {
    const current = service.store!.db.run(runId);
    assert.equal(current.status, 'running');
    assert.equal(current.error, undefined);
    throw new RequestError(currentError, true);
  });
  service = created.service;
  try {
    const p = service.store!.db.project();
    p.stage = 'S10'; p.revision++;
    service.store!.commit([service.change(batchPath(activeBatch(p)), documentFixture(p, batchPath(activeBatch(p)), service))], p);
    const run = service.makeRun('stage', '继续已保留正文的独立审核');
    runId = run.id;
    const prose = service.change(prosePath(p.chapter), documentFixture(p, prosePath(p.chapter), service));
    run.pipeline!.phase = 'review';
    run.pipeline!.proseHash = hash(prose.content);
    run.changes = [prose];
    run.status = 'unknown';
    run.error = previousError;
    service.store!.db.saveRun(run);
    service.store!.db.event(run.id, 'error', previousError);
    await service.runner!.drive(run.id);
    const current = service.store!.db.run(run.id);
    assert.equal(current.status, 'unknown');
    assert.equal(current.error, currentError);
    assert.equal(current.pipeline!.phase, 'review');
    assert.deepEqual(current.changes, [prose]);
    const errors = service.store!.db.events().filter(event => event.runId === run.id && event.kind === 'error');
    assert.deepEqual(errors.map(event => event.text), [previousError, currentError]);
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

test('章后人物变化识别已确认称谓和实体，其他人物的事实不能放开未出场角色', async () => {
  const { service } = await setup();
  try {
    const p = service.store!.db.project();
    p.stage = 'S10'; p.revision++;
    const role = (name: string, stableId: string, aliases = '') => documentFixture(p, paths.roles, service)
      .replace('# 角色卡\n', '').replaceAll('阿宁', name) + `\n- 稳定ID：${stableId}。\n- 本名/别名/称谓规则：${aliases || '无已确认别名'}\n`;
    const roles = '# 角色卡\n' + role('陈舟', 'CHAR-001') + role('早餐摊主', 'CHAR-002', '暂用“摊主”或“早餐摊主”。') + role('师父', 'CHAR-003');
    service.store!.commit([service.change(paths.roles, roles), service.change(batchPath(activeBatch(p)), documentFixture(p, batchPath(activeBatch(p)), service))], p);
    const run = service.makeRun('stage', '核对章后人物状态');
    const prose = service.change(prosePath(p.chapter), documentFixture(p, prosePath(p.chapter), service).replaceAll('阿宁', '陈舟') + '\n摊主将回信交到陈舟手里，纸上写着老人已经离开镇子。');
    run.pipeline!.phase = 'memory'; run.pipeline!.proseHash = hash(prose.content);
    const changed = (name: string, extra = '') => roles.replace(`## ${name}`, `## ${name}${extra}`).replace(new RegExp(`(## ${name}[^]*?- 当前目标：)[^\\n]*`), '$1本章实际变化');
    const check = (content: string) => {
      run.changes = [prose, service.change(paths.roles, content)];
      for (const fact of run.facts) validateEvidence(service.store!, fact, p.chapter, run.changes);
      run.memoryCompletionHash = memoryCompletionHash(run); service.runner!.check(run, p);
      return run.issues.filter(issue => issue.code === 'unaffected_character');
    };
    assert.deepEqual(check(changed('早餐摊主')), []);
    assert.ok(check(changed('师父')).some(issue => issue.message.includes('师父')));
    const fact = factSchema.parse({ id: 'memory-identity', subject: '陈舟', aliases: ['陈舟'], predicate: '收到回信', value: '收到离镇消息', kind: 'event', category: 'character', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '纸上写着老人已经离开镇子。' }] });
    run.facts = [fact];
    assert.ok(check(changed('师父')).some(issue => issue.message.includes('师父')));
    run.facts = [{ ...fact, subject: 'CHAR-003', aliases: [], value: '已离开镇子' }];
    assert.deepEqual(check(changed('师父')), []);
    run.facts = [];
    assert.ok(check(changed('师父').replace('- 稳定ID：CHAR-003。', '- 稳定ID：CHAR-003。\n- 别名：摊主')).some(issue => issue.message.includes('师父')));
  } finally { await service.drain(); }
});

test('真实样本的姓名加ID不误报未出场，分组提取完成前不催促重写角色卡', async () => {
  const { service } = await setup();
  try {
    const p = service.store!.db.project(); p.stage = 'S10'; p.revision++;
    const role = (name: string) => documentFixture(p, paths.roles, service).replace('# 角色卡\n', '').replaceAll('阿宁', name);
    const roles = '# 角色卡\n' + role('顾平安（C001）') + role('首章持刀袭击者（C005）') + role('徐敏（C002）');
    service.store!.commit([service.change(paths.roles, roles)], p);
    const run = service.makeRun('stage', '分组同步人物');
    const prose = service.change(prosePath(p.chapter), '# 第001章\n顾平安退到货架旁。持刀男人松手，随后倒在门槛上。');
    run.pipeline!.phase = 'memory'; run.pipeline!.proseHash = hash(prose.content);
    const changed = roles.replaceAll('- 当前目标：', '- 当前目标：本章变化；');
    run.changes = [prose, service.change(paths.roles, changed)];
    service.runner!.check(run, p);
    assert.ok(!run.issues.some(i => /顾平安/.test(i.message) && /character/.test(i.code)));
    assert.equal(run.issues.filter(i => i.code === 'character_evidence_pending').length, 2);
    assert.ok(!run.issues.some(i => i.code === 'unaffected_character'));
    assert.ok(run.issues.some(i => i.code === 'pipeline_pending' && i.severity === 'error'), '未完成提取不得采纳');
    const fact = factSchema.parse({ id: 'attacker-fell', subject: '持刀男人', entityIds: ['C005'], predicate: '倒地', value: '松手后倒在门槛上', kind: 'event', category: 'character', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '持刀男人松手，随后倒在门槛上。' }] });
    run.facts = [fact]; validateEvidence(service.store!, fact, p.chapter, run.changes);
    run.memoryCompletionHash = memoryCompletionHash(run); service.runner!.check(run, p);
    const errors = run.issues.filter(i => i.code === 'unaffected_character');
    assert.equal(errors.length, 1); assert.match(errors[0].message, /徐敏/);
    assert.ok(!run.issues.some(i => i.code === 'character_evidence_pending'));
    run.facts = [{ ...fact, evidence: [{ ...fact.evidence[0], quote: '正文中并不存在这句话' }] }];
    run.memoryCompletionHash = memoryCompletionHash(run); service.runner!.check(run, p);
    assert.ok(run.issues.some(i => i.code === 'unaffected_character' && i.message.includes('C005')), '错误证据不能放开人物变化');
  } finally { await service.drain(); }
});

test('原模板字段内的人物编号绑定事实，歧义编号、候选伪造编号和错误证据不放行', async () => {
  const { service } = await setup();
  try {
    const p = service.store!.db.project(); p.stage = 'S10'; p.revision++;
    const role = (name: string, id: string) => documentFixture(p, paths.roles, service).replace('# 角色卡\n', '').replaceAll('阿宁', name)
      .replace(/^- 重要度：[^\n]*/m, `- 重要度：首章事件角色，人物编号${id}。`);
    const roles = '# 角色卡\n' + role('冯亮', '人005') + role('梁敏', '人002');
    service.store!.commit([service.change(paths.roles, roles)], p);
    const run = service.makeRun('stage', '核对未直接报出姓名的人物');
    const prose = service.change(prosePath(1), '# 第001章\n持刀男子倒地，没有再回应。');
    run.pipeline!.phase = 'memory'; run.pipeline!.proseHash = hash(prose.content);
    const changed = roles.replaceAll('- 当前目标：', '- 当前目标：本章变化；');
    const fact = factSchema.parse({ id: 'attacker-death', subject: '冯亮（正文称持刀男子）', aliases: ['持刀男子'], entityIds: ['人005'],
      predicate: '倒地', value: '倒地且未回应', kind: 'event', category: 'character', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '持刀男子倒地，没有再回应。' }] });
    run.facts = [fact];
    const check = (content = changed) => {
      run.changes = [prose, service.change(paths.roles, content)];
      for (const f of run.facts) validateEvidence(service.store!, f, 1, run.changes);
      run.memoryCompletionHash = memoryCompletionHash(run); service.runner!.check(run, p);
      return run.issues.filter(i => i.code === 'unaffected_character');
    };
    assert.deepEqual(check().map(i => i.message.split(' ')[0]), ['梁敏']);
    assert.equal(check(changed.replace('人物编号人002', '人物编号人005')).length, 1, '候选中的新编号不能授权变化');
    run.facts = [{ ...fact, evidence: [{ ...fact.evidence[0], quote: '伪造的原文' }] }];
    assert.equal(check().length, 2);
    run.facts = [{ ...fact, subject: '未实名的持刀男子' }];
    service.store!.commit([service.change(paths.roles, roles.replace('人物编号人002', '人物编号人005'))], p);
    assert.equal(check().length, 2, '已采纳文件中的重号不能任意绑定一个角色');
  } finally { await service.drain(); }
});

test('模板内身份标签与带称谓的事实主体复用已采纳身份，不靠单一编号写法', async () => {
  const { service } = await setup();
  try {
    const p = service.store!.db.project(); p.stage = 'S10'; p.revision++;
    const base = documentFixture(p, paths.roles, service).replaceAll('阿宁', '孙亮');
    const forms = [
      '- 重要度：开篇事件角色；稳定身份标识C005。',
      '- 重要度：开篇事件角色，人物编号人005。',
      '- 重要度：稳定身份标识：C005。',
      '- 重要度：事件角色；稳定实体ID：C005。',
      '- 重要度：事件角色；角色编号C005。',
      '- 重要度：事件角色；人物ID为C005。',
      '- 重要度：事件角色；身份标识符是C005。'
    ];
    for (const form of forms) {
      const roles = base.replace(/^- 重要度：[^\n]*/m, form);
      service.store!.commit([service.change(paths.roles, roles)], p);
      const run = service.makeRun('stage', '按原文核对未实名的人物');
      const prose = service.change(prosePath(1), '# 第001章\n持刀男子倒地，没有再回应。');
      run.pipeline!.phase = 'memory'; run.pipeline!.proseHash = hash(prose.content);
      run.changes = [prose, service.change(paths.roles, roles.replace('- 当前目标：', '- 当前目标：本章变化；'))];
      run.facts = [factSchema.parse({ id: 'fell', subject: '未实名的持刀者', entityIds: [form.includes('人005') ? '人005' : 'C005'],
        predicate: '倒地', value: '倒地且未回应', kind: 'event', category: 'character', fromChapter: 1, revealedAt: 1,
        evidence: [{ path: prose.path, hash: hash(prose.content), quote: '持刀男子倒地，没有再回应。' }] })];
      validateEvidence(service.store!, run.facts[0], 1, run.changes);
      run.memoryCompletionHash = memoryCompletionHash(run); service.runner!.check(run, p);
      assert.ok(!run.issues.some(i => i.code === 'unaffected_character'), form);
      run.facts[0].entityIds = []; run.facts[0].subject = '孙亮（正文称持刀男子）';
      run.memoryCompletionHash = memoryCompletionHash(run); service.runner!.check(run, p);
      assert.ok(!run.issues.some(i => i.code === 'unaffected_character'), '完整姓名加称谓保留同一身份');
      run.facts[0].subject = '与孙亮无关的人（正文称持刀男子）';
      run.memoryCompletionHash = memoryCompletionHash(run); service.runner!.check(run, p);
      assert.ok(run.issues.some(i => i.code === 'unaffected_character'), '不能用姓名子串冒充已确认身份');
    }
  } finally { await service.drain(); }
});

async function settingsCandidate(stage: 'S02' | 'S03' = 'S03', caller: Caller = async () => { throw new Error('本地审阅不得调用模型'); }) {
  const service = new Service(skill, () => {}, caller);
  service.profiles = [structuredClone(model)];
  await service.invoke('project.create', { parent: isolatedRoot('settings-candidate'), title: '运行参数验收', premise: '维修员追查停电原因', config: { defaultProfileId: model.id } });
  const store = service.store!, p = store.db.project();
  p.stage = stage;
  p.revision++;
  store.commit([service.change(paths.progress, renderProgress(p))], p);
  const run = service.makeRun('stage', '完成当前阶段');
  run.manifest = service.runner!.previewContext(run, model);
  run.changes = stageOutputs(stage, p).map(file => service.change(file, documentFixture(p, file, service)));
  run.rounds = 12;
  run.status = 'awaiting_review';
  service.runner!.check(run, p);
  store.db.saveRun(run);
  return { service, store, run };
}

test('提高轮数后直接采纳原候选，不重新调用模型，原指纹与历史保留且只推进一次', async () => {
  const { service, store, run } = await settingsCandidate();
  try {
    const original = structuredClone(run);
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 30 } });
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxTools: 100, stageBudget: 2 } });
    assert.equal(compatibleRunBase(store, run), true);
    assert.equal(contextChanged(store, run.manifest!), false);
    const checked = await service.invoke('run.revalidate', { id: run.id });
    assert.equal(checked.proposalHash, original.proposalHash);
    assert.deepEqual(checked.changes, original.changes);
    assert.deepEqual(checked.issues, []);
    assert.equal(checked.baseSnapshotId, original.baseSnapshotId);
    const revision = store.db.project().revision;
    await service.invoke('run.accept', { id: run.id, proposalHash: original.proposalHash });
    assert.equal(store.db.project().stage, 'S04');
    assert.equal(store.db.project().config.maxRounds, 30);
    assert.equal(store.db.project().revision, revision + 1);
    assert.equal(store.readAccepted(paths.world).content, original.changes[0].content);
    assert.equal(store.db.run(run.id).rounds, 12);
    await service.invoke('run.accept', { id: run.id, proposalHash: original.proposalHash });
    assert.equal(store.db.project().revision, revision + 1);
  } finally { await service.drain(); }
});

test('S02 采纳配置候选保留作者新预算，不让旧候选把 30 轮覆盖回 12 轮', async () => {
  const { service, store, run } = await settingsCandidate('S02');
  try {
    const original = structuredClone(run.changes);
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 30, maxTools: 100 } });
    await service.invoke('run.accept', { id: run.id, proposalHash: run.proposalHash });
    const config = parseConfig(store.readAccepted(paths.config).content, store.db.project().config);
    assert.equal(config.maxRounds, 30);
    assert.equal(config.maxTools, 100);
    assert.deepEqual(store.db.run(run.id).changes, original);
    assert.equal(store.db.project().stage, 'S03');
  } finally { await service.drain(); }
});

test('S02 已确认创作配置同步设置与快照，重启后调整预算不抹掉约束', async () => {
  const { service, store, run } = await settingsCandidate('S02');
  try {
    const original = store.db.project();
    const creative = { pov: '第三人称有限视角', genre: '都市日常', style: '克制、清晰，选择体现代价', constraints: '主角没有超自然能力；计划不得写成已发生事实。' };
    const content = updateConfigDocument(run.changes.find(change => change.path === paths.config)!.content,
      { ...original, config: { ...original.config, ...creative } });
    const reviewed = await service.invoke('run.update', { id: run.id, path: paths.config, content });
    assert.equal(store.db.project().config.constraints, original.config.constraints, '候选尚未批准不能改设置');
    await service.invoke('project.configure', { config: { ...original.config, maxRounds: 30 } });
    await service.invoke('run.accept', { id: run.id, proposalHash: reviewed.proposalHash });
    const accepted = store.db.project();
    for (const key of Object.keys(creative) as (keyof typeof creative)[]) {
      assert.equal(accepted.config[key], creative[key]);
      assert.equal(store.db.head()!.project.config[key], creative[key]);
    }
    assert.equal(accepted.config.maxRounds, 30);
    assert.equal(accepted.stage, 'S03');
    await service.invoke('run.accept', { id: run.id, proposalHash: reviewed.proposalHash });
    assert.equal(store.db.project().revision, accepted.revision, '重复采纳不能再次修改配置或阶段');
    service.close();
    await service.open(accepted.root);
    await service.invoke('project.configure', { config: { ...service.store!.db.project().config, maxTools: 111 } });
    const reopened = service.store!.db.project();
    const saved = parseConfig(service.store!.readAccepted(paths.config).content, reopened.config);
    for (const key of Object.keys(creative) as (keyof typeof creative)[])
      assert.equal(saved[key], creative[key], '保存预算后仍保留已确认创作字段');
    assert.equal(saved.maxTools, 111);
    assert.equal(reopened.stage, 'S03');
  } finally { await service.drain(); }
});

test('轮数耗尽的任务调高预算后原地继续，累计轮数不清零且不产生交接任务', async () => {
  let calls = 0;
  const { service, store, run } = await settingsCandidate('S03', async () => { calls++; return reply(); });
  try {
    run.rounds = 0;
    store.db.saveRun(run);
    await service.runner!.drive(run.id);
    const paused = store.db.run(run.id);
    paused.status = 'paused';
    paused.rounds = 12;
    paused.error = '已达到本任务轮数上限';
    store.db.saveRun(paused);
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 30 } });
    assert.equal(service.runner!.needsFreshContext(store.db.run(run.id)), false);
    const before = calls;
    const result = await service.invoke('run.resume', { id: run.id });
    assert.equal(result, run.id);
    for (let i = 0; i < 400 && (calls === before || service.runner!.controller); i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, before + 1, store.db.run(run.id).error ?? '恢复后应继续原任务');
    assert.equal(store.db.run(run.id).rounds, 13);
    assert.equal(store.db.run(run.id).status, 'awaiting_review');
    assert.equal(store.db.runs().length, 1);
  } finally { await service.drain(); }
});

test('保存相同参数不制造新快照；真实创作变更、回改及外部修改仍阻止旧候选采纳', async () => {
  const { service, store, run } = await settingsCandidate();
  try {
    const initial = store.db.get('headSnapshot');
    await service.invoke('project.configure', { config: store.db.project().config });
    assert.equal(store.db.get('headSnapshot'), initial);
    const style = store.db.project().config.style;
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 30, style: '新的风格要求' } });
    assert.equal(compatibleRunBase(store, run), false);
    await assert.rejects(service.invoke('run.accept', { id: run.id, proposalHash: run.proposalHash }), /创作要求已改变/);
    await service.invoke('project.configure', { config: { ...store.db.project().config, style } });
    assert.equal(compatibleRunBase(store, run), false, '不能把中途真实改动伪装成仅预算调整');
    assert.equal(store.db.run(run.id).accepted, false);
  } finally { await service.drain(); }
});

test('预算兼容不能绕过未确认的磁盘改稿，也不能伪造候选批准指纹', async () => {
  const { service, store, run } = await settingsCandidate();
  try {
    const originalConfig = store.readAccepted(paths.config).content;
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 30 } });
    await assert.rejects(service.invoke('run.accept', { id: run.id, proposalHash: 'wrong-hash' }), /重新打开审阅/);
    fs.writeFileSync(path.join(store.root, paths.config), originalConfig);
    assert.equal(contextChanged(store, run.manifest!), true, '将磁盘配置倒回旧文件仍属于未确认的外部修改');
    await assert.rejects(service.invoke('run.accept', { id: run.id, proposalHash: run.proposalHash }), /外部修改/);
    fs.appendFileSync(path.join(store.root, paths.config), '\n作者新增限制：不能穿越。\n');
    assert.equal(contextChanged(store, run.manifest!), true);
    await assert.rejects(service.invoke('run.accept', { id: run.id, proposalHash: run.proposalHash }), /外部修改/);
    assert.equal(store.db.run(run.id).accepted, false);
  } finally { await service.drain(); }
});

test('调高上限自动就地恢复完整候选，重复重查兼容旧界面，费用与轮数保持', async () => {
  const { service, store, run } = await settingsCandidate();
  try {
    run.status = 'paused';
    run.error = '已达到本任务轮数上限';
    store.db.saveRun(run);
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 30 } });
    assert.equal(store.db.run(run.id).status, 'awaiting_review');
    assert.ok(store.db.events().some(event => event.runId === run.id && event.kind === 'local-recovery'));
    const checked = await service.invoke('run.revalidate', { id: run.id, reviewSaved: true });
    assert.equal(checked.status, 'awaiting_review');
    assert.equal(checked.error, undefined);
    assert.equal(checked.rounds, 12);
    assert.deepEqual(checked.usage, run.usage);
    assert.equal(checked.proposalHash, run.proposalHash);
  } finally { await service.drain(); }
});

test('最后一轮提交完整候选即进入审阅，不为结束任务再请求一次模型', async () => {
  let calls = 0, service: Service;
  const created = await setup(async () => {
    calls++;
    const p = service.store!.db.project();
    return reply('', stageOutputs('S02', p).map(file => service.change(file, documentFixture(p, file, service))));
  });
  service = created.service;
  try {
    const run = created.run;
    run.rounds = service.store!.db.project().config.maxRounds - 1;
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const current = service.store!.db.run(run.id);
    assert.equal(calls, 1);
    assert.equal(current.rounds, service.store!.db.project().config.maxRounds);
    assert.equal(current.status, 'awaiting_review', current.error ?? '');
    assert.deepEqual(current.issues, []);
    assert.equal(current.accepted, false);
    assert.equal(service.store!.db.project().stage, 'S02');
  } finally { await service.drain(); }
});

test('重启内部核验恢复预算耗尽的完整候选，页面与历史分页共享兼容状态', async () => {
  const { service, store, run } = await settingsCandidate();
  try {
    run.status = 'paused';
    run.error = '已达到本任务轮数上限';
    store.db.saveRun(run);
    const root = store.root;
    service.close();
    await service.open(root);
    assert.equal(service.store!.db.run(run.id).status, 'awaiting_review');
    await service.invoke('project.configure', { config: { ...service.store!.db.project().config, maxRounds: 31 } });
    const p = service.store!.db.project();
    const page = await service.invoke('run.page', {});
    for (const current of [service.snapshot().runs.find(item => item.id === run.id)!, page.items.find(item => item.id === run.id)!]) {
      assert.equal(current.baseRevision, run.baseRevision);
      assert.equal(current.basisRevision, p.revision);
      assert.equal(runHasCurrentBasis(current, p), true);
    }
    await service.invoke('project.configure', { config: { ...p.config, constraints: '新增正式禁区' } });
    assert.equal(runHasCurrentBasis(service.snapshot().runs.find(item => item.id === run.id)!, service.store!.db.project()), false);
    assert.equal(service.store!.db.run(run.id).accepted, false);
  } finally { await service.drain(); }
});

test('内部恢复不跳过未知请求、作者问题、未执行工具、截断输出及真实资料变化', async () => {
  const { service, store, run } = await settingsCandidate();
  try {
    const cases = [
      { status: 'unknown' as const },
      { input: { question: '请确认主角身份' } },
      { permission: { kind: 'terminal' as const, args: {}, callId: 'pending', status: 'pending' as const } },
      { messages: [{ role: 'assistant' as const, content: '', calls: [{ id: 'pending', name: 'propose_changes', arguments: '{}' }] }] },
      { messages: [{ role: 'assistant' as const, content: '', calls: [{ id: 'failed', name: 'propose_changes', arguments: '{}' }] }, { role: 'tool' as const, callId: 'failed', content: '{"error":"候选提交失败"}' }] },
      { error: '输出达到上限，候选可能不完整，不能自动接受' },
      { savedCandidateReview: { at: new Date().toISOString(), requestUnknown: true } },
      { changes: [] }
    ];
    for (const changed of cases) {
      const candidate = { ...structuredClone(run), status: 'needs_repair' as const, ...changed };
      assert.equal(service.runner!.recoverReadyCandidate(candidate, store.db.project(), 'restore'), false);
    }
    store.db.set(`inflight:${run.id}`, true);
    assert.equal(service.runner!.recoverReadyCandidate({ ...run, status: 'needs_repair' }, store.db.project(), 'restore'), false);
    store.db.set(`inflight:${run.id}`, false);
    await service.invoke('project.configure', { config: { ...store.db.project().config, constraints: '不能改变已写事实' } });
    assert.equal(service.runner!.recoverReadyCandidate({ ...run, status: 'needs_repair' }, store.db.project(), 'restore'), false);
  } finally { await service.drain(); }
});

test('章后更新在最后一轮只交齐文件，不能推断结构化记忆提取已结束', async () => {
  let calls = 0, service: Service, runId = '';
  const created = await setup(async (_profile, system, _messages, tools) => {
    calls++;
    assert.match(system, /本阶段为 memory/);
    assert.match(system, /结构化事实优先与最后一批文件一起/);
    const tool = tools.find(item => item.name === 'propose_memory')!;
    const fact = (tool.parameters as any).properties.facts.items;
    for (const field of ['id', 'subject', 'predicate', 'value', 'kind', 'category', 'fromChapter', 'revealedAt', 'evidence'])
      assert.ok(fact.required.includes(field), field);
    const evidenceForms = fact.properties.evidence.items.anyOf;
    assert.deepEqual(evidenceForms[0].required, ['path', 'hash', 'quote']);
    assert.deepEqual(evidenceForms[1].required, ['source', 'quote']);
    assert.equal(evidenceForms[1].properties.source.const, 'prose');
    assert.ok(fact.properties.kind.enum.includes('belief'));
    assert.ok(fact.properties.category.enum.includes('promise'));
    assert.match(tool.description, /待采纳正文/);
    assert.equal(service.store!.db.run(runId).error, undefined);
    const p = service.store!.db.project();
    return reply('', stageOutputs('S11', p).map(file => service.change(file, documentFixture(p, file, service))));
  });
  service = created.service;
  try {
    const p = service.store!.db.project();
    p.stage = 'S10'; p.revision++;
    service.store!.commit([service.change(batchPath(activeBatch(p)), documentFixture(p, batchPath(activeBatch(p)), service))], p);
    const run = service.makeRun('stage', '完成章后更新');
    runId = run.id;
    const prose = service.change(prosePath(p.chapter), documentFixture(p, prosePath(p.chapter), service));
    run.pipeline!.phase = 'memory';
    run.pipeline!.proseHash = hash(prose.content);
    run.changes = [prose, service.change(qualityPath(p.chapter), documentFixture(p, qualityPath(p.chapter), service))];
    run.rounds = p.config.maxRounds - 1;
    run.status = 'paused';
    run.error = '上次请求失败，保留章后更新候选';
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const current = service.store!.db.run(run.id);
    assert.equal(calls, 1);
    assert.equal(current.status, 'paused', current.error ?? JSON.stringify(current.issues));
    assert.match(current.error ?? '', /上限/);
    assert.equal(current.pipeline!.phase, 'memory');
    service.runner!.check(current, p);
    assert.ok(current.issues.some(issue => issue.code === 'pipeline_pending'));
    assert.equal(service.runner!.recoverReadyCandidate(current, p, 'restore'), false);
    assert.equal(current.rounds, p.config.maxRounds);
    assert.equal(current.accepted, false);
    assert.equal(service.store!.db.project().stage, 'S10');
  } finally { await service.drain(); }
});
