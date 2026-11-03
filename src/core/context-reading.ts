import type { ContextManifest, Fact } from '../shared/types';
import { hash } from './domain';
import { fingerprint } from './runtime/canonical';
import { modelFact } from './model-memory';
import { visibleFact } from './memory-studio';

export function bindContextReadPlan(manifest: ContextManifest) {
  const required = new Set(manifest.requiredFactIds ?? []);
  const facts = [...manifest.hardConstraints ?? [], ...manifest.retrievedFacts ?? []];
  manifest.readPlan = {
    version: 1, scopeHash: fingerprint(manifest.scope),
    sources: manifest.sources.filter(s => s.required).map(s => ({ path: s.path, hash: s.hash, contentHash: hash(s.content), reason: s.reason })),
    facts: [...new Map(facts.filter(f => required.has(f.id) || manifest.hardConstraints?.some(h => h.id === f.id))
      .filter(f => !manifest.scope || manifest.scope.viewpoint === 'author' || f.kind === 'author_constraint' || visibleFact(f, manifest.scope))
      .map(f => [f.id, { id: f.id, hash: fingerprint(modelFact(f, manifest.scope)), label: `${f.subject}：${f.predicate}` }])).values()],
    observations: (manifest.entityIds ?? []).filter(entity => !facts.some(f => f.entityIds.includes(entity) &&
      (!manifest.scope || visibleFact(f, manifest.scope)) && (f.kind === 'state' || f.kind === 'belief' || f.characterLayer === 'current' || ['injury', 'item'].includes(f.category))))
      .map(entity => ({ label: entity, status: 'unknown', reason: '没有已确认的当下状态，保持未知，不补造经历或情绪' }))
  };
}

/** Must-run checks survive later trimming; optional experience pointers follow the kept facts. */
export function checkContextReadPlan(manifest: ContextManifest) {
  const plan = manifest.readPlan;
  if (!plan) return;
  if (plan.scopeHash !== fingerprint(manifest.scope)) throw new Error('必读资料的章节或知情范围已变化，请重新组装');
  for (const need of plan.sources) {
    const source = manifest.sources.find(s => s.path === need.path);
    if (!source || source.hash !== need.hash || !source.required ||
      (hash(source.content) !== need.contentHash && !(source.mode === 'full' && hash(source.content) === source.hash)))
      throw new Error(`必读资料未完整保留：${need.path}`);
  }
  const facts = new Map([...manifest.hardConstraints ?? [], ...manifest.retrievedFacts ?? []].map(f => [f.id, f]));
  for (const need of plan.facts) {
    const fact = facts.get(need.id);
    if (!fact || fingerprint(modelFact(fact, manifest.scope)) !== need.hash) throw new Error(`本章必读事实缺失或变化：${need.label}`);
  }
  const experience = manifest.writingMaterials?.focalExperience;
  if (experience) for (const key of ['currentStateIds', 'experienceIds', 'beliefIds'] as const)
    experience[key] = experience[key].filter(id => facts.has(id));
}

export function importantCurrentFact(fact: Fact) {
  return fact.state !== 'resolved' && (fact.mandatory || fact.kind === 'state' || fact.kind === 'belief' ||
    fact.characterLayer === 'current' || ['injury', 'item', 'promise'].includes(fact.category));
}
