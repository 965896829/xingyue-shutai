import test from 'node:test';
import assert from 'node:assert/strict';
import { refactorFixture, fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import {
  readWorkbench,
  proposeWorkbenchField,
  setWorkbenchLock,
  workbenchDiscussionContext
} from '../src/core/workbench';
import { documentWorkbenchObjects } from '../src/core/workbench-documents';
import { paths, hash, prosePath } from '../src/core/domain';
import { factSchema } from '../src/shared/types';
import { encodeFacts } from '../src/core/memory-records';
import { workbenchViewSchema, type WorkbenchBinding } from '../src/shared/workbench';
import { Service } from '../src/core/service';
import path from 'node:path';

const roles =
  '# 角色卡\n\n## 林川\n- 编号：CH001\n- 身份：维修工\n- 当前目标：找回钥匙\n\n## 赵宁\n- 编号：CH002\n- 身份：医生\n- 当前目标：找回钥匙\n';
const relation = '# 关系\n\n| 人物A | 人物B | 关系 |\n| --- | --- | --- |\n| 林川 | 赵宁 | 相互试探 |';
function fixture() {
  const f = refactorFixture();
  f.project.revision++;
  f.store.commit(
    [
      { path: paths.roles, content: roles, baseHash: null },
      { path: paths.relations, content: relation, baseHash: null }
    ],
    f.project
  );
  const view = readWorkbench(f.store, { chapter: f.project.chapter, projectId: f.project.id });
  const binding: WorkbenchBinding = {
    projectId: view.projectId,
    snapshotId: view.snapshotId,
    objectId: 'CH001',
    scope: view.scope
  };
  return { ...f, view, binding };
}

test('共享画布解析稳定人物与字段，重复文字按所在人物定位', () => {
  const f = fixture();
  try {
    workbenchViewSchema.parse(f.view);
    const object = f.view.objects.find((o) => o.id === 'CH001')!;
    const field = object.fields.find((v) => v.label === '当前目标')!;
    const change = proposeWorkbenchField(f.store, f.binding, field.id, '守住修理站');
    assert.match(change.content, /林川[\s\S]*当前目标：守住修理站/);
    assert.match(change.content, /赵宁[\s\S]*当前目标：找回钥匙/);
    assert.equal(f.store.readAccepted(paths.roles).content, roles);
    const next = documentWorkbenchObjects(
      paths.roles,
      roles.replace('- 身份：维修工', '- 年龄：三十\n- 身份：维修工')
    );
    assert.equal(
      next.find((o) => o.id === 'CH001')!.fields.find((v) => v.label === '当前目标')!.id,
      field.id
    );
    const edge = f.view.objects.find((o) => o.kind === 'relation')!,
      relationship = edge.fields.find((v) => v.label === '关系')!;
    const table = proposeWorkbenchField(
      f.store,
      { ...f.binding, objectId: edge.id },
      relationship.id,
      '约定合作'
    );
    assert.match(table.content, /\| 林川 \| 赵宁 \| 约定合作 \|/);
    assert.throws(() => proposeWorkbenchField(f.store, f.binding, field.id, '第一行\n第二行'), /单行/);
  } finally {
    f.store.close();
  }
});

test('固定字段在正式提交端保护，其他字段可以更新，历史与过期绑定不能修改', () => {
  const f = fixture();
  try {
    const field = f.view.objects.find((o) => o.id === 'CH001')!.fields.find((v) => v.label === '当前目标')!;
    setWorkbenchLock(f.store, f.binding, field.id, true);
    assert.throws(() => proposeWorkbenchField(f.store, f.binding, field.id, '逃走'), /解除/);
    const baseHash = hash(roles),
      p = f.store.db.project();
    p.revision++;
    assert.throws(
      () => f.store.commit([{ path: paths.roles, content: roles.replace('找回钥匙', '逃走'), baseHash }], p),
      /已固定/
    );
    assert.equal(f.store.db.headRef()!.id, f.view.snapshotId);
    const content = roles.replace('维修工', '机械师');
    f.store.commit([{ path: paths.roles, content, baseHash }], p);
    assert.throws(() => proposeWorkbenchField(f.store, f.binding, field.id, '逃走'), /版本已变化/);
    const historical = readWorkbench(f.store, { ...f.view.scope, mode: 'historical' });
    assert.equal(historical.editable, false);
    assert.equal(
      historical.objects.find((o) => o.id === 'CH001')!.fields.find((v) => v.label === '身份')!.value,
      '维修工'
    );
    assert.throws(
      () => workbenchDiscussionContext(f.store, { ...f.binding, projectId: 'other-project' }),
      /作品或版本/
    );
    const fresh = readWorkbench(f.store, { chapter: 1 });
    setWorkbenchLock(
      f.store,
      { ...f.binding, snapshotId: fresh.snapshotId, scope: fresh.scope },
      field.id,
      false
    );
    const changed = proposeWorkbenchField(
      f.store,
      { ...f.binding, snapshotId: fresh.snapshotId, scope: fresh.scope },
      field.id,
      '逃走'
    );
    assert.match(changed.content, /逃走/);
  } finally {
    f.store.close();
  }
});

test('画布切换截止章节和视角不携带作者档案、未来事件或失效来源', () => {
  const f = fixture();
  try {
    const prose = '林川在门口等候。钥匙在地下。',
      file = prosePath(1),
      quote = '林川在门口等候。';
    const facts = [
      factSchema.parse({
        id: 'visible',
        subject: '林川',
        predicate: '位置',
        value: '门口',
        category: 'character',
        kind: 'event',
        entityIds: ['CH001'],
        fromChapter: 1,
        revealedAt: 1,
        reviewStatus: 'accepted',
        knowledge: [{ who: 'CH001', fromChapter: 1, mode: 'seen' }],
        evidence: [{ path: file, hash: hash(prose), quote }]
      }),
      factSchema.parse({
        id: 'secret',
        subject: '钥匙',
        predicate: '位置',
        value: 'CANARY-隐藏地点',
        category: 'item',
        kind: 'event',
        fromChapter: 1,
        revealedAt: 9,
        reviewStatus: 'accepted',
        evidence: [{ path: file, hash: hash(prose), quote: '钥匙在地下。' }]
      })
    ];
    const project = f.store.db.project();
    project.revision++;
    f.store.commit(
      [
        { path: file, content: prose, baseHash: null },
        { path: paths.items, content: encodeFacts('# 事实', facts), baseHash: null }
      ],
      project
    );
    const reader = readWorkbench(f.store, { chapter: 1, viewpoint: 'reader' });
    assert.equal(reader.editable, false);
    assert.match(JSON.stringify(reader.objects), /门口/);
    assert.doesNotMatch(JSON.stringify(reader.objects), /CANARY|维修工|医生|找回钥匙/);
    const before = readWorkbench(f.store, { chapter: 0, viewpoint: 'reader' });
    assert.equal(before.objects.length, 0);
    const person = readWorkbench(f.store, { chapter: 1, viewpoint: 'character', characterId: 'CH001' });
    assert.equal(person.objects.length, 1);
    const unknown = readWorkbench(f.store, { chapter: 1, viewpoint: 'character', characterId: 'CH002' });
    assert.equal(unknown.objects.length, 0);
    const updated = f.store.db.project();
    updated.revision++;
    f.store.commit([{ path: file, content: '林川走了。', baseHash: hash(prose) }], updated);
    assert.equal(readWorkbench(f.store, { chapter: 1, viewpoint: 'reader' }).objects.length, 0);
  } finally {
    f.store.close();
  }
});

test('真实宿主创建对象讨论和字段候选不发送模型请求，不直接改正式文稿', async () => {
  let calls = 0;
  const service = new Service(
    path.resolve('resources/skill'),
    () => {},
    async () => {
      calls++;
      return fakeResult();
    }
  );
  service.profiles = [fakeProfile];
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('canvas-service'),
      title: '对象画布',
      premise: '维修工与医生寻找钥匙',
      config: { defaultProfileId: fakeProfile.id }
    });
    const store = service.store!,
      project = store.db.project();
    project.revision++;
    store.commit(
      [{ path: paths.roles, content: roles, baseHash: store.db.document(paths.roles)?.hash ?? null }],
      project
    );
    const view = await service.invoke('workbench.read', { scope: { chapter: 1 } });
    const binding = {
      projectId: view.projectId,
      snapshotId: view.snapshotId,
      objectId: 'CH001',
      scope: view.scope
    };
    const conversation = await service.invoke('workbench.discuss', { binding });
    const again = await service.invoke('workbench.discuss', { binding });
    assert.equal(conversation.id, again.id);
    assert.deepEqual(conversation.objectBinding, binding);
    assert.match(workbenchDiscussionContext(store, binding), /找回钥匙/);
    assert.throws(
      () =>
        service.chat!.propose(conversation.id, '', fakeProfile.id, {
          kind: 'revision',
          goal: '越界',
          scope: '越界',
          request: '越界',
          outputs: [prosePath(1)]
        }),
      /当前对象/
    );
    const field = view.objects.find((o) => o.id === 'CH001')!.fields.find((v) => v.label === '当前目标')!;
    const runId = await service.invoke('workbench.field', { binding, fieldId: field.id, value: '修好水泵' });
    assert.equal(store.db.run(runId).mode, 'manual');
    assert.equal(store.db.run(runId).accepted, false);
    assert.equal(store.readAccepted(paths.roles).content, roles);
    assert.equal(calls, 0);
  } finally {
    await service.drain();
  }
});
