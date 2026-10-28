import path from 'node:path';
import type { Run, Issue, Change, Fact } from '../../shared/types';
import type { CandidateRepair } from '../../shared/recovery';
import type { TagPlanning } from '../../shared/tags';
import { ApplicationError } from '../../shared/errors';
import { fingerprint } from './canonical';

const canonicalPath = (value: string) => path.posix.normalize(value.replaceAll('\\', '/')).toLowerCase();
export function planCandidateRepair(run: Run, issues: Issue[], phase: string): CandidateRepair {
  const errors = issues.filter(i => i.severity === 'error');
  const paths = [...new Set(errors.flatMap(issue => issue.path ? [issue.path] : []))];
  const factIds = [...new Set(errors.flatMap(issue => issue.factId ? [issue.factId] : []))];
  const unresolvedIssues = errors.filter(issue => !issue.path && !issue.factId).map(({ code, message }) => ({ code, message }));
  const allowed = new Set(paths.map(canonicalPath));
  const protectedHashes = Object.fromEntries(run.changes.filter(c => !allowed.has(canonicalPath(c.path))).map(c => [c.path, fingerprint(c)]));
  const protectedFactHashes = Object.fromEntries(run.facts.filter(f => !factIds.includes(f.id)).map(f => [f.id, fingerprint(f)]));
  return { version: 2, phase, paths, factIds, protectedHashes, protectedFactHashes, unresolvedIssues,
    allowNewFacts: !run.memoryCompletionHash && (phase === 'memory' || run.stage === 'S11') && paths.length > 0 && !unresolvedIssues.length,
    fingerprint: fingerprint({ errors, candidates: run.changes, facts: run.facts }), attempts: (run.repairAttempts?.[phase] ?? 0) + 1 };
}
export function repairContext(run: Run) {
  const scope = run.repairScope;
  if (!scope) return;
  return { paths: scope.paths, factIds: scope.factIds ?? [], protectedPaths: Object.keys(scope.protectedHashes),
    unresolvedIssues: scope.unresolvedIssues ?? [], allowNewFacts: scope.allowNewFacts,
    instruction: '仅修改列出的文件和事实编号，其他候选与事实原样保留。未定位的问题不能扩大修改范围；先读取资料或调用 validate 核对，不重生成全部内容。' };
}
export function assertRepairWrite(run: Run, changes: Change[]) {
  if (!run.repairScope) return;
  for (const change of changes) {
    const normalizedPath = canonicalPath(change.path);
    const frozen = Object.entries(run.repairScope.protectedHashes).find(([file]) => canonicalPath(file) === normalizedPath)?.[1];
    if (frozen && frozen !== fingerprint(change))
      throw new ApplicationError('VALIDATION_ERROR', `局部修复不能改写已通过检查的候选：${change.path}。请只提交列出的待修复文件。`);
    // Old checkpoints stored only frozen candidates, not a complete allowlist.
    // Keep their original protection until the next validation creates v2 scope.
    if (run.repairScope.version === 2 && !frozen && !run.repairScope.paths.some(file => canonicalPath(file) === normalizedPath))
      throw new ApplicationError('VALIDATION_ERROR', `局部修复未授权修改此文件：${change.path}。未定位的问题不能扩大修复范围。`);
  }
}
export function assertRepairFacts(run: Run, facts: Fact[]) {
  const scope = run.repairScope;
  if (scope?.version !== 2) return;
  for (const [id, digest] of Object.entries(scope.protectedFactHashes ?? {}))
    if (fingerprint(facts.find(f => f.id === id) ?? null) !== digest)
      throw new ApplicationError('VALIDATION_ERROR', `局部修复不能改写未涉及的事实：${id}`);
  for (const fact of facts)
    if (!run.facts.some(f => f.id === fact.id) && !scope.factIds?.includes(fact.id) && !scope.allowNewFacts)
      throw new ApplicationError('VALIDATION_ERROR', `局部修复未授权新增事实：${fact.id}`);
}

/** JSON Pointer scopes come from a verified review; the rest of the candidate is frozen. */
export function reviewRepairPointers(issues: { severity: string; jsonPointer: string }[]) {
  const pointers = issues.filter(i => i.severity !== 'minor').map(i => i.jsonPointer);
  // Keep the first array item as the unit, including nested plan/statements.
  return [...new Set(pointers.map(p => {
    if (!p) return '';
    const parts = p.split('/');
    const item = parts.findIndex((part, index) => index > 0 && /^\d+$/.test(part));
    return parts.slice(0, item >= 0 ? item + 1 : 2).join('/');
  }))];
}

/** A contract's prose is a projection of its constraints and plan. Freezing it
 * while repairing those fields creates a contradiction on the next review. */
export function planningRepairPointers(planning: TagPlanning, report: boolean) {
  const receipt = report ? planning.reportReview : planning.contractReview;
  const pointers = reviewRepairPointers(receipt?.result.issues ?? []);
  if (report || !planning.candidate) return pointers;
  const candidate = planning.candidate;
  const constraints = new Set(candidate.constraints.filter((_row, index) => pointers.includes(`/constraints/${index}`)).map(row => row.id));
  // Include sibling statements backed by the same explicitly cited constraint.
  // One hop from the reviewed locations only: generic direction/author refs and
  // newly included siblings cannot recursively unlock the rest of the plan.
  for (const [index, statement] of (candidate.plan?.statements ?? []).entries())
    if (pointers.includes(`/plan/statements/${index}`))
      for (const ref of statement.sourceRefs)
        if (candidate.constraints.some(row => row.id === ref)) constraints.add(ref);
  for (const [index, statement] of (candidate.plan?.statements ?? []).entries())
    if (statement.sourceRefs.some(ref => constraints.has(ref))) pointers.push(`/plan/statements/${index}`);
  if (planning.origin === 'new' && pointers.some(p => /^\/(?:constraints|plan|openQuestions)(?:\/|$)/.test(p)))
    pointers.push('/premiseDocument');
  return [...new Set(pointers)];
}
export function assertStructuredRepair(previous: unknown, next: unknown, pointers: string[]) {
  const allowed = (path: string) => pointers.some(p => p === '' || path === p || path.startsWith(p + '/'));
  const visit = (before: unknown, after: unknown, path: string) => {
    if (allowed(path) || before === after || before !== undefined && after !== undefined && fingerprint(before) === fingerprint(after)) return;
    const nested = pointers.some(p => p.startsWith(path + '/'));
    if (!nested || !before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after))
      throw new ApplicationError('VALIDATION_ERROR', `局部修复改写了未要求调整的内容：${path || '/'}。请保留其原值。`);
    if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length)
      throw new ApplicationError('VALIDATION_ERROR', `局部修复不能增删未涉及的候选：${path}`);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const encode = key.replaceAll('~', '~0').replaceAll('/', '~1');
      visit((before as any)[key], (after as any)[key], `${path}/${encode}`);
    }
  };
  visit(previous, next, '');
}
