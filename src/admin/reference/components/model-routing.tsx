"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@reference/lib/api";
import { ErrorState, Spinner, useToast } from "./ui";

export function ModelRoutingAdmin() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const toast = useToast(), cache = useQueryClient();
  const report = useQuery({ queryKey: ["model-routing"], queryFn: () => api("/admin/model-routing"), enabled: open });
  return <details className="pw-card" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>根据人工盲评选择模型</summary>
    {open && (report.isPending ? <Spinner /> : report.error ? <ErrorState error={report.error} /> : <>
      <p>{report.data.note}</p>
      {!report.data.items.length && <p>暂无单独授权的真实模型有效评分。沙箱样本不产生路由结论。</p>}
      {report.data.items.map((r: any) => <article className="ref-box" key={r.id}>
        <h4>{r.genre || "未定题材"} · 正文生成</h4>
        <p>{r.models.join(" / ")}</p>
        <p>训练：{r.train.works} 本 / {r.train.pairs} 对；留出验证：{r.validation.works} 本 / {r.validation.pairs} 对。</p>
        <p>首个模型留出偏好率：{r.validation.preference_a == null ? "—" : `${(r.validation.preference_a * 100).toFixed(1)}%`}；95% 区间：{r.validation.work_bootstrap_95?.join(" 至 ") || "数据不足"}</p>
        <p>{r.eligible ? `推荐 ${r.recommended_model}，${r.active ? "已启用" : "等待启用或证据已变化"}` : "证据不足或留出验证未通过，保持人工选择。"}</p>
        <button className="button secondary" disabled={busy || (!r.active && !r.eligible)} onClick={async () => {
          setBusy(true);
          try {
            await post(`/admin/model-routing/${r.id}`, { expected_version: r.policy_version, fingerprint: r.fingerprint, enabled: !r.active });
            await cache.invalidateQueries({ queryKey: ["model-routing"] });
            toast(r.active ? "路由已停用" : "已允许作者选用此路由");
          } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
        }}>{r.active ? "停用路由" : "启用经过验证的路由"}</button>
      </article>)}
    </>)}
  </details>;
}

export function AuthorModelTrials({ pid }: { pid: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ model_a: "", model_b: "", chapter: 1, per_model_budget: 50, instruction: "", reviewer: "", consent: false });
  const toast = useToast(), cache = useQueryClient();
  const base = `/studio/projects/${pid}`;
  const options = useQuery({ queryKey: ["trial-model-options"], queryFn: () => api("/creation/options"), enabled: open });
  const reviewers = useQuery({ queryKey: ["evaluators"], queryFn: () => api("/evaluations/reviewers"), enabled: open });
  const trials = useQuery({ queryKey: ["model-trials", pid], queryFn: () => api(`${base}/model-trials`), enabled: open,
    refetchInterval: q => open && q.state.data?.items.some((t: any) => t.runs.some((r: any) => ["queued", "running"].includes(r.state))) ? 2500 : false });
  const routes = useQuery({ queryKey: ["project-model-routing", pid], queryFn: () => api(`${base}/model-routing`), enabled: open });
  const execute = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await action(); await cache.invalidateQueries({ queryKey: ["model-trials", pid] }); await cache.invalidateQueries({ queryKey: ["evaluations"] }); toast(message); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  return <details className="pw-card" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>比较两个模型的写法</summary>
    {open && <>
      <p>用相同的要求和用量上限写两版，由你比较选择。</p>
      {options.error && <ErrorState error={options.error} />}
      <div className="ref-form two-columns">
        {(["model_a", "model_b"] as const).map((key, i) => <label className="field" key={key}>对照模型 {i + 1}
          <select value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}><option value="">请选择</option>
            {options.data?.models.map((m: any) => <option key={m.id} value={m.id} disabled={!m.available}>{m.name}{m.environment === "sandbox" ? " · 演示模式" : ""}</option>)}
          </select>
        </label>)}
        <label className="field">章节<input type="number" min={1} max={99999} value={form.chapter} onChange={e => setForm({ ...form, chapter: Number(e.target.value) })} /></label>
        <label className="field">每个模型预算（算力）<input type="number" min={1} max={5000} value={form.per_model_budget} onChange={e => setForm({ ...form, per_model_budget: Number(e.target.value) })} /></label>
      </div>
      <label className="field">共同写作要求<textarea value={form.instruction} maxLength={8000} onChange={e => setForm({ ...form, instruction: e.target.value })} /></label>
      <button className="button secondary" disabled={busy || !form.model_a || !form.model_b || form.model_a === form.model_b || form.per_model_budget < 1} onClick={() => execute(() => post(`${base}/model-trials`, {
        model_a: form.model_a, model_b: form.model_b, chapter: form.chapter, per_model_budget: form.per_model_budget, instruction: form.instruction,
      }), "双模型运行已排队")}>启动对照，总预算上限 {form.per_model_budget * 2} 算力</button>
      <label className="field">授权评测人员<select value={form.reviewer} onChange={e => setForm({ ...form, reviewer: e.target.value })}><option value="">请选择</option>{reviewers.data?.items.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      {reviewers.data?.items.length === 0 && <p>当前没有评测账号，需要管理员创建评测人员。</p>}
      <label><input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} /> 我授权所选人员阅读此次两份全文，并授权本站使用匿名评分和模型信息改进路由。可在“授权人工盲评”中撤回。</label>
      {trials.error && <ErrorState error={trials.error} />}
      {trials.data?.items.map((t: any) => <article className="ref-box" key={t.id}>
        <h4>第 {t.chapter} 章 · 每个模型 {t.budget_each} 算力上限</h4>
        {t.runs.map((r: any) => <p key={r.id}>{r.model}：{({ queued: "排队中", running: "生成中", succeeded: "已完成", failed: "失败", stale: "已过期", cancelled: "已取消", pending_reconciliation: "等待费用核对" } as Record<string, string>)[r.state] || r.state} · 已结算 {r.cost} 算力</p>)}
        <button className="button secondary" disabled={busy || !form.consent || !form.reviewer || t.has_pair || t.runs.length !== 2 || t.runs.some((r: any) => r.state !== "succeeded" || !r.artifact_id)} onClick={() => execute(() => post(`${base}/evaluation-pairs`, {
          title: `第 ${t.chapter} 章模型对照`, baseline_id: t.runs[0].artifact_id, enhanced_id: t.runs[1].artifact_id, reviewer_ids: [form.reviewer], consent: true, routing_trial_id: t.id, routing_consent: true,
        }), "匿名样本已分配")}>{t.has_pair ? "已授权评分" : "授权本次全文并分配盲评"}</button>
      </article>)}
      <h4>适合这本书的模型</h4>
      {routes.error ? <ErrorState error={routes.error} /> : !routes.data?.items.length ? <p>还没有足够评价，暂时由你选择模型。</p> : routes.data.items.map((r: any) => <p key={r.id}>
        {r.model} · 留出 {r.validation.works} 本作品。
        <button className="button secondary" disabled={busy || form.per_model_budget < 1} onClick={() => execute(() => post(`${base}/model-routing/run`, { route_id: r.id, expected_version: r.version, chapter: form.chapter, budget: form.per_model_budget, instruction: form.instruction }), "已按验证路由创建正文候选")}>用这个模型写第 {form.chapter} 章（上限 {form.per_model_budget} 算力）</button>
      </p>)}
    </>}
  </details>;
}
