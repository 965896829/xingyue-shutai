import type { Fact } from '../../shared/types';
import type { FileStore } from '../storage';
import { fingerprint } from './canonical';
import type { FactReadDependency } from '../../shared/workflow';

export function factReadDependency(
  facts: Fact[],
  scope: { worldId: string; timelineId: string },
  selection?: FactReadDependency['selection']
): FactReadDependency {
  const selected = facts
    .filter((fact) => fact.worldId === scope.worldId && fact.timelineId === scope.timelineId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    kind: 'predicate',
    worldId: scope.worldId,
    timelineId: scope.timelineId,
    hash: fingerprint(selected),
    ...(selection ? { selection } : {})
  };
}

export function factReadSetChanged(store: FileStore, dependency: FactReadDependency) {
  const { worldId, timelineId } = dependency;
  return (
    factReadDependency(dependency.selection ? store.db.factsForTask({ worldId, timelineId }, dependency.selection) : store.db.facts({ worldId, timelineId }), { worldId, timelineId }).hash !==
    dependency.hash
  );
}
