import test from 'node:test';
import assert from 'node:assert/strict';
import { gateEvent, syncEventCursor, type EventCursor } from '../src/shared/event-gate';
import type { Snapshot } from '../src/shared/types';
import { streamText, visibleStreamText, syncGeneration, updateGeneration, elapsedGeneration, formatElapsed, type GenerationOwner } from '../src/shared/generation';
import { visibleRunIssues } from '../src/shared/run-presentation';
import type { Run } from '../src/shared/types';

test('流式文本按字符偏移合并，重复事件、旧快照、多轮分隔和断点重连不丢字或重复', () => {
  let live = streamText(undefined, { offset: 2, text: '𠮷' });
  live = streamText(live, { offset: 4, text: '来了' });
  assert.equal(visibleStreamText('前文', live), '前文𠮷来了');
  assert.equal(visibleStreamText('前文𠮷', live), '前文𠮷来了');
  live = streamText(live, { offset: 2, text: '𠮷' });
  assert.equal(visibleStreamText('前文', live), '前文𠮷来了');
  assert.equal(visibleStreamText('前文𠮷来了，已完成', live), '前文𠮷来了，已完成');
  live = streamText(live, { offset: 8, text: '下一轮' });
  assert.equal(visibleStreamText('前文𠮷来了', live), '前文𠮷来了');
  assert.equal(visibleStreamText('前文𠮷来了\n\n', live), '前文𠮷来了\n\n下一轮');
  const long = '长'.repeat(70000), bounded = streamText(undefined, { offset: 0, text: long });
  assert.equal(bounded.text.length, 64000);
  assert.equal(visibleStreamText(long.slice(0, 6000), bounded), long);
});

test('生成计时在结束后冻结，继续执行重新计时，迟到状态不使已停止任务恢复', () => {
  const owner: GenerationOwner = { status: 'running' };
  syncGeneration(owner, '2026-01-01T00:00:00Z');
  updateGeneration(owner, 'waiting', '2026-01-01T00:00:02Z');
  assert.equal(elapsedGeneration(owner.activity!, Date.parse('2026-01-01T00:01:05Z')), 65);
  owner.status = 'paused'; syncGeneration(owner, '2026-01-01T00:01:06Z');
  assert.equal(updateGeneration(owner, 'responding'), false);
  assert.equal(elapsedGeneration(owner.activity!, Date.parse('2026-01-02T00:00:00Z')), 66);
  syncGeneration(owner, '2026-01-02T00:00:00Z');
  assert.equal(owner.activity!.stoppedAt, '2026-01-01T00:01:06Z');
  owner.status = 'running'; syncGeneration(owner, '2026-01-02T00:00:00Z');
  assert.equal(owner.activity!.stoppedAt, undefined);
  assert.equal(elapsedGeneration(owner.activity!, Date.parse('2026-01-02T00:00:03Z')), 3);
  assert.equal(formatElapsed(65), '1 分 5 秒');
  assert.equal(formatElapsed(3661), '1 小时 1 分 1 秒');
});

test('生成途中仅隐藏待生成产物提示，暂停后仍显示缺失且不隐藏实际冲突', () => {
  const run = { status: 'running', issues: [{ code: 'missing_output' }, { code: 'document_draft_pending' }, { code: 'pipeline_pending' }, { code: 'behavior_update' }, { code: 'conflict' }] } as Run;
  assert.deepEqual(visibleRunIssues(run).map(i => i.code), ['conflict']);
  run.status = 'paused';
  assert.equal(visibleRunIssues(run).length, 5);
});

test('M22/23：重复与跨项目事件拒收，缺口和进程换代先拉快照再应用', () => {
  const cursor: EventCursor = { seq: 3, epoch: 'worker-a', projectId: 'book', waiting: false };
  const event = {
    type: 'prose-delta' as const,
    projectId: 'book',
    streamEpoch: 'worker-a',
    seq: 4,
    text: '正文'
  };
  assert.equal(gateEvent(cursor, event), 'apply');
  assert.equal(gateEvent(cursor, event), 'ignore');
  assert.equal(gateEvent(cursor, { ...event, seq: 2 }), 'ignore');
  assert.equal(gateEvent(cursor, { ...event, seq: 5, projectId: 'other' }), 'ignore');
  assert.equal(gateEvent(cursor, { ...event, seq: 7 }), 'refresh');
  assert.equal(gateEvent(cursor, { ...event, seq: 8 }), 'ignore');
  syncEventCursor(cursor, { eventSeq: 8, epoch: 'worker-a', project: { id: 'book' } } as Snapshot);
  assert.equal(gateEvent(cursor, { ...event, seq: 9 }), 'apply');
  assert.equal(gateEvent(cursor, { ...event, seq: 1, streamEpoch: 'worker-b' }), 'refresh');
  syncEventCursor(cursor, { eventSeq: 1, epoch: 'worker-b', project: { id: 'book' } } as Snapshot);
  assert.equal(gateEvent(cursor, { ...event, seq: 2, streamEpoch: 'worker-b' }), 'apply');
});
