"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { ErrorState, Spinner } from "./ui";
import { Choices, type Options } from "./builtin-agent-capabilities";

export type PublishScope = { mode: "all" | "trial"; project_ids: string[]; user_ids: string[]; percentage: number };
export const fullRelease: PublishScope = { mode: "all", project_ids: [], user_ids: [], percentage: 0 };
export function PublishOptions({ value, options, onChange }: { value: PublishScope; options?: Options; onChange: (v: PublishScope) => void }) {
  return <>
    <label className="field"><span>发布范围</span><select aria-label="发布范围" value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as PublishScope["mode"] })}><option value="all">所有新任务</option><option value="trial">小范围试用</option></select></label>
    {value.mode === "trial" && <>
      <label className="field"><span>随机试用比例（%）</span><input aria-label="随机试用比例" type="number" min={0} max={99} value={value.percentage} onChange={e => onChange({ ...value, percentage: Number(e.target.value) })} /></label>
      <Choices label="指定作品" values={value.project_ids} items={options?.projects.map(p => ({ id: p.id, name: p.title })) || []} onChange={v => onChange({ ...value, project_ids: v })} />
      <Choices label="指定用户" values={value.user_ids} items={options?.users || []} onChange={v => onChange({ ...value, user_ids: v })} />
      <p className="ref-field-help">命中任一范围的新任务使用试用版本，其他任务继续使用当前正式版本。</p>
    </>}
  </>;
}
const labels: Record<string, string> = { name: "名称", description: "描述", system_prompt: "系统提示词", task_prompt: "任务提示词", user_prompt_template: "用户提示词", output_instruction: "输出要求", output_schema: "输出格式", model: "模型", temperature: "温度", max_tokens: "输出上限", budget: "额度上限", enabled: "启用状态", sources: "参考与能力", execution: "执行方式", parameters: "任务参数", inherit_shared: "共享提示词" };
export function DraftComparison({ before, after }: { before: object; after: object }) {
  const old = before as Record<string, unknown>, next = after as Record<string, unknown>;
  const changes = Object.keys(next).filter(key => JSON.stringify(old[key]) !== JSON.stringify(next[key]));
  return <details className="builtin-diff"><summary>发布前检查改动（{changes.length} 项）</summary>{changes.length ? changes.map(key => <section key={key}><strong>{labels[key] || key}</strong><div><label>当前正式版本<pre>{typeof old[key] === "string" ? String(old[key]) : JSON.stringify(old[key], null, 2)}</pre></label><label>即将发布<pre>{typeof next[key] === "string" ? String(next[key]) : JSON.stringify(next[key], null, 2)}</pre></label></div></section>) : <p>与当前正式版本相同</p>}</details>;
}
export function VersionComparison({ path, revision, onClose }: { path: string; revision: number; onClose: () => void }) {
  const q = useQuery<{ current_revision: number; changes_from_current: { field: string; before: unknown; after: unknown }[] }>({ queryKey: ["builtin-version-diff", path, revision], queryFn: () => api(`${path}/versions/${revision}`), staleTime: 0 });
  const show = (v: unknown) => typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return <Modal title={`版本 ${revision} 与正式版本比较`} onClose={onClose}>{q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : <div className="builtin-diff"><p>当前正式版本 {q.data!.current_revision} → 查看版本 {revision}</p>{q.data!.changes_from_current.length ? q.data!.changes_from_current.map(c => <section key={c.field}><strong>{labels[c.field.split(".")[0]] || c.field} · {c.field}</strong><div><label>当前正式版本<pre>{show(c.before)}</pre></label><label>所选版本<pre>{show(c.after)}</pre></label></div></section>) : <p>配置相同</p>}</div>}</Modal>;
}
export function VersionMetrics({ path }: { path: string }) {
  const q = useQuery<{ items: { revision: number; calls: number; completed: number; failed: number; uncertain: number; credits: number; latency_ms: number }[] }>({ queryKey: ["builtin-version-metrics", path], queryFn: () => api(path + "/metrics") });
  return <details className="builtin-metrics"><summary>版本运行表现</summary>{q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data?.items.length ? q.data.items.map(r => <p key={r.revision}>版本 {r.revision} · 完成 {r.completed}/{r.calls} 次 · 失败 {r.failed} · 待核对 {r.uncertain}<br />共 {r.credits} 点 · 平均 {r.latency_ms} 毫秒</p>) : <p>尚无真实创作调用。演示与独立测试不计入。</p>}</details>;
}
