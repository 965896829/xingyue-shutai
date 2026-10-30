import { useState } from 'react';
import { growthSystemSchema, type WorldModel } from '../shared/quality';
import { invokeCommand } from '../shared/client';
import { WorkbenchGraph } from './WorkbenchGraph';
type System = NonNullable<WorldModel['systems']>[number];
export function GrowthSystems({ model, baseHash, editable, storageKey, onCandidate }: {
  model: WorldModel; baseHash: string | null; editable: boolean; storageKey: string; onCandidate: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<System>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const systems = model.systems ?? [], existing = systems.find(s => s.id === draft?.id);
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try {
      const { version: priorVersion, ...old } = existing ?? { version: 0 }, { version, ...value } = draft;
      const next = growthSystemSchema.parse({ ...draft, version: existing ? priorVersion + (JSON.stringify(old) === JSON.stringify(value) ? 0 : 1) : 1 });
      const id = await invokeCommand('world.propose', { baseHash, model: { ...model, systems: existing ? systems.map(s => s.id === next.id ? next : s) : [...systems, next] } });
      setDraft(undefined); await onCandidate(id);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <section aria-label="独立成长体系">
    <div className="object-actions">{editable && <button disabled={busy} onClick={() => setDraft({ id: crypto.randomUUID(), title: '', version: 1, state: 'enabled', subjects: [], fromChapter: 0, toChapter: null, original: '', unparsed: [], locked: false, steps: [], interactions: [] })}>新增成长体系</button>}</div>
    {!systems.length && !draft && <p>尚未设置成长体系。</p>}
    {systems.map(system => <article key={system.id}>
      <h3>{system.title} · 第{system.version}版</h3><p>{({ enabled: '启用', disabled: '停用', undecided: '未定' })[system.state]} · {system.subjects.join('、') || '未限定人物或阵营'} · {system.fromChapter}章起{system.toChapter === null ? '' : `，至${system.toChapter}章`}{system.locked ? ' · 已固定' : ''}</p>
      {system.steps.length > 0 && <WorkbenchGraph label={`${system.title}成长路径`} storageKey={`${storageKey}:${system.id}`} nodes={system.steps.slice(0, 60).map(s => ({ id: s.id, title: s.title }))} edges={system.steps.slice(0, 60).flatMap(s => s.prerequisites.filter(id => system.steps.slice(0, 60).some(n => n.id === id)).map(id => ({ id: `${id}:${s.id}`, from: id, to: s.id, label: '前置' })))} onSelect={id => { if (editable) setDraft(structuredClone(system)); document.getElementById(`growth-${id}`)?.scrollIntoView({ block: 'nearest' }); }} />}
      {system.steps.length > 60 && <p>图中展示前60个阶段，完整阶段见编辑列表。</p>}
      <ul>{system.steps.slice(0, 60).map(step => <li key={step.id}>{step.title}：{step.ability || '能力未定'}；{step.boundary || '边界未定'}</li>)}</ul>
      {!!system.interactions.length && <p>{system.interactions.map(i => `${systems.find(s => s.id === i.targetSystemId)?.title ?? '未知体系'}：${i.rule}`).join('；')}</p>}
      {!!system.unparsed.length && <details><summary>待解析原文</summary>{system.unparsed.map((text, i) => <p key={i}>{text}</p>)}</details>}
      {editable && <button disabled={busy} onClick={() => setDraft(structuredClone(system))}>编辑体系</button>}
    </article>)}
    {draft && <form className="form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="form-grid"><label>体系名称<input required value={draft.title} disabled={draft.locked} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>状态<select value={draft.state} disabled={draft.locked} onChange={e => setDraft({ ...draft, state: e.target.value as System['state'] })}><option value="enabled">启用</option><option value="disabled">停用</option><option value="undecided">未定</option></select></label></div>
      <label><input type="checkbox" checked={draft.locked} onChange={e => setDraft({ ...draft, locked: e.target.checked })} />固定此体系</label>
      <label>适用人物或阵营<input value={draft.subjects.join('、')} disabled={draft.locked} onChange={e => setDraft({ ...draft, subjects: e.target.value.split(/[、,，]/).map(v => v.trim()).filter(Boolean) })} /></label>
      <div className="form-grid"><label>从第几章生效<input type="number" min={0} required value={draft.fromChapter} disabled={draft.locked} onChange={e => setDraft({ ...draft, fromChapter: Number(e.target.value) })} /></label>
      <label>截至第几章<input type="number" min={draft.fromChapter} value={draft.toChapter ?? ''} disabled={draft.locked} onChange={e => setDraft({ ...draft, toChapter: e.target.value ? Number(e.target.value) : null })} /></label></div>
      <details><summary>导入原文与待定内容</summary><label>作者原体系<textarea value={draft.original} disabled={!!existing || draft.locked} onChange={e => setDraft({ ...draft, original: e.target.value })} /></label>
      <label>待解析片段（每行一项）<textarea value={draft.unparsed.join('\n')} disabled={draft.locked} onChange={e => setDraft({ ...draft, unparsed: e.target.value.split('\n').filter(Boolean) })} /></label></details>
      {draft.steps.map((step, index) => <fieldset key={step.id} id={`growth-${step.id}`} disabled={draft.locked || busy}><legend>阶段 {index + 1}</legend>
        <label>阶段名称<input required value={step.title} onChange={e => setDraft({ ...draft, steps: draft.steps.map(s => s.id === step.id ? { ...s, title: e.target.value } : s) })} /></label>
        <label>能力与资格<textarea value={step.ability} onChange={e => setDraft({ ...draft, steps: draft.steps.map(s => s.id === step.id ? { ...s, ability: e.target.value } : s) })} /></label>
        <label>限制与例外<textarea value={step.boundary} onChange={e => setDraft({ ...draft, steps: draft.steps.map(s => s.id === step.id ? { ...s, boundary: e.target.value } : s) })} /></label>
        <details><summary>前置阶段</summary>{draft.steps.filter(s => s.id !== step.id).map(s => <label key={s.id}><input type="checkbox" checked={step.prerequisites.includes(s.id)} onChange={e => setDraft({ ...draft, steps: draft.steps.map(v => v.id === step.id ? { ...v, prerequisites: e.target.checked ? [...v.prerequisites, s.id] : v.prerequisites.filter(id => id !== s.id) } : v) })} />{s.title || '未命名阶段'}</label>)}</details>
        <button type="button" onClick={() => setDraft({ ...draft, steps: draft.steps.filter(s => s.id !== step.id).map(s => ({ ...s, prerequisites: s.prerequisites.filter(id => id !== step.id) })) })}>移除阶段</button>
      </fieldset>)}
      <button type="button" disabled={busy || draft.locked || draft.steps.length >= 100} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { id: crypto.randomUUID(), title: '', ability: '', boundary: '', prerequisites: [] }] })}>添加阶段</button>
      <details><summary>跨体系规则</summary>{systems.filter(s => s.id !== draft.id).map(other => <label key={other.id}>{other.title}<textarea disabled={draft.locked} value={draft.interactions.find(i => i.targetSystemId === other.id)?.rule ?? ''} onChange={e => setDraft({ ...draft, interactions: [...draft.interactions.filter(i => i.targetSystemId !== other.id), ...(e.target.value.trim() ? [{ targetSystemId: other.id, rule: e.target.value }] : [])] })} /></label>)}</details>
      <div className="object-actions"><button type="button" disabled={busy} onClick={() => setDraft(undefined)}>取消</button><button className="primary" disabled={busy}>生成修改候选</button></div>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
