import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import path from 'node:path';

export async function withTestWorkspace(args, { electron = false, cwd = process.cwd() } = {}) {
  const output = path.resolve(cwd, '.test-output');
  mkdirSync(output, { recursive: true });
  const workspace = mkdtempSync(path.join(output, 'run-'));
  const handlers = new Map();
  const group = process.platform !== 'win32';

  try {
    const executable = electron ? createRequire(import.meta.url)('electron') : process.execPath;
    const env = { ...process.env, TMPDIR: workspace, TMP: workspace, TEMP: workspace, XINGYUE_TEST_OUTPUT: workspace };
    if (electron) delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, args, { cwd, stdio: 'inherit', detached: group, env });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const forward = () => {
        if (!child.pid) return;
        try {
          process.kill(group ? -child.pid : child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      };
      handlers.set(signal, forward);
      process.on(signal, forward);
    }
    const [code, signal] = await once(child, 'close');
    return code ?? 128 + constants.signals[signal];
  } finally {
    try {
      rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } finally {
      for (const [signal, forward] of handlers) process.off(signal, forward);
    }
  }
}

if (import.meta.main) {
  const electron = process.argv[2] === '--electron';
  process.exitCode = await withTestWorkspace(process.argv.slice(electron ? 3 : 2), { electron });
}
