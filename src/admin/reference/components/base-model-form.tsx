"use client";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Box } from "lucide-react";
import catalog from "@reference/lib/model-capability-fields.json";
import { recordCollection } from "@reference/lib/api";
import { Modal, RefTabs } from "./reference-ui";
import { ConfigField, TagInput } from "./platform-form";
import { DeleteButton } from "./interaction/delete-button";
import { useResourceDraft, type FormProps } from "./reference-detail-forms";

type FieldSpec = {
  key: string;
  label: string;
  hint: string;
  kind: string;
  default: any;
  options?: string[];
  parts?: number;
  placeholders?: string[];
  placeholder?: string | null;
  conditional?: boolean;
};
type Ability = { key: string; name: string; fields: FieldSpec[] };
export const modelAbilities: Ability[] = catalog;
const compatibility: Record<string, string> = {
  text_generate: "text",
  text_embedding: "embedding",
  text_rerank: "rerank",
  image_generate: "image",
  image_edit: "image",
  video_generate: "video",
  image_to_video: "video",
  text_to_speech: "audio",
  audio_generate: "audio",
};
const legacy: Record<string, string> = {
  text: "text_generate",
  embedding: "text_embedding",
  rerank: "text_rerank",
  image: "image_generate",
  video: "video_generate",
  audio: "audio_generate",
};
function JSONValue({
  value,
  onChange,
  onError,
  label,
  placeholder,
}: {
  value: any;
  onChange: (x: any) => void;
  onError: (x: string) => void;
  label: string;
  placeholder?: string | null;
}) {
  const [text, setText] = useState(
    value == null ? "" : JSON.stringify(value, null, 2),
  );
  return (
    <textarea
      rows={4}
      aria-label={label}
      className="parity-json-value"
      placeholder={placeholder || "{ }"}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(e.target.value.trim() ? JSON.parse(e.target.value) : null);
          onError("");
        } catch {
          onError(label + " 不是有效的 JSON");
        }
      }}
    />
  );
}
function ValueControl({
  field,
  value,
  onChange,
  onError,
}: {
  field: FieldSpec;
  value: any;
  onChange: (x: any) => void;
  onError: (x: string) => void;
}) {
  const f = field;
  if (f.kind === "derived")
    return <span className="capability-derived">已支持</span>;
  if (f.kind === "boolean")
    return (
      <select
        aria-label={f.label}
        value={value == null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "true")
        }
      >
        <option value="">未设置（使用默认行为）</option>
        <option value="true">支持</option>
        <option value="false">不支持</option>
      </select>
    );
  if (f.kind === "choices" || f.kind === "tags") {
    const selected = Array.isArray(value)
      ? value.map(String)
      : value
        ? [String(value)]
        : [];
    return (
      <div className="capability-choice-field">
        {f.kind === "choices" && (
          <div className="capability-choices">
            {(f.options || []).map((opt) => (
              <label key={opt}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, opt]
                        : selected.filter((x) => x !== opt),
                    )
                  }
                />
                {opt}
              </label>
            ))}
          </div>
        )}
        <TagInput
          label={f.label + " 自定义值"}
          value={selected.filter((x) => !(f.options || []).includes(x))}
          onChange={(custom) =>
            onChange([
              ...selected.filter((x) => (f.options || []).includes(x)),
              ...custom,
            ])
          }
          placeholder={f.placeholder || "自定义，逗号分隔"}
        />
      </div>
    );
  }
  if (f.kind === "range")
    return (
      <div className="capability-range">
        {Array.from({ length: f.parts || 2 }, (_, i) => (
          <input
            key={i}
            aria-label={`${f.label} ${f.parts === 4 ? ["最小宽度", "最大宽度", "最小高度", "最大高度"][i] : ["最小值", "最大值"][i]}`}
            type="number"
            min={0}
            placeholder={f.placeholders?.[i] || ["最小值", "最大值"][i % 2]}
            value={Array.isArray(value) ? (value[i] ?? "") : ""}
            onChange={(e) => {
              const list = Array.from({ length: f.parts || 2 }, (_, n) =>
                Array.isArray(value) ? (value[n] ?? null) : null,
              );
              list[i] = e.target.value === "" ? null : Number(e.target.value);
              onChange(list);
            }}
          />
        ))}
      </div>
    );
  if (f.kind === "number" || f.kind === "text")
    return (
      <input
        type={f.kind === "number" ? "number" : "text"}
        min={f.kind === "number" ? 0 : undefined}
        step={f.kind === "number" ? "any" : undefined}
        aria-label={f.label}
        placeholder={f.placeholder || ""}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            f.kind === "number"
              ? e.target.value === ""
                ? null
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );
  return (
    <JSONValue
      value={value}
      onChange={onChange}
      onError={onError}
      label={f.label}
      placeholder={f.placeholder}
    />
  );
}
function CapabilityField({
  field,
  value,
  onChange,
  onError,
}: {
  field: FieldSpec;
  value: any;
  onChange: (x: any) => void;
  onError: (x: string) => void;
}) {
  const grouped =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.mode === "conditions";
  return (
    <div className="capability-field">
      <div className="capability-field-label">
        <strong>{field.label}</strong>
        <small>{field.hint}</small>
      </div>
      <div className="capability-field-control">
        {field.conditional && (
          <div className="capability-mode">
            <button
              type="button"
              className={!grouped ? "active" : ""}
              onClick={() => onChange(field.default)}
            >
              统一配置
            </button>
            <button
              type="button"
              className={grouped ? "active" : ""}
              onClick={() =>
                onChange({
                  mode: "conditions",
                  groups: grouped
                    ? value.groups
                    : [{ when: "", value: field.default }],
                })
              }
            >
              条件分组
            </button>
          </div>
        )}
        {grouped ? (
          <div className="capability-condition-list">
            {value.groups.map((g: any, i: number) => (
              <div key={i}>
                <input
                  aria-label={`${field.label} 条件 ${i + 1}`}
                  placeholder="条件，例如 resolution=1080p"
                  value={g.when}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      groups: value.groups.map((x: any, n: number) =>
                        n === i ? { ...x, when: e.target.value } : x,
                      ),
                    })
                  }
                />
                <ValueControl
                  field={field}
                  value={g.value}
                  onError={onError}
                  onChange={(v) =>
                    onChange({
                      ...value,
                      groups: value.groups.map((x: any, n: number) =>
                        n === i ? { ...x, value: v } : x,
                      ),
                    })
                  }
                />
                <DeleteButton
                  aria-label={`删除 ${field.label} 条件 ${i + 1}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      groups: value.groups.filter(
                        (_: any, n: number) => n !== i,
                      ),
                    })
                  }
                >
                  删除分组
                </DeleteButton>
              </div>
            ))}
            <button
              className="button secondary"
              onClick={() =>
                onChange({
                  ...value,
                  groups: [...value.groups, { when: "", value: field.default }],
                })
              }
            >
              <Plus size={13} />
              添加条件
            </button>
          </div>
        ) : (
          <ValueControl
            field={field}
            value={value}
            onChange={onChange}
            onError={onError}
          />
        )}
      </div>
    </div>
  );
}
export function BaseModelForm(props: FormProps) {
  const { record, onClose } = props,
    d = useResourceDraft(props),
    v = d.values;
  const [tab, setTab] = useState("基本信息"),
    [candidate, setCandidate] = useState(""),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [custom, setCustom] = useState(false),
    [customKey, setCustomKey] = useState(""),
    [customType, setCustomType] = useState("string"),
    [customValue, setCustomValue] = useState("");
  const [abilities, setAbilities] = useState<Record<string, any>>(() => {
    if (
      record?.data.capabilities &&
      Object.keys(record.data.capabilities).length
    )
      return structuredClone(record.data.capabilities);
    if (record && !record.data.model_types) {
      const key = legacy[record.data.capability] || "text_generate";
      return {
        [key]: { type: key, max_context_tokens: record.data.context_window },
      };
    }
    return {};
  });
  const [active, setActive] = useState(Object.keys(abilities)[0] || "");
  const related = useQuery({
    queryKey: ["base-model-form-options"],
    queryFn: async () => {
      const results = await Promise.all(
        ["providers", "runtime-policies", "pricing"].map((key) =>
          recordCollection(key),
        ),
      );
      return {
        providers: results[0].items,
        policies: results[1].items,
        pricing: results[2].items,
      };
    },
  });
  const current = modelAbilities.find((x) => x.key === active),
    configuration = abilities[active] || {};
  const setError = (key: string, message: string) =>
    setErrors((old) => ({ ...old, [key]: message }));
  function update(key: string, value: any) {
    setAbilities((old) => ({
      ...old,
      [active]: { ...old[active], [key]: value },
    }));
  }
  function add() {
    const item = modelAbilities.find((x) => x.key === candidate);
    if (!item || abilities[item.key]) return;
    setAbilities((old) => ({
      ...old,
      [item.key]: {
        type: item.key,
        ...Object.fromEntries(item.fields.map((f) => [f.key, f.default])),
      },
    }));
    setActive(item.key);
    setCandidate("");
  }
  function remove(key: string) {
    const next = { ...abilities };
    delete next[key];
    setAbilities(next);
    if (active === key) setActive(Object.keys(next)[0] || "");
    setErrors((old) =>
      Object.fromEntries(
        Object.entries(old).filter(([k]) => !k.startsWith(key + ":")),
      ),
    );
  }
  function save() {
    if (Object.values(errors).some(Boolean)) return;
    const keys = Object.keys(abilities);
    if (
      !d.name.trim() ||
      !v.canonical_key ||
      !v.default_real_model_name ||
      !v.vendor
    ) {
      setError("basic", "请填写显示名称、调用别名、默认真实模型名及厂商");
      setTab("基本信息");
      return;
    }
    void d.save({
      model_types: keys,
      capabilities: abilities,
      capability: compatibility[keys[0]] || v.capability || "text",
      context_window:
        abilities.text_generate?.max_context_tokens ?? v.context_window,
      usage_scenes: v.usage_scenes === "" ? null : v.usage_scenes,
    });
  }
  function customSave() {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(customKey) ||
      customKey === "type" ||
      customKey in configuration
    ) {
      setError("custom", "字段名称无效或已经存在");
      return;
    }
    try {
      const value =
        customType === "string" ? customValue : JSON.parse(customValue);
      if (
        (customType === "number" && typeof value !== "number") ||
        (customType === "boolean" && typeof value !== "boolean")
      )
        throw new Error();
      update(customKey, value);
      setCustom(false);
      setCustomKey("");
      setCustomValue("");
      setError("custom", "");
    } catch {
      setError("custom", "字段值与类型不一致");
    }
  }
  const unknown = Object.keys(configuration).filter(
    (key) => !current?.fields.some((f) => f.key === key),
  );
  return (
    <>
      <Modal
        title={record ? "编辑基础模型" : "新增基础模型"}
        onClose={onClose}
        className="base-model-modal"
        footer={
          <>
            <button className="button secondary" onClick={onClose}>
              取 消
            </button>
            <button className="button primary" disabled={d.busy} onClick={save}>
              {d.busy ? "保存中…" : "保 存"}
            </button>
          </>
        }
      >
        <RefTabs
          tabs={["基本信息", "模型能力"]}
          value={tab}
          onChange={setTab}
        />
        {tab === "基本信息" ? (
          <div className="parity-grid base-model-basic">
            <ConfigField title="显示名称 *">
              <input
                aria-label="显示名称"
                value={d.name}
                onChange={(e) => {
                  d.setName(e.target.value);
                  setError("basic", "");
                }}
              />
            </ConfigField>
            <ConfigField title="调用别名 *">
              <input
                aria-label="调用别名"
                value={v.canonical_key || ""}
                onChange={(e) => {
                  d.set("canonical_key", e.target.value);
                  setError("basic", "");
                }}
              />
            </ConfigField>
            <ConfigField title="默认真实模型名 *" full>
              <input
                aria-label="默认真实模型名"
                value={v.default_real_model_name || ""}
                onChange={(e) => {
                  d.set("default_real_model_name", e.target.value);
                  setError("basic", "");
                }}
              />
            </ConfigField>
            <ConfigField title="模型描述" full>
              <textarea
                rows={3}
                placeholder="请输入模型描述（可选）"
                value={v.description || ""}
                onChange={(e) => d.set("description", e.target.value)}
              />
            </ConfigField>
            <ConfigField title="厂商 *">
              <select
                aria-label="厂商"
                value={v.vendor || ""}
                onChange={(e) => {
                  d.set("vendor", e.target.value);
                  setError("basic", "");
                }}
              >
                <option value="">请选择厂商</option>
                {v.vendor &&
                  !related.data?.providers.some(
                    (r: any) => (r.data.code || r.name) === v.vendor,
                  ) && <option value={v.vendor}>{v.vendor}</option>}
                {related.data?.providers.map((r: any) => (
                  <option key={r.id} value={r.data.code || r.name}>
                    {r.data.display_name || r.name}
                  </option>
                ))}
              </select>
            </ConfigField>
            <ConfigField title="图标 URL">
              <div className="base-model-icon">
                <input
                  type="url"
                  placeholder="https://..."
                  value={v.icon_url || ""}
                  onChange={(e) => d.set("icon_url", e.target.value)}
                />
                <span aria-label="图标占位">{d.name.slice(0, 1) || "A"}</span>
              </div>
            </ConfigField>
            <ConfigField title="运行策略">
              <select
                value={v.runtime_policy_id || ""}
                onChange={(e) => d.set("runtime_policy_id", e.target.value)}
              >
                <option value="">默认运行策略</option>
                {related.data?.policies.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </ConfigField>
            <ConfigField title="定价规则">
              <select
                value={v.pricing_id || ""}
                onChange={(e) => d.set("pricing_id", e.target.value)}
              >
                <option value="">默认定价规则</option>
                {related.data?.pricing.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </ConfigField>
            <ConfigField title="状态">
              <select
                aria-label="状态"
                value={d.status}
                onChange={(e) => d.setStatus(e.target.value)}
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </ConfigField>
            <ConfigField
              title="可选场景"
              full
              hint="不限制表示所有场景均可选择；具体场景可多选。AI 应用和 Agent 不受影响，桌面端在下次模型同步后生效。"
            >
              <div className="capability-choices">
                <label>
                  <input
                    type="checkbox"
                    checked={!Array.isArray(v.usage_scenes)}
                    onChange={(e) =>
                      d.set("usage_scenes", e.target.checked ? null : [])
                    }
                  />
                  不限制
                </label>
                {[
                  ["canvas_model_node", "画布模型节点"],
                  ["desktop", "桌面端"],
                ].map(([key, title]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={
                        Array.isArray(v.usage_scenes) &&
                        v.usage_scenes.includes(key)
                      }
                      onChange={(e) =>
                        d.set(
                          "usage_scenes",
                          e.target.checked
                            ? [
                                ...(Array.isArray(v.usage_scenes)
                                  ? v.usage_scenes
                                  : []),
                                key,
                              ]
                            : (v.usage_scenes || []).filter(
                                (x: string) => x !== key,
                              ),
                        )
                      }
                    />
                    {title}
                  </label>
                ))}
              </div>
            </ConfigField>
          </div>
        ) : (
          <div className="capability-layout">
            <aside className="capability-sidebar">
              <strong>已启用能力</strong>
              <div className="capability-enabled">
                {Object.keys(abilities).map((key) => (
                  <div key={key} className={key === active ? "active" : ""}>
                    <button type="button" onClick={() => setActive(key)}>
                      {modelAbilities.find((a) => a.key === key)?.name || key}
                      <small>{key}</small>
                    </button>
                    <DeleteButton
                      aria-label={`移除能力 ${modelAbilities.find((a) => a.key === key)?.name || key}`}
                      onClick={() => remove(key)}
                    />
                  </div>
                ))}
              </div>
              <select
                aria-label="选择要添加的能力"
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
              >
                <option value="">
                  {modelAbilities.every((a) => a.key in abilities)
                    ? "没有可添加能力"
                    : "选择要添加的能力"}
                </option>
                {modelAbilities
                  .filter((a) => !(a.key in abilities))
                  .map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.name} / {a.key}
                    </option>
                  ))}
              </select>
              <button
                className="button secondary"
                disabled={!candidate}
                onClick={add}
              >
                <Plus size={14} />
                添加能力
              </button>
              <section className="capability-summary">
                <strong>能力总结</strong>
                <p>
                  {Object.keys(abilities).length
                    ? `已启用 ${Object.keys(abilities).length} 项能力。包含 ${Object.keys(
                        abilities,
                      )
                        .map(
                          (k) =>
                            modelAbilities.find((a) => a.key === k)?.name || k,
                        )
                        .join("、")}。`
                    : "暂无启用能力，添加能力后会在这里显示模型支持范围。"}
                </p>
              </section>
            </aside>
            <section className="capability-editor">
              {current ? (
                <>
                  <h3>{current.name}默认能力</h3>
                  {current.fields.length ? (
                    current.fields.map((f) => (
                      <CapabilityField
                        key={active + f.key}
                        field={f}
                        value={configuration[f.key]}
                        onChange={(x) => update(f.key, x)}
                        onError={(x) => setError(active + ":" + f.key, x)}
                      />
                    ))
                  ) : (
                    <div className="capability-empty">
                      <Box size={28} />
                      <h4>该能力类型没有具体的能力配置项</h4>
                      <p>仍会保存该能力类型；已有原始字段会继续保留。</p>
                    </div>
                  )}
                  <details
                    className="capability-preserved"
                    open={unknown.some((x) => x !== "type")}
                  >
                    <summary>保留字段 · {unknown.length} 个未展示字段</summary>
                    <p>这些字段保存时会继续保留在 {active} 能力配置内。</p>
                    {unknown.map((key) => (
                      <div key={active + key}>
                        <code>{key}</code>
                        {key === "type" ? (
                          <span>{configuration[key]}</span>
                        ) : (
                          <>
                            <JSONValue
                              value={configuration[key]}
                              label={key}
                              onChange={(x) => update(key, x)}
                              onError={(x) => setError(active + ":" + key, x)}
                            />
                            <DeleteButton
                              aria-label={`删除字段 ${key}`}
                              onClick={() => {
                                const next = { ...configuration };
                                delete next[key];
                                setAbilities({ ...abilities, [active]: next });
                                setError(active + ":" + key, "");
                              }}
                            >
                              删除字段
                            </DeleteButton>
                          </>
                        )}
                      </div>
                    ))}
                  </details>
                  <button
                    className="button secondary"
                    onClick={() => setCustom(true)}
                  >
                    <Plus size={14} />
                    添加字段
                  </button>
                </>
              ) : (
                <div className="capability-empty">
                  <Box size={32} />
                  <h3>暂无启用能力</h3>
                  <p>先在左侧添加能力，再维护默认配置。</p>
                </div>
              )}
            </section>
          </div>
        )}
        {Object.values(errors)
          .filter(Boolean)
          .map((error, i) => (
            <p role="alert" className="ref-notice" key={i}>
              {error}
            </p>
          ))}
      </Modal>
      {custom && (
        <Modal
          title="添加字段"
          onClose={() => setCustom(false)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setCustom(false)}
              >
                取消
              </button>
              <button className="button primary" onClick={customSave}>
                确定
              </button>
            </>
          }
        >
          <div className="ref-form">
            <ConfigField title="字段名称">
              <input
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder="custom_field"
              />
            </ConfigField>
            <ConfigField title="字段类型">
              <select
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
              >
                <option value="string">字符串</option>
                <option value="number">数值</option>
                <option value="boolean">布尔值</option>
                <option value="json">JSON</option>
              </select>
            </ConfigField>
            <ConfigField title="字段值">
              <textarea
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
              />
            </ConfigField>
            {errors.custom && <p role="alert">{errors.custom}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
