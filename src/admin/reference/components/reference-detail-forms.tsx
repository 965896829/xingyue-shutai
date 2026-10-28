"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  post,
  put,
  recordCollection,
  type DataRecord,
  type PageSpec,
} from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { ConfigField, TagInput } from "./platform-form";
import { useToast } from "./ui";
import { BrandImageUpload } from "./admin-parity-tools";
export type FormProps = {
  page: PageSpec;
  record?: DataRecord;
  onClose: () => void;
  onDone: () => void;
};
export function useResourceDraft({ page, record, onClose, onDone }: FormProps) {
  const toast = useToast();
  const [name, setName] = useState(record?.name || ""),
    [status, setStatus] = useState(record?.status || "active"),
    [busy, setBusy] = useState(false),
    [values, setValues] = useState<Record<string, any>>(() =>
      Object.fromEntries(
        page.fields.map((f) => [
          f.key,
          f.type === "secret"
            ? ""
            : record && f.key in record.data
              ? record.data[f.key]
              : (f.default ?? (f.type === "tags" ? [] : "")),
        ]),
      ),
    );
  const set = (k: string, v: any) => setValues((old) => ({ ...old, [k]: v }));
  async function save(extra: Record<string, any> = {}, recordName = name) {
    setBusy(true);
    try {
      if (!recordName.trim()) throw new Error("请填写名称");
      const data: Record<string, any> = {};
      for (const f of page.fields) {
        const value = values[f.key];
        if (f.type === "secret" && !value) continue;
        data[f.key] = value;
        if (f.type === "datetime" && value)
          data[f.key] = new Date(value).toISOString();
        if (f.type === "number" && value === "") data[f.key] = null;
      }
      Object.assign(data, extra);
      const body = {
        name: recordName,
        status,
        data,
        ...(record ? { expected_version: record.version } : {}),
      };
      if (record) await put(`/admin/records/${page.key}/${record.id}`, body);
      else await post(`/admin/records/${page.key}`, body);
      toast("保存成功");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return {
    name,
    setName,
    status,
    setStatus,
    values,
    set,
    setValues,
    busy,
    save,
  };
}
const integrationTemplates = [
  "LiblibAI",
  "aliyun-bailian",
  "aliyun-bailian-tripo3d",
  "anthropic",
  "blackforest",
  "dify",
  "easyai",
  "google-gemini",
  "grok",
  "hyper3d-rodin",
  "jimeng",
  "keling",
  "midjourney",
  "minimax",
  "n8n",
  "newapi",
  "ollama",
  "openai",
  "runninghub",
  "suno",
  "tencent-hunyuan",
  "tencent-hunyuan-image",
  "tencent-hunyuan-video",
  "tencent-lke",
  "tripo3d",
  "universal",
  "vidu",
  "volces",
  "sandbox",
];
function Actions({
  onClose,
  busy,
  onSave,
  label = "保存",
}: {
  onClose: () => void;
  busy: boolean;
  onSave: () => void;
  label?: string;
}) {
  return (
    <>
      <button className="button secondary" onClick={onClose}>
        取消
      </button>
      <button className="button primary" disabled={busy} onClick={onSave}>
        {busy ? "保存中…" : label}
      </button>
    </>
  );
}
export function ProviderForm(props: FormProps) {
  const s = useResourceDraft(props),
    v = s.values;
  return (
    <Modal
      title={props.record ? "编辑厂商" : "新增厂商"}
      onClose={props.onClose}
      footer={
        <Actions
          onClose={props.onClose}
          busy={s.busy}
          onSave={() => s.save()}
        />
      }
    >
      <div className="parity-stack">
        <ConfigField title="厂商编码">
          <input
            value={v.code}
            placeholder="如 openai"
            onChange={(e) => s.set("code", e.target.value)}
          />
        </ConfigField>
        <ConfigField title="厂商名称">
          <input
            value={s.name}
            placeholder="如 OpenAI"
            onChange={(e) => s.setName(e.target.value)}
          />
        </ConfigField>
        <ConfigField title="显示名称">
          <input
            value={v.display_name}
            placeholder="默认使用厂商名称"
            onChange={(e) => s.set("display_name", e.target.value)}
          />
        </ConfigField>
        <ConfigField title="接入规范">
          <select
            value={v.integration_template || v.protocol || "openai"}
            onChange={(e) => {
              s.set("integration_template", e.target.value);
              s.set(
                "protocol",
                e.target.value === "anthropic"
                  ? "anthropic"
                  : e.target.value === "google-gemini"
                    ? "gemini"
                    : e.target.value === "sandbox"
                      ? "sandbox"
                      : "openai",
              );
            }}
          >
            {integrationTemplates.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </ConfigField>
        <ConfigField title="图标 URL">
          <input
            value={v.icon_url}
            placeholder="https://..."
            onChange={(e) => s.set("icon_url", e.target.value)}
          />
        </ConfigField>
      </div>
    </Modal>
  );
}

export function UserForm({ record, onClose, onDone }: FormProps) {
  const [v, setV] = useState({
      username: record?.username || "",
      password: "",
      nickname: record?.nickname || "",
      role: record?.role || "author",
      status: record?.status || "active",
      organizations: record?.meta?.organizations || [],
      email: record?.email || "",
      phone: record?.phone || "",
    }),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (key: string, value: any) =>
    setV((x) => ({ ...x, [key]: value }));
  async function save() {
    setBusy(true);
    try {
      if (!record && !v.password) throw new Error("请填写初始密码");
      if (record)
        await put(`/admin/users/${record.id}`, {
          ...v,
          password: v.password || undefined,
          expected_version: record.version,
        });
      else await post("/admin/users", v);
      toast("用户已保存");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={record ? "编辑用户" : "新增用户"}
      onClose={onClose}
      footer={<Actions onClose={onClose} busy={busy} onSave={save} />}
    >
      <div className="parity-stack">
        <ConfigField title="用户名">
          <input
            autoComplete="off"
            value={v.username}
            onChange={(e) => set("username", e.target.value)}
          />
        </ConfigField>
        <ConfigField title={record ? "密码（留空不修改）" : "初始密码"}>
          <input
            type="password"
            autoComplete="new-password"
            value={v.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </ConfigField>
        <ConfigField title="昵称">
          <input
            value={v.nickname}
            onChange={(e) => set("nickname", e.target.value)}
          />
        </ConfigField>
        <ConfigField title="角色">
          <select value={v.role} onChange={(e) => set("role", e.target.value)}>
            {Object.entries({
              author: "普通用户",
              creator: "创作者",
              operator: "运营管理员",
              manager: "管理员",
              superadmin: "超级管理员",
              evaluator: "评测员",
            }).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </ConfigField>
        <ConfigField
          title="组织"
          hint="首个组织用于模型折扣计费，其他组织仍参与权限判断。"
        >
          <TagInput
            label="用户组织"
            value={v.organizations}
            onChange={(x) => set("organizations", x)}
            placeholder="可选"
          />
        </ConfigField>
        <ConfigField title="用户状态">
          <select
            value={v.status}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="active">正常</option>
            <option value="disabled">禁用</option>
          </select>
        </ConfigField>
      </div>
    </Modal>
  );
}

export function ProductForm(props: FormProps) {
  const s = useResourceDraft(props),
    v = s.values;
  function text(k: string, title: string, hint?: string, placeholder?: string) {
    return (
      <ConfigField title={title} hint={hint}>
        <input
          value={v[k] || ""}
          placeholder={placeholder}
          onChange={(e) => s.set(k, e.target.value)}
        />
      </ConfigField>
    );
  }
  function number(k: string, title: string, hint?: string) {
    return (
      <ConfigField title={title} hint={hint}>
        <input
          type="number"
          min={k === "price" ? 1 : 0}
          value={v[k] ?? ""}
          onChange={(e) =>
            s.set(k, e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </ConfigField>
    );
  }
  function toggle(k: string, title: string) {
    return (
      <ConfigField title={title}>
        <select
          value={v[k] ? "true" : "false"}
          onChange={(e) => s.set(k, e.target.value === "true")}
        >
          <option value="true">启用</option>
          <option value="false">停用</option>
        </select>
      </ConfigField>
    );
  }
  return (
    <Modal
      className="product-detail-modal"
      title="新增或修改套餐"
      onClose={props.onClose}
      footer={
        <button
          className="button primary"
          disabled={s.busy}
          onClick={() => s.save()}
        >
          保存
        </button>
      }
    >
      <div className="product-detail-fields">
        <ConfigField title="套餐名称">
          <input value={s.name} onChange={(e) => s.setName(e.target.value)} />
        </ConfigField>
        {text("description", "套餐描述")}
        <ConfigField title="套餐封面" hint="套餐封面图片，用于在充值页面展示">
          <div className="parity-upload-line">
            <input
              value={v.cover || ""}
              onChange={(e) => s.set("cover", e.target.value)}
            />
            <BrandImageUpload
              kind="products"
              onChange={(url) => s.set("cover", url)}
            />
          </div>
          {v.cover && (
            <img
              className="product-cover-preview"
              src={v.cover}
              alt="套餐封面预览"
            />
          )}
        </ConfigField>
        {toggle("online_pay", "启用线上充值")}
        {toggle("redeem_enabled", "启用兑换码")}
        <ConfigField
          title="套餐详情"
          hint="套餐具体包含的详情内容，自动按行处理为不同的项目"
        >
          <textarea
            rows={3}
            value={v.details || ""}
            onChange={(e) => s.set("details", e.target.value)}
          />
        </ConfigField>
        {number("price", "套餐金额（最少为1，单位为分）")}
        <ConfigField title="货币">
          <select
            value={v.currency}
            onChange={(e) => s.set("currency", e.target.value)}
          >
            <option>CNY</option>
            <option>USD</option>
          </select>
        </ConfigField>
        {text(
          "virtual_item_id",
          "微信虚拟支付道具 ID",
          "需要在微信小程序内购买的虚拟商品必须配置，并与微信虚拟支付后台的道具 ID 完全一致。",
          "请输入微信虚拟支付后台发布的道具 ID",
        )}
        {number("credits", "充值算力额度")}
        {number("bonus", "赠送算力额度")}
        {number(
          "duration_days",
          "算力额度有效期(天)",
          "充值算力额度的有效期，单位：天",
        )}
        {number("membership_days", "会员时长", "套餐赠送时长")}
        <ConfigField title="套餐类型">
          <select
            value={v.package_type}
            onChange={(e) => s.set("package_type", e.target.value)}
          >
            <option value="personal">个人资源包</option>
            <option value="organization">组织资源包</option>
          </select>
        </ConfigField>
        {text("organization", "会员组织")}
        <ConfigField title="关联应用">
          <TagInput
            label="关联应用"
            value={v.applications || []}
            onChange={(x) => s.set("applications", x)}
            placeholder="选择关联应用"
          />
        </ConfigField>
        {number("sort", "排序")}
        <details className="product-extra-settings">
          <summary>订阅与会员权益</summary>
          <ConfigField title="计费方式">
            <select
              value={v.billing_mode}
              onChange={(e) => s.set("billing_mode", e.target.value)}
            >
              <option value="one_time">一次性购买</option>
              <option value="subscription">自动续费订阅</option>
            </select>
          </ConfigField>
          {v.billing_mode === "subscription" &&
            number("renewal_days", "续费周期（天）")}
          {number("membership_level", "会员等级")}
        </details>
      </div>
    </Modal>
  );
}

export function RedeemCodeForm(props: FormProps) {
  const s = useResourceDraft(
      props.record
        ? props
        : {
            ...props,
            page: {
              ...props.page,
              fields: props.page.fields.map((f) =>
                f.key === "expires_at"
                  ? {
                      ...f,
                      default: new Date(
                        Date.now() + 30 * 86400000,
                      ).toISOString(),
                    }
                  : f,
              ),
            },
          },
    ),
    v = s.values;
  const [code, setCode] = useState(
    v.code || crypto.randomUUID().replaceAll("-", "").toUpperCase(),
  );
  const products = useQuery({
    queryKey: ["redeem-products"],
    queryFn: () => recordCollection("products"),
  });
  function numeric(k: string, title: string, placeholder?: string) {
    return (
      <ConfigField title={title}>
        <input
          type="number"
          min={k === "max_uses" ? 1 : 0}
          value={v[k] ?? ""}
          placeholder={placeholder}
          onChange={(e) =>
            s.set(k, e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </ConfigField>
    );
  }
  const date = v.expires_at ? new Date(v.expires_at) : null;
  const localDate =
    date && !Number.isNaN(date.getTime())
      ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";
  return (
    <Modal
      title={props.record ? "编辑兑换码" : "新增兑换码"}
      onClose={props.onClose}
      footer={
        <Actions
          onClose={props.onClose}
          busy={s.busy}
          onSave={() => s.save({ code }, v.description || code)}
        />
      }
    >
      <div className="parity-stack">
        <ConfigField title="兑换码">
          <input
            value={code}
            placeholder="请输入标题"
            onChange={(e) => setCode(e.target.value)}
          />
        </ConfigField>
        <ConfigField title="兑换码描述">
          <input
            value={v.description || ""}
            onChange={(e) => s.set("description", e.target.value)}
          />
        </ConfigField>
        <ConfigField title="兑换码类型">
          <select
            value={v.type || "credits"}
            onChange={(e) => s.set("type", e.target.value)}
          >
            <option value="credits">普通兑换码</option>
            <option value="product">资源包兑换码</option>
          </select>
        </ConfigField>
        {v.type === "product" ? (
          <ConfigField title="资源包产品">
            <select
              value={v.product_id || ""}
              onChange={(e) => s.set("product_id", e.target.value)}
            >
              <option value="">请选择资源包产品</option>
              {products.data?.items.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </ConfigField>
        ) : (
          numeric("credits", "兑换码可兑换算力值")
        )}
        {numeric(
          "credit_expiry_days",
          "算力过期时间（天）（可选，不设置则永不过期）",
          "留空表示永不过期",
        )}
        {numeric("max_uses", "兑换码最大使用次数")}
        <ConfigField title="已经兑换次数">
          <input value={props.record?.data.uses || 0} disabled />
        </ConfigField>
        <ConfigField title="兑换码过期时间">
          <input
            type="datetime-local"
            value={localDate}
            onChange={(e) => s.set("expires_at", e.target.value)}
          />
        </ConfigField>
        <ConfigField title="兑换码是否激活">
          <input
            type="checkbox"
            checked={v.activated !== false}
            onChange={(e) => s.set("activated", e.target.checked)}
          />
        </ConfigField>
      </div>
    </Modal>
  );
}
