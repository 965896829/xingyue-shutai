"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@reference/lib/api";
import { Modal, RefEmpty, CompactHeading } from "./reference-ui";
import { Spinner, ErrorState, useToast } from "./ui";
import { AuthorModelTrials, ModelRoutingAdmin } from "./model-routing";
import { PreferenceExperiments } from "./preference-experiments";
import { DecodingExperiments } from "./decoding-experiments";

export function QualityEvaluations() {
  const toast = useToast(),
    cache = useQueryClient(),
    [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState<any>({
      preference: "tie",
      familiarity: 3,
      editing_seconds_a: 0,
      editing_seconds_b: 0,
      reason: "",
    });
  const q = useQuery({
      queryKey: ["evaluations"],
      queryFn: () => api("/evaluations"),
    }),
    me = useQuery({ queryKey: ["session"], queryFn: () => api("/auth/me") });
  const item = useQuery({
    queryKey: ["blind-pair", id],
    queryFn: () => api(`/evaluations/${id}`),
    enabled: !!id,
  });
  useEffect(() => {
    if (item.data?.vote) setForm(item.data.vote);
  }, [item.data]);
  const report = useQuery({
    queryKey: ["evaluation-report"],
    queryFn: () => api("/admin/evaluation-report"),
    enabled: me.data?.user?.role === "superadmin",
  });
  const cases = useQuery({
    queryKey: ["evaluation-cases"],
    queryFn: () => api("/evaluations/cases"),
  });
  return (
    <section>
      <CompactHeading
        title="质量盲评"
        description="只展示作者明确授权给你的成对文本；版本来源和配置标签在评分时隐藏。"
      />
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data.items.filter((r: any) => r.assigned).length ? (
        <div className="ref-card-grid">
          {q.data.items
            .filter((r: any) => r.assigned)
            .map((r: any) => (
              <article className="pw-card" key={r.id}>
                <h3>{r.name}</h3>
                <p>
                  {r.genre || "未定题材"} ·{" "}
                  {r.rated ? "已评分，可修订" : "等待评分"}
                </p>
                <button
                  className="button primary"
                  onClick={() => {
                    setId(r.id);
                    setForm({
                      preference: "tie",
                      familiarity: 3,
                      editing_seconds_a: 0,
                      editing_seconds_b: 0,
                      reason: "",
                    });
                  }}
                >
                  查看匿名文本
                </button>
              </article>
            ))}
        </div>
      ) : (
        <RefEmpty text="还没有分配给你的授权样本" />
      )}
      {report.data && (
        <article className="ref-box">
          <h3>人工评测汇总</h3>
          <p>
            {report.data.works} 本作品 · {report.data.rated_pairs}{" "}
            对有效评分样本
          </p>
          <div className="ref-overview-stats">
            {[
              ["enhanced", "增强流程获选"],
              ["baseline", "基线获选"],
              ["tie", "平局"],
              ["insufficient", "资料不足"],
            ].map(([k, n]) => (
              <div key={k}>
                <span>{n}</span>
                <strong>{report.data.counts[k]}</strong>
              </div>
            ))}
          </div>
          <p>
            按作品平均的偏好差：{report.data.work_mean_preference ?? "暂无评分"}
            ；95% 区间：
            {report.data.work_cluster_bootstrap_95?.join(" 至 ") ||
              "有效作品数不足 5"}
          </p>
          <p>
            每本作品平均节省编辑时间：
            {report.data.editing_seconds_saved_per_work ?? "—"} 秒
          </p>
          <small>{report.data.note}</small>
        </article>
      )}
      {me.data?.user?.role === "superadmin" && <ModelRoutingAdmin />}
      <details className="pw-card">
        <summary>40 个验收任务框架</summary>
        <p>{cases.data?.note}</p>
        {cases.data?.items.map((c: any) => (
          <p key={c.id}>
            <strong>
              {c.genre} · {c.category}
            </strong>
            ：{c.premise} {c.task}
          </p>
        ))}
      </details>
      {id && (
        <Modal
          title="匿名成对评测"
          onClose={() => setId("")}
          wide
          footer={
            <button
              className="button primary"
              disabled={busy || !item.data || form.reason.trim().length < 5}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/evaluations/${id}/vote`, {
                    ...form,
                    familiarity: Number(form.familiarity),
                    editing_seconds_a: Number(form.editing_seconds_a),
                    editing_seconds_b: Number(form.editing_seconds_b),
                    expected_version: item.data.vote_version,
                  });
                  await cache.invalidateQueries({ queryKey: ["evaluations"] });
                  await cache.invalidateQueries({
                    queryKey: ["evaluation-report"],
                  });
                  setId("");
                  toast("评分已保存");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存评分
            </button>
          }
        >
          {item.isPending ? (
            <Spinner />
          ) : item.error ? (
            <ErrorState error={item.error} />
          ) : (
            <>
              {item.data.length_warning && (
                <p className="ref-notice">
                  两份文本长度相差超过
                  20%，评分时请考虑长度偏差；也可选择资料不足。
                </p>
              )}
              <div className="ref-form two-columns">
                {item.data.samples.map((s: any) => (
                  <article className="pw-card" key={s.label}>
                    <h3>
                      文本 {s.label} · {s.characters} 字符
                    </h3>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        maxHeight: "45vh",
                        overflow: "auto",
                      }}
                    >
                      {s.text}
                    </pre>
                  </article>
                ))}
              </div>
              <label className="field">
                你的偏好
                <select
                  value={form.preference}
                  onChange={(e) =>
                    setForm({ ...form, preference: e.target.value })
                  }
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="tie">平局</option>
                  <option value="insufficient">资料不足</option>
                </select>
              </label>
              <label className="field">
                题材熟悉度（1 至 5）
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.familiarity}
                  onChange={(e) =>
                    setForm({ ...form, familiarity: e.target.value })
                  }
                />
              </label>
              <div className="ref-form two-columns">
                {["a", "b"].map((k) => (
                  <label className="field" key={k}>
                    编辑文本 {k.toUpperCase()} 实际耗时（秒）
                    <input
                      type="number"
                      min={0}
                      value={form["editing_seconds_" + k]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          ["editing_seconds_" + k]: e.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="field">
                理由与主要问题
                <textarea
                  rows={4}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}

export function AuthorEvaluation({ pid }: { pid: string }) {
  const toast = useToast(),
    cache = useQueryClient(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({
      title: "创作流程对照",
      baseline_id: "",
      enhanced_id: "",
      reviewer_id: "",
      consent: false,
    });
  const reviewers = useQuery({
    queryKey: ["evaluators"],
    queryFn: () => api("/evaluations/reviewers"),
    enabled: open,
  });
  const arts = useQuery({
    queryKey: ["evaluation-artifacts", pid],
    queryFn: () => api(`/projects/${pid}/artifacts`),
    enabled: open,
  });
  const pairs = useQuery({
    queryKey: ["evaluations"],
    queryFn: () => api("/evaluations"),
  });
  const eligible =
    arts.data?.items.filter(
      (a: any) =>
        ["draft", "branch_draft"].includes(a.kind) && a.status !== "partial",
    ) || [];
  return (
    <><AuthorModelTrials pid={pid} /><PreferenceExperiments pid={pid} /><DecodingExperiments pid={pid} /><details className="pw-card">
      <summary>授权人工盲评</summary>
      <p>
        从两个已保存正文版本中建立对照。只向你选定的评测人员公开这两份文本，随时可以撤回。
      </p>
      <button className="button secondary" onClick={() => setOpen(true)}>
        创建授权样本
      </button>
      {pairs.data?.items
        .filter((p: any) => p.owned && p.project_id === pid)
        .map((p: any) => (
          <div className="ref-toolbar" key={p.id}>
            <span>{p.name}</span>
            <DeleteButton
              confirmation="inline"
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/evaluations/${p.id}/withdraw`);
                  await cache.invalidateQueries({ queryKey: ["evaluations"] });
                  toast("授权已撤回，样本文本副本已删除");
                } catch (e) {
                  toast((e as Error).message, true);
                  return false;
                } finally {
                  setBusy(false);
                }
              }}
            >
              撤回授权
            </DeleteButton>
          </div>
        ))}
      {open && (
        <Modal
          title="选择盲评材料与人员"
          onClose={() => setOpen(false)}
          footer={
            <button
              className="button primary"
              disabled={
                busy ||
                !form.consent ||
                !form.reviewer_id ||
                !form.baseline_id ||
                !form.enhanced_id
              }
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/studio/projects/${pid}/evaluation-pairs`, {
                    title: form.title,
                    baseline_id: form.baseline_id,
                    enhanced_id: form.enhanced_id,
                    reviewer_ids: [form.reviewer_id],
                    consent: form.consent,
                  });
                  await cache.invalidateQueries({ queryKey: ["evaluations"] });
                  setOpen(false);
                  toast("匿名样本已分配");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              授权并分配
            </button>
          }
        >
          <label className="field">
            样本标题
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          {[
            ["baseline_id", "基线正文"],
            ["enhanced_id", "增强流程正文"],
          ].map(([k, t]) => (
            <label className="field" key={k}>
              {t}
              <select
                value={(form as any)[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              >
                <option value="">选择版本</option>
                {eligible.map((a: any, index: number) => (
                  <option value={a.id} key={a.id}>
                    第 {a.chapter} 章 · {a.text.length} 字符 ·{" "}
                    版本 {eligible.length - index}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="field">
            评测人员
            <select
              value={form.reviewer_id}
              onChange={(e) =>
                setForm({ ...form, reviewer_id: e.target.value })
              }
            >
              <option value="">请选择</option>
              {reviewers.data?.items.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          {reviewers.data?.items.length === 0 && (
            <p>当前没有评测账号。管理员可在用户管理创建“评测人员”角色。</p>
          )}
          <label>
            <input
              type="checkbox"
              checked={form.consent}
              onChange={(e) => setForm({ ...form, consent: e.target.checked })}
            />{" "}
            我授权所选人员查看以上两个正文版本，仅用于本次质量评测。
          </label>
        </Modal>
      )}
    </details></>
  );
}
