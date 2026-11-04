import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Service } from '../src/core/service';
import { fixture } from './fixtures/workflow';
import { fixtureCoverage } from './fixtures/chapter-coverage';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { hash, prosePath, qualityPath, stageOutputs, updatePath, paths } from '../src/core/domain';
import { FileStore, proposalHash, atomicWrite } from '../src/core/storage';
import { assessReviewEvidence } from '../src/core/manuscript-check';
import { revisionCoreIssues, revisionMaterials } from '../src/core/workflows/revision-core';
import { compileCreative, rehearsalCharacters } from '../src/core/creative-context';
import { visibleFact, retrieveMemory } from '../src/core/memory-studio';
import { memoryScopeSchema } from '../src/shared/studio';
import { factSchema } from '../src/shared/types';
import { encodeFacts } from '../src/core/memory-records';
import { readExperience } from '../src/core/experience';
import { factReadDependency, factReadSetChanged } from '../src/core/runtime/fact-read-set';
import { validatedResponse } from '../src/core/runtime/validated-response';
import { fingerprint } from '../src/core/runtime/canonical';
import { ensureFactRecallIndex } from '../src/core/fact-recall-index';
import { patchDocument } from '../src/core/runtime/source-reuse';
import { parseMemoryDecisions } from '../src/core/memory-review';
import { reviewWithRepair } from '../src/core/runtime/review-receipts';
import { requiredCharacterCoverage } from '../src/core/chapter-memory';

const rules = path.resolve('resources/skill');

test('原子写入在 Windows 短暂占用后完成，永久拒绝和磁盘错误保留原文件且有限停止', t => {
  const root = isolatedRoot('atomic-retry'), file = path.join(root, 'journal.json');
  atomicWrite(file, '原版本');
  const rename = fs.renameSync;
  let calls = 0;
  const denial = Object.assign(new Error('文件短暂占用'), { code: 'EPERM' });
  const mocked = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    calls++;
    if (calls < 3) throw denial;
    assert.equal(fs.readFileSync(file, 'utf8'), '原版本');
    return rename(from, to);
  });
  if (process.platform === 'win32') {
    atomicWrite(file, '完整新版本'); assert.equal(calls, 3); assert.equal(fs.readFileSync(file, 'utf8'), '完整新版本');
  } else {
    assert.throws(() => atomicWrite(file, '完整新版本'), error => error === denial); assert.equal(calls, 1);
  }
  const preserved = fs.readFileSync(file, 'utf8');
  calls = 0; mocked.mock.mockImplementation(() => { calls++; throw denial; });
  assert.throws(() => atomicWrite(file, '不应覆盖'), error => error === denial);
  assert.equal(calls, process.platform === 'win32' ? 6 : 1);
  assert.equal(fs.readFileSync(file, 'utf8'), preserved);
  assert.deepEqual(fs.readdirSync(root), ['journal.json']);
  calls = 0; const disk = Object.assign(new Error('磁盘错误'), { code: 'ENOSPC' });
  mocked.mock.mockImplementation(() => { calls++; throw disk; });
  assert.throws(() => atomicWrite(file, '不应覆盖'), error => error === disk);
  assert.equal(calls, 1); assert.equal(fs.readFileSync(file, 'utf8'), preserved);
});

test('分页审核越界先报告准确编号，修复保留负面结论并明确文档自身引文要求', async () => {
  const { store } = refactorFixture();
  try {
    const items = [{ id: 'document:角色卡', path: '角色卡.md' }, { id: 'coverage', path: '正文.md' }];
    const sources = [{ path: '角色卡.md', content: '左臂仍未痊愈' }, { path: '正文.md', content: '左臂已经痊愈' }];
    const valid = { decisions: items.map(item => ({ id: item.id, verdict: 'contradicted', reason: '人物卡与正文状态冲突',
      evidence: sources.map(source => ({ path: source.path, quote: source.content })) })) };
    const extra = { ...valid, decisions: [...valid.decisions, { id: '仅作背景', evidenceRefs: [0] }] };
    let calls = 0;
    const result = await reviewWithRepair(store, { task: 'paged-audit', items }, 2, async messages => {
      if (++calls === 1) return JSON.stringify(extra);
      assert.match(messages.at(-1)!.content, /unexpected.*仅作背景/);
      assert.match(messages.at(-1)!.content, /expected.*document:角色卡.*coverage/);
      assert.match(messages.at(-1)!.content, /不把否定或不明确结论改成默认通过/);
      return JSON.stringify(valid);
    }, raw => parseMemoryDecisions(raw, items, sources), () => {});
    assert.equal(calls, 2); assert.ok(result.every(decision => decision.verdict === 'contradicted'));
    const unrelated = structuredClone(valid); unrelated.decisions[0].evidence = [{ path: '正文.md', quote: '左臂已经痊愈' }];
    assert.throws(() => parseMemoryDecisions(JSON.stringify(unrelated), items, sources), /document:角色卡.*requiredSourcePaths.*角色卡.md/);
  } finally { store.close(); }
});

test('有效负面审稿一次保存，连续恢复、重启与重复核对不能改判或消耗修复次数', async () => {
  let service: Service, calls = 0, reviews = 0;
  service = new Service(rules, () => {}, async (_p, _s, messages) => {
    calls++;
    const input = JSON.parse(messages[0].content), store = service.store!, run = store.db.runs().find(r => r.status === 'running')!;
    if (input.template) {
      reviews++;
      assert.equal(input.responseRepair, undefined);
      const report = fixture({ ...store.db.project(), chapter: 1 }, qualityPath(1), service)
        .replace('"verdict": "pass"', '"verdict": "error"').replace('"verdict":"pass"', '"verdict":"error"');
      const assessment = assessReviewEvidence(qualityPath(1), report, input.prose);
      assert.equal(assessment.validationIssues.length, 0);
      assert.ok(assessment.findings.some(issue => issue.severity === 'error'));
      return fakeResult(JSON.stringify({ report }));
    }
    assert.ok(input.schemas, '负面报告后不应继续记忆审核');
    const scoped = { ...run, chapter: 1, pipeline: { phase: 'memory' as const, proseHash: input.prose.hash, epoch: run.id, version: 1, previewCalls: 0, coverageVersion: 1 as const } };
    return fakeResult(JSON.stringify({ documents: [{ path: updatePath(1), content: fixture(store.db.project(), updatePath(1), service) }], facts: [], coverage: fixtureCoverage(service, scoped) }));
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 16000 }];
  const idle = async () => { while (service.runner!.controller) await new Promise(resolve => setTimeout(resolve, 10)); };
  try {
    await service.invoke('project.create', { parent: isolatedRoot('negative-review'), title: '审核反例', premise: '阿宁求医', config: { defaultProfileId: fakeProfile.id, preview: { enabled: false } } });
    const store = service.store!;
    for (const stage of ['S01','S02','S03','S04','S05','S06','S07','S08','S09'] as const) {
      const p = store.db.project(); store.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    }
    const prose = fixture(store.db.project(), prosePath(1), service);
    store.commit([service.change(prosePath(1), prose + '\n旧句。')], store.db.project());
    const sourceId = await service.invoke('document.save', { path: prosePath(1), content: prose, baseHash: hash(prose + '\n旧句。') });
    const snapshot = store.db.headRef()!.id;
    const id = await service.invoke('run.reviewProse', { id: sourceId, proposalHash: proposalHash(store.db.run(sourceId)), profileId: fakeProfile.id });
    await idle();
    let run = store.db.run(id);
    assert.equal(run.revisionCore?.phase, 'needs_prose_revision', run.error ?? JSON.stringify(run.issues));
    assert.equal(run.status, 'needs_repair');
    assert.equal(reviews, 1); assert.equal(calls, 2);
    const report = run.revisionCore!.reports[1];
    assert.ok(run.changes.some(change => change.path === qualityPath(1) && change.content === report));
    assert.ok(revisionCoreIssues(store, run).some(issue => issue.code === 'review_finding' && issue.severity === 'error'));
    await assert.rejects(service.invoke('run.accept', { id, proposalHash: proposalHash(run) }), /阻断|审稿|修订/);
    for (let i = 0; i < 3; i++) { await service.runner!.drive(id); await idle(); }
    run = store.db.run(id);
    assert.equal(calls, 2); assert.equal(run.revisionCore!.reports[1], report);
    await assert.rejects(service.invoke('run.reviewProse', { id: sourceId, proposalHash: proposalHash(store.db.run(sourceId)), profileId: fakeProfile.id }), /有效.*负面|先修改/);
    assert.equal(store.db.headRef()!.id, snapshot);
    const changed = structuredClone(run); changed.changes.find(change => change.path === prosePath(1))!.content += '\n他先核对线索。';
    assert.ok(revisionCoreIssues(store, changed).some(issue => issue.code === 'revision_core'));
    const root = store.root;
    await service.drain();
    const reopened = new FileStore(root);
    try { assert.equal(reopened.db.run(id).revisionCore!.reports[1], report); assert.equal(reopened.db.run(id).revisionCore!.phase, 'needs_prose_revision'); }
    finally { reopened.close(); }
  } finally { await service.drain(); }
});

test('升级后优先重新认定原始有效负面报告，不复用后一次软化结论', async () => {
  const { store, run } = refactorFixture();
  try {
    const input = { prose: '正文保持不变' }, instruction = '审核', purpose = 'review';
    const binding = fingerprint({ purpose, instruction, input });
    const first = { verdict: 'error', reason: '人物未获线索却找到入口' };
    store.db.set(`response-validation:v1:${run.id}:${binding}:0`, { version: 1, responseRef: store.putObject(JSON.stringify(first)), transport: 'complete', parse: 'valid', structure: 'valid', business: 'invalid', error: '旧版误将负面判断当作响应错误' });
    store.db.set(`response-validation:v1:${run.id}:${binding}:1`, { version: 1, responseRef: store.putObject('{"verdict":"warning"}'), transport: 'complete', parse: 'valid', structure: 'valid', business: 'valid' });
    for (let i = 0; i < 3; i++) {
      const result = await validatedResponse({ store, run, phase: purpose, initialPurpose: purpose, instruction, input, signal: new AbortController().signal, revalidateCompleted: true,
        assertCurrent() {}, validate: value => value, send: async () => { throw new Error('不应重发'); } });
      assert.deepEqual(result, first);
    }
  } finally { store.db.close(); }
});

test('试演主体与关系记录顺序无关，私有知情不受读者揭示时间遮蔽', () => {
  const { store, run } = refactorFixture();
  try {
    const prose = '沈遥信任陆川。陆川是调查员，早已知道自己是卧底。第三人尚不知道。';
    const evidence = [{ path: prosePath(1), hash: hash(prose), quote: prose }];
    const relation = factSchema.parse({ id: 'relation', kind: 'state', reviewStatus: 'accepted', subject: '沈遥', predicate: '信任', value: '陆川', entityIds: ['shen', 'lu'], category: 'relation', fromChapter: 1, revealedAt: 1, knowledge: [{ who: 'lu', mode: 'seen', fromChapter: 1 }], evidence });
    const identity = factSchema.parse({ ...relation, id: 'identity', subject: '陆川', entityIds: ['lu'], category: 'character', predicate: '身份', value: '调查员' });
    const sharedCharacterRecord = factSchema.parse({ ...relation, id: 'shared-character', category: 'character', entityIds: ['lu', 'shen'] });
    const secret = factSchema.parse({ ...identity, id: 'secret', category: 'knowledge', predicate: '私密身份', value: '卧底', revealedAt: 20 });
    const later = factSchema.parse({ ...secret, id: 'future', predicate: '未来线索', value: 'FUTURE_CANARY', knowledge: [{ who: 'lu', mode: 'told', fromChapter: 8 }] });
    store.commit([{ path: prosePath(1), content: prose, baseHash: null }, { path: paths.knowledge, content: encodeFacts('# 知情', [relation, identity, secret, later, sharedCharacterRecord]), baseHash: null }], store.db.project());
    for (const order of [[sharedCharacterRecord, relation, identity, secret, later], [later, secret, identity, relation, sharedCharacterRecord]]) {
      store.db.replaceFacts(order, store.db.project().revision);
      const compiled = compileCreative(store, rules, { operation: 'rehearse', characterId: 'lu', chapter: 5, observations: '沈遥询问来意。' }, run.id);
      const payload = compiled.modelPayload as any;
      assert.equal(payload.character, '陆川'); assert.equal(payload.characterId, 'lu');
      assert.match(JSON.stringify(payload.beliefs), /卧底/); assert.doesNotMatch(JSON.stringify(payload), /FUTURE_CANARY/);
      assert.deepEqual(payload.narrationBoundary.privateKnowledge, ['secret']);
      assert.equal(compiled.binding.selectionTrace!.displayName, '陆川');
      assert.equal(rehearsalCharacters(store, 5).find(character => character.id === 'lu')!.name, '陆川');
      assert.equal(readExperience(store, 5).characters.find(character => character.id === 'lu')!.name, '陆川');
      assert.equal(readExperience(store, 5).characters.find(character => character.id === 'shen')!.name, 'shen', '关联人物仍可列出，缺少本人身份依据时不能借用关联记录主体');
      const coverage = requiredCharacterCoverage(store, { ...run, chapter: 5, changes: [{ path: prosePath(5), content: prose, baseHash: null }] });
      assert.equal(coverage.find(character => character.entityId === 'lu')!.name, '陆川', '人物覆盖同样不能用关系记录覆盖主体现有身份');
    }
    assert.equal(visibleFact(secret, memoryScopeSchema.parse({ chapter: 5, viewpoint: 'character', characterId: 'lu' })), true);
    assert.equal(visibleFact(secret, memoryScopeSchema.parse({ chapter: 5, viewpoint: 'reader' })), false);
    assert.equal(visibleFact(secret, memoryScopeSchema.parse({ chapter: 5, viewpoint: 'character', characterId: 'shen' })), false);
    assert.equal(visibleFact({ ...secret, reviewStatus: 'retracted' }, memoryScopeSchema.parse({ chapter: 5 })), false);
    assert.ok(retrieveMemory(store, '陆川', { chapter: 5, viewpoint: 'character', characterId: 'lu' }).facts.some(item => item.fact.id === 'secret'));
  } finally { store.db.close(); }
});

test('初读记录先按类型章节筛选再分页，数百新任务、页间新写入及失效来源均不丢历史', () => {
  const { store, run } = refactorFixture();
  try {
    const compiled = { version: 1, input: { operation: 'first-read', throughChapter: 1 }, sourceVersions: [{ path: '正文.md', hash: store.db.document('正文.md')!.hash }], result: { content: '早期初读' } };
    for (let i = 0; i < 125; i++) store.db.saveRun({ ...run, id: `read-${i}`, creative: compiled as any });
    for (let i = 0; i < 500; i++) store.db.saveRun({ ...run, id: `other-${i}` });
    const first = readExperience(store, 1, { pageSize: 30 });
    assert.equal(first.chapters[0].simulated.length, 30);
    store.db.saveRun({ ...run, id: 'concurrent-read', creative: compiled as any });
    const seen = first.chapters.flatMap(chapter => chapter.simulated.map(item => item.id));
    let cursor = first.firstReadPage!;
    while (cursor.nextBefore) {
      const next = readExperience(store, 1, { pageSize: 30, watermark: cursor.watermark, before: cursor.nextBefore });
      seen.push(...next.chapters.flatMap(chapter => chapter.simulated.map(item => item.id))); cursor = next.firstReadPage!;
    }
    assert.equal(seen.length, 125); assert.equal(new Set(seen).size, 125); assert.ok(seen.includes('read-0'));
    assert.equal(readExperience(store, 2, { fromChapter: 2 }).chapters.length, 0);
    store.commit([{ path: '正文.md', content: '改过的原稿', baseHash: store.db.document('正文.md')!.hash }], store.db.project());
    assert.ok(readExperience(store, 1).chapters[0].simulated.every(item => item.stale));
  } finally { store.db.close(); }
});

test('局部初读只装入指定章段，不把摘要或未读章节当作完整阅读', () => {
  const { store, run } = refactorFixture();
  try {
    store.commit([1,2,3].map(chapter => ({ path: prosePath(chapter), baseHash: null, content: `第${chapter}章唯一正文。` })), store.db.project());
    const compiled = compileCreative(store, rules, { operation: 'first-read', fromChapter: 2, throughChapter: 2 }, run.id);
    assert.equal((compiled.modelPayload as any).coverage.kind, 'chapter_range');
    assert.deepEqual(compiled.binding.sourceVersions.map(source => source.path), [prosePath(2)]);
    assert.doesNotMatch(JSON.stringify(compiled.modelPayload), /第1章唯一|第3章唯一/);
    assert.throws(() => compileCreative(store, rules, { operation: 'first-read', fromChapter: 3, throughChapter: 2 }, run.id), /起始章节/);
  } finally { store.db.close(); }
});

test('结构化候选查询保留关键状态，新相关事实使读取依赖失效，无关角色更新不误失效', () => {
  const { store, run } = refactorFixture();
  try {
    const base = factSchema.parse({ id: 'lu', kind: 'state', reviewStatus: 'accepted', subject: '陆川', entityIds: ['lu'], category: 'character', predicate: '身份', value: '调查员', fromChapter: 1, revealedAt: 1, evidence: [{ path: '正文.md', hash: store.db.document('正文.md')!.hash, quote: '原稿' }] });
    const others = Array.from({ length: 3000 }, (_, i) => factSchema.parse({ ...base, id: `other-${i}`, entityIds: [`other-${i}`], subject: `路人${i}`, value: '工人' }));
    const injury = factSchema.parse({ ...base, id: 'arm', category: 'injury', predicate: '身体状态', value: '断臂' });
    const rule = factSchema.parse({ ...base, id: 'rule', kind: 'author_constraint', entityIds: [], subject: '作品约束', value: '不得复活死者' });
    store.db.replaceFacts([base, injury, rule, ...others], store.db.project().revision);
    const selection = { query: '陆川调查', entityIds: ['lu'], chapter: 2 };
    const scope = { worldId: 'main', timelineId: 'main' };
    const recalled = store.db.factsForTask(scope, selection);
    assert.deepEqual(recalled.map(fact => fact.id), ['lu', 'arm', 'rule']);
    const legacy = { ...base, id: 'legacy', subject: '甲九', entityIds: [] };
    const dependencyFact = { ...base, id: 'dependency', subject: '密室机关', entityIds: [], relatedIds: ['lu'] };
    store.db.replaceFacts([base, injury, rule, ...others, legacy, dependencyFact], store.db.project().revision);
    const material = revisionMaterials(store, { ...run, changes: [{ path: prosePath(2), content: '陆川和甲九询问工人。', baseHash: null }] }, 2);
    assert.deepEqual(material.facts.map(fact => fact.id), ['lu', 'arm', 'rule', 'legacy', 'dependency']);
    assert.ok(store.db.factsForTask(scope, { ...selection, query: '工人', entityIds: [] }).length > 2000, '普通文本搜索保留跨人物召回');
    store.db.replaceFacts([base, injury, rule, ...others], store.db.project().revision);
    const dependency = factReadDependency(recalled, scope, selection);
    others[0].value = '铁匠'; store.db.replaceFacts([base, injury, rule, ...others], store.db.project().revision);
    assert.equal(factReadSetChanged(store, dependency), false);
    store.db.replaceFacts([base, injury, rule, ...others, { ...injury, id: 'new-state', predicate: '资源', value: '只剩一张通行证' }], store.db.project().revision);
    assert.equal(factReadSetChanged(store, dependency), true);
  } finally { store.db.close(); }
});

test('旧项目召回索引可重建，事务回滚和增量更新不会让索引脱离正式事实', () => {
  const { store } = refactorFixture();
  try {
    const fact = factSchema.parse({ id: 'identity', kind: 'state', category: 'character', subject: '陆川', entityIds: ['lu'], predicate: '职业', value: '调查员', reviewStatus: 'accepted', fromChapter: 1, revealedAt: 1,
      evidence: [{ path: '正文.md', hash: store.db.document('正文.md')!.hash, quote: '原稿' }] });
    const scope = { worldId: 'main', timelineId: 'main' }, selection = { query: '陆川', entityIds: ['lu'], chapter: 1 };
    store.db.replaceFacts([fact], store.db.project().revision);
    const original = String(store.db.sql.prepare('SELECT data FROM facts').get()!.data);
    store.db.sql.exec('DELETE FROM fact_recall'); ensureFactRecallIndex(store.db.sql);
    assert.equal(String(store.db.sql.prepare('SELECT data FROM facts').get()!.data), original);
    assert.deepEqual(store.db.factsForTask(scope, selection), [fact]);
    assert.throws(() => store.db.transaction(() => { store.db.replaceFacts([{ ...fact, subject: '另一个人', entityIds: ['other'] }], 99); throw new Error('模拟提交失败'); }), /提交失败/);
    assert.deepEqual(store.db.factsForTask(scope, selection), [fact]);
    store.db.sql.prepare('UPDATE facts SET data=? WHERE id=?').run(JSON.stringify({ ...fact, subject: '沈遥', entityIds: ['shen'] }), fact.id);
    assert.deepEqual(store.db.factsForTask(scope, selection), []);
    assert.equal(store.db.factsForTask(scope, { ...selection, query: '沈遥', entityIds: ['shen'] }).length, 1);
  } finally { store.close(); }
});

test('同源多段证据与重复别名在正式事实 UPSERT、重启和回滚后只建立一份召回关系', () => {
  const { store } = refactorFixture();
  try {
    const source = { path: '正文.md', hash: store.db.document('正文.md')!.hash, quote: '原稿' };
    const fact = factSchema.parse({ id: 'multi-evidence', kind: 'state', category: 'character', subject: '陆川',
      aliases: ['陆川', '小陆', '小陆'], entityIds: ['lu', 'lu'], relatedIds: ['shen', 'shen'],
      knowledge: [{ who: 'lu', mode: 'seen', fromChapter: 1 }, { who: 'lu', mode: 'told', fromChapter: 1 }],
      predicate: '职业', value: '调查员', reviewStatus: 'accepted', fromChapter: 1, revealedAt: 1, evidence: [source, { ...source, quote: '𠮷' }] });
    const upsert = store.db.sql.prepare('INSERT INTO facts(id,data,source_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,source_hash=excluded.source_hash');
    upsert.run(fact.id, JSON.stringify(fact), source.hash);
    const next = { ...fact, value: '已经核验记录' };
    upsert.run(fact.id, JSON.stringify(next), source.hash);
    for (const [table, count] of [['fact_recall_sources', 1], ['fact_recall_names', 2], ['fact_recall_links', 3]] as const)
      assert.equal(store.db.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE fact_id=?`).get(fact.id)!.n, count);
    store.db.set('factRecallVersion', 1);
    ensureFactRecallIndex(store.db.sql);
    assert.equal(store.db.get('factRecallVersion'), 2);
    assert.deepEqual(store.db.factsByIds([fact.id]), [next]);
    assert.throws(() => store.db.transaction(() => { upsert.run(fact.id, JSON.stringify({ ...next, aliases: ['新名'] }), source.hash); throw new Error('回滚'); }), /回滚/);
    assert.deepEqual(store.db.factsForTask({ worldId: 'main', timelineId: 'main' }, { query: '小陆', entityIds: [], chapter: 1, textSearch: false }), [next]);
  } finally { store.close(); }
});

test('真实记忆更新中的相邻人物卡可以共享未改标题，实际冲突和重复插入仍拒绝', () => {
  const source = '## 阿宁\r\n\r\n- 当前心情：未知\r\n\r\n## 沈遥\r\n\r\n- 首次出场：待确认\r\n- 备注：𠮷';
  const patch = { sourceHash: hash(source), edits: [
    { before: '- 当前心情：未知\r\n\r\n## 沈遥', after: '- 当前心情：有所缓和\r\n\r\n## 沈遥' },
    { before: '## 沈遥\r\n\r\n- 首次出场：待确认', after: '## 沈遥\r\n\r\n- 首次出场：第001章' }
  ] };
  assert.equal(patchDocument(source, patch), source.replace('心情：未知', '心情：有所缓和').replace('出场：待确认', '出场：第001章'));
  assert.equal(patchDocument(source, { ...patch, edits: [...patch.edits].reverse() }), patchDocument(source, patch));
  assert.throws(() => patchDocument(source, { ...patch, edits: [{ before: '心情：未知', after: '心情：紧张' }, { before: '未知', after: '高兴' }] }), /重叠/);
  assert.throws(() => patchDocument(source, { ...patch, edits: [{ before: '备注：𠮷', after: '备注：𠮷甲' }, { before: '备注：𠮷', after: '备注：𠮷乙' }] }), /重叠/);
  assert.throws(() => patchDocument(source + '改', patch), /版本/);
});
