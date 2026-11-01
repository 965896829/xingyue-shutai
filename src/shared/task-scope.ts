import type { Batch } from './types';
import type { MemoryScope } from './studio';

export interface TaskScope {
  version: 1;
  branchId: 'main';
  sourceSnapshotId?: string;
  sourceRevision: number;
  batch: Batch;
  memory: MemoryScope;
}
