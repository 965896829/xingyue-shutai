import { useDialogs } from '../ui/AppDialogs';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, FolderOpen, Plus, RefreshCw, Sparkles, ExternalLink } from 'lucide-react';
import { invokeCommand } from '../shared/client';
import { useManagement } from './ManagementContext';
import { navigate } from './reference/router';
import { CompactHeading, Modal, SearchBox, RefEmpty } from './reference/components/reference-ui';
import { ErrorState, Spinner, useToast } from './reference/components/ui';
import type { PageSpec } from './reference/lib/api';
import type { RoleRule } from '../shared/assistant';
import type { Profile } from '../shared/types';
import { localViews } from './ClientModule';
import { Logs } from './Logs';

const go = (view: string) => navigate('/admin/local/' + view);
export const localPageKeys = new Set(['projects', 'agents', 'rules', 'desktop-skills', 'templates', 'knowledge', 'realtime-load', 'expenses', 'logs', 'audit', 'chat-audits', 'desktop-devices', 'pricing', 'runtime-policies']);
export function LocalPage({ page }: { page: PageSpec }) {
  const { snapshot, transport } = useManagement();
  if (localViews[page.key]) return null;
  if (page.key === 'projects') return <Projects />;
  if (page.key === 'agents') return <Agents />;
  if (page.key === 'knowledge') return <Knowledge />;
  if (['rules', 'desktop-skills', 'templates'].includes(page.key)) return <Resources tags={page.key === 'templates'} />;
  if (['pricing', 'runtime-policies'].includes(page.key)) return <ModelRuntime pricing={page.key === 'pricing'} />;
  if (['logs', 'audit', 'chat-audits'].includes(page.key)) return <Logs transport={transport} snapshot={snapshot} />;
  if (page.key === 'desktop-devices') return <ClientStatus />;
  return <Runtime costs={page.key === 'expenses'} />;
}
function Knowledge() {
  const { snapshot } = useManagement();
  const [query, setQuery] = useState('');
  function open(path: string) { go('workspace'); setTimeout(() => window.dispatchEvent(new CustomEvent('management:document', { detail: path })), 0); }
  return <div className="ref-page"><CompactHeading title="知识库管理" description="管理当前作品的正式资料。编辑沿用客户端的版本检查与变更联动；平台共享知识库、云端向量库尚未接入。" actions={<><button className="button secondary" onClick={() => go('search')}>检索设置</button><button className="button primary" onClick={() => navigate('/admin/sys/backup-restore')}>导入资料</button></>} /><div className="ref-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="搜索文档路径" /><span>{snapshot?.documents.length ?? 0} 份文档</span></div><div className="ref-collection-grid">{snapshot?.documents.filter(d => d.path.includes(query)).map(d => <article className="ref-box" key={d.path}><BookOpen size={22} /><h3>{d.path}</h3><p>当前作品正式文档</p><button className="button secondary" onClick={() => open(d.path)}>查看与编辑</button></article>)}</div>{!snapshot?.documents.length && <RefEmpty text="打开作品后查看资料，或先导入本机文档。" />}</div>;
}
function Projects() {
  const { snapshot, refresh } = useManagement(), toast = useToast();
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); await refresh(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } };
  return <div className="ref-page">
    <CompactHeading title="作品与运行" description="在本机打开作品，管理文稿、任务与创作进度。" actions={<>
      <button className="button secondary" disabled={busy} onClick={() => void act(async () => { const root = await invokeCommand('app.chooseDirectory'); if (root) { await invokeCommand('project.open', { root }); go('workspace'); } })}><FolderOpen size={14} />打开作品</button>
      <button className="button primary" onClick={() => { go('workspace'); setTimeout(() => window.dispatchEvent(new CustomEvent('management:navigate', { detail: 'new' })), 0); }}><Plus size={14} />新建作品</button>
    </>} />
    <div className="ref-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="搜索作品名称或目录" /><span className="ref-spacer" /><button className="button secondary" onClick={() => void refresh()}><RefreshCw size={14} />刷新</button><button className="button secondary" onClick={() => go('trash')}>作品回收站</button></div>
    <div className="ref-table-wrap"><table className="ref-table"><thead><tr><th>作品</th><th>保存目录</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {snapshot?.recent.filter(p => `${p.title} ${p.root}`.toLowerCase().includes(query.toLowerCase())).map(p => <tr key={p.root}>
        <td><strong>{p.title}</strong></td><td className="local-path">{p.root}</td><td>{snapshot.project?.root === p.root ? `${snapshot.project.stage} · 第 ${snapshot.project.chapter} 章` : '未打开'}</td>
        <td><button className="button secondary" disabled={busy} onClick={() => void act(async () => { if (snapshot.project?.root !== p.root) await invokeCommand('project.open', { root: p.root }); go('workspace'); })}>进入作品<ExternalLink size={13} /></button></td>
      </tr>)}
    </tbody></table></div>
    {!snapshot?.recent.length && <RefEmpty text="还没有作品。新建作品或打开本机已有作品目录。" />}
    {snapshot?.project && <section className="ref-box local-project-card"><h3>{snapshot.project.title}</h3><p>{snapshot.project.stage} · 第 {snapshot.project.chapter} 章 · 正式版本 {snapshot.project.revision} · {snapshot.documents.length} 份文档</p><div className="ref-actions">
      <button className="button secondary" onClick={() => go('creation')}>作品方案与书名</button><button className="button secondary" onClick={() => navigate('/admin/novel/workflows')}>任务与审核</button><button className="button secondary" onClick={() => navigate('/admin/agent-memory')}>人物与记忆</button><button className="button secondary" onClick={() => navigate('/admin/sys/backup-restore')}>导出与备份</button>
      <button className="button secondary" disabled={busy} onClick={() => void act(() => invokeCommand('project.close'))}>关闭作品</button>
    </div></section>}
  </div>;
}
function Agents() {
  const q = useQuery({ queryKey: ['local-roles'], queryFn: () => invokeCommand('assistant.settings') }), toast = useToast();
  const [role, setRole] = useState<RoleRule>(), [text, setText] = useState(''), [busy, setBusy] = useState(false), [version, setVersion] = useState('');
  async function save(reset = false) {
    if (!role || busy) return; setBusy(true);
    try { if (reset) await invokeCommand('assistant.role.reset', { id: role.id }); else await invokeCommand('assistant.role.save', { id: role.id, text }); await q.refetch(); setRole(undefined); toast('角色规则已保存到客户端'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return <div className="ref-page ref-agent-page"><CompactHeading title="智能体管理" description="客户端实际使用的角色规则。修改后用于后续任务，历史任务保留原绑定版本。" actions={<button className="button secondary" onClick={() => go('search')}>联网与语义检索</button>} />
    {q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : <div className="ref-collection-grid local-agent-grid">{q.data.roles.map(r => <article className="ref-box" key={r.id}><Sparkles size={24} /><h3>{r.title}</h3><p>{r.summary}</p><p className="muted">当前版本 {r.current.id.slice(0, 12)} · {r.history.length} 条历史</p><button className="button primary" onClick={() => { setRole(r); setText(r.current.text); setVersion(''); }}>编辑智能体</button></article>)}</div>}
    {role && <Modal wide title={role.title} subtitle={role.summary} onClose={() => !busy && setRole(undefined)} footer={<><button className="button secondary" disabled={busy} onClick={() => void save(true)}>恢复内置规则</button><button className="button primary" disabled={busy || !text.trim()} onClick={() => void save()}>保存角色规则</button></>}><label className="local-label">专业提示词<textarea rows={17} value={text} onChange={e => setText(e.target.value)} /></label><label className="local-label">查看历史版本<select value={version} onChange={e => { setVersion(e.target.value); const h = role.history.find(v => v.id === e.target.value); if (h) setText(h.text); }}><option value="">选择历史版本，载入后可编辑保存</option>{role.history.map(v => <option key={v.id} value={v.id}>{new Date(v.at).toLocaleString()} · {v.reason}</option>)}</select></label></Modal>}
  </div>;
}
function Resources({ tags }: { tags: boolean }) {
  const q = useQuery<unknown>({ queryKey: ['local-resources', tags], queryFn: async () => tags ? await invokeCommand('tags.catalog') : await invokeCommand('skills.list') });
  const [query, setQuery] = useState(''), [detail, setDetail] = useState<any>();
  const value = q.data as any;
  const rows: any[] = Array.isArray(value) ? value : value?.options ?? value?.taxonomy?.options ?? [];
  return <div className="ref-page"><CompactHeading title={tags ? '题材与创作模板' : '提示词与规则'} description="读取客户端安装包中的实际资源及版本；作品方案选择与运行仍使用现有 11 阶段。" actions={<button className="button primary" onClick={() => go('creation')}>前往作品方案</button>} /><div className="ref-toolbar"><SearchBox value={query} onChange={setQuery} placeholder="搜索名称、阶段或内容" /><span>{rows.length} 项</span></div>{q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : <div className="ref-table-wrap"><table className="ref-table"><thead><tr><th>名称</th><th>分类 / 阶段</th><th>内容</th><th>操作</th></tr></thead><tbody>{rows.filter(x => JSON.stringify(x).includes(query)).map((r, i) => <tr key={r.id ?? r.optionId ?? i}><td>{r.title ?? r.label ?? r.name ?? r.optionId}</td><td>{r.stage ?? r.group ?? r.field ?? '标签'}</td><td>{r.description ?? r.conceptId ?? r.contract?.slice(0, 100)}</td><td><button className="button secondary" onClick={() => setDetail(r)}>详情</button></td></tr>)}</tbody></table></div>}{detail && <Modal wide title={detail.title ?? detail.label ?? detail.name ?? '资源详情'} onClose={() => setDetail(undefined)}><pre className="local-json">{detail.contract ?? JSON.stringify(detail, null, 2)}</pre></Modal>}</div>;
}
function ModelRuntime({ pricing }: { pricing: boolean }) {
  const { snapshot, refresh } = useManagement(), toast = useToast();
  const [p, setP] = useState<Profile>(), [busy, setBusy] = useState(false);
  const rows = snapshot?.savedProfiles ?? snapshot?.profiles ?? [];
  return <div className="ref-page"><CompactHeading title={pricing ? '定价规则' : '运行策略'} description={pricing ? '维护客户端的输入、输出成本估算单价，按百万 Token 计算。平台收费、折扣和结算尚未接入。' : '管理客户端已实现的模型参数。平台并发池、自动回退和账号轮换尚未接入。'} /><div className="ref-table-wrap"><table className="ref-table"><thead><tr><th>模型 / 平台</th><th>{pricing ? '输入单价' : '上下文 / 输出上限'}</th><th>{pricing ? '输出单价' : '超时 / 流式 / 工具'}</th><th>操作</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.model}</strong><small className="ref-row-subtitle">{r.name}</small></td><td>{pricing ? `${r.inputPrice ?? '未配置'} ${r.currency}` : `${r.contextLimit} / ${r.outputLimit}`}</td><td>{pricing ? `${r.outputPrice ?? '未配置'} ${r.currency}` : `${r.timeoutSeconds}s / ${r.stream ? '开' : '关'} / ${r.tools ? '开' : '关'}`}</td><td><button className="button secondary" onClick={() => setP({ ...r })}>编辑</button></td></tr>)}</tbody></table></div>{!rows.length && <RefEmpty text="请先在平台管理接入 API 和模型。" />}
    {p && <Modal wide title={`${pricing ? '编辑成本估算' : '编辑运行策略'} · ${p.model}`} onClose={() => !busy && setP(undefined)} footer={<button className="button primary" disabled={busy} onClick={async () => { setBusy(true); try { await invokeCommand('profiles.save', { profile: p }); await refresh(); setP(undefined); toast('配置已保存到客户端'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); } }}>保存</button>}><div className="parity-grid">
      {(pricing ? [['inputPrice', '输入单价 / 百万 Token'], ['outputPrice', '输出单价 / 百万 Token']] : [['contextLimit', '上下文容量'], ['outputLimit', '输出上限'], ['timeoutSeconds', '响应等待上限（秒）']]).map(([key, label]) => <label className="local-label" key={key}>{label}<input type="number" min={pricing ? 0 : 1} value={(p as any)[key] ?? ''} onChange={e => setP({ ...p, [key]: e.target.value === '' ? null : Number(e.target.value), ...(!pricing && key !== 'timeoutSeconds' ? { limitMode: 'manual' } : {}) })} />{key === 'timeoutSeconds' && <small>流式按连续无生成进展计时；非流式按整次请求计时。</small>}</label>)}
      {pricing ? <label className="local-label">币种<input value={p.currency} onChange={e => setP({ ...p, currency: e.target.value })} /></label> : <>{(['stream', 'tools'] as const).map(key => <label className="local-label" key={key}><span><input type="checkbox" checked={p[key]} onChange={e => setP({ ...p, [key]: e.target.checked })} />{key === 'stream' ? '流式输出' : '允许模型工具调用'}</span></label>)}</>}
    </div></Modal>}
  </div>;
}
function Runtime({ costs }: { costs: boolean }) {
  const { snapshot, refresh } = useManagement(), toast = useToast();
  const runs = snapshot?.runs ?? [];
  return <div className="ref-page"><CompactHeading title={costs ? '消费记录' : '实时负载'} description="当前作品已载入任务的真实用量和状态；不同币种分别展示，未知用量显示为未报告。" actions={<button className="button secondary" onClick={() => void refresh()}><RefreshCw size={14} />刷新</button>} /><div className="ref-table-wrap"><table className="ref-table"><thead><tr><th>任务</th><th>状态</th><th>输入 / 输出 Token</th><th>估算成本</th><th>操作</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td>{r.stage} · 第 {r.chapter} 章<small className="ref-row-subtitle">{r.id}</small></td><td>{r.status}</td><td>{r.usage.input ?? '未报告'} / {r.usage.output ?? '未报告'}</td><td>{r.usage.cost ?? '未配置'} {r.usage.currency}</td><td>{r.status === 'running' ? <button className="button secondary" onClick={async () => { try { await invokeCommand('run.cancel', { id: r.id }); await refresh(); } catch (e) { toast((e as Error).message, true); } }}>停止任务</button> : <button className="button secondary" onClick={() => navigate('/admin/novel/workflows')}>查看任务</button>}</td></tr>)}</tbody></table></div>{!runs.length && <RefEmpty text="打开作品后查看运行记录。" />}</div>;
}
function ClientStatus() {
  const dialogs = useDialogs();
  const { client, snapshot, refresh } = useManagement(), toast = useToast();
  return <div className="ref-page"><CompactHeading title="客户端授权管理" description="当前管理本机客户端，所有网页会话使用一次性授权链接。" actions={<button className="button secondary" onClick={() => void refresh()}>刷新</button>} /><div className="ref-table-wrap"><table className="ref-table"><thead><tr><th>客户端</th><th>版本</th><th>设备 ID</th><th>授权会话</th><th>执行内核</th></tr></thead><tbody><tr><td>{client.name}</td><td>{client.version}</td><td>{client.clientId}</td><td>{client.sessions}</td><td>{client.workerState}</td></tr></tbody></table></div><div className="ref-actions local-project-card"><button className="button secondary" disabled={!snapshot?.project} onClick={async () => { try { const result = await invokeCommand('diagnostics.export'); const url = URL.createObjectURL(new Blob([result], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = '星月书台-诊断.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { toast((e as Error).message, true); } }}>导出作品诊断</button><button className="button secondary" onClick={async () => { if (await dialogs.confirm('断开全部网页授权？客户端中的任务将继续运行。', { title: '撤销所有网页授权？', confirmLabel: '撤销授权' })) try { await invokeCommand('management.revoke'); } catch (e) { toast((e as Error).message, true); } }}>撤销所有网页授权</button></div></div>;
}
