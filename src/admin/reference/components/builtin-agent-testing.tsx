"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post } from "@reference/lib/api";
import { ErrorState, Spinner } from "./ui";
import { Modal } from "./reference-ui";
import { Choices, type Options } from "./builtin-agent-capabilities";

const states: Record<string, string> = { queued: "排队中", running: "运行中", succeeded: "已完成", completed: "已完成", failed: "失败", cancelled: "已取消", paused_policy: "已暂停", paused_budget: "额度不足", paused_context: "参考内容需调整", pending_reconciliation: "费用待核对" };
type Trace = { id: string; state: string; error?: string; steps: { id: string; state: string; prompt: string; system: string; result: string | null; simulated?: boolean; latency_ms?: number; error?: string }[]; calls: { id: string; model: string; state: string; credits: number | null; input_tokens?: number; output_tokens?: number; latency_ms?: number; error?: string; input?: unknown; response?: string }[]; references: { stage: string; sources: { revision_id: string; kind: string; authority: string; sha256: string }[] }[]; tools: { name: string; state: string; arguments?: string; result?: string; error?: string }[] };
const format = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

export function TraceView({ data }: { data: Trace }) {
  return <div className="builtin-trace">
    <p role="status">{states[data.state] || data.state}{data.steps.some(s => s.simulated) ? " · 演示模式" : ""}</p>
    {data.error && <p role="alert">{data.error}</p>}
    {data.steps.map(step => <section key={step.id}><strong>助手输出</strong><pre>{step.result ?? (step.simulated ? "演示模式已验证配置与调用流程，没有真实模型回答。" : step.error || "等待模型回答…")}</pre></section>)}
    {data.calls.map(call => <details key={call.id} className="builtin-trace-call"><summary>{call.model} · {states[call.state] || call.state} · {call.credits ?? "待核对"} 点</summary>
      <p>输入 {call.input_tokens ?? "—"} / 输出 {call.output_tokens ?? "—"} Token · {call.latency_ms ?? "—"} 毫秒</p>
      {call.error && <p role="alert">{call.error}</p>}
      <strong>实际发送内容</strong><pre>{call.input ? format(call.input) : "这条历史记录未保存完整输入"}</pre>
      {call.response && <><strong>模型原始返回</strong><pre>{call.response}</pre></>}
    </details>)}
    <details><summary>本次参考来源（{data.references.reduce((n, m) => n + m.sources.length, 0)}）</summary>{data.references.length ? data.references.map((m, i) => <div key={i}><strong>{m.stage}</strong>{m.sources.length ? m.sources.map((s, n) => <p key={n}>{s.kind} · {s.authority}<br /><code>{s.revision_id}</code><br /><small>{s.sha256}</small></p>) : <p>使用测试输入或本次设定，无额外原文引用</p>}</div>) : <p>暂未发送模型请求</p>}</details>
    <details><summary>工具调用（{data.tools.length}）</summary>{data.tools.map((tool, i) => <div key={i}><strong>{tool.name} · {tool.state}</strong><pre>{tool.arguments || ""}</pre><pre>{tool.result || tool.error || ""}</pre></div>)}</details>
  </div>;
}

export function CallDetail({ path, callId, onClose }: { path: string; callId: string; onClose: () => void }) {
  const q = useQuery<Trace>({ queryKey: ["builtin-call-detail", callId], queryFn: () => api(`${path}/calls/${callId}`), retry: false, gcTime: 0 });
  return <Modal title="调用详情" onClose={onClose}>{q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : <TraceView data={q.data!} />}</Modal>;
}

export function BuiltinTest({ path, roleKey, config, sample, options, models, disabled, onStarted }: { path: string; roleKey: string; config: object; sample: string; options?: Options; models: { id: string; name: string }[]; disabled?: boolean; onStarted: () => void }) {
  const [mode, setMode] = useState("sandbox"), [model, setModel] = useState(""), [budget, setBudget] = useState(10), [project, setProject] = useState("");
  const [sources, setSources] = useState<string[]>([]), [character, setCharacter] = useState(""), [run, setRun] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const q = useQuery<Trace>({ queryKey: ["builtin-test-run", run], queryFn: () => api(`${path}/runs/${run}`), enabled: !!run, retry: false, gcTime: 0, refetchInterval: query => ["running", "queued"].includes(query.state.data?.state || "queued") && !query.state.error ? 2000 : false });
  const refs = useQuery<{ chapters: { id: string; name: string }[]; characters: { id: string; name: string }[] }>({ queryKey: ["builtin-test-references", roleKey, project], queryFn: () => api(`${path}/reference-options/${project}`), enabled: !!project, retry: false, gcTime: 0 });
  const running = !!run && ["running", "queued"].includes(q.data?.state || "queued") && !q.error;
  async function start() {
    setBusy(true); setError("");
    try {
      const input = JSON.parse(sample); if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("请输入 JSON 对象");
      const result = await post(path + "/test", { config, sample: input, mode, model, budget, source_project_id: project || null, source_ids: sources, character_id: character || null });
      setRun(result.id); onStarted();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="builtin-test-panel">
    <strong>执行试运行</strong>
    <label className="field"><span>测试方式</span><select aria-label="测试方式" value={mode} onChange={e => setMode(e.target.value)}><option value="sandbox">演示验证 · 不调用真实模型</option><option value="configured">调用已配置模型</option></select></label>
    {mode === "configured" && <>
      <label className="field"><span>本次测试模型</span><select aria-label="本次测试模型" value={model} onChange={e => setModel(e.target.value)}><option value="">使用左侧配置的模型</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="field"><span>本次最多使用多少点</span><input type="number" min={1} max={10000} value={budget} onChange={e => setBudget(Number(e.target.value))} /></label>
    </>}
    <label className="field"><span>引用作品资料</span><select aria-label="引用作品资料" value={project} onChange={e => { setProject(e.target.value); setSources([]); setCharacter(""); }}><option value="">仅使用测试输入</option>{options?.projects.filter(p => p.can_test).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    {project && (refs.isPending ? <Spinner /> : refs.error ? <ErrorState error={refs.error} /> : roleKey === "character-choice" ? <label className="field"><span>推演人物</span><select value={character} onChange={e => setCharacter(e.target.value)}><option value="">请选择人物</option>{refs.data?.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : <Choices label="参考已确认章节（最多 3 章）" values={sources} items={refs.data?.chapters || []} onChange={v => setSources(v.slice(0, 3))} />)}
    <p className="ref-field-help">使用当前编辑内容。引用他人作品需要作者授予“助手测试”权限。测试回答保存在独立记录中。</p>
    {disabled && <p role="alert">请先修正输出格式，再开始测试。</p>}
    <div className="builtin-test-buttons"><button className="button primary" disabled={disabled || busy || running || !!(project && (refs.error || refs.isPending))} onClick={start}>{busy ? "正在创建…" : mode === "sandbox" ? "运行演示验证" : "开始模型试运行"}</button>
      {running && <button className="button secondary" onClick={async () => { try { await post(`/runs/${run}/cancel`, {}); await q.refetch(); } catch (e) { setError((e as Error).message); } }}>取消测试</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {run && (q.isPending ? <Spinner /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : <TraceView data={q.data!} />)}
  </section>;
}
