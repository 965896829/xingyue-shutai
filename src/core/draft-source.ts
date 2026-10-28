import type { FileStore } from './storage';
import type { SourceRef } from '../shared/studio';
import { hash } from './domain';

/** Read an exact version owned by this project's saved task. Never accepts arbitrary object hashes. */
export function draftSource(store: FileStore, source: SourceRef): string | undefined {
  for (const run of store.db.runs()) {
    const change = run.changes.find(change => change.path === source.path && hash(change.content) === source.hash);
    if (change && change.content.includes(source.quote)) return change.content;
  }
  return undefined;
}
