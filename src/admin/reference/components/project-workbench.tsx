"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Download,
  Play,
  Upload,
  ShieldCheck,
  History,
  PenLine,
} from "lucide-react";
import { api, post, formatTime } from "@reference/lib/api";
import { Drawer, Empty, ErrorState, Spinner, Status, useToast } from "./ui";

const labels: Record<string, string> = {
  chapter: "完整章节流程",
  draft: "正文候选",
  idea: "创意发散",
  planning: "故事规划",
  world: "世界设定",
  characters: "人物设定",
  "chapter-plan": "章节计划",
  review: "证据审稿",
  memory: "候选记忆",
  memory_proposal: "候选记忆",
};
function parsed(text: string, fallback: any) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
function display(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function ProjectWorkbench({
  project,
  onClose,
}: {
  project: any;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("manuscript"),
    [runId, setRunId] = useState(""),
    [selected, setSelected] = useState("");
  const [stage, setStage] = useState("chapter"),
    [model, setModel] = useState("sandbox-writer"),
    [chapter, setChapter] = useState(1),
    [budget, setBudget] = useState(100),
    [instruction, setInstruction] = useState("");
  const [accepted, setAccepted] = useState<string[]>([]),
    [waived, setWaived] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<any>(null);
  const [patchOpen, setPatchOpen] = useState(false),
    [oldText, setOldText] = useState(""),
    [replacement, setReplacement] = useState("");
  const cache = useQueryClient(),
    toast = useToast(),
    pid = project.id;
  const initialized = useRef(false);
  const current = useQuery({
    queryKey: ["project", pid],
    queryFn: () => api(`/projects/${pid}`),
  });
  const options = useQuery({
    queryKey: ["creation-options"],
    queryFn: () => api("/creation/options"),
  });
  const history = useQuery({
    queryKey: ["project-runs", pid],
    queryFn: () => api(`/projects/${pid}/runs`),
    refetchInterval: (q) =>
      q.state.data?.items.some((r: any) =>
        ["queued", "running"].includes(r.state),
      )
        ? 1500
        : false,
  });
  const run = history.data?.items.find((r: any) => r.id === runId);
  const artifacts = useQuery({
    queryKey: ["artifacts", pid, run?.state],
    queryFn: () => api(`/projects/${pid}/artifacts`),
  });
  const canon = useQuery({
    queryKey: ["canon", pid],
    queryFn: () => api(`/projects/${pid}/canon`),
    enabled: tab === "canon",
  });
  const items: any[] = artifacts.data?.items || [];
  const artifact =
    items.find((a) => a.id === selected) ||
    items.find((a) => a.kind === "draft") ||
    items[0];
  const draft =
    artifact?.kind === "draft"
      ? artifact
      : items.find((a) => a.id === artifact?.meta?.source_id);
  const review = items.find(
    (a) =>
      a.kind === "review" &&
      a.meta?.source_id === draft?.id &&
      a.status !== "stale",
  );
  const proposal = items.find(
    (a) =>
      a.kind === "memory_proposal" &&
      a.meta?.source_id === draft?.id &&
      a.status !== "stale",
  );
  const report = parsed(review?.text || "", null),
    candidateFacts = parsed(proposal?.text || "", []),
    facts: any[] = Array.isArray(candidateFacts) ? candidateFacts : [];
  const findings: any[] =
    report?.findings?.filter((f: any) =>
      ["issue", "waived"].includes(f.status),
    ) || [];
  const active = history.data?.items.some((r: any) =>
    ["queued", "running"].includes(r.state),
  );
  const environment =
    options.data?.models.find((m: any) => m.id === model)?.environment ||
    "sandbox";
  useEffect(() => {
    if (artifacts.data && !initialized.current) {
      initialized.current = true;
      setChapter(
        Math.max(
          0,
          ...artifacts.data.items
            .filter((a: any) => a.kind === "draft" && a.status === "confirmed")
            .map((a: any) => a.chapter),
        ) + 1,
      );
    }
  }, [artifacts.data]);
  useEffect(() => {
    if (!runId && history.data?.items[0]) setRunId(history.data.items[0].id);
  }, [history.data, runId]);
  useEffect(() => {
    if (run?.result?.artifact_id) setSelected(run.result.artifact_id);
  }, [runId, run?.result?.artifact_id]);
  useEffect(() => {
    setAccepted([]);
    setWaived([]);
    setPatchOpen(false);
  }, [draft?.id]);
  async function refresh() {
    for (const key of [
      "project",
      "project-runs",
      "artifacts",
      "canon",
      "my-projects",
      "admin-projects",
      "dashboard",
    ])
      await cache.invalidateQueries({ queryKey: [key] });
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function generate() {
    return action(async () => {
      const result = await post(`/projects/${pid}/runs`, {
        kind: stage,
        budget,
        input: {
          chapter,
          model,
          instruction,
          title: `${project.title} · 第 ${chapter} 章`,
          ...(["review", "memory"].includes(stage)
            ? { artifact_id: draft?.id }
            : {}),
        },
      });
      setRunId(result.id);
      setTab("manuscript");
      await refresh();
      toast("任务已加入队列");
    });
  }
  function approve() {
    return action(async () => {
      const result = await post(`/projects/${pid}/approvals`, {
        artifact_id: draft.id,
        expected_sha256: draft.sha256,
        expected_canon_version: draft.base_canon_version,
        review_id: review.id,
        memory_proposal_id: proposal.id,
        accepted_ids: accepted,
        waived_findings: waived,
      });
      await refresh();
      toast(`作者确认成功 · 正史版本 ${result.canon_version}`);
    });
  }
  function savePatch() {
    return action(async () => {
      const offset = draft.text.indexOf(oldText);
      if (
        !oldText ||
        offset < 0 ||
        draft.text.indexOf(oldText, offset + 1) >= 0
      )
        throw new Error("原文片段必须在当前正文中唯一出现，请补充上下文。");
      const start = Array.from(draft.text.slice(0, offset)).length,
        end = start + Array.from(oldText).length;
      const revised = await post(`/projects/${pid}/patches`, {
        artifact_id: draft.id,
        expected_sha256: draft.sha256,
        edits: [{ start, end, old: oldText, replacement }],
        max_ratio: 0.2,
      });
      setSelected(revised.id);
      setPatchOpen(false);
      await refresh();
      toast("修订已另存为候选，请重新审稿和提取记忆。");
    });
  }
  function importFile(file: File) {
    return action(async () => {
      const form = new FormData();
      form.append("file", file);
      setPreview(
        await api(`/projects/${pid}/imports/preview`, {
          method: "POST",
          body: form,
        }),
      );
    });
  }
  const validSource =
    draft?.status === "candidate" &&
    draft.base_canon_version === current.data?.canon_version;
  return (
    <Drawer
      wide
      title={project.title || project.name}
      subtitle="作者工作台 · 阶段、候选与确认"
      onClose={onClose}
      footer={
        <>
          <a
            className="button secondary"
            href={`/api/v1/projects/${pid}/export?format=docx&confirmed_only=true`}
          >
            <Download size={16} />
            导出已确认稿
          </a>
          <label className="button secondary">
            <Upload size={16} />
            导入旧稿
            <input
              className="file-input"
              type="file"
              accept=".txt,.md,.docx"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.[0]) importFile(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="button primary"
            disabled={
              busy ||
              active ||
              !options.data?.models.some(
                (m: any) => m.id === model && m.available,
              ) ||
              (["review", "memory"].includes(stage) && !validSource)
            }
            onClick={generate}
          >
            <Play size={16} />
            运行{labels[stage]}
          </button>
        </>
      }
    >
      {current.error ? (
        <ErrorState error={current.error} />
      ) : current.isPending ? (
        <Spinner />
      ) : (
        <>
          <div className="run-summary">
            <ShieldCheck size={17} />
            <span>正史版本 {current.data.canon_version}</span>
            <span>
              预算 {current.data.spent} / {current.data.budget_limit} 算力
            </span>
            <Status value={environment} />
          </div>
          <div className="workbench-controls">
            <label className="field">
              <span>创作阶段</span>
              <select
                aria-label="创作阶段"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                {options.data?.stages.map((s: string) => (
                  <option key={s} value={s}>
                    {labels[s] || s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>调用模型</span>
              <select
                aria-label="调用模型"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {options.data?.models.map((m: any) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.name}
                    {!m.available ? "（当前环境未启用）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>章节序号</span>
              <input
                type="number"
                min={1}
                max={99999}
                value={chapter}
                onChange={(e) => setChapter(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>本次预算上限</span>
              <input
                type="number"
                min={1}
                max={1000000}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span>本次创作要求（选填）</span>
            <textarea
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="说明本章目标、需要保留的内容或重点检查的问题。"
            />
          </label>
          {options.error && <ErrorState error={options.error} />}
          {run && (
            <div className="info-strip">
              <Status value={run.state} />
              <span>
                {run.error ||
                  `${labels[run.kind]} · 实际 ${run.actual_cost} 算力`}
              </span>
              {["queued", "running"].includes(run.state) && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await post(`/runs/${run.id}/cancel`);
                      await refresh();
                    })
                  }
                >
                  停止后续调用
                </button>
              )}
            </div>
          )}
          <div className="tabs">
            {[
              ["manuscript", "稿件与确认"],
              ["history", "运行历史"],
              ["canon", "已确认事实"],
            ].map(([id, name]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {name}
              </button>
            ))}
          </div>
          {tab === "history" &&
            (history.error ? (
              <ErrorState error={history.error} />
            ) : history.isPending ? (
              <Spinner />
            ) : (
              <div className="activity-list">
                {history.data?.items.length ? (
                  history.data.items.map((r: any) => (
                    <button
                      className="workbench-history"
                      key={r.id}
                      onClick={() => {
                        setRunId(r.id);
                        if (r.result?.artifact_id)
                          setSelected(r.result.artifact_id);
                        setTab("manuscript");
                      }}
                    >
                      <History size={17} />
                      <span>
                        <strong>
                          {labels[r.kind]} · 第 {r.input.chapter || 1} 章
                        </strong>
                        <small>
                          {formatTime(r.created_at)} · {r.actual_cost} /{" "}
                          {r.budget} 算力
                        </small>
                      </span>
                      <Status value={r.state} />
                    </button>
                  ))
                ) : (
                  <Empty
                    title="还没有运行记录"
                    description="从上方选择创作阶段，开始第一次运行。"
                  />
                )}
              </div>
            ))}
          {tab === "canon" &&
            (canon.error ? (
              <ErrorState error={canon.error} />
            ) : canon.isPending ? (
              <Spinner />
            ) : canon.data?.items.length ? (
              canon.data.items.map((e: any) => (
                <div className="finding" key={e.id}>
                  <strong>
                    正史 V{e.version} · {e.fact.content}
                  </strong>
                  <p>原文证据：{e.fact.evidence?.quote}</p>
                </div>
              ))
            ) : (
              <Empty
                title="正史等待你的确认"
                description="模型提取的候选事实不会自动进入这里。"
              />
            ))}
          {tab === "manuscript" && (
            <>
              {artifacts.error ? (
                <ErrorState error={artifacts.error} />
              ) : artifacts.isPending ? (
                <Spinner />
              ) : (
                <>
                  <div className="run-artifacts">
                    {items.map((a) => (
                      <button
                        className={`button ${a.id === artifact?.id ? "primary" : "secondary"} small`}
                        key={a.id}
                        onClick={() => setSelected(a.id)}
                      >
                        {labels[a.kind] || a.kind} · 第 {a.chapter} 章{" "}
                        <Status value={a.status} />
                      </button>
                    ))}
                  </div>
                  {artifact ? (
                    <>
                      <div className="run-output">
                        {artifact.kind === "draft"
                          ? artifact.text
                          : display(artifact.text)}
                      </div>
                      <p className="backup-note">
                        {formatTime(artifact.created_at)} · 正史基准 V
                        {artifact.base_canon_version} · 内容版本{" "}
                        {artifact.sha256.slice(0, 12)}
                      </p>
                    </>
                  ) : (
                    <Empty
                      title="等待第一份候选"
                      description="生成的稿件和设定会单独保留，确认后才进入正史。"
                    />
                  )}
                </>
              )}
              {draft && (
                <section className="workbench-review">
                  <div className="section-heading">
                    <h2>审稿与作者确认</h2>
                    {validSource && (
                      <button
                        className="button secondary small"
                        onClick={() => setPatchOpen(!patchOpen)}
                      >
                        <PenLine size={15} />
                        局部修订
                      </button>
                    )}
                  </div>
                  {patchOpen && (
                    <div className="patch-editor">
                      <label className="field">
                        <span>原文片段</span>
                        <textarea
                          rows={3}
                          value={oldText}
                          onChange={(e) => setOldText(e.target.value)}
                          placeholder="粘贴需要替换的完整原文片段"
                        />
                      </label>
                      <label className="field">
                        <span>替换为</span>
                        <textarea
                          rows={3}
                          value={replacement}
                          onChange={(e) => setReplacement(e.target.value)}
                        />
                      </label>
                      <p className="backup-note">
                        每次最多修改正文的 20%；修订稿会重新等待审稿与事实提取。
                      </p>
                      <button
                        className="button secondary"
                        disabled={busy || !oldText || oldText === replacement}
                        onClick={savePatch}
                      >
                        另存修订候选
                      </button>
                    </div>
                  )}
                  {report ? (
                    <p className="backup-note">
                      已审 {report.checked?.length || 0} 条 · 未审{" "}
                      {report.not_checked?.length || 0} 条 · 本地候选提示{" "}
                      {report.local_candidates?.length || 0} 项 ·{" "}
                      {report.complete ? "审稿覆盖完整" : "审稿资料仍有缺口"}
                    </p>
                  ) : (
                    <p className="backup-note">
                      选择“证据审稿”运行，检查当前正文；随后运行“候选记忆”提取有证据的事实。
                    </p>
                  )}
                  {findings.map((f: any, i: number) => (
                    <label className="fact-choice" key={`${f.rule_id}-${i}`}>
                      <input
                        type="checkbox"
                        disabled={!validSource}
                        checked={waived.includes(f.rule_id)}
                        onChange={(e) =>
                          setWaived((old) =>
                            e.target.checked
                              ? [...new Set([...old, f.rule_id])]
                              : old.filter((id) => id !== f.rule_id),
                          )
                        }
                      />
                      <span>
                        由我保留这一表达：{f.rule_id}
                        <small>{f.reason}</small>
                      </span>
                    </label>
                  ))}
                  {proposal && (
                    <>
                      <h3>选择纳入正史的事实</h3>
                      {facts.length ? (
                        facts.map((f) => (
                          <label className="fact-choice" key={f.id}>
                            <input
                              type="checkbox"
                              disabled={!validSource}
                              checked={accepted.includes(f.id)}
                              onChange={(e) =>
                                setAccepted((old) =>
                                  e.target.checked
                                    ? [...old, f.id]
                                    : old.filter((id) => id !== f.id),
                                )
                              }
                            />
                            <span>
                              {f.content}
                              <small>证据：{f.evidence?.quote}</small>
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="backup-note">
                          本次没有新的事实候选，可以仅确认正文。
                        </p>
                      )}
                    </>
                  )}
                  {draft.status === "confirmed" ? (
                    <div className="info-strip">
                      <Check size={17} />
                      正文已由作者确认。
                    </div>
                  ) : (
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        !validSource ||
                        !report?.complete ||
                        !proposal ||
                        findings.some((f) => !waived.includes(f.rule_id))
                      }
                      onClick={approve}
                    >
                      <Check size={16} />
                      以作者身份确认正文与所选事实
                    </button>
                  )}
                </section>
              )}
            </>
          )}
          {preview && (
            <section className="workbench-review">
              <h2>导入预览 · {preview.chapters.length} 章</h2>
              {preview.chapters.map((c: any) => (
                <div className="finding" key={c.ordinal}>
                  <strong>{c.title}</strong>
                  <p>
                    {c.chars} 字符 · {c.text.slice(0, 120)}…
                  </p>
                </div>
              ))}
              <div className="page-actions">
                <button
                  className="button secondary"
                  onClick={() => setPreview(null)}
                >
                  取消导入
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await post(`/projects/${pid}/imports/commit`, {
                        file_id: preview.file_id,
                      });
                      setPreview(null);
                      await refresh();
                      toast("已导入候选，正文仍需审稿和确认。");
                    })
                  }
                >
                  确认导入为候选
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </Drawer>
  );
}
