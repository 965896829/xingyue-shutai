import type { Run } from '../shared/types';
import { recoveryDecision } from '../shared/recovery';
import { invokeCommand } from '../shared/client';
import { useDialogs } from './AppDialogs';

export function RunRecoveryButton({ run, disabled, profileId, instruction, act, onRecovered, onInspect }: {
  run: Run; disabled: boolean; profileId?: string; instruction?: string;
  act: (fn: () => Promise<string>) => Promise<unknown>;
  onRecovered?: (id: string) => void;
  onInspect?: () => void;
}) {
  const dialogs = useDialogs(run.id), decision = recoveryDecision(run);
  if (decision.kind === 'none') return null;
  return <button className="primary" disabled={disabled} title={decision.detail} onClick={async () => {
    if (decision.kind === 'inspect' || decision.kind === 'author') { onInspect?.(); return; }
    if (decision.confirmation && !await dialogs.confirm(`上次请求结果与费用未知，请核对任务记录。${decision.detail}`, { title: '恢复当前任务？', confirmLabel: '确认恢复', cancelLabel: '暂不恢复' })) return;
    const result = await act(() => invokeCommand('run.recover', {
      id: run.id, ...(profileId ? { profileId } : {}), retryUnknown: decision.confirmation,
      ...(!run.planning && !run.creative && instruction?.trim() ? { instruction: instruction.trim() } : {})
    }));
    if (typeof result === 'string') onRecovered?.(result);
  }}>{decision.label}</button>;
}
