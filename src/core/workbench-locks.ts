import type { FileStore } from './storage';
import type { Change } from '../shared/types';
import { workbenchLocksSchema } from '../shared/workbench';
import { documentWorkbenchObjects } from './workbench-documents';

export const workbenchLocksKey = 'workbench-field-locks-v1';
export function workbenchLocks(store: FileStore) {
  return workbenchLocksSchema.parse(store.db.get(workbenchLocksKey) ?? []);
}
export function validateWorkbenchLocks(store: FileStore, changes: Change[]) {
  const locks = workbenchLocks(store);
  for (const change of changes) {
    const relevant = locks.filter((l) => l.path === change.path);
    if (!relevant.length) continue;
    const objects = documentWorkbenchObjects(change.path, change.content);
    for (const lock of relevant) {
      const field = objects.find((o) => o.id === lock.objectId)?.fields.find((f) => f.id === lock.fieldId);
      if (!field || field.value !== lock.value)
        throw new Error(`“${lock.label}”已固定，请先在共创画布解除固定`);
    }
  }
}
