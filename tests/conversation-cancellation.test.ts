import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { attempts } from '../src/core/runtime/model-gateway';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';

for (const toolReply of [false, true])
  test(`取消聊天后的迟到${toolReply ? '工具' : '文本'}响应只保留记录，不完成聊天或执行工具`, { timeout: 15000 }, async () => {
    let entered!: () => void, release!: () => void, requests = 0;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const model = { ...fakeProfile, contextLimit: 200000, outputLimit: 4096 };
    const service = new Service(path.resolve('resources/skill'), () => {}, async (_profile, _system, _messages, _tools, signal, onDelta) => {
      requests++;
      entered();
      await waiting;
      assert.equal(signal.aborted, true);
      const result = fakeResult('取消后收到的完整回答');
      if (toolReply) {
        onDelta?.(result.text);
        result.calls = [{ id: 'late-proposal', name: 'propose_action', arguments: JSON.stringify({
          kind: 'stage', goal: '整理主角动机', scope: '当前阶段', request: '根据讨论整理设定', outputs: ['设定拆解']
        }) }];
        result.stop = 'tools';
      }
      return result;
    });
    service.profiles = [model];
    let execution: Promise<void> | undefined;
    try {
      await service.invoke('project.create', { parent: isolatedRoot('cancel-chat'), title: '停止聊天验收',
        premise: '维修员追查停电原因', config: { defaultProfileId: model.id } });
      const chat = service.chat!, store = service.store!;
      const conversation = chat.records.create('取消测试', false);
      const turn = chat.prepare(conversation.id, '讨论主角动机', model.id);
      execution = chat.drive(turn.id);
      await Promise.race([started, execution.then(() => { throw new Error('模型请求未开始：' + chat.records.get('conversation_turns', turn.id).error); })]);
      chat.stop();
      release();
      await execution;
      const saved = chat.records.get('conversation_turns', turn.id);
      const message = chat.records.get('conversation_messages', turn.messageId);
      assert.equal(requests, 1);
      assert.equal(saved.status, 'stopped');
      assert.ok(saved.activity?.startedAt);
      assert.ok(saved.activity?.stoppedAt);
      assert.equal(message.status, 'stopped');
      assert.equal(message.content, '取消后收到的完整回答');
      assert.equal(saved.messages.at(-1)!.content, message.content);
      assert.equal(saved.usage.cost, 0.00002);
      assert.deepEqual(saved.calls, []);
      assert.equal(chat.records.all('action_proposals').length, 0);
      assert.equal(store.db.sql.prepare('SELECT COUNT(*) AS n FROM tool_executions').get()!.n, 0);
      assert.equal(attempts(store, turn.id)[0].status, 'complete');
      assert.equal(attempts(store, turn.id)[0].usageState, 'known');
      assert.equal(chat.controller, null);
    } finally {
      release();
      await execution;
      await service.drain();
    }
  });
