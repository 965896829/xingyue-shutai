import type { DatabaseSync } from 'node:sqlite';
import type { FileStore } from './storage';
import type { CanonicalSnapshot } from '../shared/studio';
import { indexTerms } from './text-search';
import { pendingSource } from './memory-source';

export function indexProse(sql: DatabaseSync, file: string, version: string, content: string) {
  if (!file.startsWith('07_')) return;
  if (sql.prepare('SELECT 1 FROM prose_search_versions WHERE path=? AND hash=?').get(file, version)) return;
  const row = sql.prepare('INSERT INTO prose_search_versions(path,hash,content) VALUES(?,?,?)').run(file, version, content);
  sql.prepare('INSERT INTO prose_search_terms(rowid,terms) VALUES(?,?)').run(row.lastInsertRowid, indexTerms(content).join(' '));
}
export function repairProse(store: FileStore, file: string, version: string, content: string) {
  store.db.transaction(() => {
    const row = store.db.sql.prepare('SELECT id FROM prose_search_versions WHERE path=? AND hash=?').get(file, version);
    if (row) {
      store.db.sql.prepare('DELETE FROM prose_search_terms WHERE rowid=?').run(row.id);
      store.db.sql.prepare('DELETE FROM prose_search_versions WHERE id=?').run(row.id);
    }
    indexProse(store.db.sql, file, version, content);
  });
}

export class ProseIndexer {
  private stopped = false;
  constructor(readonly store: FileStore) {}
  stop() { this.stopped = true; }
  async rebuild() {
    const rows = this.store.db.acceptedDocuments().filter(d => d.hash && d.path.startsWith('07_'));
    for (let i = 0; i < rows.length; i++) {
      if (this.stopped) return;
      const row = rows[i];
      if (!this.store.db.sql.prepare('SELECT 1 FROM prose_search_versions WHERE path=? AND hash=?').get(row.path, row.hash!))
        this.store.db.transaction(() => indexProse(this.store.db.sql, row.path, row.hash!, this.store.object(row.hash!).toString('utf8')));
      if (i % 16 === 15) await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
}

export function proseCandidates(store: FileStore, snapshot: CanonicalSnapshot, chapter: number, terms: string[], query: string, limit: number) {
  const eligible = Object.entries(snapshot.documents).filter(([file]) => {
    if (!file.startsWith('07_') || pendingSource(snapshot.project, file)) return false;
    const n = Number(file.match(/第(\d+)章/)?.[1]);
    return n > 0 && n <= chapter && !!snapshot.project.chapters[n];
  });
  const sql = store.db.sql;
  sql.exec('CREATE TEMP TABLE IF NOT EXISTS prose_search_scope(path TEXT PRIMARY KEY,hash TEXT NOT NULL) WITHOUT ROWID');
  store.db.transaction(() => {
    sql.exec('DELETE FROM prose_search_scope');
    const insert = sql.prepare('INSERT INTO prose_search_scope VALUES(?,?)');
    for (const [file, version] of eligible) insert.run(file, version);
  });
  const expression = [...new Set(terms)].filter(t => /[\p{L}\p{N}]/u.test(t)).map(t => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
  const maximum = Math.max(100, Math.min(500, limit * 20));
  const exactTerms = query.length <= 240 ? indexTerms(query.trim()) : [];
  const exactExpression = exactTerms.map(term => '"' + term.replaceAll('"', '""') + '"').join(' AND ');
  const precise = exactExpression ? sql.prepare(`SELECT d.path,d.hash,d.content FROM prose_search_terms f
    JOIN prose_search_versions d ON d.id=f.rowid JOIN prose_search_scope s ON s.path=d.path AND s.hash=d.hash
    WHERE prose_search_terms MATCH ? AND instr(lower(d.content),?)>0 LIMIT ?`).all(exactExpression, query.trim().toLowerCase(), maximum) as { path: string; hash: string; content: string }[] : [];
  const ranked = precise.length ? precise : expression ? sql.prepare(`SELECT d.path,d.hash,d.content FROM prose_search_terms f
    JOIN prose_search_versions d ON d.id=f.rowid JOIN prose_search_scope s ON s.path=d.path AND s.hash=d.hash
    WHERE prose_search_terms MATCH ? ORDER BY CASE WHEN ?<>'' AND instr(lower(d.content),?)>0 THEN 0 ELSE 1 END,bm25(prose_search_terms),d.path LIMIT ?`)
    .all(expression, query.length <= 240 ? query.toLowerCase().trim() : '', query.length <= 240 ? query.toLowerCase().trim() : '', maximum) as { path: string; hash: string; content: string }[] : [];
  const missing = sql.prepare('SELECT s.path,s.hash FROM prose_search_scope s LEFT JOIN prose_search_versions d ON s.path=d.path AND s.hash=d.hash WHERE d.id IS NULL').all() as { path: string; hash: string }[];
  return { ranked, missing, fallback: missing.length > 0 };
}
