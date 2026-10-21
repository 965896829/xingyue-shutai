"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, put } from "@reference/lib/api";
import { ErrorState, useToast } from "./ui";

const types = [
  ["read", "查看"],
  ["write", "新增 / 修改"],
  ["delete", "删除"],
  ["execute", "执行操作"],
  ["export", "导出"],
];
export function RoleActionPermissions({ role }: { role: string }) {
  const q = useQuery({
      queryKey: ["roles"],
      queryFn: () => api("/admin/system/roles"),
    }),
    catalog = useQuery({
      queryKey: ["catalog"],
      queryFn: () => api("/admin/catalog"),
    }),
    toast = useToast();
  const [actions, setActions] = useState<Record<string, string[]>>({}),
    [busy, setBusy] = useState(false);
  const row = q.data?.items.find((r: any) => r.role === role);
  useEffect(() => setActions(row?.actions || {}), [role, row]);
  return (
    <details className="ref-box">
      <summary>页面操作权限</summary>
      <p className="ref-field-help">
        对已保存的菜单进一步限制。未单独设置的菜单沿用角色默认权限；“执行操作”还需要“新增
        / 修改”。评测人员仍禁止修改业务数据。
      </p>
      {q.error && <ErrorState error={q.error} />}
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>已授权菜单</th>
              {types.map(([k, n]) => (
                <th key={k}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.data?.pages
              .filter((p: any) => row?.pages.includes(p.key))
              .map((p: any) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  {types.map(([key, name]) => (
                    <td key={key}>
                      <input
                        type="checkbox"
                        aria-label={`${p.label} ${name}`}
                        disabled={
                          role === "superadmin" ||
                          (role === "evaluator" &&
                            !["read", "export"].includes(key))
                        }
                        checked={
                          (actions[p.key] || types.map((t) => t[0])).includes(
                            key,
                          ) &&
                          (role !== "evaluator" ||
                            ["read", "export"].includes(key))
                        }
                        onChange={(e) =>
                          setActions((v) => ({
                            ...v,
                            [p.key]: e.target.checked
                              ? [...(v[p.key] || types.map((t) => t[0])), key]
                              : (v[p.key] || types.map((t) => t[0])).filter(
                                  (t) => t !== key,
                                ),
                          }))
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <button
        className="button primary"
        disabled={busy || !row || role === "superadmin"}
        onClick={async () => {
          setBusy(true);
          try {
            await put(`/admin/system/roles/${role}`, {
              pages: row.pages,
              actions,
              expected_version: row.version,
            });
            await q.refetch();
            toast("操作权限已保存");
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        保存操作权限
      </button>
    </details>
  );
}
