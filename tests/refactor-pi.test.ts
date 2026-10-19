import test from 'node:test';
import assert from 'node:assert/strict';
import { PiExecutorAdapter } from '../src/core/runtime/pi-executor';
import { attempts } from '../src/core/runtime/model-gateway';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { refactorFixture, fakeProfile, fakeResult } from './fixtures/refactor';
import { RequestError } from '../src/core/provider';
import { Conversations } from '../src/core/conversations';
import { now } from '../src/core/domain';

test('T-065 GATE-01/04/05 Pi read, draft, candidate bridge waits for checkpoint and retains native continuation', async () => {
  const { store, run, project } = refactorFixture();
  run.executorId = 'pi'; run.executorVersion = '0.73.1'; store.db.saveRun(run);
  const conversations = new Conversations(store), conversation = conversations.create();
  conversations.save('conversation_messages', { id: 'pi-draft-origin', conversationId: conversation.id, turnId: '', role: 'assistant', content: '独立草稿', createdAt: now(), status: 'complete', citations: [] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void;
  const reachedCheckpoint = new Promise<void>((resolve) => { reached = resolve; });
  let requests = 0, effects = 0;
  const definitions = ['read_document', 'save_draft', 'propose_changes'].map((name) => ({ name, description: name, parameters: { type: 'object', properties: {}, additionalProperties: false } }));
  const adapter = new PiExecutorAdapter(store, {
    profile: fakeProfile, system: '离线 conformance', tools: definitions,
    model: async (_profile, _system, messages) => {
      requests++;
      if (requests === 1) return { ...fakeResult(), calls: definitions.map((tool, i) => ({ id: 'call-' + i, name: tool.name, arguments: '{}' })), stop: 'tools', native: { opaque: 'fixture-reasoning-signature' } };
      assert.equal(messages.filter((message) => message.role === 'tool').length, 3);
      assert.deepEqual(messages.find((message) => message.role === 'assistant')!.native, { opaque: 'fixture-reasoning-signature' });
      return fakeResult('完成');
    },
    checkpoint: async (event) => { if (event.type === 'message_end' && event.message.role === 'assistant' && requests === 1) { reached(); await gate; } },
    display: () => { throw new Error('display observer failed'); },
    prepareTool: async (call) => ({ result: call.name === 'read_document' ? store.readAccepted('正文.md').content : 'saved', persist: () => {
      effects++;
      if (call.name === 'save_draft') conversations.saveDraft({ title: 'Pi 独立草稿', content: '独立草稿', conversationId: conversation.id, messageId: 'pi-draft-origin' });
      if (call.name === 'propose_changes') { const candidate = store.db.run(run.id); candidate.changes[0].content = 'Pi 候选'; store.db.saveRun(candidate); }
    } })
  });
  try {
    const execution = adapter.execute({ id: run.id, kind: 'run' });
    await reachedCheckpoint;
    assert.equal(effects, 0); assert.equal(requests, 1); assert.equal(attempts(store, run.id)[0].status, 'complete');
    release(); await execution;
    assert.equal(effects, 3); assert.equal(requests, 2); assert.equal(attempts(store, run.id).length, 2);
    assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
    const drafts = conversations.all('draft_artifacts');
    assert.equal(drafts.length, 1);
    assert.equal(store.read(drafts[0].path).content, '独立草稿');
    const candidate = store.db.run(run.id);
    new ProjectCommitService(store).commit(candidate.changes, { ...project, revision: 1 }, candidate);
    assert.equal(store.readAccepted('正文.md').content, 'Pi 候选');
    const before = requests;
    adapter.restore({ runId: run.id, executorId: 'pi', executorVersion: '0.73.1', checkpointVersion: 1 });
    assert.equal(requests, before);
    assert.throws(() => adapter.restore({ runId: run.id, executorId: 'pi', executorVersion: 'future', checkpointVersion: 9 }), /未知/);
  } finally { release(); await adapter.dispose(); store.close(); }
});

test('T-064/065 GATE-02/06/08 Pi unknown response stops once and restore never calls model', async () => {
  const { store, run } = refactorFixture(); let requests = 0;
  run.executorId = 'pi'; run.executorVersion = '0.73.1'; store.db.saveRun(run);
  const adapter = new PiExecutorAdapter(store, { profile: fakeProfile, system: '', tools: [],
    model: async () => { requests++; throw new RequestError('fixture disconnected', true); }, prepareTool: async () => { throw new Error('must not run'); } });
  try {
    await assert.rejects(adapter.execute({ id: run.id, kind: 'run' }), /disconnected/);
    adapter.restore({ runId: run.id, executorId: 'pi', executorVersion: '0.73.1', checkpointVersion: 1 });
    assert.equal(requests, 1); assert.equal(attempts(store, run.id)[0].status, 'unknown');
  } finally { await adapter.dispose(); store.close(); }
});

test('T-046/065 checkpoint failure prevents the next Pi tool side effect', async () => {
  const { store, run } = refactorFixture(); let effects = 0, requests = 0;
  run.executorId = 'pi'; run.executorVersion = '0.73.1'; store.db.saveRun(run);
  const adapter = new PiExecutorAdapter(store, { profile: fakeProfile, system: '', tools: [{ name: 'save_draft', description: '', parameters: { type: 'object' } }],
    model: async () => { requests++; return { ...fakeResult(), calls: [{ id: 'c', name: 'save_draft', arguments: '{}' }], stop: 'tools' }; },
    checkpoint: async (event) => { if (event.type === 'message_end' && event.message.role === 'assistant') throw new Error('checkpoint full'); },
    prepareTool: async () => { effects++; return { result: 'wrong' }; } });
  try {
    await assert.rejects(adapter.execute({ id: run.id, kind: 'run' }), /checkpoint full/);
    assert.equal(effects, 0); assert.equal(requests, 1);
  } finally { await adapter.dispose(); store.close(); }
});
