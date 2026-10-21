import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  commandContracts,
  isCommand,
  parseInput,
  type BridgeResponse,
  type Command
} from '../../shared/contracts';
import { rendererContextSchema } from '../../shared/ipc';
import { errorPayload, ApplicationError } from '../../shared/errors';
import type { AppEvent } from '../../shared/types';
import type { ManagementStatus } from '../../shared/management';
import { ManagementAudit } from './audit';
import { listLocalFiles, validateLocalSelection, makeLocalDirectory } from './files';

export type RendererContext = z.infer<typeof rendererContextSchema>;
export type ManagementResponse = BridgeResponse & { projectSessionId?: string; workerGeneration?: number };
export interface ManagementCaller {
  source: 'desktop' | 'browser';
  fileGrants?: Set<string>;
}
/** A target adapter, deliberately separate from HTTP and the local implementation. */
export interface ManagedClient {
  id: string;
  name: string;
  version: string;
  state(): { workerState: string; workerGeneration: number };
  invoke(
    command: Command,
    args: unknown,
    context: RendererContext,
    caller: ManagementCaller
  ): Promise<ManagementResponse>;
  cancelWait(waitId: string): void;
}
interface Session {
  id: string;
  csrf: string;
  expiresAt: number;
  grants: Set<string>;
  waits: Set<string>;
  streams: Set<ServerResponse>;
  requests: number;
}
const token = () => randomBytes(32).toString('base64url');
const digest = (text: string) => createHash('sha256').update(text).digest();
const same = (left: string, right: string) => timingSafeEqual(digest(left), digest(right));
const json = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

export class LocalManagementServer {
  private server?: http.Server;
  private sessions = new Map<string, Session>();
  private pair?: { hash: Buffer; expiresAt: number };
  private timer?: ReturnType<typeof setInterval>;
  private startedAt: string | null = null;
  private origin: string | null = null;
  private opening?: Promise<void>;
  private failures = { at: 0, count: 0 };
  private get cookieName() {
    return `wenxu_admin_${this.options.client.id.replaceAll('-', '')}`;
  }
  constructor(
    private options: {
      client: ManagedClient;
      audit: ManagementAudit;
      staticRoot: string;
      devOrigin?: string;
      port?: number;
      sessionMs?: number;
    }
  ) {}
  status(): ManagementStatus {
    return {
      clientId: this.options.client.id,
      name: this.options.client.name,
      version: this.options.client.version,
      running: !!this.origin,
      url: this.origin,
      startedAt: this.startedAt,
      sessions: this.sessions.size,
      ...this.options.client.state(),
      protocolVersion: 1,
      transport: 'local-http'
    };
  }
  async start() {
    if (this.opening) return this.opening;
    if (this.server?.listening) return;
    this.opening = this.listen();
    try {
      await this.opening;
    } finally {
      this.opening = undefined;
    }
  }
  private async listen() {
    const server = http.createServer(
      (req, res) =>
        void this.route(req, res).catch((error) => {
          if (res.headersSent) {
            res.destroy();
            return;
          }
          const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
          json(res, { error: status === 500 ? '管理操作失败，请刷新后重试' : error.message }, status);
        })
    );
    server.headersTimeout = 10_000;
    server.requestTimeout = 0; // RPCs retain the command's own bounded wait deadline.
    server.maxHeadersCount = 64;
    const listen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => {
          server.off('listening', ready);
          reject(error);
        };
        const ready = () => {
          server.off('error', failed);
          resolve();
        };
        server.once('error', failed).once('listening', ready).listen(port, '127.0.0.1');
      });
    try {
      await listen(this.options.port ?? 39741);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || this.options.port === 0) throw error;
      await listen(0);
    }
    server.on('error', () =>
      this.options.audit.append({
        source: 'system',
        command: 'management.server',
        status: 'error',
        durationMs: 0,
        errorCode: 'LISTENER_ERROR'
      })
    );
    this.server = server;
    this.origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    this.startedAt = new Date().toISOString();
    this.timer = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (session.expiresAt <= Date.now()) {
          this.drop(session);
          continue;
        }
        for (const res of session.streams) res.write(': heartbeat\n\n');
      }
    }, 15_000);
    this.timer.unref();
  }
  async pairingUrl() {
    await this.start();
    const value = token();
    this.pair = { hash: digest(value), expiresAt: Date.now() + 120_000 };
    // Fragments never enter HTTP access logs or the Referer header.
    return `${this.origin}/#pair=${value}`;
  }
  private drop(session: Session) {
    this.sessions.delete(session.id);
    for (const waitId of session.waits) this.options.client.cancelWait(waitId);
    for (const res of session.streams) {
      res.write('event: expired\ndata: {}\n\n');
      res.end();
    }
    session.streams.clear();
    session.grants.clear();
  }
  revoke() {
    this.pair = undefined;
    for (const session of this.sessions.values()) this.drop(session);
  }
  async stop() {
    this.revoke();
    clearInterval(this.timer);
    const server = this.server;
    this.server = undefined;
    this.origin = null;
    this.startedAt = null;
    if (server) {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }
  }
  emit(event: AppEvent) {
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= Date.now()) {
        this.drop(session);
        continue;
      }
      for (const res of session.streams) {
        // A slow browser reconnects and reloads persisted state rather than growing RAM indefinitely.
        if (res.writableLength > 1_000_000) {
          res.destroy();
          session.streams.delete(res);
        } else res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
  }
  private session(req: IncomingMessage): Session {
    const value = (req.headers.cookie ?? '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${this.cookieName}=`))
      ?.slice(this.cookieName.length + 1);
    const session = value && this.sessions.get(value);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.drop(session);
      throw new HttpError(401, '网页授权已失效，请从客户端重新打开管理后台');
    }
    return session;
  }
  private async body(req: IncomingMessage) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json')
      throw new HttpError(415, '需要 JSON 请求');
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => req.destroy(), 15_000);
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 24 * 1024 * 1024) throw new HttpError(413, '请求内容过大');
        chunks.push(Buffer.from(chunk));
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new HttpError(400, 'JSON 格式错误');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  private async route(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (
      !this.origin ||
      req.headers.host !== new URL(this.origin).host ||
      req.socket.remoteAddress !== '127.0.0.1'
    )
      throw new HttpError(403, '仅允许本机访问');
    if (
      (req.headers.origin && req.headers.origin !== this.origin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new HttpError(403, '不允许跨站访问');
    const url = new URL(req.url ?? '/', this.origin);
    if (url.origin !== this.origin) throw new HttpError(403, '不允许代理请求');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '不支持的请求');
      return this.staticFile(url.pathname, res, req.method === 'HEAD', url.search);
    }
    const write = req.method === 'POST';
    if (req.method !== 'GET' && !write) throw new HttpError(405, '不支持的请求');
    if (write && req.headers.origin !== this.origin) throw new HttpError(403, '缺少同源验证');
    if (url.pathname === '/api/session' && write) {
      if (Date.now() - this.failures.at > 60_000) this.failures = { at: Date.now(), count: 0 };
      if (this.failures.count >= 20) throw new HttpError(429, '尝试过于频繁，请稍后从客户端重新打开');
      const input = z.strictObject({ token: z.string().min(20).max(100) }).parse(await this.body(req));
      if (
        !this.pair ||
        this.pair.expiresAt <= Date.now() ||
        !timingSafeEqual(this.pair.hash, digest(input.token))
      ) {
        this.failures.count++;
        throw new HttpError(401, '打开链接已失效，请从客户端重新打开管理后台');
      }
      this.pair = undefined;
      for (const session of this.sessions.values()) if (session.expiresAt <= Date.now()) this.drop(session);
      let existing: Session | undefined;
      try {
        existing = this.session(req);
      } catch {
        /* First authorization in this browser. */
      }
      if (!existing && this.sessions.size >= 8) this.drop(this.sessions.values().next().value!);
      const session: Session = existing ?? {
        id: token(),
        csrf: token(),
        expiresAt: Date.now() + (this.options.sessionMs ?? 8 * 3600_000),
        grants: new Set(),
        waits: new Set(),
        streams: new Set(),
        requests: 0
      };
      session.expiresAt = Date.now() + (this.options.sessionMs ?? 8 * 3600_000);
      this.sessions.set(session.id, session);
      res.setHeader(
        'Set-Cookie',
        `${this.cookieName}=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
      );
      this.options.audit.append({
        source: 'browser',
        command: 'management.connect',
        status: 'ok',
        durationMs: 0
      });
      return json(res, { csrf: session.csrf, client: this.status() });
    }
    const session = this.session(req);
    if (
      write &&
      (typeof req.headers['x-wenxu-csrf'] !== 'string' || !same(req.headers['x-wenxu-csrf'], session.csrf))
    )
      throw new HttpError(403, '会话验证失败，请刷新页面');
    if (url.pathname === '/api/session' && !write)
      return json(res, { csrf: session.csrf, client: this.status() });
    if (url.pathname === '/api/logout' && write) {
      this.drop(session);
      res.setHeader('Set-Cookie', `${this.cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return json(res, { ok: true });
    }
    if (url.pathname === '/api/clients' && !write) return json(res, { clients: [this.status()] });
    const prefix = `/api/clients/${this.options.client.id}/`;
    if (!url.pathname.startsWith(prefix)) throw new HttpError(404, '未找到客户端');
    const route = url.pathname.slice(prefix.length);
    if (route === 'status' && !write) return json(res, this.status());
    if (route === 'logs' && !write) {
      const input = z
        .object({
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          status: z.enum(['ok', 'error']).optional(),
          query: z.string().max(100).optional()
        })
        .parse(Object.fromEntries(url.searchParams));
      return json(res, this.options.audit.page(input));
    }
    if (route === 'events' && !write) {
      if (session.streams.size >= 16) throw new HttpError(429, '打开的网页过多');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      session.streams.add(res);
      res.write(
        `data: ${JSON.stringify({ type: 'snapshot', workerGeneration: this.options.client.state().workerGeneration })}\n\n`
      );
      res.on('close', () => session.streams.delete(res));
      return;
    }
    if (route === 'cancel-wait' && write) {
      const { waitId } = z.strictObject({ waitId: z.string().uuid() }).parse(await this.body(req));
      if (session.waits.has(waitId)) this.options.client.cancelWait(waitId);
      return json(res, { ok: true });
    }
    if (route === 'files' && !write) {
      const input = z
        .object({ path: z.string().max(4000).optional() })
        .parse(Object.fromEntries(url.searchParams));
      try {
        return json(res, await listLocalFiles(input.path));
      } catch {
        throw new HttpError(400, '无法打开此目录，请检查路径和访问权限');
      }
    }
    if (route === 'files/select' && write) {
      const selection = z
        .strictObject({ mode: z.enum(['directory', 'open', 'save']), path: z.string().min(1).max(4000) })
        .parse(await this.body(req));
      let selected: string;
      try {
        selected = await validateLocalSelection(selection);
      } catch {
        throw new HttpError(400, '无法选择此路径，请检查文件类型、名称和访问权限');
      }
      session.grants.add(selected);
      if (session.grants.size > 1000) session.grants.delete(session.grants.values().next().value!);
      const exists = await fs.access(selected).then(
        () => true,
        () => false
      );
      return json(res, { path: selected, exists });
    }
    if (route === 'files/mkdir' && write) {
      const input = z
        .strictObject({ parent: z.string().min(1).max(4000), name: z.string().min(1).max(200) })
        .parse(await this.body(req));
      try {
        const result = await makeLocalDirectory(input.parent, input.name);
        this.options.audit.append({
          source: 'browser',
          command: 'management.files.mkdir',
          status: 'ok',
          durationMs: 0
        });
        return json(res, { path: result });
      } catch {
        throw new HttpError(400, '无法创建文件夹，请检查名称、重名和访问权限');
      }
    }
    if (route === 'rpc' && write) {
      const input = z
        .strictObject({
          command: z.custom<Command>(isCommand),
          args: z.unknown(),
          context: rendererContextSchema
        })
        .parse(await this.body(req));
      if (
        [
          'management.open',
          'management.link',
          'management.stop',
          'app.chooseDirectory',
          'app.chooseFile'
        ].includes(input.command)
      )
        throw new HttpError(403, '请使用对应界面入口');
      if (
        commandContracts[input.command].scope === 'project' &&
        (!input.context.projectSessionId || input.context.workerGeneration === undefined)
      )
        return json(res, {
          ok: false,
          error: errorPayload(new ApplicationError('PROJECT_SESSION_STALE', '请先刷新当前作品', ['refresh']))
        });
      parseInput(input.command, input.args);
      if (session.requests >= 24) throw new HttpError(429, '同时操作过多，请等待当前请求');
      const waitId = input.context.waitId;
      if (waitId && session.waits.has(waitId)) throw new HttpError(409, '重复等待编号');
      session.requests++;
      if (waitId) session.waits.add(waitId);
      const disconnected = () => {
        if (!res.writableEnded && waitId) this.options.client.cancelWait(waitId);
      };
      res.on('close', disconnected);
      try {
        return json(
          res,
          await this.options.client.invoke(input.command, input.args, input.context, {
            source: 'browser',
            fileGrants: session.grants
          })
        );
      } finally {
        session.requests--;
        if (waitId) session.waits.delete(waitId);
        res.off('close', disconnected);
      }
    }
    throw new HttpError(404, '未找到管理接口');
  }
  private async staticFile(requestPath: string, res: ServerResponse, head: boolean, search = '') {
    let file: string;
    try {
      file = decodeURIComponent(requestPath === '/' ? '/admin.html' : requestPath);
    } catch {
      throw new HttpError(400, '路径无效');
    }
    if (
      file.startsWith('//') ||
      file.includes('\0') ||
      file.includes('\\') ||
      file.split('/').includes('..') ||
      file.endsWith('.map')
    )
      throw new HttpError(404, '未找到页面');
    let data: Buffer;
    let type: string;
    if (this.options.devOrigin) {
      const upstream = await fetch(new URL(file + search, this.options.devOrigin), {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error'
      });
      if (!upstream.ok) throw new HttpError(404, '开发页面尚未就绪');
      data = Buffer.from(await upstream.arrayBuffer());
      type = upstream.headers.get('content-type') ?? 'text/javascript; charset=utf-8';
    } else {
      const root = path.resolve(this.options.staticRoot),
        target = path.resolve(root, '.' + file);
      if (!target.startsWith(root + path.sep) || !mime[path.extname(file)])
        throw new HttpError(404, '未找到页面');
      try {
        data = await fs.readFile(target);
      } catch {
        throw new HttpError(404, '管理页面未安装，请重新构建客户端');
      }
      type = mime[path.extname(file)];
    }
    const nonce = type.includes('text/html')
      ? data.toString().match(/nonce="([a-zA-Z0-9+/=]+)"/)?.[1]
      : undefined;
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${this.options.devOrigin ? ' ws://127.0.0.1:5173' : ''}; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`
    );
    res.writeHead(200, { 'Content-Type': type });
    res.end(head ? undefined : data);
  }
}
