import test from 'node:test';
import assert from 'node:assert/strict';
import { beginTool, finishTool } from '../src/core/runtime/tool-gateway';
import { HostToolRegistry, type HostToolContract } from '../src/core/runtime/tool-contracts';
import { refactorFixture } from './fixtures/refactor';
import { assertWorkflow, bindWorkflow } from '../src/core/runtime/workflow-contract';
import { factReadDependency, factReadSetChanged } from '../src/core/runtime/fact-read-set';
import { factSchema } from '../src/shared/types';
import { hash, prosePath, paths } from '../src/core/domain';
import { validateChapterCoverage } from '../src/core/chapter-memory';
import { memoryReviewInput } from '../src/core/memory-review';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { decodeFacts, encodeFacts, rebuildMemory } from '../src/core/memory-records';
import { sourceValidator } from '../src/core/memory-studio';
import { FileStore } from '../src/core/storage';
import { assertRepairWrite, planCandidateRepair } from '../src/core/runtime/candidate-repair';

const definitions = ['store_candidate', 'propose_summary'].map((name) => ({
  name,
  description: '离线工具实现',
  parameters: { type: 'object', properties: {}, additionalProperties: false }
}));
const contracts: HostToolContract[] = [
  {
    name: 'store_candidate',
    version: 1,
    effect: 'candidate_proposal',
    scope: 'task_candidate',
    unknownOutcome: 'require_resolution',
    outputByteLimit: 256
  },
  {
    name: 'propose_summary',
    version: 1,
    effect: 'read',
    scope: 'task_read',
    unknownOutcome: 'revalidate_read',
    outputByteLimit: 128
  }
];

test('V7-A-21 增量事实索引与全量台账参考在修订、撤回、移动和重启后一致', () => {
  const fixture = refactorFixture();
  let store = fixture.store;
  const prose = prosePath(1),
    text = '阿宁𠮷拿起木匣。';
  const first = factSchema.parse({
    id: 'fact-one',
    subject: '阿宁',
    predicate: '持有',
    value: '木匣',
    kind: 'event',
    category: 'item',
    fromChapter: 1,
    revealedAt: 1,
    reviewStatus: 'accepted',
    evidence: [{ path: prose, hash: hash(text), quote: text, start: 0, end: Array.from(text).length }]
  });
  const normalize = (facts: ReturnType<typeof decodeFacts>) => facts.sort((a, b) => a.id.localeCompare(b.id));
  const compare = () => {
    const reference = store.db
      .acceptedDocuments()
      .filter((doc) => doc.path.startsWith('04_') && doc.hash)
      .flatMap((doc) => decodeFacts(store.object(doc.hash!).toString('utf8')))
      .filter(fact => ['accepted', 'disputed'].includes(fact.reviewStatus))
      .map((fact) => {
        if (
          fact.reviewStatus === 'accepted' &&
          fact.state !== 'superseded' &&
          fact.evidence.some((e) => store.db.document(e.path)?.hash !== e.hash)
        )
          return { ...fact, state: 'disputed' as const, reviewStatus: 'disputed' as const };
        return fact;
      });
    assert.deepEqual(normalize(store.db.facts()), normalize(reference));
    assert.deepEqual(normalize(store.db.head()!.facts), normalize(reference));
  };
  const commit = (changes: [string, string][]) => {
    const project = store.db.project();
    project.revision++;
    project.chapter = 3;
    store.commit(
      changes.map(([path, content]) => ({ path, content, baseHash: store.db.document(path)?.hash ?? null })),
      project
    );
    compare();
  };
  try {
    commit([
      [prose, text],
      [paths.items, encodeFacts('# 物品', [first])]
    ]);
    const second = factSchema.parse({ ...first, id: 'fact-two', predicate: '位置', value: '窗前' });
    commit([[paths.items, encodeFacts('# 物品', [first, second])]]);
    commit([[prose, '阿宁把木匣留在窗前。']]);
    assert.ok(store.db.facts().every((fact) => fact.reviewStatus === 'disputed'));
    commit([[prose, text]]);
    assert.ok(store.db.facts().every((fact) => fact.reviewStatus === 'accepted'));
    commit([
      [
        paths.items,
        encodeFacts('# 物品', [
          { ...first, state: 'superseded' },
          { ...second, reviewStatus: 'retracted' }
        ])
      ]
    ]);
    commit([
      [paths.items, encodeFacts('# 物品', [])],
      [paths.roles, encodeFacts('# 角色迁移', [first])]
    ]);
    const rawHash = store.db.document(paths.roles)!.hash;
    const originalObject = store.object.bind(store),
      reads: string[] = [];
    store.object = (digest) => {
      reads.push(digest);
      return originalObject(digest);
    };
    const next = store.db.project();
    next.revision++;
    store.commit(
      [
        {
          path: paths.progress,
          content: '只改进度',
          baseHash: store.db.document(paths.progress)?.hash ?? null
        }
      ],
      next
    );
    assert.ok(!reads.includes(rawHash!));
    store.object = originalObject;
    compare();
    rebuildMemory(store);
    commit([[paths.progress, '重建后继续']]);
    store.close();
    store = new FileStore(fixture.root);
    commit([[paths.roles, encodeFacts('# 角色迁移', [])]]);
    assert.equal(store.db.facts().length, 0);
  } finally {
    store.close();
  }
});

test('V7-A-22 来源缓存只复用字节，待核对、章节和版本限制仍每次验证', () => {
  const { store } = refactorFixture();
  try {
    const text = '阿宁𠮷拿起木匣。',
      file = prosePath(1),
      version = hash(text);
    const project = store.db.project();
    store.commit([{ path: file, content: text, baseHash: null }], project);
    const documents = { [file]: version };
    const evidence = { path: file, hash: version, quote: '𠮷', start: 2, end: 3 };
    let reads = 0;
    const originalObject = store.object.bind(store);
    store.object = (digest) => {
      reads++;
      return originalObject(digest);
    };
    const valid = sourceValidator(store, documents, 1, project);
    assert.ok(valid(evidence));
    assert.ok(valid(evidence));
    assert.equal(reads, 1);
    assert.equal(valid({ ...evidence, start: 3, end: 4 }), false);
    project.stale.push(file);
    assert.equal(valid(evidence), false);
    project.stale = [];
    documents[file] = hash('别的版本');
    assert.equal(valid(evidence), false);
    documents[file] = version;
    assert.ok(valid(evidence));
    assert.equal(reads, 1);
    assert.equal(sourceValidator(store, documents, 0, project)(evidence), false);
  } finally {
    store.close();
  }
});

test('V7-A-07 工具重放遵守宿主效果合同，与名称前缀无关', () => {
  const { store, run } = refactorFixture();
  const signal = new AbortController().signal,
    registry = new HostToolRegistry(contracts);
  const write = { id: 'write', name: 'store_candidate', arguments: '{}' };
  const read = { id: 'read', name: 'propose_summary', arguments: '{}' };
  try {
    assert.throws(() => beginTool(store, run.id, write, definitions, signal), /宿主登记/);
    const ticket = beginTool(store, run.id, write, definitions, signal, registry);
    assert.equal(ticket.effect, 'candidate_proposal');
    assert.throws(() => beginTool(store, run.id, write, definitions, signal, registry), /禁止自动重复执行/);
    finishTool(store, ticket, '已保存');
    assert.equal(beginTool(store, run.id, write, definitions, signal, registry).result, '已保存');
    assert.equal(beginTool(store, run.id, read, definitions, signal, registry).effect, 'read');
    assert.equal(beginTool(store, run.id, read, definitions, signal, registry).status, 'started');
    assert.throws(
      () => finishTool(store, beginTool(store, run.id, read, definitions, signal, registry), '长'.repeat(50)),
      /输出上限/
    );
    const changed = new HostToolRegistry([{ ...contracts[0], outputByteLimit: 128 }, contracts[1]]);
    assert.throws(() => beginTool(store, run.id, write, definitions, signal, changed), /契约已改变/);
    assert.equal(store.readAccepted('正文.md').content, '原稿𠮷\r\n');
  } finally {
    store.close();
  }
});

test('V7-A-07 非法副作用和越权合同不能注册', () => {
  assert.throws(() => new HostToolRegistry([{ ...contracts[0], scope: 'task_read' }]), /契约无效/);
  assert.throws(
    () => new HostToolRegistry([{ ...contracts[0], unknownOutcome: 'revalidate_read' }]),
    /契约无效/
  );
  assert.throws(() => new HostToolRegistry([contracts[0], contracts[0]]), /契约无效/);
});

test('V7 工作流合同固定执行版本与预算，旧任务保持原路由', () => {
  const { store, run } = refactorFixture();
  try {
    bindWorkflow(run);
    assert.equal(run.workflowBinding, undefined);
    run.workflowVersion = 1;
    bindWorkflow(run);
    assert.equal(run.workflowBinding!.kind, 'revision');
    store.db.saveRun(run);
    assertWorkflow(store.db.run(run.id));
    assert.throws(() => assertWorkflow({ ...run, parentRunId: 'another-budget' }), /预算归属/);
    assert.throws(() => assertWorkflow({ ...run, executorVersion: 'unsupported' }), /执行器/);
    const corrupted = JSON.parse(JSON.stringify(run));
    corrupted.workflowBinding.handlerVersion = 999;
    assert.throws(() => assertWorkflow(corrupted), /版本不受支持/);
  } finally {
    store.close();
  }
});

test('V7-A-10 空事实查询记录谓词依赖，相关新事实使旧结果失效', () => {
  const { store } = refactorFixture();
  try {
    const dependency = factReadDependency([], { worldId: 'main', timelineId: 'main' });
    const fact = factSchema.parse({
      id: 'injury',
      subject: '阿宁',
      predicate: '伤势',
      value: '右手受伤',
      kind: 'event',
      category: 'injury',
      fromChapter: 1,
      revealedAt: 1,
      reviewStatus: 'accepted',
      evidence: [{ path: '正文.md', hash: hash('原稿𠮷\r\n'), quote: '原稿' }]
    });
    store.db.replaceFacts([{ ...fact, worldId: 'other' }], 0);
    assert.equal(factReadSetChanged(store, dependency), false);
    store.db.replaceFacts([fact], 0);
    assert.equal(factReadSetChanged(store, dependency), true);
  } finally {
    store.close();
  }
});

test('V7-A-16 人物覆盖、核心事实与正文必须同版采纳，重复采纳保持幂等', () => {
  const { store, run, project } = refactorFixture();
  try {
    const content = '阿宁握住了门边的木凳。',
      path = prosePath(1),
      proseHash = hash(content);
    run.chapter = 1;
    run.changes = [{ path, content, baseHash: null }];
    run.pipeline = {
      phase: 'ready',
      epoch: 'fixture',
      version: 1,
      previewCalls: 0,
      proseHash,
      coverageVersion: 1
    };
    run.facts = [
      factSchema.parse({
        id: 'held-stool',
        subject: '阿宁',
        entityIds: ['CH01'],
        predicate: '动作',
        value: '握住木凳',
        kind: 'event',
        category: 'character',
        fromChapter: 1,
        revealedAt: 1,
        evidence: [{ path, hash: proseHash, quote: content }]
      })
    ];
    const coverage = {
      schemaVersion: 1 as const,
      proseHash,
      characters: [
        {
          entityId: 'CH01',
          name: '阿宁',
          outcome: 'changed' as const,
          reason: '本章明确展示动作，没有改写稳定人格。',
          factIds: ['held-stool'],
          evidence: [{ quote: content, start: 0, end: Array.from(content).length }]
        }
      ]
    };
    assert.throws(() => validateChapterCoverage(store, run, { ...coverage, characters: [] }), /遗漏/);
    run.chapterCoverage = validateChapterCoverage(store, run, coverage);
    const reviewFingerprint = memoryReviewInput(store, run).fingerprint;
    const repaired = structuredClone(run);
    repaired.facts[0].value = '放下木凳';
    assert.notEqual(memoryReviewInput(store, repaired).fingerprint, reviewFingerprint);
    run.repairScope = planCandidateRepair(run, [{ code: 'chapter_coverage_review', severity: 'error', path, message: '人物覆盖结论与正文不一致' }], 'memory');
    assert.equal(run.repairScope.coverage, true);
    assert.deepEqual(run.repairScope.paths, []);
    assert.throws(() => assertRepairWrite(run, [{ ...run.changes[0], content: '不可借修复覆盖改写正文' }]), /局部修复/);
    run.repairScope = undefined;
    assert.throws(
      () =>
        validateChapterCoverage(
          store,
          { ...run, changes: [{ path, content: content + '改稿', baseHash: null }] },
          coverage
        ),
      /版本不一致/
    );
    const kernel = new ProjectCommitService(store);
    store.db.saveRun(run);
    assert.throws(() => kernel.commit(run.changes, project, run), /核心记忆/);
    run.changes.push({
      path: paths.roles,
      content: encodeFacts(
        '# 人物',
        run.facts.map((fact) => ({
          ...fact,
          reviewStatus: 'accepted',
          acceptedAt: '2026-10-29T00:00:00.000Z',
          acceptedRunId: run.id
        }))
      ),
      baseHash: null
    });
    assert.throws(() => kernel.commit(run.changes, project, run), /同版本核验/);
    run.memoryReview = { fingerprint: memoryReviewInput(store, run).fingerprint, issues: [] };
    store.db.saveRun(run);
    assert.throws(() => kernel.commit(run.changes.map(change => change.path === path ? { ...change, path: prosePath(2) } : change), project, run), /同版本核验/);
    const next = { ...project, revision: project.revision + 1 };
    const accepted = { ...run, status: 'complete' as const, accepted: true };
    const tx = kernel.commit(run.changes, next, accepted);
    assert.equal(store.readAccepted(path).hash, proseHash);
    assert.equal(store.db.facts()[0].id, 'held-stool');
    assert.equal(store.db.run(run.id).chapterCoverage!.proseHash, proseHash);
    assert.equal(kernel.commit(run.changes, next, accepted), tx);
    assert.equal(store.db.head()!.facts[0].evidence[0].hash, proseHash);
  } finally {
    store.close();
  }
});
