import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  utilityProcess,
  shell,
  Menu,
  nativeTheme,
  clipboard,
  type UtilityProcess
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { storageFileName } from '../src/shared/file-names';
import { validateReasoning } from '../src/shared/reasoning';
import { updateReasoningPreference, checkReasoningRevision, sameModelExecution } from '../src/core/reasoning-preferences';
import {
  profileSchema,
  type Profile,
  type SecretProfile,
  type Command,
  type ModelLimits
} from '../src/shared/types';
import type { AppEvent } from '../src/shared/types';
import { ManagementAudit } from '../src/core/management/audit';
import { LocalManagementServer, type ManagementCaller, type ManagementResponse } from '../src/core/management/server';
import { atomicWrite, FileStore } from '../src/core/storage';
import { callExternal, recoverAttempts } from '../src/core/runtime/model-gateway';
import { commandContracts, isCommand, parseInput, parseOutput, type CommandOutput } from '../src/shared/contracts';
import { buildVersion, protocolVersion } from '../src/shared/build';
import { errorPayload, errorSchema, ApplicationError } from '../src/shared/errors';
import { rendererContextSchema } from '../src/shared/ipc';
import { PendingRequests } from './pending-requests';
import { WorkerSupervisor } from './supervisor';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readSettings } from '../src/core/settings-recovery';
import { endpoint } from '../src/core/provider';
import { fetchModelCatalog, resolveCatalogConnection, sameEndpoint } from '../src/core/model-catalog';
import { prepareProviderGroup } from '../src/core/provider-groups';
import { connectionId } from '../src/shared/provider-groups';
import { AssistantSettings } from '../src/core/assistant-settings';
import { embeddingSettingsSchema } from '../src/shared/studio';
import { roleIds, searchSettingsSchema } from '../src/shared/assistant';
import { brand, windowThemes } from '../src/shared/brand';
import { CloseConfirmation } from './close-confirmation';
import {
  appearanceSchema,
  WindowAppearanceTransition,
  userDataDirectory,
  type StoredAppearance
} from './window-appearance';
import {
  limitsCacheKey,
  migrateModelLimits,
  normalizeLimits,
  trustedModelLimits
} from '../src/core/model-limits';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

let win: BrowserWindow,
  worker: UtilityProcess,
  quitting = false;
let settings: {
  profiles: (Profile & { encryptedKey: string })[];
  recent: { title: string; root: string }[];
} = { profiles: [], recent: [] };
const pending = new PendingRequests();
const supervisor = new WorkerSupervisor();
const requestContext = new AsyncLocalStorage<z.infer<typeof rendererContextSchema> & { signal?: AbortSignal; fileGrants?: Set<string> }>();
const waiting = new Map<string, AbortController>();
let projectSessionId: string | undefined;
let openedProjectRoot: string | undefined;
let reconnect: Promise<unknown> = Promise.resolve();
let readyPromise: Promise<void>;
let resolveReady: () => void;
let rejectReady: (error: Error) => void;
let shutdownPromise: Promise<void> | undefined;
let resolveShutdown: (() => void) | undefined;
let shutdownComplete = false;
let settingsNotice = '';
function decryptKey(value: string) {
  if (!value) return '';
  try { return safeStorage.decryptString(Buffer.from(value, 'base64')); }
  catch { settingsNotice = '密钥解密失败，原加密配置保留；请在模型设置中重新填写 Key'; return ''; }
}
let stateFile = '';
let appearanceFile = '';
let assistantSettings: AssistantSettings;
let managementJournal: FileStore | undefined;
let managementAudit: ManagementAudit | undefined;
let webManagement: LocalManagementServer | undefined;
function emitAppEvent(event: AppEvent) {
  if (win && !win.isDestroyed()) win.webContents.send('wenxu:event', event);
  webManagement?.emit(event);
}
const managementController = new AbortController();
let appearance: StoredAppearance = windowThemes.dark;
let windowAppearance: WindowAppearanceTransition | undefined;
const closeConfirmation = new CloseConfirmation();
let rendererReady = false;
let rendererResponsive = true;
let fallbackCloseDialog = false;
function answerClose(requestId: string, action: 'cancel' | 'quit') {
  if (!closeConfirmation.respond(requestId, action)) return false;
  if (action === 'quit') {
    quitting = true;
    void stopWorker().finally(() => app.quit());
  }
  return true;
}
function requestClose() {
  const requestId = closeConfirmation.request();
  if (!requestId || !win || win.isDestroyed()) return;
  if (rendererReady && rendererResponsive && !win.webContents.isDestroyed()) {
    win.webContents.send('wenxu:close-requested', requestId);
    return;
  }
  // If the renderer cannot display a dialog, still allow an explicit, safe exit.
  if (fallbackCloseDialog) return;
  fallbackCloseDialog = true;
  void dialog
    .showMessageBox(win, {
      type: 'question',
      buttons: ['继续写作', '退出'],
      defaultId: 0,
      cancelId: 0,
      message: `退出${brand.name}？`,
      detail: '界面尚未就绪或暂时无响应。退出会中断正在运行的请求。'
    })
    .then((result) => answerClose(requestId, result.response === 1 ? 'quit' : 'cancel'))
    .catch(() => {
      answerClose(requestId, 'cancel');
    })
    .finally(() => {
      fallbackCloseDialog = false;
    });
}
const granted = new Set<string>();
const modelLimitsCache = new Map<string, ModelLimits>();
// productName is presentation, not a new profile. Keep Chromium's Local State and
// encrypted keys in the original profile even before app.whenReady() initializes them.
const userData = userDataDirectory(app.getPath('appData'), process.env.WENXU_DATA_DIR);
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.setName(brand.name);
app.setAppUserModelId(brand.appId);
if (!app.isPackaged && process.env.WENXU_DEBUG_PORT)
  app.commandLine.appendSwitch('remote-debugging-port', process.env.WENXU_DEBUG_PORT);
function saveSettings() {
  atomicWrite(stateFile, JSON.stringify(settings, null, 2));
}
function profiles(includeDisabled = false): SecretProfile[] {
  return settings.profiles
    .filter((p) => includeDisabled || p.enabled !== false)
    .map(({ encryptedKey, ...p }) => ({
      ...p,
      apiKey: decryptKey(encryptedKey)
    }));
}
function sync(type: 'initialize' | 'configuration' = 'configuration') {
  worker.postMessage({
    type, protocolVersion, buildVersion, workerGeneration: supervisor.generation,
    profiles: profiles(), recent: settings.recent,
    assistant: {
      roles: assistantSettings.roles(), search: assistantSettings.settings().search,
      embedding: assistantSettings.settings().embedding,
      embeddingKey: decryptKey(assistantSettings.embeddingSecret()),
      searchKey: decryptKey(assistantSettings.secret())
    }
  });
}
function startWorker() {
  const generation = supervisor.start();
  projectSessionId = undefined;
  readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void readyPromise.catch(() => {});
  const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [
    app.isPackaged ? path.join(process.resourcesPath, 'skill') : path.join(app.getAppPath(), 'resources/skill'),
    app.getPath('userData')
  ], { serviceName: `${brand.name}写作内核`, stdio: 'pipe', env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1' } });
  worker = child;
  const startup = setTimeout(() => {
    if (supervisor.state === 'starting' && supervisor.generation === generation) child.kill();
  }, 30_000);
  child.on('message', (raw: unknown) => {
    if (child !== worker) return;
    const parsed = z.object({ type: z.string().optional(), requestId: z.string().optional(), workerGeneration: z.number().optional(), projectSessionId: z.string().optional(), event: z.unknown().optional(), error: z.unknown().optional(), result: z.unknown().optional() }).passthrough().safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'ready') {
      try {
        supervisor.ready(z.object({ protocolVersion: z.number(), buildVersion: z.string(), workerGeneration: z.number() }).parse(raw));
        projectSessionId = message.projectSessionId;
        clearTimeout(startup);
        resolveReady();
        if (generation > 1) {
          reconnect = openedProjectRoot ? rpc('project.open', { root: openedProjectRoot }) : Promise.resolve();
          void reconnect.catch(() => {
            emitAppEvent({ type: 'error', text: '执行内核已重启，原作品恢复未完成，请重新打开并核对', workerGeneration: generation });
          }).finally(() => {
            emitAppEvent({ type: 'snapshot', workerGeneration: generation });
          });
        }
      } catch (error) { rejectReady(error as Error); child.kill(); }
      return;
    }
    if (message.type === 'shutdown-complete') { resolveShutdown?.(); return; }
    if (message.workerGeneration !== undefined && message.workerGeneration !== generation) return;
    if (message.event) {
      emitAppEvent(message.event as AppEvent);
      return;
    }
    if (!message.requestId) return;
    if (message.projectSessionId) projectSessionId = message.projectSessionId;
    if (message.error) {
      const error = errorSchema.parse(message.error);
      pending.reject(message.requestId, new ApplicationError(error.code, error.message, error.actions, error.details));
    } else pending.resolve(message.requestId, message.result);
  });
  child.on('exit', () => {
    clearTimeout(startup);
    if (child !== worker) return;
    const error = new ApplicationError('WORKER_UNAVAILABLE', '执行内核已退出，已发送操作的结果可能未知，请查询原操作', ['query_operation', 'refresh']);
    pending.clear(error);
    rejectReady(error);
    if (quitting) resolveShutdown?.();
    const delay = supervisor.exited(quitting);
    if (!quitting && win && !win.isDestroyed()) {
      emitAppEvent({ type: 'error', text: delay === null ? '执行内核连续启动失败，已停止自动重启。请安全退出后检查诊断。' : '执行内核正在恢复连接；不会自动重新调用模型。', workerGeneration: generation });
      if (delay !== null) setTimeout(() => { if (!quitting) startWorker(); }, delay);
    }
  });
  try { sync('initialize'); } catch (error) { rejectReady(error as Error); child.kill(); }
}
async function rpc<C extends Command>(command: C, args: Record<string, unknown>): Promise<CommandOutput<C>> {
  await readyPromise;
  if (supervisor.state !== 'ready') throw new ApplicationError('WORKER_UNAVAILABLE', '执行内核尚未就绪');
  const context = requestContext.getStore();
  const requestId = randomUUID();
  if (context?.signal?.aborted) throw new ApplicationError('CANCEL_REQUESTED', '已取消等待响应');
  const result = pending.create(requestId, Math.min(context?.timeoutMs ?? commandContracts[command].timeout, commandContracts[command].timeout), context?.signal);
  try {
    worker.postMessage({ protocolVersion, requestId, operationId: context?.operationId,
      workerGeneration: supervisor.generation, projectSessionId: context?.projectSessionId ?? projectSessionId,
      command, params: parseInput(command, args) });
  } catch (error) { pending.reject(requestId, error as Error); }
  return parseOutput(command, await result);
}
function stopWorker() {
  managementController.abort();
  void webManagement?.stop();
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; clearTimeout(deadline); shutdownComplete = true; resolve(); };
    const deadline = setTimeout(() => { if (worker?.pid) worker.kill(); finish(); }, 15_000);
    resolveShutdown = finish;
    if (!worker?.pid || ['exited', 'stopped', 'degraded'].includes(supervisor.state)) { finish(); return; }
    supervisor.drain();
    pending.clear(new ApplicationError('CANCEL_REQUESTED', '客户端正在安全关闭，操作结果保留在原项目中', ['query_operation']));
    worker.postMessage({ type: 'shutdown' });
  });
  return shutdownPromise;
}

function selected(file: unknown) {
  const target = z.string().parse(file);
  if (!(requestContext.getStore()?.fileGrants ?? granted).has(path.resolve(target))) throw new Error('请通过文件选择界面选择此目录或文件');
  return target;
}
async function handle(command: Command, a: Record<string, unknown>) {
  if (command.startsWith('management.')) {
    if (!webManagement) throw new Error('网页管理服务未初始化');
    if (command === 'management.status') return webManagement.status();
    if (command === 'management.open') { await shell.openExternal(await webManagement.pairingUrl()); return true; }
    if (command === 'management.link') return webManagement.pairingUrl();
    if (command === 'management.revoke') { webManagement.revoke(); return true; }
    if (command === 'management.stop') { await webManagement.stop(); return true; }
  }
  if (command === 'app.openUrl') {
    const url = new URL(z.string().parse(a.url));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('仅支持打开普通网页链接');
    await shell.openExternal(url.href);
    return true;
  }
  if (command === 'assistant.settings') return assistantSettings.settings();
  if (command === 'embedding.settings.save') {
    const settings = embeddingSettingsSchema.parse(a.settings),
      key = typeof a.apiKey === 'string' ? a.apiKey.trim() : '';
    endpoint(settings, 'embeddings');
    if (
      !key &&
      a.clearKey !== true &&
      assistantSettings.embeddingSecret() &&
      !sameEndpoint(settings.baseUrl, assistantSettings.settings().embedding.baseUrl)
    )
      throw new Error('语义服务地址改变，请重新填写 Key');
    if (key && !safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密不可用');
    assistantSettings.saveEmbedding(
      settings,
      a.clearKey === true ? '' : key ? safeStorage.encryptString(key).toString('base64') : undefined
    );
    sync();
    return assistantSettings.settings();
  }
  if (command.startsWith('assistant.role.')) {
    const key = z.enum(roleIds).parse(a.id);
    if (command === 'assistant.role.save') assistantSettings.saveRole(key, z.string().parse(a.text));
    if (command === 'assistant.role.reset') assistantSettings.reset(key);
    if (command === 'assistant.role.rollback') assistantSettings.rollback(key, z.string().parse(a.version));
    sync();
    return assistantSettings.settings();
  }
  if (command === 'search.settings.save') {
    const search = searchSettingsSchema.parse(a.search),
      key = typeof a.apiKey === 'string' ? a.apiKey.trim() : '';
    endpoint(search, 'search');
    if (
      !key &&
      a.clearKey !== true &&
      assistantSettings.secret() &&
      !sameEndpoint(search.baseUrl, assistantSettings.settings().search.baseUrl)
    )
      throw new Error('搜索服务地址改变，请重新填写此服务的 Key');
    if (key && !safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密不可用，不能保存 Key');
    assistantSettings.saveSearch(
      search,
      a.clearKey === true ? '' : key ? safeStorage.encryptString(key).toString('base64') : undefined
    );
    sync();
    return assistantSettings.settings();
  }
  if (command === 'profiles.saveGroup') {
    const key = typeof a.apiKey === 'string' ? a.apiKey.trim() : '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，不能保存 API Key');
    const update = prepareProviderGroup(
      settings.profiles,
      a.connection,
      a.models,
      key ? safeStorage.encryptString(key).toString('base64') : undefined,
      (p) => trustedModelLimits(p, modelLimitsCache.get(limitsCacheKey(p, p.model))),
      a.expectedProfiles as Record<string, { version: number; enabled: boolean }> | undefined
    );
    const next = { ...settings, profiles: update.all };
    atomicWrite(stateFile, JSON.stringify(next, null, 2));
    settings = next;
    sync();
    return update.saved.map(({ encryptedKey, ...p }) => p);
  }
  if (command === 'profiles.deleteGroup') {
    const id = z.string().min(1).parse(a.id);
    const expected = a.expectedProfiles as Record<string, { version: number; enabled: boolean }> | undefined;
    const group = settings.profiles.filter(p => connectionId(p) === id);
    if (expected && (Object.keys(expected).length !== group.length || group.some(p => expected[p.id]?.version !== p.version || expected[p.id]?.enabled !== (p.enabled !== false))))
      throw new ApplicationError('VERSION_CONFLICT', '此供应商已在另一处修改，请刷新后再删除。', ['refresh']);
    const next = { ...settings, profiles: settings.profiles.filter((p) => connectionId(p) !== id) };
    atomicWrite(stateFile, JSON.stringify(next, null, 2));
    settings = next;
    sync();
    return true;
  }
  if (command === 'app.chooseDirectory') {
    const result = await dialog.showOpenDialog(win, {
      title: typeof a.title === 'string' ? a.title : '选择目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return null;
    granted.add(path.resolve(result.filePaths[0]));
    return result.filePaths[0];
  }
  if (command === 'app.chooseFile') {
    if (a.save === true) {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: storageFileName(typeof a.name === 'string' ? a.name : '作品.docx', '作品.docx'),
        filters: [{ name: '作品文档', extensions: ['md', 'txt', 'docx'] }]
      });
      if (result.canceled || !result.filePath) return null;
      granted.add(path.resolve(result.filePath));
      return result.filePath;
    }
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '作品文档', extensions: ['md', 'txt', 'docx'] }]
    });
    if (result.canceled) return null;
    granted.add(path.resolve(result.filePaths[0]));
    return result.filePaths[0];
  }
  if (command === 'profiles.reasoning') {
    const old = settings.profiles.find(p => p.id === a.id);
    if (!old) throw new Error('模型已移除，请重新选择');
    const input = parseInput('profiles.reasoning', a);
    const saved = updateReasoningPreference(old, input.effort, input.expectedVersion, input.expectedRevision);
    const next = { ...settings, profiles: settings.profiles.map(p => p.id === saved.id ? saved : p) };
    atomicWrite(stateFile, JSON.stringify(next, null, 2));
    settings = next;
    sync();
    const { encryptedKey, ...profile } = saved;
    return profile;
  }
  if (command === 'profiles.save') {
    let profile = profileSchema.parse(a.profile);
    const old = settings.profiles.find((v) => v.id === profile.id);
    if (old && profile.version !== old.version)
      throw new ApplicationError('VERSION_CONFLICT', '模型配置已在另一处修改，请载入最新版本后再保存。', ['refresh']);
    if (old) checkReasoningRevision(profile, old);
    validateReasoning(profile);
    profile.reasoningRevision = (old?.reasoningRevision ?? 0) + ((old?.reasoningEffort ?? null) !== (profile.reasoningEffort ?? null) ? 1 : 0);
    profile = normalizeLimits(
      profile,
      trustedModelLimits(
        { ...profile, modelLimits: old?.modelLimits ?? null },
        modelLimitsCache.get(limitsCacheKey(profile, profile.model))
      )
    );
    const key = typeof a.apiKey === 'string' ? a.apiKey.trim() : '';
    if (!key && old?.encryptedKey && !sameEndpoint(profile.baseUrl, old.baseUrl))
      throw new Error('API 根地址已改变，请重新填写用于此地址的 API Key');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，不能保存 API Key');
    for (const h of Object.keys(profile.headers))
      if (/authorization|api[-_]key|cookie|^host$/i.test(h))
        throw new Error('密钥请填写独立的 API Key 栏，不能存入自定义请求头');
    endpoint(profile, 'test');
    const executionChanged = !old || !!key || !sameModelExecution(profile, old);
    profile.version = old ? old.version + (executionChanged ? 1 : 0) : 1;
    profile.hasKey = !!(key || old?.encryptedKey);
    profile.capabilities = executionChanged ? {} : old!.capabilities;
    const saved = {
      ...profile,
      encryptedKey: key ? safeStorage.encryptString(key).toString('base64') : (old?.encryptedKey ?? '')
    };
    settings.profiles = [...settings.profiles.filter((v) => v.id !== profile.id), saved];
    saveSettings();
    sync();
    return profile;
  }
  if (command === 'profiles.delete') {
    if (a.expectedVersion !== undefined && settings.profiles.find(p => p.id === a.id)?.version !== a.expectedVersion)
      throw new ApplicationError('VERSION_CONFLICT', '模型配置已变化，请刷新后再删除');
    settings.profiles = settings.profiles.filter((p) => p.id !== a.id);
    saveSettings();
    sync();
    return true;
  }
  if (command === 'profiles.models') {
    const old = profiles(true).find((p) => p.id === a.id);
    if (!a.connection && !old) throw new Error('请先填写供应商连接');
    const draft = a.connection ? { ...z.record(z.string(), z.unknown()).parse(a.connection), id: a.id } : old;
    const connection = resolveCatalogConnection(draft, a.apiKey, old);
    if (!managementJournal) throw new Error('管理请求账本不可用');
    const catalog = await callExternal(managementJournal, { id: requestContext.getStore()?.operationId ?? randomUUID(), usage: { input: 0, output: 0, cost: 0, currency: 'USD' } }, 'management-model-catalog', {
      provider: connection.protocol, model: 'catalog', version: 1, identity: { baseUrl: connection.baseUrl, protocol: connection.protocol }, pricing: null, currency: 'USD'
    }, { operation: 'list-models' }, null, managementController.signal, () => fetchModelCatalog(connection, managementController.signal),
    () => ({ input: null, output: null, cost: null, currency: 'USD' }));
    for (const model of catalog.models)
      if (model.limits) modelLimitsCache.set(limitsCacheKey(connection, model.id), model.limits);
    return catalog;
  }
  if (command === 'profiles.test') {
    const p = settings.profiles.find((v) => v.id === a.id);
    try {
      const result = await rpc(command, a);
      if (p && settings.profiles.find((v) => v.id === p.id) === p) {
        p.capabilities[a.tools ? 'tools' : 'text'] = 'verified';
        saveSettings();
        sync();
      }
      return result;
    } catch (e) {
      if (p && settings.profiles.find((v) => v.id === p.id) === p) {
        p.capabilities[a.tools ? 'tools' : 'text'] = 'failed';
        saveSettings();
        sync();
      }
      throw e;
    }
  }
  if (command === 'project.create') selected(a.parent);
  if (command === 'project.importLegacy') {
    selected(a.source);
    if (a.preview !== true) selected(a.parent);
  }
  if (command === 'project.open' && !settings.recent.some((p) => p.root === a.root)) selected(a.root);
  if (command === 'project.importDocument') selected(a.file);
  if (command === 'project.restoreTrash' && a.parent) selected(a.parent);
  if (command === 'project.export') selected(a.target);
  if (command === 'project.backup' && a.directory) selected(a.directory);
  if (command === 'project.restoreBackup') {
    selected(a.source);
    selected(a.parent);
  }
  if (command === 'app.reveal') {
    const snap = await rpc('app.snapshot', {});
    if (snap.project) await shell.openPath(snap.project.root);
    return true;
  }
  const result = await rpc(command, a);
  if (['app.snapshot', 'project.open', 'project.close', 'project.create', 'project.trash', 'project.restoreTrash'].includes(command) || command === 'project.importLegacy' && a.preview !== true)
    openedProjectRoot = parseOutput('app.snapshot', result).project?.root;
  if (command === 'app.snapshot')
    return { ...parseOutput('app.snapshot', result), savedProfiles: settings.profiles.map(({ encryptedKey, ...p }) => p) };
  if (
    command === 'project.open' ||
    command === 'project.create' ||
    command === 'project.trash' ||
    command === 'project.restoreTrash' ||
    (command === 'run.accept' && (typeof a.title === 'string' || (result as { titleChanged?: boolean }).titleChanged === true)) ||
    (command === 'titles.select' && !(result as { parentRunId?: string }).parentRunId) ||
    (command === 'project.importLegacy' && a.preview !== true)
  ) {
    const recentSnapshot = command === 'run.accept' || command === 'titles.select' ? await rpc('app.snapshot', {}) : result;
    const next = { ...settings, recent: parseOutput('app.snapshot', recentSnapshot).recent };
    try {
      atomicWrite(stateFile, JSON.stringify(next, null, 2));
      settings = next;
    } catch (e) {
      sync();
      throw e;
    }
  }
  return result;
}

/** Both renderers enter this boundary; the browser never opens another Service/SQLite writer. */
async function dispatch(command: Command, args: unknown, rawContext: unknown, caller: ManagementCaller): Promise<ManagementResponse> {
  let waitId: string | undefined;
  let registeredWait = false;
  let context: z.infer<typeof rendererContextSchema> | undefined;
  let failure: string | undefined;
  const started = Date.now();
  try {
    await reconnect.catch(() => {});
    context = rendererContextSchema.parse(rawContext);
    waitId = context.waitId;
    const controller = new AbortController();
    if (waitId) {
      if (waiting.has(waitId)) throw new ApplicationError('VALIDATION_ERROR', '重复等待编号');
      waiting.set(waitId, controller);
      registeredWait = true;
    }
    const contract = commandContracts[command];
    const bound = contract.scope === 'project' || caller.source === 'browser' && contract.access === 'lifecycle';
    if (bound && (caller.source === 'browser' || context.projectSessionId) && context.projectSessionId !== projectSessionId)
      throw new ApplicationError('PROJECT_SESSION_STALE', '作品会话已改变，请刷新后操作', ['refresh']);
    if (bound && context.workerGeneration !== undefined && context.workerGeneration !== supervisor.generation)
      throw new ApplicationError('PROJECT_SESSION_STALE', '执行内核已恢复，请刷新后操作', ['refresh']);
    const input = parseInput(command, args);
    const result = parseOutput(command, await requestContext.run({ ...context, signal: controller.signal, fileGrants: caller.fileGrants }, () => handle(command, input)));
    // Changing the active book is shared with every view, including an already-open desktop window.
    if (contract.scope === 'global' && contract.access !== 'read') emitAppEvent({ type: 'snapshot', workerGeneration: supervisor.generation });
    return { ok: true, result, projectSessionId, workerGeneration: supervisor.generation };
  } catch (error) {
    const payload = errorPayload(error, [
      ...settings.profiles.map(profile => decryptKey(profile.encryptedKey)),
      ...(assistantSettings ? [decryptKey(assistantSettings.secret()), decryptKey(assistantSettings.embeddingSecret())] : [])
    ]);
    failure = payload.code;
    return { ok: false, error: payload, projectSessionId, workerGeneration: supervisor.generation };
  } finally {
    if (registeredWait && waitId) waiting.delete(waitId);
    if (failure || commandContracts[command].access !== 'read') {
      try { managementAudit?.append({ source: caller.source, command, status: failure ? 'error' : 'ok', durationMs: Date.now() - started,
        operationId: context?.operationId && z.string().uuid().safeParse(context.operationId).success ? context.operationId : undefined,
        projectSessionId: context?.projectSessionId && z.string().uuid().safeParse(context.projectSessionId).success ? context.projectSessionId : undefined,
        errorCode: failure }); }
      catch { emitAppEvent({ type: 'error', text: '管理操作日志写入失败，请检查本机磁盘空间。原操作结果未改变。' }); }
    }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    const journalRoot = path.join(app.getPath('userData'), 'management-journal');
    fs.mkdirSync(journalRoot, { recursive: true });
    managementJournal = new FileStore(journalRoot);
    recoverAttempts(managementJournal);
    managementAudit = new ManagementAudit(path.join(app.getPath('userData'), 'management', 'audit.sqlite'));
    const clientIdFile = path.join(app.getPath('userData'), 'management', 'client-id');
    let clientId: string;
    try { clientId = z.string().uuid().parse(fs.readFileSync(clientIdFile, 'utf8').trim()); }
    catch { clientId = randomUUID(); atomicWrite(clientIdFile, clientId); }
    webManagement = new LocalManagementServer({
      client: { id: clientId, name: `${brand.name} · 本机`, version: buildVersion,
        state: () => ({ workerState: supervisor.state, workerGeneration: supervisor.generation }),
        invoke: dispatch, cancelWait: waitId => waiting.get(waitId)?.abort() },
      audit: managementAudit, staticRoot: path.join(__dirname, '../dist'),
      devOrigin: !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined
    });
    stateFile = path.join(app.getPath('userData'), 'settings.json');
    assistantSettings = new AssistantSettings(app.getPath('userData'));
    appearanceFile = path.join(app.getPath('userData'), 'appearance.json');
    let persistedAppearance: StoredAppearance | undefined;
    try {
      persistedAppearance = appearanceSchema.parse(JSON.parse(fs.readFileSync(appearanceFile, 'utf8')));
      // Old versions stored their old palette; keep the choice but start with the new colors.
      appearance = windowThemes[persistedAppearance.mode];
    } catch {
      // Missing or damaged appearance preferences must not prevent opening a book.
    }
    nativeTheme.themeSource = appearance.mode;
    const settingsSchema = z.object({ profiles: z.array(z.intersection(profileSchema, z.object({ encryptedKey: z.string() }))), recent: z.array(z.object({ title: z.string(), root: z.string() })) });
    const loadedSettings = readSettings(stateFile, settingsSchema, settings);
    settings = loadedSettings.value;
    if (loadedSettings.recovered) settingsNotice = '模型配置损坏，已保留原配置副本并使用空配置';
    const upgradedProfiles = migrateModelLimits(settings.profiles);
    if (JSON.stringify(upgradedProfiles) !== JSON.stringify(settings.profiles)) {
      const backup = stateFile + '.before-official-limits';
      if (fs.existsSync(stateFile) && !fs.existsSync(backup)) atomicWrite(backup, fs.readFileSync(stateFile));
      const next = { ...settings, profiles: upgradedProfiles };
      atomicWrite(stateFile, JSON.stringify(next, null, 2));
      settings = next;
    }
    win = new BrowserWindow({
      width: 1500,
      height: 980,
      minWidth: 1120,
      minHeight: 760,
      show: false,
      backgroundColor: appearance.background,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: appearance.background, symbolColor: appearance.foreground, height: 38 },
      autoHideMenuBar: false,
      title: brand.windowTitle,
      icon: app.isPackaged
        ? path.join(__dirname, '../dist/brand/app-icon.png')
        : path.join(app.getAppPath(), 'public/brand/app-icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      }
    });
    windowAppearance = new WindowAppearanceTransition(
      appearance,
      (colors) => {
        if (win.isDestroyed()) return;
        win.setBackgroundColor(colors.background);
        win.setTitleBarOverlay({ color: colors.background, symbolColor: colors.foreground, height: 38 });
      },
      (colors) => atomicWrite(appearanceFile, JSON.stringify(colors)),
      undefined,
      persistedAppearance,
      () => {
        if (!win.isDestroyed())
          emitAppEvent({
            type: 'error',
            text: '主题偏好保存失败；当前界面可以继续使用，退出时会重试保存。'
          });
      }
    );
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => {
      if (url !== win.webContents.getURL()) e.preventDefault();
    });
    win.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(false));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { id: 'app', label: brand.name, submenu: [
          { label: '打开网页管理后台', click: () => void dispatch('management.open', {}, {}, { source: 'desktop' }) },
          { label: '复制网页管理链接', click: () => void dispatch('management.link', {}, {}, { source: 'desktop' }).then(result => { if (result.ok) clipboard.writeText(String(result.result)); }) },
          { label: '断开所有网页连接', click: () => void dispatch('management.revoke', {}, {}, { source: 'desktop' }) },
          { label: '停止网页管理服务', click: () => void dispatch('management.stop', {}, {}, { source: 'desktop' }) },
          { type: 'separator' }, { label: '退出', click: requestClose }
        ] },
        {
          id: 'edit',
          label: '编辑',
          submenu: [
            { role: 'undo', label: '撤销' },
            { role: 'redo', label: '重做' },
            { type: 'separator' },
            { role: 'cut', label: '剪切' },
            { role: 'copy', label: '复制' },
            { role: 'paste', label: '粘贴' },
            { role: 'selectAll', label: '全选' }
          ]
        },
        {
          id: 'view',
          label: '视图',
          submenu: [
            { role: 'resetZoom', label: '实际大小' },
            { role: 'zoomIn', label: '放大' },
            { role: 'zoomOut', label: '缩小' },
            { role: 'togglefullscreen', label: '全屏' }
          ]
        }
      ])
    );
    // Keep native menu roles and accelerators, but render its top-level buttons in our theme.
    win.setMenuBarVisibility(false);
    win.once('ready-to-show', () => win.show());
    win.on('unresponsive', () => {
      rendererResponsive = false;
    });
    win.on('responsive', () => {
      rendererResponsive = true;
    });
    win.webContents.on('render-process-gone', () => {
      rendererReady = false;
    });
    win.webContents.on('did-start-loading', () => {
      rendererReady = false;
    });
    ipcMain.handle('wenxu:close-ready', (event) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('未授权的调用');
      rendererReady = true;
      return closeConfirmation.pending;
    });
    ipcMain.handle('wenxu:close-response', (event, input: unknown) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('未授权的调用');
      const value = z
        .object({ requestId: z.string().uuid(), action: z.enum(['cancel', 'quit']) })
        .parse(input);
      return answerClose(value.requestId, value.action);
    });
    ipcMain.handle('wenxu:appearance', (event, input: unknown) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('未授权的调用');
      const next = appearanceSchema.parse(input);
      nativeTheme.themeSource = next.mode;
      windowAppearance!.set(next);
    });
    ipcMain.handle('wenxu:menu', (event, input: unknown, position: unknown) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('未授权的调用');
      const id = z.enum(['app', 'edit', 'view']).parse(input);
      const point = z
        .object({ x: z.number().finite().min(0), y: z.number().finite().min(0) })
        .parse(position);
      const submenu = Menu.getApplicationMenu()?.getMenuItemById(id)?.submenu;
      if (!submenu) throw new Error('菜单不可用');
      const scale = win.webContents.getZoomFactor();
      const [width, height] = win.getContentSize();
      return new Promise<void>((resolve) => {
        submenu.popup({
          window: win,
          x: Math.min(Math.round(point.x * scale), width - 1),
          y: Math.min(Math.round(point.y * scale), height - 1),
          callback: resolve
        });
      });
    });
    startWorker();
    win.webContents.once('did-finish-load', () => {
      const notice = settingsNotice || assistantSettings.recoveryNotice;
      if (notice) emitAppEvent({ type: 'error', text: notice });
    });
    ipcMain.on('wenxu:cancel-wait', (event, waitId: unknown) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || typeof waitId !== 'string') return;
      waiting.get(waitId)?.abort();
    });
    ipcMain.handle('wenxu:invoke', async (event, command: unknown, args: unknown = {}, rawContext: unknown = {}) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        !isCommand(command)
      )
        throw new Error('未授权的调用');
      return dispatch(command, args, rawContext, { source: 'desktop' });
    });
    if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    else void win.loadFile(path.join(__dirname, '../dist/index.html'));
    win.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        requestClose();
      }
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { managementJournal?.close(); managementJournal = undefined; managementAudit?.close(); managementAudit = undefined; });
  app.on('before-quit', (event) => {
    if (!quitting && win && !win.isDestroyed()) {
      event.preventDefault();
      requestClose();
      return;
    }
    quitting = true;
    if (!shutdownComplete) {
      event.preventDefault();
      void stopWorker().finally(() => app.quit());
      return;
    }
    try {
      windowAppearance?.flush();
    } catch {
      // A read-only/full disk must not strand the writer in an unclosable window.
      console.warn('主题偏好保存失败，下次启动可能恢复为上次已保存的主题。');
    }
  });
}
