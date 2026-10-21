"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, formatTime } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { useToast } from "./ui";

const labels: Record<string, string> = {
  create: "创建知识库",
  upload: "上传文档",
  rename: "修改名称",
  delete: "删除知识库",
  enable: "启用文档",
  disable: "停用文档",
  remove: "删除文档",
};
export function KnowledgeReconciliation({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const q = useQuery({
    queryKey: ["knowledge-external-operations", id],
    queryFn: () => api(`/admin/knowledge/${id}/external-operations`),
    refetchInterval: 10000,
  });
  const [op, setOp] = useState<any>(null),
    [outcome, setOutcome] = useState("completed"),
    [remote, setRemote] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    toast = useToast();
  if (!q.data?.items?.length) return null;
  return (
    <div className="parity-notice">
      <h3>外部操作待核对</h3>
      <p>受理结果不明的操作暂停重试。核对服务端结果后，再继续上传或同步。</p>
      {q.data.items.map((r: any) => (
        <div className="ref-toolbar" key={r.id}>
          <span>
            {labels[r.operation]} · {formatTime(r.created_at)} · {r.message}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={!r.can_reconcile}
            onClick={() => {
              setOp(r);
              setRemote("");
              setReason("");
              setOutcome("completed");
            }}
          >
            核对结果
          </button>
        </div>
      ))}
      {op && (
        <Modal
          title="核对外部操作结果"
          onClose={() => {
            if (!busy) setOp(null);
          }}
          footer={
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setOp(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy || reason.trim().length < 2}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await post(
                      `/admin/knowledge/${id}/external-operations/${op.id}/reconcile`,
                      {
                        expected_version: op.version,
                        outcome,
                        remote_id: remote.trim(),
                        reason: reason.trim(),
                      },
                    );
                    setOp(null);
                    await q.refetch();
                    onChanged();
                    toast("核对结果已保存");
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认核对结果
              </button>
            </>
          }
        >
          <label className="field">
            远程结果
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="completed">
                操作已完成，由系统读取远程状态验证
              </option>
              <option value="not_applied">
                已人工确认未执行，允许重新提交
              </option>
            </select>
          </label>
          {outcome === "completed" &&
            ["create", "upload"].includes(op.operation) && (
              <label className="field">
                {op.operation === "create" ? "远程知识库 ID" : "远程文档 ID"}
                <input
                  value={remote}
                  onChange={(e) => setRemote(e.target.value)}
                />
              </label>
            )}
          {outcome === "not_applied" && (
            <p>
              请先在知识服务端确认本次操作未执行。保存后可以再次提交；本窗口不会自动重发请求。
            </p>
          )}
          <label className="field">
            核对依据
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="记录查看过的远程状态或服务日志"
            />
          </label>
        </Modal>
      )}
    </div>
  );
}
