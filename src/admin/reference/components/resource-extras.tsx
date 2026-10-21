"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Plus, LogOut, ShieldCheck } from "lucide-react";
import {
  api,
  post,
  formatTime,
  formatNumber,
  type DataRecord,
} from "@reference/lib/api";
import { Drawer, useToast, Spinner, Status } from "./ui";

export function ResourceExtras({ kind }: { kind: string }) {
  const [open, setOpen] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(10),
    [credits, setCredits] = useState(1000);
  const toast = useToast(),
    cache = useQueryClient();
  if (!["users", "redeem-codes"].includes(kind)) return null;
  async function preview() {
    if (!file) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.append("file", file);
      setResult(
        await api("/admin/users/import?dry_run=true", {
          method: "POST",
          body: data,
        }),
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    try {
      if (kind === "users") {
        if (!file) return;
        const data = new FormData();
        data.append("file", file);
        const r = await api("/admin/users/import?dry_run=false", {
          method: "POST",
          body: data,
        });
        toast(`已导入 ${r.imported} 个用户`);
      } else {
        const r = await post("/admin/redeem-codes/batch", {
          count,
          data: { credits, max_uses: 1 },
        });
        toast(`已生成 ${r.count} 个兑换码，可从列表导出`);
      }
      cache.invalidateQueries({ queryKey: ["records"] });
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 15,
        }}
      >
        <button
          className="button secondary small"
          onClick={() => {
            setOpen(true);
            setResult(null);
          }}
        >
          {kind === "users" ? <Upload size={14} /> : <Plus size={14} />}{" "}
          {kind === "users" ? "批量导入用户" : "批量生成兑换码"}
        </button>
      </div>
      {open && (
        <Drawer
          title={kind === "users" ? "批量导入用户" : "批量生成兑换码"}
          onClose={() => setOpen(false)}
          footer={
            <button
              className="button primary"
              disabled={
                busy ||
                (kind === "users" && (!result || result.errors.length > 0))
              }
              onClick={commit}
            >
              确认{kind === "users" ? "导入" : "生成"}
            </button>
          }
        >
          {kind === "users" ? (
            <>
              <p className="backup-note">
                UTF-8 CSV
                表头：username,nickname,password,role,email,phone,status。角色默认
                author，密码至少 10 位；错误行修复后整批提交。
              </p>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setResult(null);
                }}
              />
              <button
                className="button secondary"
                style={{ marginTop: 16 }}
                disabled={busy || !file}
                onClick={preview}
              >
                预览与校验
              </button>
              {result && (
                <>
                  <div className="info-strip">
                    共 {result.total} 行，{result.valid} 行通过校验
                  </div>
                  {result.errors.map((e: any) => (
                    <p className="backup-note" key={e.row}>
                      第 {e.row} 行 · {e.username}：{e.error}
                    </p>
                  ))}
                  {result.preview.map((r: any) => (
                    <div className="finding" key={r.username}>
                      {r.username} · {r.nickname} · {r.role}
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <label className="field">
                <span>生成数量（1–500）</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>每码兑换算力</span>
                <input
                  type="number"
                  min={1}
                  value={credits}
                  onChange={(e) => setCredits(Number(e.target.value))}
                />
              </label>
              <p className="backup-note">
                每个兑换码使用安全随机值，各允许兑换一次。兑换与额度发放一起提交。
              </p>
            </>
          )}
        </Drawer>
      )}
    </>
  );
}
export function UserActivity({ user }: { user: DataRecord }) {
  const query = useQuery({
      queryKey: ["user-activity", user.id],
      queryFn: () => api(`/admin/users/${user.id}/activity`),
    }),
    toast = useToast();
  if (query.isPending) return <Spinner />;
  return (
    <>
      <div className="info-strip">
        <ShieldCheck size={16} />
        有效会话 {query.data?.sessions || 0} 个 · 作品{" "}
        {query.data?.projects?.length || 0} 部
      </div>
      <button
        className="button secondary small"
        onClick={async () => {
          try {
            await post(`/admin/users/${user.id}/sessions/revoke`);
            toast("此账号的会话已撤销");
            query.refetch();
          } catch (e) {
            toast((e as Error).message, true);
          }
        }}
      >
        <LogOut size={14} />
        撤销登录会话
      </button>
      <h3 style={{ marginTop: 25 }}>最近额度记录</h3>
      {query.data?.ledger.map((r: any) => (
        <div className="finding" key={r.id}>
          <strong>
            {r.kind} · {r.amount > 0 ? "+" : ""}
            {formatNumber(r.amount)}
          </strong>
          <p>
            {formatTime(r.created_at)} · 结算后 {r.balance_after}
          </p>
        </div>
      ))}
    </>
  );
}
