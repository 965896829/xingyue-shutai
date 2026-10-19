import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { hash } from './domain';

export function objectReferences(sql: DatabaseSync) {
  const required = new Set<string>();
  const retained = new Set<string>();
  const add = (value: unknown, target = required) => { if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) target.add(value); };
  const visit = (value: unknown) => {
    if (typeof value === 'string') add(value, retained);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  const tables = new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)));
  for (const table of ['documents', 'revisions']) if (tables.has(table))
    for (const row of sql.prepare(`SELECT hash FROM ${table}`).iterate()) add(row.hash);
  for (const table of ['snapshots', 'draft_artifacts', 'materialization_outbox', 'model_attempts', 'runs', 'candidate_versions', 'changesets', 'tool_executions', 'execution_checkpoints', 'assessments']) {
    if (!tables.has(table)) continue;
    for (const row of sql.prepare(`SELECT data FROM ${table}`).iterate()) {
      const data = JSON.parse(String(row.data));
      visit(data);
      if (table === 'snapshots') Object.values(data.documents ?? {}).forEach((value) => add(value));
      if (table === 'draft_artifacts') { add(data.hash); for (const version of data.versions ?? []) add(version.hash); }
      if (table === 'materialization_outbox') for (const entry of data) { add(entry.newHash); add(entry.baseHash); }
      if (table === 'model_attempts') { add(data.requestRef); add(data.responseRef); }
    }
  }
  if (tables.has('kv')) for (const row of sql.prepare('SELECT value FROM kv').iterate()) visit(JSON.parse(String(row.value)));
  for (const value of required) retained.add(value);
  return { required, retained };
}

export function verifyObjects(root: string, sql: DatabaseSync, manifest?: Set<string>) {
  const { required } = objectReferences(sql);
  for (const version of required) {
    const relative = `.novelclient/objects/${version}`;
    const file = path.join(root, relative);
    if (manifest && !manifest.has(relative)) throw new Error(`备份缺少被引用对象：${version}`);
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || hash(fs.readFileSync(file)) !== version)
      throw new Error(`历史对象缺失或校验失败：${version}`);
  }
  const integrity = sql.prepare('PRAGMA quick_check').get();
  if (!integrity || Object.values(integrity)[0] !== 'ok') throw new Error('数据库完整性校验失败');
  return required.size;
}

export function garbageCollectionPreview(root: string, sql: DatabaseSync) {
  const { retained } = objectReferences(sql);
  const objects = path.join(root, '.novelclient/objects');
  const transactions = path.join(root, '.novelclient/transactions');
  if (fs.existsSync(transactions)) for (const file of fs.readdirSync(transactions)) {
    if (!file.endsWith('.json')) continue;
    for (const match of fs.readFileSync(path.join(transactions, file), 'utf8').matchAll(/\b[a-f0-9]{64}\b/g)) retained.add(match[0]);
  }
  const rows = fs.existsSync(objects) ? fs.readdirSync(objects).filter((file) => /^[a-f0-9]{64}$/.test(file)).map((version) => ({ version, bytes: fs.statSync(path.join(objects, version)).size, retained: retained.has(version) })) : [];
  return { dryRun: true as const, deletionEnabled: false as const, objects: rows.length, bytes: rows.reduce((total, row) => total + row.bytes, 0),
    candidates: rows.filter((row) => !row.retained), retained: rows.filter((row) => row.retained).length,
    preservedFiles: fs.existsSync(path.join(root, '.novelclient/preserved')) ? fs.readdirSync(path.join(root, '.novelclient/preserved')).length : 0 };
}
