import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
if (process.platform !== 'darwin') {
  console.error('Mac 打包必须在 macOS 上执行。Windows 请使用 npm run pack / npm run dist。');
  process.exit(1);
}
if (!['arm64', 'x64'].includes(process.arch) || !['dir', 'dist'].includes(target) || process.argv.length !== 3) {
  console.error('用法：npm run pack:mac 或 npm run dist:mac；支持原生 arm64 / x64 Node.js。');
  process.exit(1);
}
const translated = spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
if (translated.stdout?.trim() === '1') {
  console.error('当前 Node.js 正通过 Rosetta 运行。请安装原生 ARM64 Node.js，再重新执行 npm ci。');
  process.exit(1);
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1' } });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [fileURLToPath(new URL('./doctor.mjs', import.meta.url))]);
run('npm', ['run', 'build']);
run(process.execPath, [require.resolve('electron-builder/cli.js'), '--mac', ...(target === 'dir' ? ['dir'] : ['dmg', 'zip']), `--${process.arch}`, '--publish', 'never']);
