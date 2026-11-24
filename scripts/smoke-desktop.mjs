import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { desktopArtifacts } from './desktop-artifacts.mjs';

const executable = process.argv[2] ? path.resolve(process.argv[2]) : desktopArtifacts().executable;
const arch = process.platform === 'darwin'
  ? execFileSync('/usr/bin/lipo', ['-archs', executable], { encoding: 'utf8' }).trim().replace('x86_64', 'x64')
  : execFileSync(executable, ['-p', 'process.arch'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000
    }).trim();
const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const isolated = await mkdtemp(path.join(tmpdir(), 'xingyue-desktop-launch-'));
const started = performance.now();
const child = spawn(executable, ['--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'],
  { env: { ...process.env, WENXU_DATA_DIR: isolated }, stdio: ['ignore', 'ignore', 'inherit'] });
const closed = once(child, 'exit');
let socket;
try {
  let page;
  const deadline = Date.now() + 60000;
  while (!page && Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1000) })).json();
      page = targets.find(target => target.type === 'page' && target.url.startsWith('file:') && target.url.includes('index.html'));
    } catch { /* The renderer starts after the native process. */ }
    if (!page) await delay(75);
  }
  if (!page) throw Error('打包窗口未加载，退出码 ' + String(child.exitCode));
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  async function evaluate(expression) {
    const response = once(socket, 'message', { signal: AbortSignal.timeout(30000) });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    const [bytes] = await response;
    const reply = JSON.parse(bytes.toString());
    if (reply.error || reply.result?.exceptionDetails) throw Error(reply.error?.message || reply.result.exceptionDetails.exception?.description || '客户端验收失败');
    return reply.result.result.value;
  }
  const ready = await evaluate(`(async () => {
    const deadline = Date.now() + 20000;
    while (!document.querySelector('button[aria-label="新建作品"]') && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 25));
    if (!document.querySelector('button[aria-label="新建作品"]')) throw Error('工作台未渲染');
    const snapshot = await window.wenxu.invoke('app.snapshot', {});
    if (!snapshot.ok || snapshot.result.project !== null) throw Error('隔离作品状态未就绪');
    return document.title;
  })()`);
  if (!ready.includes('星月书台')) throw Error('应用名称不一致');
  const readyMs = Math.round(performance.now() - started);
  const labMs = await evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '自由创作实验室');
    if (!button) throw Error('实验室入口缺失');
    const start = performance.now(); button.click();
    while (!document.querySelector('.story-lab:not([hidden]) h1') && performance.now() - start < 15000)
      await new Promise(resolve => setTimeout(resolve, 25));
    if (!document.querySelector('.story-lab:not([hidden]) h1')) throw Error('实验室未渲染');
    return Math.round(performance.now() - start);
  })()`);
  console.log(JSON.stringify({ platform: process.platform, arch, title: ready, readyMs, labMs }));
} finally {
  socket?.terminate();
  if (child.exitCode === null) child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await closed; } finally {
    clearTimeout(timeout);
    await rm(isolated, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
}
