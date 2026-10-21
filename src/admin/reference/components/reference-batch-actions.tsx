"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, formatTime, type DataRecord } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { Spinner, ErrorState, useToast } from "./ui";
export function ReferenceBatchActions({
  kind,
  rows,
  selected,
  refresh,
}: {
  kind: string;
  rows: DataRecord[];
  selected: string[];
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false),
    [values, setValues] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    toast = useToast();
  const chosen = rows.filter((r) => selected.includes(r.id));
  if (kind === "subscriptions")
    return (
      <a
        className="button secondary"
        href="/api/v1/admin/reference/subscriptions/orders-export"
      >
        导出扣款订单
      </a>
    );
  if (kind !== "orders") return null;
  return (
    <>
      <button
        className="button secondary"
        disabled={!chosen.length}
        onClick={() => {
          setOpen(true);
          setValues({});
        }}
      >
        批量开票（{chosen.length}）
      </button>
      {open && (
        <Modal
          title="批量登记开票结果"
          wide
          onClose={() => setOpen(false)}
          footer={
            <button
              className="button primary"
              disabled={
                busy ||
                chosen.some(
                  (r) =>
                    r.status !== "paid" ||
                    r.data.invoice_status === "issued" ||
                    !values[r.id]?.trim(),
                )
              }
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await post("/admin/orders/invoices/batch", {
                    entries: chosen.map((r) => ({
                      id: r.id,
                      version: r.version,
                      invoice_number: values[r.id],
                    })),
                  });
                  refresh();
                  setOpen(false);
                  toast(`已登记 ${result.count} 份实际发票`);
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              提交本批次
            </button>
          }
        >
          <p className="ref-description">
            填写实际发票号码。所有订单核对通过后一起提交；此操作登记开票结果，不代替税务开票。
          </p>
          <div className="ref-form">
            {chosen.map((r) => (
              <label className="field" key={r.id}>
                <span>
                  {r.id} · {r.user_display || r.data.user_id}
                  {r.status !== "paid"
                    ? " · 尚未付款"
                    : r.data.invoice_status === "issued"
                      ? " · 已开票"
                      : ""}
                </span>
                <input
                  aria-label={`订单 ${r.id} 发票号码`}
                  value={values[r.id] || ""}
                  onChange={(e) =>
                    setValues({ ...values, [r.id]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
export function RedemptionHistory({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["redeem-history", id],
    queryFn: () => api(`/admin/reference/redeem-codes/${id}/history`),
  });
  return (
    <section>
      <h3>兑换历史</h3>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data.items.length ? (
        q.data.items.map((r: DataRecord) => (
          <p key={r.id}>
            {formatTime(r.created_at)} · 用户 {r.data.user_id} ·{" "}
            {r.data.credits} 算力
          </p>
        ))
      ) : (
        <p className="muted">
          尚无带时间的兑换事件。历史计数仍保留在兑换码记录中。
        </p>
      )}
    </section>
  );
}
