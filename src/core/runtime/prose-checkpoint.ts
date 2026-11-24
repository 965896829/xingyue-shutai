import type { ModelResult, Run, SecretProfile } from '../../shared/types';
import { decodeNarrativeResponse } from '../../shared/narrative-events';
import { alignChapterTitle } from '../chapter-naming';
import { hash, prosePath } from '../domain';
import type { FileStore } from '../storage';
import { recordUsage } from '../telemetry';

interface ProseTail { epoch: string; version: number; start: number; text: string }
interface ProseReceipt { responseRef: string; round: number; requestHash: string; snapshot?: string }

// Between full run snapshots, persist only the new text before the UI receives it.
export function streamProseCheckpoint(store: FileStore, run: Run) {
  let start = 0, lastSave = 0;
  const key = `prose-tail:${run.id}`;
  return (draft: string) => {
    const time = Date.now();
    if (!lastSave || time - lastSave >= 800 || draft.length - start >= 8192) {
      store.db.transaction(() => {
        store.db.saveRun(run);
        store.db.sql.prepare('DELETE FROM kv WHERE key=?').run(key);
      });
      start = draft.length;
      lastSave = time;
    } else {
      const { epoch, version } = run.pipeline!;
      store.db.set(key, { epoch, version, start, text: draft.slice(start) } satisfies ProseTail);
    }
  };
}

export function restoreProseTail(store: FileStore, run: Run) {
  const key = `prose-tail:${run.id}`;
  const tail = store.db.get<ProseTail>(key);
  if (!tail) return;
  const change = run.changes.find(item => item.path === prosePath(run.chapter));
  if (run.pipeline?.phase === 'prose' && run.pipeline.epoch === tail.epoch && change &&
      change.content.length >= tail.start && change.content.length < tail.start + tail.text.length &&
      tail.text.startsWith(change.content.slice(tail.start))) {
    change.content = change.content.slice(0, tail.start) + tail.text;
    run.pipeline.version = Math.max(run.pipeline.version, tail.version);
    store.db.saveRun(run);
  }
  store.db.sql.prepare('DELETE FROM kv WHERE key=?').run(key);
}

// Called in the same transaction that settles the provider attempt.
export function checkpointProseReceipt(store: FileStore, run: Run, profile: SecretProfile, ref: string, result: ModelResult) {
  const path = prosePath(run.chapter);
  if (result.text && !result.calls.length) {
    const change = alignChapterTitle(run, { path, content: decodeNarrativeResponse(result.text).text, baseHash: store.db.document(path)?.hash ?? null });
    run.changes = [...run.changes.filter(item => item.path !== path), change];
  }
  if (result.stop === 'complete' && !result.calls.length) {
    store.db.set(`received-prose:${run.id}`, { responseRef: ref, round: run.rounds, requestHash: hash(run.request), snapshot: run.baseSnapshotId } satisfies ProseReceipt);
  }
  store.db.sql.prepare('DELETE FROM kv WHERE key=?').run(`prose-tail:${run.id}`);
  recordUsage(store, run, result.usage, { phase: 'prose', profileId: profile.id, profileVersion: profile.version, usage: result.usage });
  store.db.set(`inflight:${run.id}`, false);
  store.db.saveRun(run);
}

export function receivedProse(store: FileStore, run: Run): ModelResult | undefined {
  if (run.pipeline?.phase !== 'prose') return;
  const receipt = store.db.get<ProseReceipt>(`received-prose:${run.id}`);
  if (receipt && receipt.round === run.rounds && receipt.snapshot === run.baseSnapshotId && receipt.requestHash === hash(run.request))
    return JSON.parse(store.object(receipt.responseRef).toString('utf8')).result;
}

export function finishProseReceipt(store: FileStore, run: Run) {
  store.db.sql.prepare('DELETE FROM kv WHERE key IN (?,?)').run(`received-prose:${run.id}`, `prose-tail:${run.id}`);
}
