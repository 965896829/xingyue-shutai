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

