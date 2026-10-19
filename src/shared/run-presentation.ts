import type { Run } from './types';
import { planningPhaseNames } from './tags';

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
      detail: '完成后会在这里等你确认。',
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
    if (/预算|轮数上限|调用上限|额度.*用完/.test(run.error ?? ''))
      return {
        title: '任务已达到当前限额',
        detail: '已有内容已保留。查看任务记录并调整限额后再继续。',
        tone: 'attention',
        recovery: 'review'
      } as const;
    const review = planning?.phase === 'reviewing_report' ? planning.reportReview : planning?.contractReview;
    if (
      run.status === 'needs_repair' &&
      planning &&
      planning.semanticRevisions >= 1 &&
      review?.result.issues.some((i) => i.severity !== 'minor')
    )
      return {
        title: '方案有需要调整的内容',
        detail: '请根据下方检查结果补充或修改想法，再重新策划。已有方案可继续查看。',
        tone: 'attention',
        recovery: 'edit'
      } as const;
    if (/HTTP 50[234]|服务或中转.*异常/.test(run.error ?? ''))
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
