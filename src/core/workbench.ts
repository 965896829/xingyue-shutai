import type { FileStore } from './storage';
import { memoryScopeSchema, type MemoryScope } from '../shared/studio';
import type { Fact } from '../shared/types';
import {
  workbenchBindingSchema,
  plotWorkbenchObject,
  type WorkbenchBinding,
  type WorkbenchView,
  type WorkbenchObject
} from '../shared/workbench';
import { scopeSnapshot, visibleFact, sourceValidator, conflictingFacts } from './memory-studio';
import { pendingSource } from './memory-source';
import { workbenchPaths, documentWorkbenchObjects, editWorkbenchField } from './workbench-documents';
import { workbenchLocks, workbenchLocksKey } from './workbench-locks';
import { readPlot } from './workbench-plot';
import { parseWorldModel, readWorldModel, renderWorldModel } from './world-model';
import { paths } from './domain';

export function workbenchFactsAt(facts: Fact[], scope: MemoryScope) {
  return facts.filter((f) => visibleFact(f, scope));
}

export function readWorkbench(store: FileStore, input: unknown, expandedChapter?: number): WorkbenchView {
  const scope = memoryScopeSchema.parse(input),
    snapshot = scopeSnapshot(store, scope);
  if (!snapshot) throw new Error('作品尚无可读版本');
  const editable =
    scope.mode === 'current' && scope.viewpoint === 'author' && scope.chapter >= snapshot.project.chapter;
  const result: WorkbenchView = {
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    scope: { ...scope, projectId: snapshot.projectId, snapshotId: snapshot.id },
    editable,
    objects: [],
    unavailable: []
  };
  const locks = workbenchLocks(store);
  const includeDocuments =
    scope.viewpoint === 'author' &&
    scope.chapter >= snapshot.project.chapter &&
    scope.worldId === 'main' &&
    scope.timelineId === 'main';
  const checked = new Map<string, boolean>();
  const available = (file: string) => {
    if (scope.mode === 'historical') return true;
    if (!checked.has(file)) checked.set(file, store.inspect(file)?.status === 'accepted');
    return checked.get(file)!;
  };
  if (includeDocuments)
    for (const [path] of workbenchPaths) {
      if (!snapshot.documents[path]) continue;
      if (pendingSource(snapshot.project, path) || !available(path)) {
        result.unavailable.push(path);
        continue;
      }
      try {
        const content = store.object(snapshot.documents[path]).toString('utf8');
        const objects = documentWorkbenchObjects(path, content);
        for (const object of objects)
          for (const field of object.fields) {
            field.source.snapshotId = snapshot.id;
            field.editable &&= editable;
            field.locked ||= locks.some(
              (l) => l.objectId === object.id && l.fieldId === field.id && l.path === path
            );
          }
        result.objects.push(...objects);
      } catch {
        result.unavailable.push(path);
      }
    }
  const visible = workbenchFactsAt(snapshot.facts, scope),
    conflicts = conflictingFacts(visible);
  const valid = sourceValidator(store, snapshot.documents, scope.chapter, snapshot.project);
  const usable = [];
  for (const fact of visible) {
    if (
      conflicts.has(fact.id) ||
      !fact.evidence.length ||
      !fact.evidence.every((e) => valid(e) && available(e.path))
    ) {
      result.unavailable.push(`记忆：${fact.subject}`);
      continue;
    }
    usable.push(fact);
    const field = {
      id: `fact:${fact.id}`,
      label: fact.predicate,
      value: fact.value,
      kind: fact.kind,
      unrevealed: fact.revealedAt > scope.chapter,
      source: { ...fact.evidence[0], snapshotId: snapshot.id },
      editable: false,
      locked: false
    };
    if (fact.category === 'character') {
      let object = result.objects.find(
        (o) => o.kind === 'character' && o.entityIds.some((key) => fact.entityIds.includes(key))
      );
      if (
        !object &&
        new Set(
          visible
            .filter((f) => f.category === 'character' && f.subject === fact.subject)
            .flatMap((f) => f.entityIds.slice(0, 1))
        ).size === 1
      ) {
        const legacy = result.objects.filter(
          (o) => o.kind === 'character' && o.id.startsWith('card-') && o.title === fact.subject
        );
        if (legacy.length === 1) {
          object = legacy[0];
          object.entityIds = [...new Set([...object.entityIds, ...fact.entityIds])];
        }
      }
      if (!object) {
        object = {
          id: `character:${fact.entityIds[0] || fact.subject}`,
          title: fact.subject,
          kind: 'character',
          entityIds: fact.entityIds,
          track: 'saved',
          fields: []
        };
        result.objects.push(object);
      }
      object.fields.push(field);
    } else {
      const kind =
        fact.category === 'relation' ? 'relation' : fact.kind === 'plan' ? 'promise' : fact.category;
      result.objects.push({
        id: `fact:${fact.id}`,
        title: fact.subject,
        kind: kind as WorkbenchObject['kind'],
        entityIds: fact.entityIds,
        track: fact.kind === 'plan' ? 'plan' : 'saved',
        fields: [field],
        chapter:
          fact.toChapter === null
            ? `第 ${fact.fromChapter} 章起`
            : `第 ${fact.fromChapter}—${fact.toChapter} 章`,
        storyTime: fact.storyTime,
        ...(kind === 'relation' && fact.entityIds.length >= 2
          ? { from: fact.entityIds[0], to: fact.entityIds[1] }
          : {})
      });
    }
  }
  try {
    result.plot = readPlot(store, snapshot, scope, editable, usable, expandedChapter);
    for (const node of result.plot.nodes.filter(
      (n) => includeDocuments || (['chapter', 'scene'].includes(n.level) && n.sources.length)
    )) {
      result.objects.push(plotWorkbenchObject(node));
    }
  } catch {
    result.unavailable.push('剧情结构');
  }
  if (
    includeDocuments &&
    snapshot.documents[paths.world] &&
    !pendingSource(snapshot.project, paths.world) &&
    available(paths.world)
  ) {
    try {
      const content = store.object(snapshot.documents[paths.world]).toString('utf8');
      result.world =
        parseWorldModel(content) ?? (scope.mode === 'current' ? readWorldModel(store) : undefined);
      result.worldHash = snapshot.documents[paths.world];
    } catch {
      result.unavailable.push(paths.world);
    }
  }
  return { ...result, unavailable: [...new Set(result.unavailable)] };
}

export function resolveWorkbenchObject(store: FileStore, raw: unknown) {
  const binding = workbenchBindingSchema.parse(raw);
  if (
    binding.projectId !== store.db.project().id ||
    binding.snapshotId !== store.db.headRef()?.id ||
    (binding.scope.snapshotId && binding.scope.snapshotId !== binding.snapshotId)
  )
    throw new Error('对象所属作品或版本已变化，请重新选择');
  const view = readWorkbench(
    store,
    {
      ...binding.scope,
      projectId: binding.projectId,
      snapshotId: binding.snapshotId
    },
    binding.objectId.startsWith('legacy-scene:') ? Number(binding.objectId.split(':')[1]) : undefined
  );
  if (!view.editable) throw new Error('请切回作者视角的当前章节后修改或讨论');
  const object = view.objects.find((o) => o.id === binding.objectId);
  if (!object) throw new Error('对象已变化或不在当前范围');
  if (binding.fieldId && !object.fields.some((f) => f.id === binding.fieldId))
    throw new Error('讨论字段已变化，请重新选择');
  return { binding, view, object };
}

export function proposeWorkbenchField(store: FileStore, raw: unknown, fieldId: string, value: string) {
  const { object } = resolveWorkbenchObject(store, raw);
  const field = object.fields.find((f) => f.id === fieldId);
  if (!field || !field.editable) throw new Error('此字段请通过来源文稿修改');
  if (field.locked) throw new Error('请先解除此字段的固定');
  const doc = store.readAccepted(field.source.path);
  if (doc.hash !== field.source.hash || store.inspect(field.source.path)?.status !== 'accepted')
    throw new Error('来源文稿已变化，请重新读取');
  let content: string;
  if (field.source.path === paths.world) {
    const model = parseWorldModel(doc.content),
      module = model?.modules.find((m) => `world:${m.id}` === object.id);
    if (!model || !module || module.locked) throw new Error('世界模块已固定或不存在');
    if (field.id === 'content') module.content = value;
    else if (field.id.startsWith('rule:') && module.rule)
      (module.rule as unknown as Record<string, string>)[field.id.slice(5)] = value;
    else throw new Error('世界字段不可修改');
    content = renderWorldModel(model);
  } else content = editWorkbenchField(doc.content, field, value);
  if (content === doc.content) throw new Error('字段内容没有变化');
  return { path: field.source.path, content, baseHash: doc.hash };
}

export function setWorkbenchLock(store: FileStore, raw: unknown, fieldId: string, locked: boolean) {
  return store.db.transaction(() => {
    const { object } = resolveWorkbenchObject(store, raw);
    const field = object.fields.find((f) => f.id === fieldId);
    if (!field || !field.editable) throw new Error('此字段不能在画布中固定');
    const locks = workbenchLocks(store).filter(
      (l) => !(l.objectId === object.id && l.fieldId === field.id && l.path === field.source.path)
    );
    if (locked)
      locks.push({
        objectId: object.id,
        fieldId: field.id,
        path: field.source.path,
        value: field.value,
        label: `${object.title} · ${field.label}`
      });
    store.db.set(workbenchLocksKey, locks);
    return true;
  });
}

export function workbenchDiscussionContext(store: FileStore, binding: WorkbenchBinding) {
  const { object, view } = resolveWorkbenchObject(store, binding);
  return JSON.stringify({
    object: object.title,
    type: object.kind,
    chapter: view.scope.chapter,
    selectedField: binding.fieldId ? object.fields.find((f) => f.id === binding.fieldId)?.label : undefined,
    fields: object.fields.map((f) => ({
      name: f.label,
      value: f.value,
      locked: f.locked,
      kind: f.kind,
      source: f.source
    }))
  });
}
