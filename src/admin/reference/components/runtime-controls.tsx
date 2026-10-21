"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, put, formatTime } from "@reference/lib/api";
import {
  CompactHeading,
  Modal,
  SearchBox,
  RefPagination,
  RefEmpty,
} from "./reference-ui";
import { ErrorState, Spinner, useToast } from "./ui";
import { Reconciliation } from "./reconciliation";
import { ConsumptionHeatmap } from "./consumption-heatmap";

const actionNames: Record<string, string> = {
  cooldown: "冷却",
  degrade: "降级",
  restore: "恢复",
  clear_queue: "清队列",
  reset: "重置",
};
export function RuntimeLoad() {
  const q = useQuery({
      queryKey: ["model-load"],
      queryFn: () => api("/admin/model-load"),
      refetchInterval: 5000,
    }),
    toast = useToast();
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(12),
    [action, setAction] = useState<any>(null),
    [reason, setReason] = useState(""),
    [seconds, setSeconds] = useState(60),
    [penalty, setPenalty] = useState(1000),
    [busy, setBusy] = useState(false);
  const rows = (q.data?.items || []).filter((r: any) =>
    (r.model + r.platform).toLowerCase().includes(search.toLowerCase()),
  );
  async function submit() {
    setBusy(true);
    try {
      const r = await post(
        `/admin/model-load/${action.row.platform_id}/action`,
        {
          model: action.row.model,
          expected_version: action.row.version,
          action: action.name,
          reason,
          seconds,
          priority_penalty: penalty,
        },
      );
      toast(
        action.name === "clear_queue"
          ? `已取消 ${r.cancelled_count} 个等待任务`
          : "调度控制已生效",
      );
      setAction(null);
      await q.refetch();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ref-page">
      <CompactHeading
        title="平台模型实时负载"
        description="有效优先级数字越小越优先；并发按平台模型共享。"
        actions={
          <>
            <span className="muted">
              更新于 {formatTime(q.data?.updated_at)}
            </span>
            <button className="button secondary" onClick={() => q.refetch()}>
              刷新
            </button>
          </>
        }
      />
      <ConsumptionHeatmap />
      <div className="ref-toolbar">
        <SearchBox
          value={search}
          onChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
          placeholder="搜索模型 / 平台"
        />
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          <div className="ref-table-wrap">
            <table className="ref-table">
              <thead>
                <tr>
                  {[
                    "模型",
                    "平台",
                    "状态",
                    "有效优先级",
                    "满载率",
                    "并发",
                    "TPM",
                    "RPM",
                    "队列",
                    "操作",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * size, page * size).map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.model}</td>
                    <td>{r.platform}</td>
                    <td>
                      {
                        (
                          {
                            active: "正常",
                            disabled: "已停用",
                            cooldown: "冷却中",
                            degraded: "已降级",
                          } as Record<string, string>
                        )[r.status]
                      }
                      {r.cooldown_until && (
                        <small className="ref-row-subtitle">
                          至 {formatTime(r.cooldown_until)}
                        </small>
                      )}
                    </td>
                    <td>{r.priority}</td>
                    <td>{r.load === null ? "—" : `${r.load}%`}</td>
                    <td>
                      {r.concurrency ?? "—"} / {r.limits.concurrency}
                    </td>
                    <td>
                      {r.tpm ?? "—"} / {r.limits.tpm}
                    </td>
                    <td>
                      {r.rpm ?? "—"} / {r.limits.rpm}
                    </td>
                    <td>
                      {r.queue} / {r.shared_queue}
                    </td>
                    <td>
                      <div className="ref-row-actions">
                        {Object.entries(actionNames).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => {
                              setAction({ row: r, name: key });
                              setReason("");
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={10}>
                      <RefEmpty />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <RefPagination
            page={page}
            size={size}
            total={rows.length}
            onPage={setPage}
            onSize={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
          <p className="ref-data-note">{q.data.note}</p>
        </>
      )}
      {action && (
        <Modal
          title={actionNames[action.name]}
          onClose={() => setAction(null)}
          footer={
            <button
              className="button primary"
              disabled={busy || reason.trim().length < 2}
              onClick={submit}
            >
              确认{actionNames[action.name]}
            </button>
          }
        >
          <p>
            {action.row.platform} · {action.row.model}
          </p>
          <div className="ref-form">
            {action.name === "cooldown" && (
              <label className="field">
                <span>冷却秒数</span>
                <input
                  type="number"
                  min={1}
                  max={86400}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                />
              </label>
            )}
            {action.name === "degrade" && (
              <label className="field">
                <span>优先级增加值</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={penalty}
                  onChange={(e) => setPenalty(Number(e.target.value))}
                />
              </label>
            )}
            {action.name === "clear_queue" && (
              <p className="ref-notice">
                取消绑定此平台、尚未开始的任务并释放其预算。已发送的请求继续保留。
              </p>
            )}
            {action.name === "reset" && (
              <p>清除手工冷却和降级；活动并发、限流计数与费用记录保留。</p>
            )}
            <label className="field">
              <span>操作原因</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
        </Modal>
      )}
      <Reconciliation />
    </div>
  );
}

export function GlobalRuntimePolicy() {
  const q = useQuery({
      queryKey: ["runtime-global"],
      queryFn: () => api("/admin/runtime-global"),
    }),
    toast = useToast(),
    [form, setForm] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setForm({ ...q.data.data, expected_version: q.data.version });
  }, [q.data]);
  if (q.error) return <ErrorState error={q.error} />;
  if (q.isPending || !form) return <Spinner />;
  return (
    <section className="ref-box">
      <h3>全局调度策略</h3>
      <p className="ref-description">
        未单独配置的模型采用这些默认值。平台绑定策略、模型策略分别覆盖默认限额。
      </p>
      <div className="ref-form">
        {Object.entries({
          rpm: "每分钟请求上限",
          tpm: "每分钟 Token 上限",
          concurrency: "最大并发",
          timeout: "超时秒数",
          retry_limit: "安全切换次数（0–3）",
          failure_cooldown: "连接失败冷却秒数",
        }).map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              type="number"
              min={key === "retry_limit" || key === "failure_cooldown" ? 0 : 1}
              max={key === "retry_limit" ? 3 : undefined}
              value={form[key]}
              onChange={(e) =>
                setForm({ ...form, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label className="field">
          <span>分配策略</span>
          <select
            value={form.strategy}
            onChange={(e) => setForm({ ...form, strategy: e.target.value })}
          >
            <option value="priority">优先级</option>
            <option value="round_robin">轮询</option>
            <option value="least_load">较低负载</option>
          </select>
        </label>
        <label className="ref-checkbox">
          <input
            type="checkbox"
            checked={form.failover_enabled}
            onChange={(e) =>
              setForm({ ...form, failover_enabled: e.target.checked })
            }
          />
          允许明确未受理请求切换平台
        </label>
        <p className="ref-notice">
          读取超时、响应不完整等情况保留费用核对状态。手动指定平台的请求不会改投其他平台。
        </p>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await put("/admin/runtime-global", form);
              await q.refetch();
              toast("全局调度策略已保存");
            } catch (e) {
              toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存全局策略
        </button>
      </div>
    </section>
  );
}
