import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
await import('./build-main.mjs');
// The authenticated management host proxies HTML/modules. HMR stays on Vite's
// loopback socket instead of incorrectly trying the management HTTP port.
const server = await createServer({ server: { ws: { host: '127.0.0.1', clientPort: 5173 } } });
await server.listen();
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
  NODE_TLS_REJECT_UNAUTHORIZED: '1'
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill());
