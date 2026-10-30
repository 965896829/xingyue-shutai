import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import { designCatalog, designResource, designSpec, bindDesign, assertDesign, designPrompt } from '../src/core/design-operations';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { hash, paths, prosePath } from '../src/core/domain';
import { proposalHash } from '../src/core/storage';
import { bindWorkflow } from '../src/core/runtime/workflow-contract';
import { locateCoverageQuotes, validateChapterCoverage } from '../src/core/chapter-memory';
import { encodeFacts, rebuildMemory } from '../src/core/memory-records';
import { factSchema } from '../src/shared/types';
import { readQuality, mutateQuality, storeLearnedPreferences } from '../src/core/quality';
import { readExperience } from '../src/core/experience';
import { compileCreative } from '../src/core/creative-context';
import { applyRevisionMemoryRepair } from '../src/core/workflows/revision-core';

const root = path.resolve('resources/skill');
test('全部设计能力具有宿主处理器、选定资源和具体输入输出边界', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'creative-v7/catalog.json'), 'utf8'));
  assert.equal(catalog.operations.length, 48);
  assert.equal(catalog.operations.filter((entry: any) => entry.adapter === 'creative-v7-v1').length, 7);
  const entries = designCatalog(root);
  assert.equal(entries.length, 41);
  for (const entry of entries) {
    assert.ok(designSpec(entry.id));
    assert.ok(designResource(root, entry.id).content.length > 50);
  }
  const { store, run } = refactorFixture();
  try {
    run.changes = [];
    bindDesign(store, root, run, { id: 'co-creation.propose', request: '只改选中稿件', sources: [], targets: ['正文.md'] });
    run.workflowVersion = 1; bindWorkflow(run);
    assert.equal(run.workflowBinding!.registry, 'scoped-design-v1');
    const fingerprint = proposalHash(run);
    assert.match(designPrompt(store, root, run), /原稿𠮷/);
    assert.throws(() => assertDesign(store, run, [{ path: paths.roles, content: '越界', baseHash: null }]), /范围/);
    run.design!.targets.push({ path: '其他.md', hash: null });
    assert.notEqual(proposalHash(run), fingerprint);
    store.commit([{ path: '正文.md', content: '新版本', baseHash: store.db.document('正文.md')!.hash }], store.db.project());
    assert.throws(() => designPrompt(store, root, run), /已改变/);
  } finally { store.close(); }
});

test('新操作通过原执行器保存候选，接受前无正式写入且不推进阶段', async () => {
  let service: Service, calls = 0;
  service = new Service(root, () => {}, async (_profile, system) => {
    calls++;
    assert.match(system, /宿主执行合同/);
    const run = service.store!.db.runs().find(r => r.status === 'running')!;
    return { ...fakeResult(''), calls: [{ id: `submit-${calls}`, name: 'propose_changes', arguments: JSON.stringify({ changes: [{ path: run.design!.targets[0].path, baseHash: null, content: '# 比较结果\n\n当前材料没有可确认的矛盾，后续情节保持未知。' }] }) }] };
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 4000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('design-adapter'), title: '范围验收', premise: '现实生活', config: { defaultProfileId: fakeProfile.id, maxRounds: 1 } });
    const store = service.store!, baseline = store.db.headRef()!.id;
    const id = await service.invoke('design.run', { input: { id: 'co-creation.compare', request: '比较已给资料' }, profileId: fakeProfile.id });
    for (let i = 0; i < 150 && service.runner!.controller; i++) await new Promise(resolve => setTimeout(resolve, 20));
    const run = store.db.run(id);
    assert.equal(run.status, 'awaiting_review', run.error ?? JSON.stringify(run.issues));
    assert.equal(calls, 1); assert.equal(store.db.headRef()!.id, baseline);
    await service.invoke('run.accept', { id, proposalHash: proposalHash(run) });
    assert.match(store.readAccepted(run.design!.targets[0].path).content, /比较结果/);
    assert.equal(store.db.project().stage, 'S01');
    assert.equal(store.db.project().chapter, 1);
  } finally { await service.drain(); }
});

test('唯一引文可本地定位码点，歧义与错误版本不能被自动修复', () => {
  const { store, run } = refactorFixture();
  try {
    const text = '开门𠮷。阿宁在门口等候。重复。重复。';
    run.changes = [{ path: prosePath(1), content: text, baseHash: null }];
    run.pipeline = { phase: 'memory', proseHash: hash(text), epoch: run.id, version: 1, previewCalls: 0, coverageVersion: 1 };
    const coverage = { schemaVersion: 1, proseHash: hash(text), characters: [{ entityId: 'AN', name: '阿宁', outcome: 'reviewed_no_change', reason: '没有明确状态变化', factIds: [], evidence: [{ quote: '阿宁在门口等候。', start: 0, end: 8 }] }] };
    assert.throws(() => validateChapterCoverage(store, run, coverage), /坐标/);
    const located = locateCoverageQuotes(run, coverage);
    assert.equal(located.characters[0].evidence[0].start, 4);
    assert.doesNotThrow(() => validateChapterCoverage(store, run, located));
    const ambiguous = structuredClone(coverage); ambiguous.characters[0].evidence[0] = { quote: '重复。', start: 0, end: 3 };
    assert.throws(() => validateChapterCoverage(store, run, locateCoverageQuotes(run, ambiguous)), /坐标/);
    assert.throws(() => validateChapterCoverage(store, run, locateCoverageQuotes(run, { ...coverage, proseHash: hash('其他') })), /版本/);
  } finally { store.close(); }
});

test('旧事实补齐码点后增量与完整重建相同，可选学习记录损坏不阻止正文保存', () => {
  const { store } = refactorFixture();
  try {
    const file = prosePath(1), text = '阿宁𠮷拿着木匣。';
    const fact = factSchema.parse({ id: 'unicode-evidence', subject: '阿宁', predicate: '持有', value: '木匣', reviewStatus: 'accepted', kind: 'event', category: 'character', fromChapter: 1, revealedAt: 1, evidence: [{ path: file, hash: hash(text), quote: '𠮷' }] });
    store.commit([{ path: file, content: text, baseHash: null }, { path: paths.roles, content: encodeFacts('# 人物', [fact]), baseHash: null }], store.db.project());
    const incremental = store.db.facts();
    assert.equal(incremental[0].evidence[0].start, 2);
    rebuildMemory(store); assert.deepEqual(store.db.facts(), incremental);
    store.db.set('creative-quality-v1', { damaged: true });
    store.commit([{ path: file, content: text + '他放下木匣。', baseHash: hash(text) }], store.db.project());
    assert.match(store.readAccepted(file).content, /放下木匣/);
    assert.doesNotThrow(() => readExperience(store, 1));
    assert.deepEqual(store.db.get('creative-quality-v1'), { damaged: true });
  } finally { store.close(); }
});

test('实验预登记隔离保留族并绑定预算，来源未知不声称提前生成', () => {
  const { store, run } = refactorFixture();
  try {
    const specification = { title: '同剧情表达', kind: 'voice_fixed_story', stage: 'holdout', family: '独立族', sceneFunction: '对话', audience: '读者', variedFactors: ['voice'], constraints: '门始终未开', questions: ['更愿读哪篇'] };
    const state = mutateQuality(store, 0, { kind: 'protocol', protocol: { ...specification, maxCalls: 2, comparisonRule: '按参与者分组', exclusionRule: '不丢弃平局与弃权' } });
    assert.throws(() => mutateQuality(store, state.revision, { kind: 'protocol', protocol: { ...state.protocols[0], stage: 'development' } }));
    const protocolId = state.protocols[0].id;
    const next = mutateQuality(store, state.revision, { kind: 'experiment', experiment: { ...specification, protocolId }, candidates: [{ text: '甲站在门外' }, { text: '甲等到天亮' }] });
    assert.equal(next.experiments[0].preregistered, false);
    const compiled = compileCreative(store, root, { operation: 'explore', prompt: '门外等候', protocolId, sources: [] }, run.id);
    assert.match(JSON.stringify(compiled.modelPayload), /门始终未开/);
    assert.equal(readQuality(store).protocols[0].maxCalls, 2);
  } finally { store.close(); }
});

test('定向记忆修复冻结正文与未被否定事实，非法输出无部分写入', () => {
  const { store, run } = refactorFixture();
  try {
    const prose = '阿宁站在门口，值守人员走过来。';
    run.changes = [{ path: prosePath(1), content: prose, baseHash: null }];
    run.revisionCore = { version: 1, sourceRunId: run.id, chapters: [1], proseHashes: { 1: hash(prose) }, coverage: {}, reports: {}, phase: 'review' };
    const fact = factSchema.parse({ id: 'AN-position', subject: '阿宁', predicate: '位置', value: '门口', entityIds: ['AN'], category: 'character', kind: 'event', fromChapter: 1, revealedAt: 1, evidence: [{ path: prosePath(1), hash: hash(prose), quote: '阿宁站在门口' }] });
    run.facts = [fact];
    const result = { documents: [], facts: [fact], coverages: [{ chapter: 1, coverage: { schemaVersion: 1, proseHash: hash(prose), characters: [{ entityId: 'AN', name: '阿宁', outcome: 'changed', reason: '当前位置有原文依据', factIds: [fact.id], evidence: [{ quote: prose, start: 0, end: Array.from(prose).length }] }] } }] };
    const before = JSON.stringify(run);
    assert.throws(() => applyRevisionMemoryRepair(store, run, { ...result, documents: [{ path: prosePath(1), content: '改写结局' }] }), /范围/);
    assert.throws(() => applyRevisionMemoryRepair(store, run, { ...result, facts: [{ ...fact, value: '远处' }] }), /未被否定/);
    assert.equal(JSON.stringify(run), before);
    applyRevisionMemoryRepair(store, run, result);
    assert.equal(run.changes[0].content, prose);
  } finally { store.close(); }
});

test('实验预算跨任务计数，分支历史合并进入候选且只读投影不调用模型', async () => {
  let calls = 0;
  const service = new Service(root, () => {}, async () => fakeResult(JSON.stringify({ prose: `阿宁等在门前，第${++calls}次抬手又放下。`, assumptions: [] })));
  service.profiles = [{ ...fakeProfile, outputLimit: 2000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('experiment-branch'), title: '实验分支', premise: '门前等候', config: { defaultProfileId: fakeProfile.id } });
    const store = service.store!;
    const q = mutateQuality(store, 0, { kind: 'protocol', protocol: { title: '等候', kind: 'voice_fixed_story', stage: 'development', family: '门前', sceneFunction: '对话', audience: '作者', variedFactors: ['voice'], constraints: '门没有开', questions: ['哪篇更想读'], maxCalls: 2, comparisonRule: '保留全部有效结果', exclusionRule: '只排除重复' } });
    const runs = [];
    for (let index = 0; index < 3; index++) {
      const id = await service.invoke('creative.run', { profileId: fakeProfile.id, input: { operation: 'explore', prompt: `等待${index}`, protocolId: q.protocols[0].id } });
      while (service.runner!.controller) await new Promise(resolve => setTimeout(resolve, 20));
      runs.push(store.db.run(id));
    }
    assert.equal(calls, 2); assert.notEqual(runs[2].status, 'complete'); assert.match(runs[2].error ?? '', /预算/);
    const draft = await service.invoke('draft.read', { id: runs[0].creative!.result!.draftId! });
    const fork = await service.invoke('draft.fork', { id: draft.id, hash: draft.hash, title: '另一种等候' });
    assert.deepEqual(fork.parent, { id: draft.id, hash: draft.hash });
    const saved = await service.invoke('draft.save', { id: fork.id, title: fork.title, content: '她在门外坐到天明。', baseHash: fork.hash, conversationId: fork.conversationId, messageId: fork.messageId });
    assert.equal((await service.invoke('draft.read', { id: saved.id, hash: fork.hash })).content, draft.content);
    const baseline = store.db.headRef()!.id;
    const merged = await service.invoke('draft.merge', { id: saved.id, hash: saved.hash, chapter: 1, baseHash: store.db.document(prosePath(1))?.hash ?? null, mode: 'replace' });
    const candidate = store.db.run(merged);
    assert.equal(candidate.revisionCoreRequired, 1);
    await assert.rejects(service.invoke('run.accept', { id: merged, proposalHash: proposalHash(candidate) }), /阻断|核对/);
    assert.equal(store.db.headRef()!.id, baseline);
    readExperience(store, 1); await service.invoke('draft.list');
    assert.equal(calls, 2);
  } finally { await service.drain(); }
});

test('采用有来源的声音偏好不把既有正文误标为剧情待同步', async () => {
  const service = new Service(root, () => {}, async () => { throw new Error('此操作不应调用模型'); });
  try {
    await service.invoke('project.create', { parent: isolatedRoot('voice-adoption'), title: '声音采纳', premise: '等候' });
    const store = service.store!, file = prosePath(1), before = '她十分焦急。', after = '她又按了一次门铃。';
    store.commit([{ path: file, content: before, baseHash: store.db.document(file)?.hash ?? null }], store.db.project());
    store.commit([{ path: file, content: after, baseHash: hash(before) }], store.db.project());
    const span = (text: string) => ({ path: file, hash: hash(text), start: 0, end: Array.from(text).length, quote: text });
    const scope = { kind: 'scene', target: '门前', sceneFunction: '对话' };
    const q = mutateQuality(store, 0, { kind: 'evidence', evidence: { before: span(before), after: span(after), scope, domain: 'expression', reason: '通过动作表现犹豫', editor: 'author' } });
    storeLearnedPreferences(store, 'offline-proof', [{ statement: '通过动作表现犹豫', scope, evidenceIds: [q.evidence[0].id], alternatives: [], exceptions: [] }]);
    const id = await service.invoke('quality.voice', { ids: [readQuality(store).preferences[0].id] });
    const stale = store.db.project().stale;
    await service.invoke('run.accept', { id, proposalHash: proposalHash(store.db.run(id)) });
    assert.deepEqual(store.db.project().stale, stale);
    assert.equal(store.readAccepted(file).content, after);
  } finally { await service.drain(); }
});
