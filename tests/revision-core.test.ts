import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { fixture } from './fixtures/workflow';
import { fixtureCoverage, fixtureAuditEvidence } from './fixtures/chapter-coverage';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { hash, prosePath, qualityPath, stageOutputs, updatePath } from '../src/core/domain';
import { proposalHash } from '../src/core/storage';
import { revisionCoreIssues } from '../src/core/workflows/revision-core';

test('旧章手写修改先保留候选，正文、独立审阅与批量人物覆盖同版采纳', async () => {
  let service: Service, requests = 0;
  service = new Service(path.resolve('resources/skill'), () => {}, async (_p, _system, messages) => {
    requests++;
    const input = JSON.parse(messages[0].content), store = service.store!, run = store.db.runs().find(r => r.status === 'running')!;
    if (input.items) return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '修订覆盖与当前完整正文一致。', evidence: fixtureAuditEvidence(item, input.sources) })) }));
    if (input.template) {
      const report = fixture({ ...store.db.project(), chapter: 1 }, qualityPath(1), service);
      return fakeResult(JSON.stringify({ report }));
    }
    assert.ok(input.schemas);
    const chapter = input.chapter;
    const scoped = { ...run, chapter, pipeline: { phase: 'memory' as const, proseHash: input.prose.hash, epoch: 'fixture', version: 1, previewCalls: 0, coverageVersion: 1 as const } };
    return fakeResult(JSON.stringify({ documents: [{ path: updatePath(chapter), content: fixture({ ...store.db.project(), chapter }, updatePath(chapter), service) }], facts: [], coverage: fixtureCoverage(service, scoped) }));
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 16000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('atomic-revision'), title: '旧章修订', premise: '阿宁求医', config: { defaultProfileId: fakeProfile.id, preview: { enabled: false } } });
    const store = service.store!;
    let project = store.db.project();
    for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'] as const) { store.commit(stageOutputs(stage, project).map(file => service.change(file, fixture(project, file, service))), project); project = store.db.project(); }
    const prose = fixture(project, prosePath(1), service);
    store.commit([service.change(prosePath(1), prose + '\n旧句。')], project);
    const sourceId = await service.invoke('document.save', { path: prosePath(1), content: prose, baseHash: hash(prose + '\n旧句。') });
    const source = store.db.run(sourceId);
    await assert.rejects(service.invoke('run.accept', { id: source.id, proposalHash: proposalHash(source) }), /阻断|核对/);
    const before = store.db.headRef()!.id;
    const id = await service.invoke('run.reviewProse', { id: source.id, proposalHash: proposalHash(store.db.run(source.id)), profileId: fakeProfile.id });
    for (let i = 0; i < 300; i++) { const r = store.db.run(id); if (r.revisionCore?.phase === 'ready' || ['failed', 'paused', 'unknown'].includes(r.status)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    const ready = store.db.run(id);
    assert.equal(ready.status, 'awaiting_review', ready.error ?? JSON.stringify(ready.issues));
    assert.equal(requests, 3); assert.equal(store.db.headRef()!.id, before); assert.deepEqual(revisionCoreIssues(store, ready), []);
    const changed = structuredClone(ready); changed.changes.find(c => c.path === prosePath(1))!.content += '\n另一个结局。';
    assert.equal(revisionCoreIssues(store, changed)[0].severity, 'error');
    await service.invoke('run.accept', { id, proposalHash: proposalHash(ready) });
    assert.equal(store.readAccepted(prosePath(1)).content, prose);
    assert.equal(store.db.run(id).revisionCore!.coverage[1].proseHash, hash(prose));
    assert.equal(store.db.project().chapter, 1);
    assert.equal((await service.invoke('quality.read')).evidence[0].editor, 'author');
  } finally { await service.drain(); }
});
