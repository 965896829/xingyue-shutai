import fs from 'node:fs';
import path from 'node:path';
import { FileStore } from '../../src/core/storage';
import { newProject, activeBatch, id, now } from '../../src/core/domain';
import { profileSchema, type Run, type ModelResult, type SecretProfile } from '../../src/shared/types';

export function isolatedRoot(name = 'fixture') {
  const base = path.resolve('.test-output/refactor/fixtures');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, name + '-'));
  if (!root.startsWith(base + path.sep)) throw new Error('测试路径越界');
  return root;
}
export const fakeProfile: SecretProfile = { ...profileSchema.parse({ id: 'offline', name: '离线夹具', protocol: 'chat', model: 'synthetic', baseUrl: 'http://127.0.0.1:1/v1', contextLimit: 100000, outputLimit: 128, inputPrice: 1, outputPrice: 1 }), apiKey: 'fixture-only-secret' };
export const fakeResult = (text = '离线结果'): ModelResult => ({ text, calls: [], native: { synthetic: true }, usage: { input: 10, output: 10, cost: 0.00002, currency: 'USD' }, stop: 'complete' });
export function refactorFixture() {
  const root = isolatedRoot();
  const store = new FileStore(root);
  const project = newProject('合成作品', root, { defaultProfileId: fakeProfile.id });
  store.commit([{ path: '正文.md', content: '原稿𠮷\r\n', baseHash: null }], project);
  const run: Run = { id: id(), projectId: project.id, executorId: 'legacy', executorVersion: '1', checkpointVersion: 1, candidateFormat: 2,
    skillId: 'webnovel-revision-cascade', mode: 'revision', stage: project.stage, chapter: project.chapter, batch: activeBatch(project), request: '合成测试',
    status: 'awaiting_review', profileId: fakeProfile.id, profileVersion: 1, createdAt: now(), updatedAt: now(), baseRevision: project.revision,
    baseSnapshotId: store.db.get('headSnapshot'), manifest: null, changes: [{ path: '正文.md', content: '候选稿', baseHash: store.db.document('正文.md')!.hash }],
    facts: [], issues: [], messages: [], responseText: '', rounds: 0, toolCount: 0, usage: { input: 0, output: 0, cost: 0, currency: 'USD' }, accepted: false, toolResults: {} };
  store.db.saveRun(run);
  return { root, store, project, run };
}
