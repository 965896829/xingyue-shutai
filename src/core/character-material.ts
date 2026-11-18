import type { ContextManifest, Fact } from '../shared/types';
import type { CharacterMaterial, SceneMaterial } from '../shared/scene-material';
import type { ChapterCoverage } from '../shared/chapter-memory';
import type { FileStore } from './storage';
import { prosePath } from './domain';

/** Only the caller's evidence-checked, viewpoint-filtered facts may enter this packet. */
export function characterMaterial(store: FileStore, chapter: number, character: string, facts: Fact[],
  scenes: SceneMaterial[], preferences: NonNullable<ContextManifest['voicePreferences']>, authorView: boolean, card?: CharacterMaterial['card']): CharacterMaterial {
  const own = facts.filter(f => [f.subject, ...f.aliases, ...f.entityIds].includes(character));
  const names = new Set([character, ...own.flatMap(f => [f.subject, ...f.aliases, ...f.entityIds])]);
  const current = scenes.filter(s => !s.focalCharacter || names.has(s.focalCharacter));
  const by = (test: (f: Fact) => boolean) => own.filter(test).map(f => f.id);
  const indices = (kind: 'character' | 'book' | 'scene') => preferences.flatMap((p, i) =>
    p.scope.kind === kind && (kind !== 'character' || names.has(p.scope.target)) ? [i] : []);
  const previous = chapter > 1 && authorView ? store.db.get<ChapterCoverage>('accepted-coverage:' + (chapter - 1)) : undefined;
  const last = previous && previous.proseHash === store.db.document(prosePath(chapter - 1))?.hash
    ? previous.characters.find(c => names.has(c.entityId) || names.has(c.name)) : undefined;
  return { character, values: by(f => f.characterLayer === 'stable' || /欲望|价值|底线|取舍/.test(f.predicate)),
    goal: { facts: by(f => /目标|意图|当前关切/.test(f.predicate)), plan: current.flatMap(s => s.goal ?? s.concern ?? []) },
    condition: { facts: by(f => f.kind === 'state' || ['injury', 'item', 'promise'].includes(f.category)), pressure: current.flatMap(s => s.pressure ?? []) },
    interlocutor: { facts: by(f => f.category === 'relation'), scene: current.flatMap(s => s.addressees ?? []) },
    experience: { known: by(f => f.kind === 'event' || f.characterLayer === 'experience'), beliefs: by(f => ['belief', 'inference'].includes(f.kind)),
      ...(last ? { lastChapter: { outcome: last.outcome, facts: last.factIds, source: { path: prosePath(chapter - 1), hash: previous!.proseHash } } } : {}) },
    communication: current.flatMap(s => s.dialogueIntent ?? []),
    card, voice: { narration: indices('book'), dialogue: indices('character'), local: indices('scene') } };
}
