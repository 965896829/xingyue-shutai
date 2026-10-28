"use client";
import { useState } from "react";
import {
  api,
  post,
  put,
  type DataRecord,
  type Field,
  type PageSpec,
} from "@reference/lib/api";
import { FieldControl } from "./resource-page";
import { Modal, RefTabs } from "./reference-ui";
import { useToast } from "./ui";
import { CloudPlatformForm } from "./cloud-platform-form";
import { PlatformForm } from "./platform-form";
import { PricingRuleForm } from "./pricing-rule-form";
import { RuntimePolicyForm } from "./runtime-policy-form";
import { MCPServerForm } from "./mcp-server-form";
import { BaseModelForm } from "./base-model-form";
import { NotificationRuleForm } from "./notification-rule-form";
import {
  ProviderForm,
  UserForm,
  ProductForm,
  RedeemCodeForm,
} from "./reference-detail-forms";
import { MemberForm } from "./member-form";
import { StorageForm } from "./storage-form";
import { ModelForm } from '../../ModelForm';
export const userFields: Field[] = [
  {
    key: "username",
    label: "用户名",
    type: "text",
    required: true,
    default: "",
    options: [],
  },
  {
    key: "password",
    label: "初始密码（编辑时留空保留）",
    type: "secret",
    required: false,
    default: "",
    options: [],
  },
  {
    key: "nickname",
    label: "昵称",
    type: "text",
    required: false,
    default: "",
    options: [],
  },
  {
    key: "role",
    label: "角色",
    type: "select",
    required: true,
    default: "author",
    options: [
      "author",
      "creator",
      "operator",
      "manager",
      "superadmin",
      "evaluator",
    ],
  },
  {
    key: "status",
    label: "用户状态",
    type: "select",
    required: true,
    default: "active",
    options: ["active", "disabled"],
  },
  {
    key: "email",
    label: "邮箱",
    type: "email",
    required: false,
    default: "",
    options: [],
  },
  {
    key: "phone",
    label: "手机",
    type: "text",
    required: false,
    default: "",
    options: [],
  },
];
function localDateValue(value: any) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
}
const groups: Record<string, Record<string, string[]>> = {
  platforms: {
    基本信息: ["provider", "protocol", "base_url", "priority", "mode"],
    计费授权: ["api_key", "balance", "pricing_id"],
    权限规则: [],
    模型: ["models"],
    平台配置: ["runtime_policy_id"],
    高级脚本开发: [],
  },
  pricing: {
    文本: [
      "input_rate",
      "output_rate",
      "base_rate",
      "unit",
      "cache_read_rate",
      "cache_write_rate",
      "tiers",
    ],
    图像: ["base_rate", "unit"],
    视频: ["input_rate", "output_rate", "base_rate", "unit"],
    音频: ["input_rate", "output_rate", "base_rate", "unit"],
  },
  "runtime-policies": {
    基本设置: ["model", "rpm", "tpm", "concurrency"],
    调度与重试: ["strategy", "timeout", "retry_limit"],
  },
};
export function ReferenceRecordForm(props: {
  page: PageSpec;
  record?: DataRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  if (['models', 'base-models'].includes(props.page.key)) return <ModelForm {...props} />;
  if (props.page.key === "mcp") return <MCPServerForm {...props} />;
  if (props.page.key === "base-models") return <BaseModelForm {...props} />;
  if (props.page.key === "notifications")
    return <NotificationRuleForm {...props} />;
  if (props.page.key === "pricing") return <PricingRuleForm {...props} />;
  if (props.page.key === "members") return <MemberForm {...props} />;
  if (props.page.key === "storage") return <StorageForm {...props} />;
  if (props.page.key === "providers") return <ProviderForm {...props} />;
  if (props.page.key === "users") return <UserForm {...props} />;
  if (props.page.key === "products") return <ProductForm {...props} />;
  if (props.page.key === "redeem-codes") return <RedeemCodeForm {...props} />;
  if (props.page.key === "runtime-policies")
    return <RuntimePolicyForm {...props} />;
  return props.page.key === "platforms" ? (
    <PlatformForm {...props} />
  ) : props.page.key === "cloud" ? (
    <CloudPlatformForm
      record={props.record}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  ) : (
    <DefaultReferenceRecordForm {...props} />
  );
}
function DefaultReferenceRecordForm({
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
    fields = isUser ? userFields : page.fields,
    toast = useToast(),
    tabs = groups[page.key];
  const [name, setName] = useState(record?.name || ""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState(tabs ? Object.keys(tabs)[0] : ""),
    [values, setValues] = useState<Record<string, any>>(() =>
      Object.fromEntries(
        fields.map((f) => [
          f.key,
          f.type === "secret"
            ? ""
            : ((isUser ? record?.[f.key] : record?.data[f.key]) ??
              f.default ??
              (f.type === "boolean" ? false : "")),
        ]),
      ),
    );
  const [upload, setUpload] = useState<File | null>(null);
  const isPricing = page.key === "pricing";
  const visible = fields.filter(
    (f) =>
      !tabs ||
      tabs[tab].includes(f.key) ||
      (isPricing &&
        (["resource_type", "currency", "description"].includes(f.key) ||
          f.key.startsWith("supplier_"))),
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data: Record<string, any> = {};
      for (const f of fields) {
        let v = values[f.key];
        if (f.type === "secret" && !v) continue;
        if (f.required && (v === null || v === "" || v === undefined))
          throw new Error("请填写" + f.label);
        if (f.type === "json" && typeof v === "string")
          v = v.trim() ? JSON.parse(v) : {};
        if (f.type === "tags" && typeof v === "string")
          v = v
            .split(/[,，]/)
            .map((v) => v.trim())
            .filter(Boolean);
        if (f.type === "datetime" && v) v = new Date(v).toISOString();
        data[f.key] = v;
      }
      let row: any;
      if (isUser) {
        if (!record && !data.password) throw new Error("请填写初始密码");
        row = record
          ? await put(`/admin/users/${record.id}`, {
              ...data,
              expected_version: record.version,
            })
          : await post("/admin/users", data);
      } else {
        const body = {
          name,
          status: record?.status || "active",
          data,
          ...(record ? { expected_version: record.version } : {}),
        };
        row = record
          ? await put(`/admin/records/${page.key}/${record.id}`, body)
          : await post(`/admin/records/${page.key}`, body);
      }
      if (upload) {
        try {
          const form = new FormData();
          form.append("file", upload);
          await api(`/admin/records/${page.key}/${row.id}/upload`, {
            method: "POST",
            body: form,
          });
        } catch (e) {
          onDone();
          onClose();
          toast("记录已保存，但上传失败：" + (e as Error).message, true);
          return;
        }
      }
      toast("保存成功");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const title =
    page.key === "platforms"
      ? record
        ? "编辑平台接入"
        : "新增平台接入"
      : page.key === "products"
        ? "新增或修改套餐"
        : page.key === "mcp"
          ? record
            ? "编辑 MCP Server"
            : "添加 MCP Server"
          : `${record ? "编辑" : "新增"}${page.label.replace("管理", "")}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={!!tabs || page.key === "products"}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取 消
          </button>
          <button
            className="button primary"
            form="reference-record-form"
            type="submit"
            disabled={busy}
          >
            保 存
          </button>
        </>
      }
    >
      {tabs && (
        <RefTabs
          tabs={Object.keys(tabs)}
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (isPricing)
              setValues((v) => ({
                ...v,
                resource_type: (
                  {
                    文本: "text",
                    图像: "image",
                    视频: "video",
                    音频: "audio",
                  } as Record<string, string>
                )[t],
              }));
          }}
        />
      )}
      <form
        id="reference-record-form"
        className={`ref-form ${page.key === "platforms" ? "two-columns" : ""}`}
        onSubmit={save}
      >
        {!isUser && (!tabs || tab === Object.keys(tabs)[0] || isPricing) && (
          <label className="field full">
            <span>
              {page.key === "products"
                ? "套餐名称"
                : page.key === "platforms"
                  ? "平台名称"
                  : "名称"}{" "}
              <b>*</b>
            </span>
            <input
              required
              maxLength={250}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {visible.map((f) => (
          <label
            className={`field ${["textarea", "tags", "json"].includes(f.type) ? "full" : ""} ${f.type === "boolean" ? "ref-switch-row" : ""}`}
            key={f.key}
          >
            <span>
              {f.label}
              {f.required ? " *" : ""}
            </span>
            <FieldControl
              field={f}
              value={
                f.type === "datetime" && values[f.key]
                  ? localDateValue(values[f.key])
                  : values[f.key]
              }
              onChange={(v) => setValues((old) => ({ ...old, [f.key]: v }))}
              configured={record?.configured_secrets?.includes(f.key)}
            />
            {f.type === "secret" && (
              <small>保存后不会回显；留空保留原密钥。</small>
            )}
          </label>
        ))}
        {page.key === "platforms" && tab === "权限规则" && (
          <p className="ref-notice full">
            平台访问规则在「三方 API 接入 →
            权限规则」中维护，运行时会校验用户、角色与会员等级。
          </p>
        )}
        {page.key === "platforms" && tab === "高级脚本开发" && (
          <p className="ref-notice full">
            当前接入支持 OpenAI、Anthropic、Gemini 、OpenAI Responses
            与沙箱协议。高级脚本可在平台接入表单中配置、测试和执行。
          </p>
        )}
        {page.key === "mcp" && (
          <div className="full">
            <p className="ref-field-help">
              保存服务后先「测试连接」发现工具。支持 Streamable HTTP、旧 SSE
              和独立容器 stdio。stdio
              先在运行环境安装依赖；不会访问宿主目录或网络。写入工具每次执行均需用户确认。
            </p>
            {record?.data.tools?.length > 0 && (
              <div className="ref-form">
                {(record?.data.tools || []).map((tool: any) => {
                  const safe =
                    tool.annotations?.readOnlyHint === true &&
                    tool.annotations?.destructiveHint !== true;
                  const key = safe ? "allowed_tools" : "approved_write_tools";
                  const selected = Array.isArray(values[key])
                    ? values[key]
                    : String(values[key] || "")
                        .split(/[,，]/)
                        .map((v) => v.trim());
                  return (
                    <div key={tool.name} className="ref-mcp-tool">
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`允许工具 ${tool.name}`}
                          checked={selected.includes(tool.name)}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              [key]: e.target.checked
                                ? [...selected, tool.name]
                                : selected.filter((n) => n !== tool.name),
                            }))
                          }
                        />
                        <strong>{tool.name}</strong>
                        <small>{safe ? "只读查询" : "逐次审批后执行"}</small>
                      </label>
                      <p>{tool.description}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {page.actions.includes("upload") && (
          <label className="field full">
            <span>
              {page.key === "knowledge" ? "上传文档" : "技能 ZIP 文件"}
            </span>
            <input
              type="file"
              accept={page.key === "knowledge" ? ".txt,.md,.docx" : ".zip"}
              onChange={(e) => setUpload(e.target.files?.[0] || null)}
            />
          </label>
        )}
        {isPricing && (
          <div className="ref-notice full">
            计费公式按所选单位执行：输入用量 × 输入单价 + 输出用量 × 输出单价 +
            基础费用。文本按百万 Token
            计价，缓存用量从输入总量中分出；供应商成本单独记录，留空表示尚未配置成本。阶梯按起始
            Token 和单价填写 JSON 数组。
          </div>
        )}
      </form>
    </Modal>
  );
}
