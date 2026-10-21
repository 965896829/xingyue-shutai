"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, formatTime } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { ErrorState, Status, useToast } from "./ui";

export function PaymentCheckout({
  checkout,
  onClose,
}: {
  checkout: any;
  onClose: () => void;
}) {
  return (
    <Modal title="支付信息" onClose={onClose}>
      <p>仅在渠道确认到账后发放本地权益。请核对收款商户、金额与币种。</p>
      {checkout.url && (
        <a
          className="button primary"
          href={checkout.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          打开支付平台
        </a>
      )}
      {checkout.qr_image && (
        <img
          src={checkout.qr_image}
          alt="微信支付二维码"
          style={{
            display: "block",
            width: 260,
            maxWidth: "100%",
            background: "white",
            margin: "16px auto",
          }}
        />
      )}
      {checkout.external_id && (
        <p className="muted">平台订单号：{checkout.external_id}</p>
      )}
      {checkout.provider === "paypal" && (
        <p>付款人完成授权后，管理员可在支付记录中确认收款。</p>
      )}
    </Modal>
  );
}

export function PaymentOperations() {
  const q = useQuery({
      queryKey: ["payment-operations"],
      queryFn: () => api("/admin/payments/operations"),
      refetchInterval: 10000,
    }),
    cache = useQueryClient(),
    toast = useToast();
  const [checkout, setCheckout] = useState<any>(null),
    [check, setCheck] = useState<any>(null),
    [externalId, setExternalId] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details className="ref-box">
      <summary>支付与退款处理记录</summary>
      <p className="ref-field-help">
        外部受理不明时保留记录；退款中的未使用权益会冻结，确认退款后才撤回。这里的查询只核对现有渠道记录。
      </p>
      {q.error && <ErrorState error={q.error} />}
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>订单</th>
              <th>操作</th>
              <th>状态</th>
              <th>说明</th>
              <th>时间</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((r: any) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  <small className="muted">{r.order_id.slice(0, 8)}</small>
                </td>
                <td>
                  {
                    (
                      {
                        checkout: "创建支付",
                        capture: "确认收款",
                        refund: "退款",
                      } as any
                    )[r.operation]
                  }
                </td>
                <td>
                  <Status value={r.status} />
                </td>
                <td>{r.message || "—"}</td>
                <td>{formatTime(r.created_at)}</td>
                <td>
                  <div className="ref-row-actions">
                    {r.result?.url || r.result?.qr_image ? (
                      <button
                        className="text-button"
                        onClick={() => setCheckout(r.result)}
                      >
                        支付信息
                      </button>
                    ) : null}
                    <button
                      className="text-button"
                      onClick={() => {
                        setCheck(r);
                        setExternalId(
                          r.result?.external_id || r.result?.reference || "",
                        );
                      }}
                    >
                      查询渠道结果
                    </button>
                    {r.result?.provider === "paypal" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const result = await post(
                              `/admin/payments/orders/${r.order_id}/capture`,
                            );
                            toast(result.paid ? "收款已确认" : "等待渠道确认");
                            await cache.invalidateQueries();
                          } catch (e) {
                            toast((e as Error).message, true);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        确认已授权收款
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.items.length === 0 && (
          <p className="muted">尚无外部支付处理记录</p>
        )}
      </div>
      {checkout && (
        <PaymentCheckout
          checkout={checkout}
          onClose={() => setCheckout(null)}
        />
      )}{" "}
      {check && (
        <Modal
          title="核对渠道结果"
          onClose={() => setCheck(null)}
          footer={
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const endpoint =
                    check.operation === "refund"
                      ? `/admin/payments/refunds/${check.id}/query`
                      : `/admin/payments/orders/${check.order_id}/query`;
                  const result = await post(endpoint, {
                    external_id: externalId,
                  });
                  toast(
                    result.message ||
                      (result.confirmed
                        ? "退款已核对并处理权益"
                        : "渠道暂未确认退款完成"),
                  );
                  await cache.invalidateQueries();
                  setCheck(null);
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              查询并核对
            </button>
          }
        >
          <label className="field">
            支付平台订单号 / 退款号
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
            />
          </label>
          <p>
            受理不明时，可从支付商户后台找到该编号。系统会再次核对订单归属、金额和币种。
          </p>
        </Modal>
      )}
    </details>
  );
}
