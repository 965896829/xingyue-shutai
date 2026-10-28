import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { normalizeCandidate } from '../src/core/output-normalization';
import { authorStructureIssues } from '../src/core/skill-output-contract';
import { draftSummary } from '../src/core/runtime/document-drafts';
import { hash, paths, stageOutputs, prosePath, qualityPath, updatePath, newProject, updateConfigDocument, parseConfig } from '../src/core/domain';
import { memoryCompletionHash } from '../src/core/memory-review';
import { materializeAftermathStatus, batchSummaryProgress } from '../src/core/aftermath-status';
import { futurePlanReviewInput, parseFuturePlanReview, confirmedAlignedPlans } from '../src/core/future-plan-review';
import { proposalHash } from '../src/core/storage';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';
import { factSchema, type Run } from '../src/shared/types';
import { documentPreviewText } from '../src/shared/run-presentation';
import type { Caller } from '../src/core/runner';
import { loadNamingRules } from '../src/core/naming';

const skill = path.resolve('resources/skill');
const profile = { ...fakeProfile, contextLimit: 1000000, outputLimit: 4096, stream: false };
const proposal = (changes: unknown[], facts?: unknown[], complete?: boolean) => ({ ...fakeResult(''), native: null, stop: 'tools' as const,
  calls: [
    ...(changes.length ? [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes }) }] : []),
    ...(facts ? [{ id: crypto.randomUUID(), name: 'propose_memory', arguments: JSON.stringify({ facts, complete }) }] : [])
  ] });

test('原Skill表格表示法在本地转换，叙事单元格和主题逐字保留，重复运行幂等', () => {
  const cases = [
    { path: paths.outline, content: '| 第001章 | 推进 | 3 | 承接 | 入口 | 场面 | 动作 | 推动 | 变化 | 揭示 | 回报 | 记忆 | 牵引 |', expected: '| 001 | 推进 | 3 | 承接 | 入口 | 场面 | 动作 | 推动 | 变化 | 揭示 | 回报 | 记忆 | 牵引 |' },
    { path: '05_长篇大纲/第001-030章节奏.md', content: '| 第001—005章：赎命 | 3→2 | 收证 | 动作 | 推动 | 回报 | 余波 | 信息 | 牵引 |', expected: '| 001—005 | 3→2 | 赎命；收证 | 动作 | 推动 | 回报 | 余波 | 信息 | 牵引 |' },
    { path: paths.volumes, content: '| 一 | 谁拿着我的命 | 第001—180章 | 180 | 45万字 | 六批 | 找回命权 |', expected: '| 第一卷 | 谁拿着我的命 | 001—180 | 180章 | 45万字 | 六批 | 找回命权 |' }
  ];
  for (const item of cases) {
    const normalized = normalizeCandidate({ path: item.path, content: item.content, baseHash: 'old' });
    assert.equal(normalized.change.content, item.expected);
    assert.equal(normalizeCandidate(normalized.change).change.content, item.expected);
    const fenced = { path: item.path, content: '```text\n' + item.content + '\n```', baseHash: null };
    assert.equal(normalizeCandidate(fenced).change.content, fenced.content);
  }
});

test('结构检查只报告模板外附节，不删除独有内容、场面或机器核验', () => {
  const content = '# 配置\n- 用户硬约束：保留母女赎命。\n\n## 保护清单\n新的独有规则不可丢失。\n';
  const change = { path: paths.config, content, baseHash: null };
  assert.equal(authorStructureIssues(change)[0]?.code, 'template_extra_section');
  assert.equal(change.content, content);
  assert.deepEqual(authorStructureIssues({ ...change, path: '06_章节设计/第001章细纲.md', content: '# 细纲\n## 场面1：逃亡\n- 动作：翻过围墙。\n' }), []);
  assert.deepEqual(authorStructureIssues({ ...change, path: qualityPath(1), content: '# 评分\n```json wenxu-review\n{"quote":"## 原文引文"}\n```' }), []);
});

test('尾文仅在实际出站历史完整哈希链可重建时省略，恢复和断链保留尾文', () => {
  const a = '第一段。', b = '\n第二段。', file = paths.outline;
  const run = { messages: [], documentDrafts: [{ path: file, content: a + b, baseHash: 'base', hash: hash(a + b), chunks: 2 }] } as unknown as Run;
  const call = (content: string, draftHash: string | null) => ({ role: 'assistant' as const, content: '', calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: [{ path: file, content, baseHash: 'base', append: true, draftHash, final: false }] }) }] });
  assert.equal(draftSummary(run, true)![0].tail, a + b);
  run.messages = [call(a, null), call(b, hash(a))];
  assert.equal(draftSummary(run, true)![0].tail, undefined);
  assert.equal(draftSummary(run, true)![0].contentInHistory, true);
  run.messages[1] = call(b, hash('错误前段'));
  assert.equal(draftSummary(run, true)![0].tail, a + b);
  run.messages = [call(b, hash(a))];
  assert.equal(draftSummary(run, true)![0].tail, a + b);
});

test('正式提交只物化同步字段；候选、剧情、文学结论与未完成批次不虚构', () => {
  const p = newProject('测试', 'unused', {});
  const content = '# 第001章记忆更新\n## 本章结果\n- 核心事件：他答应等她。\n## 同步检查\n- 已同步角色卡当前字段：待提交\n- 已追加情绪与行为记忆：待提交\n- 已更新批次人物摘要：待提交\n- 已更新阶段索引：待提交\n- 已检查与前两章结构是否重复：是（暂无前章）\n';
  const changes = [{ path: updatePath(1), content, baseHash: null }, { path: paths.behavior, content: '本章行为', baseHash: null }];
  materializeAftermathStatus(changes, p);
  assert.match(changes[0].content, /已追加情绪与行为记忆：是/);
  assert.match(changes[0].content, /已同步角色卡当前字段：无变化/);
  assert.match(changes[0].content, /已更新批次人物摘要：未到批次边界/);
  assert.match(changes[0].content, /核心事件：他答应等她/);
  assert.match(changes[0].content, /已检查与前两章结构是否重复：是（暂无前章）/);
  const summary = batchSummaryProgress('# 批次人物摘要\n\n暂无完整批次。', p);
  assert.match(summary, /第001章已完成（1\/30）/);
  assert.equal(batchSummaryProgress(summary, p), summary);
});

test('批次进度将零章初始化前言限定为历史，字段和作者内容不改写，续章不重复标注', () => {
  const p = newProject('测试', 'unused', {});
  const initial = '当前批次尚未发生，正文完成0章；暂无可归纳的关键选择，保留批次末填写的结构。';
  const body = '## 第001-030章\n\n### 角色名\n\n- 批次起点：正文完成0章时，他已决定等她。\n- 关键选择：本批结束后汇总。\n';
  for (const newline of ['\n', '\r\n']) {
    const input = ('# 批次人物摘要\n\n' + initial + '\n\n' + body).replaceAll('\n', newline);
    const once = batchSummaryProgress(input, p);
    assert.match(once, /第001章已完成（1\/30）/);
    assert.ok(once.includes('正文开始前的初始化记录：' + initial));
    assert.ok(once.endsWith(body.replaceAll('\n', newline)));
    assert.equal(batchSummaryProgress(once, p), once);
    const next = batchSummaryProgress(once, { ...p, chapter: 2 });
    assert.match(next, /第002章已完成（2\/30）/);
    assert.equal(next.match(/正文开始前的初始化记录：/g)?.length, 1);
  }
  const quoted = '```text\n初始化示例：\n\n正文完成0章\n\n```';
  const author = '# 批次人物摘要\n\n作者备注：本批保留两人的分歧。\n\n' + quoted + '\n\n' + body;
  const saved = batchSummaryProgress(author, p);
  assert.ok(saved.includes('作者备注：本批保留两人的分歧。'));
  assert.ok(saved.includes(quoted));
  assert.equal(saved.includes('正文开始前的初始化记录：'), false);
});

test('执行设置更新不在原配置后追加另一套公开字段，已有作者备注保留', () => {
  const p = newProject('测试', 'unused', {});
  const input = '# 项目配置\n- 工作流版本：2.0\n- 目标总字数：3000000\n- 单章字数：2500\n- 字数允许范围：2300—2700\n- 视角：第三人称\n- 风格：快节奏\n- 用户硬约束：保留调查员设定\n\n## 作者自由备注\n保留此处实际选择。\n';
  const out = updateConfigDocument(input, p);
  assert.doesNotMatch(out, /客户端管理参数|单章目标字数|最少字数|最多字数/);
  assert.match(out, /## 作者自由备注\n保留此处实际选择/);
});

test('原模板配置直接生效，容量与字数范围保留，机器块不能遮蔽已审阅的创作字段', () => {
  const p = newProject('测试', 'unused', {});
  const content = '# 项目配置\n- 目标总字数：210万字\n- 单章字数：2500\n- 字数允许范围：2300—2700\n- 视角：第三人称限知\n- 风格：冷静动作叙事\n- 用户硬约束：事故调查员；不提前公开七年前真相\n';
  for (const text of [content, content + '\n```json wenxu-config\n' + JSON.stringify(p.config) + '\n```']) {
    const cfg = parseConfig(text, p.config);
    assert.equal(cfg.targetWords, 2100000);
    assert.equal(cfg.chapterWords, 2500);
    assert.equal(cfg.minWords, 2300);
    assert.equal(cfg.maxWords, 2700);
    assert.equal(cfg.pov, '第三人称限知');
    assert.equal(cfg.style, '冷静动作叙事');
    assert.equal(cfg.constraints, '事故调查员；不提前公开七年前真相');
    assert.equal(cfg.maxRounds, p.config.maxRounds);
  }
});

test('作者文稿预览只隐藏已标记机器记录，原模板、普通JSON与编辑原文均保留', () => {
  const text = '# 时间线\n\n| 时间 | 事件 |\n| --- | --- |\n| 00:01 | 返还伤口 |\n';
  const source = text + '\n## 可追溯事实记录\n\n<!-- wenxu-facts:v1 -->\n```json\n[{"id":"fact-1","quote":"返还伤口"}]\n```\n';
  assert.equal(documentPreviewText(source), text.trim());
  assert.match(source, /fact-1/);
  const ordinary = '# 作者规则\n```json\n{"阵营":"甲"}\n```';
  assert.equal(documentPreviewText(ordinary), ordinary);
  assert.equal(documentPreviewText(source.replaceAll('\n', '\r\n')), text.trim().replaceAll('\n', '\r\n'));
});

async function setup(caller: Caller) {
  const service = new Service(skill, () => {}, caller); service.profiles = [profile];
  await service.invoke('project.create', { parent: isolatedRoot('clean-parity'), title: '原模板流程', premise: '维修员查明停电原因', config: { defaultProfileId: profile.id, maxRounds: 12, maxTools: 64, preview: { enabled: false } } });
  let p = service.store!.db.project();
  for (const stage of ['S01','S02','S03','S04','S05','S06','S07','S08','S09'] as const) {
    service.store!.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    p = service.store!.db.project();
  }
  p.stage = 'S10'; service.store!.db.set('project', p);
  const run = service.makeRun('stage', '按原Skill完成本章和章后更新'); service.store!.db.saveRun(run);
  return { service, run, p };
}

test('文件与事实合批仍先完整验证；错误证据不得留下半批候选或覆盖旧事实', async () => {
  const { service, run, p } = await setup(async () => { throw new Error('不应调用模型'); });
  try {
    const content = fixture(p, prosePath(1), service);
    run.pipeline = { phase: 'memory', proseHash: hash(content), epoch: 'atomic-fixture', version: 1, previewCalls: 0 };
    run.changes = [service.change(prosePath(1), content)];
    run.sourceProseHash = hash(content);
    const before = structuredClone(run.changes);
    const changes = [service.change(updatePath(1), fixture(p, updatePath(1), service))];
    const fact = { id: 'atomic-fact', subject: '阿宁', predicate: '递出记录本', value: '向医生递出记录本', kind: 'event', category: 'item', fromChapter: 1, revealedAt: 1, evidence: [{ source: 'prose', quote: '原文没有这句话。' }] };
    await (service.runner as any).execute(run, p, { id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes, facts: [fact], complete: true }) }, new AbortController().signal, loadNamingRules(skill));
    assert.deepEqual(run.changes, before);
    assert.deepEqual(run.facts, []);
    assert.equal(run.memoryCompletionHash, undefined);
    assert.ok(JSON.parse(run.messages.at(-1)!.content).error);
  } finally { await service.drain(); }
});

for (const withFacts of [true, false]) for (const combined of [true, false]) test(`明确完成提取${withFacts ? '含事实' : '零事实'}${combined ? '同批文件事实' : '独立工具'}后直接独立核验，不增加validate和结束说明请求`, async () => {
  let service: Service, proseCalls = 0, reviews = 0, extractions = 0, audits = 0, planAudits = 0;
  const created = await setup(async (_profile, system, messages, tools) => {
    const p = service.store!.db.project();
    if (system.includes('你独立核对本章实际正文')) {
      planAudits++;
      const input = JSON.parse(messages[0].content);
      return fakeResult(JSON.stringify({ decisions: input.plans.map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '夹具中求医计划与实际动作相容。', planQuote: plan.content.slice(0, 30), proseQuote: input.prose.content.slice(0, 30) })) }));
    }
    if (system.includes('你独立检查')) {
      audits++;
      const input = JSON.parse(messages[0].content);
      return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '原文明确写出相同动作与主体。', evidence: item.fact.evidence.map((e: any) => ({ path: e.path, quote: e.quote })) })) }));
    }
    if (!tools.length) { proseCalls++; return fakeResult(fixture(p, prosePath(1), service)); }
    if (system.includes('本阶段为 review')) { reviews++; assert.equal(reviews, 1); return proposal([service.change(qualityPath(1), fixture(p, qualityPath(1), service))]); }
    extractions++; assert.equal(extractions, 1, '不得为宣布完成或整理引号重复请求提取器');
    const packet = JSON.parse(messages[0].content);
    const memories = packet.sources.filter((source: any) => source.path.startsWith('04_'));
    assert.equal(memories.length, 9); assert.equal(new Set(memories.map((source: any) => source.path)).size, 9);
    assert.ok(memories.every((source: any) => source.mode === 'full' && source.hash === service.store!.db.document(source.path)?.hash));
    const r = service.store!.db.runs().find(item => item.status === 'running')!;
    const prose = r.changes.find(item => item.path === prosePath(1))!;
    const facts = withFacts ? [factSchema.parse({ id: 'action-1', subject: '阿宁', predicate: '递出记录本', value: '向医生递出记录本', kind: 'event', category: 'item', fromChapter: 1, revealedAt: 1, evidence: [{ path: prose.path, hash: hash(prose.content), quote: '阿宁推开诊室的门，把记录本递到灯下。' }] })] : [];
    const changes = stageOutputs('S11', p).map(file => service.change(file, fixture(p, file, service)));
    return combined ? { ...fakeResult(''), native: null, stop: 'tools' as const, calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes, facts, complete: true }) }] } : proposal(changes, facts, true);
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(done.rounds, withFacts ? 5 : 3); assert.equal(proseCalls, 1); assert.equal(reviews, 1); assert.equal(extractions, 1); assert.equal(audits, withFacts ? 1 : 0); assert.equal(planAudits, withFacts ? 1 : 0);
    assert.equal(done.pipeline!.phase, 'ready'); assert.equal(done.accepted, false);
    assert.equal(done.memoryCompletionHash, memoryCompletionHash(done));
    const changed = structuredClone(done); changed.changes[0].content += '新增一句。';
    assert.notEqual(changed.memoryCompletionHash, memoryCompletionHash(changed));
    changed.changes = done.changes; changed.facts = [];
    if (withFacts) assert.notEqual(changed.memoryCompletionHash, memoryCompletionHash(changed));
    if (withFacts) {
      const input = futurePlanReviewInput(service.store!, done);
      assert.equal(confirmedAlignedPlans(service.store!, done).size, input.plans.length);
      const stale = structuredClone(done); stale.changes[0].content += '正文改变。';
      assert.equal(confirmedAlignedPlans(service.store!, stale).size, 0);
      const decisions = done.futurePlanReview!.decisions;
      assert.throws(() => parseFuturePlanReview(JSON.stringify({ decisions: decisions.slice(1) }), input), /逐份覆盖/);
      assert.throws(() => parseFuturePlanReview(JSON.stringify({ decisions: decisions.map((item, i) => i ? item : { ...item, proseQuote: '未曾出现的无效引文句子' }) }), input), /准确/);
      await service.invoke('run.accept', { id: done.id, proposalHash: proposalHash(done), startNext: false, warningReason: '合成场景仅验证流程，保留测试预期警告。' });
      const p = service.store!.db.project();
      assert.equal(p.chapters[1], 'complete');
      assert.equal(p.stale.length, 0, '独立确认一致的计划不应每章全部失效');
      const committed = service.store!.readAccepted(updatePath(1)).content;
      assert.match(committed, /已更新阶段索引：是/);
      assert.match(committed, /已更新批次人物摘要：未到批次边界/);
      assert.equal(service.store!.db.facts().filter(fact => fact.reviewStatus === 'accepted').length, 1);
    }
  } finally { await service.drain(); }
});

test('独立证据审核拒绝后实际调用提取器修复，不在旧完成回执上空转或跳过再审核', async () => {
  let service: Service, extractions = 0, audits = 0;
  const created = await setup(async (_profile, system, messages, tools) => {
    const p = service.store!.db.project(), input = JSON.parse(messages[0].content);
    if (system.includes('你独立核对本章实际正文')) return fakeResult(JSON.stringify({ decisions: input.plans.map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '后续求医计划与本章事件相容。', planQuote: plan.content.slice(0, 30), proseQuote: input.prose.content.slice(0, 30) })) }));
    if (system.includes('你独立检查')) {
      audits++;
      return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => ({ id: item.id, verdict: audits === 1 ? 'contradicted' : 'supported', reason: audits === 1 ? '原文只是递出，尚未把记录本交给医生。' : '修订后的事实准确保留递出动作。', evidence: item.fact.evidence.map((e: any) => ({ path: e.path, quote: e.quote })) })) }));
    }
    if (!tools.length) return fakeResult(fixture(p, prosePath(1), service));
    if (system.includes('本阶段为 review')) return proposal([service.change(qualityPath(1), fixture(p, qualityPath(1), service))]);
    extractions++;
    if (extractions === 2) assert.match(messages.at(-1)!.content, /memory_review|尚未把记录本/);
    assert.ok(extractions <= 2);
    const r = service.store!.db.runs().find(item => item.status === 'running')!;
    const prose = r.changes.find(change => change.path === prosePath(1))!;
    const fact = factSchema.parse({ id: 'record-action', subject: '阿宁', predicate: '记录本动作', value: extractions === 1 ? '已经交给医生' : '向医生递出记录本', kind: 'event', category: 'item', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: prose.path, hash: hash(prose.content), quote: '阿宁推开诊室的门，把记录本递到灯下。' }] });
    return proposal(extractions === 1 ? stageOutputs('S11', p).map(file => service.change(file, fixture(p, file, service))) : [], [fact], true);
  });
  service = created.service;
  try {
    await service.runner!.drive(created.run.id);
    const done = service.store!.db.run(created.run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? JSON.stringify(done.issues));
    assert.equal(extractions, 2); assert.equal(audits, 2);
    assert.equal(done.facts[0].value, '向医生递出记录本');
    assert.equal(done.memoryReview!.issues.length, 0);
    assert.equal(done.repairAttempts!.memory, 1);
    assert.equal(done.accepted, false);
  } finally { await service.drain(); }
});
