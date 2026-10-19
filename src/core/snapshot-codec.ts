import type { CanonicalSnapshot } from '../shared/studio';
import type { Fact, ProjectState } from '../shared/types';

type DeltaSnapshot = Omit<CanonicalSnapshot, 'documents' | 'facts'> & {
  encoding: 'delta-v1'; depth: number; baseId: string;
  documents: Record<string, string | null>; facts: Fact[]; removedFacts: string[]; factOrder?: string[];
};
export type StoredSnapshot = CanonicalSnapshot | DeltaSnapshot;

function changes<T>(current: Record<string, T>, previous: Record<string, T>) {
  const result: Record<string, T | null> = {};
  for (const [key, value] of Object.entries(current)) if (value !== previous[key]) result[key] = value;
  for (const key of Object.keys(previous)) if (!(key in current)) result[key] = null;
  return result;
}

export function encodeSnapshot(current: CanonicalSnapshot, previous: CanonicalSnapshot | null, depth: number): StoredSnapshot {
  if (!previous || depth >= 127 || previous.projectId !== current.projectId) return current;
  const priorFacts = new Map(previous.facts.map(f => [f.id, JSON.stringify(f)]));
  const currentIds = new Set(current.facts.map(f => f.id));
  const factOrder = current.facts.map(f => f.id);
  const defaultOrder = [...previous.facts.filter(f => currentIds.has(f.id)).map(f => f.id), ...current.facts.filter(f => !priorFacts.has(f.id)).map(f => f.id)];
  return { ...current, encoding: 'delta-v1', depth: depth + 1, baseId: previous.id,
    project: { ...current.project, chapters: changes(current.project.chapters, previous.project.chapters) as ProjectState['chapters'] },
    documents: changes(current.documents, previous.documents),
    facts: current.facts.filter(f => priorFacts.get(f.id) !== JSON.stringify(f)),
    removedFacts: previous.facts.filter(f => !currentIds.has(f.id)).map(f => f.id),
    ...(factOrder.some((key, i) => key !== defaultOrder[i]) ? { factOrder } : {}) };
}

export function decodeSnapshot(last: StoredSnapshot, read: (id: string) => StoredSnapshot): CanonicalSnapshot {
  const chain: DeltaSnapshot[] = [], visited = new Set<string>();
  let base = last;
  while ('encoding' in base) {
    if (base.encoding !== 'delta-v1' || visited.has(base.id) || chain.length >= 127 || base.baseId !== base.parentId) throw new Error('历史快照增量链损坏');
    visited.add(base.id); chain.push(base);
    const parent = read(base.baseId);
    if (parent.id !== base.baseId || parent.projectId !== base.projectId || parent.revision > base.revision) throw new Error('历史快照来源不一致');
    base = parent;
  }
  let result = structuredClone(base);
  const facts = new Map(result.facts.map(f => [f.id, f]));
  for (const delta of chain.reverse()) {
    const documents = result.documents, chapters = result.project.chapters;
    for (const [key, value] of Object.entries(delta.documents)) { if (value === null) delete documents[key]; else documents[key] = value; }
    for (const [key, value] of Object.entries(delta.project.chapters)) { if (value === null) delete chapters[key]; else chapters[key] = value; }
    for (const key of delta.removedFacts) facts.delete(key);
    for (const fact of delta.facts) facts.set(fact.id, fact);
    if (delta.factOrder) {
      if (delta.factOrder.length !== facts.size || new Set(delta.factOrder).size !== facts.size || delta.factOrder.some(key => !facts.has(key))) throw new Error('历史快照事实顺序损坏');
      const ordered = delta.factOrder.map(key => facts.get(key)!);
      facts.clear();
      for (const fact of ordered) facts.set(fact.id, fact);
    }
    result = { id: delta.id, projectId: delta.projectId, revision: delta.revision, createdAt: delta.createdAt, parentId: delta.parentId,
      project: { ...delta.project, chapters }, documents, facts: [] };
  }
  result.facts = [...facts.values()];
  return result;
}
