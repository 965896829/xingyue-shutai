import type { FileStore } from './storage';
import { proposalHash } from './storage';
import type { Run } from '../shared/types';
import type { WorkbenchCandidate, CandidateView } from '../shared/workbench-visual';
import { compatibleRunBase } from './runtime-settings';
import { requiresRevisionCore } from './workflows/revision-core';
import { documentWorkbenchObjects, editWorkbenchField } from './workbench-documents';
import { prepareReorder, validateReorderDecisions, resolvedReorderChanges } from './workbench-reorder';
import { plotPath, parsePlotDocument } from './workbench-plot';
import { parseWorldModel, renderWorldModel } from './world-model';
import { paths } from './domain';
import { memoryPaths } from './domain';

function candidateTitle(value: string) {
  const text = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(text || '关联修改');
  return characters.length > 120 ? characters.slice(0, 119).join('') + '…' : characters.join('');
}

export function bindWorkbenchCandidate(
  store: FileStore,
  run: Run,
  kind: WorkbenchCandidate['kind'],
  objectIds: string[],
  fields?: WorkbenchCandidate['fieldTargets']
) {
  const value: WorkbenchCandidate = {
    version: 1,
    projectId: store.db.project().id,
    snapshotId: store.db.headRef()!.id,
    kind,
    objectIds,
    groups: [
      { id: 'changes', title: candidateTitle(run.request), paths: run.changes.map((c) => c.path), objectIds }
    ],
    sourceHashes: Object.fromEntries(run.changes.map((c) => [c.path, c.baseHash])),
    ...(fields ? { fieldTargets: fields } : {})
  };
  run.workbench = value;
  return value;
}
export function candidateGroups(run: Run) {
  const declared = run.workbench?.groups;
  const all = run.changes.map((c) => c.path);
  if (
    !declared?.length ||
    run.mode !== 'manual' ||
    run.facts.length ||
    run.revisionCore ||
    run.pipeline ||
    run.workbench?.kind === 'reorder'
  )
    return [
      { id: 'all', title: candidateTitle(run.request), paths: all, objectIds: run.workbench?.objectIds ?? [] }
    ];
  const groups = declared
    .map((g) => ({ ...g, title: candidateTitle(g.title), paths: g.paths.filter((p) => all.includes(p)) }))
    .filter((g) => g.paths.length);
  const missing = all.filter((p) => !groups.some((g) => g.paths.includes(p)));
  if (missing.length)
    return [{ id: 'all', title: '关联修改', paths: all, objectIds: run.workbench?.objectIds ?? [] }];
  for (let i = 0; i < groups.length; i++)
    for (let j = groups.length - 1; j > i; j--) {
      if (
        groups[i].paths.some((p) => groups[j].paths.includes(p)) ||
        groups[i].objectIds.some((id) => groups[j].objectIds.includes(id))
      ) {
        groups[i] = {
          ...groups[i],
          paths: [...new Set([...groups[i].paths, ...groups[j].paths])],
          objectIds: [...new Set([...groups[i].objectIds, ...groups[j].objectIds])]
        };
        groups.splice(j, 1);
      }
    }
  return groups;
}
export function candidateView(store: FileStore, run: Run): CandidateView {
  const groups = candidateGroups(run);
  const stale =
    !compatibleRunBase(store, run) ||
    (!!run.workbench && run.workbench.snapshotId !== store.db.headRef()?.id) ||
    run.changes.some(
      (c) =>
        (store.db.document(c.path)?.hash ?? null) !== c.baseHash ||
        (c.baseHash && store.inspect(c.path)?.status !== 'accepted')
    );
  return {
    id: run.id,
    title: candidateTitle(run.request),
    fingerprint: proposalHash(run),
    stale,
    requiresRevision: requiresRevisionCore(store, run),
    atomic: groups.length === 1,
    groups: groups.map((g) => ({
      ...g,
      changes: run.changes
        .filter((c) => g.paths.includes(c.path))
        .map((c) => ({
          path: c.path,
          before: c.baseHash ? store.object(c.baseHash).toString('utf8') : '',
          after: c.content
        }))
    }))
  };
}
export function assertWorkbenchCandidate(store: FileStore, run: Run) {
  const metadata = run.workbench;
  if (!metadata) return;
  if (metadata.projectId !== store.db.project().id || metadata.snapshotId !== store.db.headRef()?.id)
    throw new Error('画布候选所属作品或版本已改变');
  for (const [file, digest] of Object.entries(metadata.sourceHashes))
    if (
      (store.db.document(file)?.hash ?? null) !== digest ||
      (digest && store.inspect(file)?.status !== 'accepted')
    )
      throw new Error('画布候选来源已改变，请重新生成');
  if (metadata.reorder) {
    const review = prepareReorder(
      store,
      {
        projectId: metadata.projectId,
        snapshotId: metadata.snapshotId,
        scope: {
          projectId: metadata.projectId,
          snapshotId: metadata.snapshotId,
          mode: 'current',
          viewpoint: 'author',
          chapter: store.db.project().chapter,
          worldId: 'main',
          timelineId: 'main'
        }
      },
      metadata.reorder.after
    );
    if (review.preview.fingerprint !== metadata.reorder.fingerprint)
      throw new Error('章节调序的依赖检查已变化');
    validateReorderDecisions(review.preview, metadata.reorder.decisions);
    const expected = resolvedReorderChanges(review, metadata.reorder.decisions);
    if (expected.some((c) => !run.changes.some((v) => v.path === c.path)))
      throw new Error('章节调序的关联修改不能部分采纳');
    if (
      expected.some((c) => {
        const change = run.changes.find((v) => v.path === c.path)!;
        return (
          change.baseHash !== c.baseHash ||
          (change.content !== c.content &&
            !(
              c.path.startsWith('07_') &&
              metadata.reorder!.decisions.some((d) => d.action === 'revise') &&
              run.revisionCore?.phase === 'ready'
            ))
        );
      })
    )
      throw new Error('章节调序内容与依赖预览不一致，请重新建立候选');
    if (metadata.reorder.decisions.some((d) => d.action === 'revise') && run.revisionCore?.phase !== 'ready')
      throw new Error('依赖修订尚未完成正文与记忆核对');
  }
  if (
    metadata.kind === 'field' &&
    !metadata.fieldTargets?.length &&
    run.changes.some(
      (c) =>
        !Object.hasOwn(metadata.sourceHashes, c.path) &&
        !(run.revisionCore && (memoryPaths.some((file) => file === c.path) || /^08_/.test(c.path)))
    )
  )
    throw new Error('对象候选超出所选来源范围');
  if (metadata.kind === 'field' && metadata.fieldTargets?.length) {
    for (const file of new Set(metadata.fieldTargets.map((f) => f.path))) {
      const change = run.changes.find((c) => c.path === file);
      if (!change) throw new Error('对象字段候选不完整');
      let expected = store.readAccepted(file).content;
      const after = documentWorkbenchObjects(file, change.content);
      for (const target of metadata.fieldTargets.filter((f) => f.path === file)) {
        const current = documentWorkbenchObjects(file, expected)
          .find((o) => o.id === target.objectId)
          ?.fields.find((f) => f.id === target.fieldId);
        const next = after.find((o) => o.id === target.objectId)?.fields.find((f) => f.id === target.fieldId);
        if (!current || !next) throw new Error('对象字段身份已变化');
        if (current.value === next.value) continue;
        if (file === paths.world) {
          const model = parseWorldModel(expected),
            module = model?.modules.find((m) => `world:${m.id}` === target.objectId);
          if (!model || !module || module.locked) throw new Error('世界模块已固定或不存在');
          if (target.fieldId === 'content') module.content = next.value;
          else if (target.fieldId.startsWith('rule:') && module.rule)
            (module.rule as unknown as Record<string, string>)[target.fieldId.slice(5)] = next.value;
          else throw new Error('世界字段不可修改');
          expected = renderWorldModel(model);
        } else expected = editWorkbenchField(expected, current, next.value);
      }
      if (change.content !== expected) throw new Error('候选超出所选对象字段，请将其他修改另建候选');
    }
    if (run.changes.some((c) => !metadata.fieldTargets!.some((f) => f.path === c.path)))
      throw new Error('对象候选包含未授权文件');
  }
  if (metadata.kind === 'plot') {
    const change = run.changes.find((c) => c.path === plotPath);
    if (change) parsePlotDocument(change.content);
  }
}
export function worldImpact(store: FileStore, moduleId: string) {
  const model = store.db.document(paths.world)?.hash
    ? parseWorldModel(store.readAccepted(paths.world).content)
    : undefined;
  const module = model?.modules.find((m) => m.id === moduleId);
  if (!module) return [];
  const terms = [module.title, ...(module.content.match(/\b[A-Z][A-Z0-9_-]{2,}\b/g) ?? [])];
  const result = new Map<string, string>();
  for (const row of store.db.sql
    .prepare('SELECT dependent FROM dependencies WHERE source_path=?')
    .all(paths.world))
    result.set(String(row.dependent), '使用过世界设定');
  for (const fact of store.db
    .facts()
    .filter(
      (f) =>
        f.reviewStatus === 'accepted' &&
        (f.evidence.some((e) => e.path === paths.world) ||
          terms.some((t) => f.subject.includes(t) || f.value.includes(t)))
    ))
    for (const e of fact.evidence) result.set(e.path, `${fact.subject} · ${fact.predicate}`);
  for (const link of model!.links ?? [])
    if (link.from === moduleId || link.to === moduleId)
      result.set(`module:${link.from === moduleId ? link.to : link.from}`, link.label);
  return [...result].map(([path, reason]) => ({ path, reason }));
}
