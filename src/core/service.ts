import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  configSchema,
  type AppEvent,
  type Command,
  type Run,
  type SecretProfile,
  type Snapshot,
  type Change,
  type ProjectState
} from '../shared/types';
import { FileStore, safePath, fileHash } from './storage';
import {
  id,
  now,
  newProject,
  activeBatch,
  advance,
  stageNames,
  paths,
  renderProgress,
  renderConfig,
  updateConfigDocument,
  reconfigure,
  prosePath,
  archivePath
} from './domain';
import { initialFiles, renderIndex } from './skill';
import { AgentRunner, type Caller } from './runner';
import {
  assembleContext,
  rebuildMemory,
  searchMemory,
  decodeFacts,
  encodeFacts,
  primaryPath,
  validateEvidence
} from './memory';
import { createBackup, restoreBackup, importDocument, exportDocument } from './documents';
import { invokeModel } from './provider';
import { generateCover, saveCover } from './cover';
import { importLegacy, previewLegacy } from './migration';
import { ProjectRecycleBin, isRecyclePath, samePath } from './recycle-bin';
import { ConversationRunner, type AssistantRuntime } from './conversation-runner';
import { builtInRoles } from './assistant-settings';
import { searchSettingsSchema, type ActionProposal } from '../shared/assistant';
import { PublicSearch } from './search';
const str = (v: unknown) => z.string().min(1).parse(v);
function finishImpactReview(p: ProjectState) {
  if (p.stale.length) return;
  for (const [chapter, state] of Object.entries(p.chapterStatesBeforeReview ?? {})) {
    if (p.chapters[chapter] === 'stale') p.chapters[chapter] = state;
  }
  delete p.chapterStatesBeforeReview;
}
export class Service {
  store: FileStore | null = null;
  runner: AgentRunner | null = null;
  chat: ConversationRunner | null = null;
  assistant: AssistantRuntime = {
    roles: builtInRoles(),
    search: searchSettingsSchema.parse({}),
    searchKey: ''
  };
  profiles: SecretProfile[] = [];
  recent: { title: string; root: string }[] = [];
  backingUp = false;
  coverController: AbortController | null = null;
  recycleBin: ProjectRecycleBin | null = null;
  constructor(
    readonly skillRoot: string,
    readonly emit: (event: AppEvent) => void,
    readonly caller?: Caller
  ) {}
  close() {
    if (this.chat?.controller) throw new Error('请先停止当前聊天任务');
    if (this.coverController) throw new Error('封面请求尚未结束，请先停止或等待结果');
    if (this.runner?.controller) throw new Error('请先停止当前任务');
    this.store?.close();
    this.store = null;
    this.runner = null;
    this.chat = null;
  }
  snapshot(): Snapshot {
    const store = this.store;
    if (this.recycleBin) this.recent = this.recycleBin.reconcileRecent(this.recent);
    return {
      conversations: this.chat?.records.all('conversations') ?? [],
      chatBusy: !!this.chat?.controller,
      purgedDrafts: this.recycleBin?.purgedDrafts(this.recent) ?? [],
      project: store?.db.project() ?? null,
      documents: store?.scan() ?? [],
      runs: (store?.db.runs() ?? []).map((r) => ({ ...r, messages: [], toolResults: {} })),
      events: store?.db.events() ?? [],
      profiles: this.profiles.map(({ apiKey, ...p }) => p),
      recent: this.recent,
      facts: store?.db.facts() ?? [],
      issues: (store?.db.get<string[]>('memoryIssues') ?? []).map((message) => ({
        code: 'memory',
        severity: 'error',
        message
      }))
    };
  }
  async open(root: string) {
    if (isRecyclePath(root)) throw new Error('请先从客户端回收站恢复作品，再打开编辑');
    this.close();
    const store = new FileStore(root);
    this.store = store;
    try {
      store.recover();
      const p = store.db.project();
      if (!p) throw new Error('此目录不是文序项目；请新建作品后导入文档');
      if (p.schemaVersion !== 1) throw new Error('此项目版本需要更新客户端');
      p.root = store.root;
      store.db.set('project', p);
      this.runner = new AgentRunner(store, this.skillRoot, () => this.profiles, this.emit, this.caller);
      this.chat = new ConversationRunner(
        store,
        this.skillRoot,
        () => this.profiles,
        () => this.assistant,
        this.emit,
        this.caller
      );
      this.chat.records.recover();
      if (!this.chat.records.all('conversations').length)
        this.chat.records.create('创作讨论', this.assistant.search.enabled);
      for (const r of store.db.runs())
        if (r.status === 'running' || r.status === 'committing') {
          r.status = store.db.get(`inflight:${r.id}`) ? 'unknown' : 'paused';
          r.error = '上次执行中断，恢复前将核对输入和未完成请求';
          store.db.saveRun(r);
        }
      rebuildMemory(store);
      this.recent = [{ title: p.title, root: p.root }, ...this.recent.filter((x) => x.root !== p.root)].slice(
        0,
        20
      );
    } catch (e) {
      store.close();
      this.store = null;
      throw e;
    }
    return this.snapshot();
  }
  require() {
    if (!this.store || !this.runner) throw new Error('请先打开作品');
    return { s: this.store, p: this.store.db.project(), runner: this.runner };
  }
  makeRun(mode: Run['mode'], request: string, profileId?: string): Run {
    const { p } = this.require(),
      profile = this.profiles.find(
        (v) => v.id === (profileId ?? p.config.stageProfiles[p.stage] ?? p.config.defaultProfileId)
      );
    return {
      id: id(),
      stage: p.stage,
      chapter: p.chapter,
      batch: activeBatch(p),
      mode,
      request,
      status: 'awaiting_review',
      profileId: profile?.id ?? '',
      profileVersion: profile?.version ?? 0,
      createdAt: now(),
      updatedAt: now(),
      baseRevision: p.revision,
      manifest: null,
      changes: [],
      facts: [],
      issues: [],
      messages: [],
      responseText: '',
      rounds: 0,
      toolCount: 0,
      usage: { input: 0, output: 0, cost: 0, currency: profile?.currency ?? 'USD' },
      accepted: false,
      toolResults: {}
    };
  }
  launch(r: Run) {
    const { s, runner } = this.require();
    if (runner.controller || this.chat?.controller || this.coverController)
      throw new Error('本书已有运行中的模型任务');
    s.db.saveRun(r);
    void runner.drive(r.id).catch((e) => {
      r.status = 'paused';
      r.error = (e as Error).message;
      s.db.saveRun(r);
      this.emit({ type: 'snapshot' });
    });
    return r.id;
  }
  change(relative: string, content: string): Change {
    const { s } = this.require();
    return { path: relative, content, baseHash: fileHash(safePath(s.root, relative)) };
  }
  async invoke(command: Command, a: Record<string, unknown> = {}): Promise<any> {
    if (
      this.backingUp &&
      !['app.snapshot', 'document.read', 'document.history', 'project.scan'].includes(command)
    )
      throw new Error('正在建立一致备份，请稍后再进行写入或切换项目');
    if (command === 'app.snapshot') return this.snapshot();
    if (command === 'search.test') {
      const result = await new PublicSearch(
        { ...this.assistant.search, enabled: true },
        this.assistant.searchKey,
        true,
        new AbortController().signal
      ).search('Tavily API documentation');
      return { ok: true, ...result };
    }
    if (command === 'project.listTrash') {
      if (!this.recycleBin) throw new Error('回收站尚未初始化');
      this.recycleBin.sweep();
      return this.recycleBin.list();
    }
    if (command === 'project.restoreTrash') {
      if (!this.recycleBin) throw new Error('回收站尚未初始化');
      const restored = this.recycleBin.restore(str(a.id), a.parent ? str(a.parent) : undefined);
      this.recent = [restored, ...this.recent.filter((r) => !samePath(r.root, restored.root))].slice(0, 20);
      return this.snapshot();
    }
    if (command === 'project.restoreBackup') return restoreBackup(str(a.source), str(a.parent));
    if (command === 'project.preview') {
      const p = newProject(typeof a.title === 'string' ? a.title : '待定', 'preview', a.config ?? {});
      return Object.keys(initialFiles(p, this.skillRoot, typeof a.premise === 'string' ? a.premise : ''));
    }
    if (command === 'project.importLegacy') {
      if (a.preview === true) return previewLegacy(str(a.source));
      const root = importLegacy(a);
      return this.open(root);
    }
    if (command === 'project.create') {
      const args = z
        .object({
          parent: z.string(),
          title: z.string().min(1).max(80),
          premise: z.string().min(1),
          config: configSchema.optional()
        })
        .parse(a);
      const title = args.title.trim();
      if (isRecyclePath(args.parent)) throw new Error('不能在回收站内新建作品');
      if (/[<>:"/\\|?*\x00-\x1f]/.test(title) || /[. ]$/.test(title))
        throw new Error('作品名称包含无效路径字符');
      this.close();
      const root = path.join(args.parent, `《${title}》创作档案`);
      if (fs.existsSync(root)) throw new Error('同名作品目录已存在，请改名或打开');
      fs.mkdirSync(root, { recursive: true });
      const s = new FileStore(root);
      this.store = s;
      const p = newProject(title, root, args.config ?? {});
      p.revision = 1;
      const files = initialFiles(p, this.skillRoot, args.premise);
      s.commit(
        Object.entries(files).map(([path, content]) => ({ path, content, baseHash: null })),
        p
      );
      s.db.set('premise', args.premise);
      s.close();
      this.store = null;
      return this.open(root);
    }
    if (command === 'project.open') return this.open(str(a.root));
    if (command === 'project.close') {
      this.close();
      return this.snapshot();
    }
    if (command === 'project.trash') {
      if (!this.recycleBin) throw new Error('回收站尚未初始化');
      const root = str(a.root);
      const entry = this.recent.find((r) => samePath(r.root, root));
      if (!entry) throw new Error('此作品已不在最近列表中，请刷新后重试');
      if (this.store && samePath(this.store.root, root)) this.close();
      try {
        this.recycleBin.trash(entry.root, entry.title);
        this.recent = this.recent.filter((r) => !samePath(r.root, root));
        return this.snapshot();
      } catch (e) {
        this.recycleBin.sweep();
        throw e;
      } finally {
        this.emit({ type: 'snapshot' });
      }
    }
    if (command === 'profiles.test') {
      if (this.runner?.controller || this.chat?.controller || this.coverController)
        throw new Error('请等当前模型任务结束再测试连接');
      const profile = this.profiles.find((p) => p.id === str(a.id));
      if (!profile) throw new Error('模型配置不存在');
      const toolTest = a.tools === true;
      const tools = toolTest
        ? [
            {
              name: 'probe',
              description: 'Call this tool with value ping',
              parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
                additionalProperties: false
              }
            }
          ]
        : [];
      const result = await invokeModel(
        profile,
        'Protocol connectivity test.',
        [
          {
            role: 'user',
            content: toolTest
              ? 'Call probe with value ping, then after its result reply pong.'
              : 'Reply exactly pong.'
          }
        ],
        tools,
        new AbortController().signal
      );
      if (toolTest) {
        if (!result.calls.length) throw new Error('文字返回正常，但模型未执行工具调用');
        const c = result.calls[0];
        const end = await invokeModel(
          profile,
          'Protocol connectivity test.',
          [
            { role: 'user', content: 'Call probe then reply pong.' },
            { role: 'assistant', content: result.text, calls: result.calls, native: result.native },
            ...result.calls.map((c) => ({ role: 'tool' as const, callId: c.id, content: 'ping received' }))
          ],
          tools,
          new AbortController().signal
        );
        if (end.stop !== 'complete' || !end.text) throw new Error('工具结果续轮未完成');
        return { ok: true, text: end.text };
      }
      return { ok: true, text: result.text };
    }
    const { s, p, runner } = this.require();
    const chat = this.chat!,
      records = chat.records;
    const idle = () => {
      if (runner.controller || chat.controller || this.coverController)
        throw new Error('同一本书同时只能运行一个模型任务，请等待或停止当前任务');
    };
    if (command === 'chat.list') return records.all('conversations');
    if (command === 'chat.create')
      return records.create(
        typeof a.title === 'string' ? a.title : '创作讨论',
        this.assistant.search.enabled
      );
    if (command === 'chat.update') {
      const c = records.get('conversations', str(a.id));
      if (typeof a.title === 'string') c.title = z.string().trim().min(1).max(80).parse(a.title);
      if (typeof a.archived === 'boolean') c.archived = a.archived;
      if (typeof a.online === 'boolean') c.online = a.online;
      c.updatedAt = now();
      return records.save('conversations', c);
    }
    if (command === 'chat.read') {
      const key = str(a.id);
      return {
        conversation: records.get('conversations', key),
        messages: records.all('conversation_messages', key),
        turns: records.all('conversation_turns', key).map((t) => ({ ...t, messages: [] })),
        proposals: records.all('action_proposals', key)
      };
    }
    if (command === 'chat.stop') {
      chat.stop();
      return true;
    }
    if (command === 'chat.send' || command === 'chat.retry') {
      idle();
      const old = command === 'chat.retry' ? records.get('conversation_turns', str(a.id)) : undefined;
      if (old && ['running', 'complete'].includes(old.status)) throw new Error('此消息无需重发');
      if (old && a.confirmRetry !== true) throw new Error('需要明确确认重新请求，可能产生新的费用');
      if (old?.kind === 'draft') throw new Error('试写重试需要重新建立任务卡');
      const allowed = z
        .array(z.string())
        .max(10)
        .parse(a.referenceChats ?? []);
      for (const key of allowed) records.get('conversations', key);
      const turn = chat.prepare(
        old?.conversationId ?? str(a.conversationId),
        old?.request ?? str(a.text),
        typeof a.profileId === 'string' ? a.profileId : (old?.profileId ?? p.config.defaultProfileId)
      );
      void chat.drive(turn.id, allowed);
      return turn.id;
    }
    if (command === 'proposal.create')
      return chat.propose(str(a.conversationId), '', str(a.profileId), a.proposal);
    if (command === 'proposal.cancel') {
      const proposal = records.get('action_proposals', str(a.id));
      if (proposal.status === 'executed') throw new Error('任务已执行，请在运行记录中停止或放弃');
      proposal.status = 'cancelled';
      return records.save('action_proposals', proposal);
    }
    if (command === 'proposal.refresh') {
      const old = records.get('action_proposals', str(a.id));
      if (old.status === 'executed' || old.status === 'cancelled')
        throw new Error('已执行或取消的任务不能刷新');
      const next = chat.propose(
        old.conversationId,
        old.turnId,
        typeof a.profileId === 'string' ? a.profileId : old.profileId,
        { ...old, ...(a.proposal && typeof a.proposal === 'object' ? a.proposal : {}) }
      );
      old.status = 'cancelled';
      records.save('action_proposals', old);
      return next;
    }
    if (command === 'proposal.confirm') {
      const proposal = records.get('action_proposals', str(a.id));
      if (proposal.status === 'executed' && proposal.version === a.version)
        return { kind: proposal.kind, id: proposal.executionId, alreadyExecuted: true };
      idle();
      chat.verify(proposal, str(a.version));
      if (proposal.kind === 'draft') {
        const turn = chat.prepare(
          proposal.conversationId,
          `${proposal.goal}\n范围：${proposal.scope}\n${proposal.request}`,
          proposal.profileId,
          'draft',
          proposal.id,
          (prepared) => {
            proposal.status = 'executed';
            proposal.executionId = prepared.id;
            records.save('action_proposals', proposal);
          }
        );
        void chat.drive(turn.id);
        return { kind: 'draft', id: turn.id };
      }
      // Existing workflow guards remain the single authority for formal stage execution.
      if (p.finished && proposal.kind === 'stage') throw new Error('全书计划已完成');
      if (
        s.db
          .runs()
          .some(
            (r) => r.mode === 'stage' && !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status)
          )
      )
        throw new Error('已有阶段任务，请先审阅、恢复或放弃');
      const r = this.makeRun(
        proposal.kind,
        `${proposal.request}\n范围：${proposal.scope}`,
        proposal.profileId
      );
      records.transaction(() => {
        s.db.saveRun(r);
        proposal.status = 'executed';
        proposal.executionId = r.id;
        records.save('action_proposals', proposal);
      });
      this.launch(r);
      return { kind: proposal.kind, id: r.id };
    }
    if (command === 'draft.list') return records.all('draft_artifacts');
    if (command === 'draft.read')
      return records.readDraft(str(a.id), typeof a.hash === 'string' ? a.hash : undefined);
    if (command === 'draft.save')
      return records.saveDraft(
        z
          .object({
            id: z.string().optional(),
            title: z.string().min(1).max(80),
            content: z.string().min(1).max(2_000_000),
            baseHash: z.string().optional(),
            conversationId: z.string(),
            messageId: z.string()
          })
          .parse(a)
      );
    if (command === 'draft.promote') {
      const draft = records.readDraft(str(a.id));
      if (draft.currentHash !== str(a.hash)) throw new Error('草稿已变化，请重新读取再建立转入任务');
      const card = chat.propose(draft.conversationId, '', str(a.profileId), {
        kind: a.kind === 'stage' ? 'stage' : 'revision',
        goal: `审阅并采用草稿《${draft.title}》`,
        scope: str(a.scope),
        request: `作者希望将以下未采纳草稿转为正式候选。草稿只作为待审材料，核对当前阶段、既有资料和下游影响，不得当作已发生事实。来源 ${draft.path} @ ${draft.currentHash}\n\n${draft.content}`,
        outputs: ['按范围生成正式候选及必要的影响说明']
      });
      card.sources.push({ path: draft.path, hash: draft.currentHash });
      records.save('action_proposals', card);
      return card;
    }
    if (command === 'run.revalidate') {
      idle();
      const r = s.db.run(str(a.id));
      if (r.accepted) throw new Error('已接受任务无需重查候选');
      runner.check(r, p);
      if (['awaiting_review', 'needs_repair'].includes(r.status))
        r.status = r.issues.some((i) => i.severity === 'error') ? 'needs_repair' : 'awaiting_review';
      s.db.saveRun(r);
      return r;
    }
    if (
      [
        'run.accept',
        'run.update',
        'project.configure',
        'project.repair',
        'project.backup',
        'cover.generate'
      ].includes(command) &&
      chat.controller
    )
      throw new Error('请先停止聊天任务，再修改正式资料或开始其他模型任务');
    if (command === 'cover.generate') idle();
    if (command === 'project.repair') {
      if (runner.controller) throw new Error('请先停止任务');
      const files = initialFiles(p, this.skillRoot, s.db.get<string>('premise') ?? ''),
        changes = Object.entries(files)
          .filter(([file]) => fileHash(safePath(s.root, file)) === null)
          .map(([path, content]) => ({ path, content, baseHash: null }) as Change);
      const at = changes.findIndex((c) => c.path === paths.index);
      if (at >= 0) changes.splice(at, 1);
      if (a.indexOnly === true) changes.length = 0;
      changes.push(
        this.change(
          paths.index,
          renderIndex(p, [
            ...new Set([
              ...s
                .scan()
                .filter((d) => d.status !== 'missing')
                .map((d) => d.path),
              ...changes.map((c) => c.path)
            ])
          ])
        )
      );
      if (a.preview === true) return changes.map((c) => c.path);
      const r = this.makeRun('import', '修复缺失模板与索引');
      r.changes = changes;
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'cover.list') {
      const folder = safePath(s.root, '10_封面');
      return fs.existsSync(folder)
        ? fs
            .readdirSync(folder)
            .filter((f) => f.endsWith('.json'))
            .map((f) => `10_封面/${f}`)
        : [];
    }
    if (command === 'cover.load') {
      const file = str(a.path);
      if (!/^10_封面\/[^/]+\.json$/.test(file)) throw new Error('非法封面配置路径');
      return JSON.parse(fs.readFileSync(safePath(s.root, file), 'utf8'));
    }
    if (command === 'diagnostics.export') {
      const report = {
        version: '0.1.0',
        project: { title: p.title, revision: p.revision, stage: p.stage, chapter: p.chapter },
        runs: s.db
          .runs()
          .map((r) => ({ id: r.id, stage: r.stage, status: r.status, usage: r.usage, error: r.error })),
        events: s.db.events().map(({ data, ...e }) => ({
          ...e,
          text: ['tool-result', 'terminal-execute'].includes(e.kind) ? '工具或脚本内容已省略' : e.text
        })),
        issues: s.db.get('memoryIssues') ?? []
      };
      let output = JSON.stringify(report, null, 2);
      for (const profile of this.profiles)
        if (profile.apiKey) output = output.replaceAll(profile.apiKey, '[密钥已隐藏]');
      return output;
    }
    if (command === 'cover.generate') {
      if (this.coverController) throw new Error('已有封面请求正在执行');
      const profile = this.profiles.find((x) => x.id === str(a.profileId));
      if (!profile) throw new Error('图像配置不存在');
      this.coverController = new AbortController();
      const requestId = id();
      s.db.event(
        requestId,
        'cover-request',
        `作者确认封面生成：${profile.name}，模型 ${profile.model}，配置版本 ${profile.version}`
      );
      try {
        const result = await generateCover(profile, str(a.prompt), this.coverController.signal);
        s.db.event(requestId, 'cover-result', '图像已返回，等待作者保存；实际费用请核对服务商账单');
        return result;
      } catch (e) {
        s.db.event(requestId, 'cover-error', (e as Error).message);
        throw e;
      } finally {
        this.coverController = null;
      }
    }
    if (command === 'cover.cancel') {
      this.coverController?.abort();
      return true;
    }
    if (command === 'cover.save') return saveCover(s, str(a.dataUrl), a.metadata);
    if (command === 'project.scan') return this.snapshot();
    if (command === 'document.read')
      return s.read(str(a.path), typeof a.hash === 'string' ? a.hash : undefined);
    if (command === 'document.history') return s.db.history(str(a.path));
    if (command === 'document.save' || command === 'document.restore') {
      const relative = str(a.path);
      safePath(s.root, relative);
      if (!relative.endsWith('.md')) throw new Error('请使用 Markdown 文档');
      if (runner.controller) throw new Error('运行期间请先停止任务再提出修订');
      const content =
        command === 'document.restore' ? s.read(relative, str(a.hash)).content : z.string().parse(a.content);
      const r = this.makeRun('manual', command === 'document.restore' ? '恢复历史版本' : '手动修改');
      r.changes = [{ path: relative, content, baseHash: z.string().nullable().parse(a.baseHash) }];
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'project.importAccept') {
      const relative = str(a.path),
        read = s.read(relative);
      const r = this.makeRun('manual', '接受外部改稿');
      r.changes = [{ path: relative, content: read.content, baseHash: read.hash }];
      s.db.saveRun(r);
      return r.id;
    }
    if (command === 'project.configure') {
      if (runner.controller) throw new Error('请先停止任务再修改项目设置');
      if (s.read(paths.config).hash !== s.db.document(paths.config)?.hash)
        throw new Error('配置文件存在外部改动，请先比较并接受，不能用旧设置覆盖');
      const cfg = configSchema.parse(a.config);
      const next = reconfigure(p, cfg);
      s.commit(
        [
          this.change(paths.config, updateConfigDocument(s.read(paths.config).content, next)),
          this.change(paths.progress, renderProgress(next))
        ],
        next
      );
      return this.snapshot();
    }
    if (command === 'run.start') {
      if (p.finished && a.mode !== 'revision') throw new Error('当前全书计划已完成');
      if (
        s.db
          .runs()
          .some(
            (r) => r.mode === 'stage' && !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status)
          )
      )
        throw new Error('已有阶段任务，请继续、审阅或放弃后再开始');
      const r = this.makeRun(
        a.mode === 'revision' ? 'revision' : 'stage',
        str(a.request),
        typeof a.profileId === 'string' ? a.profileId : undefined
      );
      return this.launch(r);
    }
    if (command === 'run.cancel' || command === 'terminal.cancel') {
      runner.stop();
      return true;
    }
    if (command === 'run.handoff') {
      if (runner.controller) throw new Error('请先停止任务');
      const old = s.db.run(str(a.id));
      if (old.accepted || old.status === 'discarded') throw new Error('此任务不能交接');
      if (old.status === 'unknown' && a.retryUnknown !== true)
        throw new Error('上次请求结果未知，须先核对收费请求');
      const r = this.makeRun(
        old.mode,
        `${old.request}\n\n作者确认重新组装上下文。可观察交接：旧任务 ${old.id}，已完成 ${Object.keys(old.toolResults).length} 次工具调用。候选已保留，但尚未接受。之前错误：${old.error ?? '无'}。请基于当前正式资料重新核对候选后继续。`,
        str(a.profileId)
      );
      r.changes = old.changes;
      r.facts = old.facts;
      old.status = 'discarded';
      old.error = `已交接至 ${r.id}，原始协议记录保留`;
      s.db.saveRun(old);
      return this.launch(r);
    }
    if (command === 'run.resume' || command === 'run.answer' || command === 'run.permission') {
      const r = s.db.run(str(a.id));
      if (r.accepted || r.status === 'discarded') throw new Error('此任务不能恢复');
      if (r.status === 'unknown' && a.retryUnknown !== true)
        throw new Error('上次请求结果与费用未知，需明确选择重新请求');
      if (command === 'run.answer') {
        if (!r.input) throw new Error('任务没有待回答问题');
        r.input.answer = str(a.answer);
      }
      if (command === 'run.permission') {
        if (!r.permission) throw new Error('没有待批准动作');
        r.permission.status = a.approved === true ? 'approved' : 'denied';
      }
      if (typeof a.instruction === 'string' && a.instruction.trim())
        r.messages.push({ role: 'user', content: a.instruction });
      return this.launch(r);
    }
    if (command === 'run.discard') {
      const r = s.db.run(str(a.id));
      if (r.accepted || runner.controller) throw new Error('请先停止，已接受的版本请通过修订恢复');
      r.status = 'discarded';
      s.db.saveRun(r);
      return true;
    }
    if (command === 'run.update') {
      const r = s.db.run(str(a.id));
      if (r.accepted || runner.controller) throw new Error('此时不能修改候选');
      const at = r.changes.findIndex((c) => c.path === str(a.path));
      if (at < 0) throw new Error('候选不存在');
      r.changes[at].content = z.string().parse(a.content);
      runner.check(r, p);
      r.status = r.issues.some((i) => i.severity === 'error') ? 'needs_repair' : 'awaiting_review';
      s.db.saveRun(r);
      return r;
    }
    if (command === 'run.accept') {
      if (runner.controller) throw new Error('任务还在运行');
      const r = s.db.run(str(a.id));
      if (r.accepted) return { alreadyAccepted: true };
      if (!['awaiting_review', 'needs_repair'].includes(r.status))
        throw new Error('请先完成任务并进入候选审阅');
      if (r.baseRevision !== p.revision) throw new Error('候选基于旧项目版本，请重新审阅并建立候选');
      if (r.manifest?.sources.some((source) => fileHash(safePath(s.root, source.path)) !== source.hash))
        throw new Error('候选所依赖的资料已被外部修改；请先核对资料并重新建立任务，旧批准不能沿用');
      if (r.mode === 'stage' && (p.stage !== r.stage || p.chapter !== r.chapter))
        throw new Error('阶段已经改变');
      runner.check(r, p);
      if (r.issues.some((i) => i.severity === 'error')) {
        s.db.saveRun(r);
        throw new Error('候选存在阻断问题，请先修改');
      }
      if (!r.changes.length) throw new Error('没有可接受的候选文件');
      if (r.issues.some((i) => i.severity === 'warning') && !String(a.warningReason ?? '').trim())
        throw new Error('请填写保留警告的审阅理由');
      if (a.warningReason) s.db.event(r.id, 'warning-review', String(a.warningReason));
      let next = r.mode === 'stage' ? advance(p, r.id) : structuredClone(p);
      next.revision++;
      let changes = structuredClone(r.changes);
      // Merge authoritative evidence records even when a model replaces a whole human-readable ledger.
      let facts = s.db.facts().map((f) => structuredClone(f));
      if (r.mode === 'manual')
        for (const change of changes.filter((c) => c.path.startsWith('04_'))) {
          const old = facts.filter((f) => primaryPath(f) === change.path);
          const supplied = decodeFacts(change.content);
          if (old.length && !change.content.includes('<!-- wenxu-facts:v1 -->'))
            throw new Error('此文档含结构化记忆，请保留事实记录并显式修订或撤回，不能静默删除');
          for (const fact of supplied)
            if (fact.reviewStatus === 'accepted') {
              const issues = validateEvidence(s, fact, p.chapter);
              if (issues.length) throw new Error(issues.join('；'));
            }
          facts = [...facts.filter((f) => primaryPath(f) !== change.path), ...supplied];
        }
      for (const raw of r.facts) {
        const f = { ...raw, reviewStatus: 'accepted' as const, acceptedAt: now(), acceptedRunId: r.id };
        const errors = validateEvidence(s, f, p.chapter);
        if (errors.length) throw new Error(errors.join('；'));
        if (facts.some((x) => x.id === f.id))
          throw new Error(`记忆编号已存在，请新建编号并引用 supersedes：${f.id}`);
        if (f.supersedes) {
          const old = facts.find((x) => x.id === f.supersedes);
          if (!old) throw new Error('被替代记忆不存在');
          if (!f.replacementReason) throw new Error('替代既有事实必须说明依据和原因');
          old.state = 'superseded';
          if (f.fromChapter <= old.fromChapter) {
            old.reviewStatus = 'retracted';
            old.toChapter = old.fromChapter;
          } else old.toChapter = f.fromChapter - 1;
        }
        facts.push(f);
      }
      const factFiles = new Set([
        ...facts.map(primaryPath),
        ...changes.filter((c) => c.path.startsWith('04_')).map((c) => c.path)
      ]);
      for (const relative of factFiles) {
        const fileFacts = facts.filter((f) => primaryPath(f) === relative);
        const c = changes.find((c) => c.path === relative);
        if (c) c.content = encodeFacts(c.content, fileFacts);
        else if (
          r.facts.some(
            (f) =>
              primaryPath(f) === relative ||
              (f.supersedes && facts.find((x) => x.id === f.supersedes && primaryPath(x) === relative))
          )
        )
          changes.push(this.change(relative, encodeFacts(s.read(relative).content, fileFacts)));
      }
      if (r.mode === 'stage' && r.stage === 'S11' && p.chapter === activeBatch(p).end) {
        const batch = activeBatch(p),
          behavior = changes.find((c) => c.path === paths.behavior)!,
          summary = changes.find((c) => c.path === paths.summary)!;
        const sources = Array.from({ length: batch.end - batch.start + 1 }, (_, i) => {
          const file = prosePath(batch.start + i);
          return { path: file, hash: s.db.document(file)?.hash ?? null };
        });
        summary.content += `\n\n## 摘要覆盖回执\n\n- 来源：${sources.map((v) => `${v.path} @ ${v.hash}`).join('；')}\n- 未解决事项：${
          facts
            .filter((f) => f.mandatory && f.state === 'active')
            .map((f) => f.id)
            .join('、') || '无已登记事项'
        }\n- 重要遗漏：摘要可能省略细节；须经作者语义审阅，完整行为日志与原文保留。\n`;
        changes.push(this.change(archivePath(batch), encodeFacts(behavior.content, [])));
        behavior.content = encodeFacts(
          `# 情绪与行为记忆\n\n## 下一批起点\n\n${summary.content}\n`,
          facts.filter((f) => primaryPath(f) === paths.behavior)
        );
      }
      if (r.mode !== 'stage') {
        const changed = changes.map((c) => c.path),
          earliest = Math.min(...changed.map((f) => Number(f.match(/^07_.*第(\d+)章/)?.[1] ?? Infinity)));
        const placeholders = initialFiles(p, this.skillRoot, '');
        const affected = s.db
          .acceptedDocuments()
          .map((d) => d.path)
          .filter(
            (f) =>
              !changed.includes(f) &&
              (!placeholders[f] || s.read(f).content !== placeholders[f]) &&
              !['00_', '09_'].some((v) => f.startsWith(v)) &&
              f !== paths.index &&
              (Number.isFinite(earliest)
                ? f.startsWith('04_') ||
                  f.startsWith('05_') ||
                  f.startsWith('06_') ||
                  f.startsWith('08_') ||
                  (f.startsWith('07_') && Number(f.match(/第(\d+)章/)?.[1]) > earliest)
                : f.startsWith('04_') ||
                  f.startsWith('05_') ||
                  f.startsWith('06_') ||
                  f.startsWith('07_') ||
                  f.startsWith('08_'))
          );
        next.stale = [...new Set([...p.stale.filter((f) => !changed.includes(f)), ...affected])];
        for (const n of Object.keys(next.chapters))
          if (!Number.isFinite(earliest) || Number(n) >= earliest) {
            const state = next.chapters[n];
            if (state !== 'stale') (next.chapterStatesBeforeReview ??= {})[n] = state;
            next.chapters[n] = 'stale';
          }
        finishImpactReview(next);
        const record = `\n\n## ${now()} ${r.request}\n\n- 起因：${r.request}\n- 修改章节或规则：${changed.join('、')}\n- 旧事实：以本次基础版本原文为准；${changes.map((c) => `${c.path} @ ${c.baseHash ?? '新文件'}`).join('；')}\n- 新事实：见本次已接受候选；来源任务 ${r.id}\n- 影响起点：${Number.isFinite(earliest) ? `第${earliest}章` : '涉及设定与后续资料'}\n- 已检查文件：${changed.join('、')}\n- 已同步文件：${changed.join('、')}\n- 无需修改及原因：待逐项核对后填写\n- 待核对：${next.stale.join('、') || '无'}\n- 状态：${next.stale.length ? '处理中' : '已闭环'}\n`;
        changes = changes.filter((c) => c.path !== paths.impact);
        changes.push(this.change(paths.impact, s.read(paths.impact).content + record));
      }
      const all = [
        ...new Set([...s.db.acceptedDocuments().map((d) => d.path), ...changes.map((c) => c.path)])
      ];
      changes = changes.filter((c) => c.path !== paths.progress && c.path !== paths.index);
      changes.push(
        this.change(paths.progress, renderProgress(next)),
        this.change(paths.index, renderIndex(next, all))
      );
      r.accepted = true;
      r.status = 'complete';
      r.updatedAt = now();
      s.commit(changes, next, r);
      rebuildMemory(s);
      s.db.event(r.id, 'accepted', '作者接受结果，已提交正式文件');
      if (next.config.backupDirectory) {
        this.backingUp = true;
        try {
          await createBackup(s, next.config.backupDirectory);
        } catch (e) {
          s.db.event(r.id, 'backup-error', `正式文件已提交，但备份失败：${(e as Error).message}`);
        } finally {
          this.backingUp = false;
        }
      }
      if (a.startNext === true && r.mode === 'stage' && !next.finished)
        return {
          accepted: true,
          nextRun: this.launch(
            this.makeRun(
              'stage',
              `完成 ${stageNames[next.stage]}。沿用已接受要求，开始前复核全部必读资料。`,
              next.config.stageProfiles[next.stage] || next.config.defaultProfileId || r.profileId
            )
          )
        };
      return { accepted: true };
    }
    if (command === 'memory.search')
      return searchMemory(
        s,
        typeof a.query === 'string' ? a.query : '',
        typeof a.chapter === 'number' ? a.chapter : p.chapter
      );
    if (command === 'memory.rebuild') return rebuildMemory(s);
    if (command === 'context.preview') {
      const profile = this.profiles.find((x) => x.id === (a.profileId ?? p.config.defaultProfileId));
      if (!profile) throw new Error('先选择模型配置');
      return assembleContext(s, p, p.stage, typeof a.request === 'string' ? a.request : '', profile);
    }
    if (command === 'impact.review') {
      if (runner.controller) throw new Error('请先停止任务');
      const relative = str(a.path),
        reason = str(a.reason);
      if (!p.stale.includes(relative)) throw new Error('不在待核对范围内');
      if (fileHash(safePath(s.root, relative)) !== s.db.document(relative)?.hash)
        throw new Error('先处理外部改动');
      p.stale = p.stale.filter((f) => f !== relative);
      finishImpactReview(p);
      p.revision++;
      s.commit(
        [
          this.change(
            paths.impact,
            s.read(paths.impact).content + `\n- ${relative}：${reason}（作者核对，${now()}）\n`
          ),
          this.change(paths.progress, renderProgress(p))
        ],
        p
      );
      return true;
    }
    if (command === 'project.backup') {
      if (runner.controller) throw new Error('请先停止运行以建立一致备份');
      this.backingUp = true;
      try {
        return await createBackup(s, str(a.directory ?? p.config.backupDirectory));
      } finally {
        this.backingUp = false;
      }
    }
    if (command === 'project.importDocument') return importDocument(str(a.file));
    if (command === 'project.export') {
      const selected = z.array(z.string()).min(1).parse(a.paths);
      const content = selected
        .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
        .map((f) => {
          const d = s.db.document(f);
          if (!d?.hash) throw new Error('只能导出正式接受的版本');
          return s.read(f, d.hash).content;
        })
        .join('\n\n');
      return exportDocument(content, str(a.target));
    }
    throw new Error(`尚未实现命令：${command}`);
  }
}
