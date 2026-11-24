import { z } from 'zod';
import { ApplicationError } from '../../shared/errors';
import { recoveryDecision } from '../../shared/recovery';
import { retryNeedsConfirmation } from '../../shared/run-presentation';
import { modelRoundLimit, type Command } from '../../shared/types';
import { hash, prosePath } from '../domain';
import { upgradesChapterNaming } from '../chapter-naming';
import { compatibleRunBase } from '../runtime-settings';
import { authorizeUnknownAttempts } from '../runtime/model-gateway';
import { receivedProse } from '../runtime/prose-checkpoint';
import { prepareAuthorRevision, prepareRunRecovery } from '../runtime/run-recovery';
import { setRunStatus } from '../runtime/run-state';
import type { Service } from '../service';
import { hasSavedDirectionCheckpoint } from '../tag-planning';
import { upgradesVolumeNaming } from '../volume-market-research';

const str = (value: unknown) => z.string().min(1).parse(value);
export const runCommands = new Set<Command>([
  'run.start', 'run.cancel', 'terminal.cancel', 'run.recover', 'run.handoff',
  'run.resume', 'run.answer', 'run.permission', 'run.discard', 'run.update'
]);

type RunHost = Pick<Service, 'require' | 'executor' | 'chat' | 'coverController' | 'launch' |
  'makeRun' | 'rebuildRun' | 'needsMemoryRepair' | 'startMemoryRepair' | 'cancelQueued' | 'presentRun'>;

export function handleRunCommand(host: RunHost, command: Command, a: Record<string, unknown>) {
  const { s, p, runner } = host.require();
  if (command === 'run.start') {
    if (p.finished && a.mode !== 'revision') throw new Error('当前全书计划已完成');
    if (a.mode !== 'revision' && host.needsMemoryRepair(str(a.request), typeof a.profileId === 'string' ? a.profileId : undefined))
      return host.startMemoryRepair(typeof a.profileId === 'string' ? a.profileId : undefined);
    if (
      s.db
        .runs()
        .some(
          (r) => r.mode === 'stage' && !r.accepted && !['discarded', 'stale', 'failed'].includes(r.status)
        )
    )
      throw new Error('已有阶段任务，请继续、审阅或放弃后再开始');
    const r = host.makeRun(
      a.mode === 'revision' ? 'revision' : 'stage',
      str(a.request),
      typeof a.profileId === 'string' ? a.profileId : undefined
    );
    return host.launch(r);
  }
  if (command === 'run.cancel' || command === 'terminal.cancel') {
    if (host.cancelQueued('run')) return true;
    const active = s.db.runs().find((run) => run.status === 'running');
    if (active) host.executor!.requestControl(active.id, 'cancel');
    else runner.stop();
    return true;
  }
  if (command === 'run.recover') {
    if (runner.controller || host.chat?.controller || host.coverController) throw new Error('请先停止当前任务');
    let r = s.db.run(str(a.id));
    host.executor!.restore({ runId: r.id, executorId: r.executorId ?? 'legacy', executorVersion: r.executorVersion ?? '1', checkpointVersion: r.checkpointVersion ?? 1 });
    if (r.accepted || !['paused', 'unknown', 'needs_repair', 'awaiting_review', 'failed', 'stale'].includes(r.status)) throw new Error('当前任务不需要恢复，请处理当前待确认事项');
    const decision = recoveryDecision(r);
    if (decision.confirmation && a.retryUnknown !== true) throw new ApplicationError('REMOTE_RESULT_UNKNOWN', '上次请求结果与费用未知，核对后确认才能重新请求', ['authorize_attempt']);
    if (decision.kind === 'inspect' || decision.kind === 'author') throw new ApplicationError(decision.code, decision.detail, ['refresh']);
    if (decision.confirmation && a.retryUnknown === true) authorizeUnknownAttempts(s, r);
    const instruction = typeof a.instruction === 'string' ? a.instruction.trim() : '';
    if (r.creative) {
      if (instruction) throw new Error('创作工具恢复只继续原范围，修改范围请从创作工具建立新任务');
      const profileId = typeof a.profileId === 'string' && a.profileId ? a.profileId : r.profileId;
      const completed = s.db.sql.prepare("SELECT 1 FROM model_attempts WHERE run_id=? AND status='complete'").get(r.id);
      if (profileId !== r.profileId || !compatibleRunBase(s, r) || decision.confirmation && !completed)
        r = host.rebuildRun(r, profileId);
      return host.launch(r);
    }
    if (r.planning && instruction) throw new ApplicationError('VALIDATION_ERROR', '修改策划想法请使用方案页；恢复任务继续当前已确认的输入');
    if (!instruction && runner.recoverReadyCandidate(r, p, 'continue')) return r.id;
    // Completing an old direction-review checkpoint needs no model/tool call.
    // The executor still validates the saved report and current source binding.
    if (!hasSavedDirectionCheckpoint(r) && !receivedProse(s, r)) {
      if (r.rounds >= modelRoundLimit(p.config.maxRounds)) throw new ApplicationError('ROUND_LIMIT', '已达到模型调用上限，请在运行配置中提高上限后恢复');
      if (r.toolCount >= p.config.maxTools) throw new ApplicationError('TOOL_LIMIT', '已达到工具调用上限，请在运行配置中提高上限后恢复');
    }
    const profileId = typeof a.profileId === 'string' && a.profileId ? a.profileId : r.profileId;
    if (profileId !== r.profileId || runner.needsFreshContext(r) || upgradesVolumeNaming(r, instruction) || upgradesChapterNaming(r, instruction)) {
      r = host.rebuildRun(r, profileId, instruction);
      if (instruction) prepareAuthorRevision(r, '');
    }
    else if (instruction) prepareAuthorRevision(r, instruction);
    runner.check(r, p);
    if (!instruction) prepareRunRecovery(r);
    s.db.event(r.id, 'recovery-requested', '已检查恢复条件，将沿用已保存内容继续当前步骤', { code: decision.code, profileId, repairPaths: r.repairScope?.paths ?? [], confirmedUnknown: decision.confirmation });
    s.db.saveRun(r);
    return host.launch(r);
  }
  if (command === 'run.handoff') {
    if (runner.controller) throw new Error('请先停止任务');
    const old = s.db.run(str(a.id));
    if (old.accepted || old.status === 'discarded') throw new Error('此任务不能交接');
    if (retryNeedsConfirmation(old) && a.retryUnknown !== true)
      throw new Error('上次请求结果未知，须先核对收费请求');
    if (retryNeedsConfirmation(old) && a.retryUnknown === true) authorizeUnknownAttempts(s, old);
    const r = host.rebuildRun(old, str(a.profileId), typeof a.instruction === 'string' ? a.instruction : '');
    return host.launch(r);
  }
  if (command === 'run.resume' || command === 'run.answer' || command === 'run.permission') {
    const r = s.db.run(str(a.id));
    host.executor!.restore({ runId: r.id, executorId: r.executorId ?? 'legacy', executorVersion: r.executorVersion ?? '1', checkpointVersion: r.checkpointVersion ?? 1 });
    if (r.accepted || r.status === 'discarded') throw new Error('此任务不能恢复');
    if (retryNeedsConfirmation(r) && a.retryUnknown !== true)
      throw new Error('上次请求结果与费用未知，需明确选择重新请求');
    if (retryNeedsConfirmation(r) && a.retryUnknown === true) authorizeUnknownAttempts(s, r);
    if (r.creative && typeof a.instruction === 'string' && a.instruction.trim())
      throw new Error('创作工具恢复只继续原阅读范围和输入，修改范围请建立新任务');
    if (r.creative && a.retryUnknown === true && retryNeedsConfirmation(r) &&
        !s.db.sql.prepare("SELECT 1 FROM model_attempts WHERE run_id=? AND status='complete'").get(r.id))
      return host.launch(host.rebuildRun(r, r.profileId));
    if (r.planning && typeof a.instruction === 'string' && a.instruction.trim())
      throw new Error('策划输入变更请在标签与策划中保存，或使用方向局部重做；恢复只继续已绑定的输入');
    if (command === 'run.resume') {
      if (!['paused', 'unknown', 'needs_repair', 'awaiting_review', 'failed', 'stale'].includes(r.status)) throw new Error('请先处理当前待回答或待授权的事项');
      if (!String(a.instruction ?? '').trim() && runner.recoverReadyCandidate(r, p, 'continue')) return r.id;
      if (runner.needsFreshContext(r) || upgradesVolumeNaming(r, String(a.instruction ?? '')) || upgradesChapterNaming(r, String(a.instruction ?? '')))
        return host.launch(host.rebuildRun(r, r.profileId, typeof a.instruction === 'string' ? a.instruction : ''));
    }
    if (command === 'run.answer') {
      if (!r.input) throw new Error('任务没有待回答问题');
      r.input.answer = str(a.answer);
      if (runner.needsFreshContext(r)) {
        s.db.saveRun(r);
        return host.launch(host.rebuildRun(r, r.profileId, `作者已回答待确认问题：${r.input.question}\n回答：${r.input.answer}`));
      }
    }
    if (command === 'run.permission') {
      if (!r.permission) throw new Error('没有待批准动作');
      r.permission.status = a.approved === true ? 'approved' : 'denied';
      if (runner.needsFreshContext(r)) {
        s.db.saveRun(r);
        return host.launch(host.rebuildRun(r, r.profileId, `先前待确认动作：${JSON.stringify(r.permission)}。上下文已改变，不能直接执行旧动作；如仍需执行，提出当前具体动作重新确认。`));
      }
    }
    if (typeof a.instruction === 'string' && a.instruction.trim()) {
      if (r.messages.length) r.messages.push({ role: 'user', content: a.instruction });
      else r.request += `\n\n作者补充：${a.instruction}`;
      r.candidateWrites = {};
    }
    return host.launch(r);
  }
  if (command === 'run.discard') {
    const r = s.db.run(str(a.id));
    if (r.accepted || runner.controller) throw new Error('请先停止，已接受的版本请通过修订恢复');
    setRunStatus(r, 'discarded');
    s.db.saveRun(r);
    return true;
  }
  if (command === 'run.update') {
    const r = s.db.run(str(a.id));
    if (r.accepted || runner.controller) throw new Error('此时不能修改候选');
    if (r.planning) throw new Error('结构化策划候选需在标签与策划中修改输入后重新审核');
    const at = r.changes.findIndex((c) => c.path === str(a.path));
    if (at < 0) throw new Error('候选不存在');
    if (a.expectedHash && hash(r.changes[at].content) !== a.expectedHash) throw new Error('候选已更新，请核对最新正文后再保存。');
    r.changes[at].content = z.string().parse(a.content);
    if (r.pipeline && r.changes[at].path === prosePath(r.chapter)) {
      const previousProseHash = r.pipeline.proseHash;
      const previousRepairAttempts = structuredClone(r.repairAttempts);
      runner.telemetry.invalidate(r.id);
      r.pipeline.phase = 'review';
      r.pipeline.proseHash = hash(r.changes[at].content);
      r.pipeline.version++;
      r.sourceProseHash = r.pipeline.proseHash;
      r.messages = [];
      r.facts = [];
      r.candidateWrites = {};
      r.repairScope = undefined;
      r.memoryReview = undefined;
      r.memoryCompletionHash = undefined;
      r.chapterCoverage = undefined;
      r.futurePlanReview = undefined;
      r.proseReviewFeedback = undefined;
      // The author supplied a new prose version, so old per-version repair
      // scopes/receipts no longer apply. Task-wide rounds, tools and usage stay.
      for (const phase of ['prose', 'review', 'memory']) if (r.repairAttempts) delete r.repairAttempts[phase];
      r.changes = [r.changes[at]];
      s.db.event(r.id, 'candidate-prose-edited', '作者修改正文候选；旧审核与章后证据失效，保留累计轮数、工具数及用量，重新审核当前稿。', {
        previousProseHash, proseHash: r.pipeline.proseHash, previousRepairAttempts,
        rounds: r.rounds, toolCount: r.toolCount
      });
    }
    runner.check(r, p);
    setRunStatus(r, r.issues.some((i) => i.severity === 'error') ? 'needs_repair' : 'awaiting_review');
    s.db.saveRun(r);
    return host.presentRun(r, true);
  }
  throw new Error('不支持的创作任务操作');
}
