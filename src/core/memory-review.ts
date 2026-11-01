import { z } from 'zod';
import type { Fact, Run, Issue } from '../shared/types';
import type { FileStore } from './storage';
import { hash } from './domain';
import { currentSettingsSourceHash } from './runtime-settings';
import { memoryPaths, updatePath, prosePath } from './domain';

/** A completed extraction is invalidated by any prose, document or fact edit. */
export function memoryCompletionHash(run: Run) {
  return hash(JSON.stringify({
    proseHash: run.pipeline?.proseHash ?? run.sourceProseHash,
    changes: run.changes.map(change => ({ path: change.path, hash: hash(change.content) })).sort((a, b) => a.path.localeCompare(b.path)),
    facts: [...run.facts].sort((a, b) => a.id.localeCompare(b.id)),
    retractions: run.factRetractions ?? [],
    ...(run.chapterCoverage ? { chapterCoverage: run.chapterCoverage } : {})
  }));
}

export const memoryReviewSchema = z.object({
  decisions: z.array(z.object({
    id: z.string().min(1),
    verdict: z.enum(['supported', 'contradicted', 'unclear']),
    reason: z.string().min(1),
    evidence: z.array(z.object({ path: z.string().min(1), quote: z.string().min(1) })).min(1)
  }))
});

export function memoryReviewInput(store: FileStore, run: Run) {
  const chapters = run.revisionCore?.chapters ?? [run.chapter];
  const changedMemory = run.pipeline || run.stage === 'S11' || run.revisionCore
    ? run.changes.filter(change => (memoryPaths.includes(change.path as typeof memoryPaths[number]) || chapters.some(chapter => change.path === updatePath(chapter))) && hash(change.content) !== change.baseHash)
    : [];
  const items: { id: string; action: string; fact?: Fact; reason: string; path?: string }[] = [
    ...run.facts.map(fact => ({ id: fact.id, action: 'record', fact, reason: fact.replacementReason })),
    ...(run.factRetractions ?? []).map(retirement => {
      const fact = store.db.facts().find(fact => fact.id === retirement.id);
      if (!fact) throw new Error('待撤回记忆不存在');
      return { id: retirement.id, action: 'retract', fact, reason: retirement.reason };
    }),
    ...(run.memoryRepair?.completed ?? []).map(item => ({ id: `document:${item.path}`, action: 'review_document', reason: item.reason, path: item.path })),
    ...Object.entries(run.revisionCore?.coverage ?? {}).map(([chapter, coverage]) => ({ id: `revision-coverage:${chapter}`, action: 'review_coverage', path: run.changes.find(c => c.path.startsWith('07_') && hash(c.content) === coverage.proseHash)?.path, reason: '核对修订后全部出场人物的覆盖、状态变化及事实是否与完整最终正文一致。' + JSON.stringify({ coverage, facts: run.facts }) })),
    ...changedMemory.filter(change => !run.memoryRepair?.completed.some(item => item.path === change.path)).map(c => ({ id: `revision-document:${c.path}`, action: 'review_document', path: c.path, reason: '核对本轮实际修改资料与最终正文、事实及人物覆盖一致。区分历史状态、当前状态与人物误信；无变化、仅提及、依据不足均可成立，不为填满字段发明经历。' })),
    ...(run.chapterCoverage ? [{ id: 'chapter-character-coverage', action: 'review_coverage',
      path: run.changes.find(change => change.path.startsWith('07_') && hash(change.content) === run.chapterCoverage!.proseHash)?.path,
      reason: '核对全部出场及提及人物是否遗漏，各人状态、变化或无变化是否有正文依据；不要把一时情绪变为长期人格。' + JSON.stringify({ coverage: run.chapterCoverage, facts: run.facts }) }] : [])
  ];
  const files = [...new Set([...items.flatMap(item => item.fact ? item.fact.evidence.map(e => e.path) : item.path ? [item.path] : []), ...(run.memoryRepair?.sources ?? []),
    ...changedMemory.flatMap(() => chapters.map(prosePath).filter(file => run.changes.some(c => c.path === file) || store.db.document(file)?.hash))])];
  const sources = files.map(path => {
    const change = run.changes.find(change => change.path === path);
    let content = change?.content ?? store.readAccepted(path).content;
    const expected = run.memoryRepair?.sourceHashes?.[path];
    // Keep the exact reviewed input when only host execution controls changed.
    if (!change && expected && hash(content) !== expected &&
        hash(content) === currentSettingsSourceHash(store, run.baseSnapshotId, { path, hash: expected }))
      content = store.object(expected).toString('utf8');
    const previousHash = change?.baseHash;
    return { path, hash: hash(content), content,
      ...(previousHash && changedMemory.some(c => c.path === path) ? { previous: { hash: previousHash, content: store.object(previousHash).toString('utf8') } } : {}) };
  });
  const entities = new Set([...run.facts.flatMap(f => f.entityIds), ...(run.chapterCoverage?.characters ?? []).map(c => c.entityId),
    ...Object.values(run.revisionCore?.coverage ?? {}).flatMap(c => c.characters.map(character => character.entityId))]);
  const replaced = new Set(run.facts.map(f => f.supersedes).filter(Boolean));
  const relatedFacts = changedMemory.length ? store.db.facts().filter(f => replaced.has(f.id) || f.entityIds.some(id => entities.has(id)) && f.fromChapter <= Math.max(...chapters)) : [];
  const input = { items, sources, ...(run.continuity ? { scope: run.continuity } : {}),
    ...(relatedFacts.length ? { relatedFacts } : {}),
    ...(run.memoryRepair?.impacts?.length ? { impacts: run.memoryRepair.impacts } : {}) };
  return { ...input, fingerprint: hash(JSON.stringify(input)) };
}

export function memoryReviewMatches(store: FileStore, run: Run, input = memoryReviewInput(store, run)) {
  if (run.memoryReview?.fingerprint !== input.fingerprint) return false;
  try {
    return (run.memoryReview.sources ?? []).every(source =>
      hash(run.changes.find(change => change.path === source.path)?.content ?? store.readAccepted(source.path).content) === source.hash);
  } catch { return false; }
}

export function memoryReviewIssues(store: FileStore, run: Run) {
  const input = memoryReviewInput(store, run);
  if (!input.items.length) return [];
  if (!memoryReviewMatches(store, run, input)) return ['新增或修订的记忆尚未完成独立证据核对'];
  return run.memoryReview!.issues;
}

export type MemoryDecision = z.infer<typeof memoryReviewSchema>['decisions'][number];

/** Return validated decisions so unchanged items can retain their actual verdict. */
export function parseMemoryDecisions(raw: string, items: { id: string; fact?: Fact; path?: string }[], sources: { path: string; content: string }[]) {
  const wire = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  // A reference selects an existing quote; it never certifies its semantics.
  // The independent reviewer still supplies an item verdict and a reason.
  if (Array.isArray(wire?.decisions)) for (const decision of wire.decisions) {
    if (!Object.hasOwn(decision, 'evidenceRefs')) continue;
    // A reviewer may cite existing evidence and add another exact quote. Validate
    // both forms; a valid reference must never hide an invalid supplemental quote.
    const supplemental = decision.evidence === undefined ? [] :
      memoryReviewSchema.shape.decisions.element.shape.evidence.parse(decision.evidence);
    const refs = z.array(z.number().int().nonnegative()).min(1).parse(decision.evidenceRefs);
    if (new Set(refs).size !== refs.length) throw new Error('核对证据编号重复');
    const item = items.find(item => item.id === decision.id);
    decision.evidence = [...refs.map(ref => {
      const evidence = item?.fact?.evidence[ref];
      if (!evidence) throw new Error('核对证据编号不存在于当前记忆');
      const source = sources.find(s => s.path === evidence.path);
      if (!source || hash(source.content) !== evidence.hash || !source.content.includes(evidence.quote))
        throw new Error('核对证据引用缺少同版本原文');
      return { path: evidence.path, quote: evidence.quote };
    }), ...supplemental];
  }
  const parsed = memoryReviewSchema.parse(wire);
  const ids = new Set(parsed.decisions.map(item => item.id));
  if (ids.size !== parsed.decisions.length || ids.size !== items.length || items.some(item => !ids.has(item.id)))
    throw new Error('证据核对未逐条覆盖待处理记忆');
  for (const decision of parsed.decisions) {
    const missing = decision.evidence.find(e => !sources.some(source => source.path === e.path && source.content.includes(e.quote)));
    if (missing)
      throw new Error(`核对结论缺少真实原文支持：${JSON.stringify({ id: decision.id, path: missing.path, quote: missing.quote })}`);
    const item = items.find(item => item.id === decision.id)!;
    const expected = item.fact?.evidence.map(e => e.path) ?? (item.path ? [item.path] : []);
    if (expected.length && !decision.evidence.some(e => expected.includes(e.path)))
      throw new Error('核对结论引用了无关文件，不能证明当前记忆或修订结果');
  }
  return parsed.decisions;
}

export function memoryDecisionIssues(decisions: MemoryDecision[], items: { id: string; fact?: Fact; path?: string; action?: string }[], onIssue?: (issue: Issue) => void) {
  return decisions.filter(item => item.verdict !== 'supported').map(decision => {
    const item = items.find(item => item.id === decision.id)!;
    const message = `${item.fact?.subject ?? item.path ?? '记忆'}：${decision.reason}`;
    onIssue?.({ code: item.action === 'review_coverage' ? 'chapter_coverage_review' : 'memory_review', severity: 'error', message, ...(item.fact ? { factId: item.fact.id } : item.path ? { path: item.path } : {}) });
    return message;
  });
}

export function parseMemoryReview(raw: string, items: { id: string; fact?: Fact; path?: string }[], sources: { path: string; content: string }[], onIssue?: (issue: Issue) => void) {
  return memoryDecisionIssues(parseMemoryDecisions(raw, items, sources), items, onIssue);
}
