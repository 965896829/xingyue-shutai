import type { Change, ProjectConfig, ProjectState, Run } from '../shared/types';
import type { CanonicalSnapshot } from '../shared/studio';
import type { FileStore } from './storage';
import { hash, isAuthorNote, paths, renderProgress, updateConfigDocument } from './domain';
import { fingerprint } from './runtime/canonical';

// These controls affect execution, never the author's story or approved evidence.
const executionKeys = ['maxRounds', 'maxTools', 'stageBudget', 'backupDirectory'] as const;
function portableProject(project: ProjectState) {
  const { root: _root, ...state } = project;
  return state;
}
function storyState(project: ProjectState) {
  const copy = structuredClone(project);
  delete (copy as Partial<ProjectState>).revision;
  for (const key of executionKeys) delete (copy.config as Partial<ProjectConfig>)[key];
  return portableProject(copy);
}

function executionOnlyStep(store: FileStore, before: CanonicalSnapshot, after: CanonicalSnapshot) {
  if (after.parentId !== before.id || after.revision !== before.revision + 1 ||
      fingerprint(storyState(before.project)) !== fingerprint(storyState(after.project)) ||
      fingerprint(before.facts) !== fingerprint(after.facts)) return false;
  for (const file of new Set([...Object.keys(before.documents), ...Object.keys(after.documents)])) {
    if (before.documents[file] === after.documents[file]) continue;
    if (!before.documents[file] || !after.documents[file]) return false;
    if (file === paths.config) {
      const previous = store.object(before.documents[file]).toString('utf8');
      if (hash(updateConfigDocument(previous, after.project)) !== after.documents[file]) return false;
    } else if (file === paths.progress) {
      if (hash(renderProgress(before.project)) !== before.documents[file] ||
          hash(renderProgress(after.project)) !== after.documents[file]) return false;
    } else return false;
  }
  return true;
}

/** Prove every intervening commit only changed execution settings. Fail closed for missing history. */
export function compatibleSettingsSnapshot(store: FileStore, snapshotId: string | undefined) {
  if (!snapshotId) return null;
  try {
    const head = store.db.head();
    if (!head || fingerprint(portableProject(head.project)) !== fingerprint(portableProject(store.db.project()))) return null;
    let cursor = head;
    const snapshots = [head];
    const seen = new Set<string>();
    while (cursor.id !== snapshotId) {
      if (!cursor.parentId || seen.has(cursor.id)) return null;
      seen.add(cursor.id);
      const parent = store.db.snapshot(cursor.parentId);
      if (!executionOnlyStep(store, parent, cursor)) return null;
      cursor = parent;
      snapshots.push(parent);
    }
    return { base: cursor, head, snapshots };
  } catch { return null; }
}

export function independentNotes(store: FileStore, run: Partial<Run>) {
  if (run.mode !== 'manual' || !run.changes?.length || run.projectId !== store.db.project().id ||
      run.manifest || run.facts?.length || run.factRetractions?.length || run.workbench || run.revisionCore || run.planning || run.design) return false;
  const project = store.db.project();
  return run.changes.every(change => isAuthorNote(change.path) && !project.stale.includes(change.path) &&
    !store.db.sql.prepare('SELECT 1 FROM dependencies WHERE source_path=? OR dependent=? LIMIT 1').get(change.path, change.path) &&
    !store.db.sql.prepare('SELECT 1 FROM fact_source_index WHERE path=? LIMIT 1').get(change.path));
}

export function compatibleRunBase(store: FileStore, run: Pick<Run, 'baseRevision' | 'baseSnapshotId'> & Partial<Run>) {
  const p = store.db.project();
  if (run.baseRevision === p.revision && (!run.baseSnapshotId || run.baseSnapshotId === store.db.get('headSnapshot'))) return true;
  if (run.baseSnapshotId && independentNotes(store, run)) {
    const base = store.db.snapshot(run.baseSnapshotId);
    return base.projectId === p.id && base.revision === run.baseRevision && run.changes!.every(change =>
      (base.documents[change.path] ?? null) === change.baseHash && (store.db.document(change.path)?.hash ?? null) === change.baseHash &&
      store.workingHash(change.path) === change.baseHash);
  }
  return compatibleSettingsSnapshot(store, run.baseSnapshotId)?.base.revision === run.baseRevision;
}

/** Keep the original source fingerprint; only the verified managed files may have newer hashes. */
export function currentSettingsSourceHash(store: FileStore, snapshotId: string | undefined, source: { path: string; hash: string | null }) {
  if (source.path !== paths.config && source.path !== paths.progress) return source.hash;
  const transition = compatibleSettingsSnapshot(store, snapshotId);
  return transition && transition.base.documents[source.path] === source.hash
    ? transition.head.documents[source.path] : source.hash;
}

function withCurrentExecutionSettings(text: string, config: ProjectConfig) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const pattern = /```json wenxu-config\s*\r?\n([\s\S]*?)\r?\n```/;
  const match = text.match(pattern);
  const managed = match ? JSON.parse(match[1]) : {};
  for (const key of executionKeys) managed[key] = config[key];
  const block = '```json wenxu-config' + newline + JSON.stringify(managed, null, 2).replaceAll('\n', newline) + newline + '```';
  return match ? text.replace(pattern, () => block) : text + newline + newline + '## 客户端设置' + newline + block + newline;
}

/** Merge only managed execution settings at commit time; never rewrite the reviewed story or its provenance. */
export function candidateChangesForCurrentSettings(store: FileStore, run: Pick<Run, 'baseRevision' | 'baseSnapshotId' | 'changes'>): Change[] {
  const changes = structuredClone(run.changes);
  if (!changes.some(change => change.path === paths.config) || run.baseSnapshotId === store.db.get('headSnapshot')) return changes;
  const transition = compatibleSettingsSnapshot(store, run.baseSnapshotId);
  if (!transition || transition.base.revision !== run.baseRevision) return changes;
  for (const change of changes) {
    if (change.path !== paths.config || !transition.snapshots.some(snapshot => change.baseHash === snapshot.documents[change.path])) continue;
    change.baseHash = transition.head.documents[change.path];
    change.content = withCurrentExecutionSettings(change.content, transition.head.project.config);
  }
  return changes;
}
