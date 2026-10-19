import type { Run } from '../shared/types';
import { creationTaskState, requestErrorText, retryNeedsConfirmation } from '../shared/run-presentation';
import { invokeCommand as invoke } from '../shared/client';

export function CreationTaskStatus({
  run,
  disabled,
  act,
  onReview,
  onEdit,
  format = (text) => text
}: {
  run: Run;
  disabled: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onReview: (id: string) => void;
  onEdit?: () => void;
  format?: (text: string) => string;
}) {
  const state = creationTaskState(run);
  return (
    <div className={`creation-task-status ${state.tone}`}>
      <div role="status">
        <strong>{state.title}</strong>
        {state.detail && <p>{state.detail}</p>}
      </div>
      {state.recovery && (
        <div className="tag-actions">
          {state.recovery === 'resume' && (
            <button
              className="primary"
              disabled={disabled}
              onClick={() => {
                if (
                  retryNeedsConfirmation(run) &&
                  !window.confirm('上次请求结果与费用未知，重新请求可能重复计费。确认重新请求？')
                )
                  return;
                void act(() =>
                  invoke('run.resume', { id: run.id, retryUnknown: retryNeedsConfirmation(run) })
                );
              }}
            >
              {retryNeedsConfirmation(run) ? '核对后重新请求这一步' : '继续这一步'}
            </button>
          )}
          {state.recovery === 'edit' && onEdit && (
            <button className="primary" disabled={disabled} onClick={onEdit}>
              修改想法
            </button>
          )}
          <button disabled={disabled} onClick={() => onReview(run.id)}>
            {state.recovery === 'review' ? '查看任务与限额' : '换模型或查看记录'}
          </button>
        </div>
      )}
      {run.status === 'running' && (
        <button disabled={disabled} onClick={() => void act(() => invoke('run.cancel', { id: run.id }))}>
          暂停
        </button>
      )}
      <details className="creation-task-details">
        <summary>运行详情{run.error && run.status !== 'running' ? '与错误信息' : ''}</summary>
        <p>已用 {run.rounds} 次模型调用</p>
        {run.error && <p>{format(requestErrorText(run.error))}</p>}
        <button onClick={() => onReview(run.id)}>查看完整任务记录</button>
      </details>
    </div>
  );
}

export interface CreationCheckItem {
  text: string;
  fix?: string;
  kind: 'blocking' | 'confirmation' | 'suggestion';
}

export function CreationChecks({ title, items }: { title: string; items: CreationCheckItem[] }) {
  if (!items.length) return null;
  const required = items.filter((i) => i.kind !== 'suggestion'),
    suggestions = items.filter((i) => i.kind === 'suggestion');
  const list = (rows: CreationCheckItem[]) => (
    <ul>
      {rows.map((item, index) => (
        <li key={index}>
          <p>{item.text}</p>
          {item.fix && <p className="muted">建议：{item.fix}</p>}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="creation-checks">
      {required.length > 0 && (
        <div className="creation-required-checks">
          <strong>
            {title} · {required.length} 项
            {required.some((i) => i.kind === 'blocking') ? '需要处理' : '需要确认'}
          </strong>
          {list(required)}
        </div>
      )}
      {suggestions.length > 0 && (
        <details>
          <summary>
            {title} · {suggestions.length} 条参考建议，不影响继续
          </summary>
          {list(suggestions)}
        </details>
      )}
    </div>
  );
}
