import type { Service } from '../../src/core/service';
import { paths, prosePath, hash } from '../../src/core/domain';
import { renderPlotDocument, plotPath } from '../../src/core/workbench-plot';
import { readWorldModel, renderWorldModel } from '../../src/core/world-model';
import { factSchema } from '../../src/shared/types';
import { encodeFacts } from '../../src/core/memory-records';
import { fixture } from './workflow';
import { chapterTableFixture, volumeTableFixture } from './readable-tables';

export async function createVisualWorkbenchFixture(service: Service, parent: string) {
  await service.invoke('project.create', {
    parent,
    title: '山城供水记',
    premise: '维修师与医生寻找水源',
    config: {
      defaultProfileId: 'fixture',
      expressionRules: { enabled: false },
      preview: { enabled: false, maxCalls: 8 }
    }
  });
  const store = service.store!,
    p = store.db.project();
  p.stage = 'S06';
  p.chapter = 2;
  p.revision++;
  const roles = fixture(p, paths.roles, service)
    .replace(/阿宁/g, '林川')
    .replace(/(#{2,6} 林川[^\r\n]*\r?\n)/, '$1- 编号：CH001\n');
  const world = readWorldModel(store);
  world.modules.find((m) => m.id === 'world-foundation')!.state = 'enabled';
  world.modules.find((m) => m.id === 'world-foundation')!.content =
    '山城用蒸汽驱动水泵，停炉会使高处的居民断水。';
  world.modules.find((m) => m.id === 'world-foundation')!.rule = {
    scope: '山城的公共供水',
    trigger: '锅炉压力达到工作范围',
    boundary: '只驱动相连的机械',
    cost: '消耗燃料与清水',
    exception: '储水罐可短时供水',
    evidence: '第一章泵房检修'
  };
  world.modules.find((m) => m.id === 'geography-mobility')!.state = 'enabled';
  world.modules.find((m) => m.id === 'geography-mobility')!.content = '泵房在山脚，居民区与渡口由缆车相连。';
  world.links = [
    {
      id: 'steam-route',
      from: 'world-foundation',
      to: 'geography-mobility',
      kind: 'enables',
      label: '蒸汽也为缆车供能'
    }
  ];
  world.places = [
    { id: 'pump', title: '泵房', description: '山脚的蒸汽水泵', moduleId: 'geography-mobility' },
    { id: 'town', title: '居民区', description: '山上的街巷', moduleId: 'geography-mobility' },
    { id: 'port', title: '渡口', description: '货船停靠处', moduleId: 'geography-mobility' }
  ];
  world.routes = [
    { id: 'route-1', from: 'pump', to: 'town', label: '输水管线', direction: '', distance: null },
    {
      id: 'route-2',
      from: 'town',
      to: 'port',
      label: '缆车',
      direction: '南',
      distance: { value: 3, unit: '里' }
    }
  ];
  const plot = {
    version: 1 as const,
    scenes: [
      {
        id: 'pump-key',
        chapter: 3,
        title: '取回泵房钥匙',
        goal: '进入泵房',
        obstacle: '守卫不信任维修师',
        choice: '展示维修记录',
        outcome: '拿到钥匙',
        promise: '恢复供水',
        storyTime: '断水当日清晨',
        protected: false
      },
      {
        id: 'open-pump',
        chapter: 4,
        title: '打开检修门',
        goal: '检查主阀',
        obstacle: '门后传来水声',
        choice: '先关闭支线',
        outcome: '发现破损的管道',
        promise: '找到漏水原因',
        storyTime: '同日上午',
        protected: false
      }
    ],
    links: [
      {
        id: 'key-opens',
        from: 'scene:pump-key',
        to: 'scene:open-pump',
        kind: 'requires' as const,
        label: '拿到钥匙后打开检修门',
        nonlinear: false
      }
    ]
  };
  const prose = '# 第001章 山脚\n\n林川在泵房检查阀门。他的右手受伤，暂时无法扳动主阀。';
  const fact = factSchema.parse({
    id: 'location',
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
    evidence: [{ path: prosePath(1), hash: hash(prose), quote: '林川在泵房检查阀门。' }]
  });
  const injury = factSchema.parse({
    ...fact,
    id: 'injury',
    predicate: '伤势',
    value: '右手受伤',
    evidence: [{ path: prosePath(1), hash: hash(prose), quote: '他的右手受伤，暂时无法扳动主阀。' }]
  });
  store.commit(
    [
      { path: paths.roles, content: roles },
      { path: paths.world, content: renderWorldModel(world) },
      { path: paths.outline, content: chapterTableFixture.replaceAll('调查、兑现', '推进、结算') },
      { path: paths.volumes, content: volumeTableFixture },
      { path: plotPath, content: renderPlotDocument(plot) },
      { path: prosePath(1), content: prose },
      { path: paths.items, content: encodeFacts(fixture(p, paths.items, service), [fact, injury]) }
    ].map((c) => ({ ...c, baseHash: store.db.document(c.path)?.hash ?? null })),
    p
  );
  const newer = store.db.project();
  newer.revision++;
  store.commit(
    [
      {
        path: paths.roles,
        content: roles.replace(/(- 当前目标[：:])[^\r\n]*/, '$1检查阀门并恢复供水'),
        baseHash: store.db.document(paths.roles)!.hash
      }
    ],
    newer
  );
}
