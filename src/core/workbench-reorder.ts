import type { FileStore } from './storage';
import type { Change, Fact } from '../shared/types';
import type { SourceRef } from '../shared/studio';
import {
  workbenchScopeBindingSchema,
  reorderDecisionSchema,
  type ReorderDecision,
  type ReorderIssue,
  type ReorderPreview
} from '../shared/workbench-visual';
import { z } from 'zod';
import { scopeSnapshot, sourceValidator } from './memory-studio';
import { paths, prosePath, detailPath, taskPath } from './domain';
import {
  plotPath,
  parsePlotDocument,
  renderPlotDocument,
  reorderPlanText,
  knownPlotChapters
} from './workbench-plot';
import { fingerprint } from './runtime/canonical';

export function currentWorkbenchScope(store: FileStore, raw: unknown) {
  const binding = workbenchScopeBindingSchema.parse(raw);
  if (
    binding.projectId !== store.db.project().id ||
    binding.snapshotId !== store.db.headRef()?.id ||
    binding.scope.mode !== 'current' ||
    binding.scope.viewpoint !== 'author' ||
    binding.scope.chapter < store.db.project().chapter ||
    (binding.scope.snapshotId && binding.scope.snapshotId !== binding.snapshotId)
  )
    throw new Error('请切回本作品的当前作者视角并刷新版本');
  const snapshot = scopeSnapshot(store, {
    ...binding.scope,
    projectId: binding.projectId,
    snapshotId: binding.snapshotId
  });
  if (!snapshot) throw new Error('作品版本不可用');
  return { binding, snapshot };
}
const numberOf = (file: string) =>
  /^0[6-8]_/.test(file) && !/第\d+-\d+章/.test(file)
    ? Number(file.match(/第(\d+)章/)?.[1]) || undefined
    : undefined;
function renameChapter(content: string, target: number) {
  return content.replace(
    /^(#{1,6}\s*第)\s*([零〇一二两三四五六七八九十百千万\d]+)\s*章/m,
    (_, prefix, old) => `${prefix}${/^\d+$/.test(old) ? String(target).padStart(old.length, '0') : target}章`
  );
}
export function prepareReorder(store: FileStore, raw: unknown, input: number[]) {
  const { binding, snapshot } = currentWorkbenchScope(store, raw);
  const after = z.array(z.number().int().min(1).max(100000)).min(2).max(5000).parse(input);
  const before = [...after].sort((a, b) => a - b);
  if (new Set(after).size !== after.length) throw new Error('调序章节不能重复');
  if (before.every((n, i) => n === after[i])) throw new Error('章节顺序没有变化');
  const content = (file: string) =>
    snapshot.documents[file] ? store.object(snapshot.documents[file]).toString('utf8') : '';
  const plot = snapshot.documents[plotPath] ? parsePlotDocument(content(plotPath)) : undefined;
  const known = knownPlotChapters(snapshot.documents, content(paths.outline), plot);
  if (after.some((n) => !known.includes(n))) throw new Error('调序包含不存在的章节');
  const target = (old: number) => (after.includes(old) ? before[after.indexOf(old)] : old);
  const moved = new Set(before.filter((n) => target(n) !== n));
  const changes: Change[] = [],
    issues: ReorderIssue[] = [];
  const add = (
    category: ReorderIssue['category'],
    severity: ReorderIssue['severity'],
    message: string,
    sources: SourceRef[] = [],
    from?: number,
    to?: number,
    objectId?: string
  ) => {
    const id = fingerprint({ category, severity, message, from, to, sources, objectId });
    if (!issues.some((i) => i.id === id))
      issues.push({
        id,
        category,
        severity,
        message,
        sources,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(objectId ? { objectId } : {})
      });
  };
  const push = (file: string, value: string) => {
    if (value !== content(file))
      changes.push({ path: file, content: value, baseHash: snapshot.documents[file] ?? null });
  };
  const changedChapters = before.filter((n) => moved.has(n));
  const written = changedChapters.filter((n) => !!snapshot.documents[prosePath(n)]);
  if (written.length && written.length !== changedChapters.length)
    add('source', 'error', '已写正文与未写章节不能混排，请分别调整');
  for (const makePath of [prosePath, detailPath, taskPath]) {
    const existing = changedChapters.filter((n) => snapshot.documents[makePath(n)]);
    if (!existing.length) continue;
    if (existing.length !== changedChapters.length) {
      add('source', 'error', `${makePath(before[0]).split('/')[0]}只覆盖部分章节，请补齐计划或缩小调序范围`);
      continue;
    }
    for (let i = 0; i < before.length; i++)
      if (before[i] !== after[i])
        push(makePath(before[i]), renameChapter(content(makePath(after[i])), before[i]));
  }
  for (const file of Object.keys(snapshot.documents).filter(
    (file) =>
      /^(05_|06_)/.test(file) &&
      file !== plotPath &&
      !before.some((n) => file === detailPath(n) || file === taskPath(n))
  )) {
    try {
      push(file, reorderPlanText(content(file), before, after));
    } catch (e) {
      add('source', 'error', `${file.split('/').at(-1)}：${(e as Error).message}`, [
        { path: file, hash: snapshot.documents[file], quote: '' }
      ]);
    }
  }
  if (plot) {
    for (const scene of plot.scenes.filter((s) => s.protected && moved.has(s.chapter)))
      add('source', 'error', `“${scene.title}”已固定，请先解除固定后调序`);
    const next = structuredClone(plot);
    next.scenes = next.scenes.map((scene) => ({ ...scene, chapter: target(scene.chapter) }));
    const rebind = (value: string) =>
      /^chapter:\d+$/.test(value) ? `chapter:${target(Number(value.slice(8)))}` : value;
    next.links = next.links.map((link) => ({ ...link, from: rebind(link.from), to: rebind(link.to) }));
    if (JSON.stringify(next) !== JSON.stringify(plot)) push(plotPath, renderPlotDocument(next));
    const chapterOf = (value: string) =>
      /^chapter:\d+$/.test(value)
        ? Number(value.slice(8))
        : plot.scenes.find((s) => `scene:${s.id}` === value)?.chapter;
    for (const link of plot.links.filter((l) => l.kind !== 'echoes' && !l.nonlinear)) {
      const from = chapterOf(link.from),
        to = chapterOf(link.to);
      if (from && to && from < to && target(from) > target(to))
        add(
          'causality',
          'review',
          `“${link.label}”的依赖顺序反转`,
          [{ path: plotPath, hash: snapshot.documents[plotPath], quote: JSON.stringify(link.label) }],
          from,
          to,
          link.id
        );
    }
  }
  const valid = sourceValidator(
    store,
    snapshot.documents,
    Math.max(snapshot.project.chapter, ...known, 1),
    snapshot.project
  );
  const facts = snapshot.facts.filter(
    (f) =>
      f.reviewStatus === 'accepted' &&
      !['disputed', 'superseded'].includes(f.state) &&
      !['plan', 'inference'].includes(f.kind)
  );
  const usable = facts.filter((f) => f.evidence.length && f.evidence.every(valid));
  for (const fact of facts.filter(
    (f) =>
      !usable.includes(f) &&
      (moved.has(f.fromChapter) || f.evidence.some((e) => moved.has(numberOf(e.path) ?? -1)))
  ))
    add('source', 'error', `${fact.subject}的来源失效，须先核对后再调整章节`, fact.evidence);
  const category = (fact: Fact): ReorderIssue['category'] =>
    ['knowledge', 'item', 'hook', 'character'].includes(fact.category)
      ? (fact.category as ReorderIssue['category'])
      : fact.category === 'promise'
        ? 'hook'
        : 'causality';
  const dependency = (
    from: number,
    to: number,
    message: string,
    kind: ReorderIssue['category'],
    sources: SourceRef[]
  ) => {
    if (from > 0 && to > from && target(from) > target(to)) add(kind, 'review', message, sources, from, to);
  };
  for (const fact of usable) {
    for (const knowledge of fact.knowledge.filter((k) => k.mode !== 'unknown')) {
      const anchors = fact.evidence.flatMap((e) => numberOf(e.path) ?? []);
      for (const from of anchors)
        dependency(
          from,
          knowledge.fromChapter,
          `${knowledge.who}获知“${fact.subject} · ${fact.predicate}”的呈现顺序改变`,
          'knowledge',
          fact.evidence
        );
    }
    for (const id of [...fact.relatedIds, ...(fact.supersedes ? [fact.supersedes] : [])]) {
      const previous = snapshot.facts.find(
        (f) => f.id === id && f.reviewStatus === 'accepted' && f.evidence.every(valid)
      );
      if (previous)
        dependency(
          previous.fromChapter,
          fact.fromChapter,
          `${fact.subject}与前置记录的顺序改变`,
          category(fact),
          [...previous.evidence, ...fact.evidence]
        );
    }
  }
  for (const kind of ['character', 'item', 'hook'] as const) {
    const groups = new Map<string, Fact[]>();
    for (const fact of usable.filter(
      (f) => f.category === kind || (kind === 'hook' && f.category === 'promise')
    )) {
      const key = `${fact.worldId}:${fact.timelineId}:${kind === 'character' ? fact.entityIds[0] || fact.subject : fact.subject}`;
      groups.set(key, [...(groups.get(key) ?? []), fact]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.fromChapter - b.fromChapter);
      for (const fact of group.slice(1))
        dependency(
          group[0].fromChapter,
          fact.fromChapter,
          `${fact.subject}的${kind === 'character' ? '出场' : kind === 'item' ? '取得与使用' : '铺垫与后续'}顺序改变`,
          kind,
          [...group[0].evidence, ...fact.evidence]
        );
    }
  }
  for (const row of store.db.sql.prepare('SELECT source_path,dependent FROM dependencies').all()) {
    const file = String(row.source_path),
      dependent = String(row.dependent);
    const from = numberOf(file) ?? snapshot.facts.find((f) => f.id === file)?.fromChapter,
      to = numberOf(dependent);
    if (from && to)
      dependency(
        from,
        to,
        `第 ${to} 章曾引用第 ${from} 章资料`,
        'causality',
        snapshot.documents[file] ? [{ path: file, hash: snapshot.documents[file], quote: '' }] : []
      );
  }
  for (const change of changes)
    if (store.inspect(change.path)?.status !== 'accepted')
      add('source', 'error', `${change.path.split('/').at(-1)}存在未确认的外部改动`);
  if (!changes.length) add('source', 'error', '没有可唯一定位的章节计划或正文，请先补齐章节结构');
  const sourceHashes = { ...snapshot.documents };
  const coverage = ['knowledge', 'hook', 'item', 'character', 'causality'].map((category) => ({
    category,
    records: usable.filter((f) =>
      category === 'causality'
        ? f.relatedIds.length || f.supersedes
        : f.category === category || (category === 'hook' && f.category === 'promise')
    ).length
  }));
  const preview: ReorderPreview = {
    projectId: binding.projectId,
    snapshotId: snapshot.id,
    fingerprint: fingerprint({ snapshotId: snapshot.id, before, after, changes, issues }),
    before,
    after,
    requiresRevision: changes.some((c) => c.path.startsWith('07_')),
    issues,
    paths: changes.map((c) => c.path),
    coverage
  };
  return { preview, changes, sourceHashes, binding };
}
export function validateReorderDecisions(preview: ReorderPreview, raw: ReorderDecision[]) {
  const decisions = z.array(reorderDecisionSchema).parse(raw);
  if (preview.issues.some((i) => i.severity === 'error'))
    throw new Error(
      preview.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join('；')
    );
  if (
    new Set(decisions.map((d) => d.issueId)).size !== decisions.length ||
    decisions.some((d) => !preview.issues.some((i) => i.id === d.issueId))
  )
    throw new Error('调序说明与当前依赖检查不一致');
  for (const issue of preview.issues) {
    const decision = decisions.find((d) => d.issueId === issue.id);
    if (!decision) throw new Error('请逐项说明依赖顺序改变的处理方式');
    if (decision.action === 'revise' && !preview.requiresRevision)
      throw new Error('尚无正文可修订，请先修改计划中的依赖或明确非线性叙事');
  }
  return decisions;
}
export function resolvedReorderChanges(
  result: ReturnType<typeof prepareReorder>,
  decisions: ReorderDecision[]
) {
  const accepted = new Set(
    result.preview.issues
      .filter(
        (issue) => issue.objectId && decisions.some((d) => d.issueId === issue.id && d.action === 'nonlinear')
      )
      .map((issue) => issue.objectId)
  );
  return result.changes.map((change) => {
    if (change.path !== plotPath || !accepted.size) return change;
    const document = parsePlotDocument(change.content);
    document.links = document.links.map((link) =>
      accepted.has(link.id) ? { ...link, nonlinear: true } : link
    );
    return { ...change, content: renderPlotDocument(document) };
  });
}
