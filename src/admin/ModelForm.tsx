import { ReasoningSlider } from '../ui/ModelControl';
import { NetworkRecoverySettings } from '../ui/NetworkRecoverySettings';
import { useState } from 'react';
import { useManagement } from './ManagementContext';
import { invokeCommand } from '../shared/client';
import { navigate } from './reference/router';
import { Modal } from './reference/components/reference-ui';
import { useToast } from './reference/components/ui';
import type { DataRecord } from './reference/lib/api';

export function ModelForm({ record, onClose, onDone }: { record?: DataRecord; onClose(): void; onDone(): void }) {
  const { snapshot, refresh } = useManagement(), toast = useToast();
  const [profile, setProfile] = useState(() => (snapshot?.savedProfiles ?? snapshot?.profiles)?.find(p => p.id === record?.id));
  const [busy, setBusy] = useState(false);
  if (!profile) return <Modal title="添加模型" onClose={onClose}><p>每个模型属于一个 API 平台。请在平台管理中添加平台，或编辑已有平台的「模型」页签。</p><button className="button primary" onClick={() => { onClose(); navigate('/admin/platform/platforms'); }}>前往平台管理</button></Modal>;
  return <Modal wide title={`编辑模型 · ${profile.model}`} onClose={() => !busy && onClose()} footer={<button className="button primary" disabled={busy} onClick={async () => {
    setBusy(true); try { await invokeCommand('profiles.save', { profile }); await refresh(); onDone(); onClose(); toast('模型已保存到客户端'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }}>保存</button>}><div className="parity-grid">
    <label className="local-label">模型 ID<input value={profile.model} onChange={e => setProfile({ ...profile, model: e.target.value })} /></label>
    {(['contextLimit', 'outputLimit', 'timeoutSeconds', 'inputPrice', 'outputPrice'] as const).map((key, i) => <label className="local-label" key={key}>{['上下文容量', '输出上限', '响应等待上限（秒）', '输入单价 / 百万 Token', '输出单价 / 百万 Token'][i]}<input type="number" value={profile[key] ?? ''} min={i > 2 ? 0 : 1} onChange={e => setProfile({ ...profile, [key]: e.target.value === '' && i > 2 ? null : Number(e.target.value), ...(i < 2 ? { limitMode: 'manual' } : {}) })} />{key === 'timeoutSeconds' && <small>流式按连续无生成进展计时；非流式按整次请求计时。</small>}</label>)}
    <label className="local-label">币种<input value={profile.currency} onChange={e => setProfile({ ...profile, currency: e.target.value })} /></label>
    <NetworkRecoverySettings value={profile.networkRecovery} onChange={value => setProfile({ ...profile, networkRecovery: value })} />
    {(['enabled', 'stream', 'tools'] as const).map((key, i) => <label className="local-label" key={key}><span><input type="checkbox" checked={profile[key]} onChange={e => setProfile({ ...profile, [key]: e.target.checked })} />{['启用模型', '流式输出', '允许工具调用'][i]}</span></label>)}
  </div>{profile.protocol !== 'images' && <ReasoningSlider profile={profile} value={profile.reasoningEffort ?? null} onChange={value => setProfile({ ...profile, reasoningEffort: value })} disabled={busy} note="保存后用于该模型的新消息和新任务。" />}<p className="ref-field-help">客户端使用上述参数。平台收费折扣、租户权限与自动路由尚未接入。</p></Modal>;
}
