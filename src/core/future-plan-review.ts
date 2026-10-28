import { z } from 'zod';
import type { Run } from '../shared/types';
import type { FileStore } from './storage';
import { hash, prosePath, estimatedChapters } from './domain';
import { isFuturePlan } from './story-impact';
import { memoryReviewMatches } from './memory-review';

export function futurePlanReviewInput(store: FileStore, run: Run) {
  const proseFile = prosePath(run.chapter);
  const prose = run.changes.find(change => change.path === proseFile) ?? store.readAccepted(proseFile);
  const plans = run.chapter >= estimatedChapters(store.db.project().config) ? [] : store.db.acceptedDocuments()
    .filter(doc => isFuturePlan(doc.path, run.chapter + 1) && !run.changes.some(change => change.path === doc.path))
    .map(doc => {
      const source = store.readAccepted(doc.path), digest = hash(source.content);
      if (doc.hash !== digest || store.inspect(doc.path)?.status !== 'accepted')
        throw new Error(`后续计划版本需核对：${doc.path}`);
      return { path: doc.path, hash: digest, content: source.content };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const input = { chapter: run.chapter, fromChapter: run.chapter + 1,
    prose: { path: proseFile, hash: hash(prose.content), content: prose.content }, plans };
  return { ...input, fingerprint: hash(JSON.stringify(input)) };
}

/** Old receipts included extracted facts in their fingerprint. Accept them only
 * for that exact legacy input; new reviews depend on prose and plans themselves. */
export function futurePlanReviewMatches(run: Run, input: ReturnType<typeof futurePlanReviewInput>) {
  return !!run.futurePlanReview && (run.futurePlanReview.fingerprint === input.fingerprint ||
    run.futurePlanReview.fingerprint === hash(JSON.stringify({ chapter: input.chapter, fromChapter: input.fromChapter,
      prose: input.prose, plans: input.plans, facts: run.facts })));
}

const schema = z.object({ decisions: z.array(z.object({
  path: z.string(), verdict: z.enum(['consistent', 'needs_review']), reason: z.string().min(8),
  planQuote: z.string().min(8), proseQuote: z.string().min(8)
})) });

export function parseFuturePlanReview(raw: string, input: ReturnType<typeof futurePlanReviewInput>): NonNullable<Run['futurePlanReview']> {
  const data = schema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
  const paths = new Set(data.decisions.map(item => item.path));
  if (paths.size !== data.decisions.length || paths.size !== input.plans.length || input.plans.some(plan => !paths.has(plan.path)))
    throw new Error('后续计划核对必须逐份覆盖当前范围');
  const decisions = data.decisions.map(item => {
    const plan = input.plans.find(plan => plan.path === item.path)!;
    if (!plan.content.includes(item.planQuote) || !input.prose.content.includes(item.proseQuote))
      throw new Error('后续计划核对必须同时引用准确的计划与当前正文');
    return { ...item, hash: plan.hash };
  });
  return { fingerprint: input.fingerprint, decisions };
}

/** Missing, stale or partial receipts retain the conservative legacy review requirement. */
export function confirmedAlignedPlans(store: FileStore, run: Run) {
  if (!run.futurePlanReview) return new Set<string>();
  if (run.facts.length && (!memoryReviewMatches(store, run) || run.memoryReview!.issues.length)) return new Set<string>();
  const input = futurePlanReviewInput(store, run);
  if (!futurePlanReviewMatches(run, input)) return new Set<string>();
  return new Set(run.futurePlanReview.decisions.filter(item => item.verdict === 'consistent' &&
    input.plans.some(plan => plan.path === item.path && plan.hash === item.hash)).map(item => item.path));
}
