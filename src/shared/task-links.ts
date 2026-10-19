import type { Run } from './types';

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
  const field = /轮数上限/.test(run.error ?? '') ? 'maxRounds' : /工具调用上限/.test(run.error ?? '') ? 'maxTools' : /阶段预算|费用上限|费用上界/.test(run.error ?? '') ? 'stageBudget' : '';
  if (field) return { label: '查看对应设置', href: `#${taskSectionId(run.id, `setting-${field}`)}` };
  if (/API Key|工具调用未启用|模型不可用|等待模型超过|HTTP (?:400|401|403|404|422|429)/.test(run.error ?? '')) return { label: '查看模型设置', href: `#${taskSectionId(run.id, 'model-settings')}` };
  return { label: '查看处理操作', href: `#${taskSectionId(run.id, 'recovery')}` };
}

export function taskProblemLinks(run: Run) {
  return [
    ...(run.error ? [{ label: '查看任务报错', href: `#${taskErrorId(run)}` }, taskHelpLink(run)] : []),
    ...run.issues.map((issue, index) => ({ label: `${issue.path?.split('/').at(-1)?.replace(/\.md$/, '') || `问题 ${index + 1}`}：查看问题`, href: `#${taskIssueId(run.id, issue)}` }))
  ];
}
