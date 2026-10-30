import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { refactorFixture, fakeProfile, isolatedRoot } from './fixtures/refactor';
import { chapterTableFixture, volumeTableFixture } from './fixtures/readable-tables';
import { createVisualWorkbenchFixture } from './fixtures/workbench-visual';
import { paths, hash, prosePath, detailPath } from '../src/core/domain';
import { readWorkbench, proposeWorkbenchField, resolveWorkbenchObject } from '../src/core/workbench';
import {
  chapterBlocks,
  plotPath,
  parsePlotDocument,
  renderPlotDocument,
  mutatePlot,
  reorderPlanText,
  plotAffectedChapters,
  plotContext
} from '../src/core/workbench-plot';
import {
  prepareReorder,
  validateReorderDecisions,
  resolvedReorderChanges
} from '../src/core/workbench-reorder';
import {
  bindWorkbenchCandidate,
  assertWorkbenchCandidate,
  candidateView
} from '../src/core/workbench-candidates';
import { workbenchHistory } from '../src/core/workbench-history';
import { proposeAvatar, readAvatar, mediaPath } from '../src/core/workbench-media';
import {
  readWorldModel,
  renderWorldModel,
  parseWorldModel,
  worldContext,
  worldCandidateIssues
} from '../src/core/world-model';
import { factSchema, type Change } from '../src/shared/types';
import { encodeFacts } from '../src/core/memory-records';
import {
  plotViewSchema,
  stateHistorySchema,
  candidateViewSchema,
  workbenchCandidateSchema
} from '../src/shared/workbench-visual';
import { parseOutput } from '../src/shared/contracts';
import { workbenchViewSchema } from '../src/shared/workbench';
import { Service } from '../src/core/service';
import { proposalHash } from '../src/core/storage';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';

const roles =
  '# 角色卡\n\n## 林川\n- 编号：CH001\n- 身份：维修工\n- 当前目标：找回钥匙\n\n## 赵宁\n- 编号：CH002\n- 身份：医生\n- 当前目标：帮助伤员\n';
const scene = (id: string, chapter: number, title = id) => ({
  id,
  chapter,
  title,
  goal: '寻找线索',
  obstacle: '大门关闭',
  choice: '询问守卫',
  outcome: '获得钥匙',
  promise: '寻找失踪者',
  storyTime: '清晨',
  protected: false
});
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=';

test('旧任务长指令可读取画布候选，标题摘要不改原指令、内容和采纳指纹', async () => {
  const f = refactorFixture();
  const request = '<!--内部说明不进入标题-->\n' + '保留原设定𠮷，核对本章正文与人物记忆。\n'.repeat(80);
  f.run.request = request;
  f.store.db.saveRun(f.run);
  const originalHash = proposalHash(f.run);
  f.store.close();
  const service = new Service(
    path.resolve('resources/skill'),
    () => {},
    async () => {
      throw new Error('候选读取不应调用模型');
    }
  );
  try {
    await service.open(f.root);
    const view = await service.invoke('workbench.read', { scope: { chapter: 1 } });
    const candidates = await service.invoke('workbench.candidates', {
      binding: { projectId: view.projectId, snapshotId: view.snapshotId, scope: view.scope }
    });
    const candidate = candidates.find((c) => c.id === f.run.id)!;
    assert.ok(candidate);
    candidateViewSchema.parse(candidate);
    assert.equal(candidate.fingerprint, originalHash);
    assert.equal(candidate.groups[0].changes[0].after, f.run.changes[0].content);
    assert.ok(Array.from(candidate.title).length <= 120);
    assert.ok(candidate.groups[0].title.endsWith('…'));
    assert.doesNotMatch(candidate.title, /内部说明|<!--|\n|\uFFFD/);
    assert.equal(service.store!.db.run(f.run.id).request, request);
    const manual = { ...f.run, mode: 'manual' as const };
    workbenchCandidateSchema.parse(bindWorkbenchCandidate(service.store!, manual, 'field', []));
    manual.workbench!.groups[0].title = request;
    const storedGroup = structuredClone(manual.workbench!.groups);
    candidateViewSchema.parse(candidateView(service.store!, manual));
    assert.deepEqual(manual.workbench!.groups, storedGroup);
    assert.equal(manual.request, request);
  } finally {
    service.close();
  }
});

function setup() {
  const f = refactorFixture();
  f.project.revision++;
  f.project.chapter = 3;
  const plot = {
    version: 1 as const,
    scenes: [scene('a', 1), scene('b', 2)],
    links: [
      {
        id: 'edge',
        from: 'scene:a',
        to: 'scene:b',
        kind: 'requires' as const,
        label: '先取得钥匙再开门',
        nonlinear: false
      }
    ]
  };
  f.store.commit(
    [
      { path: paths.roles, content: roles, baseHash: null },
      { path: paths.outline, content: chapterTableFixture, baseHash: null },
      { path: paths.volumes, content: volumeTableFixture, baseHash: null },
      { path: plotPath, content: renderPlotDocument(plot), baseHash: null }
    ],
    f.project
  );
  const view = readWorkbench(f.store, { chapter: 3 }),
    binding = { projectId: view.projectId, snapshotId: view.snapshotId, scope: view.scope },
    objectBinding = { ...binding, objectId: 'CH001' };
  const commit = (changes: Change[]) => {
    const p = f.store.db.project();
    p.revision++;
    f.store.commit(changes, p);
  };
  return { ...f, plot, view, binding, objectBinding, commit };
}

test('四层剧情投影保留计划与来源，读者和人物范围没有作者场景', () => {
  const f = setup();
  try {
    workbenchViewSchema.parse(f.view);
    plotViewSchema.parse(f.view.plot);
    const nodes = f.view.plot!.nodes;
    assert.deepEqual([...new Set(nodes.map((n) => n.level))].sort(), [
      'chapter',
      'project',
      'scene',
      'volume'
    ]);
    assert.equal(nodes.filter((n) => n.level === 'chapter').length, 30);
    for (const n of nodes.filter((n) => n.parentId))
      assert.ok(nodes.some((parent) => parent.id === n.parentId));
    const source = nodes.find((n) => n.id === 'scene:a')!.sources[0];
    assert.equal(
      Array.from(f.store.object(source.hash).toString()).slice(source.start, source.end).join(''),
      source.quote
    );
    for (const scope of [
      { viewpoint: 'reader' },
      { viewpoint: 'character', characterId: 'CH001' },
      { worldId: 'other' }
    ]) {
      const limited = readWorkbench(f.store, { chapter: 3, ...scope });
      assert.doesNotMatch(JSON.stringify(limited), /先取得钥匙|询问守卫|找回钥匙/);
      assert.equal(limited.plot!.document, null);
    }
    const context = plotContext(f.store.readAccepted(plotPath).content, 1);
    assert.match(context, /"a"/);
    assert.doesNotMatch(context, /"id":"b"/);
  } finally {
    f.store.close();
  }
});
test('章节表与中文章标题调序保留 Unicode 和未知内容，拒绝嵌套与歧义', () => {
  const original = '# 计划\n\n## 第一章 门𠮷\n- 目标：甲\n\n## 第二章 锁\n- 目标：乙\n\n## 附录\n保持原样\n';
  const moved = reorderPlanText(original, [1, 2], [2, 1]);
  assert.match(moved, /## 第1章 锁\n- 目标：乙/);
  assert.match(moved, /## 第2章 门𠮷/);
  assert.match(moved, /## 附录\n保持原样/);
  const table = reorderPlanText(chapterTableFixture, [1, 2], [2, 1]);
  assert.equal(chapterBlocks(table).length, 30);
  assert.match(table, /\| 001 \| 调查、兑现/);
  assert.equal(reorderPlanText(table, [1, 2], [2, 1]), chapterTableFixture);
  assert.equal(chapterBlocks('```md\n## 第999章 示例\n```\n\n' + original).length, 2);
  assert.throws(() => reorderPlanText('## 第1章 A\n### 第2章 B\n', [1, 2], [2, 1]), /嵌套/);
  assert.throws(() => reorderPlanText(original + '\n## 第1章 重复\n', [1, 2], [2, 1]), /重复/);
  assert.throws(() => reorderPlanText(original, [1, 3], [3, 1]), /部分/);
});
test('剧情连接拒绝悬空与重复标识，场景固定在实际提交端有效', () => {
  const f = setup();
  try {
    const base = f.store.db.document(plotPath)!.hash!;
    assert.throws(
      () => mutatePlot(f.store, base, { kind: 'link', link: { ...f.plot.links[0], to: 'scene:missing' } }),
      /不存在/
    );
    assert.throws(() => mutatePlot(f.store, base, { kind: 'deleteScene', id: 'a' }), /因果连接/);
    assert.throws(() => renderPlotDocument({ ...f.plot, links: [{ ...f.plot.links[0], id: 'a' }] }), /重复/);
    const fixed = { ...f.plot, scenes: f.plot.scenes.map((s) => ({ ...s, protected: true })) };
    f.commit([{ path: plotPath, content: renderPlotDocument(fixed), baseHash: base }]);
    assert.throws(
      () =>
        f.commit([
          {
            path: plotPath,
            content: renderPlotDocument({
              ...fixed,
              scenes: [{ ...fixed.scenes[0], title: '改变' }, fixed.scenes[1]]
            }),
            baseHash: f.store.db.document(plotPath)!.hash!
          }
        ]),
      /解除场景固定/
    );
    const view = readWorkbench(f.store, { chapter: 3 });
    const preview = prepareReorder(
      f.store,
      { projectId: view.projectId, snapshotId: view.snapshotId, scope: view.scope },
      [2, 1]
    );
    assert.ok(preview.preview.issues.some((i) => i.severity === 'error' && i.message.includes('固定')));
    const unlocked = mutatePlot(f.store, f.store.db.document(plotPath)!.hash!, {
      kind: 'scene',
      scene: { ...fixed.scenes[0], protected: false }
    });
    f.commit([unlocked]);
    assert.equal(
      parsePlotDocument(f.store.readAccepted(plotPath).content).scenes.find((s) => s.id === 'a')!.protected,
      false
    );
  } finally {
    f.store.close();
  }
});
test('调序依赖预览绑定当前版本和内容，必须说明顺序反转且不能截断关联文件', () => {
  const f = setup();
  try {
    const result = prepareReorder(f.store, f.binding, [2, 1]),
      issue = result.preview.issues.find((i) => i.category === 'causality')!;
    assert.ok(issue);
    assert.equal(result.preview.requiresRevision, false);
    assert.equal(result.preview.issues.filter((i) => i.severity === 'error').length, 0);
    assert.throws(() => validateReorderDecisions(result.preview, []), /逐项/);
    assert.throws(
      () =>
        validateReorderDecisions(result.preview, [
          { issueId: issue.id, action: 'revise', reason: '修改正文' }
        ]),
      /尚无正文/
    );
    const decisions = validateReorderDecisions(result.preview, [
      { issueId: issue.id, action: 'nonlinear', reason: '第二章开门为倒叙，随后呈现取钥匙' }
    ]);
    const run = {
      ...f.run,
      mode: 'manual' as const,
      baseRevision: f.store.db.project().revision,
      baseSnapshotId: f.binding.snapshotId,
      changes: resolvedReorderChanges(result, decisions)
    };
    assert.equal(
      parsePlotDocument(run.changes.find((change) => change.path === plotPath)!.content).links.find(
        (link) => link.id === issue.objectId
      )!.nonlinear,
      true
    );
    const metadata = bindWorkbenchCandidate(f.store, run, 'reorder', ['chapter:1', 'chapter:2']);
    metadata.sourceHashes = result.sourceHashes;
    metadata.reorder = {
      before: result.preview.before,
      after: result.preview.after,
      fingerprint: result.preview.fingerprint,
      decisions
    };
    assert.doesNotThrow(() => assertWorkbenchCandidate(f.store, run));
    assert.throws(
      () => assertWorkbenchCandidate(f.store, { ...run, changes: run.changes.slice(0, 1) }),
      /不能部分/
    );
    assert.throws(
      () =>
        assertWorkbenchCandidate(f.store, {
          ...run,
          changes: run.changes.map((c, i) => (i ? c : { ...c, content: c.content + '\n额外内容' }))
        }),
      /预览不一致/
    );
    assert.notEqual(
      proposalHash(run),
      proposalHash({ ...run, workbench: { ...metadata, reorder: { ...metadata.reorder, decisions: [] } } })
    );
    f.commit([{ path: '附录.md', content: '新版本', baseHash: null }]);
    assert.throws(() => assertWorkbenchCandidate(f.store, run), /版本已改变/);
  } finally {
    f.store.close();
  }
});
test('已写章节调序经过正文核心核对，部分已写与失效资料不能放行', () => {
  const f = setup();
  try {
    f.commit([
      { path: prosePath(1), content: '# 第一章\n拿到钥匙。', baseHash: null },
      { path: prosePath(2), content: '# 第二章\n打开大门。', baseHash: null }
    ]);
    let view = readWorkbench(f.store, { chapter: 3 }),
      binding = { ...f.binding, snapshotId: view.snapshotId, scope: view.scope };
    const result = prepareReorder(f.store, binding, [2, 1]);
    assert.equal(result.preview.requiresRevision, true);
    assert.match(result.changes.find((c) => c.path === prosePath(1))!.content, /# 第1章\n打开大门/);
    const run = {
      ...f.run,
      mode: 'manual' as const,
      revisionCoreRequired: 1 as const,
      changes: result.changes
    };
    assert.throws(
      () => new ProjectCommitService(f.store).commit(run.changes, f.store.db.project(), run),
      /核对/
    );
    assert.ok(
      prepareReorder(f.store, binding, [3, 1]).preview.issues.some((i) => i.message.includes('不能混排'))
    );
    fs.appendFileSync(path.join(f.root, prosePath(1)), '外部修改');
    assert.ok(
      prepareReorder(f.store, binding, [2, 1]).preview.issues.some(
        (i) => i.severity === 'error' && i.message.includes('外部改动')
      )
    );
  } finally {
    f.store.close();
  }
});
test('字段候选只允许指定字段变化，图与展示变更不冒充正文事实', () => {
  const f = setup();
  try {
    const field = f.view.objects.find((o) => o.id === 'CH001')!.fields.find((f) => f.label === '当前目标')!;
    const change = proposeWorkbenchField(f.store, f.objectBinding, field.id, '修好供水系统');
    const run = {
      ...f.run,
      mode: 'manual' as const,
      baseRevision: f.store.db.project().revision,
      baseSnapshotId: f.binding.snapshotId,
      changes: [change]
    };
    bindWorkbenchCandidate(
      f.store,
      run,
      'field',
      ['CH001'],
      [{ objectId: 'CH001', fieldId: field.id, path: change.path }]
    );
    assert.doesNotThrow(() => assertWorkbenchCandidate(f.store, run));
    candidateViewSchema.parse(candidateView(f.store, run));
    assert.throws(
      () =>
        assertWorkbenchCandidate(f.store, {
          ...run,
          changes: [{ ...change, content: change.content.replace('医生', '将军') }]
        }),
      /超出/
    );
    const other = { ...run, changes: [...run.changes, { path: '附录.md', content: '多余', baseHash: null }] };
    assert.throws(() => assertWorkbenchCandidate(f.store, other), /未授权/);
    assert.deepEqual(
      plotAffectedChapters(
        renderPlotDocument(f.plot),
        renderPlotDocument({ ...f.plot, scenes: [{ ...f.plot.scenes[0], goal: '改目标' }, f.plot.scenes[1]] })
      ),
      [1, 2]
    );
  } finally {
    f.store.close();
  }
});
test('未来章节可以在含已写章节的卷中调序，不涉及未移动的正文或细纲', () => {
  const f = setup();
  try {
    f.commit([
      { path: prosePath(1), content: '# 第1章\n林川得到钥匙。', baseHash: null },
      { path: detailPath(1), content: '# 第1章细纲\n## 场景一 门前\n- 目标：寻找钥匙', baseHash: null }
    ]);
    const view = readWorkbench(f.store, { chapter: 3 }),
      binding = { projectId: view.projectId, snapshotId: view.snapshotId, scope: view.scope };
    const result = prepareReorder(f.store, binding, [1, 3, 2]);
    assert.equal(result.preview.requiresRevision, false);
    assert.deepEqual(
      result.preview.issues.filter((i) => i.severity === 'error'),
      []
    );
    assert.equal(
      result.changes.some((c) => c.path === prosePath(1) || c.path === detailPath(1)),
      false
    );
    const expanded = readWorkbench(f.store, view.scope, 1),
      legacy = expanded.objects.find((o) => o.id.startsWith('legacy-scene:'))!;
    assert.ok(legacy);
    assert.equal(
      resolveWorkbenchObject(f.store, { ...binding, objectId: legacy.id }).object.title,
      legacy.title
    );
  } finally {
    f.store.close();
  }
});
test('未标注编号的旧人物卡在唯一身份匹配时复用对象，头像公开范围按稳定人物身份读取', () => {
  const f = setup();
  try {
    const prose = '林川在泵房等候。',
      fact = factSchema.parse({
        id: 'person',
        subject: '林川',
        predicate: '位置',
        value: '泵房',
        category: 'character',
        entityIds: ['CH001'],
        kind: 'event',
        fromChapter: 1,
        revealedAt: 1,
        reviewStatus: 'accepted',
        knowledge: [{ who: 'CH001', fromChapter: 1, mode: 'seen' }],
        evidence: [{ path: prosePath(1), hash: hash(prose), quote: prose }]
      });
    f.commit([
      { path: paths.roles, content: roles.replace('- 编号：CH001\n', ''), baseHash: hash(roles) },
      { path: prosePath(1), content: prose, baseHash: null },
      { path: paths.items, content: encodeFacts('# 状态', [fact]), baseHash: null }
    ]);
    let view = readWorkbench(f.store, { chapter: 3 });
    const object = view.objects.find((o) => o.title === '林川' && o.kind === 'character')!;
    assert.equal(view.objects.filter((o) => o.kind === 'character' && o.title === '林川').length, 1);
    assert.ok(object.entityIds.includes('CH001'));
    let binding = {
      projectId: view.projectId,
      snapshotId: view.snapshotId,
      scope: view.scope,
      objectId: object.id
    };
    f.commit([proposeAvatar(f.store, binding, png, '林川.png', null)]);
    let reader = readWorkbench(f.store, { chapter: 3, viewpoint: 'reader' }),
      readerObject = reader.objects.find((o) => o.kind === 'character')!;
    assert.equal(
      readAvatar(f.store, {
        projectId: reader.projectId,
        snapshotId: reader.snapshotId,
        scope: reader.scope,
        objectId: readerObject.id
      }),
      null
    );
    view = readWorkbench(f.store, { chapter: 3 });
    binding = { ...binding, snapshotId: view.snapshotId, scope: view.scope };
    f.commit([proposeAvatar(f.store, binding, png, '公开头像.png', 2)]);
    reader = readWorkbench(f.store, { chapter: 3, viewpoint: 'reader' });
    assert.ok(
      readAvatar(f.store, {
        projectId: reader.projectId,
        snapshotId: reader.snapshotId,
        scope: reader.scope,
        objectId: readerObject.id
      })
    );
  } finally {
    f.store.close();
  }
});
test('头像使用独立版本与有限图片格式，历史还原且未公开图片不进入读者范围', () => {
  const f = setup();
  try {
    const before = f.store.db.headRef()!.id;
    const change = proposeAvatar(f.store, f.objectBinding, png, '林川.png', null);
    f.commit([change]);
    const current = readWorkbench(f.store, { chapter: 3 }),
      binding = { ...f.objectBinding, snapshotId: current.snapshotId, scope: current.scope };
    const image = readAvatar(f.store, binding)!;
    parseOutput('workbench.avatar', image);
    assert.equal(image.metadata.version, 1);
    assert.equal(image.dataUrl, png);
    assert.equal(
      readAvatar(f.store, {
        ...f.objectBinding,
        snapshotId: before,
        scope: { ...f.view.scope, mode: 'historical', snapshotId: before }
      }),
      null
    );
    assert.throws(
      () => proposeAvatar(f.store, binding, 'data:image/svg+xml;base64,PHN2Zz4=', 'x', 0),
      /图片/
    );
    assert.throws(
      () => proposeAvatar(f.store, binding, png.replace('image/png', 'image/jpeg'), 'x', 0),
      /类型/
    );
    assert.throws(
      () =>
        f.commit([
          {
            ...change,
            baseHash: f.store.db.document(mediaPath)!.hash!,
            content: change.content.replace(image.metadata.hash, 'f'.repeat(64))
          }
        ]),
      /对象|ENOENT|不存在/
    );
    const updated = proposeAvatar(f.store, binding, png, '林川二版.png', 3);
    f.commit([updated]);
    const next = readWorkbench(f.store, { chapter: 3 });
    assert.equal(
      readAvatar(f.store, { ...binding, snapshotId: next.snapshotId, scope: next.scope })!.metadata.version,
      2
    );
    assert.equal(
      readAvatar(f.store, { ...binding, scope: { ...binding.scope, mode: 'historical' } })!.metadata.version,
      1
    );
    assert.equal(f.store.readAccepted(paths.roles).content, roles);
  } finally {
    f.store.close();
  }
});
test('世界因果与地图保留未知距离，模型不能通过图关系改写固定模块', () => {
  const f = setup();
  try {
    const model = readWorldModel(f.store);
    model.modules[0].state = 'enabled';
    model.modules[0].content = '城市由蒸汽驱动';
    model.modules[1].state = 'enabled';
    model.modules[1].content = '山城与渡口相连';
    model.modules[0].rule = {
      scope: '城市',
      trigger: '启动锅炉',
      boundary: '仅驱动机械',
      cost: '燃料',
      exception: '停炉检修',
      evidence: '第一章'
    };
    model.links = [
      {
        id: 'causal',
        from: model.modules[0].id,
        to: model.modules[1].id,
        kind: 'enables',
        label: '蒸汽推动缆车'
      }
    ];
    model.places = [
      { id: 'city', title: '山城', description: '城门在南侧' },
      { id: 'port', title: '渡口', description: '' }
    ];
    model.routes = [
      { id: 'route', from: 'city', to: 'port', label: '缆车', direction: '南', distance: null }
    ];
    const content = renderWorldModel(model);
    assert.deepEqual(parseWorldModel(content), model);
    assert.match(worldContext(content), /启动锅炉|蒸汽推动缆车|"distance":null/);
    assert.throws(
      () => renderWorldModel({ ...model, routes: [{ ...model.routes![0], to: 'missing' }] }),
      /端点不存在/
    );
    assert.throws(
      () => renderWorldModel({ ...model, places: [{ ...model.places![0], moduleId: 'missing' }] }),
      /模块不存在/
    );
    f.commit([{ path: paths.world, content, baseHash: null }]);
    const view = readWorkbench(f.store, { chapter: 3 });
    assert.equal(view.world?.routes?.[0].distance, null);
    const disabled = structuredClone(model);
    disabled.modules[0].state = 'disabled';
    assert.doesNotMatch(worldContext(renderWorldModel(disabled)), /启动锅炉|蒸汽推动缆车/);
    model.modules[0].locked = true;
    f.commit([{ path: paths.world, content: renderWorldModel(model), baseHash: hash(content) }]);
    const altered = structuredClone(model);
    altered.modules[0].rule!.cost = '没有成本';
    assert.ok(
      worldCandidateIssues(
        f.store,
        [
          {
            path: paths.world,
            content: renderWorldModel(altered),
            baseHash: f.store.db.document(paths.world)!.hash
          }
        ],
        false
      ).some((i) => i.severity === 'error')
    );
    const alteredLink = structuredClone(model);
    alteredLink.links![0].label = '改写固定规则的因果';
    assert.ok(
      worldCandidateIssues(
        f.store,
        [
          {
            path: paths.world,
            content: renderWorldModel(alteredLink),
            baseHash: f.store.db.document(paths.world)!.hash
          }
        ],
        false
      ).some((issue) => issue.severity === 'error')
    );
  } finally {
    f.store.close();
  }
});
test('人物状态沿已采纳证据排列且受知情与版本限制，不把未来计划填进状态', () => {
  const f = setup();
  try {
    const prose = '林川在门口等候。林川来到渡口。林川计划明天去山城。';
    const make = (id: string, from: number, value: string, quote: string) =>
      factSchema.parse({
        id,
        subject: '林川',
        predicate: '位置',
        value,
        category: 'character',
        entityIds: ['CH001'],
        kind: 'event',
        fromChapter: from,
        revealedAt: from,
        reviewStatus: 'accepted',
        knowledge: [{ who: 'CH001', fromChapter: from, mode: 'seen' }],
        evidence: [{ path: prosePath(1), hash: hash(prose), quote }]
      });
    const old = make('old', 1, '门口', '林川在门口等候。');
    old.state = 'superseded';
    old.toChapter = 1;
    const recent = make('recent', 2, '渡口', '林川来到渡口。');
    recent.supersedes = 'old';
    recent.replacementReason = '抵达渡口';
    const plan = { ...make('plan', 3, '明天到山城', '林川计划明天去山城。'), kind: 'plan' as const };
    f.commit([
      { path: prosePath(1), content: prose, baseHash: null },
      { path: paths.items, content: encodeFacts('# 状态', [old, recent, plan]), baseHash: null }
    ]);
    const view = readWorkbench(f.store, { chapter: 3 }),
      binding = { ...f.objectBinding, snapshotId: view.snapshotId, scope: view.scope };
    const history = workbenchHistory(f.store, binding);
    stateHistorySchema.parse(history);
    assert.deepEqual(
      history.changes.map((c) => c.value),
      ['门口', '渡口']
    );
    assert.ok(history.comparison);
    const reader = readWorkbench(f.store, { chapter: 1, viewpoint: 'reader' }),
      character = reader.objects.find((o) => o.kind === 'character')!;
    const earlier = workbenchHistory(f.store, { ...binding, objectId: character.id, scope: reader.scope });
    assert.deepEqual(
      earlier.changes.map((c) => c.value),
      ['门口']
    );
    assert.throws(() => workbenchHistory(f.store, binding, 'foreign-snapshot'), /更早版本/);
    f.commit([{ path: paths.roles, content: roles.replace('维修工', '机械师'), baseHash: hash(roles) }]);
    const newer = readWorkbench(f.store, { chapter: 3 });
    assert.ok(
      workbenchHistory(f.store, {
        ...binding,
        snapshotId: newer.snapshotId,
        scope: newer.scope
      }).comparison!.fields.some((f) => f.before === '维修工' && f.after === '机械师')
    );
  } finally {
    f.store.close();
  }
});
test('外部修改进入待核对，历史快照仍可阅读', () => {
  const f = setup();
  try {
    fs.appendFileSync(path.join(f.root, paths.roles), '外部改动');
    fs.appendFileSync(path.join(f.root, plotPath), '外部改动');
    const current = readWorkbench(f.store, { chapter: 3 });
    assert.ok(current.unavailable.includes(paths.roles));
    assert.ok(current.unavailable.includes('剧情结构'));
    assert.equal(
      current.objects.some((o) => o.id === 'CH001'),
      false
    );
    const historical = readWorkbench(f.store, { ...f.view.scope, mode: 'historical' });
    assert.ok(historical.objects.some((o) => o.id === 'CH001'));
    assert.ok(historical.plot);
  } finally {
    f.store.close();
  }
});
test('真实宿主原子采纳未写章节调序，保存倒叙解释且保留已采纳事实', async () => {
  let calls = 0;
  const service = new Service(
    path.resolve('resources/skill'),
    () => {},
    async () => {
      calls++;
      throw new Error('禁止模型调用');
    }
  );
  service.profiles = [{ ...fakeProfile, id: 'fixture' }];
  try {
    await createVisualWorkbenchFixture(service, isolatedRoot('visual-reorder-host'));
    const store = service.store!;
    const view = await service.invoke('workbench.read', { scope: { chapter: 2 } });
    const binding = { projectId: view.projectId, snapshotId: view.snapshotId, scope: view.scope };
    const order = Array.from({ length: 30 }, (_, i) => i + 1);
    [order[2], order[3]] = [4, 3];
    const preview = await service.invoke('workbench.reorderPreview', { binding, order });
    assert.equal(preview.requiresRevision, false);
    assert.equal(preview.issues.length, 1);
    const id = await service.invoke('workbench.reorderPropose', {
      binding,
      order,
      fingerprint: preview.fingerprint,
      decisions: preview.issues.map((issue) => ({
        issueId: issue.id,
        action: 'nonlinear' as const,
        reason: '先叙结果，再回忆拿到钥匙的经过'
      }))
    });
    const candidate = (await service.invoke('workbench.candidates', { binding })).find((c) => c.id === id)!;
    await service.invoke('workbench.accept', {
      id,
      fingerprint: candidate.fingerprint,
      groups: candidate.groups.map((g) => g.id)
    });
    assert.equal(store.db.run(id).accepted, true);
    const plot = parsePlotDocument(store.readAccepted(plotPath).content);
    assert.equal(plot.scenes.find((s) => s.id === 'pump-key')!.chapter, 4);
    assert.equal(plot.scenes.find((s) => s.id === 'open-pump')!.chapter, 3);
    assert.equal(plot.links.find((l) => l.id === 'key-opens')!.nonlinear, true);
    assert.equal(
      store.db.project().stale.some((file) => file.startsWith('04_') || file === prosePath(1)),
      false
    );
    const after = await service.invoke('workbench.read', { scope: { chapter: 2 } });
    assert.equal(
      after.objects.find((o) => o.id === 'CH001')!.fields.find((f) => f.label === '位置')!.value,
      '泵房'
    );
    assert.equal(calls, 0);
  } finally {
    await service.drain();
  }
});

test('宿主画布候选可保留分支与原子采纳，头像采纳不使正文与资料失效，所有操作零模型调用', async () => {
  let calls = 0;
  const service = new Service(
    path.resolve('resources/skill'),
    () => {},
    async () => {
      calls++;
      throw new Error('禁止模型调用');
    }
  );
  service.profiles = [fakeProfile];
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('visual-host'),
      title: '画布验收',
      premise: '找钥匙',
      config: { defaultProfileId: fakeProfile.id }
    });
    const store = service.store!,
      p = store.db.project();
    p.revision++;
    store.commit(
      [{ path: paths.roles, content: roles, baseHash: store.db.document(paths.roles)?.hash ?? null }],
      p
    );
    let view = await service.invoke('workbench.read', { scope: { chapter: 1 } }),
      binding = { projectId: view.projectId, snapshotId: view.snapshotId, scope: view.scope },
      objectBinding = { ...binding, objectId: 'CH001' };
    const field = view.objects.find((o) => o.id === 'CH001')!.fields.find((f) => f.label === '当前目标')!;
    const chat = await service.invoke('workbench.discuss', {
      binding: { ...objectBinding, fieldId: field.id }
    });
    assert.equal(chat.objectBinding?.fieldId, field.id);
    const id = await service.invoke('workbench.avatarPropose', {
      binding: objectBinding,
      dataUrl: png,
      name: '人物.png',
      revealedAt: null
    });
    const candidates = await service.invoke('workbench.candidates', { binding });
    parseOutput('workbench.candidates', candidates);
    const candidate = candidates.find((c) => c.id === id)!;
    assert.ok(candidate);
    const branch = await service.invoke('workbench.branch', {
      id,
      fingerprint: candidate.fingerprint,
      title: '外观分支'
    });
    assert.equal(
      (
        await service.invoke('workbench.branch', {
          id,
          fingerprint: candidate.fingerprint,
          title: '外观分支'
        })
      ).id,
      branch.id
    );
    assert.ok(store.read(branch.path).content.includes('人物.png'));
    assert.equal(store.db.document(mediaPath)?.hash ?? null, null);
    await assert.rejects(
      service.invoke('workbench.accept', { id, fingerprint: candidate.fingerprint, groups: ['wrong'] }),
      /关联修改/
    );
    await service.invoke('workbench.accept', {
      id,
      fingerprint: candidate.fingerprint,
      groups: candidate.groups.map((g) => g.id)
    });
    assert.equal(store.db.project().stale.length, 0);
    assert.equal(store.db.run(id).accepted, true);
    await service.invoke('workbench.accept', {
      id,
      fingerprint: proposalHash(store.db.run(id)),
      groups: candidate.groups.map((g) => g.id)
    });
    view = await service.invoke('workbench.read', { scope: { chapter: 1 } });
    binding = { projectId: view.projectId, snapshotId: view.snapshotId, scope: view.scope };
    const sceneId = await service.invoke('workbench.plotPropose', {
      binding,
      baseHash: null,
      mutation: { kind: 'scene', scene: scene('later', 2) }
    });
    const entry = (await service.invoke('workbench.candidates', { binding })).find((c) => c.id === sceneId)!;
    await service.invoke('workbench.accept', {
      id: sceneId,
      fingerprint: entry.fingerprint,
      groups: entry.groups.map((g) => g.id)
    });
    assert.equal(store.db.project().stale.includes(paths.roles), false);
    assert.ok(parsePlotDocument(store.readAccepted(plotPath).content).scenes.length);
    view = await service.invoke('workbench.read', { scope: { chapter: 1 } });
    const fieldRunId = await service.invoke('workbench.field', {
      binding: {
        projectId: view.projectId,
        snapshotId: view.snapshotId,
        scope: view.scope,
        objectId: 'CH001'
      },
      fieldId: field.id,
      value: '检查备用阀门'
    });
    const old = store.db.run(fieldRunId),
      rebuilt = service.rebuildRun(old, fakeProfile.id, '仅调整此目标的表述');
    assert.deepEqual(rebuilt.workbench, old.workbench);
    assert.equal(store.db.run(old.id).status, 'discarded');
    const next = store.db.project();
    next.revision++;
    store.commit([{ path: '附录.md', content: '新的正式版本', baseHash: null }], next);
    assert.throws(() => service.rebuildRun(rebuilt, fakeProfile.id), /回到共创画布/);
    assert.equal(calls, 0);
  } finally {
    await service.drain();
  }
});
