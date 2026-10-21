import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FileStore } from '../../src/core/storage';
import { ProjectCommitService } from '../../src/core/runtime/commit-kernel';
import type { ProjectState, Run } from '../../src/shared/types';

export function interruptApprovedCommit(store: FileStore, run: Run, next: ProjectState) {
  const directory = path.join(store.root, '.novelclient/transactions');
  const before = new Set(fs.readdirSync(directory));
  const original = store.commit;
  store.commit = function(changes, state, candidate, fault, approvalId) {
    return original.call(this, changes, state, candidate, (point) => {
      fault?.(point);
      if (point === 'prepared') throw new Error('fixture interruption after approved prepare');
    }, approvalId);
  };
  try {
    assert.throws(() => new ProjectCommitService(store).commit(run.changes, next,
      { ...run, accepted: true, status: 'complete' }), /fixture interruption/);
  } finally { store.commit = original; }
  const filename = fs.readdirSync(directory).find((file) => !before.has(file) && file.endsWith('.json'))!;
  assert.ok(filename, 'missing prepared journal');
  const file = path.join(directory, filename), bytes = fs.readFileSync(file);
  const journal = JSON.parse(bytes.toString('utf8')) as {
    id: string; approvalId: string; payloadHash: string; run: Run; project: ProjectState;
    changes: { path: string; baseHash: string | null; newHash: string }[];
  };
  return { file, bytes, journal, transactionId: journal.id };
}
