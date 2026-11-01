import { z } from 'zod';
import { workbenchDiscussionContext, resolveWorkbenchObject } from '../workbench';
import { bindWorkbenchCandidate } from '../workbench-candidates';
import { retryNeedsConfirmation } from '../../shared/run-presentation';
import { needsNewChapterCandidate } from '../../shared/task-revision';
import { type Command } from '../../shared/types';
import { hash, now, prosePath, stageNames } from '../domain';
import { prepareAuthorRevision } from '../runtime/run-recovery';
import type { Service } from '../service';
import { taskRunHash } from '../task-discussion';
import { upgradesVolumeNaming } from '../volume-market-research';
import { explicitlyRequestsEdit } from '../../shared/author-intent';
import { fingerprint } from '../runtime/canonical';
const str = (v: unknown) => z.string().min(1).parse(v);

export const discussionCommands = new Set<string>([
  'chat.list',
  'chat.create',
  'chat.update',
  'chat.read',
  'chat.page',
  'chat.stop',
  'chat.send',
  'chat.retry',
  'run.discuss',
  'proposal.create',
  'proposal.cancel',
  'proposal.refresh',
  'proposal.confirm',
  'draft.list',
  'draft.read',
  'draft.fork',
  'draft.merge',
  'draft.save',
  'draft.promote',
  'draft.chapter'
]);
type Host = Pick<
  Service,
  | 'chat'
  | 'require'
  | 'assistant'
  | 'operations'
  | 'projectSessionId'
  | 'track'
  | 'scheduler'
  | 'executor'
  | 'store'
  | 'draining'
  | 'invoke'
  | 'emit'
  | 'rebuildRun'
  | 'launch'
  | 'makeRun'
  | 'needsMemoryRepair'
>;

export async function handleDiscussionCommand(
  host: Host,
  command: Command,
  a: Record<string, unknown>,
  idle: () => void
): Promise<unknown> {
  const { s, p, runner } = host.require();
  const chat = host.chat!,
    records = chat.records;
  if (command === 'chat.list') return records.all('conversations');
  if (command === 'chat.create')
    return records.create(typeof a.title === 'string' ? a.title : '创作讨论', host.assistant.search.enabled);
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
  if (command === 'chat.page')
    return records.page(
      str(a.id),
      typeof a.before === 'number' ? a.before : undefined,
      typeof a.watermark === 'number' ? a.watermark : undefined,
      typeof a.limit === 'number' ? a.limit : 100
    );
  if (command === 'chat.stop') {
    chat.stop();
    return true;
  }
  if (command === 'chat.send' || command === 'chat.retry' || command === 'run.discuss') {
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
    let conversationId =
      old?.conversationId ?? (typeof a.conversationId === 'string' ? a.conversationId : '');
    if (command === 'run.discuss') {
      const task = s.db.run(str(a.id));
      z.string().trim().min(1).parse(a.text);
      chat.profile(typeof a.profileId === 'string' ? a.profileId : p.config.defaultProfileId, false);
      conversationId = (
        records
          .all('conversations')
          .find((conversation) => conversation.runId === task.id && !conversation.archived) ??
        records.create(`${stageNames[task.stage]} · 任务对话`, false, task.id)
      ).id;
    }
    const objectBinding = records.get('conversations', conversationId).objectBinding;
    if (objectBinding) workbenchDiscussionContext(s, objectBinding);
    const turn = chat.prepare(
      conversationId,
      old?.request ?? str(a.text),
      typeof a.profileId === 'string' ? a.profileId : (old?.profileId ?? p.config.defaultProfileId),
      'discussion',
      undefined,
      (prepared) => {
        if (objectBinding && explicitlyRequestsEdit(prepared.request))
          prepared.objectEdit = { bindingHash: fingerprint(objectBinding) };
        prepared.displayedError =
          old?.displayedError ?? (typeof a.displayedError === 'string' ? a.displayedError : undefined);
        if ((command === 'run.discuss' && a.allowCandidateEdits === true) || old?.candidateEdit) {
          const task = s.db.run(old?.candidateEdit?.runId ?? str(a.id));
          if (
            (!old?.candidateEdit || old.candidateEdit.runHash === taskRunHash(task)) &&
            !task.accepted &&
            !task.planning &&
            !task.naming &&
            !task.memoryRepair &&
            ['stage', 'revision'].includes(task.mode) &&
            ['awaiting_review', 'needs_repair'].includes(task.status) &&
            !retryNeedsConfirmation(task)
          )
            prepared.candidateEdit = { runId: task.id, runHash: taskRunHash(task) };
        }
        records.save('conversation_turns', prepared);
        host.operations.complete(prepared.id);
      }
    );
    const session = host.projectSessionId;
    void host.track(
      host.scheduler
        .run(turn.id, ['foreground'], 10, () =>
          host.executor!.execute({ id: turn.id, kind: 'conversation', referenceChats: allowed })
        )
        .then(async () => {
          if (host.store !== s || host.projectSessionId !== session || host.draining) return;
          const finished = records.get('conversation_turns', turn.id);
          if (finished.status !== 'complete' || !(finished.candidateEdit || finished.objectEdit)) return;
          const proposed = records
            .all('action_proposals', turn.conversationId)
            .filter(
              (proposal) =>
                proposal.turnId === turn.id &&
                proposal.executionSource === 'author_message' &&
                proposal.status === 'pending'
            );
          if (proposed.length !== 1) return;
          const proposal = proposed[0];
          try {
            // Separate idempotency receipt: never replace the conversation's operation result.
            await host.invoke(
              'proposal.confirm',
              { id: proposal.id, version: proposal.version },
              { operationId: `candidate-edit:${turn.id}`, projectSessionId: session }
            );
          } catch (error) {
            const current = records.get('action_proposals', proposal.id);
            current.executionError = (error as Error).message;
            records.save('action_proposals', current);
            host.emit({ type: 'snapshot', resource: 'chat', resourceId: turn.conversationId });
          }
        })
    );
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
    if (proposal.resumeRunId) {
      let current = s.db.run(proposal.resumeRunId);
      if (
        current.accepted ||
        current.planning ||
        !['awaiting_review', 'needs_repair', 'paused', 'unknown', 'failed'].includes(current.status)
      )
        throw new Error('任务状态已变化，请重新讨论修复方案');
      if (retryNeedsConfirmation(current) && a.retryUnknown !== true)
        throw new Error('上次请求结果与费用未知，需明确选择重新请求');
      host.executor!.restore({
        runId: current.id,
        executorId: current.executorId ?? 'legacy',
        executorVersion: current.executorVersion ?? '1',
        checkpointVersion: current.checkpointVersion ?? 1
      });
      const newCandidate = needsNewChapterCandidate(current, p.config);
      if (!newCandidate && (current.rounds >= p.config.maxRounds || current.toolCount >= p.config.maxTools))
        throw new Error('已达到当前任务调用上限，请先在运行设置中调整限额');
      const instruction = `${proposal.request}\n范围：${proposal.scope}`;
      records.transaction(() => {
        if (newCandidate) current = host.rebuildRun(current, proposal.profileId, instruction, true);
        else if (runner.needsFreshContext(current) || upgradesVolumeNaming(current, instruction)) {
          current = host.rebuildRun(current, proposal.profileId, instruction);
          prepareAuthorRevision(current, '');
        } else prepareAuthorRevision(current, instruction);
        s.db.saveRun(current);
        proposal.status = 'executed';
        proposal.executionId = current.id;
        records.save('action_proposals', proposal);
        host.operations.complete({ kind: proposal.kind, id: current.id });
      });
      host.launch(current, { kind: proposal.kind, id: current.id });
      return { kind: proposal.kind, id: current.id };
    }
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
          host.operations.complete({ kind: 'draft', id: prepared.id });
        }
      );
      void host.track(
        host.scheduler.run(turn.id, ['foreground'], 10, () =>
          host.executor!.execute({ id: turn.id, kind: 'conversation' })
        )
      );
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
    const r = host.makeRun(proposal.kind, `${proposal.request}\n范围：${proposal.scope}`, proposal.profileId);
    r.conversationId = proposal.conversationId;
    const binding = records.get('conversations', proposal.conversationId).objectBinding;
    if (binding) {
      const { object } = resolveWorkbenchObject(s, binding);
      const fields = object.fields.filter(f => !binding.fieldId || f.id === binding.fieldId);
      const editable = fields.filter(f => f.editable && !f.locked);
      if (binding.fieldId && !editable.length) throw new Error('此字段已固定或只能通过来源修订');
      const metadata = bindWorkbenchCandidate(s, r, 'field', [object.id], editable.length === fields.length ? editable.map(f => ({ objectId: object.id, fieldId: f.id, path: f.source.path })) : undefined);
      metadata.sourceHashes = Object.fromEntries(fields.map(f => [f.source.path, f.source.hash]));
      metadata.groups[0].paths = [...new Set(fields.map(f => f.source.path))];
      r.request += `\n仅修改所选${binding.fieldId ? '字段' : '对象'}，保留其他字段、行、标题与格式。当前对象：${workbenchDiscussionContext(s, binding)}`;
    }
    records.transaction(() => {
      s.db.saveRun(r);
      proposal.status = 'executed';
      proposal.executionId = r.id;
      records.save('action_proposals', proposal);
      host.operations.complete({ kind: proposal.kind, id: r.id });
    });
    host.launch(r, { kind: proposal.kind, id: r.id });
    return { kind: proposal.kind, id: r.id };
  }
  if (command === 'draft.list') return records.all('draft_artifacts');
  if (command === 'draft.fork') {
    idle();
    const draft = records.readDraft(str(a.id), str(a.hash));
    return records.saveDraft({ title: str(a.title), content: draft.content, conversationId: draft.conversationId, messageId: draft.messageId, parent: { id: draft.id, hash: draft.currentHash } });
  }
  if (command === 'draft.merge') {
    idle();
    const draft = records.readDraft(str(a.id));
    if (draft.currentHash !== a.hash) throw new Error('草稿已改变，请重新读取');
    const chapter = Number(a.chapter), file = prosePath(chapter), current = s.db.document(file)?.hash ?? null;
    if (current !== a.baseHash || current && s.inspect(file)?.status !== 'accepted') throw new Error('目标正文已改变，请重新读取');
    const run = host.makeRun('manual', `合并草稿：${draft.title}`);
    const content = a.mode === 'append' && current ? s.readAccepted(file).content + '\n\n' + draft.content : draft.content;
    run.changes = [{ path: file, content, baseHash: current }];
    run.continuity = { mode: 'retcon', fromChapter: chapter };
    run.conversationId = draft.conversationId;
    s.db.saveRun(run);
    return run.id;
  }
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
  if (command === 'draft.chapter') {
    idle();
    if (p.finished || p.stage !== 'S10') throw new Error('当前尚未进入正文写作阶段，草稿已保留');
    if (s.db.runs().some(run => run.mode === 'stage' && !run.accepted && !['discarded', 'stale', 'failed'].includes(run.status)))
      throw new Error('已有章节任务，请先审阅、恢复或放弃');
    const draft = records.readDraft(str(a.id));
    if (draft.currentHash !== str(a.hash)) throw new Error('草稿已变化，请重新读取再核对');
    const request = `将作者选定的草稿《${draft.title}》作为本章正文候选，保留原文并完成审稿、章后记忆和人物覆盖；来源 ${draft.path} @ ${draft.currentHash}`;
    if (host.needsMemoryRepair(request, str(a.profileId))) throw new Error('当前资料尚需记忆同步，请完成核对后再使用草稿');
    const run = host.makeRun('stage', request, str(a.profileId));
    const file = prosePath(p.chapter);
    run.conversationId = draft.conversationId;
    run.changes = [{ path: file, content: draft.content, baseHash: s.db.document(file)?.hash ?? null }];
    run.sourceProseHash = hash(draft.content);
    run.pipeline = { ...run.pipeline!, phase: 'review', proseHash: run.sourceProseHash, version: 1 };
    return host.launch(run);
  }
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

  throw new Error('不支持此领域命令');
}
