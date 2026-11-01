import type { Fact } from '../shared/types';
import type { MemoryScope } from '../shared/studio';

/** Evidence is validated by the host; a broad quotation must not disclose adjacent secrets. */
export function modelFact(fact: Fact, scope?: MemoryScope) {
  if (!scope || scope.viewpoint === 'author' || fact.kind === 'author_constraint') return fact;
  return {
    id: fact.id, subject: fact.subject, predicate: fact.predicate, value: fact.value,
    kind: fact.kind, category: fact.category, state: fact.state,
    characterLayer: fact.characterLayer, subjectiveResponse: fact.subjectiveResponse,
    entityIds: fact.entityIds, fromChapter: fact.fromChapter, toChapter: fact.toChapter,
    fromPosition: fact.fromPosition, untilPosition: fact.untilPosition,
    knowledge: scope.viewpoint === 'character' ? fact.knowledge.filter(k => k.who === scope.characterId) : [],
    sources: fact.evidence.map(({ path, hash, start, end }) => ({ path, hash, start, end }))
  };
}

export function modelRetrieval<T extends { facts: { fact: Fact }[]; scope?: MemoryScope; disputes?: Fact[] }>(result: T, scope = result.scope) {
  return { ...result, facts: result.facts.map(item => ({ ...item, fact: modelFact(item.fact, scope) })), disputes: result.disputes?.map(f => modelFact(f, scope)) };
}
