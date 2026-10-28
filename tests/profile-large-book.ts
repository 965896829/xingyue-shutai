import fs from 'node:fs';
import path from 'node:path';
import { FileStore } from '../src/core/storage';
import { verifyObjects } from '../src/core/integrity';
import { rebuildMemory } from '../src/core/memory';
import { syncEntities, retrieveMemory } from '../src/core/memory-studio';

if (!process.argv[2]) throw new Error('请显式传入已生成的隔离容量样本目录：node --import tsx tests/profile-large-book.ts <样本目录>');
const root = path.resolve(process.argv[2]);
if (!fs.existsSync(path.join(root, '.novelclient/state.sqlite'))) throw new Error('容量样本不存在；先运行 npm run test:large-book 生成样本');
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
