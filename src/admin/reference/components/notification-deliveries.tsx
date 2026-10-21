"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, post, formatTime } from "@reference/lib/api";
import { ErrorState, Status, useToast } from "./ui";
import { Modal } from "./reference-ui";

export function NotificationDeliveries() {
  const toast = useToast(),
    [task, setTask] = useState<any>(null),
    [resolution, setResolution] = useState(""),
    [action, setAction] = useState("resolve"),
    [busy, setBusy] = useState(false);
  async function handle(t: any, operation: string) {
    setBusy(true);
    try {
      await post(`/admin/notifications/tasks/${t.id}/action`, {
        expected_version: t.version,
        action: operation,
        resolution,
      });
      await q.refetch();
      setTask(null);
      toast("任务已更新");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const q = useQuery({
    queryKey: ["notification-deliveries"],
    queryFn: () => api("/admin/notifications/deliveries"),
    refetchInterval: 5000,
  });
  return (
    <details className="ref-box">
      <summary>最近发送记录</summary>
      <p className="ref-field-help">
        邮件使用 TLS SMTP；短信、IM 和 Webhook
        使用所配置网关。外部受理不明时保留记录，避免重复发送。
      </p>
      {q.error && <ErrorState error={q.error} />}
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>事件</th>
              <th>渠道</th>
              <th>状态</th>
              <th>结果</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((r: any) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>
                  {(
                    {
                      in_app: "站内",
                      email: "邮件",
                      sms: "短信",
                      im: "IM",
                      webhook: "Webhook",
                    } as any
                  )[r.channel] || r.channel}
                </td>
                <td>
                  <Status value={r.status} />
                </td>
                <td>{r.message || "—"}</td>
                <td>{formatTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.items.length === 0 && <p className="muted">尚无发送记录</p>}
        {!!q.data?.tasks?.length && (
          <>
            <h3>治理任务</h3>
            <table className="ref-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>优先级</th>
                  <th>状态</th>
                  <th>内容</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {q.data.tasks.map((t: any) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      {(
                        {
                          urgent: "紧急",
                          high: "高",
                          medium: "中",
                          low: "低",
                        } as Record<string, string>
                      )[t.priority] || t.priority}
                    </td>
                    <td>
                      <Status value={t.status} />
                    </td>
                    <td>{t.summary}</td>
                    <td>{formatTime(t.created_at)}</td>
                    <td>
                      {t.status === "pending" && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => handle(t, "claim")}
                        >
                          领取
                        </button>
                      )}
                      {["pending", "running"].includes(t.status) ? (
                        <button
                          className="text-button"
                          onClick={() => {
                            setTask(t);
                            setResolution("");
                            setAction("resolve");
                          }}
                        >
                          处理
                        </button>
                      ) : (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => handle(t, "reopen")}
                        >
                          重新打开
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {task && (
        <Modal
          title="处理治理任务"
          onClose={() => setTask(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setTask(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy || !resolution.trim()}
                onClick={() => handle(task, action)}
              >
                保存
              </button>
            </>
          }
        >
          <p>
            {task.name} · {task.summary}
          </p>
          <label className="field">
            处理方式
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="resolve">完成</option>
              <option value="dismiss">关闭</option>
            </select>
          </label>
          <label className="field">
            处理结果
            <textarea
              rows={4}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </label>
        </Modal>
      )}
    </details>
  );
}
