"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, type DataRecord } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { ErrorState, Spinner, useToast } from "./ui";
import { DeleteButton } from "./interaction/delete-button";

export function ModelCatalogUpdate({ refresh }: { refresh: () => void }) {
  const q = useQuery({
      queryKey: ["model-catalog-status"],
      queryFn: () => api("/admin/model-catalog/status"),
    }),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    toast = useToast();
  return (
    <>
      <div className="ref-notice ref-toolbar">
        <div>
          <strong>基础模型库</strong>
          <p>
            参考目录快照 {q.data?.version || "…"} · {q.data?.count ?? "—"}{" "}
            个模型 · 随项目版本更新
          </p>
        </div>
        <span className="ref-spacer" />
        <button
          className="button secondary"
          onClick={() => {
            setOpen(true);
            q.refetch();
          }}
        >
          检查更新
        </button>
      </div>
      {open && (
        <Modal
          title="基础模型目录更新"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          wide
          footer={
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !q.data ||
                  q.data.summary.add +
                    q.data.summary.update +
                    q.data.providers_missing ===
                    0
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await post("/admin/model-catalog/apply", {
                      version: q.data.version,
                    });
                    await q.refetch();
                    refresh();
                    toast(
                      `新增 ${r.added} 个模型、${r.providers_added} 个厂商，更新 ${r.updated} 个模型，保留 ${r.preserved_overrides} 项本地修改`,
                    );
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                应用目录更新
              </button>
            </>
          }
        >
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            <>
              <p>
                采集于 {q.data.captured_at}
                。只更新基础模型定义；启用实际调用还需配置平台授权与模型绑定。
              </p>
              <p>
                待新增 {q.data.summary.add} · 待更新 {q.data.summary.update} ·
                已是当前版本 {q.data.summary.current} · 同名自建记录{" "}
                {q.data.summary.conflict}
              </p>
              <p className="ref-field-help">
                管理员自行修改的字段会保留，同名自建记录跳过，不覆盖你的配置。
                同时补齐 {q.data.providers_missing} 个缺失的内置厂商。
              </p>
              <div className="ref-table-wrap">
                <table className="ref-table">
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>厂商</th>
                      <th>更新</th>
                      <th>本地修改</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.changes
                      .filter((r: any) => r.action !== "current")
                      .map((r: any) => (
                        <tr key={r.key}>
                          <td>{r.name}</td>
                          <td>{r.vendor}</td>
                          <td>
                            {
                              (
                                {
                                  add: "新增",
                                  update: "更新",
                                  conflict: "跳过同名自建记录",
                                } as any
                              )[r.action]
                            }
                          </td>
                          <td>{r.overrides.join("、") || "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

export function BaseModelOperation({
  rows,
  kind,
  refresh,
}: {
  rows: DataRecord[];
  kind: "reset" | "delete";
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    toast = useToast();
  return (
    <>
      {kind === "delete" ? (
        <DeleteButton
          className="button secondary"
          confirmation="dialog"
          disabled={!rows.length}
          onClick={() => setOpen(true)}
        >
          删除
        </DeleteButton>
      ) : (
        <button
          className="text-button"
          disabled={!rows.length}
          onClick={() => setOpen(true)}
        >
          重置
        </button>
      )}
      {open && (
        <Modal
          title={kind === "delete" ? "删除所选基础模型" : "重置基础模型"}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <DeleteButton
                destructive={kind === "delete"}
                confirmation="commit"
                className={
                  kind === "delete" ? "button danger" : "button primary"
                }
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await post(`/admin/base-models/${kind}`, {
                      entries: rows.map((r) => ({
                        id: r.id,
                        version: r.version,
                      })),
                      reason:
                        kind === "delete"
                          ? "管理员删除所选基础模型"
                          : "管理员恢复基础模型默认值",
                    });
                    refresh();
                    setOpen(false);
                    toast("操作已完成");
                  } catch (e) {
                    toast((e as Error).message, true);
                    if (kind === "delete") throw e;
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认{kind === "delete" ? "删除" : "重置"}
              </DeleteButton>
            </>
          }
        >
          <p>
            {kind === "delete"
              ? "删除以下基础模型。已有平台绑定的模型需要先解除绑定。"
              : "将以下基础模型恢复为保存的默认配置，并同步继承这些配置的接入模型。"}
          </p>
          <ul>
            {rows.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
