import type { ContextManifest } from '../shared/types';
import { hash } from './domain';
import type { FileStore } from './storage';
import { retrieveMemory } from './memory-studio';
export { decodeFacts, encodeFacts, primaryPath, validateEvidence, rebuildMemory } from './memory-records';
export { assembleContext } from './context-compiler';

export function searchMemory(store: FileStore, query: string, chapter: number, limit = 20) {
  const result = retrieveMemory(store, query, { chapter, projectId: store.db.project().id }, limit);
  return { ...result, indexRevision: store.db.get<number>('indexRevision'), note: '未命中不代表事实不存在；角色认知、计划和客观事件需分别使用。' };
}
export const manifestHash = (m: ContextManifest) => hash(JSON.stringify([m.sources.map(s => [s.path,s.hash,s.mode,s.ranges]), m.hardConstraints?.map(f => f.id), m.revelation, m.scope]));
