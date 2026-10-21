import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ManagementAudit } from '../src/core/management/audit';
import {
  LocalManagementServer,
  type ManagedClient,
  type ManagementCaller,
  type RendererContext
} from '../src/core/management/server';
import { makeLocalDirectory, validateLocalSelection } from '../src/core/management/files';
import { commandContracts } from '../src/shared/contracts';

async function fixture(t: import('node:test').TestContext, options: { sessionMs?: number } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-management-test-'));
  fs.writeFileSync(path.join(root, 'admin.html'), '<!doctype html><h1>管理测试</h1>');
  const audit = new ManagementAudit(path.join(root, 'audit.sqlite'));
  const invocations: { command: string; context: RendererContext; caller: ManagementCaller }[] = [];
  const cancelled: string[] = [];
  const client: ManagedClient = {
    id: randomUUID(),
    name: '测试客户端',
    version: 'test',
    state: () => ({ workerState: 'ready', workerGeneration: 1 }),
    invoke: async (command, args, context, caller) => {
      invocations.push({ command, context, caller });
      if (command === 'profiles.save')
        return { ok: true, result: (args as { profile: unknown }).profile, workerGeneration: 1 };
      if (command === 'run.cancel') return { ok: true, result: true, workerGeneration: 1 };
      if (command === 'app.snapshot')
        return {
          ok: true,
          result: {
            project: null,
            documents: [],
            runs: [],
            events: [],
            profiles: [],
            recent: [],
            facts: [],
            issues: []
          },
          workerGeneration: 1
        };
      throw new Error('意外调用');
    },
    cancelWait: (id) => cancelled.push(id)
  };
  const server = new LocalManagementServer({ client, audit, staticRoot: root, port: 0, ...options });
  await server.start();
  t.after(async () => {
    await server.stop();
    audit.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'wenxu-management-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const origin = server.status().url!;
  const api = `${origin}/api/clients/${client.id}/`;
  async function pair(cookie?: string) {
    const url = await server.pairingUrl();
    const pairToken = new URLSearchParams(new URL(url).hash.slice(1)).get('pair')!;
    const res = await fetch(origin + '/api/session', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ token: pairToken })
    });
    assert.equal(res.status, 200);
    const value = (await res.json()) as { csrf: string };
    const sessionCookie = res.headers.get('set-cookie')!.split(';')[0];
    return {
      cookie: sessionCookie,
      csrf: value.csrf,
      token: pairToken,
      setCookie: res.headers.get('set-cookie')!
    };
  }
  const post = (url: string, input: unknown, session: { cookie: string; csrf: string }) =>
    fetch(url, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: session.cookie,
        'X-Wenxu-Csrf': session.csrf,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });
  return { root, audit, client, server, origin, api, invocations, cancelled, pair, post };
}

test('管理连接必须配对，令牌一次有效，Cookie 不可被脚本读取；撤销立即生效', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.api + 'status')).status, 401);
  const s = await f.pair();
  assert.match(s.setCookie, /HttpOnly/);
  assert.match(s.setCookie, /SameSite=Strict/);
  assert.equal((await f.post(f.origin + '/api/session', { token: s.token }, s)).status, 401);
  assert.equal((await fetch(f.api + 'status', { headers: { Cookie: s.cookie } })).status, 200);
  const again = await f.pair(s.cookie);
  assert.equal(again.cookie, s.cookie);
  assert.equal(f.server.status().sessions, 1);
  f.server.revoke();
  assert.equal((await fetch(f.api + 'status', { headers: { Cookie: s.cookie } })).status, 401);
});
test('浏览器写操作验证 Origin、CSRF、JSON 和目标客户端，拒绝桌面专用入口', async (t) => {
  const f = await fixture(t),
    s = await f.pair();
  const input = { command: 'app.snapshot', args: {}, context: {} };
  const attackHeaders: Record<string, string>[] = [
    {
      Origin: 'https://evil.invalid',
      Cookie: s.cookie,
      'X-Wenxu-Csrf': s.csrf,
      'Content-Type': 'application/json'
    },
    { Origin: f.origin, Cookie: s.cookie, 'X-Wenxu-Csrf': 'wrong', 'Content-Type': 'application/json' },
    { Cookie: s.cookie, 'X-Wenxu-Csrf': s.csrf, 'Content-Type': 'application/json' }
  ];
  for (const headers of attackHeaders)
    assert.equal(
      (await fetch(f.api + 'rpc', { method: 'POST', headers, body: JSON.stringify(input) })).status,
      403
    );
  assert.equal(
    (
      await fetch(f.api + 'rpc', {
        method: 'POST',
        headers: { Origin: f.origin, Cookie: s.cookie, 'X-Wenxu-Csrf': s.csrf, 'Content-Type': 'text/plain' },
        body: '{}'
      })
    ).status,
    415
  );
  assert.equal(
    (await fetch(f.api + 'status', { headers: { Cookie: s.cookie, 'Sec-Fetch-Site': 'cross-site' } })).status,
    403
  );
  assert.equal((await f.post(f.origin + '/api/clients/other/rpc', input, s)).status, 404);
  for (const command of [
    'management.open',
    'management.link',
    'management.stop',
    'app.chooseFile',
    'app.chooseDirectory'
  ])
    assert.equal((await f.post(f.api + 'rpc', { ...input, command }, s)).status, 403);
  assert.equal(f.invocations.length, 0);
});
test('命令契约、作品绑定和原操作编号经过 HTTP 入口传给唯一宿主', async (t) => {
  const f = await fixture(t),
    s = await f.pair();
  const missing = (await (
    await f.post(f.api + 'rpc', { command: 'run.cancel', args: {}, context: {} }, s)
  ).json()) as any;
  assert.equal(missing.error.code, 'PROJECT_SESSION_STALE');
  const context = {
    operationId: randomUUID(),
    waitId: randomUUID(),
    workerGeneration: 1,
    projectSessionId: randomUUID()
  };
  const result = (await (
    await f.post(f.api + 'rpc', { command: 'run.cancel', args: {}, context }, s)
  ).json()) as any;
  assert.equal(result.result, true);
  assert.equal(f.invocations.length, 1);
  assert.deepEqual(f.invocations[0].context, context);
  assert.equal(f.invocations[0].caller.source, 'browser');
  assert.equal(
    (await f.post(f.api + 'rpc', { command: 'run.cancel', args: { unexpected: true }, context }, s)).status,
    400
  );
  assert.equal((await f.post(f.api + 'rpc', { command: 'not-a-command', args: {}, context }, s)).status, 400);
});
test('文件选择只授予当前会话，中文路径、创建目录、保存路径和覆盖检测可用', async (t) => {
  const f = await fixture(t),
    s = await f.pair(),
    other = await f.pair();
  const child = path.join(f.root, '验收 作品');
  fs.mkdirSync(child);
  fs.writeFileSync(path.join(child, '正文.md'), '测试正文');
  const list = (await (
    await fetch(f.api + 'files?path=' + encodeURIComponent(child), { headers: { Cookie: s.cookie } })
  ).json()) as any;
  assert.equal(list.entries[0].name, '正文.md');
  assert.equal((await f.post(f.api + 'files/select', { mode: 'directory', path: child }, s)).status, 200);
  const request = { command: 'app.snapshot', args: {}, context: {} };
  await f.post(f.api + 'rpc', request, s);
  await f.post(f.api + 'rpc', request, other);
  assert.equal(f.invocations[0].caller.fileGrants!.has(fs.realpathSync(child)), true);
  assert.equal(f.invocations[1].caller.fileGrants!.size, 0);
  const save = (await (
    await f.post(f.api + 'files/select', { mode: 'save', path: path.join(child, '正文.md') }, s)
  ).json()) as any;
  assert.equal(save.exists, true);
  await f.post(f.api + 'files/mkdir', { parent: child, name: '备份' }, s);
  assert.equal(fs.statSync(path.join(child, '备份')).isDirectory(), true);
  await assert.rejects(makeLocalDirectory(child, '../逃逸'));
  await assert.rejects(validateLocalSelection({ mode: 'open', path: child }));
  await assert.rejects(validateLocalSelection({ mode: 'save', path: '\\\\server\\share\\file.txt' }));
});
test('事件订阅首次刷新状态、实时广播、撤销会话后关闭，不回放模型调用', async (t) => {
  const f = await fixture(t),
    s = await f.pair();
  const controller = new AbortController();
  const response = await fetch(f.api + 'events', {
    headers: { Cookie: s.cookie },
    signal: controller.signal
  });
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /snapshot/);
  f.server.emit({ type: 'delta', runId: 'test-run', text: '实时输出' });
  assert.match(new TextDecoder().decode((await reader.read()).value), /实时输出/);
  f.server.revoke();
  assert.match(new TextDecoder().decode((await reader.read()).value), /expired/);
  assert.equal((await reader.read()).done, true);
  controller.abort();
  assert.equal(f.invocations.length, 0);
});
test('管理日志持久化、分页、状态筛选，写入接口不接收密钥正文', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 12; i++)
    f.audit.append({
      source: 'desktop',
      command: 'profiles.save',
      status: i % 2 ? 'ok' : 'error',
      durationMs: i,
      operationId: randomUUID(),
      ...({ apiKey: 'should-never-be-recorded', response: 'private-content' } as {})
    });
  const first = f.audit.page({ limit: 5, status: 'error' });
  assert.equal(first.items.length, 5);
  assert.ok(first.nextBefore);
  const last = f.audit.page({ before: first.nextBefore!, limit: 5, status: 'error' });
  assert.equal(last.items.length, 1);
  const reopened = new ManagementAudit(path.join(f.root, 'audit.sqlite'));
  assert.equal(reopened.page().items.length, 12);
  reopened.close();
  assert.equal(JSON.stringify(f.audit.page()).includes('should-never-be-recorded'), false);
  assert.equal(JSON.stringify(f.audit.page()).includes('private-content'), false);
  assert.equal(f.audit.page({ query: 'profiles.save' }).items.length, 12);
  assert.ok(commandContracts['app.chooseDirectory'].timeout > 30_000);
});
test('过期授权不能再读状态或提交命令，静态页面不暴露数据库与源码映射', async (t) => {
  const f = await fixture(t, { sessionMs: 15 }),
    s = await f.pair();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal((await fetch(f.api + 'status', { headers: { Cookie: s.cookie } })).status, 401);
  assert.equal((await fetch(f.origin + '/audit.sqlite')).status, 404);
  assert.equal((await fetch(f.origin + '/assets/main.js.map')).status, 404);
  assert.equal((await fetch(f.origin + '/%2e%2e%2faudit.sqlite')).status, 404);
  const page = await fetch(f.origin + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'self'/);
});
