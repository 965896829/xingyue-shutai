import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.includes('--isolated')) {
  process.env.WENXU_DATA_DIR = path.join(root, '.test-output', 'development-profile');
  console.log(`开发配置目录：${process.env.WENXU_DATA_DIR}`);
}
await import('./build-main.mjs');
// The authenticated management host proxies HTML/modules. HMR stays on Vite's
// loopback socket instead of incorrectly trying the management HTTP port.
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true, ws: { host: '127.0.0.1', clientPort: 5173 } } });
await server.listen();
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
  NODE_TLS_REJECT_UNAUTHORIZED: '1'
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true });
child.on('error', async (error) => {
  console.error(`Electron 启动失败：${error.message}。请运行 npm run doctor。`);
  await server.close();
  process.exit(1);
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => child.kill());
