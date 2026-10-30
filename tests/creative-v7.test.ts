import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { fixture } from './fixtures/workflow';
import { fixtureAuditEvidence, fixtureCoverage } from './fixtures/chapter-coverage';
import { stageOutputs, qualityPath } from '../src/core/domain';
import { proposalHash } from '../src/core/storage';
import { compileCreative } from '../src/core/creative-context';
import { parseCreativeResult } from '../src/core/workflows/creative';
import { bindWorkflow } from '../src/core/runtime/workflow-contract';
import { attempts } from '../src/core/runtime/model-gateway';
import { factSchema } from '../src/shared/types';
import { hash, paths, prosePath } from '../src/core/domain';
import { encodeFacts } from '../src/core/memory-records';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';

const rules = path.resolve('resources/skill');
const readerInput = {
  operation: 'first-read' as const,
  throughChapter: 1,
  end: 6,
  displayedTitle: '',
  displayedDescription: ''
};

test('V7 整请求首读隔离：正文截止、原生历史、缓存身份和恢复均不继承作者资料', async () => {
  let requests = 0;
  const sent: string[] = [],
    cacheKeys: string[] = [];
  const service = new Service(
    rules,
    () => {},
    async (_profile, system, messages, tools, _signal, _delta, options) => {
      requests++;
      assert.equal(tools.length, 0);
      assert.equal(messages.length, 1);
      const payload = JSON.parse(messages[0].content);
      assert.equal(payload.documents[0].text, '阿宁推开门。');
      const wire = JSON.stringify({ system, messages, tools, options });
      sent.push(wire);
      assert.doesNotMatch(wire, /AUTHOR_SECRET|FUTURE_CANARY|NATIVE_CANARY|privateProof|snapshotId/);
      cacheKeys.push(options!.promptCacheKey!);
      return fakeResult(
        JSON.stringify({
          summary: '门后仍是疑问。',
          observations: [{ source: 'chapter-1', quote: '推开门', comment: '期待看到门后的情况。' }]
        })
      );
    }
  );
  service.profiles = [{ ...fakeProfile, contextLimit: 100000, tools: false }];
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('creative-read'),
      title: 'AUTHOR_SECRET',
      premise: 'AUTHOR_SECRET',
      config: { defaultProfileId: fakeProfile.id, constraints: 'AUTHOR_SECRET' }
    });
    const store = service.store!,
      project = store.db.project();
    store.commit(
      [
        {
          path: prosePath(1),
          content: '阿宁推开门。FUTURE_CANARY',
          baseHash: store.db.document(prosePath(1))?.hash ?? null
        },
        {
          path: prosePath(2),
          content: 'FUTURE_CANARY',
          baseHash: store.db.document(prosePath(2))?.hash ?? null
        }
      ],
      project
    );
    const make = () => {
      const run = service.makeRun('analysis', 'AUTHOR_SECRET', fakeProfile.id);
      run.creative = compileCreative(store, rules, readerInput, run.id).binding;
      run.tagBinding = undefined;
      run.workflowVersion = 1;
      bindWorkflow(run);
      run.messages = [
        { role: 'assistant', content: 'AUTHOR_SECRET', native: [{ content: 'NATIVE_CANARY' }] }
      ];
      store.db.saveRun(run);
      return run;
    };
    const first = make();
    const snapshot = store.db.headRef()!.id;
    await service.runner!.drive(first.id);
    let saved = store.db.run(first.id);
    assert.equal(saved.status, 'complete', saved.error ?? '');
    assert.equal(saved.creative!.result!.synthetic, true);
    assert.equal(store.db.headRef()!.id, snapshot);
    assert.equal(attempts(store, first.id).length, 1);
    saved.status = 'paused';
    saved.creative!.result = undefined;
    store.db.sql.prepare('UPDATE runs SET data=? WHERE id=?').run(JSON.stringify(saved), saved.id);
    await service.runner!.drive(first.id);
    assert.equal(store.db.run(first.id).status, 'complete');
    assert.equal(requests, 1, '已收到的完整回执恢复时只本地校验');
    const second = make();
    await service.runner!.drive(second.id);
    assert.equal(requests, 2);
    assert.notEqual(cacheKeys[0], cacheKeys[1]);
    await assert.rejects(
      service.invoke('run.accept', { id: second.id, proposalHash: 'forged' }),
      /草稿|候选/
    );
    assert.equal(sent.length, 2);
  } finally {
    await service.drain();
  }
});

test('V7 人物试演只编译角色持有的信念，证据中的作者真相和未来信息不出站', () => {
  const { store, run } = refactorFixture();
  try {
    const prose = '阿宁认为木匣还在屋内。AUTHOR_SECRET：木匣已经被移走。';
    const fact = factSchema.parse({
      id: 'belief',
      subject: '阿宁',
      predicate: '认为',
      value: '木匣还在屋内',
      entityIds: ['CH1'],
      kind: 'belief',
      category: 'knowledge',
      fromChapter: 1,
      revealedAt: 1,
      reviewStatus: 'accepted',
      knowledge: [{ who: 'CH1', fromChapter: 1, mode: 'misunderstood' }],
      evidence: [{ path: prosePath(1), hash: hash(prose), quote: prose }]
    });
    const truth = factSchema.parse({
      ...fact,
      id: 'truth',
      kind: 'event',
      value: 'AUTHOR_SECRET',
      subject: '木匣',
      entityIds: ['ITEM1']
    });
    store.commit(
      [
        { path: prosePath(1), content: prose, baseHash: null },
        { path: paths.knowledge, content: encodeFacts('# 知情', [fact, truth]), baseHash: null }
      ],
      store.db.project()
    );
    const compiled = compileCreative(
      store,
      rules,
      { operation: 'rehearse', characterId: 'CH1', chapter: 1, observations: '门外传来脚步声。' },
      run.id
    );
    const wire = JSON.stringify({ system: compiled.system, payload: compiled.modelPayload });
    assert.match(wire, /木匣还在屋内/);
    assert.doesNotMatch(wire, /AUTHOR_SECRET|misunderstood|reviewStatus|evidence|snapshotId/);
    assert.equal((compiled.modelPayload as { beliefs: unknown[] }).beliefs.length, 1);
    assert.throws(
      () =>
        compileCreative(
          store,
          rules,
          { operation: 'rehearse', characterId: 'CH2', chapter: 1, observations: '门响了。' },
          run.id
        ),
      /知情记录/
    );
  } finally {
    store.close();
  }
});

test('V7 首读拒绝越界引文、缺失章节和不存在的截止位置', () => {
  const { store, run } = refactorFixture();
  try {
    store.commit([{ path: prosePath(1), content: '阿宁推开门。秘密', baseHash: null }], store.db.project());
    const packet = compileCreative(store, rules, readerInput, run.id);
    assert.throws(
      () =>
        parseCreativeResult(
          packet.binding,
          JSON.stringify({
            summary: '发现秘密',
            observations: [{ source: 'chapter-1', quote: '秘密', comment: '越界' }]
          }),
          packet.modelPayload
        ),
      /范围外/
    );
    assert.throws(
      () => compileCreative(store, rules, { ...readerInput, throughChapter: 2 }, run.id),
      /尚未保存/
    );
    assert.throws(() => compileCreative(store, rules, { ...readerInput, end: 999 }, run.id), /截止位置/);
  } finally {
    store.close();
  }
});

test('V7 空作品探索使用现有命令回执，只保存草稿且重复点击只发一次请求', async () => {
  let requests = 0;
  const service = new Service(
    rules,
    () => {},
    async () => {
      requests++;
      return fakeResult(
        JSON.stringify({ prose: '修理工蹲下来，听见墙里传来敲击。', assumptions: ['墙后有人回应'] })
      );
    }
  );
  service.profiles = [fakeProfile];
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('creative-explore'),
      premise: '探索一个敲门场景',
      config: { defaultProfileId: fakeProfile.id }
    });
    const snapshot = service.store!.db.headRef()!.id;
    const args = {
      input: { operation: 'explore' as const, prompt: '试写修理工发现敲击声的短场景', sources: [] },
      profileId: fakeProfile.id
    };
    const options = { operationId: 'creative-double-click' };
    const key = await service.invoke('creative.run', args, options);
    assert.equal(await service.invoke('creative.run', args, options), key);
    for (let index = 0; index < 100 && service.store!.db.run(key).status !== 'complete'; index++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const run = service.store!.db.run(key);
    assert.equal(run.status, 'complete', run.error ?? '');
    assert.equal(requests, 1);
    assert.equal(service.store!.db.headRef()!.id, snapshot);
    const draft = service.chat!.records.readDraft(run.creative!.result!.draftId!);
    assert.match(draft.content, /修理工/);
    assert.equal(run.changes.length, 0);
    assert.equal(run.facts.length, 0);
    assert.equal(run.workflowBinding!.registry, 'creative-v7-v1');
    await assert.rejects(service.invoke('draft.chapter', { id: draft.id, hash: draft.currentHash, profileId: fakeProfile.id }), /正文写作阶段/);
  } finally {
    await service.drain();
  }
});

test('V7 探索草稿进入当前章审稿与记忆链，最终正文及覆盖同版采纳', async () => {
  let service: Service, requests = 0;
  service = new Service(rules, () => {}, async (_profile, _system, messages, tools) => {
    requests++;
    const project = service.store!.db.project();
    const run = service.store!.db.runs().find(run => run.status === 'running')!;
    if (run.creative) return fakeResult(JSON.stringify({ prose: fixture(project, prosePath(project.chapter), service), assumptions: [] }));
    const input = JSON.parse(messages[0].content);
    if (input.items) {
      const memory = { decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '合成样稿覆盖与原文一致。', evidence: fixtureAuditEvidence(item, input.sources) })) };
      const plans = { decisions: (input.plans ?? []).map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '合成计划与本章一致。', planQuote: input.sources.find((source: any) => source.path === plan.path).content.slice(0, 30), proseQuote: input.sources.find((source: any) => source.path === input.prose.path).content.slice(0, 30) })) };
      return fakeResult(JSON.stringify(input.plans ? { memory, plans } : memory));
    }
    assert.ok(tools.length, '导入草稿后不重新生成正文');
    const memory = run.pipeline!.phase === 'memory';
    const changes = (memory ? stageOutputs('S11', project) : [qualityPath(project.chapter)]).map(file => service.change(file, fixture(project, file, service)));
    return { ...fakeResult(''), stop: 'tools' as const, calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes, ...(memory ? { facts: [], complete: true, coverage: fixtureCoverage(service, run) } : {}) }) }] };
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 32768 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('creative-chapter'), title: '草稿转章', premise: '阿宁调查停电原因', config: { defaultProfileId: fakeProfile.id, maxRounds: 12, maxTools: 64, preview: { enabled: false } } });
    let project = service.store!.db.project();
    for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'] as const) {
      service.store!.commit(stageOutputs(stage, project).map(file => service.change(file, fixture(project, file, service))), project);
      project = service.store!.db.project();
    }
    project.stage = 'S10'; service.store!.db.set('project', project);
    const wait = async (key: string) => {
      for (let index = 0; index < 200; index++) {
        if (!['running', 'awaiting_review'].includes(service.store!.db.run(key).status) || service.store!.db.run(key).pipeline?.phase === 'ready') break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return service.store!.db.run(key);
    };
    const exploreId = await service.invoke('creative.run', { input: { operation: 'explore', prompt: '试写阿宁求医的本章场景', sources: [] }, profileId: fakeProfile.id });
    const explored = await wait(exploreId);
    assert.equal(explored.status, 'complete', explored.error ?? '');
    const draft = service.chat!.records.readDraft(explored.creative!.result!.draftId!);
    const head = service.store!.db.headRef()!.id;
    const args = { id: draft.id, hash: draft.currentHash, profileId: fakeProfile.id };
    await assert.rejects(service.invoke('draft.chapter', { ...args, hash: 'obsolete-draft' }), /草稿已变化/);
    const id = await service.invoke('draft.chapter', args, { operationId: 'draft-merge-once' });
    assert.equal(await service.invoke('draft.chapter', args, { operationId: 'draft-merge-once' }), id);
    const ready = await wait(id);
    assert.equal(ready.status, 'awaiting_review', ready.error ?? JSON.stringify(ready.issues));
    assert.equal(ready.pipeline!.phase, 'ready');
    assert.equal(ready.chapterCoverage!.proseHash, hash(draft.content));
    assert.equal(ready.changes.find(change => change.path === prosePath(1))!.content, draft.content);
    assert.equal(service.store!.db.headRef()!.id, head);
    await service.invoke('run.accept', { id, proposalHash: proposalHash(ready), startNext: false, warningReason: '离线样稿核对' });
    assert.equal(service.store!.readAccepted(prosePath(1)).hash, ready.chapterCoverage!.proseHash);
    assert.equal(service.store!.db.run(id).accepted, true);
    assert.equal(requests, 4);
  } finally { await service.drain(); }
});

test('V7 探索停止后的迟到结果不保存草稿，显式恢复复用回执且不重发', async () => {
  let entered!: () => void,
    release!: () => void,
    requests = 0;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new Service(
    rules,
    () => {},
    async () => {
      requests++;
      entered();
      await waiting;
      return fakeResult(JSON.stringify({ prose: '门内传来敲击声。', assumptions: [] }));
    }
  );
  service.profiles = [fakeProfile];
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('creative-cancel'),
      premise: '试写门内的声音',
      config: { defaultProfileId: fakeProfile.id }
    });
    const snapshot = service.store!.db.headRef()!.id;
    const key = await service.invoke('creative.run', {
      input: { operation: 'explore', prompt: '写一个短场景', sources: [] },
      profileId: fakeProfile.id
    });
    await started;
    await service.invoke('run.cancel', {});
    release();
    while (service.runner!.controller) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(service.store!.db.run(key).creative!.result, undefined);
    assert.equal(service.chat!.records.all('draft_artifacts').length, 0);
    assert.equal(service.store!.db.headRef()!.id, snapshot);
    assert.equal(attempts(service.store!, key)[0].status, 'complete');
    assert.equal(await service.invoke('run.recover', { id: key, retryUnknown: true }), key);
    for (let index = 0; index < 100 && service.store!.db.run(key).status !== 'complete'; index++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const saved = service.store!.db.run(key);
    assert.equal(saved.status, 'complete', saved.error ?? '');
    assert.equal(requests, 1);
    assert.equal(service.chat!.records.all('draft_artifacts').length, 1);
    assert.equal(service.store!.db.headRef()!.id, snapshot);
  } finally {
    release();
    await service.drain();
  }
});
