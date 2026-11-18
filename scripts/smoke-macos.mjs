import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'darwin') throw Error('此检查需要 macOS 原生开发包');
const build = path.join('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac');
const [bundle] = (await readdir(build)).filter(name => name.endsWith('.app'));
if (!bundle) throw Error('缺少打包的 macOS 应用');
const folder = path.resolve(build, bundle, 'Contents', 'MacOS');
const name = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.resolve(folder, '..', 'Info.plist')], { encoding: 'utf8' }).trim();
const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const isolated = await mkdtemp(path.join(tmpdir(), 'xingyue-mac-launch-'));
const child = spawn(path.join(folder, name), ['--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'],
  { env: { ...process.env, WENXU_DATA_DIR: isolated }, stdio: ['ignore', 'ignore', 'inherit'] });
const closed = once(child, 'exit');
try {
  let ready = false;
  for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt++) {
    try {
      const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1000) })).json();
      ready = pages.some(page => page.type === 'page' && page.url.startsWith('file:') && page.url.includes('index.html') && page.title.includes('星月书台'));
      if (ready) break;
    } catch { /* The window and its renderer can start after the native process. */ }
    await delay(500);
  }
  if (!ready) throw Error('打包应用未加载写作工作台，退出码 ' + String(child.exitCode));
  console.log('已启动 ' + bundle + '，已验证本地页面标题；架构 ' + process.arch);
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await closed; } finally { clearTimeout(timeout); }
}
