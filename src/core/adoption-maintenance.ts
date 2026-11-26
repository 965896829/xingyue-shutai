import { assessmentSchema } from '../shared/contract-schemas';
import { rebuildMemory } from './memory';
import { syncEntities } from './memory-studio';
import type { FileStore } from './storage';

export function readAssessments(store: FileStore) {
  const projectId = store.db.project().id;
  const rows = store.db.sql.prepare('SELECT id,data FROM assessments ORDER BY rowid DESC LIMIT 500').all();
  return rows.flatMap(row => {
    try {
      const value = assessmentSchema.parse(JSON.parse(String(row.data)));
      if (value.id === row.id && value.projectId === projectId) return [value];
    } catch { /* Keep the original bytes for recovery. */ }
    store.db.transaction(() => {
      store.db.sql.prepare("INSERT OR IGNORE INTO auxiliary_quarantine VALUES('assessment',?,?)").run(row.id, row.data);
      store.db.sql.prepare('DELETE FROM assessments WHERE id=?').run(row.id);
    });
    return [];
  });
}

export function finishAdoptionWork(store: FileStore, opening = false) {
  const db = store.db;
  if (opening) {
    const enqueue = db.sql.prepare("INSERT OR IGNORE INTO adoption_followups VALUES('open',?,'project')");
    if (db.get<number>('indexRevision') !== db.project().revision) enqueue.run('memory');
    if (db.get<number>('entityIndexRevision') !== db.project().revision) enqueue.run('entities');
  }
  const has = (kind: string) => db.sql.prepare('SELECT 1 FROM adoption_followups WHERE kind=? LIMIT 1').get(kind);
  const pending: string[] = [];
  if (has('documents')) {
    store.updateDocumentViews();
    if (has('documents')) pending.push('文稿检索与编辑记录');
  }
  // Both indexes describe the current head. A single rebuild covers all outstanding commits.
  for (const [kind, label, rebuild] of [
    ['memory', '记忆索引', rebuildMemory], ['entities', '人物索引', syncEntities]
  ] as const) {
    if (!has(kind)) continue;
    try {
      if (kind === 'entities' && has('memory')) { pending.push(label); continue; }
      rebuild(store);
      if (kind === 'entities') db.set('entityIndexRevision', db.project().revision);
      db.sql.prepare('DELETE FROM adoption_followups WHERE kind=?').run(kind);
    } catch {
      pending.push(label);
    }
  }
  for (const row of db.sql.prepare("SELECT tx,run_id FROM adoption_followups WHERE kind='assessments' ORDER BY rowid").all()) {
    try {
      const proseHash = db.run(String(row.run_id)).pipeline?.proseHash;
      db.transaction(() => {
        const rows = db.sql.prepare("SELECT data FROM assessments WHERE CASE WHEN json_valid(data) THEN json_extract(data,'$.track')='candidate' AND json_extract(data,'$.draftId')=? AND json_extract(data,'$.hash')=? ELSE 0 END").all(row.run_id, proseHash ?? '');
        for (const source of rows) {
          const original = assessmentSchema.safeParse(JSON.parse(String(source.data)));
          if (!original.success) continue;
          const id = 'accepted:' + row.tx + ':' + original.data.id;
          db.sql.prepare('INSERT OR IGNORE INTO assessments VALUES(?,?)').run(id, JSON.stringify({
            ...original.data, id, track: 'accepted', snapshotId: row.tx
          }));
        }
        db.sql.prepare("DELETE FROM adoption_followups WHERE tx=? AND kind='assessments'").run(row.tx);
      });
    } catch {
      if (!pending.includes('节奏评估')) pending.push('节奏评估');
    }
  }
  return pending;
}
