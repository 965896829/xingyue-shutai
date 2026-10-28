"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Download,
  Upload,
  RotateCcw,
  ChevronDown,
  Calculator,
} from "lucide-react";
import {
  api,
  post,
  put,
  type PageSpec,
  type DataRecord,
  type Catalog,
  formatTime,
  label,
} from "@reference/lib/api";
import {
  CompactHeading,
  Modal,
  RefEmpty,
  SearchBox,
} from "./reference-ui";
import { Spinner, ErrorState, useToast } from "./ui";
import { ProcessLogs } from "./admin-parity-tools";
import { RuntimeLoad } from "./runtime-controls";
import { RoleActionPermissions } from "./role-action-permissions";

export function ReferenceSystem({ page }: { page: PageSpec }) {
  if (page.view === "roles") return <Roles />;
  if (page.view === "backups") return <Backups />;
  if (page.view === "load") return <RuntimeLoad />;
  return <ProcessLogs />;
}
function Roles() {
  const q = useQuery({
      queryKey: ["roles"],
      queryFn: () => api("/admin/system/roles"),
    }),
    catalog = useQuery<Catalog>({
      queryKey: ["catalog"],
      queryFn: () => api("/admin/catalog"),
    }),
    toast = useToast();
  const [role, setRole] = useState("operator"),
    [selected, setSelected] = useState<string[]>([]),
    [expanded, setExpanded] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setSelected(q.data?.items.find((r: any) => r.role === role)?.pages || []);
  }, [q.data, role]);
  if (q.isPending || catalog.isPending) return <Spinner />;
  if (q.error || catalog.error)
    return <ErrorState error={(q.error || catalog.error) as Error} />;
  const saved: string[] =
      q.data.items.find((r: any) => r.role === role)?.pages || [],
    changes = catalog.data!.pages.filter(
      (p) => saved.includes(p.key) !== selected.includes(p.key),
    );
  const locked = role === "superadmin";
  return (
    <div className="ref-page ref-roles-page">
      <CompactHeading
        title="角色菜单权限"
        description="勾选菜单即授予对应页面、直接路由和管理接口的能力。"
      />
      <p className="ref-notice">
        超级管理员始终拥有全部后台权限；此处配置其他管理角色的页面权限。
      </p>
      <RoleActionPermissions role={role} />
      <div className="ref-role-layout">
        <aside className="ref-role-list">
          {q.data.items
            .filter((r: any) => !r.immutable)
            .map((r: any) => (
              <button
                className={role === r.role ? "active" : ""}
                key={r.role}
                onClick={() => setRole(r.role)}
              >
                <span>{label(r.role)}</span>
                <small>{r.pages.length}</small>
              </button>
            ))}
        </aside>
        <div className="ref-role-main">
          <section className="ref-box">
            <div className="ref-heading">
              <div>
                <h2>{label(role)}</h2>
                <p>
                  当前 {selected.length} 项 · 系统默认{" "}
                  {q.data.items.find((r: any) => r.role === role)?.default_pages
                    ?.length || 0}{" "}
                  项
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  setSelected(
                    q.data.items.find((r: any) => r.role === role)
                      ?.default_pages || [],
                  )
                }
              >
                恢复系统默认
              </button>
            </div>
            <div className="ref-role-controls">
              <span>全部 {catalog.data!.pages.length}</span>
              <span>已选 {selected.length}</span>
              <span>变更 {changes.length}</span>
              <button
                className="text-button"
                onClick={() =>
                  setExpanded(catalog.data!.groups.map((g) => g.key))
                }
              >
                展开全部
              </button>
              <button className="text-button" onClick={() => setExpanded([])}>
                收起全部
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  setSelected(catalog.data!.pages.map((p) => p.key))
                }
              >
                全选
              </button>
              <button
                className="button secondary"
                onClick={() => setSelected([])}
              >
                清空
              </button>
              <button
                className="button secondary"
                onClick={() => setSelected([...saved])}
              >
                撤销修改
              </button>
              <button
                className="button primary"
                disabled={busy || !changes.length || locked}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await put(`/admin/system/roles/${role}`, {
                      pages: selected,
                      expected_version: q.data.items.find(
                        (r: any) => r.role === role,
                      )?.version,
                    });
                    await q.refetch();
                    toast("角色权限已保存");
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存配置
              </button>
            </div>
          </section>
          <div className="ref-role-detail">
            <section className="ref-box">
              <h3>菜单权限</h3>
              <p className="ref-description">
                授权同时作用于入口、路由与接口。
              </p>
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="搜索菜单…"
              />
              <div className="ref-permission-tree">
                {catalog.data!.groups.map((g) => {
                  const children = catalog.data!.pages.filter(
                    (p) => p.group === g.key && p.label.includes(search),
                  );
                  if (!children.length) return null;
                  const keys = children.map((p) => p.key);
                  return (
                    <section key={g.key}>
                      <div>
                        <button
                          className="icon-button"
                          aria-label={`${expanded.includes(g.key) ? "收起" : "展开"}${g.source_label}`}
                          onClick={() =>
                            setExpanded((v) =>
                              v.includes(g.key)
                                ? v.filter((k) => k !== g.key)
                                : [...v, g.key],
                            )
                          }
                        >
                          <ChevronDown
                            size={15}
                            style={{
                              transform: expanded.includes(g.key)
                                ? "none"
                                : "rotate(-90deg)",
                            }}
                          />
                        </button>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`授权${g.source_label}`}
                            checked={keys.every((k) => selected.includes(k))}
                            onChange={(e) =>
                              setSelected((v) =>
                                e.target.checked
                                  ? [...new Set([...v, ...keys])]
                                  : v.filter((k) => !keys.includes(k)),
                              )
                            }
                          />
                          {g.source_label}
                        </label>
                        <small>
                          {keys.filter((k) => selected.includes(k)).length}/
                          {keys.length}
                        </small>
                      </div>
                      {(expanded.includes(g.key) || !!search) && (
                        <div className="ref-permission-children">
                          {children.map((p) => (
                            <label key={p.key}>
                              <input
                                type="checkbox"
                                checked={selected.includes(p.key)}
                                onChange={(e) =>
                                  setSelected((v) =>
                                    e.target.checked
                                      ? [...v, p.key]
                                      : v.filter((k) => k !== p.key),
                                  )
                                }
                              />
                              {p.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
            <section className="ref-box ref-role-changes">
              <h3>变更摘要</h3>
              <p className="ref-description">保存前请确认影响范围</p>
              <strong>{changes.length}</strong>
              {changes.length ? (
                changes.map((p) => (
                  <div className="ref-change-item" key={p.key}>
                    <span>
                      {selected.includes(p.key) ? "+ 授予" : "− 移除"}
                    </span>
                    {p.label}
                  </div>
                ))
              ) : (
                <RefEmpty text="暂无未保存修改" />
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
function Backups() {
  const q = useQuery({
      queryKey: ["backups"],
      queryFn: () => api("/admin/system/backups"),
    }),
    toast = useToast();
  const [busy, setBusy] = useState(false),
    [retentionDays, setRetentionDays] = useState(30),
    [deleting, setDeleting] = useState<DataRecord | null>(null),
    [target, setTarget] = useState<DataRecord | null>(null),
    [confirmation, setConfirmation] = useState("");
  const choose = (r: DataRecord) => {
    setConfirmation("");
    setTarget(r);
  };
  async function create() {
    setBusy(true);
    try {
      await post("/admin/system/backups", { retention_days: retentionDays });
      await q.refetch();
      toast("数据备份已创建");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ref-page">
      <p className="ref-notice">
        手动备份包含数据库及最多 100 MB 文件资产，并逐文件校验哈希。启用 S3
        时备份保存到该远程存储；还原会覆盖数据库并使会话失效，运行与日程先暂停。
        已登记的作品删除请求会保留。新备份按下方期限自动清理，0
        天表示手动清理；导入副本保留 30 天。
      </p>
      <div className="ref-toolbar">
        <label className="field">
          新备份保留天数
          <input
            type="number"
            min={0}
            max={3650}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
        </label>
        <button className="button primary" disabled={busy} onClick={create}>
          <Plus size={14} />
          手动创建新备份
        </button>
        <button
          className="button secondary"
          disabled={
            !q.data?.items.some(
              (r: DataRecord) => r.status === "completed" && r.data.file_id,
            ) || busy
          }
          onClick={() =>
            choose(
              q.data.items.find(
                (r: DataRecord) => r.status === "completed" && r.data.file_id,
              ),
            )
          }
        >
          <RotateCcw size={14} />
          还原最近备份
        </button>
        <label className="button secondary">
          <Upload size={14} />
          上传本地备份文件还原
          <input
            className="file-input"
            type="file"
            accept=".backup"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                const body = new FormData();
                body.append("file", file);
                const r = await api("/admin/system/backups/import", {
                  method: "POST",
                  body,
                });
                await q.refetch();
                choose(r);
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>
      {q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                {[
                  "序号",
                  "备注",
                  "备份时间",
                  "服务器备份",
                  "OSS远程备份",
                  "保留期限",
                  "操作",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.isPending ? (
                <tr>
                  <td colSpan={7}>
                    <Spinner />
                  </td>
                </tr>
              ) : q.data.items.length ? (
                q.data.items.map((r: DataRecord, i: number) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td>{formatTime(r.created_at)}</td>
                    <td>{(r.data.size / 1024).toFixed(1)} KB · 已加密</td>
                    <td>
                      {r.data.remote ? "已保存到 S3" : "本地"} ·{" "}
                      {r.data.includes_files
                        ? `${r.data.asset_count} 个文件`
                        : "仅数据库"}
                    </td>
                    <td>
                      {r.status === "deleted"
                        ? "已手动清除"
                        : r.status === "expired"
                          ? "已到期清除"
                          : r.data.expires_at
                            ? formatTime(r.data.expires_at)
                            : "手动清理"}
                    </td>
                    <td>
                      {r.status === "completed" && r.data.file_id && (
                        <div className="ref-row-actions">
                          <a href={`/api/v1/files/${r.data.file_id}`}>
                            <Download size={13} />
                            下载
                          </a>
                          <button onClick={() => choose(r)}>
                            <RotateCcw size={13} />
                            还原
                          </button>
                          <DeleteButton
                            confirmation="dialog"
                            onClick={() => setDeleting(r)}
                          >
                            删除
                          </DeleteButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <RefEmpty />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {deleting && (
        <Modal
          title="删除备份"
          onClose={() => setDeleting(null)}
          footer={
            <DeleteButton
              confirmation="commit"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    `/admin/system/backups/${deleting.id}?expected_version=${deleting.version}`,
                    { method: "DELETE" },
                  );
                  setDeleting(null);
                  await q.refetch();
                  toast("备份文件已清除");
                } catch (e) {
                  toast((e as Error).message, true);
                  return false;
                } finally {
                  setBusy(false);
                }
              }}
            >
              确定删除
            </DeleteButton>
          }
        >
          <p>
            删除「{deleting.name}
            」会清除对应的备份文件，此副本将无法下载或还原。
          </p>
        </Modal>
      )}
      {target && (
        <Modal
          title="还原备份"
          onClose={() => setTarget(null)}
          footer={
            <button
              className="button danger"
              disabled={busy || confirmation !== "还原此备份"}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/admin/system/backups/${target.id}/restore`, {
                    confirmation,
                  });
                  window.location.reload();
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认还原
            </button>
          }
        >
          <p className="ref-notice">还原「{target.name}」会覆盖当前数据库。</p>
          <label className="field">
            <span>输入“还原此备份”</span>
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
        </Modal>
      )}
    </div>
  );
}

export function ReferenceCalculator() {
  const q = useQuery({
      queryKey: ["calculator-options"],
      queryFn: async () => {
        const [pricing, platforms, models] = await Promise.all(
          ["pricing", "platforms", "models"].map((k) =>
            api(`/admin/records/${k}?page_size=200`),
          ),
        );
        return {
          pricing: pricing.items,
          platforms: platforms.items,
          models: models.items,
        };
      },
    }),
    toast = useToast();
  const [platform, setPlatform] = useState(""),
    [model, setModel] = useState(""),
    [capability, setCapability] = useState("text"),
    [form, setForm] = useState({
      pricing_id: "",
      input_tokens: 1000,
      output_tokens: 1000,
      cache_read_tokens: 0,
      characters: 1000,
      input_seconds: 0,
      output_seconds: 0,
      quantity: 1,
    }),
    [dimensions, setDimensions] = useState<Record<string, string>>({}),
    [advanced, setAdvanced] = useState("{}"),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const selectedPricing = q.data?.pricing.find(
    (p: DataRecord) => p.id === form.pricing_id,
  );
  const modeConfig = selectedPricing?.data.billing_modes?.[capability];
  const unit =
    q.data?.pricing.find((p: DataRecord) => p.id === form.pricing_id)?.data
      .unit || "million_tokens";
  const calculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const values = JSON.parse(advanced);
      if (!values || Array.isArray(values) || typeof values !== "object")
        throw new Error("高级参数必须是 JSON 对象");
      setResult(
        await post("/admin/calculator", {
          ...form,
          resource_type: capability,
          platform_id: platform,
          model_id: model,
          dimensions,
          ...values,
        }),
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ref-page">
      <CompactHeading
        title="算力试算"
        description="按客户端模型单价和 Token 数量估算成本。平台算力与折扣尚未接入。"
      />
      {q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="ref-calculator-layout">
          <section className="ref-box">
            <h3>试算条件</h3>
            <p className="ref-description">
              选择模型对应的定价规则，填写本次请求的计费参数。
            </p>
            <form className="ref-form" onSubmit={calculate}>
              <label className="field">
                <span>平台</span>
                <select
                  value={platform}
                  onChange={(e) => {
                    setPlatform(e.target.value);
                    const p = q.data?.platforms.find(
                      (p: DataRecord) => p.id === e.target.value,
                    );
                    setForm({ ...form, pricing_id: p?.data.pricing_id || "" });
                  }}
                >
                  <option value="">按当前调度匹配</option>
                  {q.data?.platforms.map((r: DataRecord) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>能力类型</span>
                <select
                  value={capability}
                  onChange={(e) => {
                    setCapability(e.target.value);
                    setDimensions({});
                    setResult(null);
                  }}
                >
                  {[
                    "text",
                    "image_vectorize",
                    "image",
                    "video",
                    "video_enhance",
                    "speech_to_text",
                    "audio",
                    "music",
                    "digital_human",
                    "model",
                    "embedding",
                    "rerank",
                  ].map((v) => (
                    <option key={v} value={v}>
                      {(
                        {
                          image_vectorize: "图片转矢量",
                          video_enhance: "视频增强",
                          speech_to_text: "语音识别",
                          audio: "音频合成",
                          music: "音乐生成",
                          digital_human: "数字人",
                          model: "模型生成",
                        } as Record<string, string>
                      )[v] || label(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>模型</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">请选择模型</option>
                  {q.data?.models
                    .filter(
                      (m: DataRecord) =>
                        m.data.capability === capability &&
                        (!platform ||
                          q.data?.platforms
                            .find((p: DataRecord) => p.id === platform)
                            ?.data.models?.includes(m.data.model_id)),
                    )
                    .map((m: DataRecord) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>定价规则</span>
                <select
                  value={form.pricing_id}
                  onChange={(e) =>
                    setForm({ ...form, pricing_id: e.target.value })
                  }
                >
                  <option value="">默认定价</option>
                  {q.data?.pricing.map((r: DataRecord) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {(modeConfig
                ? capability === "text"
                  ? [
                      "input_tokens",
                      "cache_read_tokens",
                      "output_tokens",
                      "quantity",
                    ]
                  : capability === "audio"
                    ? ["characters", "quantity"]
                    : [
                          "video",
                          "video_enhance",
                          "speech_to_text",
                          "digital_human",
                        ].includes(capability)
                      ? ["input_seconds", "output_seconds", "quantity"]
                      : ["quantity"]
                : unit === "million_tokens"
                  ? [
                      "input_tokens",
                      "cache_read_tokens",
                      "output_tokens",
                      "quantity",
                    ]
                  : unit === "second"
                    ? ["input_seconds", "output_seconds", "quantity"]
                    : ["quantity"]
              ).map((k) => (
                <label className="field" key={k}>
                  <span>
                    {
                      (
                        {
                          input_tokens: "输入 Token",
                          cache_read_tokens: "缓存输入 Token",
                          characters: "字符数",
                          output_tokens: "输出 Token",
                          input_seconds: "输入秒数",
                          output_seconds: "输出秒数",
                          quantity: "数量",
                        } as Record<string, string>
                      )[k]
                    }
                  </span>
                  <input
                    type="number"
                    min={k === "quantity" ? 1 : 0}
                    step={k.includes("seconds") ? 0.001 : 1}
                    value={(form as any)[k]}
                    onChange={(e) =>
                      setForm({ ...form, [k]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              {Object.entries(modeConfig?.weights || {}).map(
                ([key, weights]: [string, any]) => (
                  <label className="field" key={key}>
                    <span>
                      {(
                        {
                          resolution: "分辨率",
                          quality: "图像质量",
                          output_resolution: "输出视频分辨率",
                          sound: "生成声音",
                          reference_video: "参考视频",
                          voice: "指定音色",
                          texture: "贴图",
                        } as Record<string, string>
                      )[key] || key}
                    </span>
                    <select
                      value={dimensions[key] || ""}
                      onChange={(e) =>
                        setDimensions((v) => ({ ...v, [key]: e.target.value }))
                      }
                    >
                      <option value="">不指定（权重 1）</option>
                      {Object.entries(weights).map(([k, v]) => (
                        <option key={k} value={k}>
                          {k} ×{String(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )}
              {capability === "video_enhance" &&
                [
                  "source_resolution",
                  "target_resolution",
                  "source_fps",
                  "target_fps",
                ].map((key) => (
                  <label className="field" key={key}>
                    <span>
                      {
                        (
                          {
                            source_resolution: "源分辨率",
                            target_resolution: "目标分辨率",
                            source_fps: "源帧率",
                            target_fps: "目标帧率",
                          } as Record<string, string>
                        )[key]
                      }
                    </span>
                    <select
                      value={dimensions[key] || ""}
                      onChange={(e) =>
                        setDimensions((v) => ({ ...v, [key]: e.target.value }))
                      }
                    >
                      <option value="">请选择</option>
                      {(key.includes("fps")
                        ? ["24", "30", "60", "120", "240"]
                        : ["480p", "720p", "1080p", "1440p", "2160p"]
                      ).map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                ))}
              <details>
                <summary>高级 JSON 参数</summary>
                <p className="ref-field-help">同名字段会覆盖上方表单</p>
                <textarea
                  aria-label="高级 JSON 参数"
                  rows={4}
                  value={advanced}
                  onChange={(e) => setAdvanced(e.target.value)}
                />
              </details>
              <div className="ref-actions">
                <button className="button primary" disabled={busy}>
                  <Calculator size={14} />
                  试算
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setForm({
                      pricing_id: "",
                      input_tokens: 1000,
                      output_tokens: 1000,
                      cache_read_tokens: 0,
                      characters: 1000,
                      input_seconds: 0,
                      output_seconds: 0,
                      quantity: 1,
                    });
                    setAdvanced("{}");
                    setDimensions({});
                    setResult(null);
                  }}
                >
                  重置
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        JSON.stringify(
                          {
                            ...form,
                            resource_type: capability,
                            platform_id: platform,
                            model_id: model,
                            dimensions,
                            ...JSON.parse(advanced),
                          },
                          null,
                          2,
                        ),
                      );
                      toast("请求参数已复制");
                    } catch {
                      toast("无法复制参数，请检查 JSON", true);
                    }
                  }}
                >
                  复制请求参数
                </button>
              </div>
            </form>
          </section>
          <section className="ref-box">
            <h3>计算结果</h3>
            <p className="ref-description">
              按客户端已配置的模型单价计算，不会调用模型。
            </p>
            {result ? (
              <div className="ref-calculation-result">
                <strong>{result.credits}</strong>
                <span>预计请求成本</span>
                <dl>
                  {Object.entries(result)
                    .filter(([k]) => k !== "credits")
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>
                          {(
                            {
                              standard_credits: "标准价格算力",
                              platform_discount: "平台 / 模型折扣",
                              organization_discount: "组织折扣",
                              discount_source: "折扣来源",
                              discount_version: "折扣版本",
                              platform_name: "匹配平台",
                              rounding: "取整方式",
                            } as Record<string, string>
                          )[k] || k}
                        </dt>
                        <dd>{label(v)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : (
              <RefEmpty text="等待试算；填写左侧参数后点击试算" />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
