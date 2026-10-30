import { factSchema, type Fact, type Change, type ProjectState } from '../shared/types';
import { hash, paths } from './domain';
import { tagFactIssues } from './tags';
import { FileStore } from './storage';
import { pendingSource } from './memory-source';
import { approvedCreation } from '../shared/creation';
import type { MemoryDiagnostic } from './memory-diagnostics';

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
export function validateEvidence(
  store: FileStore,
  fact: Fact,
  chapter: number,
  candidates: Change[] = [],
  reviewingSources: string[] = [],
  project: ProjectState = store.db.project(),
  sourceCache?: Map<string, { content: string; hash: string }>
): string[] {
  const errors: string[] = [];
  if (fact.tagRefs || fact.planRefs) {
    const ref = fact.tagRefs ?? fact.planRefs!;
    let tags = approvedCreation(project);
    if (
      tags?.contract.revision !== ref.contractRevision ||
      tags.spec.inputHash !== ref.inputHash
    ) {
      tags = store.db
        .snapshots()
        .map((s) => approvedCreation(store.db.snapshot(s.id).project))
        .find(
          (t) =>
            t?.contract.revision === ref.contractRevision &&
            t.spec.inputHash === ref.inputHash
        );
    }
    errors.push(...tagFactIssues(fact, tags));
  }
  if (fact.kind === 'event' && fact.fromChapter > chapter) errors.push('未来计划不能作为已发生事件');
  if (fact.revealedAt > chapter && fact.kind !== 'plan' && fact.kind !== 'world_rule')
    errors.push('本章尚未揭示的内容不能登记为本章已发生事件');
  for (const source of fact.evidence) {
    try {
      const d = store.db.document(source.path);
      const candidate = candidates.find((c) => c.path === source.path && hash(c.content) === source.hash);
      if (pendingSource(project, source.path) && !reviewingSources.includes(source.path))
        throw new Error('来源因前文修订待核对');
      if (!candidate && (!d || d.hash !== source.hash)) throw new Error('来源不是当前已接受版本');
      const original = candidate ? null : sourceCache?.get(source.path) ?? store.read(source.path);
      if (original) sourceCache?.set(source.path, original);
      if (original && original.hash !== source.hash)
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
      const text = candidate?.content ?? original!.content;
      if (!text.includes(source.quote)) throw new Error('原文中找不到这段证据');
      const points = Array.from(text),
        quote = Array.from(source.quote);
      if ((source.start === undefined) !== (source.end === undefined))
        throw new Error('证据位置必须同时包含起点和终点');
      if (
        source.start !== undefined &&
        (source.end! - source.start !== quote.length ||
          points.slice(source.start, source.end).join('') !== source.quote)
      )
        throw new Error('证据位置与原文不一致');
      if (source.start === undefined) {
        const offset = text.indexOf(source.quote);
        source.start = Array.from(text.slice(0, offset)).length;
        source.end = source.start + quote.length;
      }
    } catch (e) {
      errors.push(`${fact.id}：${(e as Error).message}`);
    }
  }
  return errors;
}
export function rebuildMemory(store: FileStore): { count: number; issues: string[] } {
  const project = store.db.project();
  const facts: Fact[] = [],
    issues: string[] = [],
    ids = new Set<string>();
  const diagnostics: MemoryDiagnostic[] = [];
  const record = (issue: MemoryDiagnostic) => { issues.push(issue.message); diagnostics.push(issue); };
  for (const doc of store.db.acceptedDocuments()) {
    if (!doc.path.startsWith('04_') || !doc.hash) continue;
    try {
      for (const original of decodeFacts(store.read(doc.path, doc.hash).content)) {
        if (ids.has(original.id)) {
          record({ code: 'duplicate_id', path: doc.path, message: `重复记忆编号：${original.id}` });
          continue;
        }
        ids.add(original.id);
        const f = structuredClone(original);
        if (f.reviewStatus !== 'accepted' && f.reviewStatus !== 'disputed') continue;
        if (f.state === 'superseded') { facts.push(f); continue; }
        const evidenceIssues = validateEvidence(store, f, Math.max(project.chapter, f.revealedAt), [], [], project);
        if (evidenceIssues.length) {
          f.reviewStatus = 'disputed';
          f.state = 'disputed';
          for (const message of evidenceIssues)
            record({ code: 'invalid_evidence', path: doc.path, message, fact: original });
        }
        facts.push(f);
      }
    } catch (e) {
      record({ code: 'invalid_document', path: doc.path, message: `${doc.path}：事实解析失败，${(e as Error).message}` });
    }
  }
  store.db.sql.exec('BEGIN IMMEDIATE');
  try {
    store.db.replaceFacts(facts, issues.length ? -1 : store.db.project().revision);
    store.db.set('memoryIssues', issues);
    store.db.set('memoryDiagnostics', { version: 1, revision: project.revision, issues: diagnostics });
    store.db.sql.exec('COMMIT');
  } catch (e) {
    store.db.sql.exec('ROLLBACK');
    throw e;
  }
  return { count: facts.length, issues };
}
