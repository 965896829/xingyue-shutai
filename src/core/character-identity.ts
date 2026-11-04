import type { FileStore } from './storage';
import type { Fact } from '../shared/types';
import type { MemoryScope, SourceRef } from '../shared/studio';
import { paths } from './domain';
import { parseCharacterCards } from './manuscript-view';
import { visibleFact, sourceValidator } from './memory-studio';

export function resolveCharacterIdentity(store: FileStore, entityId: string, scope: MemoryScope, facts: Fact[]) {
  const snapshot = store.db.snapshotInfo(scope.snapshotId ?? store.db.headRef()!.id);
  const valid = sourceValidator(store, snapshot.documents, scope.chapter, snapshot.project);
  const cardHash = snapshot.documents[paths.roles];
  const cards = cardHash && store.inspect(paths.roles)?.status === 'accepted'
    ? parseCharacterCards({ path: paths.roles, hash: cardHash, content: store.object(cardHash).toString('utf8'), track: 'saved' }) : [];
  const card = cards.find(candidate => candidate.id === entityId);
  const own = facts.filter(fact => fact.category === 'character' && fact.entityIds.includes(entityId) &&
    (fact.entityIds.length === 1 || card?.name === fact.subject) &&
    visibleFact(fact, scope) && fact.evidence.every(valid));
  const names = [...new Set(own.map(fact => fact.subject))];
  // The author view can name a card directly; restricted views require visible
  // identity evidence and never inherit undisclosed aliases from the full card.
  if (card && valid(card.source) && (scope.viewpoint === 'author' || names.includes(card.name)))
    return { entityId, name: card.name, basis: 'character_card' as const, sources: [card.source] };
  if (names.length === 1)
    return { entityId, name: names[0], basis: 'subject_record' as const, sources: own.flatMap(fact => fact.evidence) };
  return { entityId, name: entityId, basis: names.length > 1 ? 'ambiguous' as const : 'unresolved' as const, sources: [] as SourceRef[] };
}
