import type { FileStore } from './storage';
import { workbenchBindingSchema } from '../shared/workbench';
import type { StateHistory } from '../shared/workbench-visual';
import { scopeSnapshot, visibleFact, sourceValidator } from './memory-studio';
import { readWorkbench } from './workbench';

export function workbenchHistory(store: FileStore, raw: unknown, compareSnapshotId?: string): StateHistory {
  const binding = workbenchBindingSchema.parse(raw);
  const scope = { ...binding.scope, projectId: binding.projectId, snapshotId: binding.snapshotId };
  const snapshot = scopeSnapshot(store, scope);
  const view = readWorkbench(store, scope),
    object = view.objects.find((o) => o.id === binding.objectId);
  if (!snapshot || !object) throw new Error('此对象不在当前查看范围');
  const result: StateHistory = {
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    objectId: object.id,
    changes: [],
    comparison: null
  };
  const valid = sourceValidator(store, snapshot.documents, scope.chapter, snapshot.project);
  const available = new Map<string, boolean>();
  const sourceValid = (e: Parameters<typeof valid>[0]) => {
    if (scope.mode === 'current' && !available.has(e.path))
      available.set(e.path, store.inspect(e.path)?.status === 'accepted');
    return valid(e) && (scope.mode === 'historical' || available.get(e.path));
  };
  for (const fact of snapshot.facts) {
    if (
      fact.reviewStatus !== 'accepted' ||
      fact.state === 'disputed' ||
      ['plan', 'inference', 'author_constraint'].includes(fact.kind) ||
      fact.fromChapter > scope.chapter ||
      !(object.entityIds.length
        ? fact.entityIds.some((id) => object.entityIds.includes(id))
        : object.id === `fact:${fact.id}`) ||
      !fact.evidence.length ||
      !fact.evidence.every(sourceValid)
    )
      continue;
    const at = Math.min(scope.chapter, fact.toChapter ?? scope.chapter);
    if (
      !visibleFact(
        fact,
        { ...scope, chapter: at }
      )
    )
      continue;
    result.changes.push({
      id: fact.id,
      chapter: fact.fromChapter,
      storyTime: fact.storyTime,
      label: fact.predicate,
      value: fact.value,
      kind: fact.kind,
      state: fact.state,
      source: { ...fact.evidence[0], snapshotId: snapshot.id }
    });
  }
  result.changes.sort((a, b) => a.chapter - b.chapter || a.label.localeCompare(b.label));
  const versions = store.db
    .snapshots()
    .filter((s) => s.projectId === snapshot.projectId && s.revision < snapshot.revision)
    .sort((a, b) => b.revision - a.revision);
  const previous = compareSnapshotId ? versions.find((s) => s.id === compareSnapshotId) : versions[0];
  if (compareSnapshotId && !previous) throw new Error('比较版本不属于此作品的更早版本');
  if (previous) {
    const old = readWorkbench(store, { ...scope, mode: 'historical', snapshotId: previous.id });
    const prior = old.objects.find((o) => o.id === object.id);
    const keys = [...new Set([...(prior?.fields.map((f) => f.id) ?? []), ...object.fields.map((f) => f.id)])];
    result.comparison = {
      snapshotId: previous.id,
      revision: previous.revision,
      fields: keys.flatMap((id) => {
        const before = prior?.fields.find((f) => f.id === id),
          after = object.fields.find((f) => f.id === id);
        return before?.value === after?.value
          ? []
          : [
              {
                label: after?.label ?? before!.label,
                before: before?.value ?? null,
                after: after?.value ?? null
              }
            ];
      })
    };
  }
  return result;
}
