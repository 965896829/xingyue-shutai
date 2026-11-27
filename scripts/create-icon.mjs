import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestWorkspace } from './with-test-workspace.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--with-ico'))
  throw new Error('用法：node scripts/create-icon.mjs [--with-ico]');
process.exitCode = await withTestWorkspace([path.join(root, 'scripts/export-brand.cjs'), ...args], { cwd: root, electron: true });
