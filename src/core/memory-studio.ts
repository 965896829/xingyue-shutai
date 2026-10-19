import {
  memoryScopeSchema,
  type MemoryScope,
  type LedgerCoverage,
  type SourceRef,
  type EntityState
} from '../shared/studio';
import type { Fact, ProjectState } from '../shared/types';
import { FileStore, safePath } from './storage';
import { hash, paths } from './domain';
import { pendingSource } from './memory-source';
import { queryTerms as tokensOf } from './text-search';
import { proseCandidates, repairProse } from './prose-index';
export { tokensOf };

export function writingScope(p: ProjectState): MemoryScope {
  return memoryScopeSchema.parse({
    chapter: p.chapter,
    viewpoint: p.config.viewpointCharacterId ? 'character' : 'author',
    characterId: p.config.viewpointCharacterId || undefined
  });
}
export function scopeSnapshot(store: FileStore, scope: MemoryScope) {
  if (scope.projectId && scope.projectId !== store.db.project().id) throw new Error('读取范围不属于当前作品');
  if (scope.mode === 'historical' && !scope.snapshotId) throw new Error('请选择可用的历史快照');
  const snapshot = scope.snapshotId ? store.db.snapshot(scope.snapshotId) : store.db.head()!;
  if (scope.mode !== 'historical' && scope.snapshotId && scope.snapshotId !== store.db.head()?.id)
    throw new Error('旧快照只能在历史回看中读取，不能作为当前事实');
  return snapshot;
}
export function applicableFact(f: Fact, scope: MemoryScope) {
  if (
    f.worldId !== scope.worldId ||
    f.timelineId !== scope.timelineId ||
    f.reviewStatus !== 'accepted' ||
    (f.state === 'disputed' || f.state === 'superseded') ||
    f.fromChapter > scope.chapter ||
    (f.toChapter !== null && f.toChapter < scope.chapter)
  )
    return false;
  return true;
}
export function visibleFact(f: Fact, scope: MemoryScope) {
  if (!applicableFact(f, scope)) return false;
  if (scope.viewpoint === 'author') return true;
  if (f.revealedAt > scope.chapter || f.kind === 'plan' || f.kind === 'author_constraint') return false;
  if (scope.viewpoint === 'reader') return true;
  return f.knowledge.some(
    (k) => k.who === scope.characterId && k.fromChapter <= scope.chapter && k.mode !== 'unknown'
  );
}
export function sourceValid(
  store: FileStore,
  e: SourceRef,
  documents: Record<string, string>,
  chapter: number,
  project?: ProjectState
) {
  if (pendingSource(project ?? store.db.project(), e.path)) return false;
  if (documents[e.path] !== e.hash) return false;
  const n = e.path.match(/^07_.*第(\d+)章/);
  if (n && Number(n[1]) > chapter) return false;
  try {
    const text = store.object(e.hash).toString('utf8');
    return e.start !== undefined && e.end !== undefined
      ? Array.from(text).slice(e.start, e.end).join('') === e.quote
      : text.includes(e.quote);
  } catch {
    return false;
  }
}
export function conflictingFacts(facts: Fact[]) {
  const conflicts = new Set<string>();
  const grouped = new Map<string, Fact[]>();
  for (const f of facts.filter(
    (f) =>
      f.reviewStatus === 'accepted' &&
      !['belief', 'plan', 'inference'].includes(f.kind) &&
      f.state !== 'disputed'
  )) {
    const key = JSON.stringify([f.worldId, f.timelineId, f.entityIds[0] || f.subject, f.predicate, f.kind]);
    const group = grouped.get(key) ?? [];
    for (const old of group)
      if (
        old.value !== f.value &&
        f.supersedes !== old.id &&
        old.supersedes !== f.id &&
        Math.max(old.fromChapter, f.fromChapter) <=
          Math.min(old.toChapter ?? Infinity, f.toChapter ?? Infinity)
      ) {
        conflicts.add(old.id);
        conflicts.add(f.id);
      }
    group.push(f);
    grouped.set(key, group);
  }
  return conflicts;
}
export function retrieveMemory(
  store: FileStore,
  query: string,
  input: unknown,
  limit = 20,
  browse?: { category: string; offset: number; pageSize: number }
) {
  const scope = memoryScopeSchema.parse(input),
    snapshot = scopeSnapshot(store, scope);
  if (!snapshot) throw new Error('作品尚无正式快照');
  const all = scope.mode === 'current' && !scope.snapshotId ? store.db.facts() : snapshot.facts;
  const visible = all.filter((f) => visibleFact(f, scope));
  const conflicts = conflictingFacts(visible);
  const invalidSources = new Set(visible.filter(f => conflicts.has(f.id) || f.evidence.some(e => !sourceValid(store, e, snapshot.documents, scope.chapter, snapshot.project))).map(f => f.id));
  const eligible = visible.filter(f => !invalidSources.has(f.id));
  const names = [...new Set(eligible.filter(f => [f.subject, ...f.aliases, ...f.entityIds].some(n => n && query.includes(n))).flatMap(f => [f.subject, ...f.aliases]))];
  const terms = [...new Set([...names, ...tokensOf(query)])];
  const exact = new Set(
    eligible
      .filter((f) => [f.id, f.subject, ...f.aliases, ...f.entityIds].some((n) => n && query.includes(n)))
      .flatMap((f) => [f.id, ...f.entityIds])
  );
  const scoreFact = (fact: Fact) => {
      const isExact = exact.has(fact.id),
        linked = fact.entityIds.some((x) => exact.has(x)) || fact.relatedIds.some((x) => exact.has(x));
      const score =
        (isExact ? 100 : 0) +
        (linked ? 40 : 0) +
        terms.filter((t) => `${fact.subject} ${fact.predicate} ${fact.value}`.toLowerCase().includes(t))
          .length;
      const required =
        fact.state === 'active' &&
        (fact.mandatory || ['injury', 'promise', 'hook'].includes(fact.category)) &&
        (fact.scope === 'global' || isExact || linked || query === '');
      return {
        fact,
        score,
        required,
        reason: required ? '持续约束' : isExact ? '实体匹配' : linked ? '关联实体' : '文本匹配'
      };
    };
  const relevant = (x: ReturnType<typeof scoreFact>) => query === '' || x.required || x.score > 0;
  const invalid = visible.filter(f => invalidSources.has(f.id)).map(scoreFact).filter(relevant);
  const valid = eligible.map(scoreFact).filter(relevant).sort((a, b) => b.score - a.score || a.fact.id.localeCompare(b.fact.id));
  const listed = browse
    ? valid.filter(
        (x) =>
          browse.category === 'all' ||
          x.fact.category === browse.category ||
          (browse.category === 'obligations' && x.required)
      )
    : valid;
  const facts = browse
    ? listed.slice(browse.offset, browse.offset + browse.pageSize)
    : [
        ...valid.filter((x) => x.required),
        ...valid.filter((x) => !x.required).slice(0, Math.max(1, Math.min(limit, 100)))
      ];
  const documents: {
    path: string;
    hash: string;
    excerpt: string;
    reason: string;
    start: number;
    end: number;
  }[] = [];
  let fallback = false;
  if (!browse && terms.length && (scope.viewpoint === 'author' || scope.viewpoint === 'reader')) {
    const candidates = proseCandidates(store, snapshot, scope.chapter, terms, query, limit);
    fallback = candidates.fallback;
    function* texts() {
      yield* candidates.ranked;
      for (const source of candidates.missing) yield { ...source, content: store.object(source.hash).toString('utf8') };
    }
    for (const { path: file, hash: version, content: text } of texts()) {
      const score = terms.filter((t) => text.toLowerCase().includes(t.toLowerCase())).length + (query.trim() && text.toLowerCase().includes(query.toLowerCase()) ? 100 : 0);
      if (!score) continue;
      const offset = text.toLowerCase().indexOf(terms.find((t) => text.toLowerCase().includes(t.toLowerCase()))!.toLowerCase());
      const start = Math.max(0, Array.from(text.slice(0, offset)).length - 150),
        end = Math.min(Array.from(text).length, start + 1000);
      documents.push({
        path: file,
        hash: version,
        excerpt: Array.from(text).slice(start, end).join(''),
        reason: String(score),
        start,
        end
      });
      if (documents.length > Math.max(50, limit * 2)) {
        documents.sort((a, b) => Number(b.reason) - Number(a.reason) || a.path.localeCompare(b.path));
        documents.splice(limit);
      }
    }
    documents.sort((a, b) => Number(b.reason) - Number(a.reason) || a.path.localeCompare(b.path));
    documents.splice(limit);
    for (const d of documents) {
      const original = store.object(d.hash).toString('utf8');
      const accepted = Array.from(original).slice(d.start, d.end).join('');
      if (accepted !== d.excerpt) {
        repairProse(store, d.path, d.hash, original);
        throw new Error(`${d.path}：检索缓存与正式版本不一致，已修复缓存，请重新查询`);
      }
      d.reason = '已接受原文';
    }
  }
  const definitions = [
    ['timeline', paths.timeline, ['timeline']],
    ['hooks', paths.hooks, ['hook', 'promise']],
    ['items', paths.items, ['item', 'injury']],
    ['terms', paths.terms, ['term']],
    ['knowledge', paths.knowledge, ['knowledge']]
  ] as const;
  const coverage: LedgerCoverage[] = definitions.map(([ledger, file, categories]) => {
    const count = facts.filter((x) => (categories as readonly string[]).includes(x.fact.category)).length;
    const missing =
      !snapshot.documents[file] ||
      pendingSource(snapshot.project, file) ||
      invalid.some((x) => x.required && (categories as readonly string[]).includes(x.fact.category));
    return { ledger, status: missing ? 'missing' : count ? 'covered' : 'irrelevant', count };
  });
  const pendingIssues = [...new Set(all.filter(fact => fact.evidence.some(e => pendingSource(snapshot.project, e.path)) &&
    (query === '' || [fact.subject, ...fact.aliases, ...fact.entityIds].some(name => name && query.includes(name))))
    .flatMap(fact => fact.evidence.filter(e => pendingSource(snapshot.project, e.path)).map(e => `${e.path}：前文修订影响尚未核对`)))];
  return {
    ...(fallback ? { note: '部分原文索引尚未建立，本次逐篇核对缺失部分，未省略读取范围。' } : {}),
    ...(browse
      ? {
          total: listed.length,
          offset: browse.offset,
          hasMore: listed.length > browse.offset + browse.pageSize
        }
      : {}),
    snapshotId: snapshot.id,
    scope,
    facts,
    documents,
    coverage,
    issues: [...pendingIssues, ...invalid.map((x) => `${x.fact.id}：${conflicts.has(x.fact.id) ? '存在冲突状态' : '来源已变更'}`)],
    status: invalid.length || pendingIssues.length ? 'conflict' : facts.length || documents.length ? 'found' : 'not_found'
  };
}
export function scopedRead(store: FileStore, file: string, scope: MemoryScope) {
  safePath(store.root, file);
  const snapshot = scopeSnapshot(store, scope);
  if (pendingSource(snapshot.project, file)) throw new Error(`${file} 因前文修订待核对，不可作为当前事实`);
  const n = file.match(/^07_.*第(\d+)章/);
  if (n && Number(n[1]) > scope.chapter) throw new Error('此章节超出当前读取范围');
  if (scope.viewpoint === 'author') return store.readAccepted(file, snapshot.id);
  if (
    [paths.config, paths.style, '02_项目配置/标签创作契约.md'].includes(file as any) ||
    new RegExp(`^06_章节设计/第0*${scope.chapter}章(?:任务清单|细纲)\\.md$`).test(file)
  )
    return { ...store.readAccepted(file, snapshot.id), kind: 'author-instruction' };
  if (scope.viewpoint === 'reader' && n) return store.readAccepted(file, snapshot.id);
  const facts = snapshot.facts.filter((f) => visibleFact(f, scope));
  const evidence = facts
    .flatMap((f) => f.evidence)
    .filter((e) => e.path === file && sourceValid(store, e, snapshot.documents, scope.chapter, snapshot.project));
  if (!evidence.length) throw new Error('当前视角没有可读取的证据');
  const text = store.object(snapshot.documents[file]).toString('utf8');
  const unique = [...new Map(evidence.map(e => [JSON.stringify([e.start, e.end, e.quote]), e])).values()];
  return {
    path: file,
    hash: snapshot.documents[file],
    content: unique.map(e => e.quote).join('\n\n'),
    ranges: unique.map(e => {
      const start = e.start ?? Array.from(text.slice(0, text.indexOf(e.quote))).length;
      return { start, end: e.end ?? start + Array.from(e.quote).length };
    }),
    restricted: true
  };
}
export function traceSource(store: FileStore, source: SourceRef) {
  safePath(store.root, source.path);
  let text: string;
  try {
    text = store.read(source.path, source.hash).content;
  } catch {
    const owned = (store.db.sql.prepare('SELECT data FROM assessments').all() as { data: string }[]).some(
      (row) => {
        const assessment = JSON.parse(row.data);
        return assessment.evidence.some(
          (e: SourceRef) => e.path === source.path && e.hash === source.hash && e.quote === source.quote
        );
      }
    );
    if (!owned) throw new Error('此证据不属于当前作品');
    text = store.object(source.hash).toString('utf8');
  }
  const points = Array.from(text),
    offset = source.start ?? Array.from(text.slice(0, text.indexOf(source.quote))).length;
  if (
    text.indexOf(source.quote) < 0 ||
    points.slice(offset, source.end ?? offset + Array.from(source.quote).length).join('') !== source.quote
  )
    throw new Error('证据与历史版本不匹配');
  return { ...source, start: offset, end: offset + Array.from(source.quote).length, content: text };
}
export function syncEntities(store: FileStore) {
  const entities = new Map<string, { id: string; name: string; aliases: string[] }>();
  for (const f of store.db.facts()) {
    const key = f.entityIds[0] || `entity-${hash(`${f.worldId}:${f.subject}`).slice(0, 24)}`;
    const old = entities.get(key) ?? { id: key, name: f.subject, aliases: [] };
    old.aliases = [...new Set([...old.aliases, ...f.aliases])];
    entities.set(key, old);
  }
  for (const e of entities.values())
    store.db.sql
      .prepare('INSERT INTO entities VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(e.id, JSON.stringify(e));
  return [...entities.values()];
}
export function characterState(store: FileStore, entity: string, input: unknown): EntityState {
  const scope = memoryScopeSchema.parse(input),
    snapshot = scopeSnapshot(store, scope);
  const candidates = (
    scope.mode === 'current' && !scope.snapshotId ? store.db.facts() : snapshot.facts
  ).filter(
    (f) =>
      f.entityIds.includes(entity) ||
      f.subject === entity ||
      f.aliases.includes(entity) ||
      `entity-${hash(`${f.worldId}:${f.subject}`).slice(0, 24)}` === entity
  );
  const conflicts = conflictingFacts(candidates.filter((f) => visibleFact(f, scope)));
  const facts = candidates.filter(
    (f) =>
      visibleFact(f, scope) &&
      !conflicts.has(f.id) &&
      f.evidence.every((e) => sourceValid(store, e, snapshot.documents, scope.chapter, snapshot.project))
  );
  return {
    id: entity,
    name: candidates[0]?.subject ?? entity,
    aliases: [...new Set(candidates.flatMap((f) => f.aliases))],
    chapter: scope.chapter,
    snapshotId: snapshot.id,
    facts,
    unknown: ['injury', 'item', 'knowledge', 'relation'].filter((c) => !facts.some((f) => f.category === c))
  };
}
