import type { AppEvent, Snapshot } from './types';

export interface EventCursor {
  seq: number;
  epoch?: string;
  projectId?: string;
  projectSessionId?: string;
  workerGeneration?: number;
  waiting: boolean;
  resourceVersions?: Record<string, number>;
}
export function syncEventCursor(cursor: EventCursor, snapshot: Snapshot) {
  if (cursor.epoch !== snapshot.epoch) cursor.resourceVersions = {};
  cursor.seq =
    cursor.epoch === snapshot.epoch ? Math.max(cursor.seq, snapshot.eventSeq ?? 0) : (snapshot.eventSeq ?? 0);
  cursor.epoch = snapshot.epoch;
  cursor.projectId = snapshot.project?.id;
  cursor.projectSessionId = snapshot.projectSessionId;
  cursor.workerGeneration = snapshot.workerGeneration;
  cursor.waiting = false;
}
export function gateEvent(cursor: EventCursor, event: AppEvent): 'ignore' | 'refresh' | 'apply' {
  if (event.workerGeneration !== undefined && cursor.workerGeneration !== undefined && event.workerGeneration < cursor.workerGeneration) return 'ignore';
  if (event.projectSessionId && cursor.projectSessionId && event.projectSessionId !== cursor.projectSessionId && event.workerGeneration === cursor.workerGeneration) return 'ignore';
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
  if (event.resource && event.resourceId && event.resourceVersion !== undefined) {
    const key = `${event.resource}:${event.resourceId}`;
    const versions = cursor.resourceVersions ??= {};
    if (versions[key] !== undefined && event.resourceVersion < versions[key]) return 'ignore';
    versions[key] = event.resourceVersion;
  }
  return 'apply';
}
