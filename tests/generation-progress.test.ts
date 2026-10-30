import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generationActivityLabel, generationOperation, syncGeneration, updateGeneration, type GenerationActivity, type GenerationOwner } from '../src/shared/generation';
import { conversationTurnSchema } from '../src/shared/contract-schemas';
import { GenerationStep } from '../src/ui/GenerationStatus';
import { Service } from '../src/core/service';
import { paths } from '../src/core/domain';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';

test('同一执行阶段内切换工具会更新当前步骤，下一次模型请求清除旧工具提示', () => {
  const owner: GenerationOwner = { status: 'running' };
  syncGeneration(owner, '2026-10-30T00:00:00Z');
  assert.equal(updateGeneration(owner, 'tools', '2026-10-30T00:00:01Z', 'read_book'), true);
  assert.equal(generationActivityLabel(owner.activity), '正在读取作品资料');
  assert.equal(updateGeneration(owner, 'tools', '2026-10-30T00:00:02Z', 'read_rule'), true);
  assert.equal(generationActivityLabel(owner.activity), '正在查阅创作规则');
  assert.equal(owner.activity?.startedAt, '2026-10-30T00:00:00Z');
  assert.equal(updateGeneration(owner, 'tools', '2026-10-30T00:00:03Z', 'read_rule'), false);
  updateGeneration(owner, 'waiting', '2026-10-30T00:00:04Z');
  assert.equal(owner.activity?.operation, undefined);
  assert.equal(generationActivityLabel(owner.activity), '正在等待回复');
  owner.status = 'stopped';
  syncGeneration(owner, '2026-10-30T00:00:05Z');
  assert.equal(updateGeneration(owner, 'tools', '2026-10-30T00:00:06Z', 'read_book'), false);
});

test('流光步骤仅在运行期间出现，兼容没有执行详情的旧记录', () => {
  const activity: GenerationActivity = { phase: 'tools', operation: 'search_memory', startedAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:01Z' };
  const render = (running: boolean, current?: GenerationActivity) => renderToStaticMarkup(createElement(GenerationStep, { running, activity: current }));
  assert.match(render(true, activity), /正在检索作品记忆/);
  assert.match(render(true, activity), /role="status"/);
  assert.equal(render(false, activity), '');
  assert.equal(render(true, { ...activity, stoppedAt: '2026-10-30T00:00:02Z' }), '');
  assert.match(render(true), /正在准备/);
  assert.equal(generationOperation('unknown_tool'), undefined);
  assert.equal(generationOperation('constructor'), undefined);
});

for (const executorId of ['legacy', 'pi'] as const) {
  test(`${executorId} 聊天在真实工具执行边界发布步骤，完成后冻结并保留 IPC 契约`, { timeout: 15000 }, async () => {
    const observed: GenerationActivity[] = [];
    let turnId = '', calls = 0;
    const profile = { ...fakeProfile, contextLimit: 1000000, outputLimit: 4096 };
    const service: Service = new Service(path.resolve('resources/skill'), event => {
      if (event.resource === 'chat' && turnId) {
        const turn = service.chat!.records.get('conversation_turns', turnId);
        conversationTurnSchema.parse(turn);
        if (turn.activity) observed.push(structuredClone(turn.activity));
      }
    }, async (_profile, _system, _messages, _tools, _signal, delta, options) => {
      calls++;
      options?.onActivity?.('thinking');
      if (calls === 1) return { ...fakeResult('我会先读取作品资料，再核对创作规则。'), stop: 'tools', calls: [
        { id: 'read-book', name: 'read_book', arguments: JSON.stringify({ path: paths.style, reason: '核对已保存的文风资料', lines: 2 }) },
        { id: 'read-rule', name: 'read_rule', arguments: JSON.stringify({ name: 'workflow', lines: 2 }) }
      ] };
      const waiting = observed.filter(activity => activity.phase === 'waiting').at(-1)!;
      assert.equal(waiting.operation, undefined);
      delta?.('资料和规则已核对，可以继续讨论开场。');
      return fakeResult('资料和规则已核对，可以继续讨论开场。');
    });
    service.profiles = [profile];
    try {
      await service.invoke('project.create', { parent: isolatedRoot('chat-activity'), title: '状态步骤验收', premise: '维修员追查停电原因', config: { defaultProfileId: profile.id } });
      const chat = service.chat!;
      const conversation = chat.records.create('执行状态验收', false);
      const turn = chat.prepare(conversation.id, '请核对作品资料与规则，再讨论故事开场', profile.id);
      turnId = turn.id;
      turn.executorId = executorId;
      if (executorId === 'legacy') turn.executorVersion = '1';
      chat.records.save('conversation_turns', turn);
      const revision = service.store!.db.project().revision;
      await chat.drive(turn.id);
      const saved = chat.records.get('conversation_turns', turn.id);
      assert.equal(saved.status, 'complete', saved.error ?? '聊天应正常完成');
      assert.equal(calls, 2);
      const tools = observed.filter(activity => activity.operation).map(activity => activity.operation);
      assert.ok(tools.includes('read_book'));
      assert.ok(tools.indexOf('read_rule') > tools.indexOf('read_book'));
      assert.ok(saved.activity?.stoppedAt);
      assert.equal(saved.activity?.operation, undefined);
      const page = await service.invoke('chat.page', { id: conversation.id });
      assert.deepEqual(page.turns[0].activity, saved.activity);
      assert.equal(service.store!.db.project().revision, revision);
    } finally {
      await service.drain();
    }
  });
}
