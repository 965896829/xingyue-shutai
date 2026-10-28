"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Download,
  Upload,
  RefreshCw,
  MoreHorizontal,
  X,
  Pencil,
  Check,
  KeyRound,
  FileText,
  Sparkles,
  LoaderCircle,
  SlidersHorizontal,
  Copy,
  Database,
  Wallet,
} from "lucide-react";
import {
  api,
  post,
  put,
  label,
  formatTime,
  type PageSpec,
  type DataRecord,
  type Field,
} from "@reference/lib/api";
import {
  PageHeading,
  Spinner,
  Empty,
  ErrorState,
  Drawer,
  Status,
  Pagination,
  useToast,
} from "./ui";

import { ResourceExtras, UserActivity } from "./resource-extras";

const ACTIONS: Record<string, string> = {
  edit: "编辑",
  toggle: "启用 / 停用",
  delete: "删除",
  probe: "测试连接",
  sync: "同步",
  test: "测试",
  duplicate: "创建副本",
  publish: "发布",
  approve: "审核通过",
  reject: "拒绝",
  unlist: "下架",
  revoke: "撤销",
  pay: "沙箱支付",
  refund: "沙箱退款",
  invoice: "登记发票",
  cancel: "取消续费",
  renew: "创建续费订单",
  redeem: "代为兑换",
  settle: "确认结算",
  complete: "登记已转账",
  search: "检索测试",
  recall: "召回测试",
  upload: "上传文件",
  detail: "查看详情",
};
const USER_FIELDS: Field[] = [
  {
    key: "username",
    label: "用户名",
    type: "text",
    required: true,
    options: [],
    default: "",
  },
  {
    key: "nickname",
    label: "显示名称",
    type: "text",
    required: false,
    options: [],
    default: "",
  },
  {
    key: "password",
    label: "密码（编辑时留空保持原密码）",
    type: "secret",
    required: false,
    options: [],
    default: "",
  },
  {
    key: "role",
    label: "角色",
    type: "select",
    required: true,
    options: [
      "author",
      "creator",
      "operator",
      "manager",
      "evaluator",
      "superadmin",
    ],
    default: "author",
  },
  {
    key: "email",
    label: "邮箱",
    type: "email",
    required: false,
    options: [],
    default: "",
  },
  {
    key: "phone",
    label: "手机号码",
    type: "text",
    required: false,
    options: [],
    default: "",
  },
  {
    key: "status",
    label: "账号状态",
    type: "select",
    required: true,
    options: ["active", "disabled"],
    default: "active",
  },
];
export function FieldControl({
  field: f,
  value,
  onChange,
  configured = false,
}: {
  field: Field;
  value: any;
  onChange: (value: any) => void;
  configured?: boolean;
}) {
  if (f.type === "boolean")
    return (
      <button
        type="button"
        className={`toggle-switch ${value ? "on" : ""}`}
        role="switch"
        aria-checked={!!value}
        aria-label={f.label}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    );
  if (f.type === "select")
    return (
      <select
        value={value ?? ""}
        required={f.required}
        onChange={(e) => onChange(e.target.value)}
      >
        {!f.required && <option value="">请选择</option>}
        {f.options.map((v) => (
          <option value={v} key={v}>
            {label(v)}
          </option>
        ))}
      </select>
    );
  if (f.type === "textarea" || f.type === "json")
    return (
      <textarea
        className={f.type === "json" ? "code-input" : ""}
        rows={f.type === "json" ? 6 : 4}
        required={f.required}
        value={
          typeof value === "object"
            ? JSON.stringify(value, null, 2)
            : (value ?? "")
        }
        placeholder={f.type === "json" ? "输入 JSON 配置" : `请输入${f.label}`}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  if (f.type === "tags")
    return (
      <input
        required={f.required}
        value={Array.isArray(value) ? value.join(", ") : (value ?? "")}
        placeholder="多个值使用英文逗号分隔"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  const type =
    f.type === "secret"
      ? "password"
      : f.type === "datetime"
        ? "datetime-local"
        : ["number", "color", "email", "url"].includes(f.type)
          ? f.type
          : "text";
  return (
    <input
      type={type}
      required={f.required && f.type !== "secret"}
      min={type === "number" ? 0 : undefined}
      step={type === "number" ? "any" : undefined}
      autoComplete={f.type === "secret" ? "new-password" : "off"}
      value={value ?? ""}
      placeholder={configured ? "已配置；留空保持现有密钥" : `请输入${f.label}`}
      onChange={(e) =>
        onChange(
          type === "number"
            ? e.target.value === ""
              ? ""
              : Number(e.target.value)
            : e.target.value,
        )
      }
    />
  );
}

export function RecordForm({
  page,
  record,
  onClose,
  onDone,
}: {
  page: PageSpec;
  record?: DataRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const isUser = page.key === "users",
    fields = isUser ? USER_FIELDS : page.fields,
    toast = useToast();
  const [name, setName] = useState(record?.name || ""),
    [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        let v =
          f.type === "secret"
            ? ""
            : ((isUser ? record?.[f.key] : record?.data?.[f.key]) ??
              f.default ??
              (f.type === "boolean" ? false : ""));
        if (f.type === "datetime" && v) v = String(v).slice(0, 16);
        return [f.key, v];
      }),
    ),
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data: Record<string, any> = {};
      for (const f of fields) {
        let v = values[f.key];
        if (f.type === "json" && typeof v === "string")
          v = v.trim() ? JSON.parse(v) : {};
        if (f.type === "tags" && typeof v === "string")
          v = v
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (f.type === "datetime" && v) v = new Date(v).toISOString();
        if (f.type === "secret" && !v) continue;
        data[f.key] = v === "" && f.type === "number" ? null : v;
      }
      if (isUser) {
        if (!record && !data.password) throw new Error("新用户必须设置密码");
        if (record)
          await put(`/admin/users/${record.id}`, {
            ...data,
            expected_version: record.version,
          });
        else await post("/admin/users", data);
      } else {
        const body = {
          name,
          status: record?.status || "active",
          data,
          ...(record ? { expected_version: record.version } : {}),
        };
        if (record) await put(`/admin/records/${page.key}/${record.id}`, body);
        else await post(`/admin/records/${page.key}`, body);
      }
      toast(record ? "修改已保存" : "创建成功");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={`${record ? "编辑" : "新建"}${isUser ? "用户" : page.label.replace("管理", "")}`}
      subtitle="修改会保存到数据库，并记录操作审计"
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            form="record-form"
            type="submit"
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            保存{record ? "修改" : ""}
          </button>
        </>
      }
    >
      <form id="record-form" className="form-grid" onSubmit={save}>
        {!isUser && (
          <label className="field full">
            <span>
              名称 <b>*</b>
            </span>
            <input
              autoFocus
              required
              value={name}
              maxLength={250}
              placeholder="为这项配置取个清楚的名称"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {fields.map((f) => (
          <label
            key={f.key}
            className={`field ${["textarea", "json", "tags"].includes(f.type) ? "full" : ""} ${f.type === "boolean" ? "switch-field" : ""}`}
          >
            <span>
              {f.label}
              {f.required && <b> *</b>}
            </span>
            <FieldControl
              field={f}
              value={values[f.key]}
              onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
              configured={record?.configured_secrets?.includes(f.key)}
            />
            {f.type === "secret" && <small>密钥保存后不会回显。</small>}
          </label>
        ))}
      </form>
    </Drawer>
  );
}

export function ResourcePage({
  page,
  embedded = false,
}: {
  page: PageSpec;
  embedded?: boolean;
}) {
  const cache = useQueryClient(),
    toast = useToast();
  const [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [pageNo, setPage] = useState(1);
  const [form, setForm] = useState<DataRecord | null | undefined>(undefined),
    [detail, setDetail] = useState<DataRecord | null>(null),
    [action, setAction] = useState<{ row: DataRecord; name: string } | null>(
      null,
    ),
    [values, setValues] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [searchResult, setSearchResult] = useState<any>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const endpoint =
    page.view === "users"
      ? "/admin/users"
      : page.view === "audit"
        ? "/admin/audit"
        : page.view === "expenses"
          ? "/admin/expenses"
          : page.view === "requests"
            ? "/admin/records/requests"
            : `/admin/records/${page.key}`;
  const queryKey = ["records", page.key, query, status, pageNo];
  const data = useQuery({
    queryKey,
    queryFn: () =>
      api(
        `${endpoint}?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}&page=${pageNo}&page_size=15`,
      ),
  });
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ["records"] });
    cache.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const fields =
    page.key === "users"
      ? USER_FIELDS.filter((f) => ["username", "role", "email"].includes(f.key))
      : page.fields
          .filter((f) => !["secret", "textarea", "json"].includes(f.type))
          .slice(0, 4);
  const computed =
    page.view === "audit"
      ? [
          ["actor_id", "操作人"],
          ["resource", "对象"],
          ["ip", "IP"],
        ]
      : page.view === "expenses"
        ? [
            ["user_id", "用户"],
            ["amount", "变动算力"],
            ["balance_after", "结算后余额"],
            ["reference", "关联业务"],
          ]
        : page.view === "requests"
          ? [
              ["model", "模型"],
              ["stage", "阶段"],
              ["input_tokens", "输入 token"],
              ["output_tokens", "输出 token"],
              ["latency_ms", "耗时 ms"],
            ]
          : null;
  const columns = computed
    ? computed.map(([key, title]) => ({ key, title }))
    : fields.map((f) => ({ key: f.key, title: f.label }));
  if (page.key === "users") columns.push({ key: "balance", title: "可用算力" });
  const canCreate = page.key === "users" || page.actions.includes("create");
  const hasSettings = page.view === "settings";
  async function exportData() {
    setBusy(true);
    try {
      const result = await post(
        `/admin/exports/${page.key}?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`,
      );
      toast(`已导出 ${result.rows} 条记录`);
      const a = document.createElement("a");
      a.href = result.download_url;
      a.download = "";
      a.click();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function openAction(row: DataRecord, name: string) {
    setValues({});
    setSearchResult(null);
    setAction({ row, name });
  }
  async function execute() {
    if (!action) return;
    setBusy(true);
    try {
      if (action.name === "delete")
        await api(
          `/admin/records/${page.key}/${action.row.id}?expected_version=${action.row.version}`,
          { method: "DELETE" },
        );
      else if (action.name === "balance")
        await post(`/admin/users/${action.row.id}/balance`, {
          amount: Number(values.amount),
          reason: values.reason,
        });
      else if (action.name === "search") {
        const result = await post(`/admin/knowledge/${action.row.id}/search`, {
          query: values.query,
          top_k: 5,
          mode: values.mode || "lexical",
        });
        setSearchResult(result);
        return;
      } else {
        const res = await post(
          `/admin/records/${page.key}/${action.row.id}/actions/${action.name}`,
          { expected_version: action.row.version, values },
        );
        if (action.name === "recall") {
          setSearchResult(res.result);
          return;
        }
        if (res.result?.message) toast(res.result.message);
      }
      toast(action.name === "delete" ? "记录已删除" : "操作已完成");
      refresh();
      setAction(null);
      setDetail(null);
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function upload(row: DataRecord, file: File) {
    setBusy(true);
    try {
      const f = new FormData();
      f.append("file", file);
      await api(`/admin/records/${page.key}/${row.id}/upload`, {
        method: "POST",
        body: f,
      });
      toast("文件已上传并处理");
      refresh();
      setDetail(null);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function operationButtons(row: DataRecord) {
    return (
      <>
        {(page.key === "users" || page.actions.includes("edit")) && (
          <button
            className="button secondary small"
            onClick={() => {
              setDetail(null);
              setForm(row);
            }}
          >
            <Pencil size={14} />
            编辑
          </button>
        )}
        {page.key === "users" && (
          <button
            className="button secondary small"
            onClick={() => openAction(row, "balance")}
          >
            <Wallet size={14} />
            调整额度
          </button>
        )}
        {page.actions.includes("upload") && (
          <label className="button secondary small">
            <Upload size={14} />
            上传文件
            <input
              type="file"
              className="file-input"
              accept={page.key === "knowledge" ? ".txt,.md,.docx" : ".zip"}
              onChange={(e) => {
                if (e.target.files?.[0]) upload(row, e.target.files[0]);
              }}
            />
          </label>
        )}
        {page.actions
          .filter((a) => !["edit", "create", "detail", "upload"].includes(a))
          .map((a) => (
            <DeleteButton
              confirmation="dialog"
              destructive={a === "delete"}
              className={`button ${a === "delete" ? "danger" : "secondary"} small`}
              key={a}
              onClick={() => openAction(row, a)}
            >
              {ACTIONS[a] || a}
            </DeleteButton>
          ))}
      </>
    );
  }
  return (
    <>
      {!embedded && <ResourceExtras kind={page.key} />}
      {!embedded && (
        <PageHeading
          eyebrow={hasSettings ? "平台配置" : "管理空间"}
          title={page.label}
          description={page.description}
          actions={
            <>
              {!hasSettings && (
                <button
                  className="button secondary"
                  onClick={exportData}
                  disabled={busy}
                >
                  <Download size={16} />
                  导出
                </button>
              )}
              {canCreate && (
                <button
                  className="button primary"
                  onClick={() => setForm(null)}
                >
                  <Plus size={17} />
                  {hasSettings
                    ? "添加配置"
                    : `新建${page.key === "users" ? "用户" : page.key === "agents" ? "智能体" : page.key === "products" ? "套餐" : "记录"}`}
                </button>
              )}
            </>
          }
        />
      )}
      <section
        className={hasSettings ? "settings-section" : "panel data-panel"}
      >
        {!hasSettings && (
          <div className="table-toolbar">
            <div className="table-search">
              <Search size={17} />
              <input
                aria-label={`搜索${page.label}`}
                placeholder={`搜索${page.label.replace("管理", "")}名称或标识…`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  className="icon-button"
                  aria-label="清空搜索"
                  onClick={() => setQ("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="table-filters">
              <select
                aria-label="状态筛选"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部状态</option>
                {[
                  "active",
                  "disabled",
                  "draft",
                  "pending",
                  "paid",
                  "completed",
                  "failed",
                ].map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                aria-label="刷新列表"
                onClick={() => data.refetch()}
              >
                <RefreshCw
                  size={17}
                  className={data.isFetching ? "spin" : ""}
                />
              </button>
            </div>
          </div>
        )}
        {data.isPending ? (
          <Spinner />
        ) : data.error ? (
          <ErrorState error={data.error} retry={() => data.refetch()} />
        ) : !data.data.items.length ? (
          <Empty
            title={`还没有${page.label.replace("管理", "").replace("记录", "")}`}
            description={
              canCreate
                ? "创建第一项配置，开始管理这个空间。"
                : "业务发生后，对应记录会自动出现在这里。"
            }
            action={
              canCreate ? (
                <button
                  className="button secondary"
                  onClick={() => setForm(null)}
                >
                  <Plus size={16} />
                  新建
                </button>
              ) : undefined
            }
          />
        ) : hasSettings ? (
          <div className="settings-grid">
            {data.data.items.map((row: DataRecord) => (
              <article className="panel setting-card" key={row.id}>
                <div className="setting-top">
                  <div className="setting-icon">
                    {page.key === "payments" ? (
                      <Wallet size={22} />
                    ) : page.key === "storage" ? (
                      <Database size={22} />
                    ) : (
                      <SlidersHorizontal size={22} />
                    )}
                  </div>
                  <Status value={row.status} />
                </div>
                <h2>{row.name}</h2>
                <p>{page.description}</p>
                <div className="setting-values">
                  {page.fields
                    .filter((f) => f.type !== "secret")
                    .slice(0, 3)
                    .map((f) => (
                      <div key={f.key}>
                        <span>{f.label}</span>
                        <strong title={label(row.data[f.key])}>
                          {label(row.data[f.key])}
                        </strong>
                      </div>
                    ))}
                </div>
                <footer>
                  <span>更新于 {formatTime(row.updated_at)}</span>
                  <button
                    className="button secondary small"
                    onClick={() => setForm(row)}
                  >
                    配置
                    <Pencil size={14} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="check-cell">
                      <input
                        aria-label="选择当前页"
                        type="checkbox"
                        checked={
                          !!data.data.items.length &&
                          selected.length === data.data.items.length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? data.data.items.map((r: DataRecord) => r.id)
                              : [],
                          )
                        }
                      />
                    </th>
                    <th>
                      {page.view === "audit"
                        ? "操作事件"
                        : page.view === "expenses"
                          ? "账本类型"
                          : page.key === "users"
                            ? "用户"
                            : "名称"}
                    </th>
                    {columns.map((c) => (
                      <th key={c.key}>{c.title}</th>
                    ))}
                    <th>状态</th>
                    <th>创建时间</th>
                    <th className="align-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.items.map((row: DataRecord, i: number) => (
                    <tr key={row.id}>
                      <td className="check-cell">
                        <input
                          aria-label={`选择 ${row.name}`}
                          type="checkbox"
                          checked={selected.includes(row.id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, row.id]
                                : old.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="record-name"
                          onClick={() => setDetail(row)}
                        >
                          <div className={`row-symbol hue-${i % 4}`}>
                            {page.key === "users" ? (
                              (row.nickname || row.username || "作").slice(0, 1)
                            ) : page.key === "agents" ? (
                              <Sparkles size={17} />
                            ) : (
                              <FileText size={17} />
                            )}
                          </div>
                          <div>
                            <strong>{label(row.name)}</strong>
                            <small>
                              {row.id.slice(0, 8)}
                              {row.data?.mode
                                ? ` · ${label(row.data.mode)}`
                                : ""}
                            </small>
                          </div>
                        </button>
                      </td>
                      {columns.map((c) => (
                        <td key={c.key}>
                          <span
                            className={`cell-value ${["amount", "balance", "balance_after"].includes(c.key) ? "numeric" : ""}`}
                            title={label(row[c.key] ?? row.data?.[c.key])}
                          >
                            {c.key === "role" ? (
                              <span className="role-pill">
                                {label(row[c.key])}
                              </span>
                            ) : (
                              label(row[c.key] ?? row.data?.[c.key])
                            )}
                          </span>
                        </td>
                      ))}
                      <td>
                        {row.status ? (
                          <Status value={row.status} />
                        ) : (
                          <span className="muted">已记录</span>
                        )}
                      </td>
                      <td className="time-cell">
                        {formatTime(row.created_at)}
                      </td>
                      <td className="align-right">
                        <button
                          className="icon-button"
                          aria-label={`查看 ${row.name} 的操作`}
                          onClick={() => setDetail(row)}
                        >
                          <MoreHorizontal size={19} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pageNo}
              size={15}
              total={data.data.total}
              setPage={setPage}
            />
          </>
        )}
      </section>
      {selected.length > 0 && (
        <div className="selection-bar">
          <span>已选择 {selected.length} 条</span>
          <button className="text-button" onClick={() => setSelected([])}>
            取消选择
          </button>
          <button
            className="button secondary small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(selected.join("\n"));
                toast("已复制所选 ID");
              } catch {
                toast("无法访问剪贴板", true);
              }
            }}
          >
            <Copy size={14} />
            复制 ID
          </button>
        </div>
      )}
      {form !== undefined && (
        <RecordForm
          page={page}
          record={form || undefined}
          onClose={() => setForm(undefined)}
          onDone={refresh}
        />
      )}
      {detail && (
        <Drawer
          title={detail.name || "记录详情"}
          subtitle={`${detail.id} · 版本 ${detail.version || 1}`}
          onClose={() => setDetail(null)}
          footer={<div className="action-grid">{operationButtons(detail)}</div>}
        >
          {page.key === "users" && <UserActivity user={detail} />}
          <div className="detail-intro">
            <Status value={detail.status || "completed"} />
            <span>{formatTime(detail.created_at)}</span>
          </div>
          <dl className="detail-list">
            {(page.key === "users"
              ? USER_FIELDS.filter((f) => f.type !== "secret")
              : page.fields.filter((f) => f.type !== "secret")
            ).map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{label(detail[f.key] ?? detail.data?.[f.key])}</dd>
              </div>
            ))}
          </dl>
          {!page.fields.length && page.key !== "users" && (
            <pre className="json-block">
              {JSON.stringify(detail.data || detail.detail || detail, null, 2)}
            </pre>
          )}
          {!!detail.configured_secrets?.length && (
            <div className="info-strip">
              <KeyRound size={16} />
              {detail.configured_secrets.length} 项密钥已加密保存
            </div>
          )}
        </Drawer>
      )}
      {action && (
        <Drawer
          title={
            action.name === "balance"
              ? "调整用户额度"
              : ACTIONS[action.name] || action.name
          }
          subtitle={action.row.name}
          onClose={() => setAction(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setAction(null)}
              >
                取消
              </button>
              <DeleteButton
                confirmation="commit"
                destructive={action.name === "delete"}
                className={`button ${action.name === "delete" ? "danger" : "primary"}`}
                disabled={busy}
                onClick={execute}
              >
                {action.name !== "delete" &&
                  (busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  ))}
                确认{action.name === "search" ? "检索" : "操作"}
              </DeleteButton>
            </>
          }
        >
          <div className="action-explanation">
            {action.name === "delete"
              ? "删除后此记录将从业务列表移除，操作会保留审计记录。"
              : action.name === "pay"
                ? "此操作模拟沙箱支付成功，并实际验证订单、额度与权益的幂等发放。"
                : action.name === "complete"
                  ? "此操作用于登记已经完成的人工转账，请填写可核对的凭证。"
                  : action.name === "balance"
                    ? "正数发放额度，负数扣减额度。已预留给活动任务的额度不能被扣除。"
                    : "确认后将执行此操作并保存结果。"}
          </div>
          {(action.name === "balance"
            ? [
                ["amount", "调整算力（允许负数）"],
                ["reason", "调整原因"],
              ]
            : action.name === "redeem"
              ? [["user_id", "代兑用户 ID"]]
              : action.name === "invoice"
                ? [["invoice_number", "发票号码"]]
                : action.name === "complete"
                  ? [["proof", "转账凭证"]]
                  : action.name === "reject"
                    ? [["reason", "拒绝原因"]]
                    : ["search", "recall"].includes(action.name)
                      ? [["query", "检索内容"]]
                      : []
          ).map(([key, title]) => (
            <label className="field" key={key}>
              <span>{title}</span>
              <input
                required
                type={key === "amount" ? "number" : "text"}
                value={values[key] || ""}
                onChange={(e) =>
                  setValues((old) => ({ ...old, [key]: e.target.value }))
                }
              />
            </label>
          ))}
          {action.name === "search" && (
            <label className="field">
              <span>检索方式</span>
              <select
                value={values.mode || "lexical"}
                onChange={(e) =>
                  setValues((old) => ({ ...old, mode: e.target.value }))
                }
              >
                <option value="lexical">关键词</option>
                <option value="vector">pgvector 离线词法向量</option>
              </select>
            </label>
          )}
          {searchResult && (
            <div className="search-hits">
              {searchResult.items.length ? (
                searchResult.items.map((hit: any) => (
                  <article className="panel" key={hit.id}>
                    <span>相关度 {hit.score}</span>
                    <p>{hit.text}</p>
                  </article>
                ))
              ) : (
                <Empty
                  title="未找到相关片段"
                  description="尝试更换关键词；未检索到结果不代表资料中不存在相关事实。"
                />
              )}
            </div>
          )}
        </Drawer>
      )}
    </>
  );
}
