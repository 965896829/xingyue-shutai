import test from 'node:test';
import { databaseVersion } from '../src/core/compatibility';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { Service } from '../src/core/service';
import { Database, atomicWrite } from '../src/core/storage';
import { AssistantSettings } from '../src/core/assistant-settings';
import { checkFields, validateCandidate, parseMarkdownFields } from '../src/core/validation';
import { templates } from '../src/core/skill';
import { paths } from '../src/core/domain';
import { profileSchema, type ModelResult, type SecretProfile } from '../src/shared/types';
import { searchSettingsSchema, type ActionProposal } from '../src/shared/assistant';
import { PublicSearch } from '../src/core/search';
import { RequestError, normalize, requestBody } from '../src/core/provider';
import { nativeResponse, nativeCall, nativeAnnotation, nativeText, nativeSource } from './fixtures/native-search';
import { searchMemory, rebuildMemory } from '../src/core/memory';
import type { Caller } from '../src/core/runner';
const skill = path.resolve('resources/skill');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-assistant-'));
const profile: SecretProfile = {
  ...profileSchema.parse({
    id: 'test',
    name: '模拟端点',
    protocol: 'chat',
    baseUrl: 'http://127.0.0.1:9999/v1',
    model: 'fixture',
    contextLimit: 128000,
    outputLimit: 4096
  }),
  apiKey: 'test-secret'
};
const response = (text: string, tools: { name: string; args: unknown }[] = []): ModelResult => ({
  text,
  calls: tools.map((c, i) => ({ id: `tool-${i}`, name: c.name, arguments: JSON.stringify(c.args) })),
  native: null,
  usage: { input: 100, output: 20, cost: 0.01, currency: 'USD' },
  stop: tools.length ? 'tools' : 'complete'
});
async function setup(
  caller: Caller = async () => response('先讨论人物困境和穿越前后的差异。具体机制尚未确定。')
) {
  const parent = temp(),
    service = new Service(skill, () => {}, caller);
  service.profiles = [structuredClone(profile)];
  await service.invoke('project.create', {
    parent,
    title: '测试',
    premise: '我要写一篇时间穿越的东方玄幻',
    config: { defaultProfileId: 'test' }
  });
  return { service, parent, chatId: service.snapshot().conversations![0].id };
}
async function done(service: Service) {
  const end = Date.now() + 5000;
  while (service.chat?.controller || service.runner?.controller) {
    if (Date.now() > end) throw new Error('未在预期内结束');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const proposalInput = {
  kind: 'draft',
  goal: '试写开场',
  scope: '一段渡河场景，不确定穿越机制',
  request: '试写渡河场景',
  outputs: ['聊天草稿']
};
test('Responses 聊天无第三方 Key 直接搜索，来源持久化、续轮保留原生块且不超搜索上限', async () => {
  let calls = 0;
  const { service, chatId } = await setup(async (p, system, messages, tools, _signal, _delta, options) => {
    calls++;
    assert.match(system, /原生 web_search/);
    assert.equal(tools.some(tool => ['public_search', 'extract_pages'].includes(tool.name)), false);
    if (calls === 1) {
      assert.equal(options?.webSearch?.maxCalls, 1);
      options?.onWebSearch?.({ id: nativeCall.id, status: 'searching', sources: [] });
      const result = normalize(p, { ...nativeResponse, output: [...nativeResponse.output,
        { type: 'function_call', call_id: 'read-after-search', name: 'read_rule', arguments: JSON.stringify({ name: 'workflow', lines: 3 }) }] });
      return result;
    }
    assert.equal(options?.webSearch, undefined);
    assert.ok(requestBody(p, system, messages, tools).body.input.some((item: any) => item.type === 'web_search_call'));
    return response('已结合本书资料核对。');
  });
  try {
    service.profiles[0].protocol = 'responses';
    service.assistant.search = searchSettingsSchema.parse({ maxSearches: 1 });
    assert.equal(service.assistant.searchKey, '');
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '联网核对官方说明' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(data.turns[0].status, 'complete');
    assert.equal(calls, 2);
    assert.equal(data.turns[0].webSearch!.calls.length, 1);
    assert.equal(data.messages.at(-1)!.webSearch!.citations.length, 1);
    assert.ok(data.messages.at(-1)!.citations.some(citation => citation.url === nativeSource.url));
    assert.equal(data.turns[0].usage.cost, null);
    const root = service.store!.root;
    service.close(); await service.open(root);
    const restored = await service.invoke('chat.read', { id: chatId });
    assert.equal(restored.messages.at(-1)!.webSearch!.calls[0].id, nativeCall.id);
  } finally { service.close(); }
});
test('原生搜索遵守全局及聊天开关，第三方模式不注入原生工具', async () => {
  for (const mode of ['chat-off', 'global-off', 'tavily'] as const) {
    const { service, chatId } = await setup(async (_p, _s, _m, tools, _signal, _delta, options) => {
      assert.equal(options?.webSearch, undefined);
      assert.equal(tools.some(tool => tool.name === 'public_search'), mode === 'tavily');
      return response('本轮未联网。');
    });
    try {
      service.profiles[0].protocol = 'responses';
      service.assistant.search = searchSettingsSchema.parse({ provider: mode === 'tavily' ? 'tavily' : 'auto', enabled: mode !== 'global-off' });
      if (mode === 'chat-off') await service.invoke('chat.update', { id: chatId, online: false });
      await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '解释当前规则' });
      await done(service);
      assert.equal((await service.invoke('chat.read', { id: chatId })).turns[0].status, 'complete');
    } finally { service.close(); }
  }
});
test('原生搜索后断流保留进度及引用，重开不自动重搜且重试需要明确选择', async () => {
  let calls = 0;
  const { service, chatId } = await setup(async (_p, _s, _m, _t, _signal, delta, options) => {
    calls++;
    options?.onWebSearch?.({ id: nativeCall.id, status: 'completed', sources: [nativeSource] });
    options?.onWebCitation?.({ url: nativeAnnotation.url, title: nativeAnnotation.title });
    delta?.(nativeText);
    throw new RequestError('模拟原生搜索后断流', true);
  });
  try {
    service.profiles[0].protocol = 'responses';
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '查官方文档' }); await done(service);
    const root = service.store!.root;
    service.close(); await service.open(root);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(data.turns[0].status, 'unknown');
    assert.equal(data.messages.at(-1)!.content, nativeText);
    assert.equal(data.messages.at(-1)!.webSearch!.calls.length, 1);
    assert.equal(data.messages.at(-1)!.webSearch!.citations.length, 1);
    await assert.rejects(service.invoke('chat.retry', { id: data.turns[0].id }), /明确确认/);
    assert.equal(calls, 1);
  } finally { service.close(); }
});
test('原生搜索连接测试必须返回真实搜索项和来源；普通阶段不获得搜索权限', async () => {
  let nativeOptions = false;
  const { service } = await setup(async (p, _s, _m, _t, _signal, _delta, options) => {
    nativeOptions = !!options?.webSearch?.required;
    return normalize(p, nativeResponse);
  });
  try {
    service.profiles[0].protocol = 'responses';
    const result = await service.invoke('search.test', { profileId: 'test' });
    assert.equal(nativeOptions, true);
    assert.equal(result.results[0].url, nativeSource.url);
    const run = service.makeRun('stage', '完成设定拆解', 'test');
    assert.equal(service.runner!.toolsFor(run).some(tool => tool.name === 'public_search'), false);
    service.profiles[0].protocol = 'chat';
    service.assistant.search = searchSettingsSchema.parse({ provider: 'openai' });
    await assert.rejects(service.invoke('search.test', { profileId: 'test' }), /Responses/);
  } finally { service.close(); }
});
test('市场研究走原生搜索，保持作者审阅与正式文件边界', async () => {
  const { service } = await setup(async (p, _s, messages, tools, _signal, _delta, options) => {
    assert.equal(tools.some(tool => tool.name === 'public_search'), false);
    if (messages.at(-1)?.role === 'tool') return response('已保存研究候选，等待作者核对。');
    assert.equal(options?.webSearch?.maxCalls, 3);
    const result = normalize(p, nativeResponse);
    const call = { id: 'research-files', name: 'propose_changes', arguments: JSON.stringify({ changes:
      ['11_创作研究/市场证据.md', '11_创作研究/题材机会假设.md'].map(file => ({ path: file,
        baseHash: service.store!.db.document(file)?.hash ?? null,
        content: `# 公开研究\n\n观察期：2026-10-16。来源：[官方文档](${nativeSource.url})。\n\n样本范围：一次官方说明查询，不代表市场全貌。\n\n假设：标签有助于定位；尚无数据验证流量因果。\n` })) }) };
    return { ...result, calls: [call], native: [...(result.native as unknown[]), { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }], stop: 'tools' };
  });
  try {
    service.profiles[0].protocol = 'responses';
    const revision = service.store!.db.project().revision;
    const runId = await service.invoke('skill.run', { skillId: 'webnovel-market-research', profileId: 'test', request: '核对公开标签说明' });
    await done(service);
    const run = service.store!.db.run(runId as string);
    assert.equal(run.webSearch!.calls[0].id, nativeCall.id);
    assert.equal(run.toolCount, 2);
    assert.equal(run.status, 'awaiting_review');
    assert.equal(run.accepted, false);
    assert.equal(service.store!.db.project().revision, revision);
  } finally { service.close(); }
});

test('字段解析支持续行、嵌套和粗体；下一字段、标题、代码不补空值', () => {
  const good =
    '- 爽点升级路线：\n  1. 前期：救人\n  2. 中期：发现代价\n- **风险与修正**：\n  - 风险：重复，修正：改变选择\n';
  assert.deepEqual(checkFields(good, ['爽点升级路线', '风险与修正'], 'x'), []);
  assert.equal(
    checkFields('- 爽点升级路线：\n- 风险与修正：有内容\n', ['爽点升级路线'], 'x')[0].code,
    'empty_field'
  );
  assert.equal(checkFields('- 爽点升级路线：\n## 其他\n有内容', ['爽点升级路线'], 'x').length, 1);
  assert.equal(checkFields('- 爽点升级路线：\n  - 待填写\n  - TODO', ['爽点升级路线'], 'x').length, 1);
  assert.equal(parseMarkdownFields('```md\n- 假字段：存在\n```').length, 0);
  assert.equal(checkFields('- 是否需要重写：是/否', ['是否需要重写'], 'x').length, 1);
});

test('同一模板空字段仅报告一次；多行字段通过本地重查且 unknown 保留', async () => {
  let calls = 0;
  const { service } = await setup(async () => {
    calls++;
    return response('unused');
  });
  try {
    const p = service.store!.db.project();
    let seed = templates(skill)
      ['设定拆解'].replace(/：[ \t]*$/gm, '：具体内容')
      .replace(/^- 爽点升级路线：.*$/m, '- 爽点升级路线：\n  1. 前期夺回行动权\n  2. 中期付出代价')
      .replace(/^- 风险与修正：.*$/m, '- 风险与修正：\n  - 重复风险：通过关系变化修正');
    assert.equal(
      validateCandidate('S01', p, [{ path: paths.seed, content: seed, baseHash: null }], skill).filter((i) =>
        /爽点升级路线|风险与修正/.test(i.message)
      ).length,
      0
    );
    seed = seed.replace(/- 爽点升级路线：[\s\S]*?(?=\n- )/, '- 爽点升级路线：');
    assert.equal(
      validateCandidate('S01', p, [{ path: paths.seed, content: seed, baseHash: null }], skill).filter((i) =>
        /爽点升级路线/.test(i.message)
      ).length,
      1
    );
    const run = service.makeRun('stage', '旧任务');
    run.status = 'unknown';
    run.changes = [{ path: paths.seed, content: seed, baseHash: null }];
    service.store!.db.saveRun(run);
    const checked = await service.invoke('run.revalidate', { id: run.id });
    assert.equal(checked.status, 'unknown');
    assert.equal(calls, 0);
    assert.equal(checked.accepted, false);
  } finally {
    service.close();
  }
});

test('SQLite v1 事务升级前有完整备份；旧记录保留且不会伪造聊天', () => {
  const file = path.join(temp(), 'state.sqlite');
  const before = new Database(file);
  before.set('marker', { old: true });
  before.sql.exec('PRAGMA user_version=1');
  before.close();
  const after = new Database(file);
  assert.equal(after.sql.prepare('PRAGMA user_version').get()!.user_version, databaseVersion);
  assert.deepEqual(after.get('marker'), { old: true });
  assert.equal(after.sql.prepare('SELECT count(*) AS n FROM conversations').get()!.n, 0);
  after.close();
  const backup = fs.readdirSync(path.dirname(file)).find((f) => f.includes(`before-v${databaseVersion}`))!;
  assert.ok(backup);
  const saved = new DatabaseSync(path.join(path.dirname(file), backup), { readOnly: true });
  assert.equal(saved.prepare('PRAGMA user_version').get()!.user_version, 1);
  saved.close();
});

test('一句想法只进入对话；不加载整套模板、无正式候选、无额外分类请求', async () => {
  let count = 0,
    system = '';
  const { service, chatId } = await setup(async (_p, s) => {
    count++;
    system = s;
    return response('你倾向身体穿越还是意识穿越？这些是备选，还未确认。');
  });
  try {
    const revision = service.store!.db.project().revision;
    await service.invoke('chat.send', {
      conversationId: chatId,
      profileId: 'test',
      text: '我要写一篇时间穿越的东方玄幻'
    });
    await done(service);
    assert.equal(count, 1);
    assert.equal(service.snapshot().runs.length, 0);
    assert.equal(service.snapshot().facts.length, 0);
    assert.equal(service.store!.db.project().revision, revision);
    assert.doesNotMatch(system, /# 第XXX章任务清单|## 第XXX章细纲/);
    assert.ok(Buffer.byteLength(system) < 30000);
    assert.equal((await service.invoke('chat.read', { id: chatId })).messages.length, 2);
    await assert.rejects(
      service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '  ' })
    );
  } finally {
    service.close();
  }
});

test('查询流程可以读取相关规则，但不启动阶段', async () => {
  let call = 0;
  const { service, chatId } = await setup(async () =>
    ++call === 1
      ? response('', [{ name: 'read_rule', args: { name: 'workflow', section: '设定' } }])
      : response('当前可先明确主角困境，确定后再开始设定拆解。')
  );
  try {
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '接下来做什么' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(service.snapshot().runs.length, 0);
    assert.equal(data.proposals.length, 0);
    assert.equal(data.turns[0].calls[0].name, 'read_rule');
  } finally {
    service.close();
  }
});

test('Pi 对话提交完整任务卡后本地结束，不额外请求模型解释同一张卡', async () => {
  let calls = 0;
  const { service, chatId } = await setup(async () => {
    calls++;
    return response('', [{ name: 'propose_action', args: proposalInput }]);
  });
  try {
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '先给我渡河场景的试写任务' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(calls, 1); assert.equal(data.proposals.length, 1);
    assert.equal(data.turns[0].executorId, 'pi'); assert.equal(data.turns[0].status, 'complete');
    assert.match(data.messages.at(-1)!.content, /试写开场/);
    assert.equal(service.snapshot().runs.length, 0);
  } finally { service.close(); }
});

test('任务卡必须确认且重复确认只执行一次；保存草稿不使未执行卡失效', async () => {
  let calls = 0;
  const { service, chatId } = await setup(async () => {
    calls++;
    return response('河水漫过了他的小腿。');
  });
  try {
    const card: ActionProposal = await service.invoke('proposal.create', {
      conversationId: chatId,
      profileId: 'test',
      proposal: proposalInput
    });
    assert.equal(calls, 0);
    const result = await service.invoke('proposal.confirm', { id: card.id, version: card.version });
    const repeat = await service.invoke('proposal.confirm', { id: card.id, version: card.version });
    assert.equal(result.id, repeat.id);
    await done(service);
    assert.equal(calls, 1);
    assert.equal(service.snapshot().runs.length, 0);
    const data = await service.invoke('chat.read', { id: chatId }),
      message = data.messages.at(-1);
    const next: ActionProposal = await service.invoke('proposal.create', {
      conversationId: chatId,
      profileId: 'test',
      proposal: proposalInput
    });
    const revision = service.store!.db.project().revision;
    const draft = await service.invoke('draft.save', {
      title: '渡河',
      content: '独特草稿关键词木舟',
      conversationId: chatId,
      messageId: message!.id
    });
    assert.equal(service.store!.db.project().revision, revision);
    assert.ok(!service.snapshot().documents.some((d) => d.path === draft.path));
    rebuildMemory(service.store!);
    assert.ok(
      searchMemory(service.store!, '独特草稿关键词木舟', 1).documents.every((d) => d.path !== draft.path)
    );
    assert.equal(
      service
        .store!.db.sql.prepare('SELECT count(*) AS n FROM documents_fts WHERE instr(content,?)>0')
        .get('独特草稿关键词木舟')!.n,
      0
    );
    service.chat!.verify(next, next.version);
  } finally {
    service.close();
  }
});

test('正式阶段任务卡沿用执行器、候选校验和待审阅限制', async () => {
  const { service, chatId } = await setup(async () => response('阶段执行完成，但没有提交产物'));
  try {
    const card = await service.invoke('proposal.create', {
      conversationId: chatId,
      profileId: 'test',
      proposal: { ...proposalInput, kind: 'stage' }
    });
    assert.deepEqual(card.outputs, [paths.seed]);
    const execution = await service.invoke('proposal.confirm', { id: card.id, version: card.version });
    await done(service);
    assert.equal(service.store!.db.run(execution.id).mode, 'stage');
    assert.equal(service.store!.db.run(execution.id).status, 'needs_repair');
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '讨论怎么修改' });
    await done(service);
    const second = await service.invoke('proposal.create', {
      conversationId: chatId,
      profileId: 'test',
      proposal: { ...proposalInput, kind: 'stage' }
    });
    await assert.rejects(
      service.invoke('proposal.confirm', { id: second.id, version: second.version }),
      /已有阶段任务/
    );
  } finally {
    service.close();
  }
});

test('作品版本、外部资料、模型版本和规则变化使任务卡失效', async () => {
  const { service, chatId } = await setup();
  try {
    for (const change of ['project', 'external', 'model', 'role']) {
      const card = await service.invoke('proposal.create', {
        conversationId: chatId,
        profileId: 'test',
        proposal: proposalInput
      });
      if (change === 'project') {
        const p = service.store!.db.project();
        p.revision++;
        service.store!.db.set('project', p);
      }
      if (change === 'external')
        fs.appendFileSync(path.join(service.store!.root, paths.seed), '\n作者外部改动');
      if (change === 'model') service.profiles[0].version++;
      if (change === 'role') service.assistant.roles[0].current.id = 'changed';
      await assert.rejects(
        service.invoke('proposal.confirm', { id: card.id, version: card.version }),
        /已变化/
      );
      assert.equal(service.chat!.records.get('action_proposals', card.id).status, 'stale');
    }
    assert.equal(service.snapshot().runs.length, 0);
  } finally {
    service.close();
  }
});

test('多聊天持久化、改名归档恢复，未经选择不能跨聊天检索', async () => {
  let target = '';
  const { service, chatId } = await setup(async () =>
    response('', [{ name: 'search_history', args: { query: '暗号', conversationId: target } }])
  );
  try {
    const other = await service.invoke('chat.create', { title: '另一条剧情线' });
    target = other.id;
    const turn = service.chat!.prepare(other.id, '暗号是晚钟，仅备选', 'test');
    turn.status = 'complete';
    service.chat!.records.save('conversation_turns', turn);
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '看看剧情' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.match(data.turns[0].calls[0].result, /作者未选择/);
    assert.doesNotMatch(JSON.stringify(data), /暗号是晚钟/);
    await service.invoke('chat.update', { id: other.id, title: '备选线', archived: true });
    const root = service.store!.root;
    service.close();
    await service.open(root);
    assert.equal(service.snapshot().conversations!.find((c) => c.id === other.id)!.title, '备选线');
    await assert.rejects(
      service.invoke('chat.send', { conversationId: other.id, profileId: 'test', text: '新消息' }),
      /恢复/
    );
    await service.invoke('chat.update', { id: other.id, archived: false });
    assert.equal(service.snapshot().conversations!.find((c) => c.id === other.id)!.archived, false);
  } finally {
    service.close();
  }
});

test('同书并发被阻止；停止后保留消息和状态，未知请求不自动重发', async () => {
  let calls = 0;
  const { service, chatId } = await setup(async (_p, _s, _m, _t, signal, delta) => {
    calls++;
    delta?.('已接收片段');
    await new Promise<void>((_, reject) =>
      signal.addEventListener('abort', () => reject(new RequestError('结果未知', true)), { once: true })
    );
    return response('never');
  });
  try {
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '讨论' });
    await assert.rejects(
      service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '第二条' }),
      /同时只能/
    );
    await assert.rejects(service.invoke('run.start', { request: '生成', profileId: 'test' }), /已有运行/);
    await service.invoke('chat.stop');
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(data.messages.at(-1)!.content, '已接收片段');
    assert.equal(data.messages.at(-1)!.status, 'stopped');
    assert.deepEqual(data.turns[0].usage, { input: null, output: null, cost: null, currency: 'USD' });
    assert.equal(calls, 1);
    await assert.rejects(service.invoke('chat.retry', { id: data.turns[0].id }), /明确确认/);
  } finally {
    service.close();
  }
});

test('聊天断流后的用量为未知，不能把零值或已完成轮次当作总费用', async () => {
  for (const completedRound of [false, true]) {
    let calls = 0;
    const { service, chatId } = await setup(async (_p, _s, _m, _t, _signal, delta) => {
      calls++;
      if (completedRound && calls === 1)
        return response('', [{ name: 'read_book', args: { path: paths.style, reason: '核对文风' } }]);
      delta?.('已收到的讨论片段');
      throw new RequestError('模型连接中断，已保留收到的内容。', true);
    });
    try {
      const id = await service.invoke('chat.send', {
        conversationId: chatId,
        profileId: 'test',
        text: '讨论'
      });
      await done(service);
      const data = await service.invoke('chat.read', { id: chatId });
      const turn = data.turns.find((item: { id: string }) => item.id === id);
      assert.ok(turn);
      assert.equal(turn.status, 'unknown');
      assert.deepEqual(turn.usage, { input: null, output: null, cost: null, currency: 'USD' });
      assert.match(data.messages.at(-1)!.content, /已收到的讨论片段/);
      assert.equal(calls, completedRound ? 2 : 1);
      await assert.rejects(service.invoke('chat.retry', { id }), /明确确认/);
    } finally {
      service.close();
    }
  }
});

test('权限工具越界被拒绝，不能由聊天批准或写正式文件', async () => {
  let call = 0;
  const { service, chatId } = await setup(async () =>
    ++call === 1
      ? response('', [
          { name: 'propose_changes', args: { changes: [{ path: paths.seed, content: '覆盖' }] } }
        ])
      : response('只能提出任务卡')
  );
  try {
    const prior = service.store!.read(paths.seed).hash;
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '修改' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.match(data.turns[0].calls[0].result, /不在对话权限/);
    assert.equal(service.store!.read(paths.seed).hash, prior);
  } finally {
    service.close();
  }
});

test('草稿历史与外部冲突保护；转正式任务卡绑定草稿版本', async () => {
  const { service, chatId } = await setup();
  try {
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '一段例子' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId }),
      source = data.messages.at(-1);
    const draft = await service.invoke('draft.save', {
      title: '片段',
      content: '草稿初版，未采纳',
      conversationId: chatId,
      messageId: source!.id
    });
    const card = await service.invoke('draft.promote', {
      id: draft.id,
      hash: draft.hash,
      profileId: 'test',
      scope: '只修改设定拆解中的主角困境'
    });
    atomicWrite(path.join(service.store!.root, draft.path), '外部编辑的草稿');
    await assert.rejects(
      service.invoke('draft.save', { ...draft, content: '尝试覆盖', baseHash: draft.hash }),
      /外部修改/
    );
    await assert.rejects(
      service.invoke('proposal.confirm', { id: card.id, version: card.version }),
      /已变化/
    );
    const current = await service.invoke('draft.read', { id: draft.id });
    const updated = await service.invoke('draft.save', {
      ...draft,
      content: '作者合并后的新版本',
      baseHash: current.currentHash
    });
    assert.equal(updated.versions.length, 3);
    assert.equal(
      (await service.invoke('draft.read', { id: draft.id, hash: draft.hash })).content,
      '草稿初版，未采纳'
    );
  } finally {
    service.close();
  }
});

test('统一编辑偏好覆盖、回退与再次启动保留用户版本，不影响内置默认', () => {
  const dir = temp(),
    settings = new AssistantSettings(dir),
    original = settings.roles()[0];
  settings.saveRole('coeditor', '按我的特定审稿口径。');
  const custom = settings.roles()[0].current.id;
  settings.reset('coeditor');
  assert.equal(settings.roles()[0].current.text, original.defaultText);
  settings.rollback('coeditor', custom);
  const reopened = new AssistantSettings(dir);
  assert.equal(reopened.roles()[0].current.text, '按我的特定审稿口径。');
  assert.equal(reopened.roles()[0].defaultText, original.defaultText);
});

test('对话实际读取文风与流程规则时不重新注入旧禁词、强制能力代价或固定角色阵容', async () => {
  let calls = 0;
  const { service, chatId } = await setup(async (_profile, system, messages) => {
    calls++;
    assert.match(system, /作者当前明确要求 → 已确认作品声音/);
    if (calls === 1) return response('', [
      { name: 'read_rule', args: { name: 'style', lines: 400 } },
      { name: 'read_rule', args: { name: 'workflow', lines: 400 } }
    ]);
    const inputs = messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
    const style = inputs.find(input => input.name === 'style')?.content;
    const workflow = inputs.find(input => input.name === 'workflow')?.content;
    assert.match(style, /不强制改写否定对照句/);
    assert.match(style, /样例只指导表达、不提供故事事实/);
    assert.doesNotMatch(style, /叙述中默认不用|发现一个触发词时|在关键碰撞处使用短句/);
    assert.match(workflow, /无体系、多体系与自定义/);
    assert.doesNotMatch(workflow, /先建立主角、女主|每条规则都要能变成剧情冲突/);
    return response('按作者确认的叙述距离与当前场景选择表达。');
  });
  try {
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '检查当前文风与流程规则' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(data.turns[0].status, 'complete');
    assert.equal(calls, 2);
  } finally { await service.drain(); }
});

test('长聊天摘要可回查，助手建议不变成作者决定，保留原消息', async () => {
  let system = '';
  const { service, chatId } = await setup(async (_p, text) => {
    system = text;
    return response('继续讨论');
  });
  try {
    for (let i = 0; i < 30; i++)
      service.chat!.records.save('conversation_messages', {
        id: `old-${i}`,
        conversationId: chatId,
        turnId: `old-${i}`,
        role: i % 2 ? 'assistant' : 'user',
        content: i % 2 ? '建议主角死亡回档' : '再考虑一下',
        createdAt: new Date().toISOString(),
        status: 'complete',
        citations: []
      });
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '先保留这些备选' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(data.messages.length, 32);
    assert.ok(data.conversation.summary);
    assert.match(data.conversation.summary.text, /备选意见（未采纳）/);
    assert.ok(data.conversation.summary.messageIds.includes('old-1'));
    assert.match(system, /old-1/);
    assert.equal(service.snapshot().facts.length, 0);
  } finally {
    service.close();
  }
});

test('请求上下文超限时暂停，不静默删除硬约定继续调用模型', async () => {
  let calls = 0;
  const { service, chatId } = await setup(async () => {
    calls++;
    return response('unused');
  });
  try {
    service.profiles[0].contextLimit = 1500;
    service.profiles[0].outputLimit = 500;
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '讨论' });
    await done(service);
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(calls, 0);
    assert.ok(data.turns[0].error);
    assert.match(data.turns[0].error, /容量不足/);
    assert.equal(data.turns[0].budgets.length, 1);
  } finally {
    service.close();
  }
});

test('Tavily Search / Extract 的开关、缺 Key、限额、无结果和限流均可见', async () => {
  const requests: any[] = [];
  let status = 200,
    empty = false;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, data: JSON.parse(body), auth: req.headers.authorization });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        status !== 200
          ? { error: 'quota' }
          : req.url === '/extract'
            ? { results: [{ url: 'https://example.org/info', raw_content: '正文' }], failed_results: [] }
            : {
                results: empty
                  ? []
                  : [{ title: '公开来源', url: 'https://example.org/info', content: '资料摘要' }],
                usage: { credits: 1 }
              }
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port,
    settings = searchSettingsSchema.parse({
      baseUrl: `http://127.0.0.1:${port}`,
      maxSearches: 1,
      maxExtracts: 1
    });
  try {
    const make = (key = 'private-search-key', enabled = true) =>
      new PublicSearch(settings, key, enabled, new AbortController().signal);
    await assert.rejects(make('', true).search('历史'), /尚未配置/);
    await assert.rejects(make('x', false).search('历史'), /已关闭/);
    assert.equal(requests.length, 0);
    const search = make(),
      found = await search.search('唐代驿站');
    assert.equal(found.results.length, 1);
    assert.equal(requests[0].data.max_results, 5);
    assert.equal(requests[0].auth, 'Bearer private-search-key');
    assert.ok(found.at);
    await assert.rejects(search.search('第二次'), /上限/);
    const extracted = await search.extract(['https://example.org/info']);
    assert.equal(extracted.results[0].content, '正文');
    await assert.rejects(search.extract(['https://example.org/info']), /上限/);
    await assert.rejects(make().extract(['http://127.0.0.1/private']), /公开网页/);
    empty = true;
    assert.match((await make().search('不存在的资料')).message, /没有可用/);
    status = 429;
    await assert.rejects(make().search('限流'), /429.*限流/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('进程重开时未完成聊天标记 unknown，不自动请求；已执行卡不再次发起', async () => {
  const { service, chatId } = await setup();
  const root = service.store!.root;
  const turn = service.chat!.prepare(chatId, '尚未取得响应', 'test');
  service.close();
  await service.open(root);
  try {
    const data = await service.invoke('chat.read', { id: chatId });
    assert.equal(data.turns[0].status, 'unknown');
    assert.deepEqual(data.turns[0].usage, { input: null, output: null, cost: null, currency: 'USD' });
    assert.equal(data.messages.at(-1)!.status, 'unknown');
    assert.equal(data.turns[0].id, turn.id);
    assert.equal(service.chat!.controller, null);
  } finally {
    service.close();
  }
});
