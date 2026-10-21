"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, formatTime } from "@reference/lib/api";
import { Drawer, useToast } from "./ui";
export function Reconciliation() {
  const q = useQuery({
      queryKey: ["reconciliation-runs"],
      queryFn: () => api("/admin/runs?state=pending_reconciliation"),
      refetchInterval: 15000,
    }),
    cache = useQueryClient(),
    toast = useToast();
  const [run, setRun] = useState<any>(null),
    [credits, setCredits] = useState(0),
    [proof, setProof] = useState(""),
    [busy, setBusy] = useState(false);
  if (!q.data?.items.length) return null;
  return (
    <section className="panel" style={{ padding: 24, marginBottom: 22 }}>
      <h2>待核对的供应商调用</h2>
      <p className="backup-note">
        费用不确定时保持额度预留。核对供应商记录后填写实际算力与凭证，再释放剩余额度。
      </p>
      {q.data.items.map((r: any) => (
        <div className="recent-item" key={r.id}>
          <div className="recent-title">
            <strong>{r.name}</strong>
            {r.recovery_request?.status==="requested"&&<span>作者已提交后台核对 · {formatTime(r.recovery_request.requested_at)}</span>}
            <span>
              {formatTime(r.created_at)} · 授权预算 {r.budget}
            </span>
          </div>
          <button
            className="button secondary small"
            onClick={() => {
              setRun(r);
              setCredits(0);
              setProof("");
            }}
          >
            核对费用
          </button>
        </div>
      ))}
      {run && (
        <Drawer
          title="核对实际用量"
          subtitle={run.id}
          onClose={() => setRun(null)}
          footer={
            <button
              className="button primary"
              disabled={
                busy ||
                proof.trim().length < 8 ||
                credits < 0 ||
                credits > run.budget
              }
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/admin/runs/${run.id}/reconcile`, {
                    credits,
                    proof,
                  });
                  cache.invalidateQueries({
                    queryKey: ["reconciliation-runs"],
                  });
                  cache.invalidateQueries({ queryKey: ["records"] });
                  setRun(null);
                  toast("费用已结算，剩余预留已释放");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认结算
            </button>
          }
        >
          <label className="field">
            <span>实际算力（不超过 {run.budget}）</span>
            <input
              type="number"
              min={0}
              max={run.budget}
              value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>供应商流水号、账单或核对凭证</span>
            <textarea
              rows={5}
              value={proof}
              onChange={(e) => setProof(e.target.value)}
            />
          </label>
        </Drawer>
      )}
    </section>
  );
}
