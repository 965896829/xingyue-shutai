"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@reference/lib/api";
import { useToast } from "./ui";

const statuses: Record<string, string> = { matched: "一致", missing_local: "本地未找到调用", missing_invoice: "账单缺少调用", unknown_local_usage: "本地费用仍待核对", currency_mismatch: "币种不同", amount_mismatch: "金额不同", usage_mismatch: "用量不同", duplicate_invoice_id: "账单请求 ID 重复", ambiguous_local_id: "本地请求 ID 不唯一" };
export function SupplierBills() {
  const [open, setOpen] = useState(false), [platform, setPlatform] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [text, setText] = useState(""), [busy, setBusy] = useState(false);
  const toast = useToast(), cache = useQueryClient();
  const platforms = useQuery<any>({ queryKey: ["bill-platforms"], queryFn: () => api("/admin/supplier-bills/platforms"), enabled: open });
  const reports = useQuery<any>({ queryKey: ["supplier-bills"], queryFn: () => api("/admin/supplier-bills"), enabled: open });
  async function compare() {
    setBusy(true);
    try { await post("/admin/supplier-bills", { platform_id: platform, period_from: new Date(from).toISOString(), period_to: new Date(to).toISOString(), csv_text: text }); await cache.invalidateQueries({ queryKey: ["supplier-bills"] }); toast("账单差异已记录"); }
    catch (error) { toast((error as Error).message, true); }
    finally { setBusy(false); }
  }
  return <details className="panel mw" onToggle={(e) => setOpen(e.currentTarget.open)} style={{ padding: 20, marginBottom: 20 }}>
    <summary>供应商账单与实际用量核对</summary>
    <p>按供应商请求 ID 对照真实调用，分别统计币种。核对报告不会改写扣费账本；沙箱调用不参与账单匹配。</p>
    <div className="mw-grid">
      <label>供应商平台<select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">请选择</option>{platforms.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>开始时间（本地时间）<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>结束时间（不含该时刻）<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
    </div>
    <label>账单 CSV 文件<input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { if (f.size > 2000000) { toast("账单文件不能超过 2 MB", true); return; } setText(await f.text()); } }} /></label>
    <label>CSV 内容<textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"request_id,amount,currency,input_tokens,output_tokens\n"} /></label>
    <button className="mw-button" disabled={busy || !platform || !from || !to || !text} onClick={compare}>核对并保存报告</button>
    {(reports.isError || platforms.isError) && <p role="alert">无法读取账单报告或供应商列表，请检查权限。</p>}
    {reports.data?.items.map((r: any) => <details key={r.id} className="pw-card"><summary>{r.name} · {r.matched ? "全部匹配" : "存在待核对项"}</summary>
      <p>{Object.entries(r.counts).map(([key, value]) => `${statuses[key] || key}：${value}`).join("；")}</p>
      <p>{Object.entries(r.invoice_totals_by_currency).map(([key, value]) => `${key} ${value}`).join("；")}</p>
      {r.items.map((item: any, i: number) => <p key={i}>{item.request_id || item.local_ids?.join(",")} · {statuses[item.status]} · 账单 {item.billed_amount ?? "—"} {item.currency} / 本地 {item.local_amount ?? "—"} {item.local_currency}</p>)}
    </details>)}
  </details>;
}
