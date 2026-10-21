import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ManagementLog, ManagementLogPage } from '../../shared/management';

/** Metadata only: never record request bodies, response bodies, keys or pairing URLs. */
export class ManagementAudit {
  private db: DatabaseSync;
  private writes = 0;
  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL,
        command TEXT NOT NULL, status TEXT NOT NULL, durationMs INTEGER NOT NULL,
        operationId TEXT, projectSessionId TEXT, errorCode TEXT);
      CREATE INDEX IF NOT EXISTS audit_status_seq ON audit(status, seq);`);
  }
  append(log: Omit<ManagementLog, 'seq' | 'at'>) {
    this.db
      .prepare(
        'INSERT INTO audit(at,source,command,status,durationMs,operationId,projectSessionId,errorCode) VALUES(?,?,?,?,?,?,?,?)'
      )
      .run(
        new Date().toISOString(),
        log.source,
        log.command,
        log.status,
        Math.round(log.durationMs),
        log.operationId ?? null,
        log.projectSessionId ?? null,
        log.errorCode ?? null
      );
    if (++this.writes % 100 === 0)
      this.db.exec('DELETE FROM audit WHERE seq < (SELECT MAX(seq)-20000 FROM audit)');
  }
  page(
    options: { before?: number; limit?: number; status?: string; query?: string } = {}
  ): ManagementLogPage {
    const limit = Math.min(200, Math.max(1, options.limit ?? 100));
    const rows = this.db
      .prepare(
        `SELECT * FROM audit WHERE seq < ? AND (? = '' OR status = ?)
      AND (? = '' OR instr(command, ?) > 0 OR instr(COALESCE(operationId, ''), ?) > 0)
      ORDER BY seq DESC LIMIT ?`
      )
      .all(
        options.before ?? Number.MAX_SAFE_INTEGER,
        options.status ?? '',
        options.status ?? '',
        options.query ?? '',
        options.query ?? '',
        options.query ?? '',
        limit + 1
      ) as unknown as ManagementLog[];
    const items = rows.slice(0, limit);
    return { items, nextBefore: rows.length > limit ? items.at(-1)!.seq : null };
  }
  close() {
    this.db.close();
  }
}
