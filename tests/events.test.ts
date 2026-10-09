import test from 'node:test';
import assert from 'node:assert/strict';
import { gateEvent, syncEventCursor, type EventCursor } from '../src/shared/event-gate';
import type { Snapshot } from '../src/shared/types';

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
