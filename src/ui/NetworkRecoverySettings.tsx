import type { Profile } from '../shared/types';
import './NetworkRecoverySettings.css';

export function NetworkRecoverySettings({ value, onChange }: { value: Profile['networkRecovery']; onChange: (value: NonNullable<Profile['networkRecovery']>) => void }) {
  const policy = value ?? { maxRetries: 2, retryUnknown: false };
  return <div className="network-recovery-settings">
    <label>连接故障自动恢复次数
      <select value={policy.maxRetries} onChange={e => onChange({ ...policy, maxRetries: Number(e.target.value) })}>
        {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? '关闭' : `最多 ${n} 次`}</option>)}
      </select>
    </label>
    <label className="network-recovery-consent"><input type="checkbox" checked={policy.retryUnknown} disabled={policy.maxRetries === 0} onChange={e => onChange({ ...policy, retryUnknown: e.target.checked })} /><span>允许对结果未知的临时网络错误重新请求（可能重复计费）</span></label>
  </div>;
}
