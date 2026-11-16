import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let failed = false;
function check(label, ok, detail) {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}: ${detail}`);
  if (!ok) failed = true;
}
const [major, minor, patch] = process.versions.node.split('.').map(Number);
check('Node.js', major === 24 && (minor > 11 || minor === 11 && patch >= 1), process.versions.node + '（需要 24.11.1 或更高的 24.x）');
check('操作系统', ['win32', 'darwin'].includes(process.platform), `${process.platform} / ${process.arch}`);
if (process.platform === 'darwin') {
  const translated = spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
  check('原生架构', translated.stdout?.trim() !== '1', 'Apple 芯片应使用 arm64，Intel 应使用 x64');
  const version = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' });
  const [osMajor, osMinor] = (version.stdout?.trim() || '').split('.').map(Number);
  check('macOS', version.status === 0 && (osMajor > 13 || osMajor === 13 && osMinor >= 5), (version.stdout?.trim() || '无法读取版本') + '（需要 13.5 或更新版本）');
}
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try { check('SQLite', db.prepare('select 1 as ready').get().ready === 1, '内存数据库可用'); }
  finally { db.close(); }
} catch (error) { check('SQLite', false, error.message); }
try {
  const electron = require('electron');
  if (!fs.existsSync(electron)) throw new Error('Electron 未下载完成，请重新执行 npm ci');
  const result = spawnSync(electron, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron})'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_TLS_REJECT_UNAUTHORIZED: '1' }
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || 'Electron 无法启动，请确认依赖在本机安装');
  const runtime = JSON.parse(result.stdout.trim());
  check('Electron', runtime.platform === process.platform && runtime.arch === process.arch,
    `${runtime.electron} / ${runtime.platform} / ${runtime.arch}（应与 Node.js 一致）`);
} catch (error) { check('Electron', false, error.message); }
console.log('此检查不读取作品或模型配置，不调用模型。图形界面与钥匙串仍需在目标 Mac 验收。');
process.exitCode = failed ? 1 : 0;
