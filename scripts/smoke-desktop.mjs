import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { desktopArtifacts } from './desktop-artifacts.mjs';

const options = process.argv.slice(2);
const audit = options.includes('--audit');
const zen = audit || options.includes('--zen') ? await import('./smoke-zen.mjs') : undefined;
const binary = options.find(option => !option.startsWith('--'));
const fromSource = options.includes('--source');
if (fromSource && binary) throw Error('开发版验收使用 --source，安装包验收使用可执行文件路径');
const executable = binary ? path.resolve(binary) : fromSource ? createRequire(import.meta.url)('electron') : desktopArtifacts().executable;
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
const stop = new AbortController();
const cancel = () => stop.abort();
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
for (const signal of signals) process.on(signal, cancel);
let child, socket, closed;
try {
  if (zen) await zen.seedBook(isolated, audit);
  stop.signal.throwIfAborted();
  const started = performance.now();
  const env = { ...process.env, WENXU_DATA_DIR: isolated };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [...(fromSource ? ['.'] : []), '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'],
    { env, stdio: ['ignore', 'ignore', 'inherit'] });
  closed = new Promise(resolve => child.once('close', resolve));
  child.once('error', error => stop.abort(error));
  let page;
  const deadline = Date.now() + 60000;
  while (!page && Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    stop.signal.throwIfAborted();
    try {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(1000) })).json();
      page = targets.find(target => target.type === 'page' && target.url.startsWith('file:') && target.url.includes('index.html'));
    } catch { /* The renderer starts after the native process. */ }
    if (!page) await delay(75);
  }
  if (!page) throw Error('打包窗口未加载，退出码 ' + String(child.exitCode));
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open', { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(5000)]) });
  async function send(method, params) {
    stop.signal.throwIfAborted();
    const response = once(socket, 'message', { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(30000)]) });
    socket.send(JSON.stringify({ id: 1, method, params }));
    const [bytes] = await response;
    const reply = JSON.parse(bytes.toString());
    if (reply.error || reply.result?.exceptionDetails) throw Error(reply.error?.message || reply.result.exceptionDetails.exception?.description || '客户端验收失败');
    return reply.result;
  }
  async function evaluate(expression) {
    return (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
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
  const opening = await evaluate(`(async () => {
    document.querySelector('button[aria-label="新建作品"]').click();
    const deadline = Date.now() + 10000;
    let dialog;
    while (!(dialog = document.querySelector('[role="dialog"][aria-label="新建作品"]')) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 25));
    if (!dialog) throw Error('新建作品窗口未渲染');
    const choice = [...dialog.querySelectorAll('select')].find(select => select.querySelector('option[value="scene"]'));
    const advanced = [...dialog.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === '更多创作设置');
    if (choice?.value !== 'scene' || !choice.querySelector('option[value="planning"]') || !choice.querySelector('option[value="existing"]'))
      throw Error('开书方式缺失或试写未默认选中');
    if (!advanced || advanced.open || !dialog.querySelector('textarea')) throw Error('轻量开书表单状态有误');
    dialog.querySelector('[aria-label="关闭"]').click();
    return choice.selectedOptions[0].textContent;
  })()`);
  if (zen) await zen.verify(evaluate, send, audit ? isolated : undefined);
  const labMs = await evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '自由创作实验室');
    if (!button) throw Error('实验室入口缺失');
    const start = performance.now(); button.click();
    while (!document.querySelector('.story-lab:not([hidden]) h1') && performance.now() - start < 15000)
      await new Promise(resolve => setTimeout(resolve, 25));
    if (!document.querySelector('.story-lab:not([hidden]) h1')) throw Error('实验室未渲染');
    return Math.round(performance.now() - start);
  })()`);
  if (audit) {
    await zen.verifyLabTransfer(evaluate);
    const initial = await evaluate("window.wenxu.invoke('app.snapshot', {})");
    const root = initial.result.project.root;
    if (!path.resolve(root).startsWith(path.join(isolated, 'books') + path.sep)) throw Error('临时作品路径校验失败');
    const owner = JSON.parse(await readFile(path.join(root, '.novelclient', 'write-lock.json'), 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 1 ||
      Number(execFileSync('/bin/ps', ['-p', String(owner.pid), '-o', 'ppid='], { encoding: 'utf8' }).trim()) !== child.pid)
      throw Error('无法确认测试内核所属进程');
    process.kill(owner.pid, 'SIGKILL');
    const deadline = Date.now() + 20000;
    let restored = false;
    while (Date.now() < deadline) {
      const snapshot = await evaluate("window.wenxu.invoke('app.snapshot', {})");
      if (snapshot.ok && snapshot.result.workerGeneration > initial.result.workerGeneration) {
        if (snapshot.result.project?.id !== initial.result.project.id) throw Error('内核重连后未恢复原作品');
        const drafts = await evaluate("window.wenxu.invoke('draft.list', {})");
        if (!drafts.ok || drafts.result.length !== 1) throw Error('重开后转入的草稿不可用');
        restored = true;
        break;
      }
      await delay(40);
    }
    if (!restored) throw Error('内核重连验收超时');
  }
  console.log(JSON.stringify({ target: fromSource ? 'source' : 'package', ...(audit ? { labTransferVerified: true, reconnectVerified: true, fullReviewExportVerified: true } : {}), platform: process.platform, arch, title: ready, readyMs, opening, labMs,
    ...(zen ? { zenVerified: true, sidebarFilesVerified: true } : {}) }));
} finally {
  socket?.terminate();
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  try {
    if (closed) {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await closed; } finally { clearTimeout(timeout); }
    }
  } finally {
    await rm(isolated, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    for (const signal of signals) process.off(signal, cancel);
  }
}
