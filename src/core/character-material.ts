import type { ContextManifest, Fact } from '../shared/types';
import type { SceneMaterial } from '../shared/scene-material';
import type { ChapterCoverage } from '../shared/chapter-memory';
import type { FileStore } from './storage';
import { prosePath } from './domain';

/** Only the caller's evidence-checked, viewpoint-filtered facts may enter this packet. */
export function characterMaterial(store: FileStore, chapter: number, character: string, facts: Fact[],
  scenes: SceneMaterial[], preferences: NonNullable<ContextManifest['voicePreferences']>, authorView: boolean) {
  const own = facts.filter(f => [f.subject, ...f.aliases, ...f.entityIds].includes(character));
  const names = new Set([character, ...own.flatMap(f => [f.subject, ...f.aliases, ...f.entityIds])]);
  const current = scenes.filter(s => !s.focalCharacter || names.has(s.focalCharacter));
  const by = (test: (f: Fact) => boolean) => own.filter(test).map(f => ({ id: f.id, kind: f.kind, predicate: f.predicate, value: f.value }));
  const voice = preferences.filter(p => p.scope.kind !== 'character' || names.has(p.scope.target));
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
    voice: { narration: voice.filter(p => p.scope.kind === 'book').map(p => p.statement), dialogue: voice.filter(p => p.scope.kind === 'character').map(p => p.statement),
      local: voice.filter(p => p.scope.kind === 'scene').map(p => p.statement), samples: voice.flatMap(p => p.samples ?? []).slice(0, 3) } };
}
