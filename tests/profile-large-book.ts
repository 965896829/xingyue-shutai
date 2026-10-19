import fs from 'node:fs';
import path from 'node:path';
import { FileStore } from '../src/core/storage';
import { verifyObjects } from '../src/core/integrity';
import { rebuildMemory } from '../src/core/memory';
import { syncEntities, retrieveMemory } from '../src/core/memory-studio';

const root = path.resolve(process.argv[2] ?? '.test-output/scale-50m-20261012/book');
const report: Record<string, number> = {};
const measure = <T>(name: string, fn: () => T) => { const at = performance.now(), value = fn(); report[name] = Math.round(performance.now() - at); console.log(JSON.stringify({ name, milliseconds: report[name] })); return value; };
const store = measure('constructor', () => new FileStore(root));
try {
  measure('integrity', () => verifyObjects(store.root, store.db.sql));
  measure('recovery', () => store.recover());
  measure('memory', () => rebuildMemory(store));
  measure('entities', () => syncEntities(store));
  measure('scan', () => store.scan());
  measure('snapshot', () => store.db.head());
  measure('query', () => retrieveMemory(store, '第17222号伏笔', { chapter: 20000 }));
  fs.writeFileSync(path.join(root, '../profile-phases.json'), JSON.stringify(report, null, 2));
} finally { store.close(); }
