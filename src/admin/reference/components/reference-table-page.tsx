"use client";
import { DeleteButton } from "./interaction/delete-button";
import { SupplierBills } from "./supplier-bills";
import { useEffect, useState } from "react";
import { useRouter } from "@reference/router";
import { PaymentCheckout } from "./payment-operations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Download,
  Pencil,
  Search,
  KeyRound,
  MoreHorizontal,
  Upload,
} from "lucide-react";
import {
  api,
  post,
  put,
  type DataRecord,
  type PageSpec,
  formatTime,
  label,
} from "@reference/lib/api";
import { referencePages, type RefColumn } from "@reference/lib/reference-pages";
import {
  CompactHeading,
  Modal,
  SearchBox,
  RefEmpty,
  RefPagination,
  RefTabs,
} from "./reference-ui";
import { ReferenceRecordForm } from "./reference-record-form";
import { ErrorState, Spinner, Status, useToast } from "./ui";
import { ResourceExtras, UserActivity } from "./resource-extras";
import {
  DesktopCategories,
  PlatformIntegrationDownload,
  ResourceHistory,
} from "./admin-parity-tools";
import { GlobalRuntimePolicy } from "./runtime-controls";
import { PlatformMigration } from "./platform-migration";
import {
  ReferenceBatchActions,
  RedemptionHistory,
} from "./reference-batch-actions";

const actions: Record<string, string> = {
  toggle: "启用 / 停用",
  delete: "删除",
  probe: "测试连接",
  sync: "同步",
  test: "测试",
  duplicate: "复制",
  publish: "发布",
  approve: "通过",
  reject: "拒绝",
  unlist: "下架",
  revoke: "撤销",
  pay: "沙箱支付",
  refund: "退款",
  invoice: "开票",
  cancel: "取消续费",
  renew: "续费",
  redeem: "兑换",
  settle: "结算",
  complete: "登记转账",
  search: "检索测试",
  recall: "召回测试",
  balance: "调整余额",
  suspend: "禁用 / 恢复资源包",
  set_expiry: "调整有效期",
  "reset-password": "重置密码",
};
export function recordCell(row: DataRecord, col: RefColumn, index = 0) {
  const d = row.data || {},
    m = row.meta || row.detail || {};
  let v = row[col.key] ?? d[col.key] ?? m[col.key];
  if (col.key === "index") v = index + 1;
  if (col.key === "user_id") v = row.user_display || v;
  if (col.key === "product_id") v = row.product_display || v;
  if (col.key === "remaining_total") v = Number(d.remaining || 0);
  if (row.kind === "resource-packs" && ["total", "remaining"].includes(col.key))
    v =
      d.balance_schema === 1
        ? d[col.key === "total" ? "principal_total" : "principal_remaining"]
        : "历史未分账";
  if (col.key === "period")
    v = [d.period_start, d.period_end]
      .filter(Boolean)
      .map(formatTime)
      .join(" — ");
  if (col.key === "token_usage")
    v =
      d.input_tokens !== undefined
        ? `${d.input_tokens ?? "—"} / ${d.output_tokens ?? "—"}`
        : m.tokens;
  if (col.key === "tool_count")
    v = d.tools?.length ?? d.allowed_tools?.length ?? 0;
  if (col.key === "minimum_level") v = d.min_level;
  if (col.key === "entry_count") v = 1;
  if (col.key === "pricing_summary")
    v =
      d.unit === "million_tokens"
        ? `输入 ${d.input_rate ?? 0} / 输出 ${d.output_rate ?? 0} · 百万 Token`
        : `${d.base_rate ?? 0} / ${d.unit === "second" ? "秒" : "次"}`;
  if (col.key === "use_count")
    v =
      typeof d.uses === "number"
        ? d.uses
        : (d.uses?.length ?? d.used_count ?? 0);
  if (col.key === "version" && d.version !== undefined) v = d.version;
  if (col.key.startsWith("channel_"))
    v = (d.channels || []).includes(col.key.slice(8)) ? "开" : "—";
  if (col.type === "avatar")
    return (
      <span className="ref-compact-avatar">
        {(row.nickname || row.username || row.name || "用").slice(0, 1)}
      </span>
    );
  if (col.type === "identity")
    return (
      <>
        <strong className="ref-row-title">{row.name}</strong>
        <small className="ref-row-subtitle">
          {d.code ||
            d.canonical_key ||
            d.base_url ||
            d.model_id ||
            row.id.slice(0, 12)}
        </small>
      </>
    );
  if (col.type === "status") return v ? <Status value={String(v)} /> : <>—</>;
  if (col.type === "date") return formatTime(v);
  if (col.type === "money")
    return v !== undefined ? `¥${(Number(v) / 100).toFixed(2)}` : "—";
  if (col.type === "boolean")
    return v === undefined ? (
      "—"
    ) : (
      <span className={v ? "ref-yes" : "muted"}>{v ? "启用" : "停用"}</span>
    );
  return label(v);
}

export function ReferenceTablePage({ page }: { page: PageSpec }) {
  const router = useRouter();
  const config = referencePages[page.key],
    toast = useToast(),
    cache = useQueryClient();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [applied, setApplied] = useState<Record<string, string>>({}),
    [number, setNumber] = useState(1),
    [size, setSize] = useState(config.size || 20),
    [selected, setSelected] = useState<string[]>([]),
    [form, setForm] = useState<DataRecord | null | undefined>(),
    [detail, setDetail] = useState<DataRecord | null>(null),
    [action, setAction] = useState<{ name: string; row: DataRecord } | null>(
      null,
    ),
    [values, setValues] = useState<Record<string, string>>({}),
    [payment, setPayment] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("模型运行策略"),
    [aux, setAux] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setNumber(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    q: query,
    filters: JSON.stringify(applied),
    page: String(number),
    page_size: String(size),
  });
  const q = useQuery({
    queryKey: ["reference-list", page.key, query, applied, number, size],
    queryFn: () => api(`/admin/reference/list/${page.key}?${params}`),
  });
  const rows: DataRecord[] = q.data?.items || [];
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ["reference-list"] });
    cache.invalidateQueries({ queryKey: ["records"] });
    cache.invalidateQueries({ queryKey: ["analytics"] });
  };
  const open = (row: DataRecord, name: string) => {
    if (page.key === 'platforms' && name === 'sync') { setForm({ ...row, data: { ...row.data, _open_models: true } }); return; }
    setValues({});
    setAction({ row, name });
  };
  async function execute() {
    if (!action) return;
    setBusy(true);
    try {
      const { row, name } = action;
      if (name === "delete")
        await api(
          `/admin/${page.key === "users" ? "users" : `records/${page.key}`}/${row.id}?expected_version=${row.version}`,
          { method: "DELETE", body: JSON.stringify({ expected_profiles: row.data.expected_profiles }) },
        );
      else if (name === "settle" && page.key === "income")
        await post(`/admin/reference/income/${row.id}/settle`, {
          entries: row.entries,
        });
      else if (name === "balance")
        await post(`/admin/users/${row.id}/balance`, {
          amount: Number(values.amount),
          reason: values.reason,
        });
      else if (name === "reset-password")
        await put(`/admin/users/${row.id}`, {
          username: row.username,
          nickname: row.nickname,
          role: row.role,
          email: row.email,
          phone: row.phone,
          status: row.status,
          password: values.password,
          expected_version: row.version,
        });
      else {
        const result = await post(
          `/admin/records/${page.key}/${row.id}/actions/${name}`,
          { expected_version: row.version, expected_profiles: row.data.expected_profiles, values },
        );
        if (result.result?.message) toast(result.result.message);
        if (result.result?.checkout) setPayment(result.result.checkout);
      }
      refresh();
      setAction(null);
      setDetail(null);
      toast("操作已完成");
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function exportCSV() {
    setBusy(true);
    try {
      const cell = (value: unknown) => { const text = String(value ?? ''); return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"'; };
      const csv = '\uFEFF名称,状态\r\n' + (q.data?.items ?? []).map((row: DataRecord) => [row.name, row.status].map(cell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${page.key}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast("当前页名称与状态已导出");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const btnCreate = config.create ? (
    <button
      className="button primary"
      onClick={() =>
        page.key === "cloud"
          ? router.push("/admin/cloud-platform/add/new")
          : setForm(null)
      }
    >
      <Plus size={14} />
      {config.create}
    </button>
  ) : null;
  function rowActions(r: DataRecord) {
    return (
      <div className="ref-row-actions">
        {page.key === "mcp" && r.data.auth_type === "oauth2" && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await post(
                  `/admin/mcp-oauth/${r.id}/authorize`,
                  { expected_version: r.version, values: {} },
                );
                window.location.assign(result.authorization_url);
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {r.data.oauth_grant ? "重新授权" : "OAuth 授权"}
          </button>
        )}
        {(page.actions.includes("edit") || page.key === "users") && (
          <button
            onClick={() =>
              page.key === "cloud"
                ? router.push(`/admin/cloud-platform/edit/${r.id}`)
                : setForm(r)
            }
          >
            <Pencil size={12} />
            编辑
          </button>
        )}
        {page.key === "users" ? (
          <>
            <button onClick={() => open(r, "reset-password")}>
              <KeyRound size={12} />
              重置密码
            </button>
            <DeleteButton
              confirmation="dialog"
              className="danger"
              onClick={() => open(r, "delete")}
            >
              删除
            </DeleteButton>
            <button
              aria-label={`查看 ${r.name} 详情`}
              onClick={() => setDetail(r)}
            >
              <MoreHorizontal size={15} />
            </button>
          </>
        ) : (
          <>
            {page.actions
              .filter(
                (a) => !["edit", "create", "detail", "upload"].includes(a),
              )
              .slice(0, 2)
              .map((a) => (
                <DeleteButton
                  confirmation="dialog"
                  destructive={a === "delete"}
                  className={a === "delete" ? "danger" : ""}
                  disabled={
                    page.key === "income" &&
                    a === "settle" &&
                    !r.entries?.length
                  }
                  onClick={() => open(r, a)}
                  key={a}
                >
                  {actions[a] || a}
                </DeleteButton>
              ))}
            <button onClick={() => setDetail(r)}>
              {page.actions.length > 3 ? "更多" : "详情"}
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className={`ref-page ref-records ref-records-${page.key}`}>
      {page.key === "expenses" && <SupplierBills />}
      {payment && (
        <PaymentCheckout checkout={payment} onClose={() => setPayment(null)} />
      )}
      {config.title && (
        <CompactHeading
          title={config.title}
          description={config.description}
          actions={page.key === "mcp" ? btnCreate : undefined}
        />
      )}
      {config.notice && <p className="ref-notice">{config.notice}</p>}
      {page.key === "runtime-policies" && (
        <RefTabs
          tabs={["模型运行策略", "全局调度策略"]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === "全局调度策略" ? (
        <GlobalRuntimePolicy />
      ) : (
        <>
          {(config.search || config.filters?.length) && (
            <form
              className={
                page.key === "audit" ||
                page.key === "chat-audits" ||
                page.key === "expenses"
                  ? "ref-filter-form"
                  : "ref-table-top"
              }
              onSubmit={(e) => {
                e.preventDefault();
                setApplied({ ...filters });
                setNumber(1);
                setSelected([]);
              }}
            >
              {config.search && (
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder={config.search}
                />
              )}{" "}
              {config.filters?.map((f) => (
                <label key={f.key}>
                  {["audit"].includes(page.key) && <span>{f.label}</span>}
                  {f.options ? (
                    <select
                      aria-label={f.label}
                      value={filters[f.key] || ""}
                      onChange={(e) => {
                        setFilters((v) => ({ ...v, [f.key]: e.target.value }));
                        if (
                          [
                            "users",
                            "pricing",
                            "orders",
                            "notifications",
                            "runtime-policies",
                          ].includes(page.key)
                        ) {
                          setApplied((v) => ({
                            ...v,
                            [f.key]: e.target.value,
                          }));
                          setNumber(1);
                        }
                      }}
                    >
                      <option value="">{f.label}</option>
                      {f.options.map((v) => (
                        <option key={v} value={v}>
                          {label(v)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={f.label}
                      type={f.type || "text"}
                      placeholder={f.label}
                      value={filters[f.key] || ""}
                      onChange={(e) =>
                        setFilters((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
              {config.filters?.some((f) => !f.options) && (
                <>
                  <button className="button primary" type="submit">
                    <Search size={14} />
                    查询
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setFilters({});
                      setApplied({});
                      setSearch("");
                      setNumber(1);
                    }}
                  >
                    重置
                  </button>
                </>
              )}
              {[
                "pricing",
                "runtime-policies",
                "notifications",
                "platforms",
              ].includes(page.key) && (
                <div className="ref-actions">
                  {page.key === "platforms" && (
                    <>
                      <PlatformIntegrationDownload />
                      <PlatformMigration
                        refresh={() => q.refetch()}
                        create={() => setForm(null)}
                      />
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => {
                          setApplied((v) => ({
                            ...v,
                            sort_order: v.sort_order === "asc" ? "desc" : "asc",
                          }));
                          setNumber(1);
                        }}
                      >
                        {applied.sort_order === "asc" ? "正序" : "反序"}
                      </button>
                      <select
                        aria-label="平台排序"
                        value={applied.sort_by || "created_at"}
                        onChange={(e) => {
                          setApplied((v) => ({
                            ...v,
                            sort_by: e.target.value,
                            sort_order:
                              e.target.value === "priority" ? "asc" : "desc",
                          }));
                          setNumber(1);
                        }}
                      >
                        <option value="created_at" disabled>按创建时间 · 尚未接入</option>
                        <option value="priority" disabled>按优先级 · 尚未接入</option>
                        <option value="name">按名称</option>
                        <option value="updated_at" disabled>按更新时间 · 尚未接入</option>
                      </select>
                    </>
                  )}
                  {config.select && (
                    <DeleteButton
                      confirmation="dialog"
                      className="button secondary"
                      type="button"
                      disabled={!selected.length}
                      onClick={() => setAux("delete-selected")}
                    >
                      删除选中（{selected.length}）
                    </DeleteButton>
                  )}
                  {btnCreate}
                </div>
              )}
            </form>
          )}
          {page.key !== "mcp" &&
            ![
              "pricing",
              "runtime-policies",
              "notifications",
              "platforms",
              "income",
              "withdrawals",
            ].includes(page.key) && (
              <div className="ref-table-action-row">
                {page.key === "users" && (
                  <button
                    className="button secondary"
                    onClick={() => setAux("referrals")}
                  >
                    邀请关系管理
                  </button>
                )}
                {btnCreate}
                {config.export && (
                  <button
                    className="button secondary"
                    onClick={exportCSV}
                    disabled={busy}
                  >
                    <Download size={14} />
                    {page.key === "users" ? "下载CSV" : "导出CSV"}
                  </button>
                )}
                {page.key === "users" && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      const blob = new Blob(
                          [
                            "\ufeffusername,nickname,password,role,email,phone,status\n",
                          ],
                          { type: "text/csv;charset=utf-8" },
                        ),
                        url = URL.createObjectURL(blob),
                        a = document.createElement("a");
                      a.href = url;
                      a.download = "users-template.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    下载导入模板
                  </button>
                )}
                {page.key === "desktop-skills" && (
                  <DesktopCategories refresh={refresh} />
                )}
                <ResourceExtras kind={page.key} />
                <ReferenceBatchActions
                  kind={page.key}
                  rows={rows}
                  selected={selected}
                  refresh={refresh}
                />
                {!["products", "users", "cloud", "members"].includes(
                  page.key,
                ) && (
                  <button
                    className="button secondary"
                    onClick={() => q.refetch()}
                  >
                    <RefreshCw size={14} />
                    刷新
                  </button>
                )}
              </div>
            )}
          {q.error ? (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          ) : (
            <>
              <div className="ref-table-wrap">
                <table className="ref-table">
                  <thead>
                    <tr>
                      {config.select && (
                        <th>
                          <input
                            type="checkbox"
                            aria-label="全选当前页"
                            checked={
                              rows.length > 0 &&
                              rows.every((r) => selected.includes(r.id))
                            }
                            onChange={(e) =>
                              setSelected(
                                e.target.checked ? rows.map((r) => r.id) : [],
                              )
                            }
                          />
                        </th>
                      )}
                      {config.columns.map((c) => (
                        <th key={c.key}>{c.title}</th>
                      ))}
                      <th className="ref-sticky-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.isPending ? (
                      <tr>
                        <td colSpan={config.columns.length + 2}>
                          <Spinner />
                        </td>
                      </tr>
                    ) : rows.length ? (
                      rows.map((r, i) => (
                        <tr key={r.id}>
                          {config.select && (
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`选择 ${r.name}`}
                                checked={selected.includes(r.id)}
                                onChange={(e) =>
                                  setSelected((old) =>
                                    e.target.checked
                                      ? [...old, r.id]
                                      : old.filter((id) => id !== r.id),
                                  )
                                }
                              />
                            </td>
                          )}
                          {config.columns.map((c) => (
                            <td key={c.key}>
                              {recordCell(r, c, (number - 1) * size + i)}
                            </td>
                          ))}
                          <td className="ref-sticky-actions">
                            {rowActions(r)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={config.columns.length + 2}>
                          <RefEmpty />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <RefPagination
                page={number}
                size={size}
                total={q.data?.total || 0}
                onPage={(v) => {
                  setNumber(v);
                  setSelected([]);
                }}
                onSize={(v) => {
                  setSize(v);
                  setNumber(1);
                  setSelected([]);
                }}
              />
            </>
          )}
        </>
      )}
      {form !== undefined && (
        <ReferenceRecordForm
          page={page}
          record={form || undefined}
          onClose={() => setForm(undefined)}
          onDone={refresh}
        />
      )}
      {detail && (
        <Modal
          title={detail.name || "记录详情"}
          onClose={() => setDetail(null)}
          wide
          footer={
            <div className="ref-actions">
              {["desktop-skills", "platforms"].includes(page.key) && (
                <ResourceHistory record={detail} />
              )}
              {page.key === "users" && (
                <button
                  className="button secondary"
                  onClick={() => open(detail, "balance")}
                >
                  调整余额
                </button>
              )}
              {page.actions
                .filter(
                  (a) => !["create", "edit", "detail", "upload"].includes(a),
                )
                .map((a) => (
                  <DeleteButton
                    confirmation="dialog"
                    destructive={a === "delete"}
                    className={`button ${a === "delete" ? "danger" : "secondary"}`}
                    key={a}
                    disabled={
                      page.key === "income" &&
                      a === "settle" &&
                      !detail.entries?.length
                    }
                    onClick={() => open(detail, a)}
                  >
                    {actions[a] || a}
                  </DeleteButton>
                ))}
            </div>
          }
        >
          {page.key === "users" && <UserActivity user={detail} />}
          {page.key === "redeem-codes" && <RedemptionHistory id={detail.id} />}
          <dl className="detail-list">
            {config.columns
              .filter((c) => c.type !== "avatar")
              .map((c) => (
                <div key={c.key}>
                  <dt>{c.title}</dt>
                  <dd>{recordCell(detail, c)}</dd>
                </div>
              ))}
          </dl>
          {page.actions.includes("upload") && (
            <label className="button secondary">
              <Upload size={14} />
              上传文件
              <input
                type="file"
                className="file-input"
                accept=".zip"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const body = new FormData();
                    body.append("file", file);
                    await api(
                      `/admin/records/${page.key}/${detail.id}/upload`,
                      { method: "POST", body },
                    );
                    refresh();
                    setDetail(null);
                    toast("上传完成");
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              />
            </label>
          )}
        </Modal>
      )}
      {action && (
        <Modal
          title={actions[action.name] || action.name}
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
                确认
              </DeleteButton>
            </>
          }
        >
          <p className="ref-description">{action.row.name}</p>
          {action.name === "delete" && (
            <p className="ref-notice">
              {page.key === "users"
                ? "删除账号会停用访问并从默认列表移除；作品及审计记录保留。"
                : "删除此记录，操作将保留审计日志。"}
            </p>
          )}
          <div className="ref-form">
            {(action.name === "set_expiry"
              ? [
                  ["expires_at", "新有效期（含时区的日期时间）"],
                  ["reason", "调整原因"],
                ]
              : action.name === "balance"
                ? [
                    ["amount", "调整算力（可为负数）"],
                    ["reason", "调整原因"],
                  ]
                : action.name === "reset-password"
                  ? [["password", "新密码（至少 10 位）"]]
                  : action.name === "redeem"
                    ? [["user_id", "用户 ID"]]
                    : action.name === "invoice"
                      ? [["invoice_number", "发票号码"]]
                      : action.name === "complete"
                        ? [["proof", "转账凭证"]]
                        : ["reject", "suspend"].includes(action.name)
                          ? [["reason", "操作原因"]]
                          : []
            ).map(([key, title]) => (
              <label className="field" key={key}>
                <span>{title}</span>
                <input
                  type={
                    key === "password"
                      ? "password"
                      : key === "amount"
                        ? "number"
                        : "text"
                  }
                  value={values[key] || ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        </Modal>
      )}
      {aux === "delete-selected" && (
        <Modal
          title="删除选中记录"
          onClose={() => setAux("")}
          footer={
            <DeleteButton
              confirmation="commit"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  for (const row of rows.filter((r) => selected.includes(r.id)))
                    await api(
                      `/admin/records/${page.key}/${row.id}?expected_version=${row.version}`,
                      { method: "DELETE", body: JSON.stringify({ expected_profiles: row.data.expected_profiles }) },
                    );
                  setSelected([]);
                  setAux("");
                  toast("选中记录已删除");
                } catch (e) {
                  toast((e as Error).message, true);
                  return false;
                } finally {
                  refresh();
                  setBusy(false);
                }
              }}
            >
              确认删除 {selected.length} 条
            </DeleteButton>
          }
        >
          <p>
            将删除当前选中的 {selected.length}{" "}
            条记录。关联约束不满足的记录会保留。
          </p>
        </Modal>
      )}
      {aux === "referrals" && <ReferralList onClose={() => setAux("")} />}
    </div>
  );
}
function ReferralList({ onClose }: { onClose: () => void }) {
  const q = useQuery({
    queryKey: ["referrals"],
    queryFn: () => api("/admin/records/referrals?page_size=200"),
  });
  return (
    <Modal title="邀请关系管理" onClose={onClose} wide>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>邀请人</th>
                <th>被邀请人</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.length ? (
                q.data.items.map((r: DataRecord) => (
                  <tr key={r.id}>
                    <td>{r.data.inviter_id || "—"}</td>
                    <td>{r.data.user_id || "—"}</td>
                    <td>{formatTime(r.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3}>
                    <RefEmpty />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
