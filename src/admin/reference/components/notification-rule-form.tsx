"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Modal, RefTabs } from "./reference-ui";
import { ConfigField, ConfigToggle, TagInput } from "./platform-form";
import { DeleteButton } from "./interaction/delete-button";
import { useResourceDraft, type FormProps } from "./reference-detail-forms";
import { FieldControl } from "./resource-page";
import { useQuery } from "@tanstack/react-query";
import { api } from "@reference/lib/api";
import { ErrorState, Spinner } from "./ui";

const tabs = [
  "基本信息",
  "IM 推送",
  "邮件通知",
  "短信通知",
  "站内通知",
  "治理任务",
];
const keys: Record<string, string> = {
  "IM 推送": "im",
  邮件通知: "email",
  短信通知: "sms",
  站内通知: "in_app",
  治理任务: "governance",
};
const defaults = {
  im: {
    enabled: false,
    private_chat_policy: "",
    channel_ids: [],
    use_dynamic_recipient: false,
    fixed_targets: [],
    template: "",
  },
  email: {
    enabled: false,
    include_receiver: false,
    recipients: [],
    subject: "",
    body: "",
  },
  sms: {
    enabled: false,
    include_receiver: false,
    recipients: [],
    template: "EasyAI {event_label}:{title}",
  },
  in_app: { enabled: false, business_type: "", roles: [] },
  governance: { enabled: false, category: "alert", priority: "high" },
};
export function NotificationRuleForm(props: FormProps) {
  const d = useResourceDraft(props),
    v = d.values,
    [tab, setTab] = useState("基本信息"),
    [chooseConversation, setChooseConversation] = useState(false);
  const [config, setConfig] = useState<Record<string, any>>(() => {
    const value = structuredClone(defaults) as Record<string, any>;
    if (
      props.record?.data.channel_config &&
      Object.keys(props.record.data.channel_config).length
    )
      return { ...value, ...props.record.data.channel_config };
    if (props.record)
      for (const channel of v.channels || []) {
        if (value[channel])
          value[channel] = {
            ...value[channel],
            enabled: true,
            recipients: v.recipients || [],
            template: v.template || "",
          };
      }
    return value;
  });
  const k = keys[tab],
    c = config[k] || {},
    set = (key: string, value: any) =>
      setConfig((old) => ({ ...old, [k]: { ...old[k], [key]: value } }));
  function field(key: string, title: string, placeholder = "", area = false) {
    return (
      <ConfigField title={title}>
        {area ? (
          <textarea
            rows={3}
            placeholder={placeholder}
            value={c[key] || ""}
            onChange={(e) => set(key, e.target.value)}
          />
        ) : (
          <input
            placeholder={placeholder}
            value={c[key] || ""}
            onChange={(e) => set(key, e.target.value)}
          />
        )}
      </ConfigField>
    );
  }
  function select(key: string, title: string, options: [string, string][]) {
    return (
      <ConfigField title={title}>
        <select value={c[key] || ""} onChange={(e) => set(key, e.target.value)}>
          <option value="">请选择</option>
          {options.map(([key, title]) => (
            <option key={key} value={key}>
              {title}
            </option>
          ))}
        </select>
      </ConfigField>
    );
  }
  const channels = Object.keys(config).filter(
    (key) => key !== "governance" && config[key].enabled,
  );
  const cloudPlatforms = useQuery({
    queryKey: ["notification-sms-platforms"],
    queryFn: () =>
      api<{ items: { id: string; name: string; provider: string }[] }>(
        "/admin/notifications/cloud-platforms",
      ),
    enabled: k === "sms",
  });
  return (
    <>
      <Modal
        title={props.record ? "编辑事件通知规则" : "新增事件通知规则"}
        onClose={props.onClose}
        className="notification-rule-modal"
        footer={
          <>
            <button className="button secondary" onClick={props.onClose}>
              取 消
            </button>
            <button
              className="button primary"
              disabled={d.busy}
              onClick={() => d.save({ channel_config: config, channels })}
            >
              {d.busy ? "保存中…" : props.record ? "保 存" : "创 建"}
            </button>
          </>
        }
      >
        <RefTabs tabs={tabs} value={tab} onChange={setTab} />
        <div className="notification-rule-body">
          {tab === "基本信息" ? (
            <div className="ref-form">
              <ConfigField title="事件类型 *">
                <input
                  value={v.event || ""}
                  placeholder="例如 run.failed"
                  onChange={(e) => d.set("event", e.target.value)}
                />
              </ConfigField>
              <ConfigField title="事件名称 *">
                <input
                  value={d.name}
                  onChange={(e) => d.setName(e.target.value)}
                />
              </ConfigField>
              <ConfigField title="事件分类">
                <select
                  value={v.category || "operations"}
                  onChange={(e) => d.set("category", e.target.value)}
                >
                  {[
                    ["system", "系统"],
                    ["finance", "财务"],
                    ["review", "审核"],
                    ["interaction", "互动"],
                    ["operations", "运维"],
                  ].map(([k, t]) => (
                    <option key={k} value={k}>
                      {t}
                    </option>
                  ))}
                </select>
              </ConfigField>
              <ConfigField title="描述">
                <textarea
                  rows={3}
                  value={v.description || ""}
                  onChange={(e) => d.set("description", e.target.value)}
                />
              </ConfigField>
              <ConfigToggle
                title="启用"
                value={d.status === "active"}
                onChange={(x) => d.setStatus(x ? "active" : "disabled")}
              />
            </div>
          ) : (
            <div className="ref-form">
              <ConfigToggle
                title={"启用" + tab}
                value={c.enabled}
                onChange={(x) => set("enabled", x)}
              />
              {c.enabled && (
                <>
                  {k === "im" && (
                    <>
                      {select("private_chat_policy", "单聊策略", [
                        ["specified", "指定会话"],
                        ["all_mapped_users", "全部映射会话"],
                        ["receiver", "当事用户会话"],
                      ])}
                      <small className="ref-field-help">
                        不配置则只按下方固定目标发送
                      </small>
                      <ConfigField title="单聊策略机器人渠道">
                        <TagInput
                          value={c.channel_ids || []}
                          onChange={(x) => set("channel_ids", x)}
                          label="机器人渠道"
                          placeholder="机器人渠道标识，逗号分隔"
                        />
                      </ConfigField>
                      <ConfigToggle
                        title="兼容动态收件人"
                        hint="优先使用单聊策略“当事用户会话”"
                        value={c.use_dynamic_recipient}
                        onChange={(x) => set("use_dynamic_recipient", x)}
                      />
                      <ConfigField title="固定目标（单聊/群聊）">
                        <div className="parity-header-list">
                          {c.fixed_targets.map((target: any, i: number) => (
                            <div className="parity-header-row" key={i}>
                              <input
                                aria-label={`机器人渠道 ${i + 1}`}
                                placeholder="机器人渠道"
                                value={target.channel_id}
                                onChange={(e) =>
                                  set(
                                    "fixed_targets",
                                    c.fixed_targets.map((x: any, n: number) =>
                                      n === i
                                        ? { ...x, channel_id: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                              <input
                                aria-label={`会话标识 ${i + 1}`}
                                placeholder="会话标识"
                                value={target.chat_id}
                                onChange={(e) =>
                                  set(
                                    "fixed_targets",
                                    c.fixed_targets.map((x: any, n: number) =>
                                      n === i
                                        ? { ...x, chat_id: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                              <DeleteButton
                                aria-label={`删除固定目标 ${i + 1}`}
                                onClick={() =>
                                  set(
                                    "fixed_targets",
                                    c.fixed_targets.filter(
                                      (_: any, n: number) => n !== i,
                                    ),
                                  )
                                }
                              />
                            </div>
                          ))}
                          <button
                            className="button secondary"
                            onClick={() =>
                              set("fixed_targets", [
                                ...c.fixed_targets,
                                {
                                  channel_id: "",
                                  chat_id: "",
                                  type: "private",
                                },
                              ])
                            }
                          >
                            <Plus size={14} />
                            添加固定目标
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => setChooseConversation(true)}
                          >
                            从会话选择
                          </button>
                        </div>
                      </ConfigField>
                      {field(
                        "template",
                        "消息模板",
                        "[{event_label}] {title} {message}",
                      )}
                      <small className="ref-field-help">
                        可用变量：
                        {
                          "{title} {message} {time} {event_type} {event_label} {alertType} {payload}"
                        }
                      </small>
                    </>
                  )}
                  {(k === "email" || k === "sms") && (
                    <>
                      <ConfigToggle
                        title="同时发送给当事人"
                        hint={`事件涉及某用户时，发送到该用户的注册${k === "email" ? "邮箱" : "手机号"}`}
                        value={c.include_receiver}
                        onChange={(x) => set("include_receiver", x)}
                      />
                      <ConfigField
                        title={
                          k === "email"
                            ? "指定收件邮箱（多个用逗号分隔）"
                            : "指定手机号（多个用逗号分隔）"
                        }
                      >
                        <textarea
                          rows={3}
                          placeholder={
                            k === "email"
                              ? "ops@example.com,admin@example.com"
                              : "13800138000,13900139000"
                          }
                          value={(c.recipients || []).join(",")}
                          onChange={(e) =>
                            set(
                              "recipients",
                              e.target.value.split(/[,，\n]/).filter(Boolean),
                            )
                          }
                        />
                      </ConfigField>
                      {k === "email" ? (
                        <>
                          {field(
                            "subject",
                            "邮件主题模板",
                            "[EasyAI] {event_label} - {title}",
                          )}
                          {field(
                            "body",
                            "邮件正文模板",
                            "<h2>{title}</h2><p>{message}</p><pre>{payload}</pre>",
                            true,
                          )}
                          <small className="ref-field-help">
                            任务异常等场景可用 {"{payload}"} 输出完整上下文
                          </small>
                        </>
                      ) : (
                        <ConfigField title="短信内容模板（限 70 字）">
                          <input
                            maxLength={70}
                            value={c.template || ""}
                            onChange={(e) => set("template", e.target.value)}
                          />
                        </ConfigField>
                      )}
                      <small className="ref-field-help">
                        可用变量：
                        {
                          "{title} {message} {time} {event_type} {event_label} {alertType}"
                        }
                      </small>
                    </>
                  )}
                  {k === "in_app" && (
                    <>
                      {select("business_type", "业务类型", [
                        ["announcement", "系统公告"],
                        ["publication.pending", "作品发布申请"],
                        ["publication.approved", "作品审核通过"],
                        ["publication.rejected", "作品审核驳回"],
                        ["withdrawal.completed", "提现成功"],
                        ["withdrawal.failed", "提现失败"],
                        ["order.paid", "支付成功"],
                        ["budget.low", "余额不足提醒"],
                        ["pack.low", "资源包余量预警"],
                        ["reply", "回复我的"],
                      ])}
                      <ConfigField
                        title="接收角色"
                        hint="固定发送给指定角色的用户，可多选"
                      >
                        <div className="capability-choices">
                          {[
                            ["superadmin", "管理员"],
                            ["manager", "运营"],
                            ["operator", "操作员"],
                          ].map(([key, label]) => (
                            <label key={key}>
                              <input
                                type="checkbox"
                                checked={c.roles.includes(key)}
                                onChange={(e) =>
                                  set(
                                    "roles",
                                    e.target.checked
                                      ? [...c.roles, key]
                                      : c.roles.filter(
                                          (x: string) => x !== key,
                                        ),
                                  )
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </ConfigField>
                    </>
                  )}
                  {k === "governance" && (
                    <>
                      {select("category", "任务分类", [
                        ["alert", "异常告警"],
                        ["monitoring", "监控指标"],
                        ["business", "业务事件"],
                        ["security", "安全事件"],
                        ["data_quality", "数据质量"],
                        ["scheduled", "定时巡检"],
                        ["no_input", "无输入"],
                        ["custom", "自定义"],
                      ])}
                      {select("priority", "优先级", [
                        ["urgent", "紧急"],
                        ["high", "高"],
                        ["medium", "中"],
                        ["low", "低"],
                      ])}
                    </>
                  )}
                  {["im", "email", "sms"].includes(k) && (
                    <details className="notification-connection">
                      <summary>通知通道连接配置</summary>
                      {k === "sms" && (
                        <p className="ref-field-help">
                          网关留空时使用云服务平台中启用的短信服务。验证码读取该平台的登录
                          /
                          绑定模板；事件通知使用下方独立模板与参数。模板参数可使用正文中的同名变量。
                        </p>
                      )}
                      {props.page.fields
                        .filter(
                          (f) =>
                            f.key === "delivery_mode" ||
                            (k === "email"
                              ? f.key.startsWith("smtp_")
                              : k === "sms"
                                ? f.key.startsWith("sms_")
                                : f.key.startsWith("webhook_")),
                        )
                        .map((f) => (
                          <ConfigField title={f.label} key={f.key}>
                            {f.key === "sms_cloud_platform_id" ? (
                              <select
                                value={v[f.key] || ""}
                                onChange={(e) => d.set(f.key, e.target.value)}
                              >
                                <option value="">按云平台优先级选择</option>
                                {cloudPlatforms.data?.items.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} · {p.provider}
                                  </option>
                                ))}
                                {v[f.key] &&
                                  !cloudPlatforms.data?.items.some(
                                    (p) => p.id === v[f.key],
                                  ) && (
                                    <option value={v[f.key]}>
                                      原配置已停用或无法访问
                                    </option>
                                  )}
                              </select>
                            ) : (
                              <FieldControl
                                field={f}
                                value={v[f.key]}
                                onChange={(x) => d.set(f.key, x)}
                                configured={props.record?.configured_secrets?.includes(
                                  f.key,
                                )}
                              />
                            )}
                          </ConfigField>
                        ))}
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Modal>
      {chooseConversation && (
        <ConversationPicker
          onClose={() => setChooseConversation(false)}
          onAdd={(targets) => {
            setConfig((all) => ({
              ...all,
              im: {
                ...all.im,
                fixed_targets: [
                  ...all.im.fixed_targets,
                  ...targets.filter(
                    (t) =>
                      !all.im.fixed_targets.some(
                        (s: any) =>
                          s.channel_id === t.channel_id &&
                          s.chat_id === t.chat_id,
                      ),
                  ),
                ],
              },
            }));
            setChooseConversation(false);
          }}
        />
      )}
    </>
  );
}

function ConversationPicker({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (items: any[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ["notification-conversations"],
    queryFn: () => api("/admin/notifications/conversations"),
  });
  return (
    <Modal
      title="从现有会话选择"
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取 消
          </button>
          <button
            className="button primary"
            disabled={!selected.length}
            onClick={() =>
              onAdd(
                (q.data?.items || [])
                  .filter((r: any) => selected.includes(r.id))
                  .map((r: any) => ({
                    channel_id: r.channel_id,
                    chat_id: r.chat_id,
                    type: r.type,
                  })),
              )
            }
          >
            添加选中
          </button>
        </>
      }
    >
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>选择</th>
                <th>平台</th>
                <th>类型</th>
                <th>会话ID</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"选择会话 " + r.chat_id}
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, r.id]
                            : ids.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  <td>{r.platform}</td>
                  <td>{r.type === "group" ? "群聊" : "单聊"}</td>
                  <td>{r.chat_id}</td>
                </tr>
              ))}
              {!q.data.items.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    暂无数据
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
