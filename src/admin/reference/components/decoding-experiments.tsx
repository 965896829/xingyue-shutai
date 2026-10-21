"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@reference/lib/api";
import { Spinner, ErrorState, useToast } from "./ui";

export function DecodingExperiments({ pid }: { pid: string }) {
  const [open, setOpen] = useState(false), [model, setModel] = useState(""), [chapter, setChapter] = useState(1), [instruction, setInstruction] = useState(""), [budget, setBudget] = useState(50), [temperatures, setTemperatures] = useState("0.3, 0.8"), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const toast = useToast(), cache = useQueryClient();
  const options = useQuery({ queryKey: ["studio-options"], queryFn: () => api("/creation/options"), enabled: open });
  const trials = useQuery({ queryKey: ["decoding-trials", pid], queryFn: () => api(`/studio/projects/${pid}/decoding-trials`), enabled: open, refetchInterval: open ? 4000 : false });
  const values = temperatures.split(/[,，]/).map((s) => Number(s.trim())), valid = values.length >= 2 && values.length <= 4 && new Set(values).size === values.length && values.every((v) => Number.isFinite(v) && v >= 0 && v <= 2);
  return <details className="pw-card" onToggle={(e) => setOpen(e.currentTarget.open)}><summary>比较不同的创作方式</summary>{open && <>
    <p>按同样的要求多写几版，由你比较选择。</p>
    <label className="field">模型<select value={model} onChange={(e) => setModel(e.target.value)}><option value="">请选择创作模型</option>{options.data?.models.map((m: any) => <option key={m.id} value={m.id} disabled={!m.available}>{m.name || m.id}</option>)}</select></label>
    <div className="mw-grid"><label className="field">章节<input type="number" min={1} max={99999} value={chapter} onChange={(e) => setChapter(Number(e.target.value))} /></label><label className="field">每版用量上限（点）<input type="number" min={1} value={budget} onChange={(e) => { setBudget(Number(e.target.value)); setConfirmed(false); }} /></label></div>
    <label className="field">创作自由度（0–2，填写 2–4 个数，以逗号分隔）<input value={temperatures} onChange={(e) => { setTemperatures(e.target.value); setConfirmed(false); }} /></label>
    <label className="field">统一创作要求<textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} /></label>
    <label className="mw-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />确认本组 {valid ? values.length : "—"} 版正文，总上限 {valid ? budget*values.length : "—"} 点</label>
    <button className="button primary" disabled={busy || !confirmed || !valid || !model || !instruction.trim()} onClick={async () => {
      setBusy(true); try { await post(`/studio/projects/${pid}/decoding-trials`, { chapter, model, instruction, per_variant_budget: budget, variants: values.map((temperature) => ({ temperature })), confirm_budget: confirmed }); await cache.invalidateQueries({ queryKey: ["decoding-trials", pid] }); toast("解码对照已排队"); setConfirmed(false); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
    }}>写几版来比较</button>
    {trials.isPending && <Spinner />}{trials.error && <ErrorState error={trials.error} />}
    {trials.data?.items.map((trial: any) => <article className="pw-card" key={trial.id}><h4>{trial.name}</h4><p>{trial.context_comparable ? "使用了相同的参考内容。" : trial.comparison_status === "pending" ? "还有正文未写完。" : "参考内容有变化，请重新比较。"}文字相似程度：{trial.text_similarity === null ? "—" : `${(trial.text_similarity*100).toFixed(1)}%`}。</p>{trial.results.map((r: any) => <details key={r.run_id}><summary>自由度 {r.parameters.temperature} · {({ queued: "排队中", running: "生成中", succeeded: "已完成", failed: "失败", stale: "依据已变化", paused_policy: "配置需处理" } as Record<string,string>)[r.state] || r.state} · {r.cost} 点 {r.environment === "sandbox" && "· 演示模式"}</summary><pre style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>{r.text || "还没有写出正文"}</pre></details>)}</article>)}
  </>}</details>;
}
