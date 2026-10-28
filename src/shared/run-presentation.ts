import type { Run, ProjectState } from './types';
import { planningPhaseNames } from './tags';
import { recoveryDecision } from './recovery';

export function runHasCurrentBasis(run: Run, project: ProjectState) {
  return (run.basisRevision === undefined ? run.baseRevision : run.basisRevision) === project.revision;
}

export const pendingOutputCodes = ['missing_output', 'required_output', 'document_draft_pending', 'pipeline_pending'];
export function visibleRunIssues(run: Run) {
  return run.issues.filter(issue => !(run.status === 'running' && pendingOutputCodes.includes(issue.code)));
}

/** Restore the direction being compared; this does not confirm or adopt it. */
export function creationDirectionId(run?: Run): string {
  const planning = run?.planning, report = planning?.report;
  if (!report) return '';
  return [planning.selectedDirectionId, planning.regenerate?.directionId, report.recommendedDirectionId]
    .find(id => report.directions.some(direction => direction.id === id)) ?? '';
}

export function creationStep(run?: Run): 1 | 2 | 3 {
  const planning = run?.planning;
  if (!planning) return 1;
  if (planning.planApproval) return 3;
  return ['contract', 'reviewing_contract', 'ready'].includes(planning.phase) ? 2 : 1;
}

export function creationValidationIssues(run?: Run) {
  const advice = run?.planning?.contractReview?.result.issues.filter((i) => i.severity === 'minor') ?? [];
  // Older saved runs duplicated optional review advice into commit warnings.
  // The host revalidates on confirmation/acceptance; retain every unrelated warning here.
  return (run?.issues ?? []).filter(
    (issue) =>
      !(
        issue.severity === 'warning' &&
        !issue.path &&
        advice.some((item) => item.code === issue.code && item.explanation === issue.message)
      )
  );
}

/** Execution state takes precedence over the last saved subphase. */
export function creationTaskState(run: Run) {
  const planning = run.planning,
    naming = run.naming;
  const activeTitle = planning
    ? planningPhaseNames[planning.phase]
    : naming?.phase === 'reviewing'
      ? '正在检查书名'
      : naming?.phase === 'ready'
        ? '书名已准备好'
        : '正在生成书名';
  if (run.status === 'running')
    return {
      title: activeTitle,
      detail: '完成后在这里查看结果，满意就继续，不满意可以直接修改。',
      tone: 'active',
      recovery: null
    } as const;
  if (run.accepted) return { title: '已保存', detail: '', tone: 'complete', recovery: null } as const;
  if (retryNeedsConfirmation(run))
    return {
      title: '上次请求结果尚未确认',
      detail: '已有内容已保留。重新请求可能产生重复费用，请先核对任务记录。',
      tone: 'attention',
      recovery: 'resume'
    } as const;
  if (['paused', 'failed', 'needs_repair', 'stale'].includes(run.status)) {
    const decision = recoveryDecision(run);
    if (decision.kind === 'settings')
      return {
        title: '需要核对运行设置',
        detail: decision.detail,
        tone: 'attention',
        recovery: 'review'
      } as const;
    if (planning?.report && (['reviewing_report', 'awaiting_direction'].includes(planning.phase) || planning.phase === 'planning' && planning.repair?.phase === 'planning'))
      return {
        title: '已有三个方向可继续查看',
        detail: '恢复后将直接展示已保存的方向，不再追加方向检查或自动修订。',
        tone: 'attention',
        recovery: 'resume'
      } as const;
    const review = planning?.contractReview;
    if (
      run.status === 'needs_repair' &&
      planning &&
      planning.semanticRevisions >= 1 &&
      review?.result.issues.some((i) => i.severity !== 'minor')
    )
      return {
        title: '方案有需要调整的内容',
        detail: '已有方案已保留。可恢复局部修复，或根据检查结果调整想法。',
        tone: 'attention',
        recovery: 'resume'
      } as const;
    if (decision.code === 'NETWORK_UNAVAILABLE')
      return {
        title: '模型服务暂时不可用',
        detail: '当前步骤已停止，前面的结果已保留。服务恢复后可从这里继续，也可以换模型。',
        tone: 'error',
        recovery: 'resume'
      } as const;
    return {
      title: run.status === 'paused' ? '当前步骤已暂停' : '当前步骤未完成',
      detail: '已有内容已保留，可以继续处理或查看任务记录。',
      tone: 'attention',
      recovery: 'resume'
    } as const;
  }
  return {
    title:
      planning?.phase === 'awaiting_direction'
        ? '三个方向已准备好'
        : planning?.planApproval
          ? '作品方案已确认'
          : naming
            ? '书名已准备好'
            : '作品方案已准备好',
    detail: planning?.phase === 'awaiting_direction' ? '选择一个方向，接下来完善作品方案。' : '',
    tone: 'complete',
    recovery: null
  } as const;
}

export function documentPreviewText(content: string) {
  return content
    .replace(
      /^(?:## 客户端设置[\t ]*\r?\n(?:[\t ]*\r?\n)*)?```json wenxu-config[\t ]*\r?\n[\s\S]*?^```[\t ]*\r?$(?:\n)?/gm,
      ''
    )
    .replace(/^```json wenxu-review[\t ]*\r?\n[\s\S]*?^```[\t ]*\r?$(?:\n)?/gm, '')
    .replace(/^(?:## 可追溯事实记录[\t ]*\r?\n(?:[\t ]*\r?\n)*)?<!-- wenxu-facts:v1 -->[\t ]*\r?\n(?:[\t ]*\r?\n)*```json[\t ]*\r?\n[\s\S]*?^```[\t ]*\r?$(?:\n)?/gm, '')
    .trim();
}

export function retryNeedsConfirmation(run: Run) {
  return run.status === 'unknown' || run.savedCandidateReview?.requestUnknown === true;
}

export function requestErrorText(error?: string) {
  if (!error) return '';
  if (/Bad control character|Unexpected (?:end|token|non-whitespace).*JSON|JSON at position/i.test(error))
    return '模型返回的数据不完整或格式异常，已保留收到的内容。';
  return error;
}

export function taskReplyText(text: string) {
  const clean = text.trim();
  if (/^`{1,3}(?:j(?:s(?:o(?:n)?)?)?)?\s*$/.test(clean)) return '';
  const start = clean.search(/(?:^|\n)\s*(?:```(?:json)?\s*)?\{/);
  if (start < 0) return text;
  const prefix = clean.slice(0, start).trim();
  const receipt = clean
    .slice(start)
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  const key = receipt.match(/^\{\s*"([^"\n]*)/);
  if (key && !['status', 'summary', 'artifact_proposals'].some((name) => name.startsWith(key[1])))
    return text;
  if (!key && !/^\{\s*$/.test(receipt)) return text;
  // Buffer the short opening of a streaming receipt until its summary is complete.
  const match = receipt.match(/"summary"\s*:\s*("(?:\\.|[^"\\])*")/s);
  if (!match) return prefix;
  try {
    const summary = JSON.parse(match[1]);
    return [prefix, typeof summary === 'string' ? summary.trim() : ''].filter(Boolean).join('\n\n');
  } catch {
    return prefix;
  }
}
