"use client";
import { useState } from "react";
import { post, put, type DataRecord, type PageSpec } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { ConfigField } from "./platform-form";
import { DeleteButton } from "./interaction/delete-button";
import { useToast } from "./ui";

export const pricingModes: Record<
  string,
  { name: string; unit: string; formula: string; base: number }
> = {
  text: {
    name: "文本",
    unit: "每 1K Token",
    base: 0,
    formula:
      "一次对话扣费 = 未命中缓存输入 Token / 1000 × 输入扣费单价 + 命中缓存输入 Token / 1000 × 缓存输入扣费单价 + 输出 Token / 1000 × 输出扣费单价。",
  },
  image_vectorize: {
    name: "图片转矢量",
    unit: "每张图片",
    base: 200,
    formula:
      "扣费 = 基础单价 × 图片数量。用于图片转矢量模型，按单张图片固定计价。",
  },
  image: {
    name: "图像",
    unit: "每张图片",
    base: 10,
    formula:
      "扣费 = 基础单价 × 数量 × 分辨率参数 × 图像质量参数。图像质量按 low / medium / high 三档配置。",
  },
  video: {
    name: "视频",
    unit: "每 5 秒",
    base: 100,
    formula:
      "按倍率：扣费 = 数量 × 输出时长/5 × 输出每 5 秒单价 × 输出侧权重。单独计费：扣费 = 数量 ×（输入视频费用 + 输出视频费用）。",
  },
  video_enhance: {
    name: "视频增强",
    unit: "每 5 秒",
    base: 100,
    formula:
      "扣费 = ceil(数量 × max(1, round(视频时长) / 5秒) × 基础单价 × 分辨率转换权重 × 帧率转换权重 × 平台加价倍率)。",
  },
  speech_to_text: {
    name: "语音识别",
    unit: "每秒",
    base: 1,
    formula:
      "扣费 = 音频数量 × 输入音频时长秒数 × 基础单价 × 权重。用于语音识别模型，按输入音频秒数计费。",
  },
  audio: {
    name: "音频合成",
    unit: "每千字符",
    base: 1,
    formula:
      "扣费 = 字符数 / 1000 × 基础单价 × 权重。用于语音合成、音频生成等音频类模型。",
  },
  music: {
    name: "音乐生成",
    unit: "每项",
    base: 20,
    formula: "扣费 = 生成数量 × 基础单价 × 权重。用于音乐生成类模型。",
  },
  digital_human: {
    name: "数字人",
    unit: "每秒",
    base: 50,
    formula:
      "扣费 = 数字人数 × 时长秒数 × 基础单价 × 权重。用于数字人生成模型。",
  },
  model: {
    name: "模型生成",
    unit: "每项",
    base: 20,
    formula:
      "扣费 = 生成数量 × 基础单价 × 贴图参数 × 操作类型权重。用于 3D 模型生成、纹理和模型编辑。",
  },
};
export const pricingDimensionNames: Record<string, string> = {
  resolution: "分辨率",
  quality: "图像质量",
  output_resolution: "输出视频分辨率",
  sound: "生成声音",
  reference_video: "参考视频",
  voice: "指定音色",
  texture: "贴图",
};
export const pricingValueNames: Record<string, string> = {
  low: "低质量 (low)",
  medium: "标准质量 (medium)",
  high: "高质量 (high)",
  yes: "是",
  no: "否",
  none: "无贴图",
  standard: "标准贴图",
};
export function defaultPricingMode(key: string): Record<string, any> {
  const base = {
    name: pricingModes[key].name,
    enabled: true,
    base: pricingModes[key].base,
  };
  if (key === "text")
    return { ...base, input: 0.01, cache: 0.01, output: 0.03 };
  if (key === "image")
    return {
      ...base,
      weights: {
        resolution: { "1K": 1, "2K": 1.5, "3K": 1.75, "4K": 2, "8K": 4 },
        quality: { low: 0.5, medium: 1, high: 1.5 },
      },
    };
  if (key === "video")
    return {
      ...base,
      reference_mode: "multiplier",
      input_video_price: 100,
      weights: {
        output_resolution: {
          "480p": 0.75,
          "720p": 1,
          "720p_upscale": 0.875,
          "1080p": 1.5,
          "1080p_upscale": 1.25,
          "1440p": 1.75,
          "2k_upscale": 1.6,
          "2160p": 2,
          "4k_upscale": 1.8,
        },
        sound: { yes: 2, no: 1 },
        reference_video: { yes: 1.5, no: 1 },
        voice: { yes: 1.2, no: 1 },
      },
    };
  if (key === "model")
    return {
      ...base,
      weights: { texture: { none: 1, standard: 2 } },
      operation_weights: {},
    };
  if (key === "video_enhance") {
    const matrix = (keys: string[], values: number[]) =>
      Object.fromEntries(
        keys.map((k, i) => [
          k,
          Object.fromEntries(keys.slice(i).map((t, j) => [t, values[i + j]])),
        ]),
      );
    return {
      ...base,
      markup: 1,
      resolution_matrix: matrix(
        ["480p", "720p", "1080p", "1440p", "2160p"],
        [1, 1.4, 1.8, 2.1, 2.6],
      ),
      fps_matrix: matrix(
        ["24", "30", "60", "120", "240"],
        [1, 1.25, 2.5, 5, 10],
      ),
    };
  }
  return base;
}

export function PricingRuleForm({
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
  const [name, setName] = useState(record?.name || "自定义定价规则"),
    [ruleKey, setRuleKey] = useState(
      record?.data.rule_key || "custom-pricing-rule",
    ),
    [description, setDescription] = useState(
      record?.data.description || "可绑定到基础模型或平台复用。",
    ),
    [category, setCategory] = useState(record?.data.category || "custom"),
    [currency, setCurrency] = useState(record?.data.currency || "resource"),
    [status, setStatus] = useState(record?.status || "active"),
    [mode, setMode] = useState("text"),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState("");
  const toast = useToast();
  const [modes, setModes] = useState<Record<string, any>>(() => {
    if (
      record?.data.billing_modes &&
      Object.keys(record.data.billing_modes).length
    )
      return structuredClone(record.data.billing_modes);
    const defaults = Object.fromEntries(
      Object.keys(pricingModes).map((k) => [k, defaultPricingMode(k)]),
    );
    if (record)
      defaults.text = {
        ...defaults.text,
        input: (record.data.input_rate || 0) / 1000,
        cache:
          (record.data.cache_read_rate ?? record.data.input_rate ?? 0) / 1000,
        output: (record.data.output_rate || 0) / 1000,
      };
    return defaults;
  });
  const cfg = modes[mode],
    spec = pricingModes[mode];
  function set(key: string, v: any) {
    setModes((all) => ({ ...all, [mode]: { ...all[mode], [key]: v } }));
  }
  function numeric(key: string, label: string) {
    return (
      <ConfigField title={label}>
        <input
          aria-label={label}
          type="number"
          min="0"
          step="any"
          value={cfg[key] ?? 0}
          onChange={(e) => set(key, Number(e.target.value))}
        />
      </ConfigField>
    );
  }
  async function save() {
    setBusy(true);
    try {
      if (!name.trim() || !ruleKey.trim())
        throw new Error("请填写规则 Key 和名称");
      const data = Object.fromEntries(
        page.fields.map((f) => [
          f.key,
          record?.data[f.key] ?? f.default ?? null,
        ]),
      );
      Object.assign(data, {
        rule_key: ruleKey,
        description,
        category,
        currency,
        billing_modes: modes,
        resource_type: "text",
        base_rate: record?.data.base_rate ?? 0,
      });
      const body = {
        name,
        status,
        data,
        ...(record ? { expected_version: record.version } : {}),
      };
      if (record) await put(`/admin/records/pricing/${record.id}`, body);
      else await post("/admin/records/pricing", body);
      toast("定价规则已保存");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function matrix(key: string, title: string, axis: string) {
    const rows = cfg[key] || {};
    const keys = Object.keys(rows);
    return (
      <section className="pricing-matrix">
        <h4>{title}</h4>
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>{axis}</th>
                {keys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((from) => (
                <tr key={from}>
                  <th>{from}</th>
                  {keys.map((to) => (
                    <td key={to}>
                      {rows[from][to] === undefined ? (
                        "—"
                      ) : (
                        <input
                          aria-label={`${title} ${from} 到 ${to}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={rows[from][to]}
                          onChange={(e) =>
                            set(key, {
                              ...rows,
                              [from]: {
                                ...rows[from],
                                [to]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  return (
    <Modal
      className="pricing-rule-modal"
      title={record ? "编辑定价规则" : "新增定价规则"}
      onClose={onClose}
      footer={
        <>
          <button className="button primary" disabled={busy} onClick={save}>
            {busy ? "保存中…" : "保存修改"}
          </button>
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
        </>
      }
    >
      <div className="pricing-metadata">
        <ConfigField title="规则 Key">
          <input
            value={ruleKey}
            placeholder="default-multimodal-v1"
            onChange={(e) => setRuleKey(e.target.value)}
          />
        </ConfigField>
        <ConfigField title="名称">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </ConfigField>
        <ConfigField title="说明">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </ConfigField>
        <ConfigField title="类型">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>custom</option>
            <option>builtin</option>
          </select>
        </ConfigField>
        <ConfigField title="货币">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {["resource", "CNY", "USD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </ConfigField>
        <ConfigField title="状态">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </ConfigField>
      </div>
      <div className="pricing-section-title">
        <h3>计费模式</h3>
        <p>选择能力后维护基础价格、计费公式和计费参数。</p>
      </div>
      <div className="pricing-editor-layout">
        <nav aria-label="计费模式">
          <strong>计费模式</strong>
          {Object.entries(pricingModes).map(([k, v]) => (
            <button
              className={mode === k ? "active" : ""}
              key={k}
              onClick={() => setMode(k)}
            >
              <span>{v.name}</span>
              <small>{modes[k] ? 1 : 0} 条计价规则</small>
            </button>
          ))}
        </nav>
        <main>
          <section className="pricing-summary">
            <h3>规则总结</h3>
            <p>
              {mode === "text" && cfg
                ? `文本按输入/缓存输入/输出 Token 分别计费，输入 ${cfg.input}/每 1K Token，缓存输入 ${cfg.cache}/每 1K Token，输出 ${cfg.output}/每 1K Token。`
                : cfg
                  ? `${spec.name}按 ${spec.unit} 计费，基础单价 ${cfg.base}。`
                  : `尚未配置${spec.name}计价规则。`}
            </p>
          </section>
          {cfg ? (
            <article className="pricing-mode-card">
              <header>
                <div>
                  <small>{mode === "text" ? "text_total" : mode}</small>
                  <h3>{spec.name}</h3>
                  <span>{mode}</span>
                </div>
                <DeleteButton
                  className="button secondary"
                  onClick={() =>
                    setModes((all) =>
                      Object.fromEntries(
                        Object.entries(all).filter(([k]) => k !== mode),
                      ),
                    )
                  }
                >
                  删除
                </DeleteButton>
              </header>
              <div className="parity-grid">
                <ConfigField title="展示名称">
                  <input
                    value={cfg.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </ConfigField>
                <ConfigField title="状态">
                  <select
                    value={cfg.enabled ? "active" : "disabled"}
                    onChange={(e) =>
                      set("enabled", e.target.value === "active")
                    }
                  >
                    <option>active</option>
                    <option>disabled</option>
                  </select>
                </ConfigField>
                {mode === "text" ? (
                  <>
                    {numeric("input", "输入单价/1K tokens")}
                    {numeric("cache", "缓存输入单价/1K tokens")}
                    {numeric("output", "输出单价/1K tokens")}
                  </>
                ) : (
                  numeric(
                    "base",
                    mode === "video"
                      ? "输出视频单价/每 5 秒"
                      : `基础单价/${spec.unit}`,
                  )
                )}
                {mode === "video" && (
                  <>
                    <ConfigField title="参考视频计费方式">
                      <select
                        value={cfg.reference_mode}
                        onChange={(e) => set("reference_mode", e.target.value)}
                      >
                        <option value="multiplier">按倍率计费</option>
                        <option value="separate">单独计费</option>
                      </select>
                    </ConfigField>
                    {cfg.reference_mode === "separate" &&
                      numeric("input_video_price", "输入视频单价/每 5 秒")}
                  </>
                )}
                {mode === "video_enhance" && numeric("markup", "平台加价倍率")}
                <ConfigField title="计价单位">
                  <div className="parity-readonly">{spec.unit}</div>
                </ConfigField>
                <ConfigField title="计算方式">
                  <div className="parity-readonly">
                    {mode === "text"
                      ? "按 Token 用量"
                      : mode === "video_enhance"
                        ? "按转换矩阵"
                        : ["video", "speech_to_text", "digital_human"].includes(
                              mode,
                            )
                          ? "按时长和参数"
                          : "按数量和参数"}
                  </div>
                </ConfigField>
              </div>
              <section className="pricing-formula">
                <h4>计费公式</h4>
                <p>{spec.formula}</p>
              </section>
              {Object.entries(cfg.weights || {}).map(
                ([dimension, weights]: [string, any]) => (
                  <section className="pricing-weights" key={dimension}>
                    <h4>{pricingDimensionNames[dimension] || dimension}</h4>
                    <div className="pricing-weight-grid">
                      {Object.entries(weights).map(([key, v]) => (
                        <ConfigField
                          key={key}
                          title={pricingValueNames[key] || key}
                        >
                          <input
                            aria-label={`${pricingDimensionNames[dimension]} ${key}`}
                            type="number"
                            min="0"
                            step="any"
                            value={Number(v)}
                            onChange={(e) =>
                              set("weights", {
                                ...cfg.weights,
                                [dimension]: {
                                  ...weights,
                                  [key]: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </ConfigField>
                      ))}
                    </div>
                  </section>
                ),
              )}
              {mode === "video_enhance" && (
                <>
                  {matrix(
                    "resolution_matrix",
                    "分辨率转换矩阵",
                    "源分辨率 / 目标分辨率",
                  )}
                  {matrix("fps_matrix", "帧率转换矩阵", "源帧率 / 目标帧率")}
                </>
              )}
              {mode === "model" && (
                <section className="pricing-weights">
                  <h4>操作类型权重</h4>
                  <p>
                    按业务操作设置扣费倍率，1 表示按基础价格计费，1.25
                    表示基础价格的 1.25 倍。未配置的操作自动按 1 倍计费。
                  </p>
                  {Object.entries(cfg.operation_weights || {}).map(
                    ([key, v]) => (
                      <div className="pricing-operation-row" key={key}>
                        <code>{key}</code>
                        <input
                          aria-label={`${key} 权重`}
                          type="number"
                          min="0"
                          step="any"
                          value={Number(v)}
                          onChange={(e) =>
                            set("operation_weights", {
                              ...cfg.operation_weights,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                        <DeleteButton
                          className="icon-button"
                          aria-label={`删除权重 ${key}`}
                          onClick={() =>
                            set(
                              "operation_weights",
                              Object.fromEntries(
                                Object.entries(cfg.operation_weights).filter(
                                  ([k]) => k !== key,
                                ),
                              ),
                            )
                          }
                        />
                      </div>
                    ),
                  )}
                  <div className="pricing-operation-row">
                    <input
                      aria-label="操作类型"
                      placeholder="操作类型"
                      value={operation}
                      onChange={(e) => setOperation(e.target.value)}
                    />
                    <button
                      className="button secondary"
                      disabled={
                        !operation.trim() ||
                        !!cfg.operation_weights?.[operation]
                      }
                      onClick={() => {
                        set("operation_weights", {
                          ...cfg.operation_weights,
                          [operation.trim()]: 1,
                        });
                        setOperation("");
                      }}
                    >
                      新增权重
                    </button>
                  </div>
                </section>
              )}
            </article>
          ) : (
            <button
              className="parity-add-row"
              onClick={() =>
                setModes((all) => ({
                  ...all,
                  [mode]: defaultPricingMode(mode),
                }))
              }
            >
              添加{spec.name}计价规则
            </button>
          )}
        </main>
      </div>
    </Modal>
  );
}
