import { useEffect, useState } from 'react';
import type { Run, Snapshot } from '../shared/types';
import type { ManuscriptView } from '../shared/manuscript-view';
import { invokeCommand } from '../shared/client';

const reads = new Map<string, Promise<ManuscriptView>>();
export function useManuscriptView(snapshot: Snapshot, run: Run | undefined, includeDraft: boolean) {
  const candidate = run?.chapter === snapshot.project?.chapter ? run : undefined;
  // Only memory/prose completion changes invalidate this projection, not individual streamed tokens.
  const changes = candidate?.changes.filter(change => /^(04_|08_)/.test(change.path)).map(change => [change.path, change.content]);
  const key = JSON.stringify([snapshot.projectSessionId, snapshot.project?.revision, snapshot.project?.stale, snapshot.project?.chapter,
    snapshot.documents.filter(doc => doc.path.startsWith('04_')).map(doc => [doc.path, doc.acceptedHash]),
    candidate?.id, candidate?.accepted, candidate?.status, candidate?.pipeline?.phase, changes, candidate?.facts, includeDraft]);
  const [result, setResult] = useState<{ key: string; data?: ManuscriptView; error?: string }>();
  useEffect(() => {
    let active = true;
    let promise = reads.get(key);
    if (!promise) {
      promise = invokeCommand('manuscript.read', { runId: candidate?.id, includeDraft });
      reads.set(key, promise);
      void promise.catch(() => reads.delete(key));
      if (reads.size > 6) reads.delete(reads.keys().next().value!);
    }
    void promise.then(data => { if (active) setResult({ key, data }); }).catch(error => { if (active) setResult({ key, error: error.message }); });
    return () => { active = false; };
  }, [key]);
  return result?.key === key ? result : undefined;
}
