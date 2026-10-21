"use client";
import { useState } from "react";
import { BookOpen, Link2, Workflow } from "lucide-react";
import { AgentEditorAccordion as Accordion } from "./agent-editor-layout";

export type Sources = {
  enabled: string[]; limits: Record<string, number>; knowledge_ids: string[]; skill_ids: string[];
  mcp_ids: string[]; http_tool_ids: string[]; sub_agent_ids: string[]; memory_enabled: boolean; recall_count: number; max_iterations: number;
};
export type ExecutionPolicy = { trigger: "automatic" | "manual" | "interval"; interval: number; requires: string[]; success: "continue" | "pause"; failure: "stop" | "pause"; safe_retries: number | null; timeout: number | null; fallback_models: string[] };
export type Capabilities = { sources: { key: string; name: string; required: boolean }[]; isolated: boolean; can_configure_trigger: boolean; allowed_requires: string[] };
export type Options = { resources: { id: string; name: string; kind: string; scope: string }[]; projects: { id: string; title: string; can_test: boolean }[]; users: { id: string; name: string }[] };
export const stepNames: Record<string, string> = { "idea-generate": "准备故事方案", "story-summary": "整理故事概括", "character-choice": "人物行动推演", "scene-director": "核对人物行动" };
const toggle = (values: string[], id: string, checked: boolean) => checked ? [...new Set([...values, id])] : values.filter(v => v !== id);

export function Choices({ label, values, items, onChange, empty = "暂无可选项" }: { label: string; values: string[]; items: { id: string; name: string }[]; onChange: (value: string[]) => void; empty?: string }) {
  return <fieldset className="builtin-choices"><legend>{label}</legend>{items.length ? items.map(item => <label key={item.id}><input type="checkbox" checked={values.includes(item.id)} onChange={e => onChange(toggle(values, item.id, e.target.checked))} /><span>{item.name}</span></label>) : <p className="ref-field-help">{empty}</p>}</fieldset>;
}

export function BuiltinCapabilities({ sources, execution, capabilities, options, models, onSources, onExecution }: { sources: Sources; execution: ExecutionPolicy; capabilities: Capabilities; options?: Options; models: { id: string; name: string }[]; onSources: (v: Sources) => void; onExecution: (v: ExecutionPolicy) => void }) {
  const setSource = <K extends keyof Sources>(k: K, v: Sources[K]) => onSources({ ...sources, [k]: v });
  const setPolicy = <K extends keyof ExecutionPolicy>(k: K, v: ExecutionPolicy[K]) => onExecution({ ...execution, [k]: v });
  const bindings: ["knowledge_ids" | "skill_ids" | "mcp_ids" | "http_tool_ids" | "sub_agent_ids", string, string][] = [["knowledge_ids", "knowledge", "知识库"], ["skill_ids", "skills", "技能"], ["mcp_ids", "mcp", "MCP 工具"], ["http_tool_ids", "agent-http-tool", "HTTP 工具"], ["sub_agent_ids", "agents", "子智能体"]];
  return <>
    <Accordion title="参考内容" icon={<BookOpen size={15} />} open={false} summary={<span className="ref-memory-pills"><i>{sources.enabled.length} 类</i></span>}>
      {capabilities.sources.map(item => <div className="builtin-source" key={item.key}>
        <label><input type="checkbox" checked={sources.enabled.includes(item.key)} disabled={item.required} onChange={e => setSource("enabled", toggle(sources.enabled, item.key, e.target.checked))} /><span>{item.name}{item.required && <small>必需</small>}</span></label>
        {!item.required && sources.enabled.includes(item.key) && <input aria-label={`${item.name}字数上限`} type="number" min={200} max={100000} placeholder="不限字数" value={sources.limits[item.key] ?? ""} onChange={e => { const limits = { ...sources.limits }; if (e.target.value) limits[item.key] = Number(e.target.value); else delete limits[item.key]; setSource("limits", limits); }} />}
      </div>)}
      <p className="ref-field-help">必须提供的故事依据会保留；人物推演只读取该人物获准知道的内容。</p>
    </Accordion>
    <Accordion title="知识、记忆与工具" icon={<Link2 size={15} />} open={false}>
      {capabilities.isolated ? <p className="ref-field-help">此助手需要独立的信息范围，仅使用当前任务的资料。</p> : <>
        {bindings.map(([field, kind, label]) => <Choices key={field} label={label} values={sources[field]} items={(options?.resources || []).filter(r => r.kind === kind)} onChange={v => setSource(field, v)} empty={`暂无可用${label}`} />)}
        <label className="ref-switch-row"><span>使用当前作者的助手记忆</span><input type="checkbox" role="switch" checked={sources.memory_enabled} onChange={e => setSource("memory_enabled", e.target.checked)} /></label>
        {sources.memory_enabled && <label className="field"><span>最多参考几条记忆</span><input type="number" min={1} max={30} value={sources.recall_count} onChange={e => setSource("recall_count", Number(e.target.value))} /></label>}
        <label className="field"><span>最多调用工具轮数</span><input type="number" min={1} max={8} value={sources.max_iterations} onChange={e => setSource("max_iterations", Number(e.target.value))} /></label>
        <p className="ref-field-help">内置创作助手可使用已授权的只读工具。正文确认、费用与作品访问仍由平台检查。</p>
      </>}
    </Accordion>
    <Accordion title="执行方式" icon={<Workflow size={15} />} open={false}>
      <label className="field"><span>何时执行</span><select aria-label="何时执行" disabled={!capabilities.can_configure_trigger} value={execution.trigger} onChange={e => setPolicy("trigger", e.target.value as ExecutionPolicy["trigger"])}><option value="automatic">随写作步骤自动执行</option><option value="manual">作者主动选择时执行</option><option value="interval">每隔指定章节执行</option></select></label>
      {execution.trigger === "interval" && <label className="field"><span>每隔几章</span><input type="number" min={1} max={100} value={execution.interval} onChange={e => setPolicy("interval", Number(e.target.value))} /></label>}
      {capabilities.can_configure_trigger && <p className="ref-field-help">新书开篇、关键情节变化等必要检查仍会执行。</p>}
      {!!capabilities.allowed_requires.length && <Choices label="先完成这些步骤" values={execution.requires} items={capabilities.allowed_requires.map(id => ({ id, name: stepNames[id] || id }))} onChange={v => setPolicy("requires", v)} />}
      <label className="field"><span>成功后</span><select value={execution.success} onChange={e => setPolicy("success", e.target.value as ExecutionPolicy["success"])}><option value="continue">继续下一步</option><option value="pause">暂停，等待作者查看后继续</option></select></label>
      <label className="field"><span>失败后</span><select value={execution.failure} onChange={e => setPolicy("failure", e.target.value as ExecutionPolicy["failure"])}><option value="pause">保留进度并暂停</option><option value="stop">结束本次任务</option></select></label>
      <label className="field"><span>安全重试次数</span><input aria-label="安全重试次数" type="number" min={0} max={3} placeholder="沿用平台策略" value={execution.safe_retries ?? ""} onChange={e => setPolicy("safe_retries", e.target.value === "" ? null : Number(e.target.value))} /></label>
      <label className="field"><span>单次调用超时（秒）</span><input type="number" min={5} max={600} placeholder="沿用平台策略" value={execution.timeout ?? ""} onChange={e => setPolicy("timeout", e.target.value === "" ? null : Number(e.target.value))} /></label>
      <Choices label="备用模型（最多 3 个，按选择顺序）" values={execution.fallback_models} items={models} onChange={v => setPolicy("fallback_models", v.slice(0, 3))} />
      {!!execution.fallback_models.length && <ol className="builtin-model-order">{execution.fallback_models.map(m => <li key={m}>{models.find(v => v.id === m)?.name || m}</li>)}</ol>}
      <p className="ref-field-help">仅在确认请求未受理或模型不可用时重试、切换；受理不明时先核对费用。</p>
    </Accordion>
  </>;
}

export function OutputSchema({ value, onChange, onValidity }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; onValidity: (invalid: boolean) => void }) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2)), [error, setError] = useState("");
  return <label className="field"><span>补充输出格式（JSON Schema，可选）</span><textarea aria-label="补充输出格式" rows={5} value={draft} onChange={e => {
    setDraft(e.target.value);
    try { const next = JSON.parse(e.target.value || "{}"); if (!next || Array.isArray(next) || typeof next !== "object") throw new Error(); onChange(next); setError(""); onValidity(false); }
    catch { setError("请填写有效的 JSON 对象，修改尚未应用"); onValidity(true); }
  }} />{error && <span role="alert">{error}</span>}</label>;
}
