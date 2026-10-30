import type { Fact } from '../../shared/types';
import type { FileStore } from '../storage';
import { fingerprint } from './canonical';
import type { FactReadDependency } from '../../shared/workflow';

export function factReadDependency(
  facts: Fact[],
  scope: { worldId: string; timelineId: string }
): FactReadDependency {
  const selected = facts
    .filter((fact) => fact.worldId === scope.worldId && fact.timelineId === scope.timelineId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    kind: 'predicate',
    worldId: scope.worldId,
    timelineId: scope.timelineId,
    hash: fingerprint(selected)
  };
}

export function factReadSetChanged(store: FileStore, dependency: FactReadDependency) {
  const { worldId, timelineId } = dependency;
  return (
    factReadDependency(store.db.facts({ worldId, timelineId }), { worldId, timelineId }).hash !==
    dependency.hash
  );
}
