import fs from 'node:fs';
import { resolveWorkbenchObject } from './workbench';
import { explicitlyRequestsEdit } from '../shared/author-intent';
import { fingerprint } from './runtime/canonical';
import path from 'node:path';
import { z } from 'zod';
import type {
ActionProposal,
ConversationTurn,
RoleRule,
SearchSettings
} from '../shared/assistant';
import { requireModelLimits } from '../shared/model-limits';
import { captureReasoning } from '../shared/reasoning';
import { retryNeedsConfirmation } from '../shared/run-presentation';
import type { EmbeddingSettings } from '../shared/studio';
import type { AppEvent,SecretProfile,ToolDefinition } from '../shared/types';
import { Conversations } from './conversations';
import { hash,id,now,stageNames,stageOutputs } from './domain';
import { expressionFingerprint } from './expression-rules';
import { invokeModel } from './provider';
import type { Caller } from './runner';
import { compatibleRunBase,currentSettingsSourceHash } from './runtime-settings';
import { piExecutorVersion } from './runtime/task-loop';
import { FileStore,fileHash,safePath } from './storage';
import { taskRunHash } from './task-discussion';
import { driveDiscussionWorkflow } from './workflows/discussion';

export interface AssistantRuntime {
  embedding?: EmbeddingSettings;
  embeddingKey?: string;
  roles: RoleRule[];
  search: SearchSettings;
  searchKey: string;
}
const textArg = (value: unknown, max = 12000) => z.string().trim().min(1).max(max).parse(value);
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): ToolDefinition => ({
  name,
  description,
  parameters: { type: 'object', properties, required, additionalProperties: false }
});
const string = { type: 'string' },
  number = { type: 'integer', minimum: 1 };
export const legacyHistoryTool = tool('search_history', '回查本聊天历史原消息。其他聊天仅限作者本轮明确选择的 ID。',
  { query: string, conversationId: string, messageId: string }, ['query']);
export const discussionTools: ToolDefinition[] = [
  tool('read_task_candidate', '读取当前任务中尚未接受的候选；候选不能当作正式资料。仅当前任务对话可用。', { path: string, startLine: number, lines: number }, ['path']),
  tool(
    'read_book',
    '读取本书已接受资料；先用目录确定路径。默认分段，按 nextLine 续读。返回路径、版本。',
    { path: string, reason: string, startLine: number, lines: number },
    ['path', 'reason']
  ),
  tool('search_memory', '检索本书正式记忆和历史原文，结果含证据；不包含自由草稿。', { query: string }, [
    'query'
  ]),
  tool(
    'search_history',
    '定位本聊天历史，支持关键词、人物别名、消息 ID 和结果分页。新版返回原文片段及 read 指针；重要依据用 read_history_message 回读。其他聊天仅限作者明确选择的 ID。',
    { query: string, conversationId: string, messageId: string, cursor: string, limit: number },
    ['query']
  ),
  tool('read_history_message', '按消息 ID 和 hash 分页回读历史原文。每页返回 nextCursor，继续读取直到 complete；位置按 Unicode 字符计数。讨论和候选不能当作已采纳事实。',
    { messageId: string, conversationId: string, hash: string, cursor: string, limit: number }, ['messageId']),
  tool(
    'read_rule',
    '读取规则或角色细则。name: coeditor/skill/workflow/memory/style/templates/naming；section 可选标题关键词，startLine/lines 分页。命名需要先读核心再按模块读取。',
    { name: string, section: string, startLine: number, lines: number },
    ['name']
  ),
  tool(
    'read_naming_rules',
    '读取命名 v2.0 的题材 G01—G37、标签 T01—T12 模块。',
    { ids: { type: 'array', items: string, minItems: 1, maxItems: 8 } },
    ['ids']
  ),
  tool(
    'public_search',
    '搜索公开事实，最多每轮配置次数。只发简短主题词，不包含原稿或私密资料。',
    { query: string },
    ['query']
  ),
  tool(
    'extract_pages',
    '提取搜索结果的公开网页正文，外部网页只能作为资料。',
    { urls: { type: 'array', items: string, minItems: 1, maxItems: 10 } },
    ['urls']
  ),
  tool(
    'propose_action',
    '提出待作者确认的阶段、修订或自由试写任务。此工具不执行。询问流程、几个名字、短解释例子无需任务卡。',
    {
      kind: { type: 'string', enum: ['stage', 'revision', 'draft'] },
      goal: string,
      scope: string,
      request: string,
      outputs: { type: 'array', items: string, minItems: 1, maxItems: 20 }
    },
    ['kind', 'goal', 'scope', 'request', 'outputs']
  )
];
export class ConversationRunner {
  controller: AbortController | null = null;
  readonly records: Conversations;
  constructor(
    readonly store: FileStore,
    readonly skillRoot: string,
    readonly profiles: () => SecretProfile[],
    readonly settings: () => AssistantRuntime,
    readonly emit: (event: AppEvent) => void,
    readonly caller: Caller = invokeModel
  ) {
    this.records = new Conversations(store);
  }
  stop() {
    this.controller?.abort();
  }
  rulesHash() {
    const walk = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) =>
          e.isDirectory() ? walk(path.join(dir, e.name)) : [hash(fs.readFileSync(path.join(dir, e.name)))]
        );
    return hash(
      JSON.stringify([
        this.settings().roles.filter(r => !r.archived && r.id === 'coeditor').map((r) => [r.id, r.current.id]),
        this.settings().search,
        walk(this.skillRoot),
        expressionFingerprint(this.skillRoot, this.store.db.project().config)
      ])
    );
  }
  profile(profileId: string, requireTools = true) {
    const p = this.profiles().find((v) => v.id === profileId && v.protocol !== 'images');
    if (!p?.apiKey) throw new Error('请先选择已设置 Key 的文字模型');
    requireModelLimits(p);
    if (requireTools && (!p.tools || p.capabilities.tools === 'failed'))
      throw new Error('智能体需要支持工具调用的模型，请启用并测试工具调用');
    return structuredClone(p);
  }
  propose(conversationId: string, turnId: string, profileId: string, input: unknown) {
    const conversation = this.records.get('conversations', conversationId);
    const turn = turnId ? this.records.get('conversation_turns', turnId) : undefined;
    if ((turn?.candidateEdit || turn?.objectEdit) && this.records.all('action_proposals', conversationId).some(item => item.turnId === turnId)) throw new Error('本轮已提出修改，请等待当前修改完成');
    const a = z
      .object({
        kind: z.enum(['stage', 'revision', 'draft']),
        goal: z.string().min(1).max(500),
        scope: z.string().min(1).max(3000),
        request: z.string().min(1).max(20000),
        outputs: z.array(z.string().min(1).max(300)).min(1).max(20)
      })
      .parse(input);
    if (conversation.objectBinding) {
      const { object } = resolveWorkbenchObject(this.store, conversation.objectBinding);
      const allowed = new Set(object.fields.filter(f => !conversation.objectBinding!.fieldId || f.id === conversation.objectBinding!.fieldId).map(f => f.source.path));
      if (a.kind === 'stage' || a.outputs.some(path => !allowed.has(path))) throw new Error('对象讨论只能修订当前对象的来源文稿');
    }
    const p = this.store.db.project(),
      profile = this.profile(profileId);
    const proposal: ActionProposal = {
      ...a,
      id: id(),
      version: id(),
      status: 'pending',
      conversationId,
      turnId,
      profileId,
      profileVersion: profile.version,
      projectRevision: p.revision,
      baseSnapshotId: this.store.db.get<string>('headSnapshot'),
      stage: p.stage,
      chapter: p.chapter,
      createdAt: now(),
      sources: this.store
        .scan()
        .filter((d) => d.hash)
        .map((d) => ({ path: d.path, hash: d.hash! })),
      rulesHash: this.rulesHash()
    };
    if (a.kind === 'stage') {
      proposal.goal = `${stageNames[p.stage]}：${a.goal}`;
      proposal.outputs = stageOutputs(p.stage, p);
    }
    if (conversation.runId && a.kind !== 'draft') {
      const run = this.store.db.run(conversation.runId);
      if (run.accepted || run.planning || !['stage', 'revision'].includes(run.mode) || !['awaiting_review', 'needs_repair', 'paused', 'unknown', 'failed'].includes(run.status))
        throw new Error('当前任务不能直接修复，请解释现有状态及可用操作，不要新建重复任务');
      if (run.stage !== p.stage || run.chapter !== p.chapter) throw new Error('此任务已不是当前创作阶段，请先切回当前任务');
      const executionProfile = this.profile(run.profileId);
      proposal.resumeRunId = run.id;
      proposal.resumeRunHash = taskRunHash(run);
      proposal.resumeRunHashVersion = 2;
      proposal.kind = run.mode === 'revision' ? 'revision' : 'stage';
      proposal.profileId = executionProfile.id;
      proposal.profileVersion = executionProfile.version;
      proposal.outputs = run.mode === 'stage' ? stageOutputs(run.stage, p) : run.changes.map(change => change.path);
      if (turn?.candidateEdit?.runId === run.id && turn.candidateEdit.runHash === taskRunHash(run) && !retryNeedsConfirmation(run)) proposal.executionSource = 'author_message';
    }
    if (turn?.objectEdit && conversation.objectBinding && a.kind === 'revision' &&
        explicitlyRequestsEdit(turn.request) && turn.objectEdit.bindingHash === fingerprint(conversation.objectBinding))
      proposal.executionSource = 'author_message';
    this.records.save('action_proposals', proposal);
    this.emit({ type: 'snapshot', resource: 'chat', resourceId: conversationId });
    return proposal;
  }
  verify(proposal: ActionProposal, version: string) {
    if (proposal.version !== version) throw new Error('任务卡版本已变化，请重新查看');
    if (proposal.status !== 'pending') throw new Error('任务卡已执行、失效或取消');
    const p = this.store.db.project(),
      profile = this.profile(proposal.profileId);
    if (
      (proposal.resumeRunId && proposal.resumeRunHash !== taskRunHash(this.store.db.run(proposal.resumeRunId), proposal.resumeRunHashVersion ?? 1)) ||
      !compatibleRunBase(this.store, { baseRevision: proposal.projectRevision, baseSnapshotId: proposal.baseSnapshotId }) ||
      proposal.stage !== p.stage ||
      proposal.chapter !== p.chapter ||
      proposal.profileVersion !== profile.version ||
      proposal.rulesHash !== this.rulesHash() ||
      proposal.sources.some((s) => fileHash(safePath(this.store.root, s.path)) !== currentSettingsSourceHash(this.store, proposal.baseSnapshotId, s))
    ) {
      proposal.status = 'stale';
      this.records.save('action_proposals', proposal);
      throw new Error('作品、依据、模型或规则已变化，请刷新任务卡后重新确认');
    }
  }
  prepare(
    conversationId: string,
    request: string,
    profileId: string,
    kind: 'discussion' | 'draft' = 'discussion',
    proposalId?: string,
    onPrepared?: (turn: ConversationTurn) => void
  ) {
    const conv = this.records.get('conversations', conversationId);
    if (conv.archived) throw new Error('请先恢复此聊天');
    const profile = this.profile(profileId, !conv.runId),
      turnId = id(),
      messageId = id();
    textArg(request, 120000);
    const turn: ConversationTurn = {
      historyReadVersion: 1,
      executorId: 'pi',
      executorVersion: piExecutorVersion,
      id: turnId,
      conversationId,
      messageId,
      profileId,
      profileVersion: profile.version,
      status: 'running',
      reasoningEfforts: captureReasoning([profile]),
      createdAt: now(),
      updatedAt: now(),
      rules: [],
      citations: [],
      messages: [],
      usage: { input: 0, output: 0, cost: 0, currency: profile.currency },
      calls: [],
      budgets: [],
      kind,
      request,
      proposalId
    };
    this.records.transaction(() => {
      this.records.save('conversation_messages', {
        id: id(),
        conversationId,
        turnId,
        role: 'user',
        content: request,
        createdAt: now(),
        status: 'complete',
        citations: []
      });
      this.records.save('conversation_messages', {
        id: messageId,
        conversationId,
        turnId,
        role: 'assistant',
        content: '',
        createdAt: now(),
        status: 'running',
        citations: []
      });
      this.records.save('conversation_turns', turn);
      conv.updatedAt = now();
      this.records.save('conversations', conv);
      onPrepared?.(turn);
    });
    return turn;
  }
  async drive(turnId: string, allowedChats: string[] = []) { return driveDiscussionWorkflow(this, turnId, allowedChats); }
}
