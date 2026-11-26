import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Service } from '../src/core/service';
import { hash, paths, prosePath, qualityPath, stageOutputs } from '../src/core/domain';
import { proposalHash } from '../src/core/storage';
import { fixture, sampleProse } from './fixtures/workflow';
import { fixtureCoverage, fixtureAuditEvidence } from './fixtures/chapter-coverage';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';

const rules = path.resolve('resources/skill');
test('轻量作品可在写作后离线补填书名，重复保存沿用同一版本', async () => {
  const service = new Service(rules, () => {});
  try {
    await service.invoke('project.create', { parent: isolatedRoot('later-title'), premise: '摆渡人接到了过去的船票', quickWriting: true });
    const store = service.store!, config = store.db.project().config;
    assert.equal(store.db.project().titlePending, true);
    const input = { config, firstTitle: '昨夜的末班船' };
    await service.invoke('project.configure', input);
    const saved = store.db.project();
    assert.equal(saved.title, input.firstTitle);
    assert.equal(saved.titlePending, false);
    assert.ok(store.readAccepted(paths.index).content.includes(input.firstTitle));
    assert.ok(store.readAccepted(paths.config).content.includes(input.firstTitle));
    await service.invoke('project.configure', input);
    assert.equal(store.db.project().revision, saved.revision);
    await assert.rejects(service.invoke('project.configure', { config, firstTitle: '另一个名字' }), /命名流程/);
  } finally { await service.drain(); }
});

async function idle(service: Service) {
  for (let i = 0; i < 2000; i++) {
    if (!service.scheduler.pending && !service.scheduler.running && !service.chat?.controller && !service.runner?.controller) return;
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  throw new Error('合成写作任务未结束');
}
async function book(service: Service, quickWriting = false) {
  return service.invoke('project.create', { parent: isolatedRoot('writing-path'), title: '玻璃诊室', premise: '阿宁想取回诊室里的旧记录。',
    ...(quickWriting ? { quickWriting: true } : {}), config: { defaultProfileId: fakeProfile.id, maxTools: 64, maxRounds: 20, preview: { enabled: false } } });
}

test('短笔记各自核对，索引故障、重复点击和重启后只有一份正式结果', async () => {
  const service = new Service(rules, () => {}, async () => { throw new Error('意外模型请求'); });
  try {
    const created = await book(service), store = service.store!;
    const note = (file: string, content: string) => service.invoke('document.save', { path: file, content, baseHash: null });
    const place = await note('地点.md', '诊室在二楼。'), item = await note('道具.md', '阿宁是左撇子。'), competing = await note('道具.md', '门匙在右边。');
    const accept = (id: string) => ({ id, proposalHash: proposalHash(store.db.run(id)) });
    store.db.sql.exec("CREATE TRIGGER writing_test_fault BEFORE INSERT ON kv WHEN NEW.key='memoryDiagnostics' BEGIN SELECT RAISE(ABORT,'offline index'); END");
    store.db.sql.exec("CREATE TRIGGER writing_search_fault BEFORE INSERT ON document_fts_rows BEGIN SELECT RAISE(ABORT,'offline search'); END");
    const args = accept(place), options = { operationId: 'accepted-once' };
    const [first, second] = await Promise.all([service.invoke('run.accept', args, options), service.invoke('run.accept', args, options)]);
    assert.equal(first.accepted, true);
    assert.ok(first.pending?.includes('记忆索引'));
    assert.ok(first.pending?.includes('文稿检索与编辑记录'));
    assert.deepEqual(first, second);
    assert.equal(first.revision, created.project!.revision + 1);
    assert.equal(first.proposalHash, args.proposalHash);
    assert.equal(store.readAccepted('地点.md').content, '诊室在二楼。');
    assert.equal(store.db.sql.prepare('SELECT count(*) AS n FROM candidate_commits WHERE run_id=?').get(place)!.n, 1);
    await service.invoke('run.accept', accept(item));
    await assert.rejects(service.invoke('run.accept', accept(competing)), /已改变|已变化|过期|冲突/);
    assert.equal(store.readAccepted('道具.md').content, '阿宁是左撇子。');
    const diagnostic = await service.invoke('diagnostics.export');
    assert.doesNotMatch(diagnostic, /阿宁是左撇子|玻璃诊室|门匙在右边|fixture-only-secret/);
    const failure = JSON.parse(diagnostic).failures.find((f: { action: string }) => f.action === 'run.accept');
    assert.equal(failure.nextStep, 'local'); assert.equal(failure.modelRequest, 'not_sent');
    store.db.sql.exec('DROP TRIGGER writing_test_fault; DROP TRIGGER writing_search_fault');
    const root = store.root;
    await service.invoke('project.close');
    const reopened = await service.invoke('project.open', { root });
    assert.deepEqual(reopened.studio?.pendingIndexes, []);
    assert.equal(service.store!.db.sql.prepare('SELECT hash FROM document_fts_rows WHERE path=?').get('道具.md')?.hash, hash('阿宁是左撇子。'));
    assert.deepEqual(await service.invoke('run.accept', args, options), first);
    assert.equal(reopened.project!.revision, created.project!.revision + 2);
  } finally { await service.drain(); }
});

test('99、100、101 条手工候选均不能挤掉旧阶段，重启与草稿转章仍能找到原任务', async () => {
  const service = new Service(rules, () => {});
  service.profiles = [fakeProfile];
  try {
    await book(service, true);
    const store = service.store!, task = service.makeRun('stage', '等待审核的原稿');
    task.status = 'paused'; store.db.saveRun(task);
    const records = service.chat!.records, chat = records.create('草稿测试', false);
    const message = records.save('conversation_messages', { id: crypto.randomUUID(), conversationId: chat.id, turnId: '', role: 'assistant',
      content: sampleProse(), status: 'complete', createdAt: new Date().toISOString(), citations: [] });
    const draft = records.saveDraft({ title: '场景', conversationId: chat.id, messageId: message.id, content: message.content });
    for (let n = 1; n <= 101; n++) {
      await service.invoke('document.save', { path: '地点.md', content: '第' + n + '条笔记', baseHash: null });
      if (n >= 99) {
        await assert.rejects(service.invoke('run.start', { request: '继续本章' }), /已有阶段任务/);
        await assert.rejects(service.invoke('draft.chapter', { id: draft.id, hash: draft.hash, profileId: fakeProfile.id }), /已有阶段任务/);
      }
    }
    const root = store.root;
    await service.invoke('project.close');
    const reopened = await service.invoke('project.open', { root });
    assert.ok(reopened.runs.some(run => run.id === task.id));
    await assert.rejects(service.invoke('run.start', { request: '重启后继续' }), /已有阶段任务/);
    assert.equal(service.store!.db.pendingRuns('stage', task).length, 1);
  } finally { await service.drain(); }
});

test('一个开篇设定、试写、改稿、历史选稿、同版核验、下一章按需使用各角色', async () => {
  const writer = { ...fakeProfile, tools: false, outputLimit: 8192, contextLimit: 300000 };
  const reviewer = { ...writer, id: 'review', tools: true, enabled: false };
  const extractor = { ...reviewer, id: 'extract' };
  const manuscript = sampleProse(), direction = '阿宁想取回被扣下的记录，医生只肯让他在关灯前看一眼。';
  let drafts = 0, proseCalls = 0;
  let service: Service;
  service = new Service(rules, () => {}, async (profile, system, messages, tools) => {
    if (profile.id === writer.id && service.chat!.controller) {
      assert.equal(tools.length, 0);
      if (++drafts === 1) { assert.match(system, /只给这一个方向/); return fakeResult(direction); }
      const input = JSON.parse(messages.at(-1)!.content);
      if (drafts === 2) { assert.equal(input.selectedDraft, direction); return fakeResult(manuscript); }
      assert.equal(input.selectedDraft, manuscript);
      return fakeResult(manuscript + '\n她侧过脸。');
    }
    const p = service.store!.db.project(), run = service.store!.db.pendingRuns('running')[0];
    const input = JSON.parse(messages[0].content);
    if (input.items) {
      const memory = { decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '合成资料与本章一致。', evidence: fixtureAuditEvidence(item,input.sources) })) };
      const plans = { decisions: (input.plans ?? []).map((plan: any) => ({ path: plan.path, verdict:'consistent', reason:'计划与本章一致。', planQuote:input.sources.find((s:any) => s.path===plan.path).content.slice(0,30), proseQuote:input.sources.find((s:any)=>s.path===input.prose.path).content.slice(0,30) })) };
      return fakeResult(JSON.stringify(input.plans ? { memory, plans } : memory));
    }
    if (!tools.length) { proseCalls++; return fakeResult(manuscript); }
    const memory = run.pipeline!.phase === 'memory';
    const changes = (memory ? stageOutputs('S11', p) : [qualityPath(p.chapter)]).map(file => {
      let content = fixture(p, file, service);
      if (memory && file.startsWith('04_')) {
        const original = service.store!.readAccepted(file).content;
        content = file === paths.behavior ? original + '\n\n' + content : original;
      }
      return service.change(file, content);
    });
    return { ...fakeResult(''), stop: 'tools', calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes, ...(memory ? { facts: [], complete: true, coverage: fixtureCoverage(service,run) } : {}) }) }] };
  });
  service.profiles = [writer,reviewer,extractor];
  try {
    await book(service, true);
    const store = service.store!, records = service.chat!.records;
    await service.invoke('project.configure', { config: { ...store.db.project().config, modelRouting: { ...store.db.project().config.modelRouting, writing: writer.id, review: reviewer.id, extraction: extractor.id } } });
    const start = async (kind: 'direction' | 'scene' | 'revise', request: string, source?: {id:string;hash:string}) => {
      const args = { kind, request, profileId: writer.id, source }, opts = { operationId: 'trial-'+kind };
      const reply = await service.invoke('draft.write', args, opts);
      assert.deepEqual(await service.invoke('draft.write', args, opts), reply);
      await idle(service);
      const turn = records.get('conversation_turns', reply.id);
      assert.equal(turn.status, 'complete', turn.error ?? '');
      assert.ok(turn.savedDraftId);
      return records.readDraft(turn.savedDraftId, turn.savedDraftHash);
    };
    const idea = await start('direction', '从玻璃诊室开始');
    const scene = await start('scene', '写一场', { id: idea.id, hash: idea.hash });
    const revision = await start('revise', '结尾改成一个动作', { id: scene.id, hash: scene.hash });
    assert.deepEqual(revision.parent, { id: scene.id, hash: scene.hash });
    assert.equal(drafts, 3);
    records.saveDraft({ ...scene, content: revision.content, baseHash: scene.hash });
    const id = await service.invoke('draft.chapter', { id: scene.id, hash: scene.hash, profileId: writer.id });
    await idle(service);
    let run = store.db.run(id);
    assert.equal(run.changes[0].content, manuscript);
    assert.match(run.error ?? '', /正文已保存.*审稿/);
    reviewer.enabled = true;
    await service.invoke('run.recover', { id }); await idle(service);
    run = store.db.run(id);
    assert.match(run.error ?? '', /正文已保存.*记忆提取/);
    assert.equal(run.pipeline?.proseHash, scene.hash);
    extractor.enabled = true;
    await service.invoke('run.recover', { id }); await idle(service);
    run = store.db.run(id);
    assert.equal(run.pipeline?.phase, 'ready', run.error ?? JSON.stringify(run.issues));
    const replay = await service.invoke('run.update', { id, path: prosePath(1), content: manuscript, expectedHash: hash('较早发出的保存请求') });
    assert.equal(replay.stateVersion, run.stateVersion);
    assert.deepEqual(replay.chapterCoverage, run.chapterCoverage);
    assert.deepEqual(replay.memoryReview, run.memoryReview);
    const accepted = await service.invoke('run.accept', { id, proposalHash: proposalHash(run) });
    assert.ok(accepted.accepted);
    assert.equal(store.readAccepted(prosePath(1)).content, manuscript);
    assert.equal(store.db.project().stage, 'S10');
    assert.equal(store.db.project().chapter, 2);
    assert.equal(proseCalls, 0);
    reviewer.enabled = false;
    const second = await service.invoke('run.start', { request: '承接诊室里的动作写第 2 章' });
    await idle(service);
    assert.equal(proseCalls, 1);
    assert.equal(store.db.run(second).pipeline?.proseHash, hash(manuscript));
    assert.match(store.db.run(second).error ?? '', /正文已保存.*审稿/);
  } finally { await service.drain(); }
});
