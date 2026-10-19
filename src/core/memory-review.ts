import { z } from 'zod';
import type { Fact, Run } from '../shared/types';
import type { FileStore } from './storage';
import { hash } from './domain';

export const memoryReviewSchema = z.object({
  decisions: z.array(z.object({
    id: z.string().min(1),
    verdict: z.enum(['supported', 'contradicted', 'unclear']),
    reason: z.string().min(1),
    evidence: z.array(z.object({ path: z.string().min(1), quote: z.string().min(1) })).min(1)
  }))
});

export function memoryReviewInput(store: FileStore, run: Run) {
  const items: { id: string; action: string; fact?: Fact; reason: string; path?: string }[] = [
    ...run.facts.map(fact => ({ id: fact.id, action: 'record', fact, reason: fact.replacementReason })),
    ...(run.factRetractions ?? []).map(retirement => {
      const fact = store.db.facts().find(fact => fact.id === retirement.id);
      if (!fact) throw new Error('待撤回记忆不存在');
      return { id: retirement.id, action: 'retract', fact, reason: retirement.reason };
    }),
    ...(run.memoryRepair?.completed ?? []).map(item => ({ id: `document:${item.path}`, action: 'review_document', reason: item.reason, path: item.path }))
  ];
  const files = [...new Set([...items.flatMap(item => item.fact ? item.fact.evidence.map(e => e.path) : item.path ? [item.path] : []), ...(run.memoryRepair?.sources ?? [])])];
  const sources = files.map(path => {
    const change = run.changes.find(change => change.path === path);
    const content = change?.content ?? store.readAccepted(path).content;
    return { path, hash: hash(content), content };
  });
  const input = { items, sources, ...(run.continuity ? { scope: run.continuity } : {}),
    ...(run.memoryRepair?.impacts?.length ? { impacts: run.memoryRepair.impacts } : {}) };
  return { ...input, fingerprint: hash(JSON.stringify(input)) };
}

export function memoryReviewIssues(store: FileStore, run: Run) {
  if (!run.facts.length && !run.factRetractions?.length && !run.memoryRepair) return [];
  const input = memoryReviewInput(store, run);
  if (run.memoryReview?.fingerprint !== input.fingerprint) return ['新增或修订的记忆尚未完成独立证据核对'];
  return run.memoryReview.issues;
}

export function parseMemoryReview(raw: string, items: { id: string; fact?: Fact; path?: string }[], sources: { path: string; content: string }[]) {
  const parsed = memoryReviewSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
  const ids = new Set(parsed.decisions.map(item => item.id));
  if (ids.size !== parsed.decisions.length || ids.size !== items.length || items.some(item => !ids.has(item.id)))
    throw new Error('证据核对未逐条覆盖待处理记忆');
  for (const decision of parsed.decisions) {
    if (decision.evidence.some(e => !sources.some(source => source.path === e.path && source.content.includes(e.quote))))
      throw new Error('核对结论缺少真实原文支持');
    const item = items.find(item => item.id === decision.id)!;
    const expected = item.fact?.evidence.map(e => e.path) ?? (item.path ? [item.path] : []);
    if (expected.length && !decision.evidence.some(e => expected.includes(e.path)))
      throw new Error('核对结论引用了无关文件，不能证明当前记忆或修订结果');
  }
  return parsed.decisions.filter(item => item.verdict !== 'supported').map(decision => {
    const item = items.find(item => item.id === decision.id)!;
    return `${item.fact?.subject ?? item.path ?? '记忆'}：${decision.reason}`;
  });
}
