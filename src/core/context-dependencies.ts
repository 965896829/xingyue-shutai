import type { ContextManifest } from '../shared/types';

export function contextDependencies(manifest: ContextManifest) {
  const evidence = [...(manifest.hardConstraints ?? []), ...(manifest.retrievedFacts ?? [])].flatMap(f => f.evidence);
  const hidden = (manifest.revelation?.withheld ?? []).flatMap(f => f.evidence);
  return [...new Map([...manifest.sources, ...evidence, ...hidden].map(s => [s.path + ':' + s.hash, { path: s.path, hash: s.hash }])).values()];
}
