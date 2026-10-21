"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put, formatTime } from "@reference/lib/api";
import { Modal, RefTabs, RefEmpty } from "./reference-ui";
import { Spinner, ErrorState, useToast, Status } from "./ui";

export function AgentExtensions({
  record,
  onClose,
  onChanged,
}: {
  record: any;
  onClose: () => void;
  onChanged: (version?: number) => void;
}) {
  const [tab, setTab] = useState("HTTP 工具"),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<any>(null),
    [token, setToken] = useState(""),
    toast = useToast(),
    cache = useQueryClient();
  const q = useQuery({
    queryKey: ["agent-extensions", record.id],
    queryFn: () => api(`/admin/agents/${record.id}/extensions`),
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api("/projects"),
  });
  async function act(fn: () => Promise<any>, message: string) {
    setBusy(true);
    try {
      const r = await fn();
      const updated = await q.refetch();
      await cache.invalidateQueries({ queryKey: ["records", "agents"] });
      onChanged(updated.data?.agent_version);
      toast(message);
      return r;
    } catch (e) {
      toast((e as Error).message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const rows =
    q.data?.[
      (
        {
          "HTTP 工具": "agent-http-tool",
          日程: "agent-schedule",
          "API 密钥": "agent-api-key",
          记忆候选: "memory",
        } as Record<string, string>
      )[tab]
    ] || [];
  return (
    <Modal title={`${record.name} · 工具与运行配置`} onClose={onClose} wide>
      <RefTabs
        tabs={["HTTP 工具", "日程", "API 密钥", "记忆候选"]}
        value={tab}
        onChange={setTab}
      />
      {tab !== "记忆候选" && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            setEdit({
              name: "",
              description: "",
              url: "",
              method: "GET",
              read_only: true,
              schema:
                '{"type":"object","properties":{},"additionalProperties":false}',
              project_id: projects.data?.items?.[0]?.id || "",
              budget: record.data.budget || 100,
              interval_minutes: 60,
              max_runs: 1,
              starts_at: new Date(
                Date.now() + 300000 - new Date().getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16),
              instruction: "",
              expires_days: 30,
            })
          }
        >
          新增{tab === "HTTP 工具" ? "工具" : tab === "日程" ? "日程" : "密钥"}
        </button>
      )}
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : rows.length ? (
        rows.map((r: any) => (
          <article className="pw-card" key={r.id}>
            <div className="ref-toolbar">
              <strong>{r.name}</strong>
              <Status value={r.status} />
              <small>
                v{r.version} · {formatTime(r.created_at)}
              </small>
            </div>
            {tab === "HTTP 工具" && (
              <>
                <p>
                  {r.data.method} {r.data.url}
                </p>
                <p>
                  {r.data.read_only ? "已确认只读" : "每次执行须由用户确认"} ·{" "}
                  {r.data.description}
                </p>
                <button
                  className="button secondary"
                  onClick={() =>
                    setEdit({
                      ...r.data,
                      id: r.id,
                      expected_version: r.version,
                      schema: JSON.stringify(r.data.parameters, null, 2),
                      bearer_token: "",
                    })
                  }
                >
                  编辑
                </button>
              </>
            )}
            {tab === "日程" && (
              <>
                <p>
                  每 {r.data.interval_minutes} 分钟；已提交 {r.data.runs}/
                  {r.data.max_runs} 次；单次上限 {r.data.budget} 算力
                </p>
                <p>
                  下次 {formatTime(r.data.next_run)} · {r.data.instruction}
                </p>
                {r.data.error && <p>{r.data.error}</p>}
              </>
            )}
            {tab === "API 密钥" && (
              <>
                <p>
                  {r.data.prefix}… · 到期 {formatTime(r.data.expires_at)}
                </p>
                <code>/api/v1/agent-api/{record.id}/runs</code>
                <p>
                  仅用于绑定作品；请求头 X-Agent-Key、Idempotency-Key，JSON
                  请求体含 instruction。
                </p>
              </>
            )}
            {tab === "记忆候选" ? (
              <>
                <p>{r.data.content}</p>
                <blockquote>{r.data.quote}</blockquote>
                {r.status === "pending" && (
                  <div className="ref-toolbar">
                    {[true, false].map((approve) => (
                      <button
                        className="button secondary"
                        key={String(approve)}
                        disabled={busy}
                        onClick={() =>
                          act(
                            () =>
                              post(`/agent-memories/${r.id}/decision`, {
                                expected_version: r.version,
                                approve,
                              }),
                            "记忆候选已处理",
                          )
                        }
                      >
                        {approve ? "确认后用于召回" : "拒绝"}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <DeleteButton
                confirmation="inline"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      api(
                        `/admin/agents/${record.id}/extensions/${r.id}?expected_version=${r.version}`,
                        { method: "DELETE" },
                      ),
                    "已撤销配置",
                  )
                }
              >
                {tab === "日程"
                  ? "停止日程"
                  : tab === "API 密钥"
                    ? "撤销密钥"
                    : "删除工具"}
              </DeleteButton>
            )}
          </article>
        ))
      ) : (
        <RefEmpty text="暂无配置或候选" />
      )}
      {edit && (
        <Modal
          title={`新增或编辑${tab}`}
          onClose={() => setEdit(null)}
          footer={
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  let result;
                  if (tab === "HTTP 工具")
                    result = await put(
                      `/admin/agents/${record.id}/http-tools/${edit.id || "new"}`,
                      {
                        name: edit.name,
                        description: edit.description,
                        url: edit.url,
                        method: edit.method,
                        read_only: edit.read_only,
                        parameters: JSON.parse(edit.schema),
                        bearer_token: edit.bearer_token || "",
                        expected_version: edit.expected_version || 0,
                      },
                    );
                  else if (tab === "API 密钥") {
                    result = await post(`/admin/agents/${record.id}/api-keys`, {
                      project_id: edit.project_id,
                      name: edit.name,
                      budget: Number(edit.budget),
                      expires_days: Number(edit.expires_days),
                    });
                    setToken(result.token);
                  } else
                    result = await post(
                      `/admin/agents/${record.id}/schedules`,
                      {
                        project_id: edit.project_id,
                        instruction: edit.instruction,
                        interval_minutes: Number(edit.interval_minutes),
                        max_runs: Number(edit.max_runs),
                        budget: Number(edit.budget),
                        starts_at: new Date(edit.starts_at).toISOString(),
                      },
                    );
                  setEdit(null);
                  return result;
                }, "配置已保存")
              }
            >
              保存
            </button>
          }
        >
          {tab === "HTTP 工具" ? (
            <>
              <label className="field">
                工具名（字母、数字、下划线）
                <input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label className="field">
                说明
                <textarea
                  value={edit.description}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                />
              </label>
              <label className="field">
                固定服务地址
                <input
                  value={edit.url}
                  onChange={(e) => setEdit({ ...edit, url: e.target.value })}
                />
              </label>
              <label className="field">
                方法
                <select
                  value={edit.method}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      method: e.target.value,
                      read_only: e.target.value === "GET",
                    })
                  }
                >
                  <option>GET</option>
                  <option>POST</option>
                </select>
              </label>
              <label className="field">
                Bearer 密钥（留空保留）
                <input
                  type="password"
                  value={edit.bearer_token || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, bearer_token: e.target.value })
                  }
                />
              </label>
              <label className="field">
                参数 JSON Schema
                <textarea
                  rows={6}
                  value={edit.schema}
                  onChange={(e) => setEdit({ ...edit, schema: e.target.value })}
                />
              </label>
              <label className="ref-switch-row">
                已核实为只读查询
                <input
                  type="checkbox"
                  checked={edit.read_only}
                  onChange={(e) =>
                    setEdit({ ...edit, read_only: e.target.checked })
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                绑定作品
                <select
                  value={edit.project_id}
                  onChange={(e) =>
                    setEdit({ ...edit, project_id: e.target.value })
                  }
                >
                  <option value="">选择你的作品</option>
                  {projects.data?.items?.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                单次算力上限
                <input
                  type="number"
                  min={1}
                  value={edit.budget}
                  onChange={(e) => setEdit({ ...edit, budget: e.target.value })}
                />
              </label>
              {tab === "API 密钥" ? (
                <>
                  <label className="field">
                    密钥名称
                    <input
                      value={edit.name}
                      onChange={(e) =>
                        setEdit({ ...edit, name: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    有效天数（最多 90）
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={edit.expires_days}
                      onChange={(e) =>
                        setEdit({ ...edit, expires_days: e.target.value })
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    任务内容
                    <textarea
                      value={edit.instruction}
                      onChange={(e) =>
                        setEdit({ ...edit, instruction: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    开始时间
                    <input
                      type="datetime-local"
                      value={edit.starts_at}
                      onChange={(e) =>
                        setEdit({ ...edit, starts_at: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    间隔分钟
                    <input
                      type="number"
                      min={5}
                      value={edit.interval_minutes}
                      onChange={(e) =>
                        setEdit({ ...edit, interval_minutes: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    最多次数
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={edit.max_runs}
                      onChange={(e) =>
                        setEdit({ ...edit, max_runs: e.target.value })
                      }
                    />
                  </label>
                  <p>
                    最多预期预算 {Number(edit.budget) * Number(edit.max_runs)}{" "}
                    算力；每次执行还会检查作品与账户余额。智能体配置变化时暂停。
                  </p>
                </>
              )}
            </>
          )}
        </Modal>
      )}
      {token && (
        <Modal title="密钥已创建 · 仅展示一次" onClose={() => setToken("")}>
          <p>复制并妥善保存此密钥。关闭后无法再次查看，可以撤销后重新创建。</p>
          <textarea readOnly value={token} aria-label="新建智能体密钥" />
        </Modal>
      )}
    </Modal>
  );
}

export function ToolApprovals({
  runId,
  budget = 100,
  onContinue,
}: {
  runId: string;
  budget?: number;
  onContinue?: (id: string) => void;
}) {
  const toast = useToast(),
    [busy, setBusy] = useState(false),
    q = useQuery({
      queryKey: ["tool-approvals", runId],
      queryFn: () => api(`/runs/${runId}/tool-approvals`),
      enabled: !!runId,
      refetchInterval: 3000,
    });
  if (!runId || !q.data?.items?.length) return null;
  return (
    <div>
      {onContinue &&
        q.data.items.some((r: any) => r.status === "completed") &&
        q.data.items.every((r: any) =>
          ["completed", "rejected"].includes(r.status),
        ) && (
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await post(`/runs/${runId}/continue-tools`, {
                  budget,
                });
                onContinue(r.id);
                toast("已用确认结果继续，完成的操作不会重复执行");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            用已确认结果继续（预算 {budget}）
          </button>
        )}
      {q.data.items.map((r: any) => (
        <article className="pw-card" key={r.id}>
          <strong>{r.name} · 外部操作</strong>
          <Status value={r.status} />
          <pre>{JSON.stringify(r.arguments, null, 2)}</pre>
          {r.status === "pending" && (
            <div className="ref-toolbar">
              {[true, false].map((approve) => (
                <button
                  className="button secondary"
                  key={String(approve)}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const v = await post(`/tool-approvals/${r.id}`, {
                        expected_version: r.version,
                        approve,
                      });
                      await q.refetch();
                      toast(
                        v.status === "unknown"
                          ? "结果不明，请人工核对；不会重复发送"
                          : "操作已处理",
                      );
                    } catch (e) {
                      toast((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {approve ? "确认执行这次操作" : "拒绝"}
                </button>
              ))}
            </div>
          )}
          {r.result && <pre>{JSON.stringify(r.result, null, 2)}</pre>}
          {r.data.message && <p>{r.data.message}</p>}
        </article>
      ))}
    </div>
  );
}
