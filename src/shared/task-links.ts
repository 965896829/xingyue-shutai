import type { Run } from './types';
import { visibleRunIssues } from './run-presentation';
import { recoveryDecision } from './recovery';

function key(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0).toString(16);
}

export const taskSectionId = (runId: string, section: string) => `task-${runId}-${section}`;
export const taskIssueId = (runId: string, issue: Run['issues'][number]) => taskSectionId(runId, `issue-${key(JSON.stringify([issue.code, issue.path, issue.message]))}`);
export const taskFileId = (runId: string, path: string) => taskSectionId(runId, `file-${key(path)}`);
export const taskErrorId = (run: Run) => taskSectionId(run.id, `error-${key(run.error ?? '')}`);
export const taskTurnId = (turnId: string) => `task-turn-${turnId}`;
export function taskHelpLink(run: Run) {
  const field = recoveryDecision(run).setting;
  if (field && field !== 'model') return { label: '查看对应设置', href: `#${taskSectionId(run.id, `setting-${field}`)}` };
  if (field === 'model') return { label: '查看模型设置', href: `#${taskSectionId(run.id, 'model-settings')}` };
  return { label: '查看处理操作', href: `#${taskSectionId(run.id, 'recovery')}` };
}

export function taskProblemLinks(run: Run) {
  return [
    ...(run.error ? [{ label: '查看任务报错', href: `#${taskErrorId(run)}` }, taskHelpLink(run)] : []),
    ...visibleRunIssues(run).map((issue, index) => ({ label: `${issue.path?.split('/').at(-1)?.replace(/\.md$/, '') || `问题 ${index + 1}`}：查看问题`, href: `#${taskIssueId(run.id, issue)}` }))
  ];
}
