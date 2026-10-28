"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Settings2,
  Pencil,
  Plus,
  Database,
  Wallet,
  Monitor,
  Copy,
  Shield,
  Layout,
  Image,
  Menu,
  Bell,
  Globe,
  RefreshCw,
  KeyRound,
} from "lucide-react";
import {
  api,
  put,
  post,
  type PageSpec,
  type DataRecord,
  label,
} from "@reference/lib/api";
import { Spinner, ErrorState, useToast, Status } from "./ui";
import { Modal } from "./reference-ui";
import { FieldControl } from "./resource-page";
import { BrandImageUpload } from "./admin-parity-tools";
import { ReferenceRecordForm } from "./reference-record-form";
import { storageProviders } from "./storage-form";
import { LoginProviders } from "./login-providers";
import { PageDisplayForm } from "./page-display-form";

type Section = {
  title: string;
  description: string;
  keys: string[];
  icon?: typeof Settings2;
};
const displaySections: Section[] = [
  {
    title: "布局模版",
    description: "配置首页布局样式、轮播图、搜索位置等",
    keys: ["layout", "search_position"],
    icon: Layout,
  },
  {
    title: "通用显示设置",
    description: "配置网站图标、Logo、工具栏、联系方式等",
    keys: ["site_title", "tagline", "logo_url", "toolbar", "contact"],
    icon: Settings2,
  },
  {
    title: "菜单栏设置",
    description: "配置网站导航菜单栏",
    keys: ["navigation"],
    icon: Menu,
  },
  {
    title: "经典布局-轮播图设置",
    description: "配置经典布局的轮播图样式和内容",
    keys: ["carousel"],
    icon: Image,
  },
  {
    title: "登录页设置",
    description: "配置登录页背景图片（暗色 / 亮色）",
    keys: ["login_background", "login_background_light"],
    icon: Monitor,
  },
  {
    title: "服务条款和隐私政策",
    description: "配置服务条款、隐私政策和关于我们",
    keys: ["terms", "privacy", "about"],
    icon: Shield,
  },
  {
    title: "高级-自定义页面",
    description: "配置自定义首页和自定义 iframe 页面",
    keys: ["custom_pages"],
    icon: Globe,
  },
  {
    title: "内置页面接管",
    description: "将内置页面跳转到自定义页面",
    keys: ["page_overrides"],
    icon: Layout,
  },
];
const operationSections: Section[] = [
  {
    title: "运营设置",
    description: "注册奖励、邀请收益与站点标识",
    keys: ["site_id", "default_credits", "referral_percent"],
  },
  {
    title: "任务调度",
    description: "活动任务、每位作者写作数、模型总并发与短交互名额",
    keys: ["max_workflows", "max_author_workflows", "max_model_calls", "interactive_slots", "poll_interval", "callback_url"],
  },
  {
    title: "隐私与安全",
    description: "明水印、浮动水印与日志保留配置",
    keys: ["watermark", "floating_watermark", "retention_days"],
    icon: Shield,
  },
  {
    title: "媒体性能优化",
    description: "媒体变体与按需播放配置，下载保留原始结果",
    keys: ["media_optimization", "media_rollout"],
    icon: Image,
  },
  {
    title: "绘画设置",
    description: "绘画上传图片的大小、宽度与高度限制",
    keys: ["image_max_kb", "image_max_width", "image_max_height"],
    icon: Image,
  },
  {
    title: "POP设置",
    description: "店铺地址等 POP 对接配置",
    keys: ["shop_url"],
    icon: Globe,
  },
  {
    title: "MCP设置",
    description: "MCP 公共描述等配置",
    keys: ["mcp_description"],
    icon: Settings2,
  },
  {
    title: "余额不足提醒",
    description: "余额临界值与提醒间隔；通知渠道由事件通知配置管理",
    keys: ["low_balance_threshold", "low_balance_interval"],
    icon: Bell,
  },
  {
    title: "资源包余量预警",
    description: "按单个资源包剩余比例设置预警阈值",
    keys: ["pack_alert_percent"],
    icon: Database,
  },
  {
    title: "商用授权",
    description: "当前为本地独立部署，未导入参照站的商业授权。",
    keys: [],
    icon: KeyRound,
  },
  {
    title: "在线更新",
    description: "当前版本 0.1.0 · 通过项目版本管理更新",
    keys: ["release_feed"],
    icon: RefreshCw,
  },
];
export function ReferenceSettings({ page }: { page: PageSpec }) {
  const q = useQuery({
      queryKey: ["settings", page.key],
      queryFn: () => api(`/admin/records/${page.key}?page_size=200`),
    }),
    toast = useToast(),
    cache = useQueryClient();
  const [edit, setEdit] = useState<Section | null>(null),
    [recordForm, setRecordForm] = useState<DataRecord | null | undefined>(),
    [target, setTarget] = useState<DataRecord | undefined>(),
    [channel, setChannel] = useState("");
  const items: DataRecord[] = q.data?.items || [],
    record = items[0],
    d = record?.data || {};
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ["settings", page.key] });
    cache.invalidateQueries({ queryKey: ["records"] });
  };
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const cards =
    page.key === "page-display" ? displaySections : operationSections;
  const createChannel = (provider: string, _name: string) => {
    const existing = items.find((r) => r.data.provider === provider);
    setChannel(provider);
    setRecordForm(existing || null);
  };
  const channelSpec = channel
    ? {
        ...page,
        fields: page.fields.map((f) =>
          f.key === "provider" ? { ...f, default: channel } : f,
        ),
      }
    : page;
  return (
    <div className={`ref-page ref-settings ref-settings-${page.key}`}>
      {["page-display", "operation-settings"].includes(page.key) && (
        <div
          className={`ref-setting-cards ${page.key === "operation-settings" ? "four" : ""}`}
        >
          {cards.map((s) => {
            const Icon = s.icon || Settings2;
            return (
              <section className="ref-setting-tile" key={s.title}>
                <header>
                  <Icon size={20} />
                  <h2>{s.title}</h2>
                  {s.keys.length > 0 && (
                    <button
                      className="icon-button"
                      aria-label={`配置${s.title}`}
                      onClick={() => {
                        setTarget(record);
                        setEdit(s);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </header>
                <div>
                  <p>{s.description}</p>
                  <dl>
                    {s.keys.slice(0, 2).map((k) => {
                      const f = page.fields.find((f) => f.key === k);
                      const value = d[k] ?? f?.default;
                      return (
                        <div key={k}>
                          <dt>{f?.label || k}</dt>
                          <dd>
                            {Array.isArray(value)
                              ? `${value.length} 项`
                              : typeof value === "boolean"
                                ? value
                                  ? "已开启"
                                  : "未开启"
                                : value === null ||
                                    value === undefined ||
                                    value === ""
                                  ? "未配置"
                                  : String(value).length > 38
                                    ? "已配置"
                                    : label(value)}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              </section>
            );
          })}
        </div>
      )}
      {page.key === "storage" && (
        <>
          <p className="ref-notice">
            <strong>温馨提示</strong>
            <br />
            上传需保留一个可用存储通道。切换存储方式不影响已保存文件的存储位置；请同时备份数据库和对象存储文件。
          </p>
          <div className="ref-toolbar">
            <span className="ref-spacer" />
            <details className="ref-storage-menu">
              <summary className="button primary">
                <Plus size={14} />
                新增存储配置
              </summary>
              <div role="menu">
                {storageProviders.map(([key, title]) => (
                  <button
                    role="menuitem"
                    key={key}
                    onClick={(e) => {
                      setChannel(key);
                      setRecordForm(null);
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </details>
          </div>
          <div className="ref-setting-cards four">
            {items.map((r) => (
              <section className="ref-setting-tile" key={r.id}>
                <header>
                  <Database size={20} />
                  <h2>{r.name}</h2>
                  <button
                    className="icon-button"
                    aria-label={`配置${r.name}`}
                    onClick={() => setRecordForm(r)}
                  >
                    <Pencil size={14} />
                  </button>
                </header>
                <div>
                  <span className="ref-setting-badge">
                    {storageProviders.find(
                      ([key]) => key === (r.data.provider || r.data.driver),
                    )?.[1] || "对象存储"}
                  </span>
                  <p>
                    {r.data.description ||
                      (r.data.driver === "s3"
                        ? "保存上传和生成的文件"
                        : "由服务器保存上传和生成的文件")}
                  </p>
                  {r.data.bucket && <p>bucket：{r.data.bucket}</p>}
                  {[
                    ["upload_enabled", "上传"],
                    ["return_enabled", "返图"],
                    ["api_return_enabled", "API返图"],
                  ].map(([field, title]) => (
                    <label className="ref-switch-row" key={field}>
                      <span>{title}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`${title} ${r.name}`}
                        checked={
                          r.status === "active" &&
                          (r.data[field] ?? field === "upload_enabled")
                        }
                        onChange={async (e) => {
                          try {
                            const allowed = new Set(
                              page.fields.map((f) => f.key),
                            );
                            await put(`/admin/records/storage/${r.id}`, {
                              name: r.name,
                              status: e.target.checked ? "active" : r.status,
                              expected_version: r.version,
                              data: {
                                ...Object.fromEntries(
                                  Object.entries(r.data).filter(([key]) =>
                                    allowed.has(key),
                                  ),
                                ),
                                [field]: e.target.checked,
                              },
                            });
                            refresh();
                          } catch (e) {
                            toast((e as Error).message, true);
                          }
                        }}
                      />
                    </label>
                  ))}
                  <dl>
                    <div>
                      <dt>文件访问</dt>
                      <dd>身份验证</dd>
                    </div>
                    <div>
                      <dt>存储有效期</dt>
                      <dd>
                        {r.data.retention_days
                          ? `${r.data.retention_days} 天`
                          : "不过期"}
                      </dd>
                    </div>
                    <div>
                      <dt>优先级</dt>
                      <dd>{r.data.priority ?? 100}</dd>
                    </div>
                    <div>
                      <dt>最大上传</dt>
                      <dd>{r.data.max_mb || 20} MB</dd>
                    </div>
                    <div>
                      <dt>单份备份上限</dt>
                      <dd>{r.data.backup_max_mb ?? 200} MB</dd>
                    </div>
                  </dl>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      {page.key === "payments" && (
        <>
          <h1 className="ref-config-title">支付方式配置</h1>
          <div className="ref-setting-cards four">
            {[
              ["wechat", "微信支付", "CNY"],
              ["alipay", "支付宝", "CNY"],
              ["paypal", "PayPal", "USD"],
              ["stripe", "Stripe", "USD / CNY / JPY / KRW"],
              ["kakao", "Kakao", "KRW"],
              ["naver", "Naver", "KRW"],
              ["sandbox", "沙箱支付", "测试环境"],
            ].map(([key, title, currency]) => {
              const r = items.find((r) => r.data.provider === key);
              return (
                <section className="ref-setting-tile payment-tile" key={key}>
                  <header>
                    <Wallet size={18} />
                    <h2>{title}</h2>
                    <button
                      className="icon-button"
                      aria-label={`配置${title}`}
                      onClick={() => createChannel(key, title)}
                    >
                      <Pencil size={14} />
                    </button>
                  </header>
                  <div>
                    <div className="ref-switch-row">
                      <span>启用状态</span>
                      <Status value={r?.status || "disabled"} />
                    </div>
                    <span className="ref-setting-badge">{currency}</span>
                    {key !== "sandbox" && (
                      <p>
                        {["wechat", "alipay", "paypal", "stripe"].includes(key)
                          ? "原平台下单、验签与退款接口尚未接入当前客户端。"
                          : "原平台渠道配置已保留，当前不能保存或执行支付。"}
                      </p>
                    )}
                    {r && ["stripe", "paypal"].includes(key) && (
                      <label className="field">
                        固定回调地址
                        <input
                          readOnly
                          value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/payments/providers/${r.id}/webhook`}
                        />
                      </label>
                    )}
                    {key === "sandbox" && (
                      <p>用于验证订单、支付回调与权益发放。</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
      {page.key === "login-settings" && (
        <>
          <LoginProviders
            accountEnabled={d.password_login !== false}
            onAccount={() => {
              setTarget(record);
              setEdit({
                title: "账号登录",
                description: "管理账号登录、开放注册与会话期限。",
                keys: ["password_login", "registration", "session_hours"],
              });
            }}
          />
          <section className="ref-inline-settings">
            <header>
              <Shield size={18} />
              <h2>会话安全配置</h2>
            </header>
            <p className="ref-description">
              撤销后，其他设备需要重新登录，当前管理会话保持有效。
            </p>
            <button
              className="button secondary"
              onClick={() =>
                setEdit({
                  title: "撤销其他登录会话",
                  description: "确定撤销所有其他设备的登录会话？",
                  keys: [],
                })
              }
            >
              撤销其他登录会话
            </button>
          </section>
        </>
      )}
      {page.key === "desktop-brand" && (
        <>
          <InlineSettings
            page={page}
            record={record}
            title="桌面程序配置"
            keys={["server_url"]}
            description="桌面端用于打开 Web 登录页和创作空间的站点地址；留空时使用当前站点地址。"
            onSaved={refresh}
            extra={
              <div className="ref-connection-address">
                <label>桌面端接口地址</label>
                <div>
                  <input
                    readOnly
                    value={
                      (d.server_url || window.location.origin).replace(
                        /\/$/,
                        "",
                      ) + "/api/v1"
                    }
                  />
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          (d.server_url || window.location.origin).replace(
                            /\/$/,
                            "",
                          ) + "/api/v1",
                        );
                        toast("接口地址已复制");
                      } catch {
                        toast("无法访问剪贴板", true);
                      }
                    }}
                  >
                    <Copy size={14} />
                    复制
                  </button>
                </div>
                <p>桌面端通过共享 API 获取站点配置和当前账号信息。</p>
              </div>
            }
          />
          <InlineSettings
            page={page}
            record={record}
            title="客户端定制"
            keys={["client_name", "icon_url", "accent"]}
            description="应用内统一展示的品牌名称与 Logo；留空时回退到客户端打包的品牌。"
            onSaved={refresh}
          />
        </>
      )}
      {page.key === "wechat" && (
        <InlineSettings
          page={page}
          record={record}
          title="微信公众号接入"
          keys={page.fields.map((f) => f.key)}
          description="填写公众号身份、回调校验信息与问答配置。密钥保存后不回显；外部微信收发适配器尚未接入。"
          onSaved={refresh}
        />
      )}
      {page.key === "mini-program" && (
        <>
          <InlineSettings
            page={page}
            record={record}
            title="小程序页面显示配置"
            keys={["banner"]}
            description="小程序首页轮播图，建议图片宽 600 × 高 800。"
            onSaved={refresh}
          />
          <InlineSettings
            page={page}
            record={record}
            title="小程序管理配置"
            keys={[
              "app_id",
              "app_secret",
              "offer_id",
              "production_key",
              "sandbox_key",
            ]}
            description="AppID 与 AppSecret 用于小程序登录，账号、余额及登录会话与网站共用。虚拟支付仍待接入。"
            onSaved={refresh}
          />
        </>
      )}
      {edit && page.key === "page-display" && (
        <PageDisplayForm
          key={edit.title}
          page={page}
          section={edit.title}
          record={record}
          onClose={() => setEdit(null)}
          onDone={() => {
            refresh();
            window.dispatchEvent(new Event("site-display-updated"));
          }}
        />
      )}
      {edit && page.key !== "page-display" && (
        <Modal
          title={edit.title}
          onClose={() => setEdit(null)}
          wide={edit.keys.some(
            (k) => page.fields.find((f) => f.key === k)?.type === "json",
          )}
        >
          {edit.keys.length ? (
            <SettingsFields
              key={edit.title}
              page={page}
              record={target || record}
              fieldKeys={edit.keys}
              description={edit.description}
              onSaved={() => {
                refresh();
                setEdit(null);
              }}
            />
          ) : (
            <>
              <p>{edit.description}</p>
              <button
                className="button primary"
                onClick={async () => {
                  try {
                    await post("/admin/system/sessions/revoke-all");
                    toast("其他会话已撤销");
                    setEdit(null);
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                确认撤销
              </button>
            </>
          )}
        </Modal>
      )}
      {recordForm !== undefined && (
        <ReferenceRecordForm
          page={channelSpec}
          record={recordForm || undefined}
          onClose={() => {
            setRecordForm(undefined);
            setChannel("");
          }}
          onDone={refresh}
        />
      )}
    </div>
  );
}
function InlineSettings({
  page,
  record,
  title,
  keys,
  description,
  onSaved,
  extra,
}: {
  page: PageSpec;
  record?: DataRecord;
  title: string;
  keys: string[];
  description: string;
  onSaved: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <section className="ref-inline-settings">
      <header>
        <Monitor size={17} />
        <h2>{title}</h2>
      </header>
      <SettingsFields
        key={(record?.version || 0) + title}
        page={page}
        record={record}
        fieldKeys={keys}
        description={description}
        onSaved={onSaved}
        extra={extra}
      />
    </section>
  );
}
function SettingsFields({
  page,
  record,
  fieldKeys,
  description,
  onSaved,
  extra,
}: {
  page: PageSpec;
  record?: DataRecord;
  fieldKeys: string[];
  description: string;
  onSaved: () => void;
  extra?: React.ReactNode;
}) {
  const toast = useToast(),
    [busy, setBusy] = useState(false),
    fields = page.fields.filter((f) => fieldKeys.includes(f.key)),
    [values, setValues] = useState<Record<string, any>>(() =>
      Object.fromEntries(
        page.fields.map((f) => [
          f.key,
          f.type === "secret"
            ? ""
            : (record?.data[f.key] ??
              f.default ??
              (f.type === "boolean" ? false : "")),
        ]),
      ),
    );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data: Record<string, any> = {};
      for (const f of page.fields) {
        let v = values[f.key];
        if (f.type === "secret" && !v) continue;
        if (f.type === "json" && typeof v === "string")
          v = v.trim() ? JSON.parse(v) : {};
        if (f.type === "tags" && typeof v === "string")
          v = v
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean);
        data[f.key] = v;
      }
      const body = {
        name: record?.name || page.label,
        status: record?.status || "active",
        data,
        ...(record ? { expected_version: record.version } : {}),
      };
      if (record) await put(`/admin/records/${page.key}/${record.id}`, body);
      else await post(`/admin/records/${page.key}`, body);
      toast("配置已保存");
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ref-settings-form" onSubmit={save}>
      <p className="ref-description">{description}</p>
      {fields.map((f) => (
        <label
          className={`field ${f.type === "boolean" ? "ref-switch-row" : ""}`}
          key={f.key}
        >
          <span>{f.label}</span>
          <FieldControl
            field={f}
            value={values[f.key]}
            onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
            configured={record?.configured_secrets?.includes(f.key)}
          />
          {["desktop-brand", "page-display"].includes(page.key) &&
            [
              "icon_url",
              "logo_url",
              "login_background",
              "login_background_light",
            ].includes(f.key) && (
              <BrandImageUpload
                kind={page.key}
                onChange={(url) =>
                  setValues((old) => ({ ...old, [f.key]: url }))
                }
              />
            )}
          {f.type === "secret" && <small>留空保留原密钥。</small>}
        </label>
      ))}
      {extra}
      <footer>
        <button className="button primary" disabled={busy}>
          保存
        </button>
      </footer>
    </form>
  );
}
