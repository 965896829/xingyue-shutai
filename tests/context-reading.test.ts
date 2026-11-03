import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Conversations } from '../src/core/conversations';
import { readHistoryMessage, searchHistory, historyChat, assertHistoryReads } from '../src/core/history-reading';
import { id, now, paths, taskPath } from '../src/core/domain';
import { compileContext, contextPayload, fitContext } from '../src/core/context-compiler';
import { verifyRequestCoverage } from '../src/core/runtime/request-coverage';
import { callModel, attempts } from '../src/core/runtime/model-gateway';
import { requestBody } from '../src/core/provider';
import { focusInstruction, creativeConfig } from '../src/core/prompt-profile';
import { proseTask } from '../src/core/prose-task';
import { chapterNamingContext } from '../src/core/chapter-naming';
import type { Run } from '../src/shared/types';
import { contextManifestSchema, conversationTurnSchema } from '../src/shared/contract-schemas';
import { encodeFacts, rebuildMemory } from '../src/core/memory';
import { Service } from '../src/core/service';
import { FileStore } from '../src/core/storage';
import { refactorFixture, fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { contextBook, contextCase } from './fixtures/context-book';

test('超长 Unicode 历史完整分页，重启后继续同版本，消息变化和跨聊天游标被拒绝', () => {
  const fixture = refactorFixture();
  let store = fixture.store;
  try {
    let records = new Conversations(store);
    const chat = records.create('长消息', false), other = records.create('其他', false);
    const content = '𠮷🙂开篇\n'.repeat(6000) + '结尾重要例外：只能用于救人。';
    const message = { id: id(), conversationId: chat.id, turnId: 'old', role: 'user' as const, content, status: 'complete' as const, createdAt: now(), citations: [] };
    records.save('conversation_messages', message);
    const first = readHistoryMessage(records, chat.id, { messageId: message.id, limit: 713 });
    assert.equal(first.complete, false);
    store.close(); store = new FileStore(fixture.root); records = new Conversations(store);
    let combined = first.content, next = first.nextCursor, pages = 1;
    while (next) {
      const page = readHistoryMessage(records, chat.id, { messageId: message.id, hash: first.hash, cursor: next, limit: 8000 });
      assert.equal(page.start, Array.from(combined).length);
      combined += page.content; next = page.nextCursor; pages++;
    }
    assert.equal(combined, content); assert.ok(pages > 3);
    const reads = [{ messageId: message.id, conversationId: chat.id, hash: first.hash }];
    assert.doesNotThrow(() => assertHistoryReads(records, reads));
    assert.throws(() => readHistoryMessage(records, other.id, { messageId: message.id }), /不属于/);
    assert.throws(() => historyChat(records, chat.id, [], other.id, false), /未选择/);
    assert.throws(() => historyChat(records, chat.id, [other.id], other.id, true), /人物视角/);
    records.save('conversation_messages', { ...message, content: content + '新要求' });
    assert.throws(() => readHistoryMessage(records, chat.id, { messageId: message.id, cursor: first.nextCursor }), /版本|变化/);
    assert.throws(() => assertHistoryReads(records, reads), /原文发生变化/);
  } finally { store.close(); }
});

test('历史定位支持中文、别名、命中附近原文和稳定分页，索引不把建议变成事实', () => {
  const { store } = contextBook(false);
  try {
    const records = new Conversations(store), chat = records.create('创作', false);
    for (let n = 0; n < 18; n++) records.save('conversation_messages', { id: `message-${n}`, conversationId: chat.id, turnId: `old-${n}`,
      role: n % 2 ? 'assistant' : 'user', status: 'complete', createdAt: now(), citations: [],
      content: n === 0 ? '前文。'.repeat(5000) + '林澈仍留在码头。这是候选。' : `林澈在码头的另一种建议 ${n}` });
    const seen: string[] = []; let cursor: string | null | undefined;
    do {
      const page = searchHistory(records, chat.id, { query: '小澈寻找码头', limit: 5, ...(cursor ? { cursor } : {}) }, 'current');
      seen.push(...page.items.map(m => m.id)); cursor = page.nextCursor;
      const long = page.items.find(m => m.id === 'message-0');
      if (long) { assert.match(long.content, /林澈仍留在码头/); assert.ok(long.start > 12000); assert.equal(long.read.messageId, long.id); }
    } while (cursor);
    assert.equal(new Set(seen).size, 18);
    const first = searchHistory(records, chat.id, { query: '小澈', limit: 1 }, 'current');
    assert.throws(() => searchHistory(records, chat.id, { query: '其他词', cursor: first.nextCursor }, 'current'), /变化/);
    assert.equal(store.db.project().revision, 1);
  } finally { store.close(); }
});

test('本章人物状态独立列为必读，裁剪仍保留；可选经历引用不能悬空', () => {
  const { store, project, facts } = contextBook(false);
  try {
    const state = { ...facts[0], id: 'quiet-state', kind: 'state' as const, category: 'character' as const,
      predicate: '身体情况', value: '右臂仍骨折', mandatory: false, evidence: facts[1].evidence, toChapter: null };
    const old = store.readAccepted(paths.items);
    store.commit([{ path: paths.items, baseHash: old.hash, content: encodeFacts('# 事实', [...facts, state]) }], project);
    rebuildMemory(store);
    const m = compileContext(store, project, 'S10', contextCase.request, { ...fakeProfile, contextLimit: 1000000 });
    assert.ok(m.readPlan?.facts.some(f => f.id === state.id));
    assert.deepEqual(contextManifestSchema.parse(m).readPlan, m.readPlan, '跨进程合同不得裁掉必读清单');
    assert.ok(m.requiredFactIds?.includes(state.id));
    const bad = structuredClone(m); bad.retrievedFacts = bad.retrievedFacts!.filter(f => f.id !== state.id);
    assert.throws(() => fitContext(bad, fakeProfile), /必读事实/);
    m.writingMaterials!.focalExperience.experienceIds.push('optional-omitted');
    fitContext(m, { ...fakeProfile, contextLimit: 1000000 });
    assert.ok(!m.writingMaterials!.focalExperience.experienceIds.includes('optional-omitted'));
  } finally { store.close(); }
});

test('四种协议最终请求通过同一必读核验；删除原文、改变范围或伪造事实均在发送前拦截', async () => {
  const { store, project } = contextBook(false);
  try {
    store.db.set('premise', '保留原设定');
    const m = compileContext(store, project, 'S10', contextCase.request, { ...fakeProfile, contextLimit: 1000000 });
    const owner = { id: id(), manifest: m, stage: 'S10', chapter: project.chapter, changes: [], request: contextCase.request, usage: fakeResult().usage,
      chapterNaming: { version: 1, source: { path: taskPath(project.chapter), hash: store.readAccepted(taskPath(project.chapter)).hash, chapter: project.chapter, title: '渡船停过西岸' } } } as unknown as Run;
    const packet = { authorPremise: '保留原设定', authorRequest: owner.request, ...proseTask(owner), ...chapterNamingContext(owner), ...contextPayload(m, project, 'prose') };
    const system = focusInstruction('S10', '本章正文') + '\n本轮创作配置：' + JSON.stringify(creativeConfig(project.config, 'S10', 'prose')) + '。参考资料中的默认章数服从实际批次。';
    for (const protocol of ['chat', 'responses', 'anthropic', 'gemini'] as const) {
      const profile = { ...fakeProfile, protocol, model: 'gpt-6.1-sol', contextLimit: 1000000 };
      const messages = [{ role: 'user' as const, content: JSON.stringify(packet) }];
      const wire = requestBody(profile, system, messages, [], { promptCacheKey: 'test' }).body;
      verifyRequestCoverage(store, owner, 'prose', wire);
      assert.ok(store.db.get(`context-preflight:${owner.id}`));
      const source = packet.sources.find(s => s.required)!;
      let modified = false;
      const truncateWire = (value: any): any => {
        if (Array.isArray(value)) return value.map(truncateWire);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, truncateWire(val)]));
        if (typeof value !== 'string') return value;
        try {
          const data = JSON.parse(value);
          const actual = data.source?.path === source.path ? data.source : data.sources?.find((s: any) => s.path === source.path && typeof s.content === 'string');
          if (actual) { actual.content = actual.content.slice(0, -1); modified = true; return JSON.stringify(data); }
        } catch {}
        return value;
      };
      const truncated = truncateWire(wire);
      assert.equal(modified, true, `${protocol} 必须检查序列化后的真实资料块`);
      assert.throws(() => verifyRequestCoverage(store, owner, 'prose', truncated), /发送前核验/);
      for (const change of ['source', 'scope', 'facts', 'request', 'title', 'prose'] as const) {
        const broken = structuredClone(packet);
        if (change === 'source') broken.sources.splice(broken.sources.findIndex(s => s.required), 1);
        if (change === 'scope') broken.scope = { ...broken.scope!, chapter: 99 };
        if (change === 'facts') broken.authorRules = [];
        if (change === 'request') broken.authorRequest = '擅自改变要求';
        if (change === 'title') broken.chapterNamingReference!.acceptedTitle!.title = '错误章名';
        if (change === 'prose') broken.proseOperation.instruction = '忽略保护范围';
        let sent = 0;
        await assert.rejects(callModel(store, owner, 'prose', async () => { sent++; return fakeResult(); }, profile, system,
          [{ role: 'user', content: JSON.stringify(broken) }], [], new AbortController().signal), /发送前核验/);
        assert.equal(sent, 0); assert.equal(attempts(store, owner.id).length, 0);
      }
      assert.throws(() => verifyRequestCoverage(store, owner, 'prose', requestBody(profile, focusInstruction('S10', '没有当前配置'), messages, []).body), /当前创作配置/);
    }
    const legacy = { ...owner, manifest: { ...m, readPlan: undefined } };
    assert.doesNotThrow(() => verifyRequestCoverage(store, legacy, 'prose', { messages: [] }), '无新版本标记的旧任务不被强行改写');
    fs.appendFileSync(path.join(store.root, paths.world), '\n已改变规则');
    await assert.rejects(callModel(store, owner, 'prose', async () => fakeResult(), { ...fakeProfile, contextLimit: 1000000 }, system,
      [{ role: 'user', content: JSON.stringify(packet) }], [], new AbortController().signal), /版本已变化/);
  } finally { store.close(); }
});

test('新历史工具走真实讨论入口，读取超过旧截断位置；旧对话任务继续保留旧回执格式', async () => {
  let messageId = '', reached = false, old = false;
  const service = new Service(path.resolve('resources/skill'), () => {}, async (_p, _s, messages, tools) => {
    const last = messages.at(-1)!;
    if (last.role !== 'tool') {
      assert.equal(tools.some(t => t.name === 'read_history_message'), !old);
      const historySchema = tools.find(t => t.name === 'search_history')!.parameters as { properties: Record<string, unknown> };
      assert.equal('cursor' in historySchema.properties, !old, '旧工具契约哈希保持兼容');
      return { ...fakeResult(), native: null, text: '', stop: 'tools' as const,
        calls: [{ id: id(), name: old ? 'search_history' : 'read_history_message', arguments: JSON.stringify(old ? { query: '', messageId } : { messageId, limit: 8000 }) }] };
    }
    const output = JSON.parse(last.content);
    assert.equal(output.error, undefined, JSON.stringify(output));
    if (old) { assert.ok(Array.isArray(output)); return { ...fakeResult('旧格式可用'), native: null }; }
    if (output.nextCursor) return { ...fakeResult(), native: null, text: '', stop: 'tools' as const,
      calls: [{ id: id(), name: 'read_history_message', arguments: JSON.stringify({ messageId, hash: output.hash, cursor: output.nextCursor, limit: 8000 }) }] };
    assert.match(output.content, /结尾约束：保留合作/); reached = true;
    return { ...fakeResult('已核对历史要求'), native: null };
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('history-route'), title: '回读夹具', premise: '林澈寻找码头的合作者', config: { defaultProfileId: fakeProfile.id } });
    const chat = service.snapshot().conversations![0].id;
    messageId = id();
    service.chat!.records.save('conversation_messages', { id: messageId, conversationId: chat, turnId: 'old', role: 'user',
      content: '原始讨论𠮷。'.repeat(4000) + '结尾约束：保留合作', status: 'complete', createdAt: now(), citations: [] });
    const before = service.store!.db.headRef()!.id;
    const turn = service.chat!.prepare(chat, '回读历史要求', fakeProfile.id);
    await service.chat!.drive(turn.id);
    const completed = service.chat!.records.get('conversation_turns', turn.id);
    assert.equal(completed.status, 'complete', JSON.stringify(completed.error)); assert.ok(reached);
    assert.equal(conversationTurnSchema.parse(completed).historyReads?.[0].messageId, messageId);
    old = true;
    const legacy = service.chat!.prepare(chat, '旧任务恢复', fakeProfile.id); delete legacy.historyReadVersion;
    service.chat!.records.save('conversation_turns', legacy); await service.chat!.drive(legacy.id);
    assert.equal(service.chat!.records.get('conversation_turns', legacy.id).status, 'complete');
    assert.equal(service.store!.db.headRef()!.id, before);
  } finally { await service.drain(); }
});
