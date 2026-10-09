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
  type UtilityProcess
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  commands,
  profileSchema,
  type Profile,
  type SecretProfile,
  type Command,
  type ModelLimits
} from '../src/shared/types';
import { atomicWrite } from '../src/core/storage';
import { endpoint } from '../src/core/provider';
import { fetchModelCatalog, resolveCatalogConnection, sameEndpoint } from '../src/core/model-catalog';
import { prepareProviderGroup } from '../src/core/provider-groups';
import { connectionId } from '../src/shared/provider-groups';
import { AssistantSettings } from '../src/core/assistant-settings';
import { roleIds, searchSettingsSchema } from '../src/shared/assistant';
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
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let stateFile = '';
let appearanceFile = '';
let assistantSettings: AssistantSettings;
const appearanceSchema = z.object({
  mode: z.enum(['dark', 'light']),
  // Production CSS minification shortens #ffffff to #fff.
  background: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i),
  foreground: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i)
});
let appearance = { mode: 'dark' as 'dark' | 'light', background: '#151517', foreground: '#f9fafb' };
const granted = new Set<string>();
const modelLimitsCache = new Map<string, ModelLimits>();
if (process.env.WENXU_DATA_DIR) app.setPath('userData', path.resolve(process.env.WENXU_DATA_DIR));
function saveSettings() {
  atomicWrite(stateFile, JSON.stringify(settings, null, 2));
}
function profiles(includeDisabled = false): SecretProfile[] {
  return settings.profiles
    .filter((p) => includeDisabled || p.enabled !== false)
    .map(({ encryptedKey, ...p }) => ({
      ...p,
      apiKey: encryptedKey ? safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')) : ''
    }));
}
function sync() {
  worker.postMessage({ type: 'profiles', profiles: profiles(), recent: settings.recent });
  worker.postMessage({
    type: 'assistant',
    assistant: {
      roles: assistantSettings.roles(),
      search: assistantSettings.settings().search,
      searchKey: assistantSettings.secret()
        ? safeStorage.decryptString(Buffer.from(assistantSettings.secret(), 'base64'))
        : ''
    }
  });
}
function startWorker() {
  worker = utilityProcess.fork(
    path.join(__dirname, 'worker.cjs'),
    [
      app.isPackaged
        ? path.join(process.resourcesPath, 'skill')
        : path.join(app.getAppPath(), 'resources/skill'),
      app.getPath('userData')
    ],
    { serviceName: '文序写作内核', stdio: 'pipe', env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1' } }
  );
  worker.on('message', (m: any) => {
    if (m.event) {
      if (!win.isDestroyed()) win.webContents.send('wenxu:event', m.event);
      return;
    }
    const job = pending.get(m.id);
    if (!job) return;
    pending.delete(m.id);
    m.error ? job.reject(new Error(m.error)) : job.resolve(m.result);
  });
  worker.on('exit', () => {
    for (const job of pending.values())
      job.reject(new Error('执行内核已退出，文稿草稿保留；请重新启动客户端恢复任务'));
    pending.clear();
    if (!quitting && !win.isDestroyed())
      win.webContents.send('wenxu:event', {
        type: 'error',
        text: '执行内核异常退出，请重启客户端。已提交文件可由日志恢复。'
      });
  });
  sync();
}
function rpc(command: Command, args: Record<string, unknown>) {
  return new Promise<any>((resolve, reject) => {
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, command, args });
  });
}
function selected(file: unknown) {
  const target = z.string().parse(file);
  if (!granted.has(path.resolve(target))) throw new Error('请通过系统选择框选择此目录或文件');
  return target;
}
async function handle(command: Command, a: Record<string, unknown>) {
  if (command === 'app.openUrl') {
    const url = new URL(z.string().parse(a.url));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('仅支持打开普通网页链接');
    await shell.openExternal(url.href);
    return true;
  }
  if (command === 'assistant.settings') return assistantSettings.settings();
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
      (p) => trustedModelLimits(p, modelLimitsCache.get(limitsCacheKey(p, p.model)))
    );
    const next = { ...settings, profiles: update.all };
    atomicWrite(stateFile, JSON.stringify(next, null, 2));
    settings = next;
    sync();
    return update.saved.map(({ encryptedKey, ...p }) => p);
  }
  if (command === 'profiles.deleteGroup') {
    const id = z.string().min(1).parse(a.id);
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
        defaultPath: typeof a.name === 'string' ? a.name : '作品.docx',
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
  if (command === 'profiles.save') {
    let profile = profileSchema.parse(a.profile);
    const old = settings.profiles.find((v) => v.id === profile.id);
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
    profile.version = (old?.version ?? 0) + 1;
    profile.hasKey = !!(key || old?.encryptedKey);
    profile.capabilities = {};
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
    const catalog = await fetchModelCatalog(connection);
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
  if (command === 'app.snapshot')
    return { ...result, savedProfiles: settings.profiles.map(({ encryptedKey, ...p }) => p) };
  if (
    command === 'project.open' ||
    command === 'project.create' ||
    command === 'project.trash' ||
    command === 'project.restoreTrash' ||
    (command === 'project.importLegacy' && a.preview !== true)
  ) {
    const next = { ...settings, recent: result.recent };
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
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    stateFile = path.join(app.getPath('userData'), 'settings.json');
    assistantSettings = new AssistantSettings(app.getPath('userData'));
    appearanceFile = path.join(app.getPath('userData'), 'appearance.json');
    try {
      appearance = appearanceSchema.parse(JSON.parse(fs.readFileSync(appearanceFile, 'utf8')));
    } catch {
      // Missing or damaged appearance preferences must not prevent opening a book.
    }
    nativeTheme.themeSource = appearance.mode;
    if (fs.existsSync(stateFile)) settings = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const upgradedProfiles = migrateModelLimits(settings.profiles);
    if (JSON.stringify(upgradedProfiles) !== JSON.stringify(settings.profiles)) {
      const backup = stateFile + '.before-official-limits';
      if (fs.existsSync(stateFile) && !fs.existsSync(backup)) atomicWrite(backup, fs.readFileSync(stateFile));
      const next = { ...settings, profiles: upgradedProfiles };
      atomicWrite(stateFile, JSON.stringify(next, null, 2));
      settings = next;
    }
    if (!app.isPackaged && process.env.WENXU_DEBUG_PORT)
      app.commandLine.appendSwitch('remote-debugging-port', process.env.WENXU_DEBUG_PORT);
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
      title: '文序',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => {
      if (url !== win.webContents.getURL()) e.preventDefault();
    });
    win.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(false));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { id: 'app', label: '文序', submenu: [{ role: 'quit', label: '退出' }] },
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
    ipcMain.handle('wenxu:appearance', (event, input: unknown) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('未授权的调用');
      const next = appearanceSchema.parse(input);
      nativeTheme.themeSource = next.mode;
      win.setBackgroundColor(next.background);
      win.setTitleBarOverlay({ color: next.background, symbolColor: next.foreground, height: 38 });
      if (JSON.stringify(appearance) !== JSON.stringify(next) || !fs.existsSync(appearanceFile)) {
        appearance = next;
        atomicWrite(appearanceFile, JSON.stringify(appearance));
      }
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
    ipcMain.handle('wenxu:invoke', async (event, command: Command, args: Record<string, unknown> = {}) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        !commands.includes(command)
      )
        throw new Error('未授权的调用');
      return handle(command, z.record(z.string(), z.unknown()).parse(args));
    });
    if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    else void win.loadFile(path.join(__dirname, '../dist/index.html'));
    win.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        void dialog
          .showMessageBox(win, {
            type: 'question',
            buttons: ['继续写作', '退出'],
            defaultId: 0,
            cancelId: 0,
            message: '退出文序？',
            detail: '未提交的编辑草稿会保留；运行中的请求将中断，费用状态可能未知。'
          })
          .then((r) => {
            if (r.response === 1) {
              quitting = true;
              worker.postMessage({ type: 'shutdown' });
              setTimeout(() => app.quit(), 500);
            }
          });
      }
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    worker?.postMessage({ type: 'shutdown' });
  });
}
