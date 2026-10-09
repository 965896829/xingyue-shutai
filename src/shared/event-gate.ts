import type { AppEvent, Snapshot } from './types';

export interface EventCursor {
  seq: number;
  epoch?: string;
  projectId?: string;
  waiting: boolean;
}
export function syncEventCursor(cursor: EventCursor, snapshot: Snapshot) {
  cursor.seq =
    cursor.epoch === snapshot.epoch ? Math.max(cursor.seq, snapshot.eventSeq ?? 0) : (snapshot.eventSeq ?? 0);
  cursor.epoch = snapshot.epoch;
  cursor.projectId = snapshot.project?.id;
  cursor.waiting = false;
}
export function gateEvent(cursor: EventCursor, event: AppEvent): 'ignore' | 'refresh' | 'apply' {
  if (event.projectId && cursor.projectId && event.projectId !== cursor.projectId) return 'ignore';
  if (cursor.waiting) return 'ignore';
  if (
    (event.streamEpoch && event.streamEpoch !== cursor.epoch) ||
    (event.seq && event.seq > cursor.seq + 1)
  ) {
    cursor.waiting = true;
    return 'refresh';
  }
  if (event.seq && event.seq <= cursor.seq) return 'ignore';
  if (event.seq) cursor.seq = event.seq;
  return 'apply';
}
