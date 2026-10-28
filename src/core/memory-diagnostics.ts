import { z } from 'zod';
import { factSchema } from '../shared/types';
import type { MemoryScope } from '../shared/studio';
import type { FileStore } from './storage';

export const memoryDiagnosticSchema = z.object({
  code: z.enum(['duplicate_id', 'invalid_document', 'invalid_evidence']),
  path: z.string(), message: z.string(), fact: factSchema.optional()
});
export type MemoryDiagnostic = z.infer<typeof memoryDiagnosticSchema>;
const recordSchema = z.object({ version: z.literal(1), revision: z.number(), issues: z.array(memoryDiagnosticSchema) });
export interface MemorySelection {
  scope: MemoryScope;
  query: string;
  sourcePaths: string[];
  entityIds?: string[];
}

/** Index diagnostics are derived data. Missing/stale legacy metadata never
 * grants permission to ignore an error whose scope cannot be established. */
export function selectMemoryDiagnostics(store: FileStore, selection: MemorySelection) {
  const messages = store.db.get<string[]>('memoryIssues') ?? [];
  const parsed = recordSchema.safeParse(store.db.get('memoryDiagnostics'));
  const isolated: MemoryDiagnostic[] = [];
  if (!parsed.success || parsed.data.revision !== store.db.project().revision ||
      JSON.stringify(parsed.data.issues.map(issue => issue.message)) !== JSON.stringify(messages))
    return { blocking: messages, isolated };
  const { scope, query } = selection;
  const sources = new Set(selection.sourcePaths), entities = new Set(selection.entityIds ?? []);
  const blocking: string[] = [];
  for (const issue of parsed.data.issues) {
    const f = issue.fact;
    // Duplicate identities and unparseable documents have unknown reach. A
    // document actually loaded into this request also cannot be quarantined.
    let relevant = issue.code !== 'invalid_evidence' || !f || !f.worldId || !f.timelineId || sources.has(issue.path);
    if (!relevant && f && f.worldId === scope.worldId && f.timelineId === scope.timelineId &&
        f.fromChapter <= scope.chapter && (f.toChapter === null || f.toChapter >= scope.chapter) &&
        f.state !== 'superseded' && f.reviewStatus !== 'retracted') {
      relevant = f.scope === 'global' || !f.entityIds.length || ['world_rule', 'author_constraint'].includes(f.kind) ||
        [...f.entityIds, ...f.relatedIds].some(id => entities.has(id)) ||
        [f.id, f.subject, ...f.aliases, ...f.entityIds, ...f.relatedIds].some(name => !!name && query.includes(name));
    }
    if (relevant) blocking.push(issue.message); else isolated.push(issue);
  }
  return { blocking, isolated };
}
