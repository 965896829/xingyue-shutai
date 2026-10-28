"use client";

import {
  createContext, useContext,
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
} from "react";
import providerPresets from "@reference/lib/platform-presets.json";
import { useQuery } from "@tanstack/react-query";
import {
  Cloud,
  Plus,
  LockKeyhole,
  Unlock,
  Eye,
  EyeOff,
  Search,
  Settings2,
} from "lucide-react";
import {
  api,
  post,
  put,
  recordCollection,
  type DataRecord,
  type PageSpec,
} from "@reference/lib/api";
import { Modal, RefTabs, RefEmpty } from "./reference-ui";
import { useToast } from "./ui";
import { DeleteButton } from "./interaction/delete-button";

type Account = {
  id: string;
  name: string;
  priority: number | null;
  enabled: boolean;
  auth_type: string;
  auth: Record<string, string>;
  header_name: string;
  portrait_enabled: boolean;
};
type Variable = { name: string; value: string; secret: boolean; usage: string };
type ModelConfig = {
  model: string;
  base_model_id?: string;
  display_name: string;
  real_model: string;
  enabled: boolean;
  discount: number;
  pricing_id: string;
  runtime_policy_id: string;
  capability?: string;
};
const tabs = [
  "基本信息",
  "计费授权",
  "权限规则",
  "模型",
  "平台配置",
  "高级脚本开发",
];
const authTypes: Record<string, string> = {
  api_key: "API Key",
  token: "Token",
  bearer: "Bearer",
  header: "自定义 Header",
  access_key: "AccessKey + SecretKey",
  none: "无授权",
};
const authKeys: Record<string, string[]> = {
  api_key: ["api_key"],
  token: ["token"],
  bearer: ["token"],
  header: ["header_value"],
  access_key: ["access_key", "secret_key"],
  none: [],
};
const authLabels: Record<string, string> = {
  api_key: "API Key",
  token: "Token",
  header_value: "Header 值",
  access_key: "AccessKey",
  secret_key: "SecretKey",
};
const capabilities: Record<string, string> = {
  text: "文本生成",
  embedding: "文本向量",
  rerank: "文本重排",
  image: "图像生成",
  video: "视频生成",
  audio: "音频生成",
};
const providers = providerPresets;
function newAccount(name = "默认账号", id: string = crypto.randomUUID()): Account {
  return {
    id,
    name,
    priority: null,
    enabled: true,
    auth_type: "api_key",
    auth: {},
    header_name: "X-API-Key",
    portrait_enabled: false,
  };
}
function modelConfig(model: string): ModelConfig {
  return {
    model,
    display_name: model,
    real_model: model,
    enabled: true,
    discount: 1,
    pricing_id: "",
    runtime_policy_id: "",
  };
}
const PlatformLocalContext = createContext(false);
const localFieldTitles = new Set(["模型厂商 / 接入渠道", "平台名称", "API Key", "代理模式", "代理地址", "运行超时覆盖（秒）", "运行超时（秒）", "输出超时覆盖（秒）"]);
export function ConfigField({
  title,
  hint,
  children,
  full = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  full?: boolean;
}) {
  const id = useId();
  const local = useContext(PlatformLocalContext);
  return (
    <fieldset
      disabled={local && !localFieldTitles.has(title)}
      className={`parity-field local-preview-fields ${local && !localFieldTitles.has(title) ? 'local-readonly-field' : ''} ${full ? "full" : ""}`}
      role="group"
      aria-labelledby={id}
    >
      <span id={id}>{title}{local && !localFieldTitles.has(title) && <small> · 尚未接入</small>}</span>
      {hint && <small>{hint}</small>}
      {Children.map(children, (child) =>
        isValidElement<{ "aria-label"?: string; "aria-labelledby"?: string }>(
          child,
        ) &&
        typeof child.type === "string" &&
        ["input", "select", "textarea"].includes(child.type) &&
        !child.props["aria-label"] &&
        !child.props["aria-labelledby"]
          ? cloneElement(child, { "aria-labelledby": id })
          : child,
      )}
    </fieldset>
  );
}
export function ConfigToggle({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const local = useContext(PlatformLocalContext);
  return (
    <label className="parity-toggle full">
      <input
        disabled={local && title !== '启用平台'}
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{title}{local && title !== '启用平台' && <small> · 尚未接入</small>}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
export function TagInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  label: string;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft
      .split(/[,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (v.length) {
      onChange([...new Set([...value, ...v])]);
      setDraft("");
    }
  }
  return (
    <div className="parity-tags">
      {value.map((v) => (
        <span key={v}>
          {v}
          <DeleteButton
            type="button"
            aria-label={`移除 ${v}`}
            onClick={() => onChange(value.filter((x) => x !== v))}
          />
        </span>
      ))}
      <input
        aria-label={label}
        placeholder={value.length ? "" : placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}
function SecretInput({
  value,
  onChange,
  configured = false,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  configured?: boolean;
  label: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="parity-secret">
      <input
        type={show ? "text" : "password"}
        autoComplete="new-password"
        aria-label={label}
        value={value}
        placeholder={configured ? "已配置，留空保留" : ""}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="icon-button"
        aria-label={show ? "隐藏密钥" : "显示密钥"}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function PlatformForm({
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
  const toast = useToast();
  const [saved, setSaved] = useState(record),
    [name, setName] = useState(record?.name || "EasyAI"),
    [enabled, setEnabled] = useState(record?.status !== "disabled"),
    [tab, setTab] = useState(record?.data._open_models ? '模型' : tabs[0]),
    [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(
      page.fields.map((f) => [f.key, record?.data[f.key] ?? f.default ?? ""]),
    ),
  );
  const [variables, setVariables] = useState<Variable[]>(() =>
    record?.data.variables?.length
      ? record.data.variables
      : [
          {
            name: "baseURL",
            value:
              record?.data.base_url ||
              providers.find((p) => p.name === "EasyAI")!.url,
            secret: false,
            usage:
              "平台 API 的基础地址，执行链路和脚本中的 context.createRequestURL 会优先使用它拼接请求。",
          },
        ],
  );
  const [accounts, setAccounts] = useState<Account[]>(() =>
    record?.data.accounts?.length
      ? record.data.accounts.map((a: Account) => ({ ...a, auth: {} }))
      : [newAccount("默认账号", "default")],
  );
  const [models, setModels] = useState<ModelConfig[]>(() =>
    record?.data.model_settings?.length
      ? record.data.model_settings
      : (record?.data.models || []).map(modelConfig),
  );
  const [scripts, setScripts] = useState<Record<string, any>>(
    record?.data.scripts || {},
  );
  const [accountEdit, setAccountEdit] = useState<Account | null>(null),
    [scriptEdit, setScriptEdit] = useState<string | null>(null),
    [modelPicker, setModelPicker] = useState(false),
    [modelEdit, setModelEdit] = useState<ModelConfig | null>(null),
    [scriptTest, setScriptTest] = useState(false),
    [testScene, setTestScene] = useState("text_generate"),
    [testParams, setTestParams] = useState(
      '{\n  "model": "",\n  "messages": [{"role": "user", "content": "测试参数"}]\n}',
    ),
    [testResult, setTestResult] = useState<any>(null);
  const [manualModel, setManualModel] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("enabled"),
    [capability, setCapability] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [accountId, setAccountId] = useState(accounts[0]?.id || ""),
    [detection, setDetection] = useState<any>(null);
  const refs = useQuery({
    queryKey: ["platform-form-options"],
    queryFn: async () => {
      const [providers, prices, policies, bases, models] = await Promise.all([
        recordCollection("providers"),
        recordCollection("pricing"),
        recordCollection("runtime-policies"),
        recordCollection("base-models"),
        recordCollection("models"),
      ]);
      return {
        providers: providers.items,
        prices: prices.items,
        policies: policies.items,
        bases: bases.items,
        models: models.items,
      };
    },
  });
  const health = useQuery({
    queryKey: ["platform-account-health", saved?.id, saved?.version],
    queryFn: () =>
      api(`/admin/platform-configuration/${saved!.id}/account-health`),
    enabled: !!saved,
  });
  async function restoreAccount(account: any) {
    try {
      await post(
        `/admin/platform-configuration/${saved!.id}/accounts/${account.id}/restore`,
        { expected_version: account.version },
      );
      await health.refetch();
      toast("账号已恢复");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  const set = (key: string, value: any) =>
    setValues((old) => ({ ...old, [key]: value }));
  const configured = (a: Account, key: string) =>
    !!saved?.configured_secrets?.includes(`account:${a.id}:${key}`) ||
    (a.id === "default" &&
      key === "api_key" &&
      !!saved?.configured_secrets?.includes("api_key"));
  const providerOptions = [
    ...new Set(
      [
        ...providers.map((p) => p.name),
        ...(refs.data?.providers || []).map((p) => p.name),
        values.provider,
      ].filter(Boolean),
    ),
  ];
  const catalog = [
    ...(detection?.models ?? []).map((m: any) => ({ candidate_id: 'detected:' + m.id, model: m.id, display_name: m.name || m.id, real_model: m.id, capability: values.protocol === 'images' ? 'image' : 'text', vendor: values.provider })),
    ...(refs.data?.bases || [])
      .filter((r) => r.status === "active" && !r.data._catalog_offline)
      .map((r) => ({
        candidate_id: r.id,
        model: r.data.canonical_key,
        base_model_id: r.id,
        display_name: r.name,
        real_model:
          r.data.default_real_model_name ||
          r.data.real_model ||
          r.data.canonical_key,
        capability: r.data.capability,
        vendor: r.data.vendor,
      })),
    ...(refs.data?.models || [])
      .filter((r) => r.status === "active" && !r.data.base_model_id)
      .map((r) => ({
        candidate_id: r.id,
        model: r.data.model_id,
        display_name: r.name,
        real_model: r.data.model_id,
        capability: r.data.capability,
        vendor: r.data.provider_id,
      })),
  ].filter(
    (r, i, a) =>
      r.model &&
      a.findIndex((s) => s.model === r.model) === i,
  );
  const shown = models.filter(
    (m) =>
      (filter !== "enabled" || m.enabled) &&
      (!capability || m.capability === capability) &&
      (!search ||
        `${m.model} ${m.display_name} ${m.real_model}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  function inheritedModelName(model: ModelConfig) {
    const base = refs.data?.bases.find((r) => r.id === model.base_model_id);
    return (
      base?.data.default_real_model_name || base?.data.real_model || model.model
    );
  }
  function changeProvider(provider: string) {
    set("provider", provider);
    const preset = providers.find((p) => p.name === provider);
    if (preset) {
      set("protocol", preset.protocol);
      set("native_protocols", preset.native_protocols);
      setVariables((v) =>
        v.map((x) => (x.name === "baseURL" ? { ...x, value: preset.url } : x)),
      );
    }
    if (!saved && (!name || providerOptions.includes(name))) setName(provider);
  }
  function collect(nextAccounts = accounts) {
    const data: Record<string, any> = {};
    for (const f of page.fields) {
      if (f.type === "secret") continue;
      data[f.key] = values[f.key] ?? f.default ?? null;
    }
    Object.assign(data, {
      provider: values.provider || "EasyAI",
      protocol: values.protocol || "openai",
      base_url:
        variables.find((v) => v.name === "baseURL")?.value || values.base_url,
      variables,
      accounts: nextAccounts,
      models: models.filter((m) => m.enabled).map((m) => m.model),
      model_settings: models,
      scripts,
      headers: saved?.data.headers ?? {},
        proxy: values.proxy_mode === 'custom' ? values.proxy_url : '',
      timeout_override:
        values.timeout_override === "" ? null : values.timeout_override,
    });
    return data;
  }
  async function persist(nextAccounts = accounts, close = true) {
    if (busy) return;
    setBusy(true);
    try {
      if (!name.trim()) throw new Error("请填写平台名称");
      const body = {
        name: name.trim(),
        status: enabled ? "active" : "disabled",
        data: collect(nextAccounts),
        ...(saved ? { expected_version: saved.version, expected_profiles: saved.data.expected_profiles } : { expected_profiles: {} }),
      };
      const row: DataRecord = saved
        ? await put(`/admin/records/platforms/${saved.id}`, body)
        : await post("/admin/records/platforms", body);
      setSaved(row);
      setAccounts(row.data.accounts.map((a: Account) => ({ ...a, auth: {} })));
      setVariables(row.data.variables);
      onDone();
      toast(close ? "平台已保存" : "账号已保存");
      if (close) onClose();
      else setAccountEdit(null);
      return row;
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function detect() {
    setBusy(true);
    try {
      const result = await post("/admin/platform-configuration/detect", {
        name,
        data: collect(),
        record_id: saved?.id,
        account_id: accountId,
        expected_version: saved?.version,
      });
      setDetection(result);
      toast(result.message);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function testScripts() {
    setBusy(true);
    setTestResult(null);
    try {
      const params = JSON.parse(testParams);
      if (!params || Array.isArray(params) || typeof params !== "object")
        throw new Error("测试参数须为 JSON 对象");
      const result = await post("/admin/platform-configuration/test-scripts", {
        name,
        data: collect(),
        record_id: saved?.id,
        expected_version: saved?.version,
        account_id: accountId,
        params,
        scene: testScene,
      });
      setTestResult(result);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function ruleSelect(
    key: string,
    rows: DataRecord[],
    value = values[key],
    onChange = (v: string) => set(key, v),
  ) {
    return (
      <select
        aria-label={key.includes("pricing") ? "定价规则" : "运行策略"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">跟随基础模型</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    );
  }
  function authFields(account: Account, onChange: (a: Account) => void) {
    return (
      <>
        <ConfigField
          title="账号名称"
          hint="用于日志、计费和故障定位；运行实例名称会生成为“平台名 / 账号名”。"
        >
          <input
            value={account.name}
            placeholder="例如：生产账号 A"
            onChange={(e) => onChange({ ...account, name: e.target.value })}
          />
        </ConfigField>
        {values.multi_account && (
          <ConfigField
            title="账号优先级"
            hint={`留空继承公共优先级（${values.priority}）；数值越小越优先，实际调度还受运行策略影响。`}
          >
            <input
              type="number"
              min="0"
              placeholder={`继承公共优先级（${values.priority}）`}
              value={account.priority ?? ""}
              onChange={(e) =>
                onChange({
                  ...account,
                  priority:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </ConfigField>
        )}
        <ConfigField
          title="授权方式"
          hint="选择上游 API 的鉴权结构，保存后会写入平台授权配置。"
        >
          <select
            value={account.auth_type}
            onChange={(e) =>
              onChange({ ...account, auth_type: e.target.value, auth: {} })
            }
          >
            {Object.entries(authTypes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </ConfigField>
        {account.auth_type === "header" && (
          <ConfigField title="Header 名称">
            <input
              value={account.header_name}
              onChange={(e) =>
                onChange({ ...account, header_name: e.target.value })
              }
            />
          </ConfigField>
        )}
        {(authKeys[account.auth_type] || []).map((key) => (
          <ConfigField
            key={key}
            title={authLabels[key]}
            hint={`用于 ${authTypes[account.auth_type]} 鉴权的平台密钥，会以授权信息保存。`}
          >
            <SecretInput
              label={authLabels[key]}
              value={account.auth[key] || ""}
              configured={configured(account, key)}
              onChange={(v) =>
                onChange({ ...account, auth: { ...account.auth, [key]: v } })
              }
            />
          </ConfigField>
        ))}
        <ConfigToggle
          title="人像资产能力"
          hint="开启后与本账号授权一一对应并原子保存。"
          value={account.portrait_enabled}
          onChange={(v) => onChange({ ...account, portrait_enabled: v })}
        />
      </>
    );
  }
  return (
    <PlatformLocalContext.Provider value={true}>
      <Modal
        className="platform-config-modal"
        icon={<Cloud size={20} />}
        title={saved ? "编辑平台接入" : "新增平台接入"}
        onClose={onClose}
        footer={
          <>
            <button className="button secondary" onClick={onClose}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => persist()}
            >
              {busy ? "保存中…" : "保存平台"}
            </button>
          </>
        }
      >
        <RefTabs tabs={tabs} value={tab} onChange={setTab} />
        <div className="local-platform-protocol parity-grid"><label className="local-label">客户端接入协议<select aria-label="客户端接入协议" value={values.protocol || 'openai'} onChange={e => set('protocol', e.target.value)}><option value="openai">OpenAI Chat Completions</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="images">OpenAI 图片生成</option></select></label></div>
        <p className="ref-data-note">名称、API 地址、API Key、模型启用状态和请求超时写入客户端。标为“尚未接入”的原平台配置只供查看。</p>
        <fieldset className="platform-tab local-preview-fields" role="tabpanel" aria-label={tab} disabled={['权限规则', '高级脚本开发'].includes(tab)}>
          {tab === "基本信息" && (
            <div className="parity-grid">
              <ConfigField
                title="模型厂商 / 接入渠道"
                hint="选择模型厂商及其原生接入渠道，用于带出连接配置、筛选基础模型和运行时分组。"
              >
                <select
                  value={values.provider || "EasyAI"}
                  onChange={(e) => changeProvider(e.target.value)}
                >
                  {providerOptions.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                {providers.find((p) => p.name === values.provider)
                  ?.compatible === false && (
                  <small className="ref-field-help">
                    此渠道的专用执行协议尚未接通；可先维护配置，真实接入需继续适配。
                  </small>
                )}
              </ConfigField>
              <ConfigField
                title="平台名称"
                hint="逻辑平台名称，由同组账号共享；账号区分名称请在“计费授权”中填写。"
              >
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </ConfigField>
              <ConfigField
                title="展示名"
                hint="前台或列表展示名称，留空时默认使用平台名称。"
              >
                <input
                  value={values.display_name}
                  placeholder="默认使用平台名称"
                  onChange={(e) => set("display_name", e.target.value)}
                />
              </ConfigField>
              <ConfigField
                title="备注"
                hint="用于记录账号、渠道、区域等运营备注。"
              >
                <input
                  value={values.remark}
                  placeholder="可留空"
                  onChange={(e) => set("remark", e.target.value)}
                />
              </ConfigField>
              <ConfigField
                title="文档链接"
                hint="平台接入文档、故障手册或供应商说明链接。"
              >
                <input
                  type="url"
                  value={values.documentation_url}
                  placeholder="https://"
                  onChange={(e) => set("documentation_url", e.target.value)}
                />
              </ConfigField>
              <ConfigField
                title="图标 URL"
                hint="用于管理列表和后续前台展示的平台图标。"
              >
                <input
                  type="url"
                  value={values.icon_url}
                  placeholder="https://"
                  onChange={(e) => set("icon_url", e.target.value)}
                />
              </ConfigField>
              <ConfigField
                title="优先级"
                hint="保存平台后，未单独设置优先级的账号会同步使用此值；数值越小越优先。"
              >
                <input
                  type="number"
                  min="0"
                  value={values.priority}
                  onChange={(e) => set("priority", Number(e.target.value))}
                />
              </ConfigField>
              <ConfigToggle
                title="启用平台"
                hint="关闭后运行时不会再选择该平台，已保存的配置会保留。"
                value={enabled}
                onChange={setEnabled}
              />
              <ConfigField
                full
                title="原生 API 协议"
                hint="运行时只会将请求调度到原生支持对应协议的平台。旧平台可留空并继续使用兼容推断。"
              >
                <div className="parity-protocol-picker">
                  {(values.native_protocols || []).map((key: string) => (
                    <span key={key}>
                      {(
                        {
                          anthropic_messages: "Anthropic Messages",
                          openai_responses: "OpenAI Responses",
                          openai_chat_completions: "OpenAI Chat Completions",
                          xai: "xAI 官方",
                        } as Record<string, string>
                      )[key] || key}
                      <DeleteButton
                        aria-label={"移除协议 " + key}
                        onClick={() =>
                          set(
                            "native_protocols",
                            values.native_protocols.filter(
                              (x: string) => x !== key,
                            ),
                          )
                        }
                      />
                    </span>
                  ))}
                  <select
                    aria-label="添加原生 API 协议"
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      set("native_protocols", [
                        ...(values.native_protocols || []),
                        e.target.value,
                      ])
                    }
                  >
                    <option value="">旧平台留空时使用兼容推断</option>
                    {[
                      ["anthropic_messages", "Anthropic Messages"],
                      ["openai_responses", "OpenAI Responses"],
                      ["openai_chat_completions", "OpenAI Chat Completions"],
                      ["xai", "xAI 官方"],
                    ].map(([key, label]) => (
                      <option
                        key={key}
                        value={key}
                        disabled={(values.native_protocols || []).includes(key)}
                      >
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </ConfigField>
              <section className="parity-section full">
                <h3>变量</h3>
                <p>
                  平台基础连接变量，沿用旧平台环境变量模式保存，执行链路和脚本上下文会同步读取。
                </p>
                <div className="parity-variable-table">
                  <div className="parity-variable-head">
                    <span>变量名</span>
                    <span>变量值</span>
                    <span>密钥</span>
                    <span>用途</span>
                    <span>操作</span>
                  </div>
                  {variables.map((v, i) => (
                    <div className="parity-variable-row" key={i}>
                      <input
                        aria-label={`变量名 ${i + 1}`}
                        disabled={v.name === "baseURL"}
                        value={v.name}
                        placeholder="变量名"
                        onChange={(e) =>
                          setVariables((all) =>
                            all.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <input
                        type={v.secret ? "password" : "text"}
                        aria-label={`变量值 ${i + 1}`}
                        placeholder={
                          v.secret &&
                          saved?.configured_secrets?.includes(
                            `variable:${v.name}`,
                          )
                            ? "已配置，留空保留"
                            : v.name === "baseURL"
                              ? "https://api.example.com/v1"
                              : "变量值"
                        }
                        value={v.value}
                        onChange={(e) =>
                          setVariables((all) =>
                            all.map((x, j) =>
                              j === i ? { ...x, value: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="parity-secret-toggle"
                        disabled={v.name === "baseURL"}
                        onClick={() =>
                          setVariables((all) =>
                            all.map((x, j) =>
                              j === i ? { ...x, secret: !x.secret } : x,
                            ),
                          )
                        }
                      >
                        {v.secret ? (
                          <LockKeyhole size={14} />
                        ) : (
                          <Unlock size={14} />
                        )}{" "}
                        {v.secret ? "密钥" : "普通"}
                      </button>
                      {v.name === "baseURL" ? (
                        <small>{v.usage}</small>
                      ) : (
                        <input
                          aria-label={`变量用途 ${i + 1}`}
                          value={v.usage}
                          placeholder="用途说明"
                          onChange={(e) =>
                            setVariables((all) =>
                              all.map((x, j) =>
                                j === i ? { ...x, usage: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      )}
                      <div className="parity-row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="插入变量" disabled title="自定义变量尚未接入"
                          onClick={() =>
                            setVariables((all) => [
                              ...all.slice(0, i + 1),
                              { name: "", value: "", secret: false, usage: "" },
                              ...all.slice(i + 1),
                            ])
                          }
                        >
                          <Plus size={15} />
                        </button>
                        <DeleteButton
                          className="icon-button"
                          aria-label={`删除变量 ${v.name || i + 1}`}
                          disabled={v.name === "baseURL"}
                          onClick={() =>
                            setVariables((all) => all.filter((_, j) => j !== i))
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="parity-add-row" disabled title="自定义变量尚未接入"
                  onClick={() =>
                    setVariables((all) => [
                      ...all,
                      { name: "", value: "", secret: false, usage: "" },
                    ])
                  }
                >
                  <Plus size={14} />
                  添加变量
                </button>
              </section>
            </div>
          )}
          {tab === "计费授权" && (
            <div className="parity-stack">
              <section className="parity-section">
                <h3>计费配置</h3>
                <p>
                  {values.multi_account
                    ? "以下计费设置由所有账号共享。"
                    : "设置本平台的折扣和定价规则。"}
                </p>
                <div className="parity-grid">
                  <ConfigField
                    title="平台折扣"
                    hint="平台级计费倍率，会和模型折扣、定价规则共同参与费用估算。"
                  >
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={values.discount}
                      onChange={(e) => set("discount", Number(e.target.value))}
                    />
                  </ConfigField>
                  <ConfigField
                    title="定价规则"
                    hint="绑定平台级定价规则；留空时继承基础模型的定价配置。"
                  >
                    {ruleSelect("pricing_id", refs.data?.prices || [])}
                  </ConfigField>
                </div>
              </section>
              <section className="parity-section">
                <header>
                  <div>
                    <h3>{values.multi_account ? "多账号授权" : "账号授权"}</h3>
                    <p>
                      {values.multi_account
                        ? "每个账号独立配置密钥，可单独启停；点击卡片编辑并保存账号。"
                        : "填写一个账号的授权信息，完成后点击底部“保存平台”。需要接入多个账号时，可开启右侧开关。"}
                    </p>
                  </div>
                  <label className="parity-switch">
                    多账号
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="多账号模式"
                      disabled title="多账号调度尚未接入" checked={!!values.multi_account}
                      onChange={(e) => {
                        if (!e.target.checked && accounts.length > 1) {
                          toast("请先移除多余账号，再关闭多账号模式", true);
                          return;
                        }
                        set("multi_account", e.target.checked);
                      }}
                    />
                  </label>
                </header>
                <div className="parity-notice">
                  {values.multi_account
                    ? saved
                      ? "账号配置独立保存，公共配置使用底部“保存平台”。"
                      : "首次保存账号时会同时创建平台，之后可继续添加更多账号。"
                    : "当前为单账号模式，无需额外管理账号卡片。"}
                </div>
                {health.data?.items
                  .filter((a: any) => !a.available)
                  .map((a: any) => (
                    <div className="parity-notice" key={a.id}>
                      <span>
                        {accounts.find((x) => x.id === a.id)?.name}：{a.reason}
                      </span>{" "}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => restoreAccount(a)}
                      >
                        恢复账号
                      </button>
                    </div>
                  ))}
                {values.multi_account ? (
                  <>
                    <div className="parity-section-heading">
                      <div>
                        <h3>账号管理</h3>
                        <p>点击编辑，配置账号授权与独立运行信息</p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() =>
                          setAccountEdit(
                              newAccount(`账号 ${accounts.length + 1}`),
                          )
                        }
                          disabled title="本机每个平台使用一个 API Key；多个账号请创建独立平台"
                      >
                        <Plus size={14} />
                        添加账号
                      </button>
                    </div>
                    <div className="parity-account-grid">
                      {accounts.map((a) => (
                        <article className="parity-account-card" key={a.id}>
                          <header>
                            <strong>{a.name}</strong>
                            <label>
                              <input
                                aria-label={`启用账号 ${a.name}`}
                                type="checkbox"
                                checked={a.enabled}
                                onChange={(e) =>
                                  setAccounts((all) =>
                                    all.map((x) =>
                                      x.id === a.id
                                        ? { ...x, enabled: e.target.checked }
                                        : x,
                                    ),
                                  )
                                }
                              />
                              启用
                            </label>
                          </header>
                          <p>
                            {saved
                              ? `${authTypes[a.auth_type]} · 优先级 ${a.priority ?? values.priority}`
                              : "填写授权信息后点击“保存账号”"}
                          </p>
                          <footer>
                            <span className="muted">
                              {saved?.data.accounts?.some(
                                (x: Account) => x.id === a.id,
                              )
                                ? "已保存"
                                : "未保存"}
                            </span>
                            <button
                              className="link-button"
                              onClick={() => setAccountEdit(structuredClone(a))}
                            >
                              配置账号
                            </button>
                            <DeleteButton
                              className="icon-button"
                              aria-label={`删除账号 ${a.name}`}
                              disabled={accounts.length === 1}
                              onClick={() =>
                                setAccounts((all) =>
                                  all.filter((x) => x.id !== a.id),
                                )
                              }
                            />
                          </footer>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="parity-grid">
                    {authFields(accounts[0], (a) => setAccounts([a]))}
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === "权限规则" && (
            <div className="parity-grid">
              <ConfigField
                title="最小权限等级"
                hint="写入统一 access rules；不配置专属组织时会生成全局等级规则。"
              >
                <input
                  type="number"
                  min="0"
                  value={values.min_level}
                  onChange={(e) => set("min_level", Number(e.target.value))}
                />
              </ConfigField>
              <div />
              <ConfigField
                title="专属组织"
                hint="选择后会生成 allow 规则；用户命中任一组织且满足等级才可使用该平台。"
              >
                <TagInput
                  label="专属组织"
                  value={values.allowed_organizations || []}
                  onChange={(v) => set("allowed_organizations", v)}
                  placeholder="不限制组织"
                />
              </ConfigField>
              <ConfigField
                title="排除组织"
                hint="选择后会生成 deny 规则；命中排除组织时优先拒绝。"
              >
                <TagInput
                  label="排除组织"
                  value={values.denied_organizations || []}
                  onChange={(v) => set("denied_organizations", v)}
                  placeholder="不排除任何组织"
                />
              </ConfigField>
            </div>
          )}
          {tab === "模型" && (
            <div className="parity-stack">
              <div className="parity-model-toolbar">
                <Search size={16} />
                <input
                  aria-label="搜索模型"
                  placeholder="搜索模型 / 真实名 / 厂商"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span>筛选</span>
                <select
                  aria-label="模型状态筛选"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="enabled">已启用</option>
                  <option value="all">全部模型</option>
                </select>
                <select
                  aria-label="模型能力筛选"
                  value={capability}
                  onChange={(e) => setCapability(e.target.value)}
                >
                  <option value="">全部能力</option>
                  {Object.entries(capabilities).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <section className="parity-section parity-section-heading">
                <div>
                  <h3>账号模型检测</h3>
                  <p>{detection?.message || "尚未检测当前账号"}</p>
                  {detection && (
                    <small>
                      {detection.environment === "sandbox"
                        ? "沙箱结果"
                        : "上游检测结果"}{" "}
                      · {detection.models?.length || 0} 个模型
                    </small>
                  )}
                </div>
                <div className="ref-actions">
                  {values.multi_account && (
                    <select
                      aria-label="检测账号"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={detect}
                  >
                    检测所选账号
                  </button>
                </div>
              </section>
              <div className="local-manual-model"><input aria-label="手动模型 ID" placeholder="输入实际模型 ID" value={manualModel} onChange={e => setManualModel(e.target.value)} /><button className="button secondary" disabled={!manualModel.trim()} onClick={() => { const id = manualModel.trim(); setModels(all => all.some(m => m.model === id) ? all.map(m => m.model === id ? { ...m, enabled: true } : m) : [...all, modelConfig(id)]); setManualModel(''); }}>添加模型 ID</button></div>
              <div className="parity-section-heading">
                <strong>
                  {models.filter((m) => m.enabled).length} / {catalog.length}{" "}
                  个基础模型
                </strong>
                <div className="ref-actions">
                  <button
                    className="button primary"
                    onClick={() => setModelPicker(true)}
                  >
                    <Plus size={14} />
                    添加模型
                  </button>
                  <button
                    className="button secondary"
                    disabled={!selected.length}
                    onClick={() =>
                      setModels((all) =>
                        all.map((m) =>
                          selected.includes(m.model)
                            ? { ...m, enabled: true }
                            : m,
                        ),
                      )
                    }
                  >
                    添加所选（{selected.length}个）
                  </button>
                  <DeleteButton
                    className="button secondary"
                    disabled={!selected.length}
                    onClick={() => {
                      setModels((all) =>
                        all.filter((m) => !selected.includes(m.model)),
                      );
                      setSelected([]);
                    }}
                  >
                    移除所选（{selected.length}个）
                  </DeleteButton>
                </div>
              </div>
              <div className="ref-actions">
                <button
                  className="link-button"
                  onClick={() => setSelected(shown.map((m) => m.model))}
                >
                  全选
                </button>
                <button className="link-button" onClick={() => setSelected([])}>
                  清空
                </button>
              </div>
              {shown.length ? (
                <div className="parity-model-grid">
                  {shown.map((m) => (
                    <article key={m.model} className="parity-model-card">
                      <header>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`选择模型 ${m.model}`}
                            checked={selected.includes(m.model)}
                            onChange={(e) =>
                              setSelected((all) =>
                                e.target.checked
                                  ? [...all, m.model]
                                  : all.filter((x) => x !== m.model),
                              )
                            }
                          />
                          <strong>{m.display_name || m.model}</strong>
                        </label>
                        <button
                          className="icon-button"
                          aria-label={`配置模型 ${m.model}`}
                          onClick={() => setModelEdit({ ...m })}
                        >
                          <Settings2 size={16} />
                        </button>
                      </header>
                      <code>{m.real_model || inheritedModelName(m)}</code>
                      <footer>
                        <span>{capabilities[m.capability || "text"]}</span>
                        <label>
                          <input
                            type="checkbox"
                            checked={m.enabled}
                            onChange={(e) =>
                              setModels((all) =>
                                all.map((x) =>
                                  x.model === m.model
                                    ? { ...x, enabled: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                          启用
                        </label>
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <RefEmpty text="没有匹配的模型" />
              )}
            </div>
          )}
          {tab === "平台配置" && (
            <div className="parity-grid">
              <ConfigField
                title="运行策略"
                hint="绑定后，RPM / TPM / 并发按平台共享池控制；留空时跟随基础模型和模型设置。"
              >
                {ruleSelect("runtime_policy_id", refs.data?.policies || [])}
              </ConfigField>
              <ConfigField
                title="运行超时覆盖（秒）"
                hint="留空时使用运行策略里的超时；填写后该平台的上游请求会按这里终止。"
              >
                <input
                  type="number"
                  min="1"
                  max="600"
                  placeholder="跟随运行策略"
                  value={values.timeout_override ?? ""}
                  onChange={(e) =>
                    set(
                      "timeout_override",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </ConfigField>
              <ConfigField
                title="代理模式"
                hint="控制该平台请求是否走代理：不使用、使用服务端全局代理，或仅当前平台使用自定义代理。"
              >
                <select
                  value={values.proxy_mode}
                  onChange={(e) => set("proxy_mode", e.target.value)}
                >
                  <option value="none">不使用代理</option>
                  <option value="global" disabled>使用服务端全局代理</option>
                  <option value="custom">自定义代理</option>
                </select>
              </ConfigField>
              {values.proxy_mode === "custom" && (
                <ConfigField title="代理地址">
                  <input
                    value={values.proxy_url}
                    placeholder="http://proxy.example.com:8080"
                    onChange={(e) => set("proxy_url", e.target.value)}
                  />
                </ConfigField>
              )}
              <ConfigToggle
                title="支持 Base64 输入"
                hint="平台接受 base64 媒体输入时开启；关闭后执行侧会尽量避免把媒体转成 base64。"
                value={!!values.support_base64}
                onChange={(v) => set("support_base64", v)}
              />
              <ConfigToggle
                title="支持 URL 输入"
                hint="平台接受公网 URL 输入时开启，可减少服务端转码和内存占用。"
                value={!!values.support_url}
                onChange={(v) => set("support_url", v)}
              />
              <ConfigToggle
                title="测试模式"
                hint="启用后使用沙箱执行；关闭后按本实例的外部调用设置使用真实平台。"
                value={values.mode !== "live"}
                onChange={(v) => set("mode", v ? "sandbox" : "live")}
              />
              <ConfigToggle
                title="跳过参数归一化"
                hint="开启后跳过尺寸、比例、分辨率等标准化处理，适合完全自定义参数格式的平台。"
                value={!!values.skip_normalization}
                onChange={(v) => set("skip_normalization", v)}
              />
            </div>
          )}
          {tab === "高级脚本开发" && (
            <div className="parity-stack">
              <p className="ref-notice">
                按预处理、构建参数、提交、轮询顺序执行。测试模式可查看转换后的参数，正式调用使用当前账号授权。
              </p>
              <div className="ref-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setTestResult(null);
                    setScriptTest(true);
                  }}
                >
                  测试参数脚本
                </button>
              </div>
              <section className="parity-section">
                <h3>
                  自定义预处理脚本{" "}
                  <small>{scripts.preprocess ? "已配置" : "未配置"}</small>
                </h3>
                <p>
                  在内置参数归一化之后、提交任务之前执行，用于补齐字段、清洗参数或适配特殊平台格式。
                </p>
                <div className="ref-actions">
                  <button
                    className="button secondary"
                    onClick={() => setScriptEdit("preprocess")}
                  >
                    {scripts.preprocess ? "编辑脚本" : "添加脚本"}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setScriptEdit("ai:preprocess")}
                  >
                    AI 帮写
                  </button>
                  <DeleteButton
                    className="button secondary"
                    disabled={!scripts.preprocess}
                    onClick={() =>
                      setScripts((s) => ({ ...s, preprocess: "" }))
                    }
                  >
                    清空
                  </DeleteButton>
                </div>
              </section>
              <section className="parity-section">
                <h3>
                  自定义脚本 <small>getParams / submit / poll</small>
                </h3>
                <p>
                  统一维护构建生成参数、提交生成任务、轮询任务结果三个步骤，支持按场景配置，未命中时回退
                  common。
                </p>
                <div className="parity-script-summary">
                  {[
                    ["getParams", "构建生成参数"],
                    ["submit", "提交生成任务"],
                    ["poll", "轮询任务结果"],
                  ].map(([k, v]) => (
                    <span key={k}>
                      {v}：
                      {Object.values(scripts[k] || {}).some(Boolean)
                        ? "已配置"
                        : "未配置"}
                    </span>
                  ))}
                </div>
                <div className="ref-actions">
                  {[
                    ["getParams", "构建生成参数"],
                    ["submit", "提交生成任务"],
                    ["poll", "轮询任务结果"],
                  ].map(([k, v]) => (
                    <button
                      className="button secondary"
                      key={k}
                      onClick={() => setScriptEdit(k)}
                    >
                      {v}
                    </button>
                  ))}
                  <DeleteButton
                    className="button secondary"
                    disabled={
                      !["getParams", "submit", "poll"].some((k) =>
                        Object.values(scripts[k] || {}).some(Boolean),
                      )
                    }
                    onClick={() =>
                      setScripts((s) => ({ preprocess: s.preprocess || "" }))
                    }
                  >
                    清空
                  </DeleteButton>
                </div>
              </section>
            </div>
          )}
        </fieldset>
      </Modal>
      {scriptTest && (
        <Modal
          title="测试参数脚本"
          wide
          onClose={() => setScriptTest(false)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setScriptTest(false)}
              >
                关闭
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={testScripts}
              >
                {busy ? "执行中…" : "执行测试"}
              </button>
            </>
          }
        >
          <p className="ref-notice">
            执行当前表单中的预处理与构建参数脚本，显示转换结果。此测试不提交上游任务。
          </p>
          <ConfigField title="测试场景">
            <select
              value={testScene}
              onChange={(e) => setTestScene(e.target.value)}
            >
              {SCRIPT_SCENES.filter((s) => s !== "common").map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </ConfigField>
          <ConfigField title="输入参数（JSON）">
            <textarea
              rows={9}
              spellCheck={false}
              value={testParams}
              onChange={(e) => setTestParams(e.target.value)}
            />
          </ConfigField>
          {testResult && (
            <ConfigField title="转换结果">
              <textarea
                readOnly
                rows={9}
                value={JSON.stringify(testResult.providerPayload, null, 2)}
              />
              <small>{testResult.message}</small>
            </ConfigField>
          )}
        </Modal>
      )}
      {accountEdit && (
        <Modal
          className="platform-account-modal"
          title={
            saved?.data.accounts?.some((a: Account) => a.id === accountEdit.id)
              ? "编辑账号"
              : "配置新账号"
          }
          onClose={() => setAccountEdit(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setAccountEdit(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  persist(
                    accounts.some((a) => a.id === accountEdit.id)
                      ? accounts.map((a) =>
                          a.id === accountEdit.id ? accountEdit : a,
                        )
                      : [...accounts, accountEdit],
                    false,
                  )
                }
              >
                保存账号
              </button>
            </>
          }
        >
          <section className="parity-account-banner">
            <Cloud size={20} />
            <div>
              <strong>账号 · {accountEdit.name}</strong>
              <p>账号信息、授权和人像资产能力均独立保存。</p>
            </div>
          </section>
          <div className="parity-grid">
            {authFields(accountEdit, setAccountEdit)}
          </div>
        </Modal>
      )}
      {modelPicker && (
        <ModelPicker
          catalog={catalog}
          existing={models.map((m) => m.model)}
          onClose={() => setModelPicker(false)}
          onAdd={(items) => {
            setModels((all) => [
              ...all,
              ...items.map((i) => ({
                ...modelConfig(i.model),
                base_model_id: i.base_model_id,
                display_name: i.display_name,
                real_model: i.base_model_id ? "" : i.real_model,
                capability: i.capability,
              })),
            ]);
            setModelPicker(false);
          }}
        />
      )}
      {modelEdit && (
        <Modal
          title="模型设置"
          wide
          onClose={() => setModelEdit(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setModelEdit(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setModels((all) =>
                    all.map((m) =>
                      m.model === modelEdit.model ? modelEdit : m,
                    ),
                  );
                  setModelEdit(null);
                }}
              >
                保存
              </button>
            </>
          }
        >
          <div className="parity-grid">
            <ConfigField title="展示名">
              <input
                value={modelEdit.display_name}
                onChange={(e) =>
                  setModelEdit({ ...modelEdit, display_name: e.target.value })
                }
              />
            </ConfigField>
            <ConfigField
              title="真实模型名"
              hint={
                modelEdit.base_model_id
                  ? "留空时实时跟随基础模型的默认值"
                  : undefined
              }
            >
              <input
                value={modelEdit.real_model}
                placeholder={inheritedModelName(modelEdit)}
                onChange={(e) =>
                  setModelEdit({ ...modelEdit, real_model: e.target.value })
                }
              />
            </ConfigField>
            <ConfigField title="模型折扣">
              <input
                type="number"
                min="0"
                step="0.01"
                value={modelEdit.discount}
                onChange={(e) =>
                  setModelEdit({
                    ...modelEdit,
                    discount: Number(e.target.value),
                  })
                }
              />
            </ConfigField>
            <ConfigField title="定价规则">
              {ruleSelect(
                "pricing_id",
                refs.data?.prices || [],
                modelEdit.pricing_id,
                (v) => setModelEdit({ ...modelEdit, pricing_id: v }),
              )}
            </ConfigField>
            <ConfigField title="运行策略">
              {ruleSelect(
                "runtime_policy_id",
                refs.data?.policies || [],
                modelEdit.runtime_policy_id,
                (v) => setModelEdit({ ...modelEdit, runtime_policy_id: v }),
              )}
            </ConfigField>
          </div>
        </Modal>
      )}
      {scriptEdit && (
        <PlatformScriptEditor
          stage={scriptEdit}
          value={scripts[scriptEdit.replace("ai:", "")]}
          onClose={() => setScriptEdit(null)}
          onSave={(v) => {
            setScripts((s) => ({ ...s, [scriptEdit.replace("ai:", "")]: v }));
            setScriptEdit(null);
          }}
        />
      )}
    </PlatformLocalContext.Provider>
  );
}

function ModelPicker({
  catalog,
  existing,
  onClose,
  onAdd,
}: {
  catalog: any[];
  existing: string[];
  onClose: () => void;
  onAdd: (items: any[]) => void;
}) {
  const [query, setQuery] = useState(""),
    [vendor, setVendor] = useState(""),
    [capability, setCapability] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const shown = catalog.filter(
    (m) =>
      (!vendor || m.vendor === vendor) &&
      (!capability || m.capability === capability) &&
      `${m.model} ${m.display_name} ${m.real_model || ""} ${m.vendor || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const available = shown.filter((m) => !existing.includes(m.model));
  return (
    <Modal
      className="platform-model-picker"
      title="添加模型"
      onClose={onClose}
      footer={
        <>
          <span className="parity-footer-count">
            搜索命中 {shown.length} 个，可添加 {available.length} 个，待添加{" "}
            {selected.length} 个
          </span>
          <button
            className="button secondary"
            onClick={() =>
              setSelected(
                available
                  .filter(
                    (m, i, all) =>
                      all.findIndex((x) => x.model === m.model) === i,
                  )
                  .map((m) => m.candidate_id),
              )
            }
          >
            全选搜索结果
          </button>
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={!selected.length}
            onClick={() =>
              onAdd(catalog.filter((m) => selected.includes(m.candidate_id)))
            }
          >
            添加选中
          </button>
        </>
      }
    >
      <div className="parity-model-toolbar">
        <input
          aria-label="搜索待添加模型"
          placeholder="搜索模型 / 真实名 / 厂商"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="模型厂商筛选"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        >
          <option value="">全部厂商</option>
          {[...new Set(catalog.map((m) => m.vendor).filter(Boolean))].map(
            (v) => (
              <option key={v}>{v}</option>
            ),
          )}
        </select>
        <select
          aria-label="待添加模型能力"
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
        >
          <option value="">全部能力</option>
          {Object.entries(capabilities).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="parity-model-grid">
        {shown.map((m) => (
          <label
            className={`parity-model-card ${selected.includes(m.candidate_id) ? "selected" : ""}`}
            key={m.candidate_id}
          >
            <header>
              <input
                type="checkbox"
                disabled={existing.includes(m.model)}
                checked={
                  selected.includes(m.candidate_id) ||
                  existing.includes(m.model)
                }
                onChange={(e) =>
                  setSelected((all) =>
                    e.target.checked
                      ? [
                          ...all.filter(
                            (id) =>
                              !catalog.some(
                                (x) =>
                                  x.candidate_id === id && x.model === m.model,
                              ),
                          ),
                          m.candidate_id,
                        ]
                      : all.filter((x) => x !== m.candidate_id),
                  )
                }
              />
              <strong>{m.display_name}</strong>
            </header>
            <code>{m.model}</code>
            <p>{m.vendor || "—"}</p>
            <span className="parity-chip">
              {capabilities[m.capability] || m.capability}
            </span>
            <small>{m.real_model}</small>
          </label>
        ))}
      </div>
      {!shown.length && (
        <RefEmpty text="没有匹配的基础模型，请先在基础模型中添加" />
      )}
    </Modal>
  );
}

const SCRIPT_SCENES = [
  "common",
  "text_generate",
  "image_generate",
  "video_generate",
  "text_to_speech",
  "speech_to_text",
  "music_generate",
  "text_embedding",
  "text_rerank",
];

function PlatformScriptEditor({
  stage,
  value,
  onClose,
  onSave,
}: {
  stage: string;
  value: any;
  onClose: () => void;
  onSave: (v: any) => void;
}) {
  const ai = stage.startsWith("ai:"),
    key = stage.replace("ai:", "");
  const [scene, setScene] = useState("common"),
    [code, setCode] = useState(
      key === "preprocess" ? value || "" : value?.common || "",
    ),
    [scenes, setScenes] = useState<Record<string, string>>(
      key === "preprocess" ? {} : value || {},
    ),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  const toast = useToast();
  const title =
    key === "preprocess"
      ? "编辑自定义预处理脚本"
      : (
          {
            getParams: "构建生成参数",
            submit: "提交生成任务",
            poll: "轮询任务结果",
          } as Record<string, string>
        )[key];
  async function help() {
    setBusy(true);
    try {
      const r = await post("/admin/platform-configuration/script-assist", {
        stage: key,
        prompt,
        code,
      });
      setCode(r.code);
      setResult(r.message);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      className="platform-script-modal"
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            onClick={() =>
              onSave(key === "preprocess" ? code : { ...scenes, [scene]: code })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="parity-script-toolbar">
        {key !== "preprocess" && (
          <select
            aria-label="脚本场景"
            value={scene}
            onChange={(e) => {
              setScenes((s) => ({ ...s, [scene]: code }));
              setScene(e.target.value);
              setCode(scenes[e.target.value] || "");
            }}
          >
            {[...new Set([...SCRIPT_SCENES, ...Object.keys(scenes)])].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        )}
        <span>JavaScript</span>
      </div>
      <div className="parity-code-editor">
        <pre aria-hidden="true">
          {code
            .split("\n")
            .map((_: string, i: number) => i + 1)
            .join("\n")}
        </pre>
        <textarea
          spellCheck={false}
          aria-label="脚本代码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={
            key === "preprocess"
              ? "async function (params, type, context) {\n  return params;\n}"
              : "async function (params, context) {\n  return params;\n}"
          }
        />
      </div>
      {ai && (
        <div className="parity-script-assist">
          <textarea
            aria-label="脚本需求"
            placeholder="描述需要完成的参数转换或平台协议…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            className="button secondary"
            disabled={busy || !prompt.trim()}
            onClick={help}
          >
            {busy ? "生成中…" : "AI 帮写"}
          </button>
          {result && <p>{result}</p>}
        </div>
      )}
    </Modal>
  );
}
