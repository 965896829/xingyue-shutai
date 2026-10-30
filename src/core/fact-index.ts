import type { FileStore } from './storage';
import { factSchema, type Fact } from '../shared/types';
import { validateEvidence } from './memory-records';
import { pendingSource } from './memory-source';

export function updateFactIndex(store: FileStore, changedSources: string[], revision: number) {
  const { db } = store,
    sql = db.sql;
  const documents = db.acceptedDocuments().filter((doc) => doc.path.startsWith('04_') && doc.hash);
  const versions = new Map(
    (sql.prepare('SELECT path,hash FROM fact_ledger_versions').all() as { path: string; hash: string }[]).map(
      (row) => [row.path, row.hash]
    )
  );
  const rebuild = !db.get<boolean>('factLedgerIndexValid');
  const changed = documents.filter((doc) => rebuild || versions.get(doc.path) !== doc.hash);
  const removed = [...versions.keys()].filter((file) => !documents.some((doc) => doc.path === file));
  const affected = new Set<string>();
  if (rebuild) {
    sql.exec('DELETE FROM fact_ledgers; DELETE FROM fact_ledger_versions; DELETE FROM facts');
  } else {
    for (const file of [...changed.map((doc) => doc.path), ...removed]) {
      for (const row of sql.prepare('SELECT id FROM fact_ledgers WHERE path=?').all(file))
        affected.add(String(row.id));
      sql.prepare('DELETE FROM fact_ledgers WHERE path=?').run(file);
      sql.prepare('DELETE FROM fact_ledger_versions WHERE path=?').run(file);
    }
  }
  const insert = sql.prepare('INSERT INTO fact_ledgers VALUES(?,?,?)');
  const source = sql.prepare('INSERT OR IGNORE INTO fact_source_index VALUES(?,?,?)');
  for (const doc of changed) {
    const content = store.object(doc.hash!).toString('utf8');
    const match = content.match(/<!-- wenxu-facts:v1 -->\s*```json\s*\n([\s\S]*?)\n```/);
    if (match) {
      const input: unknown = JSON.parse(match[1]);
      if (!Array.isArray(input)) throw new Error('事实记录必须为数组');
      for (const item of input) {
        const fact = factSchema.parse(item);
        insert.run(fact.id, doc.path, JSON.stringify(fact));
        for (const evidence of fact.evidence) source.run(fact.id, evidence.path, evidence.hash);
        affected.add(fact.id);
      }
    }
    sql.prepare('INSERT INTO fact_ledger_versions VALUES(?,?)').run(doc.path, doc.hash!);
  }
  for (const file of changedSources)
    for (const row of sql.prepare('SELECT fact_id FROM fact_source_index WHERE path=?').all(file))
      affected.add(String(row.fact_id));
  const project = db.project();
  const previousAvailability = db.get<Record<string, boolean>>('factSourceAvailability') ?? {};
  const availability: Record<string, boolean> = {};
  for (const row of sql.prepare('SELECT DISTINCT path FROM fact_source_index').all()) {
    const file = String(row.path), pending = pendingSource(project, file);
    availability[file] = pending;
    if (previousAvailability[file] !== undefined && previousAvailability[file] !== pending)
      for (const fact of sql.prepare('SELECT fact_id FROM fact_source_index WHERE path=?').all(file)) affected.add(String(fact.fact_id));
  }
  const upsert = sql.prepare(
    'INSERT INTO facts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,source_hash=excluded.source_hash WHERE facts.data<>excluded.data'
  );
  const dependency = sql.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?,?)');
  const sourceCache = new Map<string, { content: string; hash: string }>();
  const sourcePaths = new Set<string>();
  for (const key of affected) for (const row of sql.prepare('SELECT path FROM fact_source_index WHERE fact_id=?').all(key)) sourcePaths.add(String(row.path));
  const candidates = changedSources.filter(path => sourcePaths.has(path) && db.document(path)?.hash).map(path => ({ path, content: store.object(db.document(path)!.hash!).toString('utf8'), baseHash: db.document(path)!.hash }));
  for (const key of affected) {
    const row = sql.prepare('SELECT data FROM fact_ledgers WHERE id=?').get(key);
    if (!row) {
      sql.prepare('DELETE FROM facts WHERE id=?').run(key);
      continue;
    }
    const fact = JSON.parse(String(row.data)) as Fact;
    if (!['accepted', 'disputed'].includes(fact.reviewStatus)) { sql.prepare('DELETE FROM facts WHERE id=?').run(key); continue; }
    if (
      fact.state !== 'superseded' &&
      validateEvidence(store, fact, Math.max(project.chapter, fact.revealedAt), candidates, [], project, sourceCache).length
    ) {
      fact.state = 'disputed';
      fact.reviewStatus = 'disputed';
    }
    upsert.run(fact.id, JSON.stringify(fact), fact.evidence.map((e) => e.hash).join(','));
    for (const evidence of fact.evidence) dependency.run(evidence.path, evidence.hash, fact.id, 'fact');
  }
  db.set('indexRevision', revision);
  db.set('factLedgerIndexValid', true);
  db.set('factSourceAvailability', availability);
  return { rebuilt: rebuild, ledgers: changed.length, facts: affected.size };
}
