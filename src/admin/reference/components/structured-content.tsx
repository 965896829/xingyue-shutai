"use client";
import { useDialogs } from '../../../ui/AppDialogs';
import { DeleteButton } from "./interaction/delete-button";
import { BounceSidebar } from "./interaction/bounce-sidebar";
import { GooeyNav } from "./interaction/gooey-nav";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Save,
  Check,
  History,
  RotateCcw,
  ShieldCheck,
  Search,
  FileText,
} from "lucide-react";
import { api, post, put, formatTime } from "@reference/lib/api";
import { Drawer, Spinner, ErrorState, Empty, Pagination, useToast } from "./ui";
import {
  EntityRegistry,
  MemoryLens,
  MemorySlotEditor,
} from "./memory-workbench";
import { PlanningWorkbench } from "./planning-workbench";
import { WorldWorkbench } from "./world-workbench";
import { StyleWorkbench } from "./style-workbench";
import { ThreadEventEditor } from "./thread-event-editor";
import "./structured-content.css";

type Field = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  description: string;
};
type Module = {
  key: string;
  label: string;
  instructions: string;
  fields: Field[];
};
type Config = { instructions: string; modules: Module[] };
type Release = {
  id: string;
  name: string;
  status: string;
  version: number;
  config: Config;
  validated: boolean;
  reason?: string;
  created_at?: string;
};
const moduleNames: Record<string, string> = {
  facts: "故事事实",
  characters: "人物与关系",
  knowledge: "人物认知",
  foreshadow: "伏笔与承诺",
  timeline: "事件时间线",
  world: "世界规则",
  planning: "故事规划",
};
const scopeNames: Record<string, string> = {
  canon: "已确认正史",
  candidate: "待确认候选",
  note: "作者手工记录",
};
const kindNames: Record<string, string> = {
  canonical: "客观事实",
  belief: "人物信念",
  prediction: "推测 / 未来事件",
  branch_fact: "试写分支事实",
  plan: "创作计划",
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const statusName = (value: string) =>
  ({ active: "生效中", draft: "草稿", archived: "历史版本" })[value] || value;

export function StructuredContent() {
  const [tab, setTab] = useState("config"),
    [selected, setSelected] = useState("");
  const cache = useQueryClient();
  const releases = useQuery<{ active_id: string; items: Release[] }>({
    queryKey: ["structure-releases"],
    queryFn: () => api("/admin/structured/releases"),
  });
  const refresh = () =>
    cache.invalidateQueries({ queryKey: ["structure-releases"] });
  if (releases.isPending) return <Spinner />;
  if (releases.error)
    return (
      <ErrorState error={releases.error} retry={() => releases.refetch()} />
    );
  const items = releases.data!.items,
    activeId = releases.data!.active_id;
  const version =
    items.find((r) => r.id === selected) ||
    items.find((r) => r.id === activeId)!;
  return (
    <div className="sc-page ref-page">
      <header className="sc-heading">
        <div>
          <span className="sc-eyebrow">
            <ShieldCheck size={15} />
            超级管理员
          </span>
          <h1>结构化内容管理</h1>
          <p>
            全局可改字段、选项和抽取说明；作品内可改人物档案、认知状态和事实。证据与审批规则由系统保证。
          </p>
        </div>
        <span className="sc-tag">
          当前生效：{items.find((r) => r.id === activeId)?.name}
        </span>
      </header>
      <GooeyNav aria-label="结构化管理区域" size="sm" items={["全局结构与抽取规则", "作品数据纠错"]} value={tab === "config" ? 0 : 1} onChange={(i) => setTab(i === 0 ? "config" : "projects")} />
      {tab === "config" ? (
        <ConfigEditor
          key={version.id}
          version={version}
          releases={items}
          activeId={activeId}
          select={setSelected}
          refresh={refresh}
        />
      ) : (
        <ProjectCorrections releases={items} />
      )}
    </div>
  );
}

function ConfigEditor({
  version,
  releases,
  activeId,
  select,
  refresh,
}: {
  version: Release;
  releases: Release[];
  activeId: string;
  select: (id: string) => void;
  refresh: () => Promise<unknown>;
}) {
  const dialogs = useDialogs(version.id);
  const [config, setConfig] = useState<Config>(() => clone(version.config)),
    [moduleKey, setModule] = useState("facts"),
    [reason, setReason] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [history, setHistory] = useState(false),
    [sample, setSample] = useState(false);
  const toast = useToast(),
    mod = config.modules.find((m) => m.key === moduleKey)!,
    editable = version.status === "draft",
    dirty = stable(config) !== stable(version.config);
  const updateModule = (changes: Partial<Module>) =>
    setConfig({
      ...config,
      modules: config.modules.map((m) =>
        m.key === moduleKey ? { ...m, ...changes } : m,
      ),
    });
  const updateField = (index: number, changes: Partial<Field>) =>
    updateModule({
      fields: mod.fields.map((f, i) =>
        i === index ? { ...f, ...changes } : f,
      ),
    });
  async function save() {
    setBusy(true);
    try {
      await put(`/admin/structured/releases/${version.id}`, {
        expected_version: version.version,
        config,
      });
      await refresh();
      toast("草稿已保存；生效版本未改变");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function action(r: Release, act: string) {
    if (!reason.trim()) {
      toast("请填写变更说明", true);
      return;
    }
    setBusy(true);
    try {
      await post(`/admin/structured/releases/${r.id}/${act}`, {
        expected_version: r.version,
        expected_active_id: activeId,
        reason,
      });
      await refresh();
      select(r.id);
      setHistory(false);
      toast(
        act === "validate"
          ? "结构校验通过"
          : act === "publish"
            ? "新版本已生效，后续抽取任务将使用此版本"
            : "历史配置已重新生效",
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="sc-toolbar">
        <label>
          查看版本
          <select
            aria-label="结构版本"
            value={version.id}
            onChange={async (e) => {
              const nextVersion = e.target.value;
              if (
                dirty &&
                !await dialogs.confirm("有未保存的字段修改，确认切换版本？")
              )
                return;
              select(nextVersion);
            }}
          >
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {statusName(r.status)}
              </option>
            ))}
          </select>
        </label>
        <div className="ref-actions">
          <button className="button secondary" onClick={() => setHistory(true)}>
            <History size={15} />
            版本记录
          </button>
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            基于此版本新建草稿
          </button>
        </div>
      </div>
      <div className="sc-notice">
        配置发布后用于新任务的结构化抽取与字段校验。已有任务保留其启动版本，历史作品不会被批量重写。证据、作品隔离和作者确认由程序强制执行。
      </div>
      <div className="sc-config-grid">
        <BounceSidebar
          className="sc-modules"
          aria-label="结构模块"
          activeKey={moduleKey}
        >
          {config.modules.map((m) => (
            <button
              key={m.key}
              className={moduleKey === m.key ? "active" : ""}
              data-bounce-active={moduleKey === m.key}
              aria-pressed={moduleKey === m.key}
              onClick={() => setModule(m.key)}
            >
              <span>{m.label}</span>
              <small>{m.fields.length} 个字段</small>
            </button>
          ))}
        </BounceSidebar>
        <section className="sc-box">
          <div className="sc-section-heading">
            <div>
              <h2>{mod.label}</h2>
              <p>
                {statusName(version.status)} ·{" "}
                {editable
                  ? "保存草稿后校验并发布"
                  : "已发布内容只读，修改请新建草稿"}
              </p>
            </div>
            <span className="sc-tag">{mod.key}</span>
          </div>
          <label className="field">
            <span>模块名称</span>
            <input
              value={mod.label}
              disabled={!editable}
              maxLength={60}
              onChange={(e) => updateModule({ label: e.target.value })}
            />
          </label>
          <label className="field">
            <span>全局抽取规则</span>
            <textarea
              rows={4}
              value={config.instructions}
              disabled={!editable}
              maxLength={12000}
              onChange={(e) =>
                setConfig({ ...config, instructions: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>本模块抽取规则</span>
            <textarea
              rows={4}
              value={mod.instructions}
              disabled={!editable}
              maxLength={8000}
              onChange={(e) => updateModule({ instructions: e.target.value })}
            />
          </label>
          <div className="sc-section-heading">
            <h3>结构字段</h3>
            {editable && (
              <button
                className="text-button"
                onClick={() =>
                  updateModule({
                    fields: [
                      ...mod.fields,
                      {
                        key: `field_${mod.fields.length + 1}`,
                        label: "新字段",
                        type: "text",
                        required: false,
                        options: [],
                        description: "",
                      },
                    ],
                  })
                }
                disabled={mod.fields.length >= 30}
              >
                <Plus size={14} />
                添加字段
              </button>
            )}
          </div>
          <div className="sc-field-list">
            {mod.fields.map((f, i) => (
              <div className="sc-field" key={i}>
                <label>
                  字段标识
                  <input
                    aria-label={`字段 ${i + 1} 标识`}
                    disabled={!editable}
                    value={f.key}
                    onChange={(e) => updateField(i, { key: e.target.value })}
                  />
                </label>
                <label>
                  显示名称
                  <input
                    aria-label={`字段 ${i + 1} 名称`}
                    disabled={!editable}
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                  />
                </label>
                <label>
                  类型
                  <select
                    aria-label={`字段 ${i + 1} 类型`}
                    disabled={!editable}
                    value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value })}
                  >
                    {[
                      ["text", "文本"],
                      ["number", "数字"],
                      ["boolean", "是 / 否"],
                      ["list", "文本列表"],
                      ["select", "选项"],
                    ].map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sc-check">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={f.required}
                    onChange={(e) =>
                      updateField(i, { required: e.target.checked })
                    }
                  />
                  必填
                </label>
                {editable && (
                  <DeleteButton
                    confirmation="inline"
                    className="icon-button"
                    aria-label={`移除字段 ${f.label}`}
                    onClick={() =>
                      updateModule({
                        fields: mod.fields.filter((_, j) => i !== j),
                      })
                    }
                  />
                )}
                <label className="sc-field-description">
                  抽取说明
                  <input
                    disabled={!editable}
                    value={f.description}
                    onChange={(e) =>
                      updateField(i, { description: e.target.value })
                    }
                  />
                </label>
                {f.type === "select" && (
                  <label className="sc-field-description">
                    允许选项（逗号分隔）
                    <input
                      disabled={!editable}
                      value={f.options.join(",")}
                      onChange={(e) =>
                        updateField(i, {
                          options: e.target.value
                            .split(/[,，]/)
                            .map((x) => x.trim()),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <label className="field">
            <span>变更说明 / 发布原因</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="例如：将人物认知区分为知道、相信和怀疑"
            />
          </label>
          <div className="sc-actions">
            <button
              className="button secondary"
              disabled={dirty}
              onClick={() => setSample(true)}
            >
              样例结构校验
            </button>
            {editable && (
              <>
                <button
                  className="button secondary"
                  disabled={busy || !dirty}
                  onClick={save}
                >
                  <Save size={15} />
                  保存草稿
                </button>
                <button
                  className="button secondary"
                  disabled={busy || dirty || reason.trim().length < 2}
                  onClick={() => action(version, "validate")}
                >
                  <Check size={15} />
                  校验配置
                </button>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    dirty ||
                    !version.validated ||
                    reason.trim().length < 2
                  }
                  onClick={() => action(version, "publish")}
                >
                  发布生效
                </button>
              </>
            )}
          </div>
        </section>
      </div>
      {creating && (
        <Drawer
          title="新建结构草稿"
          subtitle={`来源：${version.name}`}
          onClose={() => setCreating(false)}
        >
          <form
            className="sc-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const r = await post("/admin/structured/releases", {
                  source_id: version.id,
                  name,
                  reason,
                });
                await refresh();
                select(r.id);
                setCreating(false);
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>版本名称</span>
              <input
                autoFocus
                required
                minLength={1}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：人物认知结构 v2"
              />
            </label>
            <label className="field">
              <span>变更原因</span>
              <textarea
                required
                minLength={2}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy}>
              创建草稿
            </button>
          </form>
        </Drawer>
      )}
      {history && (
        <Drawer title="结构版本记录" onClose={() => setHistory(false)}>
          <label className="field">
            <span>恢复原因</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="恢复历史配置前填写原因"
            />
          </label>
          {releases.map((r) => (
            <article className="sc-history" key={r.id}>
              <strong>{r.name}</strong>
              <span className="sc-tag">{statusName(r.status)}</span>
              <p>
                {r.reason || "内置结构"} · {formatTime(r.created_at)}
              </p>
              <div className="sc-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    select(r.id);
                    setHistory(false);
                  }}
                >
                  查看
                </button>
                {r.status === "archived" && (
                  <button
                    className="button secondary small"
                    disabled={busy || reason.trim().length < 2}
                    onClick={() => action(r, "activate")}
                  >
                    <RotateCcw size={14} />
                    恢复此配置
                  </button>
                )}
              </div>
            </article>
          ))}
        </Drawer>
      )}
      {sample && (
        <SampleValidator version={version} close={() => setSample(false)} />
      )}
    </>
  );
}

function SampleValidator({
  version,
  close,
}: {
  version: Release;
  close: () => void;
}) {
  const [source, setSource] = useState("林照把信放在桌上。"),
    [json, setJson] = useState(
      JSON.stringify(
        [
          {
            content: "林照把信放在桌上。",
            kind: "canonical",
            category: "facts",
            attributes: {},
            visible_to: [],
            evidence: { start: 0, end: 9, quote: "林照把信放在桌上。" },
          },
        ],
        null,
        2,
      ),
    ),
    [result, setResult] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Drawer
      title="样例结构校验"
      subtitle={`${version.name} · 校验字段、类型与证据，不调用模型`}
      onClose={close}
      wide
    >
      <form
        className="sc-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setResult(null);
          try {
            setResult(
              await post("/admin/structured/validate-sample", {
                release_id: version.id,
                source,
                facts: JSON.parse(json),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>证据原文</span>
          <textarea
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={4}
          />
        </label>
        <label className="field">
          <span>抽取候选 JSON</span>
          <textarea
            className="code-input"
            required
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={15}
          />
        </label>
        <button className="button primary" disabled={busy}>
          运行校验
        </button>
        {error && (
          <p role="alert" className="sc-error">
            {error}
          </p>
        )}
        {result && (
          <p role="status" className="sc-success">
            {result.count} 条候选通过结构和证据校验。语义准确性仍需人工核对。
          </p>
        )}
      </form>
    </Drawer>
  );
}

function ProjectCorrections({ releases }: { releases: Release[] }) {
  const cache = useQueryClient();
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [pid, setPid] = useState(""),
    [scope, setScope] = useState(""),
    [category, setCategory] = useState(""),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [history, setHistory] = useState<any>(null);
  const projects = useQuery({
    queryKey: ["structure-projects", search, page],
    queryFn: () =>
      api(
        `/admin/structured/projects?${new URLSearchParams({ q: search, page: String(page) })}`,
      ),
  });
  const data = useQuery({
    queryKey: ["structure-project", pid],
    queryFn: () => api(`/admin/structured/projects/${pid}`),
    enabled: !!pid,
  });
  const selected = projects.data?.items.find((p: any) => p.id === pid),
    items = (data.data?.items || []).filter(
      (i: any) =>
        (!scope || i.scope === scope) &&
        (!category || i.category === category) &&
        (!query ||
          (i.name + JSON.stringify(i.fact?.attributes || {})).includes(query)),
    );
  return (
    <>
      <div className="sc-notice">
        此入口可纠正当前租户作品的数据。每次修改必须填写原因并保留前后版本；修正正史会标记依赖内容待复核，不改写正文。
      </div>
      <div className="sc-project-grid">
        <aside className="sc-box">
          <div className="sc-search">
            <Search size={16} />
            <input
              aria-label="搜索作品或作者"
              placeholder="搜索作品或作者"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {projects.isPending ? (
            <Spinner />
          ) : projects.error ? (
            <ErrorState error={projects.error} />
          ) : (
            <>
              {projects.data?.items.map((p: any) => (
                <button
                  className={`sc-project ${pid === p.id ? "active" : ""}`}
                  key={p.id}
                  onClick={() => {
                    setPid(p.id);
                    setScope("");
                    setCategory("");
                    setQuery("");
                  }}
                >
                  <strong>{p.title}</strong>
                  <small>
                    {p.owner_name} · 正史 v{p.canon_version}
                  </small>
                </button>
              ))}
              {!projects.data?.items.length && (
                <p className="muted">没有匹配的作品</p>
              )}
              <Pagination
                page={page}
                size={30}
                total={projects.data?.total || 0}
                setPage={setPage}
              />
            </>
          )}
        </aside>
        <section className="sc-box sc-project-data">
          {!pid ? (
            <Empty
              title="选择要核对的作品"
              description="按作品、作者查找，查看结构化候选、正史与连续性记录。"
            />
          ) : data.isPending ? (
            <Spinner />
          ) : data.error ? (
            <ErrorState error={data.error} />
          ) : (
            <>
              <div className="sc-section-heading">
                <div>
                  <h2>{data.data.project.title}</h2>
                  <p>
                    {selected?.owner_name} · 正史 v
                    {data.data.project.canon_version} · {data.data.items.length}{" "}
                    条记录
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => data.refetch()}
                >
                  刷新
                </button>
              </div>
              <details className="mw-history">
                <summary>人物与对象档案（可编辑）</summary>
                <EntityRegistry key={pid} pid={pid} admin />
              </details>
              <MemoryLens key={pid} pid={pid} admin />
              <details className="mw-history">
                <summary>分层规划与承诺（可编辑）</summary>
                <PlanningWorkbench key={pid} pid={pid} admin />
              </details>
              <h3>候选、正史与纠错</h3>
              <details className="mw-history">
                <summary>风格画像（可编辑）</summary>
                <StyleWorkbench key={pid} pid={pid} admin />
              </details>
              <details className="mw-history">
                <summary>世界规则（可编辑）</summary>
                <WorldWorkbench key={pid} pid={pid} admin />
              </details>
              <div className="sc-toolbar">
                <select
                  aria-label="数据范围"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="">全部数据范围</option>
                  {Object.entries(scopeNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="结构类型"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">全部结构类型</option>
                  {Object.entries(moduleNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="搜索记录"
                  placeholder="搜索内容或字段"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="sc-table-wrap">
                <table className="ref-table">
                  <thead>
                    <tr>
                      <th>类型 / 范围</th>
                      <th>内容与出处</th>
                      <th>章节</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any) => (
                      <tr key={item.target_id + (item.fact_id || "")}>
                        <td>
                          {moduleNames[item.category] || item.category}
                          <small>{scopeNames[item.scope]}</small>
                          {item.status === "needs_recheck" && (
                            <small>前置证据失效 · 待复核</small>
                          )}
                        </td>
                        <td>
                          <strong>{item.name}</strong>
                          <p className="sc-quote">
                            {item.fact?.evidence?.quote ||
                              item.note?.quote ||
                              "人工记录，未关联原文证据"}
                          </p>
                        </td>
                        <td>{item.chapter}</td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setEditing(item)}
                          >
                            核对与修正
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!items.length && (
                <Empty
                  title="没有匹配的结构化记录"
                  description="作品产生记忆候选、确认事实或手工连续性记录后，会显示在这里。"
                />
              )}
              <div className="sc-section-heading">
                <h3>本作品修改记录</h3>
                <small>最近 200 次</small>
              </div>
              {data.data.history.length ? (
                data.data.history.map((r: any) => (
                  <button
                    className="sc-history sc-history-button"
                    key={r.id}
                    onClick={() => setHistory(r)}
                  >
                    <div>
                      <strong>
                        {scopeNames[r.data.scope]} ·{" "}
                        {r.data.operation === "retract" ? "撤回" : "修正"}
                      </strong>
                      <span>{formatTime(r.created_at)}</span>
                    </div>
                    <p>{r.data.reason}</p>
                    <small>
                      {r.data.actor_name} · {r.data.impacts.length}{" "}
                      个正文版本需复核
                    </small>
                  </button>
                ))
              ) : (
                <p className="muted">还没有后台修正记录</p>
              )}
            </>
          )}
        </section>
      </div>
      {editing && (
        <CorrectionEditor
          item={editing}
          project={data.data.project}
          releases={releases}
          close={() => setEditing(null)}
          saved={async () => {
            await cache.invalidateQueries();
            await data.refetch();
            await projects.refetch();
            setEditing(null);
          }}
        />
      )}
      {history && (
        <Drawer
          wide
          title="修改记录与差异"
          subtitle={`${history.data.actor_name} · ${formatTime(history.created_at)}`}
          onClose={() => setHistory(null)}
        >
          <p>{history.data.reason}</p>
          <div className="sc-diff">
            <section>
              <h3>修改前</h3>
              <pre>{JSON.stringify(history.data.before, null, 2)}</pre>
            </section>
            <section>
              <h3>
                {history.data.operation === "retract" ? "已撤回内容" : "修改后"}
              </h3>
              <pre>{JSON.stringify(history.data.after, null, 2)}</pre>
            </section>
          </div>
          <h3>影响范围</h3>
          {history.data.impacts.length ? (
            history.data.impacts.map((i: any) => (
              <p key={i.id}>
                第 {i.chapter} 章 · {i.status}
              </p>
            ))
          ) : (
            <p>未修改正文内容。</p>
          )}
        </Drawer>
      )}
    </>
  );
}

function CorrectionEditor({
  item,
  project,
  releases,
  close,
  saved,
}: {
  item: any;
  project: any;
  releases: Release[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const note = item.scope === "note";
  const [value, setValue] = useState<any>(() =>
    note
      ? {
          ...Object.fromEntries(
            [
              "content",
              "category",
              "project_id",
              "state",
              "character",
              "chapter",
              "expected_chapter",
              "source_id",
              "quote",
              "purpose",
            ]
              .filter((k) => k in item.note)
              .map((k) => [k, item.note[k]]),
          ),
          name: item.name,
        }
      : {
          ...clone(item.fact),
          attributes: item.fact.attributes || {},
          category: item.fact.category || "facts",
        },
  );
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState("replace"),
    [showDiff, setShowDiff] = useState(false);
  const toast = useToast();
  const source = useQuery({
    queryKey: ["structure-source", project.id, item.source_id],
    queryFn: () =>
      api(`/admin/structured/projects/${project.id}/sources/${item.source_id}`),
    enabled: !!item.source_id,
  });
  const config =
    releases.find((r) => r.id === item.schema_id)?.config ||
    releases.find((r) => r.id === "builtin-1")!.config;
  const mod = config.modules.find((m) => m.key === value.category);
  const update = (changes: any) => setValue((v: any) => ({ ...v, ...changes }));
  function locate() {
    const quote = value.evidence.quote || "",
      text = source.data?.text || "",
      pos = text.indexOf(quote);
    if (!quote || pos < 0) {
      toast("引文不在当前证据原文中", true);
      return;
    }
    update({
      evidence: {
        quote,
        start: Array.from(text.slice(0, pos)).length,
        end: Array.from(text.slice(0, pos) + quote).length,
      },
    });
  }
  async function submit() {
    setBusy(true);
    try {
      await post(`/admin/structured/projects/${project.id}/corrections`, {
        scope: item.scope,
        target_id: item.target_id,
        fact_id: item.fact_id || null,
        expected_version: project.version,
        expected_canon_version: project.canon_version,
        expected_hash: item.hash,
        operation,
        reason,
        value,
      });
      await saved();
      toast(
        operation === "retract"
          ? "记录已撤回，历史版本已保留"
          : "修正已保存，用户端将读取新版本",
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      wide
      title="核对与修正"
      subtitle={`${scopeNames[item.scope]} · 第 ${item.chapter} 章 · ${project.title}`}
      onClose={close}
      footer={
        <>
          <button
            className="button secondary"
            onClick={() => setShowDiff(!showDiff)}
          >
            比较修改
          </button>
          <button
            className="button primary"
            disabled={busy || reason.trim().length < 2}
            onClick={submit}
          >
            {busy
              ? "保存中…"
              : operation === "retract"
                ? "确认撤回"
                : "保存修正"}
          </button>
        </>
      }
    >
      <div className="sc-notice">
        {item.scope === "canon"
          ? "保存后新增正史纠错版本，后续章节标记待复核，正文与原始证据不被覆盖。"
          : item.scope === "candidate"
            ? "修正后仍是待确认候选，由作者决定是否采用。"
            : "手工记录仍作为参考资料，不自动升级为正史。"}
      </div>
      <div className="sc-form">
        <label className="field">
          <span>操作</span>
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
          >
            <option value="replace">修正记录</option>
            <option value="retract">撤回这条记录</option>
          </select>
        </label>
        <fieldset disabled={operation === "retract"} className="sc-fieldset">
          {note ? (
            <>
              <label className="field">
                <span>记录名称</span>
                <input
                  value={value.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>内容</span>
                <textarea
                  rows={5}
                  value={value.content}
                  onChange={(e) => update({ content: e.target.value })}
                />
              </label>
              <div className="sc-two">
                <label className="field">
                  <span>关联人物</span>
                  <input
                    value={value.character || ""}
                    onChange={(e) => update({ character: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>状态</span>
                  <select
                    value={value.state}
                    onChange={(e) => update({ state: e.target.value })}
                  >
                    {[
                      ["note", "记录"],
                      ["knows", "知道"],
                      ["believes", "相信"],
                      ["suspects", "怀疑"],
                      ["unknown", "未知"],
                      ["setup", "已埋下"],
                      ["paid_off", "已回收"],
                      ["abandoned", "已取消"],
                      ["locked", "锁定"],
                      ["favorite", "收藏"],
                      ["excluded", "排除"],
                    ].map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="sc-two">
                <label className="field">
                  <span>发生章节</span>
                  <input
                    type="number"
                    min={1}
                    value={value.chapter}
                    onChange={(e) =>
                      update({ chapter: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>预期兑现章节</span>
                  <input
                    type="number"
                    min={1}
                    value={value.expected_chapter || ""}
                    onChange={(e) =>
                      update({
                        expected_chapter: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="sc-two">
                <label className="field">
                  <span>结构类型</span>
                  <select
                    value={value.category}
                    onChange={(e) =>
                      update({
                        category: e.target.value,
                        attributes: {},
                        kind:
                          e.target.value === "planning" ? "plan" : value.kind,
                      })
                    }
                  >
                    {config.modules.map((m) => (
                      <option value={m.key} key={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>内容性质</span>
                  <select
                    value={value.kind}
                    onChange={(e) => update({ kind: e.target.value })}
                  >
                    {Object.entries(kindNames).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>结构化内容</span>
                <textarea
                  rows={4}
                  value={value.content}
                  onChange={(e) => update({ content: e.target.value })}
                />
              </label>
              <label className="field">
                <span>旧版可见标记（认知台账以认知主体为准）</span>
                <input
                  value={(value.visible_to || []).join(",")}
                  onChange={(e) =>
                    update({
                      visible_to: e.target.value
                        .split(/[,，]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <MemorySlotEditor
                pid={project.id}
                admin
                excludeEventId={
                  item.scope === "canon" ? item.target_id : undefined
                }
                fact={value}
                change={setValue}
                chapter={item.chapter}
              />
              <ThreadEventEditor
                pid={project.id}
                admin
                fact={value}
                change={setValue}
              />
              <div className="sc-two">
                {mod?.fields.map((f) => (
                  <AttributeField
                    key={f.key}
                    field={f}
                    value={value.attributes[f.key]}
                    change={(v) =>
                      update({
                        attributes: { ...value.attributes, [f.key]: v },
                      })
                    }
                  />
                ))}
              </div>
            </>
          )}
          {item.source_id && (
            <>
              <label className="field">
                <span>证据引文</span>
                <textarea
                  rows={3}
                  value={note ? value.quote : value.evidence?.quote || ""}
                  onChange={(e) =>
                    note
                      ? update({ quote: e.target.value })
                      : update({
                          evidence: {
                            ...value.evidence,
                            quote: e.target.value,
                          },
                        })
                  }
                />
              </label>
              {!note && (
                <div className="sc-evidence-controls">
                  <label>
                    起始位置
                    <input
                      type="number"
                      min={0}
                      value={value.evidence.start}
                      onChange={(e) =>
                        update({
                          evidence: {
                            ...value.evidence,
                            start: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    结束位置
                    <input
                      type="number"
                      min={1}
                      value={value.evidence.end}
                      onChange={(e) =>
                        update({
                          evidence: {
                            ...value.evidence,
                            end: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={locate}
                    disabled={!source.data}
                  >
                    定位引文
                  </button>
                </div>
              )}
            </>
          )}
        </fieldset>
        <label className="field">
          <span>修正原因（必填）</span>
          <textarea
            rows={2}
            minLength={2}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明错误、证据与修正依据"
          />
        </label>
        {source.isError ? (
          <ErrorState error={source.error} />
        ) : (
          source.data && (
            <details className="sc-source">
              <summary>
                <FileText size={15} />
                查看证据原文 · 第 {source.data.chapter} 章
              </summary>
              <pre>{source.data.text}</pre>
            </details>
          )
        )}
        {showDiff && (
          <div className="sc-diff">
            <section>
              <h3>原始记录</h3>
              <pre>{JSON.stringify(item.fact || item.note, null, 2)}</pre>
            </section>
            <section>
              <h3>{operation === "retract" ? "撤回此记录" : "修正预览"}</h3>
              <pre>{JSON.stringify(value, null, 2)}</pre>
            </section>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function AttributeField({
  field,
  value,
  change,
}: {
  field: Field;
  value: any;
  change: (v: any) => void;
}) {
  return (
    <label className="field">
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.type === "select" ? (
        <select value={value || ""} onChange={(e) => change(e.target.value)}>
          <option value="">请选择</option>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <select
          value={value === undefined ? "" : String(value)}
          onChange={(e) =>
            change(e.target.value === "" ? null : e.target.value === "true")
          }
        >
          <option value="">未记录</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      ) : (
        <input
          type={field.type === "number" ? "number" : "text"}
          value={
            field.type === "list" ? (value || []).join(",") : (value ?? "")
          }
          onChange={(e) =>
            change(
              field.type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : field.type === "list"
                  ? e.target.value
                      .split(/[,，]/)
                      .map((x) => x.trim())
                      .filter(Boolean)
                  : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
