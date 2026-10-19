import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// nativeImage is available in an Electron main process, not ELECTRON_RUN_AS_NODE.
// This worker creates no window and uses its own disposable Chromium profile.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(root, 'scripts/export-brand.cjs')], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: 'inherit'
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('close', (code) => { process.exitCode = code ?? 1; });
