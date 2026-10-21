"use client";

import { useDialogs } from '../../../ui/AppDialogs';
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Brain, CirclePlay, FileText, History, Plus, Settings2, SlidersHorizontal, Workflow } from "lucide-react";
import { api, post, put, recordCollection, formatTime } from "@reference/lib/api";
import { Modal, RefTabs } from "./reference-ui";
import { ErrorState, Spinner, useToast } from "./ui";
import { AgentEditorHeader, AgentEditorColumns, AgentEditorAccordion as Accordion, AgentModelChoice, AgentPromptTemplates } from "./agent-editor-layout";
import { BuiltinCapabilities, OutputSchema, type Sources, type ExecutionPolicy, type Capabilities, type Options } from "./builtin-agent-capabilities";
import { BuiltinTest, CallDetail } from "./builtin-agent-testing";
import { PublishOptions, DraftComparison, VersionComparison, VersionMetrics, fullRelease, type PublishScope } from "./builtin-agent-releases";
import "./builtin-agent-editor.css";

type Config = {
  name: string; description: string; system_prompt: string; task_prompt: string;
  user_prompt_template: string; output_instruction: string; inherit_shared: boolean;
  model: string; temperature: number | null; reasoning_effort?: "low" | "medium" | "high" | "xhigh" | null; max_tokens: number; budget: number;
  enabled: boolean; parameters: Record<string, number>;
  sources: Sources; execution: ExecutionPolicy; output_schema: Record<string, unknown>;
};
type Detail = {
  key: string; version: number; published_version: number; published: Config; draft: Config | null;
  definition: { name: string; group: string; trigger: string; output: string; source: string; stage: string; handoff?: string; workflow_group?: string; prompt_edition?: string };
  parameters: Record<string, [number, number]>;
  capabilities: Capabilities;
  trial: { revision: number; config: Config; project_ids: string[]; user_ids: string[]; percentage: number } | null;
  history: { revision: number; created_at: string; reason: string }[];
  calls: { id: string; model: string; state: string; revision: number; credits: number | null; created_at: string; input_tokens?: number; output_tokens?: number; latency_ms?: number }[];
};
type Preview = { system: string; input: Record<string, unknown>; model: string; enabled: boolean };
const parameterNames: Record<string, string> = { candidate_count: "每轮故事方案数", retain_count: "保留方向数", max_rounds: "最多探索或协调轮数", repair_rounds: "修改后复查轮数", planning_horizon: "近期大纲章数", scene_horizon: "细化场景章数", scene_count: "分场景写作的场景数" };
const variableNames: Record<string, string> = { input: "本次输入", task: "本次任务要求", stage: "当前创作阶段" };

export function BuiltinAgentEditor({ roleKey, onClose, onSaved }: { roleKey: string; onClose: () => void; onSaved: () => void }) {
  const q = useQuery<Detail>({ queryKey: ["builtin-agent", roleKey], queryFn: () => api(`/admin/builtin-agents/${roleKey}`) });
  if (q.isPending || q.error) return <Modal title="编辑内置智能体" fullscreen onClose={onClose}>
    <AgentEditorHeader title="编辑智能体" onClose={onClose}><button className="button secondary" onClick={onClose}>取 消</button></AgentEditorHeader>
    {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : <Spinner />}
  </Modal>;
  return <Editor initial={q.data!} onClose={onClose} onSaved={() => { onSaved(); void q.refetch(); }} />;
}

function Editor({ initial, onClose, onSaved }: { initial: Detail; onClose: () => void; onSaved: () => void }) {
  const dialogs = useDialogs(initial.key);
  const [detail, setDetail] = useState(initial), [config, setConfig] = useState<Config>(initial.draft || initial.trial?.config || initial.published);
  const [saved, setSaved] = useState(JSON.stringify(initial.draft || initial.trial?.config || initial.published));
  const [tab, setTab] = useState("调试预览"), [promptTab, setPromptTab] = useState<"system_prompt" | "task_prompt">("system_prompt");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [sample, setSample] = useState('{\n  "message": "我想写一个普通人发现旧城秘密的故事"\n}');
  const [preview, setPreview] = useState<Preview | null>(null), [reason, setReason] = useState("调整助手配置");
  const [metadata, setMetadata] = useState(false), [modelSettings, setModelSettings] = useState(false);
  const [varTarget, setVarTarget] = useState<"task_prompt" | "user_prompt_template" | null>(null);
  const [variable, setVariable] = useState("stage");
  const [scope, setScope] = useState<PublishScope>(fullRelease), [comparedVersion, setComparedVersion] = useState<number | null>(null), [callId, setCallId] = useState("");
  const [schemaInvalid, setSchemaInvalid] = useState(false);
  const toast = useToast(), path = `/admin/builtin-agents/${initial.key}`;
  const models = useQuery({ queryKey: ["builtin-agent-models"], queryFn: () => recordCollection("models") });
  const options = useQuery<Options>({ queryKey: ["builtin-agent-options", initial.key], queryFn: () => api(path + "/options") });
  const modelChoices = [...new Map((models.data?.items || []).filter(m => m.status === "active" && m.data.capability === "text").map(m => [String(m.data.model_id), { id: String(m.data.model_id), name: m.name }])).values()];
  const dirty = saved !== JSON.stringify(config);
  const evaluatedModel = ["rule-quality", "review-calibration"].includes(detail.key);
  const dedicated = ["story-chat", "scene-state", "character-choice", "style-extract", "agent-memory"].includes(detail.key);
  const promptTitle = promptTab === "system_prompt" ? "系统提示词" : "任务提示词";
  const set = <K extends keyof Config>(key: K, value: Config[K]) => { setConfig(old => ({ ...old, [key]: value })); setPreview(null); };
  const close = async () => { if (!busy && (!(dirty || schemaInvalid) || await dialogs.confirm("还有修改未保存，确定离开吗？"))) onClose(); };
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    const result = await put(path + "/draft", { expected_version: detail.version, config });
    setDetail(old => ({ ...old, ...result })); setSaved(JSON.stringify(config)); onSaved(); return result;
  }
  async function publish() {
    await action(async () => {
      const draft = dirty || !detail.draft ? await save() : detail;
      await post(path + "/publish", { expected_version: draft.version, reason, ...scope });
      const latest: Detail = await api(path);
      const editing = latest.trial?.config || latest.published;
      setDetail(latest); setConfig(editing); setSaved(JSON.stringify(editing));
      setMetadata(false); onSaved(); toast(scope.mode === "trial" ? "试用已开始，所选范围的新任务将使用此版本" : "已发布，新的创作任务将使用此版本");
    });
  }
  async function showPreview() {
    await action(async () => {
      let value;
      try { value = JSON.parse(sample); } catch { throw new Error("测试输入需要是有效的 JSON 对象"); }
      if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("测试输入需要是 JSON 对象");
      setPreview(await post(path + "/preview", { config, sample: value }));
    });
  }
  async function restore(revision: number) {
    if (dirty && !await dialogs.confirm("恢复历史版本会替换尚未保存的修改，确定继续吗？")) return;
    await action(async () => {
      const result = await post(path + "/restore", { expected_version: detail.version, revision });
      setDetail(old => ({ ...old, ...result })); setConfig(result.draft); setSaved(JSON.stringify(result.draft));
      setPreview(null); onSaved(); toast("已恢复到草稿，发布后生效");
    });
  }
  const numeric = (key: "max_tokens" | "budget", label: string, max: number) => <label className="field">
    <span>{label}</span><input aria-label={label} type="number" min={0} max={max} value={config[key]} onChange={e => set(key, Number(e.target.value))} />
  </label>;
  const metadataFields = <>
    <label className="field"><span>智能体名称 *</span><input aria-label="智能体名称" required maxLength={250} value={config.name} onChange={e => set("name", e.target.value)} /></label>
    <label className="field"><span>描述</span><textarea aria-label="描述" rows={3} value={config.description} onChange={e => set("description", e.target.value)} /></label>
  </>;

  return <Modal title={`编辑智能体 · ${config.name}`} fullscreen onClose={close} className="builtin-agent-editor">
    <AgentEditorHeader title="编辑智能体" name={config.name} onClose={close}>
      <span role="status" className="builtin-save-status">{dirty || schemaInvalid ? "还有修改未保存" : detail.draft ? "草稿已保存，尚未发布" : detail.trial ? `正在编辑试用版本 ${detail.trial.revision}` : `当前发布版本 ${detail.published_version}`}</span>
      <button className="button secondary" disabled={busy} onClick={close}>取 消</button>
      <button className="button secondary" disabled={busy || schemaInvalid} onClick={() => action(async () => { await save(); toast("草稿已保存"); })}>保存草稿</button>
      <button className="button primary" disabled={busy || schemaInvalid} onClick={() => { setError(""); setMetadata(true); }}>发 布</button>
    </AgentEditorHeader>
    {error && !metadata && <p role="alert" className="builtin-error">{error}</p>}
    <fieldset disabled={busy} className="builtin-fieldset" aria-busy={busy}>
      <AgentEditorColumns>
        <section className="ref-prompt-column">
          <h3><FileText size={17} />{promptTitle} <b>*</b>
            {promptTab === "task_prompt" && <button className="text-button" onClick={() => { setVariable("stage"); setVarTarget("task_prompt"); }}><Plus size={15} />变量</button>}
          </h3>
          <div className="builtin-prompt-tabs"><RefTabs tabs={["系统提示词", "任务提示词"]} value={promptTitle} onChange={value => setPromptTab(value === "系统提示词" ? "system_prompt" : "task_prompt")} /></div>
          <textarea aria-label={promptTitle} value={config[promptTab]} onChange={e => set(promptTab, e.target.value)} placeholder={promptTab === "system_prompt" ? "定义助手的角色、目标和行为规范" : "说明这一步要完成什么、遵守哪些要求"} />
          <AgentPromptTemplates onAppend={text => set(promptTab, config[promptTab] + (config[promptTab] ? "\n\n" : "") + text)} />
        </section>
        <section className="ref-orchestration-column">
          <h3><SlidersHorizontal size={17} />编排</h3>
          <Accordion title="模型" icon={<Brain size={15} />}>
            <AgentModelChoice value={config.model} disabled={evaluatedModel} onChange={value => set("model", value)} onSettings={() => setModelSettings(true)}>
              <option value="">{evaluatedModel ? "使用本次选择的待评测模型" : "使用本次创作选择的模型"}</option>
              {models.data?.items.filter(m => m.status === "active" && m.data.capability === "text").map(m => <option key={m.id} value={m.data.model_id}>{m.name}</option>)}
            </AgentModelChoice>
            {models.error && <ErrorState error={models.error} retry={() => models.refetch()} />}
          </Accordion>
          <Accordion title="基本信息" icon={<Bot size={15} />} open={false} summary={<span className="ref-memory-pills"><i>{config.enabled ? "已启用" : "已停用"}</i></span>}>
            {metadataFields}
            <label className="ref-switch-row"><span>启用此助手</span><input aria-label="启用此助手" type="checkbox" role="switch" checked={config.enabled} onChange={e => set("enabled", e.target.checked)} /></label>
            {!config.enabled && <p className="ref-field-help">停用后，需要此助手的新任务将暂停。</p>}
          </Accordion>
          <Accordion title="用户提示词模板" icon={<FileText size={15} />} action={() => { setVariable("input"); setVarTarget("user_prompt_template"); }}>
            <textarea aria-label="用户提示词模板" rows={4} placeholder="使用 {{input}} 引用本次输入" value={config.user_prompt_template} onChange={e => set("user_prompt_template", e.target.value)} />
          </Accordion>
          <Accordion title="输出要求" icon={<FileText size={15} />}>
            <textarea aria-label="补充输出要求" rows={4} placeholder="填写希望补充的输出要求" value={config.output_instruction} onChange={e => set("output_instruction", e.target.value)} />
            <p className="ref-field-help">必需输出：{detail.definition.output}</p>
          </Accordion>
          <Accordion title="触发步骤与参数" icon={<Workflow size={15} />}>
            <p className="builtin-trigger">{detail.definition.trigger}</p>
            {detail.definition.handoff && <div className="builtin-handoff"><strong>前后步骤衔接 · {detail.definition.workflow_group}</strong>{detail.definition.handoff.split("\n").filter(Boolean).map((line, i) => <p className="ref-field-help" key={i}>{line}</p>)}</div>}
            {Object.entries(detail.parameters).map(([key, limits]) => <label className="field" key={key}>
              <span>{parameterNames[key] || key}</span>
              <input aria-label={parameterNames[key] || key} type="number" min={limits[0]} max={limits[1]} placeholder="沿用平台默认" value={config.parameters[key] ?? ""} onChange={e => {
                const values = { ...config.parameters };
                if (e.target.value === "") delete values[key]; else values[key] = Number(e.target.value);
                set("parameters", values);
              }} />
            </label>)}
            {!!Object.keys(detail.parameters).length && <p className="ref-field-help">留空沿用平台默认；作者本次的选择优先。</p>}
            <div className="builtin-links"><a className="text-button" href="/admin/novel/workflows" target="_blank" rel="noreferrer">查看写作流程</a><a className="text-button" href="/admin/novel/engines" target="_blank" rel="noreferrer">平台默认设置</a></div>
          </Accordion>
          <Accordion title="高级设置" icon={<Settings2 size={15} />} open={false}>
            {numeric("budget", "本次任务中该助手的额度上限", 10000)}
            <p className="ref-field-help">0 为沿用任务预算。</p>
            {!dedicated && <label className="ref-switch-row"><span>沿用当前规则版本的共享提示词</span><input aria-label="沿用当前规则版本的共享提示词" type="checkbox" role="switch" disabled={detail.key === "rule-quality"} checked={config.inherit_shared} onChange={e => set("inherit_shared", e.target.checked)} /></label>}
            <OutputSchema key={detail.version} value={config.output_schema} onChange={v => set("output_schema", v)} onValidity={setSchemaInvalid} />
          </Accordion>
          {options.error && <ErrorState error={options.error} retry={() => options.refetch()} />}
          <BuiltinCapabilities sources={config.sources} execution={config.execution} capabilities={detail.capabilities} options={options.data} models={evaluatedModel ? [] : modelChoices} onSources={v => set("sources", v)} onExecution={v => set("execution", v)} />
        </section>
        <section className="ref-preview-column">
          <h3><CirclePlay size={17} />预览与调试</h3>
          <RefTabs tabs={["调试预览", "试运行", "发布历史", "调用记录"]} value={tab} onChange={setTab} />
          <div className="builtin-test-container" hidden={tab !== "试运行"}><label className="field"><span>测试输入（JSON 对象）</span><textarea aria-label="试运行输入" rows={5} value={sample} onChange={e => setSample(e.target.value)} /></label><BuiltinTest path={path} roleKey={detail.key} config={config} sample={sample} options={options.data} models={modelChoices} disabled={schemaInvalid} onStarted={onSaved} /></div>
          {tab === "调试预览" && <div className="ref-agent-preview">
            <div className="ref-preview-output">
              {preview ? <div className="ref-preview-result builtin-preview-result">
                <p className="ref-field-help">{preview.model === "" ? "使用本次创作选择的模型" : preview.model} · {preview.enabled ? "已启用" : "已停用"}</p>
                <strong>生效系统提示词</strong><pre>{preview.system}</pre>
                <strong>任务与参考输入</strong><pre>{JSON.stringify(preview.input, null, 2)}</pre>
              </div> : <><Bot size={44} strokeWidth={1.4} /><p>输入测试内容，预览当前配置</p></>}
            </div>
            <div className="ref-preview-composer">
              <label className="field"><span>测试输入（JSON 对象）</span><textarea aria-label="测试输入" rows={5} value={sample} onChange={e => { setSample(e.target.value); setPreview(null); }} /></label>
              <div><small>使用当前编辑内容 · 不调用模型</small><button className="button primary" onClick={showPreview}><CirclePlay size={14} />预览模型输入</button></div>
            </div>
          </div>}
          {tab === "发布历史" && <div className="builtin-history-panel">
            {detail.trial && <section className="builtin-trial-status"><strong>版本 {detail.trial.revision} 正在试用</strong><p>随机 {detail.trial.percentage}% · 指定 {detail.trial.project_ids.length} 部作品 / {detail.trial.user_ids.length} 位用户</p><div>{(["promote", "stop"] as const).map(which => <button className="button secondary" key={which} onClick={() => action(async () => { await post(`${path}/trial/${which}`, { expected_version: detail.version }); const latest: Detail = await api(path); setDetail(latest); const editing = latest.draft || latest.trial?.config || latest.published; if (!dirty) { setConfig(editing); setSaved(JSON.stringify(editing)); } onSaved(); toast(which === "promote" ? "已将试用版本全面发布" : "已停止试用，新任务使用正式版本"); })}>{which === "promote" ? "全面发布此版本" : "停止试用"}</button>)}</div></section>}
            <VersionMetrics path={path} />
            <p className="ref-field-help">恢复后先保存为草稿，发布后用于新任务。</p>
            {detail.history.map(h => <article className="ref-accordion builtin-history" key={h.revision}>
              <div><strong><History size={15} />版本 {h.revision}{h.revision === detail.published_version && <span className="builtin-version-badge">当前发布</span>}</strong><time>{formatTime(h.created_at)}</time><p>{h.reason}</p></div>
              <div className="builtin-history-actions"><button className="button secondary" onClick={() => setComparedVersion(h.revision)}>比较配置</button><button className="button secondary" onClick={() => restore(h.revision)}>恢复到草稿</button></div>
            </article>)}
          </div>}
          {tab === "调用记录" && <div className="builtin-calls-panel">
            <div className="builtin-calls-toolbar"><span className="ref-field-help">最近 {detail.calls.length} 次调用</span><button className="button secondary" onClick={() => action(async () => {
              const current: Detail = await api(path);
              setDetail(old => ({ ...old, calls: current.calls, history: current.history }));
            })}>刷新调用记录</button></div>
            {detail.calls.length ? detail.calls.map((c, i) => <article className="ref-accordion builtin-call" key={i}>
              <header><strong>{({ completed: "已完成", running: "进行中", failed: "失败", pending_reconciliation: "用量待核对" } as Record<string, string>)[c.state] || c.state}</strong><time>{formatTime(c.created_at)}</time></header>
              <dl><div><dt>配置版本</dt><dd>{c.revision}</dd></div><div><dt>模型</dt><dd>{c.model}</dd></div><div><dt>额度</dt><dd>{c.credits ?? "待核对"}</dd></div></dl>
              <p className="ref-field-help">输入 {c.input_tokens ?? "—"} / 输出 {c.output_tokens ?? "—"} Token · {c.latency_ms ?? "—"} 毫秒</p><button className="button secondary" onClick={() => setCallId(c.id)}>查看输入、结果和工具</button>
            </article>) : <div className="ref-preview-output"><Bot size={44} strokeWidth={1.4} /><p>还没有调用记录</p><small>在对应创作步骤运行后，可在这里查看。</small></div>}
          </div>}
        </section>
      </AgentEditorColumns>
    </fieldset>
    {comparedVersion !== null && <VersionComparison path={path} revision={comparedVersion} onClose={() => setComparedVersion(null)} />}
    {callId && <CallDetail path={path} callId={callId} onClose={() => setCallId("")} />}
    {modelSettings && <Modal title="模型参数设置" onClose={() => setModelSettings(false)} footer={<button className="button primary" onClick={() => setModelSettings(false)}>完 成</button>}>
      <label className="field"><span>温度</span><input aria-label="温度" type="number" min={0} max={2} step={0.1} placeholder="沿用模型默认" value={config.temperature ?? ""} onChange={e => set("temperature", e.target.value === "" ? null : Number(e.target.value))} /></label>
      <label className="field"><span>思考强度</span><select aria-label="思考强度" value={config.reasoning_effort || ""} onChange={e => set("reasoning_effort", (e.target.value || null) as Config["reasoning_effort"])}><option value="">沿用模型默认</option><option value="low">低 · 简单对话</option><option value="medium">中 · 常规分析</option><option value="high">高 · 复杂推演</option><option value="xhigh">更高 · 深入分析</option></select></label>
      {numeric("max_tokens", "输出 Token 上限", 32000)}
      <p className="ref-field-help">温度留空、输出上限为 0 时沿用默认值。</p>
    </Modal>}
    {varTarget && <Modal title="插入变量" onClose={() => setVarTarget(null)} footer={<button className="button primary" onClick={() => { set(varTarget, config[varTarget] + "{{" + variable + "}}"); setVarTarget(null); }}>插 入</button>}>
      <label className="field"><span>变量</span><select aria-label="变量" value={variable} onChange={e => setVariable(e.target.value)}>{(varTarget === "task_prompt" ? ["stage", "task"] : ["input", "stage", "task"]).map(v => <option key={v} value={v}>{variableNames[v]} · {"{{" + v + "}}"}</option>)}</select></label>
    </Modal>}
    {metadata && <Modal title="发布智能体" onClose={() => { if (!busy) setMetadata(false); }} footer={<>
      <button className="button secondary" disabled={busy} onClick={() => setMetadata(false)}>取 消</button>
      <button className="button primary" type="submit" form="builtin-agent-publish" disabled={busy}>{busy ? "发布中…" : "保存并发布"}</button>
    </>}>
      <form id="builtin-agent-publish" className="ref-form" onSubmit={e => { e.preventDefault(); void publish(); }}>
        <fieldset disabled={busy} className="builtin-metadata-fields">
          {metadataFields}
          <label className="field"><span>发布说明</span><input aria-label="发布说明" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
          <PublishOptions value={scope} options={options.data} onChange={setScope} />
          <DraftComparison before={detail.published} after={config} />
          <p className="ref-field-help">发布后用于新任务，正在执行的任务继续使用原版本。</p>
        </fieldset>
        {error && <p role="alert" className="builtin-error">{error}</p>}
      </form>
    </Modal>}
  </Modal>;
}
