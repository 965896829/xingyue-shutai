import { z } from 'zod';
import { approvedCreation, type TitleSelection } from '../../shared/creation';
import { bookProfilePath, publishingResearchSpec } from '../publishing';
import { retryNeedsConfirmation } from '../../shared/run-presentation';
import { type Command } from '../../shared/types';
import { hash, now, paths, renderProgress, updateConfigDocument } from '../domain';
import { samePath } from '../recycle-bin';
import { ProjectCommitService } from '../runtime/commit-kernel';
import { setRunStatus } from '../runtime/run-state';
import type { Service } from '../service';
import { renderIndex } from '../skill';
import { fileHash, proposalHash, safePath } from '../storage';
import { resolveStoryImpacts } from '../story-impact';
import {
  contractPath,
  currentCreationDraft,
  makeBookSpec,
  makeCreationSpec,
  planCandidateHash,
  planningBinding,
  renderContract,
  tagHash,
  tagImpact,
  validateReport
} from '../tags';
import {
  assertTitleSelection,
  namingBinding,
  renderTitle,
  titlePath,
  titleSource,
  validateBookTitle
} from '../title-naming';
const str = (v: unknown) => z.string().min(1).parse(v);

export const creationCommands = new Set<string>([
  'tags.saveDraft',
  'creation.saveDraft',
  'tags.start',
  'creation.start',
  'creation.confirmPlan',
  'creation.revisePlan',
  'titles.restoreProjection',
  'titles.start',
  'titles.regenerate',
  'titles.select',
  'tags.reroll',
  'tags.selectDirection',
  'tags.reviseDirection',
  'tags.diff',
  'tags.restoreProjection'
]);
type Host = Pick<
  Service,
  'require' | 'skillRoot' | 'tagCatalog' | 'makeRun' | 'initializePlanning' | 'launch' | 'emit' | 'change' | 'recent'
>;

export async function handleCreationCommand(
  host: Host,
  command: Command,
  a: Record<string, unknown>,
  idle: () => void
): Promise<unknown> {
  const { s, p, runner } = host.require();
  if (command === 'tags.saveDraft' || command === 'creation.saveDraft') {
    idle();
    const prior = currentCreationDraft(s);
    if (a.expectedRevision !== (prior?.revision ?? 0)) throw new Error('标签输入已由另一个窗口修改，请刷新');
    const draft = (
      command === 'creation.saveDraft' || p.creationWorkflow === 2 ? makeCreationSpec : makeBookSpec
    )(p, a.input, (prior?.revision ?? 0) + 1, host.tagCatalog());
    s.db.set('tagDraft', draft);
    s.db.set('tagDraftPublishingBase', s.db.document(bookProfilePath)?.hash ?? null);
    for (const r of s.db.runs())
      if (
        (r.planning || r.naming?.sourceRunId) &&
        !r.accepted &&
        !['discarded', 'stale', 'failed'].includes(r.status)
      ) {
        setRunStatus(r, 'stale');
        r.error = '标签或作者输入已更新，旧报告保留为历史';
        s.db.saveRun(r);
      }
    return draft;
  }
  if (command === 'tags.start' || command === 'creation.start') {
    const draft = currentCreationDraft(s);
    if (!draft || draft.inputHash !== a.inputHash) throw new Error('标签输入已改变，请刷新后开始');
    const requestId = z.string().min(1).max(100).parse(a.requestId);
    const fingerprint = tagHash({
      inputHash: draft.inputHash,
      profileId: a.profileId ?? '',
      request: a.request ?? ''
    });
    const old = s.db.get<{ id: string; fingerprint: string }>(`tagRequest:${requestId}`);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new Error('请求编号被用于不同输入');
      return old.id;
    }
    idle();
    if (
      s.db
        .runs()
        .some(
          (r) =>
            !r.accepted &&
            (r.planning || r.mode === 'stage') &&
            !['discarded', 'stale', 'failed'].includes(r.status)
        )
    )
      throw new Error('请先继续或放弃已有策划/阶段候选');
    const origin = approvedCreation(p) ? 'revision' : p.stage === 'S01' ? 'new' : 'adoption';
    const r = host.makeRun(
      origin === 'new' ? 'stage' : 'revision',
      typeof a.request === 'string' ? a.request : '依据标签和作者意图完成策划；旧书保持已接受内容',
      typeof a.profileId === 'string' ? a.profileId : undefined
    );
    host.initializePlanning(r, origin, command === 'creation.start' || p.creationWorkflow === 2);
    s.db.saveRun(r);
    s.db.set(`tagRequest:${requestId}`, { id: r.id, fingerprint });
    return host.launch(r);
  }
  if (command === 'creation.confirmPlan') {
    idle();
    const r = s.db.run(str(a.id));
    planningBinding(s, r);
    if (r.accepted || ['discarded', 'stale'].includes(r.status) || r.planning?.workflowVersion !== 2)
      throw new Error('不是当前待确认作品方案');
    runner.check(r, p);
    if (r.issues.some((v) => v.severity === 'error')) throw new Error('请先完成方案校验与独立审核');
    if (a.proposalHash !== proposalHash(r)) throw new Error('作品方案已改变，请重新查看');
    r.planning.planApproval = {
      hash: planCandidateHash(r),
      planHash: tagHash(r.planning.candidate!.plan),
      binding: r.planning.binding,
      at: now()
    };
    if (a.warningReason) s.db.event(r.id, 'plan-warning-review', String(a.warningReason));
    r.responseText = '作品方案已选定。选好书名后即可保存；已有书名的作品可以直接保存。';
    s.db.saveRun(r);
    return true;
  }
  if (command === 'creation.revisePlan') {
    idle();
    const r = s.db.run(str(a.id));
    planningBinding(s, r);
    const t = r.planning!;
    if (
      r.accepted ||
      !['awaiting_review', 'needs_repair'].includes(r.status) ||
      !t.candidate ||
      !['ready', 'reviewing_contract'].includes(t.phase)
    )
      throw new Error('请等待当前作品方案生成完成后再修改');
    if (a.proposalHash !== proposalHash(r)) throw new Error('作品方案已改变，请查看最新结果后再修改');
    if (retryNeedsConfirmation(r)) throw new Error('上次请求结果与费用未知，请先核对这次请求');
    if (r.rounds >= p.config.maxRounds || r.toolCount >= p.config.maxTools)
      throw new Error('已达到当前任务调用上限，请先在运行设置中调整限额');
    t.history.push({
      kind: 'author-revision',
      value: { candidate: structuredClone(t.candidate), instruction: str(a.instruction) }
    });
    t.authorRevision = { instruction: str(a.instruction), original: structuredClone(t.candidate) };
    t.phase = 'contract';
    t.planApproval = undefined;
    t.titleSelection = undefined;
    t.contractReview = undefined;
    t.promptHashes = {};
    t.repair = undefined;
    t.semanticRevisions = 0;
    t.consecutiveFormatFailures = 0;
    r.messages = [];
    r.candidateWrites = {};
    s.db.event(r.id, 'author-revision', '按作者意见修改当前作品方案，完成后自动检查', {
      instruction: a.instruction
    });
    s.db.saveRun(r);
    return host.launch(r);
  }
  if (command === 'titles.restoreProjection') {
    idle();
    if (!p.titleBinding) throw new Error('本书尚无正式命名记录');
    const actual = fileHash(safePath(s.root, titlePath));
    if (a.baseHash !== actual) throw new Error('书名展示文件再次改变，请刷新后恢复');
    const next = structuredClone(p);
    next.revision++;
    new ProjectCommitService(s).commit(
      [{ path: titlePath, content: renderTitle(p.titleBinding), baseHash: actual }],
      next
    );
    host.emit({ type: 'snapshot' });
    return true;
  }
  if (command === 'titles.start') {
    idle();
    const sourceRunId = typeof a.sourceRunId === 'string' ? a.sourceRunId : undefined;
    const source = titleSource(s, sourceRunId);
    const planHash = tagHash(source.plan);
    if (a.planHash !== planHash) throw new Error('作品方案已改变，请刷新后命名');
    const rule = a.rule === 'fanqie_experiment' ? 'fanqie_experiment' : 'local';
    const manualTitle =
      typeof a.manualTitle === 'string' ? validateBookTitle(a.manualTitle, rule) : undefined;
    const fingerprint = tagHash({
      sourceHash: source.sourceHash,
      profileId: a.profileId ?? '',
      rule,
      manualTitle,
      instruction: a.instruction ?? ''
    });
    const requestId = str(a.requestId),
      old = s.db.get<{ id: string; fingerprint: string }>(`titleRequest:${requestId}`);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new Error('请求编号被用于不同命名输入');
      return old.id;
    }
    const r = host.makeRun(
      'analysis',
      manualTitle ? '核对作者填写的书名与作品方案' : '依据已确认作品方案生成不同卖点的书名',
      typeof a.profileId === 'string' ? a.profileId : undefined
    );
    r.parentRunId = sourceRunId;
    r.naming = {
      sourceRunId,
      planHash,
      sourceHash: source.sourceHash,
      inputHash: source.inputHash,
      contractRevision: source.contractRevision,
      rule,
      manualTitle,
      instruction: String(a.instruction ?? ''),
      candidateCount: manualTitle ? 1 : 6,
      marketResearchVersion: (sourceRunId ? source.spec : publishingResearchSpec(s, source.spec)).bookProfile?.publishing ? 2 : 1,
      editorialVersion: 2,
      phase: 'generating',
      history: [],
      formatRepairs: 0,
      semanticRevisions: 0
    };
    s.db.saveRun(r);
    s.db.set(`titleRequest:${requestId}`, { id: r.id, fingerprint });
    return host.launch(r);
  }
  if (command === 'titles.regenerate') {
    idle();
    const r = s.db.run(str(a.id));
    namingBinding(s, r);
    const t = r.naming!;
    if (
      r.accepted ||
      ['stale', 'discarded'].includes(r.status) ||
      t.phase !== 'ready' ||
      a.batchHash !== tagHash(t.batch)
    )
      throw new Error('书名候选已改变或尚未完成审核');
    const candidateId = str(a.candidateId);
    if (!t.batch!.candidates.some((v) => v.id === candidateId)) throw new Error('书名候选不存在');
    t.history.push({ batch: structuredClone(t.batch!), review: t.review?.result });
    t.regenerate = { candidateId, instruction: str(a.instruction), original: structuredClone(t.batch!) };
    t.candidateCount = t.batch!.candidates.length;
    t.manualTitle = undefined;
    if (!t.marketResearchVersion) {
      t.marketResearchVersion = 1;
      r.skillHash = undefined;
    }
    if (t.editorialVersion !== 2) {
      t.editorialVersion = 2;
      r.skillHash = undefined;
    }
    t.phase = 'generating';
    t.review = undefined;
    r.messages = [];
    r.error = undefined;
    if (t.sourceRunId) {
      const parent = s.db.run(t.sourceRunId);
      if (parent.planning?.titleSelection?.batchRunId === r.id) {
        parent.planning.titleSelection = undefined;
        s.db.saveRun(parent);
      }
    }
    return host.launch(r);
  }
  if (command === 'titles.select') {
    idle();
    const r = s.db.run(str(a.id)),
      t = r.naming;
    if (!t?.batch || a.batchHash !== tagHash(t.batch)) throw new Error('书名候选已改变');
    const candidate = t.batch.candidates.find((v) => v.id === a.candidateId);
    if (!candidate) throw new Error('书名候选不存在');
    if (
      r.accepted &&
      p.titleBinding?.batchRunId === r.id &&
      p.titleBinding.candidate.id === candidate.id &&
      p.titleBinding.batchHash === a.batchHash
    )
      return { selected: true };
    const selection: TitleSelection = {
      candidate: structuredClone(candidate),
      batchRunId: r.id,
      batchHash: tagHash(t.batch),
      planHash: t.planHash,
      sourceHash: t.sourceHash,
      rule: t.rule,
      at: now()
    };
    assertTitleSelection(s, selection, t.sourceRunId, host.skillRoot);
    if (t.sourceRunId) {
      const parent = s.db.run(t.sourceRunId);
      const chosen = parent.planning!.titleSelection;
      if (
        chosen?.batchRunId === r.id &&
        chosen.batchHash === selection.batchHash &&
        chosen.candidate.id === candidate.id
      )
        return { selected: true, parentRunId: parent.id };
      parent.planning!.titleSelection = selection;
      parent.responseText = '方案与书名均已准备好，请统一采纳本阶段结果。';
      s.db.saveRun(parent);
      return { selected: true, parentRunId: parent.id };
    }
    const next = structuredClone(p);
    next.title = candidate.title;
    next.titlePending = false;
    next.titleBinding = { ...selection, needsReview: false };
    next.titleReviewRequired = false;
    next.revision++;
    next.stale = next.stale.filter((file) => file !== titlePath);
    resolveStoryImpacts(next, [titlePath]);
    const changes = [
      host.change(titlePath, renderTitle(next.titleBinding)),
      host.change(paths.config, updateConfigDocument(s.readAccepted(paths.config).content, next)),
      host.change(paths.progress, renderProgress(next)),
      host.change(
        paths.index,
        renderIndex(next, [...new Set([...s.db.acceptedDocuments().map((d) => d.path), titlePath])])
      )
    ];
    r.changes = changes;
    s.db.saveRun(r);
    r.accepted = true;
    setRunStatus(r, 'complete');
    new ProjectCommitService(s).commit(changes, next, r);
    host.recent = host.recent.map((item) =>
      samePath(item.root, next.root) ? { ...item, title: next.title } : item
    );
    host.emit({ type: 'snapshot' });
    return { selected: true };
  }
  if (command === 'tags.reroll') {
    idle();
    const r = s.db.run(str(a.id));
    planningBinding(s, r);
    const t = r.planning!;
    if (
      r.accepted ||
      ['discarded', 'stale'].includes(r.status) ||
      t.phase !== 'awaiting_direction' ||
      !t.report ||
      a.reportHash !== tagHash(t.report) ||
      t.reportHash !== tagHash(t.report)
    )
      throw new Error('三个方向已改变或尚未生成完成，请刷新后再生成');
    validateReport(t.report, t);
    const keepDirectionIds = z.array(z.string().min(1)).max(1).parse(a.keepDirectionIds);
    if (keepDirectionIds.some((value) => !t.report!.directions.some((direction) => direction.id === value)))
      throw new Error('要保留的方向不存在');
    const instruction =
      String(a.instruction ?? '').trim() ||
      (keepDirectionIds.length
        ? '完整保留指定方向，重新设计另外两个机制不同的方案。'
        : '保留作者的必须保留项与禁区，重新设计三个机制不同的方案。');
    t.history.push({ kind: 'report', value: structuredClone(t.report) });
    t.history.push({
      kind: 'reroll_request',
      value: { keepDirectionIds, instruction, promptHashes: { ...t.promptHashes } }
    });
    t.promptHashes = {};
    t.regenerate = {
      directionId: keepDirectionIds[0] ?? '',
      keepDirectionIds,
      instruction,
      original: structuredClone(t.report)
    };
    t.phase = 'planning';
    t.planApproval = undefined;
    t.titleSelection = undefined;
    t.selectedDirectionId = undefined;
    t.candidate = undefined;
    t.contractReview = undefined;
    t.reportReview = undefined;
    t.resolutions = {};
    t.formatRepairs = 0;
    t.semanticRevisions = 0;
    t.repair = undefined;
    r.messages = [];
    r.changes = [];
    r.error = undefined;
    r.issues = [];
    return host.launch(r);
  }
  if (command === 'tags.selectDirection' || command === 'tags.reviseDirection') {
    idle();
    const r = s.db.run(str(a.id));
    planningBinding(s, r);
    const t = r.planning!;
    if (
      r.accepted ||
      ['discarded', 'stale'].includes(r.status) ||
      t.phase !== 'awaiting_direction' ||
      !t.report ||
      t.reportHash !== tagHash(t.report)
    )
      throw new Error('三个方向已改变或尚未生成完成，请刷新后再选择');
    if (a.reportHash !== tagHash(t.report)) throw new Error('策划报告已改变，请重新查看');
    validateReport(t.report, t);
    const directionId = str(a.directionId);
    if (!t.report.directions.some((d) => d.id === directionId)) throw new Error('方向不存在');
    t.planApproval = undefined;
    t.titleSelection = undefined;
    if (command === 'tags.reviseDirection') {
      const instruction = z.string().trim().min(1).max(6000).parse(a.instruction);
      t.history.push({ kind: 'report', value: structuredClone(t.report) });
      t.history.push({
        kind: 'reroll_request',
        value: { directionId, instruction, promptHashes: { ...t.promptHashes } }
      });
      t.promptHashes = {};
      t.regenerate = { directionId, instruction, original: structuredClone(t.report) };
      t.phase = 'planning';
    } else {
      const resolutions = z.record(z.string(), z.string().trim().min(1).max(4000)).parse(a.resolutions ?? {});
      if (Object.keys(resolutions).some((id) => !t.report!.assumptions.some((v) => v.id === id)))
        throw new Error('确认意见引用了未知假设');
      if (a.acceptAssumptions === true)
        for (const assumption of t.report.assumptions)
          if (!assumption.directionIds.length || assumption.directionIds.includes(directionId))
            resolutions[assumption.id] ??= '作者已确认采用此设定';
      for (const v of t.report.assumptions)
        if (
          v.critical &&
          (!v.directionIds.length || v.directionIds.includes(directionId)) &&
          !resolutions[v.id]
        )
          throw new Error('请处理关键假设：' + v.text);
      t.selectedDirectionId = directionId;
      t.resolutions = resolutions;
      t.phase = 'contract';
    }
    // Author selection starts a new subphase. Its first repair must not be
    // consumed by the earlier directions; total model/tool budgets stay intact.
    t.semanticRevisions = 0;
    t.repair = undefined;
    r.messages = [];
    r.changes = [];
    r.error = undefined;
    r.issues = [];
    return host.launch(r);
  }
  if (command === 'tags.diff') {
    const r = s.db.run(str(a.id));
    if (!r.planning) throw new Error('不是标签策划任务');
    return {
      before: approvedCreation(p) ?? null,
      after: r.planning.candidate ?? null,
      ...tagImpact(s, r.planning)
    };
  }
  if (command === 'tags.restoreProjection') {
    idle();
    const creation = approvedCreation(p);
    if (!creation) throw new Error('本书尚无正式作品契约');
    const actual = fileHash(safePath(s.root, contractPath));
    if (a.baseHash !== actual) throw new Error('展示文件已再次改变，请刷新后恢复');
    const content = renderContract(creation.spec, creation.contract);
    if (actual === hash(content)) return true;
    const next = structuredClone(p);
    next.revision++;
    new ProjectCommitService(s).commit([{ path: contractPath, content, baseHash: actual }], next);
    host.emit({ type: 'snapshot' });
    return true;
  }

  throw new Error('不支持此领域命令');
}
