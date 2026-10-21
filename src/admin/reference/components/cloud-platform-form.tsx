"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "@reference/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@reference/lib/api";
import { post, put, type DataRecord } from "@reference/lib/api";
import { Modal, CompactHeading } from "./reference-ui";
import { useToast, Spinner, ErrorState } from "./ui";

function CloudPageFrame({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <CompactHeading
        title={title}
        actions={
          <button className="button secondary" onClick={onClose}>
            返回云平台列表
          </button>
        }
      />
      <section className="ref-panel cloud-platform-editor">
        <div className="cloud-platform-fields">{children}</div>
        <div className="cloud-platform-footer">{footer}</div>
      </section>
    </>
  );
}

export function CloudPlatformPage() {
  const pathname = usePathname(),
    router = useRouter(),
    cache = useQueryClient();
  const id = pathname.split("/").at(-1) || "",
    creating = id === "new";
  const query = useQuery({
    queryKey: ["cloud-platform-edit", id],
    enabled: !creating,
    queryFn: async () => {
      const result = await api<{ items: DataRecord[] }>(
        `/admin/records/cloud?q=${encodeURIComponent(id)}`,
      );
      const row = result.items.find((r) => r.id === id);
      if (!row) throw new Error("云平台不存在或已删除");
      return row;
    },
  });
  if (!creating && query.isPending) return <Spinner />;
  if (!creating && query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  return (
    <CloudPlatformForm
      key={id}
      inline
      record={query.data}
      onClose={() => router.push("/admin/cloud-platform")}
      onDone={() => {
        cache.invalidateQueries({ queryKey: ["reference-list"] });
        cache.invalidateQueries({ queryKey: ["records"] });
        cache.invalidateQueries({ queryKey: ["cloud-platform-edit"] });
      }}
    />
  );
}

const platforms: Record<
  string,
  { name: string; auth: string[]; services: string[] }
> = {
  aliyun: {
    name: "阿里云",
    auth: ["accessKeyId", "accessKeySecret"],
    services: ["sms", "translation"],
  },
  tencent: {
    name: "腾讯云",
    auth: ["secretId", "secretKey"],
    services: ["sms", "translation", "audit_media"],
  },
  volcengine: {
    name: "火山引擎",
    auth: ["accessKeyId", "secretAccessKey"],
    services: ["sms", "translation", "audit_media"],
  },
  xiangongyun: {
    name: "仙宫云",
    auth: ["apiKey"],
    services: ["compute_xiangongyun"],
  },
  autodl: { name: "AutoDL", auth: ["token"], services: ["compute_autodl"] },
  mail: { name: "邮件服务", auth: ["password"], services: ["mail"] },
};
const names: Record<string, string> = {
  sms: "短信发送",
  translation: "翻译",
  audit_media: "媒体审核",
  compute_xiangongyun: "仙宫云算力",
  compute_autodl: "AutoDL 算力",
  mail: "邮件发送",
};
const fields: Record<string, Record<string, string>> = {
  sms: {
    login_template: "注册及登录短信模板 ID",
    reset_template: "重置密码短信模板 ID",
    bind_template: "绑定手机号模板 ID",
    app_id: "应用 ID（腾讯云）",
    sms_account: "消息组 ID（火山引擎）",
    signature: "短信签名",
  },
  translation: {
    region: "服务区域",
    project_id: "项目 ID",
    default_source: "默认源语言",
    default_target: "默认目标语言",
  },
  audit_media: {
    region: "服务区域",
    biz_type: "审核业务类型",
    callback_url: "审核回调地址",
  },
  compute_xiangongyun: { region: "服务区域", workspace_id: "工作空间 ID" },
  compute_autodl: { region: "服务区域", workspace_id: "工作空间 ID" },
  mail: {
    host: "SMTP 主机",
    port: "TLS 端口（465 / 587）",
    username: "SMTP 用户名",
    sender: "发件地址",
  },
};

export function CloudPlatformForm({
  record,
  onClose,
  onDone,
  inline = false,
}: {
  record?: DataRecord;
  onClose: () => void;
  onDone: () => void;
  inline?: boolean;
}) {
  const [name, setName] = useState(record?.name || ""),
    [provider, setProvider] = useState(record?.data.provider || "aliyun"),
    [auth, setAuth] = useState<Record<string, string>>({}),
    [services, setServices] = useState<any[]>(record?.data.services || []),
    [enabled, setEnabled] = useState(record?.status !== "disabled"),
    [priority, setPriority] = useState(record?.data.priority ?? 100),
    [add, setAdd] = useState(""),
    [edit, setEdit] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    toast = useToast();
  const cfg = platforms[provider] || { name: provider, auth: [], services: [] };
  const service = services.find((s) => s.code === edit);
  const Frame = inline ? CloudPageFrame : Modal;
  function updateService(code: string, values: any) {
    setServices((xs) =>
      xs.map((x) => (x.code === code ? { ...x, ...values } : x)),
    );
  }
  async function save() {
    setBusy(true);
    try {
      const data = {
        provider,
        priority,
        services,
        features: services.filter((s) => s.enabled).map((s) => names[s.code]),
        endpoint: record?.data.endpoint || "",
        region: record?.data.region || "",
        ...(Object.values(auth).some(Boolean)
          ? { base_auth: JSON.stringify(auth) }
          : {}),
      };
      const body = {
        name,
        status: enabled ? "active" : "disabled",
        data,
        ...(record ? { expected_version: record.version } : {}),
      };
      if (record) await put(`/admin/records/cloud/${record.id}`, body);
      else await post("/admin/records/cloud", body);
      toast("云平台配置已保存");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame
      title={record ? "编辑云平台" : "新增云平台"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={busy || !name.trim()}
            onClick={save}
          >
            确定
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          平台名称
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          平台
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setAuth({});
              setServices([]);
              setAdd("");
            }}
          >
            {!platforms[provider] && (
              <option value={provider}>{provider}</option>
            )}
            {Object.entries(platforms).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3>认证信息</h3>
      {(record?.configured_secrets?.length || 0) > 0 && (
        <p className="ref-field-help">
          已有认证信息已加密保存，留空保留；更换厂商会清除原厂商凭证。
        </p>
      )}
      <div className="form-grid">
        {cfg.auth.map((key) => (
          <label className="field" key={key}>
            {key}
            <input
              type="password"
              autoComplete="new-password"
              value={auth[key] || ""}
              onChange={(e) => setAuth({ ...auth, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="mw-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        是否启用
      </label>
      <h3>启用的服务</h3>
      <div className="ref-toolbar">
        <select
          aria-label="选择云服务"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
        >
          <option value="">选择服务功能</option>
          {cfg.services
            .filter((k) => !services.some((s) => s.code === k))
            .map((k) => (
              <option key={k} value={k}>
                {names[k]}
              </option>
            ))}
        </select>
        <button
          className="button secondary"
          disabled={!add}
          onClick={() => {
            setServices([
              ...services,
              { code: add, enabled: true, config: {} },
            ]);
            setAdd("");
          }}
        >
          添加功能
        </button>
      </div>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>服务名称</th>
              <th>服务编码</th>
              <th>是否启用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.code}>
                <td>{names[s.code] || s.code}</td>
                <td>{s.code}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`启用${names[s.code]}`}
                    checked={s.enabled}
                    onChange={(e) =>
                      updateService(s.code, { enabled: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => setEdit(s.code)}
                  >
                    {s.code === "sms" ? "设置模板" : "服务设置"}
                  </button>
                  <DeleteButton
                    confirmation="inline"
                    className="text-button"
                    onClick={() =>
                      setServices(services.filter((x) => x.code !== s.code))
                    }
                  >
                    删除
                  </DeleteButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!services.length && <p className="muted">尚未添加服务</p>}
      </div>
      <label className="field">
        优先级
        <input
          type="number"
          min={0}
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        />
      </label>
      <p className="ref-field-help">
        本页维护厂商与服务配置。当前事件通知使用独立的 SMTP / HTTP
        网关；原生短信、翻译、算力租赁和媒体审核服务尚未联通。
      </p>
      {service && (
        <Modal
          title={
            service.code === "sms"
              ? "短信模板设置"
              : names[service.code] + "设置"
          }
          onClose={() => setEdit(null)}
          footer={
            <button className="button primary" onClick={() => setEdit(null)}>
              保存到本次编辑
            </button>
          }
        >
          <div className="form-grid">
            {Object.entries(fields[service.code] || {}).map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type={key === "port" ? "number" : "text"}
                  value={service.config[key] ?? ""}
                  onChange={(e) =>
                    updateService(service.code, {
                      config: {
                        ...service.config,
                        [key]:
                          key === "port"
                            ? Number(e.target.value)
                            : e.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {service.code === "sms" && (
            <p className="ref-field-help">
              验证码模板应包含 code 参数；模板编号与签名需由相应厂商审核后使用。
            </p>
          )}
        </Modal>
      )}
    </Frame>
  );
}
