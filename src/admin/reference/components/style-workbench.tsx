"use client";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put, formatTime } from "@reference/lib/api";
import { ErrorState, Spinner, useToast } from "./ui";
const labels: Record<string, string> = {
  sentence_rhythm: "句式与节奏",
  diction: "用词",
  dialogue: "对白",
  imagery: "意象与修辞",
  narrative_distance: "叙事距离",
  pace: "推进速度",
  preserve: "保留特征",
  avoid: "避免特征",
};
export function StyleWorkbench({
  pid,
  admin = false,
  model = "sandbox-writer",
  budget = 100,
}: {
  pid: string;
  admin?: boolean;
  model?: string;
  budget?: number;
}) {
  const path = `${admin ? "/admin/structured" : "/studio"}/projects/${pid}/style-profile`,
    q = useQuery({
      queryKey: ["style-profile", path],
      queryFn: () => api(path),
    }),
    cache = useQueryClient(),
    toast = useToast(),
    [form, setForm] = useState<any>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false);
  const h = useQuery({
    queryKey: ["style-history", path],
    queryFn: () => api(path + "/versions"),
    enabled: history,
  });
  const w = useQuery({
    queryKey: ["style-runs", pid],
    queryFn: () => api(`/studio/projects/${pid}/workspace`),
    enabled: !admin,
    refetchInterval: (q) =>
      q.state.data?.runs.some(
        (r: any) =>
          r.kind === "style-extract" && ["queued", "running"].includes(r.state),
      )
        ? 1500
        : false,
  });
  const latest = w.data?.runs.find((r: any) => r.kind === "style-extract");
  useEffect(() => {
    if (latest && !["queued", "running"].includes(latest.state)) q.refetch();
  }, [latest?.id, latest?.state]);
  useEffect(() => {
    if (q.data)
      setForm({
        traits: q.data.traits,
        sample_ids: q.data.sample_ids,
        expected_version: q.data.version,
        proposal_id: null,
      });
  }, [q.data]);
  async function act(fn: () => Promise<any>, msg: string) {
    setBusy(true);
    try {
      await fn();
      await cache.invalidateQueries();
      toast(msg);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (q.error) return <ErrorState error={q.error} />;
  if (!form) return <Spinner />;
  return (
    <section className="mw pw-settings">
      <div className="mw-heading">
        <h3>我的文风</h3>
        <span>
          {q.data.status === "active" ? "已确认应用" : "尚未应用"}
          {q.data.has_draft ? " · 有待确认草稿" : ""}
        </span>
      </div>
      <p>
        从授权样例提取特征，编辑并确认后用于正文生成。撤去样例后，关联文风偏好和正文提示复核。
      </p>
      {q.data.needs_recheck && (
        <p className="mw-alert">
          样例已删除或修改，请重新抽取或移除失效引用后确认。
        </p>
      )}
      <div className="pw-actions">
        {!admin && (
          <button
            className="mw-button"
            disabled={
              busy ||
              !q.data.samples.length ||
              ["queued", "running"].includes(latest?.state)
            }
            onClick={() =>
              act(
                () =>
                  post(`/projects/${pid}/runs`, {
                    kind: "style-extract",
                    budget,
                    input: { model },
                  }),
                "风格抽取任务已提交",
              )
            }
          >
            从授权样例提取
          </button>
        )}
        <button className="mw-button" onClick={() => setHistory(!history)}>
          修改历史
        </button>
      </div>
      {!!q.data.proposals.length && (
        <label>
          使用抽取提案
          <select
            value={form.proposal_id || ""}
            onChange={(e) => {
              const p = q.data.proposals.find(
                (p: any) => p.id === e.target.value,
              );
              if (p)
                setForm({
                  ...form,
                  traits: p.traits,
                  sample_ids: p.sample_ids,
                  proposal_id: p.id,
                });
            }}
          >
            <option value="">手动编辑</option>
            {q.data.proposals.map((p: any, index: number) => (
              <option key={p.id} value={p.id}>
                {p.environment === "sandbox" ? "演示模式" : "新文风建议"} ·{" "}
                第 {index + 1} 份
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mw-grid">
        {Object.entries(labels).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              value={form.traits[key] || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  traits: { ...form.traits, [key]: e.target.value },
                })
              }
            />
          </label>
        ))}
      </div>
      <label>
        绑定的授权样例
        <select
          multiple
          value={form.sample_ids}
          onChange={(e) =>
            setForm({
              ...form,
              sample_ids: Array.from(e.target.selectedOptions).map(
                (o) => o.value,
              ),
            })
          }
        >
          {q.data.samples.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {form.sample_ids
            .filter(
              (id: string) => !q.data.samples.some((s: any) => s.id === id),
            )
            .map((id: string) => (
              <option key={id} value={id}>
                样例已失效，请移除
              </option>
            ))}
        </select>
      </label>
      <label>
        修改原因
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="pw-actions">
        <button
          className="mw-button"
          disabled={busy || reason.trim().length < 2}
          onClick={() =>
            act(
              () => put(path, { ...form, confirm: false, reason }),
              "文风草稿已保存",
            )
          }
        >
          保存草稿
        </button>
        <button
          className="mw-button primary"
          disabled={busy || reason.trim().length < 2}
          onClick={() =>
            act(
              () => put(path, { ...form, confirm: true, reason }),
              "我的文风已确认",
            )
          }
        >
          确认应用
        </button>
      </div>
      {history &&
        h.data?.items.map((r: any) => (
          <article className="pw-card" key={r.id}>
            <p>
              v{r.version} · {formatTime(r.created_at)} · {r.reason}
            </p>
            <button
              className="mw-button"
              onClick={() => {
                setForm({
                  ...form,
                  traits: r.snapshot.traits,
                  sample_ids: Object.keys(r.snapshot.sample_refs || {}),
                  proposal_id: null,
                });
                setReason("基于历史版本恢复我的文风");
              }}
            >
              基于此版本编辑
            </button>
          </article>
        ))}
    </section>
  );
}
