import {
  factSchema,
  type Fact,
  type ContextManifest,
  type Profile,
  type ProjectState,
  type StageId
} from '../shared/types';
import { hash, id, now, paths, requiredInputs, prosePath, updatePath } from './domain';
import { FileStore, fileHash, safePath } from './storage';
import { inputTokenBudget, requireModelLimits } from '../shared/model-limits';

const marker = '<!-- wenxu-facts:v1 -->';
const factsPattern = /<!-- wenxu-facts:v1 -->\s*```json\s*\n([\s\S]*?)\n```/;
export function decodeFacts(content: string): Fact[] {
  const match = content.match(factsPattern);
  if (!match) return [];
  const raw: unknown = JSON.parse(match[1]);
  if (!Array.isArray(raw)) throw new Error('事实记录必须为数组');
  return raw.map((v) => factSchema.parse(v));
}
export function primaryPath(f: Fact): string {
  return {
    character: paths.roles,
    relation: paths.relations,
    timeline: paths.timeline,
    event: paths.timeline,
    hook: paths.hooks,
    item: paths.items,
    injury: paths.items,
    term: paths.terms,
    knowledge: paths.knowledge,
    promise: paths.behavior
  }[f.category];
}
export function encodeFacts(content: string, facts: Fact[]): string {
  const block = `${marker}\n\`\`\`json\n${JSON.stringify(facts, null, 2)}\n\`\`\``;
  return factsPattern.test(content)
    ? content.replace(factsPattern, () => block)
    : `${content.trimEnd()}\n\n## 可追溯事实记录\n\n${block}\n`;
}
export function validateEvidence(store: FileStore, fact: Fact, chapter: number): string[] {
  const errors: string[] = [];
  if (fact.kind === 'event' && fact.fromChapter > chapter) errors.push('未来计划不能作为已发生事件');
  if (fact.revealedAt > chapter && fact.kind !== 'plan' && fact.kind !== 'world_rule')
    errors.push('本章尚未揭示的内容不能登记为本章已发生事件');
  for (const source of fact.evidence) {
    try {
      const d = store.db.document(source.path);
      if (!d || d.hash !== source.hash) throw new Error('来源不是当前已接受版本');
      if (fileHash(safePath(store.root, source.path)) !== source.hash)
        throw new Error('来源文件存在未确认的外部改动');
      const sourceChapter = source.path.match(/^07_.*第(\d+)章/);
      if (sourceChapter && Number(sourceChapter[1]) > chapter) throw new Error('不能以未来章节证明当前事件');
      if (
        !source.path.startsWith('07_正文章节/') &&
        fact.kind !== 'world_rule' &&
        fact.kind !== 'author_constraint' &&
        !(fact.kind === 'plan' && /^(05_|06_)/.test(source.path))
      )
        throw new Error('事件依据必须来自正文；计划可引用规划，但台账和摘要不能自证');
      const text = store.read(source.path, source.hash).content;
      if (!text.includes(source.quote)) throw new Error('原文中找不到这段证据');
    } catch (e) {
      errors.push(`${fact.id}：${(e as Error).message}`);
    }
  }
  return errors;
}
export function rebuildMemory(store: FileStore): { count: number; issues: string[] } {
  const facts: Fact[] = [],
    issues: string[] = [],
    ids = new Set<string>();
  for (const doc of store.db.acceptedDocuments()) {
    if (!doc.path.startsWith('04_') || !doc.hash) continue;
    try {
      for (const original of decodeFacts(store.read(doc.path, doc.hash).content)) {
        if (ids.has(original.id)) {
          issues.push(`重复记忆编号：${original.id}`);
          continue;
        }
        ids.add(original.id);
        const f = structuredClone(original);
        if (f.reviewStatus !== 'accepted' && f.reviewStatus !== 'disputed') continue;
        const evidenceIssues = validateEvidence(store, f, Math.max(store.db.project().chapter, f.revealedAt));
        if (evidenceIssues.length) {
          f.reviewStatus = 'disputed';
          f.state = 'disputed';
          issues.push(...evidenceIssues);
        }
        facts.push(f);
      }
    } catch (e) {
      issues.push(`${doc.path}：事实解析失败，${(e as Error).message}`);
    }
  }
  store.db.sql.exec('BEGIN IMMEDIATE');
  try {
    store.db.replaceFacts(facts, issues.length ? -1 : store.db.project().revision);
    store.db.set('memoryIssues', issues);
    store.db.sql.exec('COMMIT');
  } catch (e) {
    store.db.sql.exec('ROLLBACK');
    throw e;
  }
  return { count: facts.length, issues };
}
function words(query: string): string[] {
  const matches = query.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
  return [
    ...new Set(
      matches.flatMap((s) =>
        s.length > 3 && /\p{Script=Han}/u.test(s)
          ? [s, ...Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2))]
          : [s]
      )
    )
  ]
    .filter(Boolean)
    .slice(0, 100);
}
export function searchMemory(store: FileStore, query: string, chapter: number, limit = 20) {
  const tokens = words(query),
    facts = store.db
      .facts()
      .filter(
        (f) =>
          f.reviewStatus === 'accepted' &&
          f.state !== 'disputed' &&
          f.fromChapter <= chapter &&
          (f.toChapter === null || f.toChapter >= chapter)
      );
  const scored = facts
    .map((f) => {
      const text = [f.subject, ...f.aliases, f.predicate, f.value].join(' ').toLowerCase();
      const exact = [f.id, f.subject, ...f.aliases].some((s) => s && query.includes(s));
      const relevant = exact || tokens.some((t) => text.includes(t));
      const required = f.state === 'active' && f.mandatory && (f.scope === 'global' || exact);
      return {
        fact: f,
        score: (exact ? 50 : 0) + tokens.filter((t) => text.includes(t)).length,
        relevant,
        required,
        reason: required ? '适用的持续约束' : exact ? '实体或编号匹配' : '文本关联'
      };
    })
    .filter((x) => x.relevant || x.required)
    .sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score);
  const seeds = new Set(scored.flatMap((x) => [x.fact.id, ...x.fact.entityIds]));
  for (const f of facts) {
    if (scored.some((x) => x.fact.id === f.id)) continue;
    if (f.relatedIds.some((v) => seeds.has(v)) || f.entityIds.some((v) => seeds.has(v)))
      scored.push({
        fact: f,
        score: 25,
        relevant: true,
        required: f.mandatory && f.state === 'active',
        reason: '实体或事实关系一跳补查'
      });
  }
  const mandatory = scored.filter((x) => x.required),
    optional = scored.filter((x) => !x.required).slice(0, Math.max(1, Math.min(limit, 100)));
  const documents: { path: string; hash: string; excerpt: string; reason: string }[] = [];
  // Literal/short-name fallback is deliberately independent of FTS token length.
  if (tokens.length) {
    const terms = tokens.slice(0, 30),
      fullTerms = terms.filter((t) => Array.from(t).length >= 3);
    const ftsRows = fullTerms.length
      ? (store.db.sql
          .prepare(
            'SELECT path,content FROM documents_fts WHERE documents_fts MATCH ? ORDER BY bm25(documents_fts) LIMIT 80'
          )
          .all(fullTerms.map((t) => '"' + t.replaceAll('"', '""') + '"').join(' OR ')) as {
          path: string;
          content: string;
        }[])
      : [];
    const literalRows = store.db.sql
      .prepare(
        `SELECT path,content FROM documents_fts WHERE ${terms.map(() => 'instr(lower(content),?)>0').join(' OR ')} ORDER BY (instr(lower(content),?)>0) DESC LIMIT 100`
      )
      .all(...terms, query.toLowerCase()) as { path: string; content: string }[];
    const rows = [...new Map([...ftsRows, ...literalRows].map((r) => [r.path, r])).values()];
    const scoredDocs = rows
      .map((row) => ({
        row,
        score:
          tokens.filter((t) => row.content.toLowerCase().includes(t)).length +
          (row.content.toLowerCase().includes(query.toLowerCase()) ? 100 : 0)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { row } of scoredDocs.slice(0, limit)) {
      const doc = store.db.document(row.path);
      if (!doc?.hash) continue;
      if (fileHash(safePath(store.root, row.path)) !== doc.hash) continue;
      const chapterMatch = row.path.match(/第(\d+)章/);
      if (chapterMatch && Number(chapterMatch[1]) > chapter && row.path.startsWith('07_')) continue;
      const token = tokens.find((t) => row.content.toLowerCase().includes(t))!;
      const offset = row.content.toLowerCase().indexOf(token);
      documents.push({
        path: row.path,
        hash: doc.hash,
        excerpt: row.content.slice(Math.max(0, offset - 250), offset + 1400),
        reason: '相关已接受原文'
      });
    }
  }
  const selected = [...mandatory, ...optional].filter(
    (x) => validateEvidence(store, x.fact, chapter).length === 0
  );
  const issues = store.db.get<string[]>('memoryIssues') ?? [];
  return {
    facts: selected,
    documents,
    status: issues.length ? 'conflict' : selected.length || documents.length ? 'found' : 'not_found',
    issues,
    indexRevision: store.db.get<number>('indexRevision'),
    note: '未命中不代表事实不存在；角色认知、计划和客观事件需分别使用。'
  };
}
export function assembleContext(
  store: FileStore,
  p: ProjectState,
  stage: StageId,
  request: string,
  profile: Profile,
  allowConflicts = false
): ContextManifest {
  requireModelLimits(profile);
  const scan = store.scan(),
    required = requiredInputs(stage, p);
  if (stage >= 'S09')
    for (let n = Math.max(1, p.chapter - p.config.recentChapters); n < p.chapter; n++) {
      const file = updatePath(n);
      if (store.db.document(file)?.hash) required.push(file);
    }
  if (store.db.get<number>('indexRevision') !== p.revision) rebuildMemory(store);
  const m: ContextManifest = {
    id: id(),
    projectRevision: p.revision,
    chapter: p.chapter,
    stage,
    sources: [],
    factIds: [],
    conflicts: [],
    estimatedTokens: 0,
    availableTokens: inputTokenBudget(profile) - 4096,
    createdAt: now(),
    omitted: [],
    assemblyVersion: '1.0-full-skill'
  };
  for (const relative of required) {
    const doc = scan.find((d) => d.path === relative);
    if (!doc || doc.status === 'missing') throw new Error(`缺少本阶段必读资料：${relative}`);
    if (doc.status !== 'accepted') throw new Error(`必读资料存在待确认的外部修改：${relative}`);
    const source = store.read(relative, doc.acceptedHash!);
    m.sources.push({
      path: relative,
      hash: source.hash,
      content: source.content,
      reason: '原 Skill 当前必读',
      required: true,
      mode: 'full'
    });
  }
  const query = [
    request,
    ...m.sources
      .filter((s) => s.path.includes('任务清单') || s.path === prosePath(p.chapter - 1))
      .map((s) => s.content)
  ].join('\n');
  const found = searchMemory(store, query, p.chapter, 8);
  m.factIds = found.facts.map((f) => f.fact.id);
  for (const { fact } of found.facts) m.conflicts.push(...validateEvidence(store, fact, p.chapter));
  for (const { fact } of found.facts) if (fact.state === 'disputed') m.conflicts.push(fact.id);
  const issues = store.db.get<string[]>('memoryIssues') ?? [];
  if (issues.length) m.conflicts.push(...issues);
  if (m.conflicts.length && !allowConflicts)
    throw new Error(`记忆来源需要核对：${m.conflicts.slice(0, 4).join('；')}`);
  for (const d of found.documents) {
    if (m.sources.some((s) => s.path === d.path)) continue;
    // Future plans are already explicitly included by the stage's required list.
    if (!d.path.startsWith('07_') && !d.path.includes('/历史归档/')) continue;
    const scanDoc = scan.find((s) => s.path === d.path);
    if (scanDoc?.status !== 'accepted') continue;
    m.sources.push({
      path: d.path,
      hash: d.hash,
      content: d.excerpt,
      reason: d.reason,
      required: false,
      mode: 'excerpt'
    });
  }
  m.estimatedTokens = Buffer.byteLength(JSON.stringify(m.sources), 'utf8');
  while (m.estimatedTokens > m.availableTokens && m.sources.some((s) => !s.required)) {
    const at = m.sources.findLastIndex((s) => !s.required);
    m.omitted!.push({ path: m.sources[at].path, reason: '可选原文因输入预算未装入' });
    m.sources.splice(at, 1);
    m.estimatedTokens = Buffer.byteLength(JSON.stringify(m.sources), 'utf8');
  }
  if (m.estimatedTokens > m.availableTokens)
    throw new Error(
      `必读资料超过输入预算（保守估计 ${m.estimatedTokens}，可用 ${m.availableTokens}）。请调整模型容量或审阅压缩方案；本次没有发送模型请求。`
    );
  return m;
}
export const manifestHash = (m: ContextManifest) =>
  hash(JSON.stringify(m.sources.map((s) => [s.path, s.hash, s.mode])));
