import type { DatabaseSync } from 'node:sqlite';

/** Rebuildable lookup data, maintained in the same transaction as canonical facts. */
export function ensureFactRecallIndex(sql: DatabaseSync) {
  const insert = (record: string) => `
    DELETE FROM fact_recall_names WHERE fact_id=${record}.id;
    DELETE FROM fact_recall_links WHERE fact_id=${record}.id;
    DELETE FROM fact_recall_sources WHERE fact_id=${record}.id;
    INSERT OR REPLACE INTO fact_recall VALUES(${record}.id,json_extract(${record}.data,'$.worldId'),json_extract(${record}.data,'$.timelineId'),
      json_extract(${record}.data,'$.fromChapter'),json_extract(${record}.data,'$.kind'),json_extract(${record}.data,'$.scope'),
      json_extract(${record}.data,'$.category'),json_extract(${record}.data,'$.mandatory'),
      lower(json_extract(${record}.data,'$.subject')||' '||json_extract(${record}.data,'$.predicate')||' '||json_extract(${record}.data,'$.value')));
    INSERT INTO fact_recall_names SELECT ${record}.id,json_extract(${record}.data,'$.subject')
      UNION SELECT ${record}.id,value FROM json_each(${record}.data,'$.aliases') WHERE length(value)>0;
    INSERT INTO fact_recall_links SELECT DISTINCT ${record}.id,value,'entity' FROM json_each(${record}.data,'$.entityIds');
    INSERT INTO fact_recall_links SELECT DISTINCT ${record}.id,value,'related' FROM json_each(${record}.data,'$.relatedIds');
    INSERT INTO fact_recall_links SELECT DISTINCT ${record}.id,json_extract(value,'$.who'),'knowledge' FROM json_each(${record}.data,'$.knowledge');
    INSERT INTO fact_recall_sources SELECT DISTINCT ${record}.id,json_extract(value,'$.path') FROM json_each(${record}.data,'$.evidence');`;
  const remove = `DELETE FROM fact_recall WHERE id=old.id; DELETE FROM fact_recall_names WHERE fact_id=old.id;
    DELETE FROM fact_recall_links WHERE fact_id=old.id; DELETE FROM fact_recall_sources WHERE fact_id=old.id;`;
  sql.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS fact_recall(id TEXT PRIMARY KEY,world TEXT,timeline TEXT,chapter INTEGER,kind TEXT,scope TEXT,category TEXT,mandatory INTEGER,search_text TEXT);
    CREATE INDEX IF NOT EXISTS fact_recall_scope ON fact_recall(world,timeline,chapter);
    CREATE TABLE IF NOT EXISTS fact_recall_names(fact_id TEXT,name TEXT,PRIMARY KEY(fact_id,name));
    CREATE INDEX IF NOT EXISTS fact_recall_name ON fact_recall_names(name,fact_id);
    CREATE TABLE IF NOT EXISTS fact_recall_links(fact_id TEXT,entity TEXT,role TEXT,PRIMARY KEY(fact_id,entity,role));
    CREATE INDEX IF NOT EXISTS fact_recall_entity ON fact_recall_links(entity,role,fact_id);
    CREATE TABLE IF NOT EXISTS fact_recall_sources(fact_id TEXT,path TEXT,PRIMARY KEY(fact_id,path));
    CREATE INDEX IF NOT EXISTS fact_recall_path ON fact_recall_sources(path,fact_id);
    DROP TRIGGER IF EXISTS facts_recall_insert;
    DROP TRIGGER IF EXISTS facts_recall_update;
    DROP TRIGGER IF EXISTS facts_recall_delete;
    CREATE TRIGGER facts_recall_insert AFTER INSERT ON facts BEGIN ${insert('new')} END;
    CREATE TRIGGER facts_recall_update AFTER UPDATE ON facts WHEN old.data<>new.data BEGIN ${remove} ${insert('new')} END;
    CREATE TRIGGER facts_recall_delete AFTER DELETE ON facts BEGIN ${remove} END;`);
  try {
    const version = sql.prepare("SELECT value FROM kv WHERE key='factRecallVersion'").get()?.value;
    const mismatch = sql.prepare('SELECT (SELECT count(*) FROM facts)<>(SELECT count(*) FROM fact_recall) AS mismatch').get()?.mismatch;
    if (version !== '2' || mismatch) {
      sql.exec('DELETE FROM fact_recall; DELETE FROM fact_recall_names; DELETE FROM fact_recall_links; DELETE FROM fact_recall_sources;');
      sql.exec(`INSERT OR REPLACE INTO fact_recall SELECT id,json_extract(data,'$.worldId'),json_extract(data,'$.timelineId'),
        json_extract(data,'$.fromChapter'),json_extract(data,'$.kind'),json_extract(data,'$.scope'),json_extract(data,'$.category'),
        json_extract(data,'$.mandatory'),lower(json_extract(data,'$.subject')||' '||json_extract(data,'$.predicate')||' '||json_extract(data,'$.value')) FROM facts;
        INSERT OR IGNORE INTO fact_recall_names SELECT id,json_extract(data,'$.subject') FROM facts;
        INSERT OR IGNORE INTO fact_recall_names SELECT f.id,a.value FROM facts f,json_each(f.data,'$.aliases') a WHERE length(a.value)>0;
        INSERT OR IGNORE INTO fact_recall_links SELECT f.id,e.value,'entity' FROM facts f,json_each(f.data,'$.entityIds') e;
        INSERT OR IGNORE INTO fact_recall_links SELECT f.id,e.value,'related' FROM facts f,json_each(f.data,'$.relatedIds') e;
        INSERT OR IGNORE INTO fact_recall_links SELECT f.id,json_extract(e.value,'$.who'),'knowledge' FROM facts f,json_each(f.data,'$.knowledge') e;
        INSERT OR IGNORE INTO fact_recall_sources SELECT f.id,json_extract(e.value,'$.path') FROM facts f,json_each(f.data,'$.evidence') e;`);
      sql.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('factRecallVersion', '2');
    }
    sql.exec('COMMIT');
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
}
