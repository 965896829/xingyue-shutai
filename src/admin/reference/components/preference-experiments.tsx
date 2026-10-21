"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put } from "@reference/lib/api";
import { Spinner, ErrorState, useToast } from "./ui";
import { GooeyNav } from "./interaction/gooey-nav";

export function PreferenceExperiments({ pid }: { pid: string }) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState(0), [busy, setBusy] = useState(false), [name, setName] = useState("我的写法偏好"), [selected, setSelected] = useState<string[]>([]), [ranking, setRanking] = useState<any>(null);
  const toast = useToast(), cache = useQueryClient(), root = "/studio/experiments";
  const samples = useQuery({ queryKey: ["training-samples"], queryFn: () => api(`${root}/samples`), enabled: open });
  const rankers = useQuery({ queryKey: ["preference-rankers"], queryFn: () => api(`${root}/rankers`), enabled: open });
  const model = rankers.data?.items.find((r: any) => r.current);
  const queue = useQuery({ queryKey: ["active-learning", model?.id], queryFn: () => api(`${root}/rankers/${model.id}/active-learning`), enabled: open && tab === 2 && !!model });
  const arts = useQuery({ queryKey: ["preference-candidates", pid], queryFn: () => api(`/projects/${pid}/artifacts`), enabled: open && tab === 1 });
  async function act(fn: () => Promise<any>, message: string) {
    setBusy(true); try { await fn(); await cache.invalidateQueries({ queryKey: ["training-samples"] }); await cache.invalidateQueries({ queryKey: ["preference-rankers"] }); toast(message); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  return <details className="pw-card" onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary>根据我的选择比较写法</summary>
    {open && <><p>只使用你选中的评测记录。写哪一版仍由你决定。</p>
      <GooeyNav size="sm" tabMode aria-label="偏好实验分类" items={["使用哪些记录", "比较写法", "补充评价"]} value={tab} onChange={setTab} />
      {samples.error && <ErrorState error={samples.error} />}{rankers.error && <ErrorState error={rankers.error} />}
      {tab === 0 && <>{samples.isPending ? <Spinner /> : samples.data?.items.length ? samples.data.items.map((s: any) => <label className="mw-check" key={s.id}><input type="checkbox" checked={s.training_allowed} disabled={busy} onChange={(e) => act(() => put(`${root}/samples/${s.id}/consent`, { expected_version: s.version, allowed: e.target.checked }), "使用范围已更新")} />{s.name} · {s.rated ? "已有评分" : "等待人工评分"} · 允许用于比较我的写法，并允许导出这些记录</label>) : <p>先在下方邀请他人比较两份正文，再选择可以用于学习偏好的记录。</p>}
        <label className="field">这组偏好的名称<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
        <button className="button primary" disabled={busy || !name.trim()} onClick={() => act(() => post(`${root}/rankers`, { name }), "已整理，可以比较同章的不同写法")}>整理我的选择习惯</button>
        <p>至少需要 5 本作品、10 对已评分记录。撤回授权后会停止使用相关偏好。</p>
        <a className="text-button" href="/api/v1/studio/experiments/training-export" download>导出已授权的写法比较记录</a>
        {rankers.data?.items.map((r: any) => <article className="pw-card" key={r.id}><strong>{r.name} · {r.current ? "当前有效" : "依据已变化"}</strong><p>已参考 {r.metrics.training_works} 本作品、{r.metrics.training_pairs} 对评价，另用 {r.metrics.holdout_works} 本作品作比较。</p></article>)}</>}
      {tab === 1 && <>{!model && <p>先到“使用哪些记录”整理你的选择习惯。</p>}{arts.error && <ErrorState error={arts.error} />}{arts.data?.items.filter((a: any) => ["draft", "branch_draft"].includes(a.kind) && ["candidate", "confirmed"].includes(a.status)).map((a: any) => <label className="mw-check" key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))} />第 {a.chapter} 章 · {a.kind === "branch_draft" ? "另一种写法" : "正文"} · {a.text.length} 字 · {a.text.slice(0,35)}</label>)}
        <button className="button primary" disabled={busy || !model || selected.length < 2 || selected.length > 10} onClick={() => act(async () => setRanking(await post(`${root}/rankers/${model.id}/rank`, { project_id: pid, artifact_ids: selected })), "已完成比较")}>比较本章的不同写法</button>
        {ranking?.items.map((r: any, i: number) => <p key={r.artifact_id}>{i+1}. 第 {r.chapter} 章 · {arts.data?.items.find((a: any) => a.id === r.artifact_id)?.text.slice(0,30)} · 偏好匹配分 {r.score}</p>)}</>}
      {tab === 2 && <>{queue.error && <ErrorState error={queue.error} />}{!model ? <p>先整理选择习惯，再看看哪些内容需要补充评价。</p> : queue.data?.items.length ? queue.data.items.map((r: any) => <article className="pw-card" key={r.pair_id}><strong>{r.name}</strong><p>{r.reason} · 还需要人工判断</p><p>请你邀请的评阅人完成比较，再更新选择习惯。</p></article>) : <p>没有等待评价的记录。</p>}</>}
    </>}
  </details>;
}
