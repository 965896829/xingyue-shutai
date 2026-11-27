import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir, constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electron from 'electron';
import pkg from '../package.json' with { type: 'json' };
import { buildMain } from './build-main.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173', NODE_TLS_REJECT_UNAUTHORIZED: '1' };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--isolated')) {
  env.WENXU_DATA_DIR = path.join(root, '.test-output', 'development-profile');
  console.log('开发配置目录：' + env.WENXU_DATA_DIR);
}

async function start() {
  using runtime = mkdtempDisposableSync(path.join(tmpdir(), 'xingyue-dev-'));
  let server, child, stopSignal;
  // Vite can call process.exit() on SIGTERM or stdin close before finally runs.
  function onExit() {
    if (child?.exitCode === null && child.signalCode === null) child.kill();
    runtime.remove();
  }
  process.once('exit', onExit);
  function stop(signal) {
    stopSignal = signal;
    child?.kill();
    process.exitCode = 128 + constants.signals[signal];
  }
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, stop);
  try {
    // The authenticated management page uses the same Vite HMR socket as the desktop.
    server = await createServer({ root, server: { ws: { host: '127.0.0.1', clientPort: 5173 } } });
    await server.listen();
    if (stopSignal) return;
    await buildMain(runtime.path);
    if (stopSignal) return;
    writeFileSync(path.join(runtime.path, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, main: 'main.cjs' }));
    child = spawn(electron, [runtime.path], { cwd: root, stdio: 'inherit', env });
    const [code, signal] = await once(child, 'close');
    if (!stopSignal) process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
  } finally {
    try { await server?.close(); }
    finally {
      process.off('exit', onExit);
      for (const signal of signals) process.off(signal, stop);
    }
  }
}
await start();
