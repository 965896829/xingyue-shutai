import { worldModelSchema, worldModuleIds, worldModuleNames, type WorldModel } from '../shared/quality';
import { hash, paths } from './domain';
import type { FileStore } from './storage';
import type { Change, Issue } from '../shared/types';

export const growthSystemsInstruction = '世界模块允许独立 systems 数组；仅作者已有或本轮明确需要成长体系时使用，不强行创建。每项 {id,title,version,state,subjects,fromChapter,toChapter,original,unparsed,locked,steps,interactions}：id 稳定，version 新建为1、修改递增1；state 为 enabled/disabled/undecided；subjects 是适用人物或阵营，章节范围含两端，toChapter=null 表示未定结束。original 保留作者体系原文，unparsed 保存未解析片段；steps 是 {id,title,ability,boundary,prerequisites:阶段ID数组}，只允许本体系前置、不能循环，不自动增设新境界；interactions 是 {targetSystemId,rule}，仅保留作者允许的跨体系交互，不自动折算战力。现有 locked 项与 original 不改动。';

export function parseWorldModel(content: string): WorldModel | undefined {
  const match = content.match(/^# 世界模块\s+```json\s*([\s\S]*?)```/);
  if (!match) return;
  return worldModelSchema.parse(JSON.parse(match[1]));
}
export function readWorldModel(store: FileStore): WorldModel {
  const doc = store.db.document(paths.world)?.hash ? store.readAccepted(paths.world) : undefined;
  if (doc) {
    const parsed = parseWorldModel(doc.content);
    if (parsed) return parsed;
  }
  return {
    version: 1,
    source: doc ? { path: paths.world, hash: doc.hash } : null,
    original: doc?.content ?? '',
    modules: [
      ...(doc && !doc.content.includes('待填写')
        ? [
            {
              id: 'custom:inherited-world',
              title: '沿用设定',
              state: 'enabled' as const,
              content: doc.content,
              origin: 'inherited' as const,
              locked: false
            }
          ]
        : []),
      ...worldModuleIds.map((id, index) => ({
        id,
        title: worldModuleNames[index],
        state: 'undecided' as const,
        content: '',
        origin: 'author' as const,
        locked: false
      }))
    ]
  };
}
export function renderWorldModel(raw: unknown) {
  const model = worldModelSchema.parse(raw);
  if (new Set(model.modules.map((m) => m.id)).size !== model.modules.length)
    throw new Error('世界模块标识重复');
  if (
    model.modules.some(
      (m) =>
        !worldModuleIds.includes(m.id as (typeof worldModuleIds)[number]) &&
        !/^custom:[a-z0-9-]{1,80}$/.test(m.id)
    )
  )
    throw new Error('自定义模块需要唯一标识');
  if (model.modules.some((m) => m.state === 'enabled' && !m.content.trim()))
    throw new Error('已启用模块需要填写设定');
  for (const entries of [model.links ?? [], model.places ?? [], model.routes ?? []])
    if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error('世界图中的标识重复');
  const modules = new Set(model.modules.map((m) => m.id)),
    places = new Set(model.places?.map((p) => p.id) ?? []);
  if (model.links?.some((e) => e.from === e.to || !modules.has(e.from) || !modules.has(e.to)))
    throw new Error('因果连接指向不存在的世界模块');
  if (model.places?.some((p) => p.moduleId && !modules.has(p.moduleId)))
    throw new Error('地点所属模块不存在');
  if (model.routes?.some((e) => e.from === e.to || !places.has(e.from) || !places.has(e.to)))
    throw new Error('路线端点不存在');
  if (model.source && hash(model.original) !== model.source.hash) throw new Error('沿用原文与来源版本不一致');
  const acyclic = (nodes: string[], edges: { from: string; to: string }[]) => {
    const visiting = new Set<string>(), done = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('前置条件形成循环，无法确定起点');
      if (done.has(id)) return;
      visiting.add(id); for (const edge of edges.filter(e => e.from === id)) visit(edge.to);
      visiting.delete(id); done.add(id);
    };
    nodes.forEach(visit);
  };
  acyclic([...modules], (model.links ?? []).filter(e => e.kind === 'requires'));
  const systemIds = new Set((model.systems ?? []).map(s => s.id));
  if (systemIds.size !== (model.systems ?? []).length) throw new Error('成长体系标识重复');
  for (const system of model.systems ?? []) {
    const ids = new Set(system.steps.map(s => s.id));
    if (ids.size !== system.steps.length || system.toChapter !== null && system.toChapter < system.fromChapter) throw new Error('成长体系标识或生效范围无效');
    if (system.steps.some(s => new Set(s.prerequisites).size !== s.prerequisites.length || s.prerequisites.some(id => !ids.has(id)))) throw new Error('成长前置条件引用了未知或重复的阶段');
    if (system.interactions.some(i => i.targetSystemId === system.id || !systemIds.has(i.targetSystemId))) throw new Error('跨体系规则引用了不存在或相同的体系');
    acyclic([...ids], system.steps.flatMap(s => s.prerequisites.map(id => ({ from: id, to: s.id }))));
  }
  return `# 世界模块\n\n\`\`\`json\n${JSON.stringify(model, null, 2)}\n\`\`\`\n`;
}
export function worldContext(content: string, chapter?: number) {
  const model = parseWorldModel(content);
  if (!model) return content;
  const enabled = new Set(model.modules.filter((m) => m.state === 'enabled').map((m) => m.id));
  const names = new Map(model.modules.map((m) => [m.id, m.title]));
  const rules = model.modules
    .filter((m) => enabled.has(m.id))
    .map(
      (m) =>
        `## ${m.title}\n${m.content}${
          m.rule
            ? '\n' +
              Object.entries(m.rule)
                .filter(([, value]) => value)
                .map(
                  ([key, value]) =>
                    `${({ scope: '适用范围', trigger: '触发条件', boundary: '能力边界', cost: '代价', exception: '例外', evidence: '已发生证据' } as Record<string, string>)[key]}：${value}`
                )
                .join('\n')
            : ''
        }${m.locked ? '\n作者已锁定本模块。' : ''}`
    )
    .join('\n\n');
  const links = (model.links ?? [])
    .filter((e) => enabled.has(e.from) && enabled.has(e.to))
    .map(
      (e) =>
        `${names.get(e.from)} → ${names.get(e.to)}：${e.label}（${({ requires: '依赖', enables: '允许', prevents: '阻止', causes: '导致', exception: '例外' } as const)[e.kind]}）`
    );
  const visiblePlaces = (model.places ?? []).filter((p) => !p.moduleId || enabled.has(p.moduleId));
  const placeIds = new Set(visiblePlaces.map((p) => p.id));
  const routes = (model.routes ?? [])
    .filter((e) => placeIds.has(e.from) && placeIds.has(e.to))
    .map((e) => ({
      ...e,
      from: visiblePlaces.find((p) => p.id === e.from)!.title,
      to: visiblePlaces.find((p) => p.id === e.to)!.title
    }));
  return (
    rules +
    (links.length ? `\n\n## 规则因果\n${links.join('\n')}` : '') +
    (visiblePlaces.length ? `\n\n## 空间设定\n${JSON.stringify({ places: visiblePlaces, routes })}` : '') +
    ((model.systems ?? []).length ? `\n\n## 独立成长体系\n${JSON.stringify(model.systems!.filter(s => s.state === 'enabled' && (chapter === undefined || s.fromChapter <= chapter && (s.toChapter === null || chapter <= s.toChapter))))}\n不同体系不能自行折算等级、战力或地位。未解析原文保持待定，不补入未授权阶段。` : '')
  );
}
export function worldCandidateIssues(
  store: FileStore,
  changes: Change[],
  authorEdit: boolean,
  requireModules = false
): Issue[] {
  const change = changes.find((c) => c.path === paths.world);
  if (!change) return [];
  try {
    const next = parseWorldModel(change.content),
      previous = store.db.document(paths.world)?.hash
        ? parseWorldModel(store.readAccepted(paths.world).content)
        : undefined;
    if (requireModules && !next) throw new Error('当前世界任务需要完整的世界模块候选');
    if (next) renderWorldModel(next);
    for (const prior of previous?.systems ?? []) {
      const current = next?.systems?.find(s => s.id === prior.id);
      if (!authorEdit && prior.locked && JSON.stringify(current) !== JSON.stringify(prior)) throw new Error('固定成长体系不能被模型修改');
      if (!current) continue;
      if (prior.original !== current.original) throw new Error('成长体系导入原文必须保留');
      const { version: oldVersion, ...old } = prior, { version: nextVersion, ...value } = current;
      if (nextVersion !== oldVersion + (JSON.stringify(old) === JSON.stringify(value) ? 0 : 1)) throw new Error('成长体系版本与实际修改不一致');
    }
    if (requireModules && next && !previous && store.db.document(paths.world)?.hash) {
      const original = readWorldModel(store);
      if (
        next.original !== original.original ||
        JSON.stringify(next.source) !== JSON.stringify(original.source)
      )
        throw new Error('旧世界的原文和来源必须完整保留');
    }
    if (
      previous &&
      (!next ||
        next.original !== previous.original ||
        JSON.stringify(next.source) !== JSON.stringify(previous.source))
    )
      throw new Error('世界迁移原文与来源记录必须保留');
    if (
      next?.source &&
      (next.source.path !== paths.world ||
        !store.db.history(paths.world).some((r) => r.hash === next.source!.hash))
    )
      throw new Error('世界迁移来源不属于本作品的已保存版本');
    if (
      !authorEdit &&
      previous?.modules.some(
        (m) => m.locked && JSON.stringify(next!.modules.find((n) => n.id === m.id)) !== JSON.stringify(m)
      )
    )
      throw new Error('固定的世界设定不能被模型修改，请先调整对应模块');
    if (
      !authorEdit &&
      previous?.modules.some(
        (m) =>
          m.locked &&
          (JSON.stringify(previous.links?.filter((l) => l.from === m.id || l.to === m.id) ?? []) !==
            JSON.stringify(next?.links?.filter((l) => l.from === m.id || l.to === m.id) ?? []) ||
            JSON.stringify(previous.places?.filter((p) => p.moduleId === m.id) ?? []) !==
              JSON.stringify(next?.places?.filter((p) => p.moduleId === m.id) ?? []))
      )
    )
      throw new Error('固定模块的因果与空间约束不能被模型改变');
    return [];
  } catch (error) {
    return [
      { code: 'world_version', severity: 'error', path: paths.world, message: (error as Error).message }
    ];
  }
}
