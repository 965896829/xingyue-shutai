import { z } from 'zod';
import { approvedCreation } from '../../shared/creation';
import { type Assessment } from '../../shared/studio';
import { type Command, type ProjectState } from '../../shared/types';
import { batchSummaryProgress, materializeAftermathStatus } from '../aftermath-status';
import { assertControllerRules } from '../agent-control';
import { contextChanged } from '../context-compiler';
import { createBackup } from '../documents';
import {
  activeBatch,
  advance,
  archivePath,
  hash,
  id,
  now,
  parseConfig,
  paths,
  prosePath,
  renderProgress,
  stageNames,
  updateConfigDocument
} from '../domain';
import { confirmedAlignedPlans } from '../future-plan-review';
import { decodeFacts, encodeFacts, primaryPath, rebuildMemory, validateEvidence } from '../memory';
import { sameStoryText } from '../memory-source';
import { volumeNameSlots, volumeRenameIssues } from '../volume-naming';
import { chapterNameSlots, chapterRenameIssues } from '../chapter-naming';
import { syncEntities } from '../memory-studio';
import { samePath } from '../recycle-bin';
import { candidateChangesForCurrentSettings, compatibleRunBase } from '../runtime-settings';
import { ProjectCommitService } from '../runtime/commit-kernel';
import { voicePath } from '../quality';
import { supersedeFact } from '../fact-transitions';
import { mediaPath } from '../workbench-media';
import { bookProfilePath, parseBookProfile } from '../publishing';
import { plotAffectedChapters, plotPath } from '../workbench-plot';
import { setRunStatus } from '../runtime/run-state';
import type { Service } from '../service';
import { initialFiles, renderIndex } from '../skill';
import { proposalHash } from '../storage';
import {
  changedStoryStates,
  futurePlanTargets,
  makeStoryImpact,
  nextUnwrittenChapter,
  resolveStoryImpacts
} from '../story-impact';
import {
  approveTags,
  creationGenre,
  assertPlanApproval,
  contractPath,
  planningBinding,
  selectedIds,
  tagImpact
} from '../tags';
import { assertTitleSelection, renderTitle, titlePath, validateBookTitle } from '../title-naming';
const str = (v: unknown) => z.string().min(1).parse(v);
function finishImpactReview(p: ProjectState) {
  if (p.stale.length) return;
  for (const [chapter, state] of Object.entries(p.chapterStatesBeforeReview ?? {})) {
    if (p.chapters[chapter] === 'stale') p.chapters[chapter] = state;
  }
  delete p.chapterStatesBeforeReview;
}

export const adoptionCommands = new Set<string>(['run.accept']);
type Host = Pick<
  Service,
  | 'require'
  | 'skillRoot'
  | 'change'
  | 'recent'
  | 'backingUp'
  | 'scheduler'
  | 'managementController'
  | 'needsMemoryRepair'
  | 'startMemoryRepair'
  | 'makeRun'
  | 'launch'
>;

export async function handleAdoptionCommand(
  host: Host,
  command: Command,
  a: Record<string, unknown>,
  _idle: () => void
): Promise<unknown> {
  const { s, p, runner } = host.require();
  if (command === 'run.accept') {
    if (runner.controller) throw new Error('任务还在运行');
    const r = s.db.run(str(a.id));
    if (r.creative) throw new Error('请从自由草稿转为候选，完成必要核对后再采纳');
    if (r.naming) throw new Error('请在独立命名中选择已审核书名；命名不推进创作阶段');
    if (r.accepted) {
      if (a.title !== undefined && String(a.title).trim() !== p.title)
        throw new Error('此方向已经确认书名，请刷新查看已保存的结果');
      if (a.proposalHash !== undefined && a.proposalHash !== proposalHash(r))
        throw new Error('提交编号与候选内容不匹配');
      return { alreadyAccepted: true };
    }
    if (str(a.proposalHash) !== proposalHash(r)) throw new Error('候选内容已改变，请重新打开审阅');
    runner.recoverReadyCandidate(r, p, 'accept');
    if (!compatibleRunBase(s, r))
      throw new Error(
        '生成候选后，作品内容或创作要求已改变。候选已保留，请点击“继续当前任务”核对新资料后再采纳。'
      );
    if (!['awaiting_review', 'needs_repair'].includes(r.status))
      throw new Error('请先完成任务并进入候选审阅');
    if (r.agentRulesHash) assertControllerRules(host.skillRoot, r.agentRulesHash);
    if (r.planning) planningBinding(s, r);
    if ((p.tagEnabled || p.creationWorkflow === 2) && r.stage === 'S01' && r.mode === 'stage' && !r.planning)
      throw new Error('请先完成标签策划与契约审核');
    if (r.manifest && contextChanged(s, r.manifest))
      throw new Error('候选所依赖的资料已被外部修改；请先核对资料并重新建立任务，旧批准不能沿用');
    if (r.mode === 'stage' && (p.stage !== r.stage || p.chapter !== r.chapter))
      throw new Error('阶段已经改变');
    const confirmsTitle = p.titlePending === true && r.mode === 'stage' && r.stage === 'S01';
    let confirmedTitle: string | undefined;
    const unified = r.planning?.workflowVersion === 2;
    if (unified) {
      assertPlanApproval(r);
      const selection = r.planning!.titleSelection;
      if (confirmsTitle && !selection) throw new Error('请在方案确认后独立生成或核对书名，再统一采纳');
      if (selection) {
        assertTitleSelection(s, selection, r.id, host.skillRoot);
        confirmedTitle = selection.candidate.title;
      }
      if (a.title !== undefined && a.title !== confirmedTitle)
        throw new Error('请通过独立命名核对并选择书名');
    } else if (confirmsTitle) {
      confirmedTitle = typeof a.title === 'string' ? a.title.trim() : '';
      if (!confirmedTitle) throw new Error('故事方向确认后，请填写书名再保存本阶段');
      confirmedTitle = validateBookTitle(confirmedTitle);
    } else if (a.title !== undefined && String(a.title).trim() !== p.title) {
      throw new Error('只能在首次确认故事方向时确定书名');
    }
    runner.check(r, p);
    if (r.issues.some((i) => i.severity === 'error')) {
      s.db.saveRun(r);
      throw new Error('候选存在阻断问题，请先修改');
    }
    if (r.status === 'needs_repair') {
      setRunStatus(r, 'awaiting_review');
      s.db.saveRun(r);
    }
    if (!r.changes.length) throw new Error('没有可接受的候选文件');
    if (a.warningReason) s.db.event(r.id, 'warning-review', String(a.warningReason));
    let next = r.mode === 'stage' ? advance(p, r.id) : structuredClone(p);
    if (r.pipeline && r.mode === 'stage' && r.chapter === p.chapter) next = advance(next, r.id);
    next.revision++;
    let changes = candidateChangesForCurrentSettings(s, r);
    const creativeConfig = changes.find((change) => change.path === paths.config);
    if (creativeConfig && !changes.some(change => change.path === bookProfilePath)) {
      const reviewed = parseConfig(creativeConfig.content, p.config);
      for (const key of ['pov', 'genre', 'style', 'constraints'] as const) next.config[key] = reviewed[key];
      for (const key of ['targetWords', 'chapterWords', 'minWords', 'maxWords', 'batchSize'] as const) next.config[key] = reviewed[key];
      creativeConfig.content = updateConfigDocument(creativeConfig.content, next);
    }
    const profileChange = changes.find(change => change.path === bookProfilePath);
    if (profileChange && changes.some(change => change.path === paths.config) && !r.planning) {
      const profile = parseBookProfile(profileChange.content).profile;
      next.config.genre = profile.creativeGenres.join('、') || '未限定';
      const configured = updateConfigDocument(s.readAccepted(paths.config).content, next);
      if (changes.find(change => change.path === paths.config)!.content !== configured)
        throw new Error('创作题材与项目配置候选不一致，请重新生成修改');
    }
    const namingPaths = new Set([
      ...(r.volumeNaming?.renameOnly && !volumeRenameIssues(r).length ? [paths.volumes] : []),
      ...(r.chapterNaming?.renameOnly && !chapterRenameIssues(r).length ? r.chapterNaming.renameOnly.documents.map(document => document.path) : [])
    ]);
    const namingEvidence = namingPaths.size ? s.db.facts().filter(fact => fact.reviewStatus === 'accepted').flatMap(fact => fact.evidence).filter(evidence => namingPaths.has(evidence.path)) : [];
    const namingSkeleton = (content: string, file: string) => file === paths.volumes ? volumeNameSlots(content).skeleton : chapterNameSlots(content, file).skeleton;
    const substantiveChanges = changes
      .filter((change) => {
        if (change.path === voicePath || change.path === mediaPath) return false;
        const previous = s.db.document(change.path)?.hash;
        if (namingPaths.has(change.path) && previous && namingSkeleton(s.object(previous).toString('utf8'), change.path) === namingSkeleton(change.content, change.path) && namingEvidence.filter(evidence => evidence.path === change.path).every(evidence => {
          const offset = change.content.indexOf(evidence.quote);
          return evidence.hash === change.baseHash && offset >= 0 && change.content.indexOf(evidence.quote, offset + 1) < 0;
        })) return false;
        return !previous || !sameStoryText(s.object(previous).toString('utf8'), change.content);
      })
      .map((change) => change.path);
    if (r.planning) {
      const creation = approveTags(
        r,
        approvedCreation(p),
        str(a.proposalHash),
        r.planning.origin === 'new' ? 1 : nextUnwrittenChapter(p)
      );
      if (unified) {
        next.creation = creation;
        delete next.tags;
        next.creationWorkflow = 2;
        next.schemaVersion = 3;
      } else {
        next.tags = creation;
        next.schemaVersion = 2;
      }
      next.tagEnabled = selectedIds(r.planning.spec).length > 0;
      next.config.genre = creationGenre(r.planning.spec, r.planning.knowledge, next.config.genre);
      const configured = updateConfigDocument(s.readAccepted(paths.config).content, next);
      if (changes.find((c) => c.path === paths.config)?.content !== configured)
        throw new Error('项目配置候选与标签主分类映射不一致，请重新生成契约');
    }
    if (confirmedTitle) {
      next.title = confirmedTitle;
      next.titlePending = false;
      if (r.planning?.titleSelection) {
        next.titleBinding = { ...structuredClone(r.planning.titleSelection), needsReview: false };
        next.titleReviewRequired = false;
        changes.push(host.change(titlePath, renderTitle(next.titleBinding)));
      }
      const configChange = changes.find((change) => change.path === paths.config);
      const content = updateConfigDocument(
        configChange?.content ?? s.readAccepted(paths.config).content,
        next
      );
      if (configChange) configChange.content = content;
      else changes.push(host.change(paths.config, content));
    }
    // Merge authoritative evidence records even when a model replaces a whole human-readable ledger.
    let facts = s.db.facts().map((f) => structuredClone(f));
    const rebasedFiles = new Set<string>();
    for (const fact of facts) {
      if (fact.reviewStatus !== 'accepted') continue;
      for (const evidence of fact.evidence) {
        const change = changes.find((change) => change.path === evidence.path);
        if (
          !change ||
          evidence.hash !== s.db.document(evidence.path)?.hash ||
          substantiveChanges.includes(evidence.path)
        )
          continue;
        const offset = change.content.indexOf(evidence.quote);
        if (offset < 0 || change.content.indexOf(evidence.quote, offset + 1) >= 0) continue;
        evidence.hash = hash(change.content);
        evidence.start = Array.from(change.content.slice(0, offset)).length;
        evidence.end = evidence.start + Array.from(evidence.quote).length;
        rebasedFiles.add(primaryPath(fact));
      }
    }
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
      const errors = validateEvidence(
        s,
        f,
        p.chapter,
        r.pipeline || r.mode === 'revision' ? r.changes : [],
        r.memoryRepair?.paths
      );
      if (errors.length) throw new Error(errors.join('；'));
      if (facts.some((x) => x.id === f.id))
        throw new Error(`记忆编号已存在，请新建编号并引用 supersedes：${f.id}`);
      if (f.supersedes) {
        const old = facts.find((x) => x.id === f.supersedes);
        if (!old) throw new Error('被替代记忆不存在');
        if (!f.replacementReason.trim()) throw new Error('替代既有事实必须说明依据和原因');
        supersedeFact(old, f);
      }
      facts.push(f);
    }
    for (const retirement of r.factRetractions ?? []) {
      if (!r.memoryRepair) throw new Error('撤回事实必须经过记忆同步核对');
      const fact = facts.find((fact) => fact.id === retirement.id);
      if (!fact || !retirement.reason.trim()) throw new Error('撤回记录缺少有效依据');
      fact.reviewStatus = 'retracted';
      fact.state = 'superseded';
      fact.replacementReason = retirement.reason;
      fact.acceptedAt = now();
      fact.acceptedRunId = r.id;
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
        rebasedFiles.has(relative) ||
        (r.factRetractions ?? []).some((item) =>
          facts.some((fact) => fact.id === item.id && primaryPath(fact) === relative)
        ) ||
        r.facts.some(
          (f) =>
            primaryPath(f) === relative ||
            (f.supersedes && facts.find((x) => x.id === f.supersedes && primaryPath(x) === relative))
        )
      )
        changes.push(host.change(relative, encodeFacts(s.read(relative).content, fileFacts)));
    }
    if (r.mode === 'stage' && (r.stage === 'S11' || r.pipeline) && p.chapter === activeBatch(p).end) {
      const batch = activeBatch(p),
        behavior = changes.find((c) => c.path === paths.behavior)!,
        summary = changes.find((c) => c.path === paths.summary)!;
      const sources = Array.from({ length: batch.end - batch.start + 1 }, (_, i) => {
        const file = prosePath(batch.start + i);
        return {
          path: file,
          hash: changes.find((c) => c.path === file)
            ? hash(changes.find((c) => c.path === file)!.content)
            : (s.db.document(file)?.hash ?? null)
        };
      });
      summary.content += `\n\n## 摘要覆盖回执\n\n- 来源：${sources.map((v) => `${v.path} @ ${v.hash}`).join('；')}\n- 未解决事项：${
        facts
          .filter((f) => f.mandatory && f.state === 'active')
          .map((f) => f.id)
          .join('、') || '无已登记事项'
      }\n- 重要遗漏：摘要可能省略细节；须经作者语义审阅，完整行为日志与原文保留。\n`;
      changes.push(host.change(archivePath(batch), encodeFacts(behavior.content, [])));
      behavior.content = encodeFacts(
        `# 情绪与行为记忆\n\n## 下一批起点\n\n${summary.content}\n`,
        facts.filter((f) => primaryPath(f) === paths.behavior)
      );
    }
    const storyStates = changedStoryStates(s.db.facts(), facts);
    if (r.memoryRepair) {
      if (r.memoryRepair.completed.some((item) => s.db.document(item.path)?.hash !== item.hash))
        throw new Error('核对期间原文版本改变，请重新同步');
      next.stale = next.stale.filter((file) => !r.memoryRepair!.paths.includes(file));
      resolveStoryImpacts(next, r.memoryRepair.paths);
      for (const chapter of Object.keys(next.chapterStatesBeforeReview ?? {}))
        if (r.memoryRepair.paths.includes(prosePath(Number(chapter)))) {
          next.chapters[chapter] = next.chapterStatesBeforeReview![chapter];
          delete next.chapterStatesBeforeReview![chapter];
        }
      finishImpactReview(next);
    } else if (
      r.continuity?.mode === 'forward' ||
      r.continuity?.mode === 'extraction' ||
      (r.mode === 'stage' && (r.stage === 'S11' || r.pipeline) && storyStates.length && !next.finished)
    ) {
      const fromChapter =
        r.continuity?.mode === 'forward' ? r.continuity.fromChapter : nextUnwrittenChapter(next);
      const changed = changes.filter(
        (change) =>
          !s.db.document(change.path)?.hash ||
          !sameStoryText(s.readAccepted(change.path).content, change.content)
      );
      const aligned =
        r.mode === 'stage' && (r.stage === 'S11' || r.pipeline)
          ? confirmedAlignedPlans(s, r)
          : new Set<string>();
      const targets = futurePlanTargets(
        s,
        fromChapter,
        changed.map((change) => change.path),
        storyStates,
        changed.map((change) => change.path),
        initialFiles(p, host.skillRoot, '')
      ).filter((target) => !aligned.has(target.path));
      if (aligned.size)
        s.db.event(r.id, 'future-plans-aligned', '独立核对确认以下后续计划仍可执行，无需重复生成', {
          paths: [...aligned],
          fingerprint: r.futurePlanReview?.fingerprint
        });
      resolveStoryImpacts(
        next,
        changed.map((change) => change.path)
      );
      next.stale = next.stale.filter((file) => !changed.some((change) => change.path === file));
      if (targets.length && (changed.length || storyStates.length)) {
        const impact = makeStoryImpact(next, r, changed, storyStates, targets, {
          mode: 'forward',
          fromChapter
        });
        (next.storyImpacts ??= []).push(impact);
        next.stale = [...new Set([...next.stale, ...targets.map((target) => target.path)])];
        const record = `\n\n## ${now()} 后续计划待同步\n\n- 生效范围：第 ${fromChapter} 章起；已有正文保持不变\n- 来源任务：${r.id}\n- 起因：${r.request}\n${storyStates.map((state) => `- ${state.subject} · ${state.predicate}：${state.before ?? '尚无记录'} → ${state.after}`).join('\n')}\n- 待核对：${targets.map((target) => target.path).join('、')}\n`;
        const current =
          changes.find((change) => change.path === paths.impact)?.content ??
          s.readAccepted(paths.impact).content;
        changes = changes.filter((change) => change.path !== paths.impact);
        changes.push(host.change(paths.impact, current + record));
      }
    } else if (unified && r.planning!.origin !== 'new') {
      const delta = tagImpact(s, r.planning!);
      const changed = changes.map((v) => v.path);
      const fromChapter = nextUnwrittenChapter(next);
      const placeholders = initialFiles(p, host.skillRoot, '');
      const targets =
        delta.planChanged ||
        delta.authorChanged ||
        delta.changedConstraintIds.length ||
        delta.changedOptionIds.length
          ? futurePlanTargets(s, fromChapter, [contractPath], [], changed, placeholders)
          : [];
      for (const doc of s.db
        .acceptedDocuments()
        .filter(
          (d) => /^(03_|04_)/.test(d.path) || (d.path.startsWith('11_') && /书名|简介|开篇|包装/.test(d.path))
        )) {
        if (
          changed.includes(doc.path) ||
          targets.some((v) => v.path === doc.path) ||
          s.readAccepted(doc.path).content === placeholders[doc.path]
        )
          continue;
        if (
          delta.planChanged ||
          delta.authorChanged ||
          delta.changedConstraintIds.length ||
          delta.changedOptionIds.length
        )
          targets.push({
            path: doc.path,
            reason: '作品方案或创作边界改变，需对照新契约核对；已有正文保持不变',
            via: [contractPath]
          });
      }
      if (
        !confirmedTitle &&
        (delta.planChanged || delta.authorChanged || delta.changedConstraintIds.length)
      ) {
        next.titleReviewRequired = true;
        if (next.titleBinding) {
          next.titleBinding.needsReview = true;
          next.titleBinding.reason = '作品方案或约束已改变，请重新核对书名承诺';
          changes.push(host.change(titlePath, renderTitle(next.titleBinding)));
        }
      }
      resolveStoryImpacts(next, changed);
      next.stale = [
        ...new Set([...next.stale.filter((file) => !changed.includes(file)), ...targets.map((v) => v.path)])
      ];
      if (targets.length) {
        const impact = makeStoryImpact(next, r, changes, [], targets, { mode: 'forward', fromChapter });
        impact.creationChange = {
          changedClaimIds: delta.changedClaimIds,
          changedConstraintIds: delta.changedConstraintIds
        };
        (next.storyImpacts ??= []).push(impact);
      }
      const record = `\n\n## ${now()} 作品方案变更\n\n- 来源任务：${r.id}\n- 变化条目：${delta.changedClaimIds.join('、') || '无'}\n- 后续生效：第 ${fromChapter} 章起；保留当前阶段、写作位置与已有正文\n- 待核对：${targets.map((v) => v.path).join('、') || '无'}\n- 书名：${next.titleReviewRequired ? '需在独立命名中核对' : '已核对'}\n`;
      changes.push(host.change(paths.impact, s.readAccepted(paths.impact).content + record));
    } else if (r.mode !== 'stage' && r.mode !== 'analysis' && substantiveChanges.length) {
      const changed = substantiveChanges,
        earliest = Math.min(...changed.map((f) => Number(f.match(/^07_.*第(\d+)章/)?.[1] ?? Infinity)));
      const plotOnly = changed.length === 1 && changed[0] === plotPath;
      const plotChange = changes.find((c) => c.path === plotPath);
      const plotChapters =
        plotOnly && plotChange
          ? plotAffectedChapters(
              plotChange.baseHash ? s.object(plotChange.baseHash).toString('utf8') : undefined,
              plotChange.content
            )
          : r.workbench?.reorder && !changes.some((c) => c.path.startsWith('07_'))
            ? r.workbench.reorder.before.filter((n, i) => n !== r.workbench!.reorder!.after[i])
            : null;
      const placeholders = initialFiles(p, host.skillRoot, '');
      const affected = s.db
        .acceptedDocuments()
        .map((d) => d.path)
        .filter(
          (f) =>
            !changed.includes(f) &&
            (!plotChapters ||
              (/^(06_|07_|08_)/.test(f) &&
                plotChapters.some((n) => {
                  const span = f.match(/第(\d+)(?:-(\d+))?章/);
                  return span && n >= Number(span[1]) && n <= Number(span[2] ?? span[1]);
                }))) &&
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
      if (r.planning)
        affected.push(
          ...tagImpact(s, r.planning)
            .affected.map((d) => d.path)
            .filter(
              (f) =>
                !changed.includes(f) &&
                !affected.includes(f) &&
                (!placeholders[f] || s.readAccepted(f).content !== placeholders[f])
            )
        );
      next.stale = [...new Set([...p.stale.filter((f) => !changed.includes(f)), ...affected])];
      resolveStoryImpacts(next, changed);
      if (affected.length)
        (next.storyImpacts ??= []).push(
          makeStoryImpact(
            next,
            r,
            changes.filter((change) => changed.includes(change.path)),
            storyStates,
            affected.map((file) => ({
              path: file,
              reason: '既有设定或正文发生修订，需核对关联影响',
              via: changed
            })),
            r.continuity ?? { mode: 'retcon', fromChapter: Number.isFinite(earliest) ? earliest : 1 }
          )
        );
      for (const n of Object.keys(next.chapters))
        if (!Number.isFinite(earliest) || Number(n) >= earliest) {
          const state = next.chapters[n];
          if (state !== 'stale') (next.chapterStatesBeforeReview ??= {})[n] = state;
          next.chapters[n] = 'stale';
        }
      finishImpactReview(next);
      const record = `\n\n## ${now()} ${r.request}\n\n- 起因：${r.request}\n- 修改章节或规则：${changed.join('、')}\n- 旧事实：以本次基础版本原文为准；${changes.map((c) => `${c.path} @ ${c.baseHash ?? '新文件'}`).join('；')}\n- 新事实：见本次已接受候选；来源任务 ${r.id}\n- 影响起点：${Number.isFinite(earliest) ? `第${earliest}章` : '涉及设定与后续资料'}\n- 已检查文件：${changed.join('、')}\n- 已同步文件：${changed.join('、')}\n- 无需修改及原因：待逐项核对后填写\n- 待核对：${next.stale.join('、') || '无'}\n- 状态：${next.stale.length ? '处理中' : '已闭环'}\n`;
      changes = changes.filter((c) => c.path !== paths.impact);
      changes.push(host.change(paths.impact, s.read(paths.impact).content + record));
    }
    const all = [...new Set([...s.db.acceptedDocuments().map((d) => d.path), ...changes.map((c) => c.path)])];
    changes = changes.filter((c) => c.path !== paths.progress && c.path !== paths.index);
    changes.push(
      host.change(paths.progress, renderProgress(next)),
      host.change(paths.index, renderIndex(next, all))
    );
    if (r.mode === 'stage' && (r.stage === 'S11' || r.pipeline)) {
      const statusFields = materializeAftermathStatus(changes, p);
      if (p.chapter < activeBatch(p).end) {
        const summary = changes.find((change) => change.path === paths.summary);
        if (summary) summary.content = batchSummaryProgress(summary.content, p);
        else
          changes.push(
            host.change(paths.summary, batchSummaryProgress(s.readAccepted(paths.summary).content, p))
          );
      }
      s.db.event(
        r.id,
        'aftermath-status-materialized',
        '本次批准事务将同步章后状态；故事内容和审核结论保持不变',
        { fields: statusFields }
      );
    }
    r.accepted = true;
    setRunStatus(r, 'complete');
    r.updatedAt = now();
    new ProjectCommitService(s).commit(changes, next, r);
    host.recent = host.recent.map((item) =>
      samePath(item.root, next.root) ? { ...item, title: next.title } : item
    );
    rebuildMemory(s);
    syncEntities(s);
    for (const row of s.db.sql.prepare('SELECT id,data FROM assessments').all() as {
      id: string;
      data: string;
    }[]) {
      const value = JSON.parse(row.data) as Assessment;
      if (value.track === 'candidate' && value.draftId === r.id && value.hash === r.pipeline?.proseHash) {
        const accepted = { ...value, id: id(), track: 'accepted', snapshotId: s.db.get('headSnapshot') };
        s.db.sql.prepare('INSERT INTO assessments VALUES(?,?)').run(accepted.id, JSON.stringify(accepted));
      }
    }
    s.db.event(r.id, 'accepted', '作者接受结果，已提交正式文件');
    if (next.config.backupDirectory) {
      host.backingUp = true;
      try {
        await host.scheduler.run(id(), ['foreground', 'index', 'assessment', 'maintenance'], 20, () =>
          createBackup(s, next.config.backupDirectory, host.managementController.signal)
        );
      } catch (e) {
        s.db.event(r.id, 'backup-error', `正式文件已提交，但备份失败：${(e as Error).message}`);
      } finally {
        host.backingUp = false;
      }
    }
    const titleResult = confirmedTitle && confirmedTitle !== p.title ? { titleChanged: true } : {};
    if (a.startNext === true && (r.mode === 'stage' || r.memoryRepair) && !next.finished) {
      try {
        if (
          host.needsMemoryRepair(
            `完成 ${stageNames[next.stage]}。沿用已接受要求，开始前复核全部必读资料。`,
            next.config.stageProfiles[next.stage] || next.config.defaultProfileId || r.profileId
          )
        )
          return {
            accepted: true,
            nextRun: host.startMemoryRepair(next.config.defaultProfileId || r.profileId),
            ...titleResult
          };
        const nextRun = host.makeRun(
          'stage',
          `完成 ${stageNames[next.stage]}。沿用已接受要求，开始前复核全部必读资料。`,
          next.config.stageProfiles[next.stage] || next.config.defaultProfileId || r.profileId
        );
        const result = { accepted: true, nextRun: nextRun.id, ...titleResult };
        host.launch(nextRun, result);
        return result;
      } catch (error) {
        const nextError = `本阶段已保存，下一阶段未能开始：${(error as Error).message}`;
        s.db.event(r.id, 'next-stage-error', nextError);
        return { accepted: true, nextError, ...titleResult };
      }
    }
    return { accepted: true, ...titleResult };
  }

  throw new Error('不支持此领域命令');
}
