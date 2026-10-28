import { RunRecoveryButton } from './RunRecoveryButton';
import { ContextCompactions } from './ContextMeter';
import type { Run } from '../shared/types';
import { GenerationStatus } from './GenerationStatus';
import { CreationProgress } from './CreationProgress';
import { reasoningLabel } from '../shared/reasoning';
import { creationTaskState, requestErrorText } from '../shared/run-presentation';
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
      <div className="creation-task-summary">
        <strong role="status">{state.title}</strong>
        {(run.status === 'running' || run.activity) && <GenerationStatus activity={run.activity} running={run.status === 'running'} label="本次执行结束" fallbackStart={run.createdAt} />}
        <CreationProgress run={run} />
        {state.detail && <p>{state.detail}</p>}
        <ContextCompactions items={run.contextCompactions} activity={run.activity} running={run.status === 'running'} />
      </div>
      {state.recovery && (
        <div className="tag-actions">
          {state.recovery === 'resume' && <RunRecoveryButton run={run} disabled={disabled} act={act} onInspect={() => onReview(run.id)} />}
          {state.recovery === 'resume' && onEdit && run.failure?.code === 'REPAIR_EXHAUSTED' && (
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
        <p>本任务推理强度：{reasoningLabel(run.reasoningEfforts?.[run.profileId])}</p>
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

export function CreationChecks({ title, items, processing = false }: { title: string; items: CreationCheckItem[]; processing?: boolean }) {
  if (!items.length) return null;
  const required = items.filter((i) => i.kind === 'blocking'),
    suggestions = items.filter((i) => i.kind !== 'blocking');
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
  if (processing) return (
    <details className="creation-checks">
      <summary>{title} · 正在处理检查意见，暂不需要你操作</summary>
      {list(items)}
    </details>
  );
  return (
    <div className="creation-checks">
      {required.length > 0 && (
        <div className="creation-required-checks">
          <strong>
            {title} · {required.length} 项
            需调整的内容
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
