"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentPreview } from "./agent-preview";
import { AgentRuntimePanel } from "./agent-runtime-panel";
import { AgentExtensions } from "./agent-extensions";
import { BuiltinAgentEditor } from "./builtin-agent-editor";
import { CreationTemplatePanel } from "./creation-template-panel";
import { AgentEditorHeader, AgentEditorColumns, AgentEditorAccordion as Accordion, AgentModelChoice, AgentPromptTemplates } from "./agent-editor-layout";
import {
  Plus,
  Bot,
  Settings2,
  Store,
  Eye,
  EyeOff,
  Pencil,
  ExternalLink,
  CalendarDays,
  Zap,
  FileText,
  Puzzle,
  Database,
  SlidersHorizontal,
  CirclePlay,
  Brain,
  Users,
  BriefcaseBusiness,
} from "lucide-react";
import {
  api,
  recordCollection,
  post,
  put,
  type DataRecord,
  type PageSpec,
  label,
} from "@reference/lib/api";
import { Spinner, ErrorState, useToast } from "./ui";
import {
  Modal,
  SearchBox,
  RefEmpty,
} from "./reference-ui";

export function AgentPage({ page }: { page: PageSpec }) {
  const q = useQuery({
      queryKey: ["records", "agents", "all"],
      queryFn: () => recordCollection("agents"),
    }),
    cache = useQueryClient();
  const [search, setSearch] = useState(""),
    [tag, setTag] = useState(""),
    [store, setStore] = useState(false),
    [edit, setEdit] = useState<DataRecord | null | undefined>(),
    [panel, setPanel] = useState(""),
    [visit, setVisit] = useState<DataRecord | null>(null);
  const items: DataRecord[] = [...(q.data?.items || [])].sort((a, b) => Number(!!b.data.builtin_key) - Number(!!a.data.builtin_key) || (Number(a.data.builtin_order || 999) - Number(b.data.builtin_order || 999)) || a.name.localeCompare(b.name, "zh-CN")),
    tags = [...new Set(items.flatMap((a) => a.data.tags || []))] as string[];
  const filtered = items.filter(
    (r) =>
      (!store || r.data.visibility === "platform") &&
      (!tag || (r.data.tags || []).includes(tag)) &&
      [r.name, r.data.description, ...(r.data.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const refresh = () =>
    cache.invalidateQueries({ queryKey: ["records", "agents"] });
  return (
    <div className="ref-agent-page">
      <div className="ref-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="搜索智能体..."
        />
        <button
          className={`button ${store ? "primary" : "secondary"}`}
          onClick={() => setStore(!store)}
        >
          <Store size={15} />
          {store ? "返回我的智能体" : "智能体商店"}
        </button>
        <button
          className="button secondary"
          onClick={() => setPanel("runtime")}
        >
          <Settings2 size={15} />
          智能体运行环境管理
        </button>
        <button className="button secondary" onClick={() => setPanel("global")}>
          <SlidersHorizontal size={15} />
          全局设置
        </button>
      </div>
      <div className="ref-tag-strip">
        <span className="muted">{items.filter(a => a.data.builtin_key).length} 个内置助手 · {items.filter(a => !a.data.builtin_key).length} 个自定义助手</span>
        {tags.map((t) => (
          <button
            className={tag === t ? "active" : ""}
            key={t}
            onClick={() => setTag(tag === t ? "" : t)}
          >
            {t}
          </button>
        ))}
        {!tags.length && (
          <span className="muted">为智能体添加标签后，可在此筛选</span>
        )}
      </div>
      <p className="muted">内置助手按创作阶段排列；标记为“按需”或“授权后”的助手在对应操作时使用。</p>
      <CreationTemplatePanel />
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        <div className="ref-agent-grid">
          <button
            className="ref-agent-card ref-create-card"
            onClick={() => setEdit(null)}
          >
            <div className="ref-agent-top">
              <span className="ref-agent-icon">
                <Plus size={24} />
              </span>
              <strong>创建智能体</strong>
            </div>
            <p>创建自定义智能体，配置提示词和技能</p>
            <footer>
              <span>
                <FileText size={13} />
                提示词
              </span>
              <span>
                <Puzzle size={13} />
                技能
              </span>
              <span>
                <Database size={13} />
                知识库
              </span>
            </footer>
          </button>
          {filtered.map((r) => (
            <article className="ref-agent-card" key={r.id}>
              <div className="ref-agent-top">
                <span className="ref-agent-icon">
                  {r.data.cover ? (
                    <img
                      src={r.data.cover}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Bot size={24} />
                  )}
                </span>
                <strong>{r.name}</strong>
                <span
                  className={`ref-visibility ${r.data.visibility === "platform" ? "public" : ""}`}
                  title={
                    r.data.visibility === "platform" ? "平台可见" : "私人智能体"
                  }
                >
                  {r.data.visibility === "platform" ? (
                    <Eye size={15} />
                  ) : (
                    <EyeOff size={15} />
                  )}
                </span>
              </div>
              <p title={r.data.description}>{r.data.description}</p>
              <div className="ref-card-tags">
                {r.data.builtin_key && r.data.workflow_group && <span>{r.data.workflow_group}</span>}
                {(r.data.tags?.length ? r.data.tags : [label(r.data.stage)])
                  .slice(0, 3)
                  .map((t: string) => (
                    <span key={t}>{t}</span>
                  ))}
                {r.data.tags?.length > 3 && (
                  <span>+{r.data.tags.length - 3}</span>
                )}
              </div>
              <footer>
                <span>
                  <Zap size={12} />
                  按调用结算
                </span>
                <span>
                  <CalendarDays size={12} />
                  {new Date(r.created_at).toLocaleDateString("zh-CN")}
                </span>
                <button onClick={() => setEdit(r)}>
                  <Pencil size={12} />
                  编辑
                </button>
                <button onClick={() => r.data.builtin_key ? setEdit(r) : setVisit(r)}>
                  <ExternalLink size={12} />
                  {r.data.builtin_key ? "配置与调用" : "访问"}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {edit?.data.builtin_key ? <BuiltinAgentEditor key={edit.id} roleKey={edit.data.builtin_key} onClose={() => setEdit(undefined)} onSaved={refresh} /> : edit !== undefined && (
        <AgentEditor
          spec={page}
          initial={edit || undefined}
          onClose={() => setEdit(undefined)}
          onSaved={refresh}
        />
      )}
      {panel === "global" && (
        <GlobalSettings agents={items.filter(a => !a.data.builtin_key)} onClose={() => setPanel("")} />
      )}
      {panel === "runtime" && (
        <AgentRuntimePanel onClose={() => setPanel("")} />
      )}
      {visit && (
        <Modal title={visit.name} onClose={() => setVisit(null)} wide>
          <p className="ref-description">{visit.data.description}</p>
          <AgentPreview
            record={visit}
            onChanged={(r) => {
              setVisit(r);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function AgentEditor({
  spec,
  initial,
  onClose,
  onSaved,
}: {
  spec: PageSpec;
  initial?: DataRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast(),
    [record, setRecord] = useState(initial),
    [data, setData] = useState<Record<string, any>>(() =>
      Object.fromEntries(
        spec.fields.map((f) => [
          f.key,
          initial?.data[f.key] ?? f.default ?? "",
        ]),
      ),
    ),
    [name, setName] = useState(initial?.name || ""),
    [tagsDraft, setTagsDraft] = useState<string>(
      (initial?.data.tags || []).join("，"),
    ),
    [metadata, setMetadata] = useState(false),
    [picker, setPicker] = useState(""),
    [busy, setBusy] = useState(false),
    [modelSettings, setModelSettings] = useState(false),
    [varTarget, setVarTarget] = useState(""),
    [variable, setVariable] = useState("input"),
    [extensions, setExtensions] = useState(false);
  const choices = useQuery({
    queryKey: ["agent-editor-options"],
    queryFn: async () => {
      const kinds = ["skills", "knowledge", "mcp", "agents", "models"];
      const rs = await Promise.all(kinds.map((k) => recordCollection(k)));
      return Object.fromEntries(kinds.map((k, i) => [k, k === "agents" ? rs[i].items.filter((a: DataRecord) => !a.data.builtin_key) : rs[i].items]));
    },
  });
  const set = (k: string, v: any) => setData((old) => ({ ...old, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data.prompt.trim()) {
      toast("请填写系统提示词", true);
      setMetadata(false);
      return;
    }
    setBusy(true);
    try {
      const body = {
        name,
        data: {
          ...data,
          tags: tagsDraft
            .split(/[,，]/)
            .map((v) => v.trim())
            .filter(Boolean),
        },
        status: record?.status || "active",
        ...(record ? { expected_version: record.version } : {}),
      };
      const saved = record
        ? await put(`/admin/records/agents/${record.id}`, body)
        : await post("/admin/records/agents", body);
      setRecord(saved);
      setMetadata(false);
      onSaved();
      toast("智能体已保存");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const field = (key: string, title: string, type = "text") => (
    <label className="field">
      <span>{title}</span>
      <input
        type={type}
        min={0}
        max={key === "recall_threshold" ? 1 : undefined}
        step={["temperature", "recall_threshold"].includes(key) ? 0.01 : 1}
        disabled={key === "cost_per_call"}
        value={data[key] ?? ""}
        onChange={(e) =>
          set(key, type === "number" ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  );
  const toggle = (key: string, title: string) => (
    <label className="ref-switch-row">
      <span>{title}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={title}
        checked={!!data[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
    </label>
  );
  const attachments = [
    ["技能", "skills", "skill_ids", <Puzzle size={15} key="skill" />],
    ["子Agent", "agents", "sub_agent_ids", <Users size={15} key="agents" />],
    ["工具与能力", "mcp", "mcp_ids", <BriefcaseBusiness size={15} key="mcp" />],
    [
      "知识库",
      "knowledge",
      "knowledge_ids",
      <Database size={15} key="knowledge" />,
    ],
  ] as const;
  return (
    <Modal
      title={record ? "编辑智能体" : "创建智能体"}
      onClose={onClose}
      fullscreen
    >
      <AgentEditorHeader title={record ? "编辑智能体" : "创建智能体"} name={record?.name} onClose={onClose}>
          <button className="button secondary" onClick={onClose}>
            取 消
          </button>
          <button
            className="button primary"
            onClick={() => {
              if (!String(data.prompt).trim()) toast("请填写系统提示词", true);
              else setMetadata(true);
            }}
          >
            发 布
          </button>
      </AgentEditorHeader>
      <AgentEditorColumns>
        <section className="ref-prompt-column">
          <h3>
            <FileText size={17} />
            系统提示词 <b>*</b>
            <button
              className="text-button"
              onClick={() => setVarTarget("prompt")}
            >
              <Plus size={15} />
              变量
            </button>
          </h3>
          <textarea
            aria-label="系统提示词"
            value={data.prompt}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder="请输入系统提示词，定义 Agent 的角色、目标和行为规范"
          />
          <AgentPromptTemplates onAppend={text => set("prompt", String(data.prompt || "") + (data.prompt ? "\n\n" : "") + text)} />
        </section>
        <section className="ref-orchestration-column">
          <h3>
            <SlidersHorizontal size={17} />
            编排
          </h3>
          <Accordion title="模型" icon={<Brain size={15} />}>
            <AgentModelChoice value={data.model} onChange={value => set("model", value)} onSettings={() => setModelSettings(true)}>
                <option value="sandbox-writer">沙箱写作模型</option>
                {choices.data?.models
                  .filter(
                    (r: DataRecord) =>
                      r.status === "active" &&
                      r.data.capability === "text" &&
                      r.data.model_id !== "sandbox-writer",
                  )
                  .map((r: DataRecord) => (
                    <option key={r.id} value={r.data.model_id}>
                      {r.name}
                    </option>
                  ))}
            </AgentModelChoice>
          </Accordion>
          <Accordion
            title="记忆"
            open={false}
            summary={
              <span className="ref-memory-pills">
                <i>接入{data.memory_enabled ? "开启" : "关闭"}</i>
                <i>提炼{data.memory_extract ? "开" : "关"}</i>
                <i>
                  召回 {data.recall_count} @ {data.recall_threshold}
                </i>
              </span>
            }
          >
            {toggle("memory_enabled", "启用记忆接入")}
            {toggle("memory_extract", "会话结束提炼")}
            <p className="ref-field-help">
              按关键词召回当前用户、作品与智能体范围内的记忆，作为参考资料。提炼结果先作为待确认候选，确认后参与召回。
            </p>
            {toggle("memory_tools", "记忆工具（对话中）")}
            {field("recall_count", "召回条数", "number")}
            {field("recall_threshold", "召回最低分数", "number")}
          </Accordion>
          <Accordion
            title="用户提示词模板"
            icon={<FileText size={15} />}
            action={() => setVarTarget("user_prompt_template")}
          >
            <textarea
              aria-label="用户提示词模板"
              rows={4}
              placeholder="用户提示词模板，可以使用{{变量名}}的方式引用"
              value={data.user_prompt_template}
              onChange={(e) => set("user_prompt_template", e.target.value)}
            />
          </Accordion>
          {attachments.map(([title, kind, key, icon]) => (
            <Accordion
              key={key}
              title={title}
              icon={icon}
              action={() => setPicker(kind)}
            >
              {(data[key] || []).length ? (
                <div className="ref-attachment-list">
                  {data[key].map((id: string) => (
                    <div key={id}>
                      <span>
                        {choices.data?.[kind]?.find(
                          (r: DataRecord) => r.id === id,
                        )?.name || id}
                      </span>
                      <DeleteButton
                        confirmation="inline"
                        className="icon-button"
                        aria-label={`移除 ${id}`}
                        onClick={() =>
                          set(
                            key,
                            data[key].filter((v: string) => v !== id),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ref-attachment-empty">
                  暂无{title}，点击右上角 + 号添加
                </div>
              )}
              {kind === "mcp" && (data[key] || []).length > 0 && (
                <p className="ref-field-help">
                  运行时仅开放已探测并批准的工具；写入操作须由用户逐次确认。沙箱不会向外部
                  MCP 发送调用。
                </p>
              )}
              {kind === "agents" && (data[key] || []).length > 0 && (
                <p className="ref-field-help">
                  模型可委托已绑定的子智能体，最多三层，共用本次预算；循环绑定会在运行前拦截。
                </p>
              )}
            </Accordion>
          ))}
          <Accordion
            title="高级设置"
            icon={<Settings2 size={15} />}
            open={false}
          >
            {field("cost_per_call", "算力消耗 / 次", "number")}
            {field("budget", "单次算力上限", "number")}
            {field("max_iterations", "最大回环次数", "number")}
            {toggle("hide_skill_details", "隐藏技能调用详情")}
            {toggle("http_tools_enabled", "启用 GET 和 POST 工具")}
            {toggle("script_enabled", "允许管理员脚本执行")}
            {toggle("schedule_enabled", "启用日程管理")}
            <p className="ref-field-help">
              每轮模型调用受预算、回环次数与平台限流约束。HTTP
              工具须配置固定地址；外部写入操作逐次确认。日程受次数、配置版本及预算约束。算力按实际调用结算。
            </p>
          </Accordion>
          <button
            className="button secondary"
            disabled={!record}
            onClick={() => setExtensions(true)}
          >
            配置 HTTP 工具 / 日程 / API 密钥 / 记忆候选
          </button>
          <Accordion title="内部 API 调用" open={false}>
            {toggle("internal_api", "启用内部 API 调用")}
            <p className="ref-field-help">
              专用密钥绑定单个作品和智能体，可设预算与到期日；关闭开关会立即拒绝后续调用。
            </p>
          </Accordion>
          <Accordion title="配置使用指导提示" open={false}>
            <textarea
              rows={4}
              aria-label="使用指导提示"
              value={data.guidance}
              onChange={(e) => set("guidance", e.target.value)}
            />
          </Accordion>
        </section>
        <section className="ref-preview-column">
          <h3>
            <CirclePlay size={17} />
            预览与调试
          </h3>
          <AgentPreview
            record={record}
            onChanged={(r) => {
              setRecord(r);
              onSaved();
            }}
          />
        </section>
      </AgentEditorColumns>
      {extensions && record && (
        <AgentExtensions
          record={record}
          onClose={() => setExtensions(false)}
          onChanged={(version) => {
            if (version)
              setRecord((prev) => (prev ? { ...prev, version } : prev));
            onSaved();
          }}
        />
      )}
      {metadata && (
        <Modal
          title="发布智能体"
          onClose={() => setMetadata(false)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setMetadata(false)}
              >
                取 消
              </button>
              <button
                type="submit"
                form="agent-publish"
                className="button primary"
                disabled={busy}
              >
                保存并发布
              </button>
            </>
          }
        >
          <form id="agent-publish" className="ref-form" onSubmit={save}>
            <label className="field">
              <span>智能体名称 *</span>
              <input
                required
                maxLength={250}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>描述 *</span>
              <textarea
                required
                rows={3}
                value={data.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            <label className="field">
              <span>标签</span>
              <input
                value={tagsDraft}
                onChange={(e) => setTagsDraft(e.target.value)}
              />
            </label>
            {field("cover", "封面地址")}
            <label className="field">
              <span>可见范围</span>
              <select
                value={data.visibility}
                onChange={(e) => set("visibility", e.target.value)}
              >
                <option value="private">私人</option>
                <option value="platform">平台</option>
              </select>
            </label>
            <label className="field">
              <span>创作阶段</span>
              <select
                value={data.stage}
                onChange={(e) => set("stage", e.target.value)}
              >
                {[
                  ["idea", "灵感"],
                  ["planning", "规划"],
                  ["draft", "正文"],
                  ["review", "审稿"],
                  ["memory", "记忆"],
                  ["patch", "修订"],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </form>
        </Modal>
      )}
      {picker && (
        <Modal
          title={`添加${attachments.find((a) => a[1] === picker)?.[0]}`}
          onClose={() => setPicker("")}
        >
          <div className="ref-picker">
            {choices.isPending ? (
              <Spinner />
            ) : choices.error ? (
              <ErrorState error={choices.error} />
            ) : (
              choices.data?.[picker]
                ?.filter((r: DataRecord) => r.id !== record?.id)
                .map((r: DataRecord) => {
                  const key = attachments.find((a) => a[1] === picker)![2];
                  return (
                    <label key={r.id}>
                      <input
                        type="checkbox"
                        checked={(data[key] || []).includes(r.id)}
                        onChange={(e) =>
                          set(
                            key,
                            e.target.checked
                              ? [...(data[key] || []), r.id]
                              : data[key].filter((v: string) => v !== r.id),
                          )
                        }
                      />
                      <div>
                        <strong>{r.name}</strong>
                        <p>
                          {r.data.description || r.data.url || label(r.status)}
                        </p>
                      </div>
                    </label>
                  );
                })
            )}
            {!choices.isPending && !choices.data?.[picker]?.length && (
              <RefEmpty text="暂无可选资源，请先到对应管理页创建" />
            )}
          </div>
        </Modal>
      )}
      {modelSettings && (
        <Modal title="模型参数设置" onClose={() => setModelSettings(false)}>
          {field("temperature", "温度", "number")}
          {field("max_tokens", "输出 token 上限", "number")}
        </Modal>
      )}
      {varTarget && (
        <Modal
          title="插入变量"
          onClose={() => setVarTarget("")}
          footer={
            <button
              className="button primary"
              onClick={() => {
                if (!["input", "stage"].includes(variable)) {
                  toast("当前支持 input 和 stage 两个内置变量", true);
                  return;
                }
                set(
                  varTarget,
                  (data[varTarget] || "") + "{{" + variable + "}}",
                );
                setVarTarget("");
              }}
            >
              插入
            </button>
          }
        >
          <label className="field">
            <span>变量名</span>
            <input
              value={variable}
              onChange={(e) => setVariable(e.target.value)}
            />
          </label>
          <p className="ref-field-help">
            内置变量 input 为本次输入，stage 为创作阶段。
          </p>
        </Modal>
      )}
    </Modal>
  );
}

function GlobalSettings({
  agents,
  onClose,
}: {
  agents: DataRecord[];
  onClose: () => void;
}) {
  const q = useQuery({
      queryKey: ["agent-global"],
      queryFn: () => api("/admin/agents/settings"),
    }),
    cache = useQueryClient(),
    toast = useToast();
  const [chosen, setChosen] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="全局设置"
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取 消
          </button>
          <button
            className="button primary"
            disabled={busy || !q.data}
            onClick={async () => {
              setBusy(true);
              try {
                await put("/admin/agents/settings", {
                  agent_id: (chosen ?? q.data.agent_id) || null,
                  expected_version: q.data.version,
                });
                await cache.invalidateQueries({ queryKey: ["agent-global"] });
                toast("全局设置已保存");
                onClose();
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            保 存
          </button>
        </>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <label className="field">
          <span>全局主Agent</span>
          <select
            value={chosen ?? q.data?.agent_id ?? ""}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="">请选择一个Agent作为全局主Agent</option>
            {agents
              .filter(
                (a) =>
                  a.status === "active" && a.data.visibility === "platform",
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          <small>Agent 模式下未指定 Agent 时，将默认使用这个主 Agent。</small>
        </label>
      )}
    </Modal>
  );
}
