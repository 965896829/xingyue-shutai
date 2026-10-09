import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
await import('./build-main.mjs');
const server = await createServer();
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
