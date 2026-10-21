"use client";
import { useState } from "react";
import { post, put, type DataRecord, type PageSpec } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { ConfigField, ConfigToggle, TagInput } from "./platform-form";
import { useToast } from "./ui";
const sections = ["基本信息", "限流策略", "平台内重试策略", "禁用与降级"];
export function RuntimePolicyForm({
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
  const [name, setName] = useState(record?.name || "自定义运行策略"),
    [status, setStatus] = useState(record?.status || "active"),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(0),
    [v, setV] = useState<Record<string, any>>(() => ({
      ...Object.fromEntries(
        page.fields.map((f) => [
          f.key,
          record && f.key in record.data
            ? record.data[f.key]
            : (f.default ?? ""),
        ]),
      ),
      ...(!record ? { rpm: null, concurrency: null, timeout: 600 } : {}),
    }));
  const toast = useToast();
  const set = (k: string, value: any) => setV((x) => ({ ...x, [k]: value }));
  function number(key: string, title: string, unlimited = false) {
    return (
      <ConfigField title={title}>
        <input
          type="number"
          step="1"
          min={unlimited ? undefined : 1}
          value={v[key] ?? ""}
          placeholder={unlimited ? "留空或负数为不限制" : ""}
          onChange={(e) =>
            set(key, e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </ConfigField>
    );
  }
  function tags(key: string, title: string) {
    return (
      <ConfigField title={title} full>
        <TagInput
          label={title}
          value={v[key] || []}
          onChange={(x) => set(key, x)}
          placeholder="输入关键词，按回车添加"
        />
      </ConfigField>
    );
  }
  async function save() {
    setBusy(true);
    try {
      if (!name.trim()) throw new Error("请填写策略名称");
      const body = {
        name,
        status,
        data: v,
        ...(record ? { expected_version: record.version } : {}),
      };
      if (record)
        await put(`/admin/records/runtime-policies/${record.id}`, body);
      else await post("/admin/records/runtime-policies", body);
      toast("运行策略已保存");
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
      className="runtime-policy-modal"
      title={record ? "编辑运行策略" : "新增运行策略"}
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy} onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="runtime-policy-layout">
        <nav aria-label="运行策略分区">
          {sections.map((title, i) => (
            <button
              className={active === i ? "active" : ""}
              key={title}
              onClick={() => {
                setActive(i);
                document
                  .getElementById(`policy-section-${i}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <main>
          <section id="policy-section-0" className="parity-section">
            <h3>基本信息</h3>
            <p>策略名称、说明和启停状态</p>
            <div className="parity-grid">
              <ConfigField title="名称">
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </ConfigField>
              <ConfigField title="状态">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </ConfigField>
              <ConfigField title="描述" full>
                <input
                  value={v.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </ConfigField>
            </div>
          </section>
          <section id="policy-section-1" className="parity-section">
            <h3>限流策略</h3>
            <p>TPM / RPM / 并发</p>
            <div className="parity-grid">
              {number("rpm", "RPM / 分钟请求", true)}
              {number("tpm", "TPM / 分钟 Token", true)}
              {number("concurrency", "并发请求", true)}
              {number("timeout", "运行超时（秒）")}
              <ConfigField
                title="限流后行为"
                full
                hint="默认排队等待限流窗口释放；大模型对话命中限流时始终直接拒绝。"
              >
                <select
                  value={v.rate_behavior}
                  onChange={(e) => set("rate_behavior", e.target.value)}
                >
                  <option value="queue">进入队列排队</option>
                  <option value="reject">直接拒绝</option>
                </select>
              </ConfigField>
            </div>
          </section>
          <section id="policy-section-2" className="parity-section">
            <h3>平台内重试策略</h3>
            <p>允许/拒绝关键词控制同一平台是否再次调用</p>
            <div className="parity-grid">
              <ConfigToggle
                title="允许同平台重试"
                value={!!v.same_platform_retry}
                onChange={(x) => set("same_platform_retry", x)}
              />
              {number("max_attempts", "最大尝试次数")}
              {tags("retry_allow", "允许重试关键词")}
              {tags("retry_deny", "拒绝重试关键词")}
            </div>
          </section>
          <section id="policy-section-3" className="parity-section">
            <h3>禁用与降级</h3>
            <p>自动禁用错误关键词、优先级降级关键词</p>
            <div className="parity-grid">
              <ConfigToggle
                title="启用自动禁用"
                value={!!v.auto_disable}
                onChange={(x) => set("auto_disable", x)}
              />
              {number("disable_threshold", "禁用触发次数")}
              {tags("disable_keywords", "自动禁用关键词")}
              <ConfigToggle
                title="启用优先级降级"
                value={!!v.auto_degrade}
                onChange={(x) => set("auto_degrade", x)}
              />
              {number("degrade_seconds", "降级冷却秒数")}
              {tags("degrade_keywords", "降级关键词")}
            </div>
          </section>
        </main>
      </div>
    </Modal>
  );
}
