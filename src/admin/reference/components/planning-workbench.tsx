"use client";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put, formatTime } from "@reference/lib/api";
import { Drawer, Spinner, ErrorState, useToast } from "./ui";
import { ExtraFields } from "./memory-workbench";
import { SceneTaskEditor } from "./scene-task-editor";
import "./planning-workbench.css";

const levels: Record<string, string> = {
  book: "全书",
  volume: "分卷",
  arc: "故事弧",
  chapter: "章节",
  scene: "场景",
};
const fixed: Record<string, string> = {
  fixed: "固定",
  tentative: "暂定",
  exploratory: "可探索",
};
const states: Record<string, string> = {
  planned: "仅规划，尚无出现证据",
  open: "已出现，未兑现",
  paid_off: "已有兑现证据",
  abandoned: "正文中已放弃",
};
const events: Record<string, string> = {
  setup: "出现 / 埋下",
  develop: "推进",
  payoff: "兑现",
  abandon: "正文中放弃",
};
const intentions: Record<string, string> = {
  planned: "计划推进",
  deferred: "作者决定延后",
  cancelled: "作者取消计划",
};
const prefix = (pid: string, admin = false) =>
  `${admin ? "/admin/structured" : "/studio"}/projects/${pid}`;

function DeviationCard({ item, path, busy, action, replan }: { item: any; path: string; busy: boolean; action: (fn: () => Promise<any>, message?: string) => Promise<any>; replan?: () => Promise<any> }) {
  const [reason, setReason] = useState("");
  const pending = ["open", "replan_requested"].includes(item.status);
  return <article className="pw-card">
    <strong>第 {item.chapter} 章 · {item.reason}</strong>
    <p>原计划：{item.expected}</p>
    <blockquote>{item.evidence.quote}</blockquote>
    <p>建议：{item.suggested_action}</p>
    {pending ? <>
      <label>处理理由<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="pw-actions">
        {replan && <button className="mw-button" disabled={busy} onClick={replan}>依据此证据生成重大纲方案</button>}
        {[['keep_plan', '保留原计划'], ['dismiss', '证据不构成偏离']].map(([value, label]) => <button key={value} className="mw-button" disabled={busy || reason.trim().length < 2} onClick={() => action(() => post(`${path}/planning-deviations/${item.id}`, { expected_version: item.version, action: value, reason }), "偏离处理决定已记录")}>{label}</button>)}
      </div>
    </> : <small>{item.status === "stale" ? "依据已变化，请重新抽取核对" : `已处理：${item.resolution_reason || item.status}`}</small>}
  </article>;
}
const blankPlan = (chapter: number, worldline: string) => ({
  title: "",
  level: "chapter",
  parent_id: null,
  goal: "",
  preconditions: "",
  ending_state: "",
  writer_brief: "",
  protected_notes: "",
  fixedness: "tentative",
  chapter_start: chapter,
  chapter_end: chapter,
  worldline_id: worldline,
  entity_ids: [],
  depends_on: [],
  fact_ids: [],
  source_ids: [],
  thread_ids: [],
  world_rule_ids: [],
  task: null,
  attributes: {},
});
const blankThread = (worldline: string) => ({
  title: "",
  type: "foreshadow",
  promise: "",
  expected_from: null,
  expected_to: null,
  intention: "planned",
  risk: "",
  entity_ids: [],
  worldline_id: worldline,
  attributes: {},
});

function Links({
  title,
  values,
  options,
  change,
}: {
  title: string;
  values: string[];
  options: { id: string; name: string }[];
  change: (ids: string[]) => void;
}) {
  const missing = values.filter((id) => !options.some((o) => o.id === id));
  return (
    <label>
      {title}
      <select
        multiple
        value={values}
        onChange={(e) =>
          change(Array.from(e.target.selectedOptions).map((o) => o.value))
        }
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {missing.map((id) => (
          <option key={id} value={id}>
            已失效引用 · 请移除
          </option>
        ))}
      </select>
      {!!missing.length && (
        <small>
          包含 {missing.length} 条已失效引用，保存前请移除或重新选择。
        </small>
      )}
    </label>
  );
}

export function PlanningWorkbench({
  pid,
  admin = false,
  chapter: initialChapter = 1,
  initialWorldline = "main",
  initialTab = "plans",
  model = "sandbox-writer",
  budget = 100,
}: {
  pid: string;
  admin?: boolean;
  chapter?: number;
  initialWorldline?: string;
  initialTab?: string;
  model?: string;
  budget?: number;
}) {
  const path = prefix(pid, admin),
    cache = useQueryClient(),
    toast = useToast();
  const [chapter, setChapter] = useState(initialChapter),
    [worldline, setWorldline] = useState(initialWorldline),
    [tab, setTab] = useState(initialTab),
    [onlyWindow, setOnlyWindow] = useState(false),
    [onlyOpen, setOnlyOpen] = useState(false),
    [canonVersion, setCanonVersion] = useState("");
  const [edit, setEdit] = useState<any>(null),
    [threadEdit, setThreadEdit] = useState<any>(null),
    [reason, setReason] = useState(""),
    [allowFixed, setAllowFixed] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any>(null),
    [windowDraft, setWindowDraft] = useState<number | null>(null),
    [windowReason, setWindowReason] = useState(""),
    [instruction, setInstruction] = useState("");
  const q = useQuery({
    queryKey: ["planning-board", path, chapter, worldline],
    queryFn: () =>
      api(
        path +
          `/planning?chapter=${chapter}&worldline_id=${encodeURIComponent(worldline)}`,
      ),
  });
  const t = useQuery({
    queryKey: ["thread-board", path, chapter, worldline, canonVersion],
    queryFn: () =>
      api(
        path +
          `/threads?chapter=${chapter}&worldline_id=${encodeURIComponent(worldline)}` +
          (canonVersion ? `&canon_version=${canonVersion}` : ""),
      ),
  });
  const h = useQuery({
    queryKey: ["planning-history", path, history?.type, history?.id],
    queryFn: () => api(path + `/${history.type}/${history.id}/versions`),
    enabled: !!history,
  });
  const runs = useQuery({
    queryKey: ["planning-runs", pid],
    queryFn: () => api(`/studio/projects/${pid}/workspace`),
    enabled: !admin,
    refetchInterval: (q) =>
      q.state.data?.runs.some(
        (r: any) =>
          r.kind === "plan-proposal" && ["queued", "running"].includes(r.state),
      )
        ? 1500
        : false,
  });
  const active = runs.data?.runs.find(
    (r: any) =>
      r.kind === "plan-proposal" && ["queued", "running"].includes(r.state),
  );
  const lastRun = runs.data?.runs.find((r: any) => r.kind === "plan-proposal");
  // A completed proposal should become visible without a page reload.
  useEffect(() => {
    if (lastRun && !["queued", "running"].includes(lastRun.state))
      cache.invalidateQueries({ queryKey: ["planning-board", path] });
  }, [lastRun?.id, lastRun?.state, cache, path]);
  function openPlan(row?: any, fromProposal?: any) {
    const v = row?.draft || row?.approved;
    setEdit({
      id: row?.id,
      version: row?.version,
      payload: v ? structuredClone(v.payload) : blankPlan(chapter, worldline),
      schema_id: v?.schema_id || q.data?.schema.id,
      ...fromProposal,
    });
    setReason("");
    setAllowFixed(false);
    setPreview(null);
  }
  function updatePlan(changes: any) {
    setEdit((e: any) => ({ ...e, payload: { ...e.payload, ...changes } }));
    setPreview(null);
  }
  function openThread(row?: any) {
    const fields = new Set(
      t.data?.schema.modules
        .find((m: any) => m.key === "foreshadow")
        ?.fields.map((f: any) => f.key) || [],
    );
    const payload = row ? structuredClone(row.payload) : blankThread(worldline);
    const removedFields = Object.keys(payload.attributes).filter(
      (k) => !fields.has(k),
    );
    payload.attributes = Object.fromEntries(
      Object.entries(payload.attributes).filter(([k]) => fields.has(k)),
    );
    setThreadEdit({
      id: row?.id,
      version: row?.version,
      payload,
      removedFields,
    });
    setReason("");
  }
  async function action(fn: () => Promise<any>, message?: string) {
    setBusy(true);
    try {
      const r = await fn();
      await cache.invalidateQueries();
      if (message) toast(message);
      return r;
    } catch (e) {
      toast((e as Error).message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const body = () => ({
    node_id: edit.id || null,
    expected_version: edit.version || null,
    payload: edit.payload,
    reason,
    allow_fixed_change: allowFixed,
    schema_id: edit.schema_id,
    proposal_id: edit.proposal_id || null,
    proposal_index: edit.proposal_index ?? null,
  });
  if (q.isPending || t.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  if (t.error) return <ErrorState error={t.error} />;
  const planFields =
    (
      edit?.schema ||
      q.data.schemas[edit?.schema_id] ||
      q.data.schema
    ).modules.find((m: any) => m.key === "planning")?.fields || [];
  const threadFields =
    t.data.schema.modules.find((m: any) => m.key === "foreshadow")?.fields ||
    [];
  const items = q.data.items.filter((i: any) => !onlyWindow || i.in_window);
  return (
    <div className="mw pw">
      <div className="mw-heading">
        <div>
          <h3>故事规划与承诺</h3>
          <p>规划说明将来想发生什么；出现和兑现以作者确认的正文证据为准。</p>
        </div>
        <div className="pw-tabs">
          <button
            className={tab === "plans" ? "active" : ""}
            onClick={() => setTab("plans")}
          >
            分层滚动规划
          </button>
          <button
            className={tab === "threads" ? "active" : ""}
            onClick={() => setTab("threads")}
          >
            承诺与伏笔
          </button>
        </div>
      </div>
      <div className="mw-filters">
        <label>
          {tab === "plans" ? "近期起始章" : "截至章节"}
          <input
            type="number"
            min={1}
            max={99999}
            value={chapter}
            onChange={(e) => setChapter(Math.max(1, Number(e.target.value)))}
          />
        </label>
        <label>
          世界线
          <input
            value={worldline}
            onChange={(e) => setWorldline(e.target.value)}
          />
        </label>
        {tab === "threads" && (
          <label>
            故事记录版本
            <input
              type="number"
              min={0}
              placeholder="当前版本"
              value={canonVersion}
              onChange={(e) => setCanonVersion(e.target.value)}
            />
          </label>
        )}
      </div>
      {tab === "plans" ? (
        <>
          <div className="mw-heading">
            <span>
              近期窗口：第 {chapter}–
              {Math.min(99999, chapter + q.data.settings.horizon - 1)} 章
            </span>
            <button className="mw-button primary" onClick={() => openPlan()}>
              新建计划
            </button>
          </div>
          {!q.data.confirmed_contract && (
            <p className="mw-alert">
              可先整理草稿，确认生效和生成方案前请先确认本书设定。
            </p>
          )}
          <details className="pw-settings">
            <summary>近期窗口与生成建议</summary>
            <div className="mw-grid">
              <label>
                近期规划章数（1–30）
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={windowDraft ?? q.data.settings.horizon}
                  onChange={(e) => setWindowDraft(Number(e.target.value))}
                />
              </label>
              <label>
                调整窗口的原因
                <input
                  value={windowReason}
                  onChange={(e) => setWindowReason(e.target.value)}
                />
              </label>
            </div>
            <button
              className="mw-button"
              disabled={busy || windowReason.trim().length < 2}
              onClick={() =>
                action(
                  () =>
                    put(path + "/planning-settings", {
                      expected_version: q.data.settings.version,
                      horizon: windowDraft ?? q.data.settings.horizon,
                      reason: windowReason,
                    }),
                  "近期窗口已更新",
                )
              }
            >
              保存规划窗口
            </button>
            {!admin && (
              <>
                <label>
                  本次规划要求
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例如：保留终局，给接下来三章提供不同的行动与代价。"
                  />
                </label>
                <button
                  className="mw-button"
                  disabled={busy || !!active || !q.data.confirmed_contract}
                  onClick={() =>
                    action(
                      () =>
                        post(`/projects/${pid}/runs`, {
                          kind: "plan-proposal",
                          input: {
                            chapter,
                            worldline_id: worldline,
                            model,
                            instruction,
                          },
                          budget,
                        }),
                      "规划建议已提交，完成后可逐条审阅",
                    )
                  }
                >
                  {active ? "正在生成方案…" : "生成近期大纲方案"}
                </button>
                <p className="mw-note">
                  使用当前创作模型，每次最多 {budget}{" "}
                  点；方案经你编辑、预览影响并确认后才生效。
                </p>
                {lastRun?.error && (
                  <p className="mw-alert">最近任务：{lastRun.error}</p>
                )}
              </>
            )}
          </details>
          {!!q.data.deviations?.length && <section aria-label="正文偏离与重规划">
            <h3>需要调整的大纲</h3>
            {q.data.deviations.filter((d: any) => ["open", "replan_requested"].includes(d.status)).map((d: any) => <DeviationCard key={d.id} item={d} path={path} busy={busy || !!active} action={action} replan={!admin ? () => action(() => post(`/projects/${pid}/runs`, { kind: "plan-proposal", input: { chapter: Math.min(99999, Math.max(chapter, d.chapter)), worldline_id: worldline, model, instruction, deviation_ids: [d.id] }, budget }), "已依据正文生成大纲调整方案，请审阅后确认") : undefined} />)}
            {q.data.deviations.some((d: any) => !["open", "replan_requested"].includes(d.status)) && <details><summary>查看以前的调整建议</summary>{q.data.deviations.filter((d: any) => !["open", "replan_requested"].includes(d.status)).map((d: any) => <DeviationCard key={d.id} item={d} path={path} busy={busy} action={action} />)}</details>}
          </section>}
          <label className="mw-check">
            <input
              type="checkbox"
              checked={onlyWindow}
              onChange={(e) => setOnlyWindow(e.target.checked)}
            />
            只看与近期窗口相交的计划
          </label>
          <div className="pw-plan-list">
            {items.map((row: any) => {
              const current = row.approved || row.draft;
              const v = current.payload;
              return (
                <article className="pw-card" key={row.id}>
                  <div className="mw-heading">
                    <span>
                      {levels[v.level]} · 第 {v.chapter_start}–{v.chapter_end}{" "}
                      章 · {fixed[v.fixedness]}
                    </span>
                    <small>
                      {row.approved ? "已确认" : "草稿"}
                      {row.draft && row.approved ? " · 另有编辑草稿" : ""}
                    </small>
                  </div>
                  <h4>{v.title}</h4>
                  <p>{v.goal}</p>
                  {row.approved && !!row.issues.length && (
                    <p className="mw-alert">
                      需要复核：{row.issues.join("；")}
                    </p>
                  )}
                  {row.suggestions?.map((s: any, i: number) => (
                    <p className="mw-note" key={i}>
                      {s.reason}（{s.event_ids.length} 条）
                    </p>
                  ))}
                  <div className="pw-actions">
                    <button className="mw-button" onClick={() => openPlan(row)}>
                      {row.issues.length && row.approved
                        ? "复核与重新确认"
                        : "编辑计划"}
                    </button>
                    <button
                      className="mw-button"
                      onClick={() =>
                        setHistory({
                          type: "planning",
                          id: row.id,
                          title: v.title,
                          row,
                        })
                      }
                    >
                      版本与恢复
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!items.length && (
            <p className="mw-empty">
              暂无匹配计划。可从全书方向开始，再添加分卷、故事弧、章节和场景。
            </p>
          )}
          {!!q.data.proposals.length && (
            <details className="pw-proposals">
              <summary>大纲方案（尚未生效）</summary>
              {q.data.proposals.map((r: any) => (
                <section key={r.id}>
                  <h4>
                    {formatTime(r.created_at)} ·{" "}
                    {r.status === "candidate"
                      ? "待审阅"
                      : "依据已变化，请重新生成"}
                  </h4>
                  {r.items.map((v: any, i: number) => (
                    <div className="pw-proposal" key={i}>
                      <strong>{v.title}</strong>
                      <p>{v.goal}</p>
                      <button
                        className="mw-button"
                        disabled={
                          r.status !== "candidate" || !!r.applied[String(i)]
                        }
                        onClick={() =>
                          openPlan(undefined, {
                            payload: structuredClone(v),
                            proposal_id: r.id,
                            proposal_index: i,
                            schema_id: r.schema_id,
                          })
                        }
                      >
                        {r.applied[String(i)] ? "已保存为计划" : "载入并编辑"}
                      </button>
                    </div>
                  ))}
                </section>
              ))}
            </details>
          )}
        </>
      ) : (
        <>
          <div className="mw-heading">
            <p>实际状态截至第 {chapter} 章；预期窗口按当前作者计划显示。</p>
            <button className="mw-button primary" onClick={() => openThread()}>
              登记承诺 / 伏笔
            </button>
          </div>
          <label className="mw-check">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(e) => setOnlyOpen(e.target.checked)}
            />
            只看有出现证据且尚未兑现的承诺
          </label>
          <div className="pw-plan-list">
            {t.data.items
              .filter((r: any) => !onlyOpen || r.state === "open")
              .map((r: any) => (
                <article className="pw-card" key={r.id}>
                  <div className="mw-heading">
                    <strong>{r.payload.title}</strong>
                    <span>{states[r.state]}</span>
                  </div>
                  <p>{r.payload.promise}</p>
                  <div className="pw-facts">
                    <span>
                      出现：
                      {r.setup_chapter
                        ? `第 ${r.setup_chapter} 章`
                        : "尚无证据"}
                    </span>
                    <span>
                      预期：{r.payload.expected_from || "未定"}–
                      {r.payload.expected_to || "未定"} 章
                    </span>
                    <span>
                      实际兑现：
                      {r.payoff_chapter
                        ? `第 ${r.payoff_chapter} 章`
                        : "尚无证据"}
                    </span>
                  </div>
                  <p className="mw-note">
                    {intentions[r.payload.intention]}
                    {r.payload.risk ? ` · 风险：${r.payload.risk}` : ""}
                  </p>
                  {r.attention && (
                    <p className="mw-alert">
                      {r.attention === "overdue_suggestion"
                        ? "已超出当前预期窗口，建议复核；不自动判为写作错误。"
                        : "已进入预期窗口，可考虑推进或调整计划。"}
                    </p>
                  )}
                  {r.needs_recheck && (
                    <p className="mw-alert">
                      部分出现 / 兑现证据的依赖已失效，需要核对。
                    </p>
                  )}
                  <div className="pw-actions">
                    <button className="mw-button" onClick={() => openThread(r)}>
                      调整承诺与窗口
                    </button>
                    <button
                      className="mw-button"
                      onClick={() =>
                        setHistory({
                          type: "threads",
                          id: r.id,
                          title: r.payload.title,
                          row: r,
                        })
                      }
                    >
                      修改记录
                    </button>
                  </div>
                  <details>
                    <summary>
                      正文中的出现与兑现证据（{r.history.length}）
                    </summary>
                    {r.history.map((e: any) => (
                      <blockquote key={e.id}>
                        {events[e.event]} · 第 {e.chapter} 章 · 故事记录 v
                        {e.canon_version}
                        {e.status === "needs_recheck" ? " · 依赖失效" : ""}
                        <p>{e.evidence.quote}</p>
                      </blockquote>
                    ))}
                  </details>
                </article>
              ))}
          </div>
          {!t.data.items.length && (
            <p className="mw-empty">
              先登记想推进的问题、冲突或承诺；正文完成后，在“审稿与定稿 →
              查看本章新增记录”关联出现或兑现证据。
            </p>
          )}
        </>
      )}
      {edit && (
        <Drawer wide title="编辑故事计划" onClose={() => setEdit(null)}>
          <div className="mw mw-form">
            <div className="mw-grid">
              <label>
                计划名称
                <input
                  value={edit.payload.title}
                  onChange={(e) => updatePlan({ title: e.target.value })}
                />
              </label>
              <label>
                计划层级
                <select
                  value={edit.payload.level}
                  onChange={(e) =>
                    updatePlan({
                      level: e.target.value,
                      ...(["chapter", "scene"].includes(e.target.value)
                        ? { chapter_end: edit.payload.chapter_start }
                        : {}),
                    })
                  }
                >
                  {Object.entries(levels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                父计划
                <select
                  value={edit.payload.parent_id || ""}
                  onChange={(e) =>
                    updatePlan({ parent_id: e.target.value || null })
                  }
                >
                  <option value="">无父计划</option>
                  {q.data.items
                    .filter((r: any) => r.id !== edit.id && r.approved)
                    .map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.approved.payload.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                固定程度
                <select
                  value={edit.payload.fixedness}
                  onChange={(e) => updatePlan({ fixedness: e.target.value })}
                >
                  {Object.entries(fixed).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                起始章节
                <input
                  type="number"
                  min={1}
                  max={99999}
                  value={edit.payload.chapter_start}
                  onChange={(e) =>
                    updatePlan({
                      chapter_start: Number(e.target.value),
                      ...(["chapter", "scene"].includes(edit.payload.level)
                        ? { chapter_end: Number(e.target.value) }
                        : {}),
                    })
                  }
                />
              </label>
              <label>
                结束章节
                <input
                  type="number"
                  min={edit.payload.chapter_start}
                  max={99999}
                  disabled={["chapter", "scene"].includes(edit.payload.level)}
                  value={edit.payload.chapter_end}
                  onChange={(e) =>
                    updatePlan({ chapter_end: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            {[
              ["goal", "规划目标"],
              ["preconditions", "进入 / 前置条件"],
              ["ending_state", "结束状态与主角变化"],
              ["writer_brief", "本章正文怎么写"],
              ["protected_notes", "仅供作者规划的远期设想 / 保留项"],
            ].map(([k, v]) => (
              <div key={k}>
              <label>
                {v}
                <textarea
                  aria-label={v}
                  rows={3}
                  value={edit.payload[k]}
                  onChange={(e) => updatePlan({ [k]: e.target.value })}
                />
              </label>
              {k === "writer_brief" && ["chapter", "scene"].includes(edit.payload.level) && <button
                type="button"
                className="mw-button"
                onClick={() => {
                  const current = edit.payload.writer_brief || "";
                  const additions = [["goal", "本章要做成什么"], ["preconditions", "开始时的情况"], ["ending_state", "结束时发生什么变化"]]
                    .filter(([key]) => edit.payload[key]?.trim() && !current.includes(edit.payload[key].trim()))
                    .map(([key, name]) => `${name}：${edit.payload[key].trim()}`);
                  if (additions.length) updatePlan({ writer_brief: [current.trim(), ...additions].filter(Boolean).join("\n\n") });
                }}
              >把本章安排加入写作要求</button>}
              </div>
            ))}
            <p className="mw-note">
              写正文时使用上面的写作要求和场景安排。
            </p>
            {["chapter", "scene"].includes(edit.payload.level) && (
              <SceneTaskEditor
                value={edit.payload.task}
                change={(v) => updatePlan({ task: v })}
                entities={q.data.entities}
              />
            )}
            <details>
              <summary>关联人物、计划与证据</summary>
              <div className="mw-grid">
                <Links
                  title="世界规则"
                  values={edit.payload.world_rule_ids || []}
                  options={(q.data.world_rules || []).map((r: any) => ({
                    id: r.id,
                    name: r.title,
                  }))}
                  change={(ids) => updatePlan({ world_rule_ids: ids })}
                />
                <Links
                  title="关联人物 / 对象"
                  values={edit.payload.entity_ids}
                  options={q.data.entities.map((r: any) => ({
                    id: r.id,
                    name: r.name,
                  }))}
                  change={(ids) => updatePlan({ entity_ids: ids })}
                />
                <Links
                  title="其他前置计划"
                  values={edit.payload.depends_on}
                  options={q.data.items
                    .filter((r: any) => r.id !== edit.id && r.approved)
                    .map((r: any) => ({
                      id: r.id,
                      name: r.approved.payload.title,
                    }))}
                  change={(ids) => updatePlan({ depends_on: ids })}
                />
                <Links
                  title="依据的故事记录事实"
                  values={edit.payload.fact_ids}
                  options={q.data.facts.map((r: any) => ({
                    id: r.id,
                    name: r.content,
                  }))}
                  change={(ids) => updatePlan({ fact_ids: ids })}
                />
                <Links
                  title="依据的原文 / 设定版本"
                  values={edit.payload.source_ids}
                  options={q.data.sources.map((r: any) => ({
                    id: r.id,
                    name: `第 ${r.chapter} 章 · ${r.kind === "draft" ? "正文" : "写作安排"} · ${formatTime(r.created_at)}`,
                  }))}
                  change={(ids) => updatePlan({ source_ids: ids })}
                />
                <Links
                  title="相关承诺"
                  values={edit.payload.thread_ids}
                  options={q.data.threads.map((r: any) => ({
                    id: r.id,
                    name: r.title,
                  }))}
                  change={(ids) => updatePlan({ thread_ids: ids })}
                />
              </div>
            </details>
            <div className="mw-grid">
              <ExtraFields
                fields={planFields}
                value={edit.payload.attributes}
                change={(v) => updatePlan({ attributes: v })}
              />
            </div>
            <label>
              修改原因
              <textarea
                aria-label="修改原因"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label className="mw-check">
              <input
                type="checkbox"
                checked={allowFixed}
                onChange={(e) => setAllowFixed(e.target.checked)}
              />
              本次允许修改固定计划或任务书的锁定字段
            </label>
            {preview && (
              <div className="pw-preview">
                <strong>
                  本次确认将影响 {preview.plans.length} 项下游计划、
                  {preview.artifacts.length} 个已引用产物
                </strong>
                {preview.plans.map((i: any) => (
                  <p key={i.id}>{i.title} · 需要复核</p>
                ))}
                {preview.artifacts.map((a: any) => (
                  <p key={a.id}>
                    第 {a.chapter} 章 ·{" "}
                    {a.status === "confirmed"
                      ? "原文保留，提示复核"
                      : "方案失效"}
                  </p>
                ))}
                {preview.requires_unlock && !allowFixed && (
                  <p>此项为固定计划，请明确勾选允许修改。</p>
                )}
                <small>未受本次修改影响的内容仍然有效。</small>
              </div>
            )}
            <div className="pw-actions">
              <button
                className="mw-button"
                disabled={busy || reason.trim().length < 2}
                onClick={async () => {
                  const r = await action(
                    () =>
                      post(path + "/planning", { ...body(), confirm: false }),
                    "已保存草稿，生效计划尚未改变",
                  );
                  if (r) setEdit(null);
                }}
              >
                保存草稿
              </button>
              <button
                className="mw-button"
                disabled={busy || reason.trim().length < 2}
                onClick={async () => {
                  const r = await action(() =>
                    post(path + "/planning/preview", body()),
                  );
                  if (r) setPreview(r);
                }}
              >
                预览修改影响
              </button>
              <button
                className="mw-button primary"
                disabled={
                  busy ||
                  !preview ||
                  !q.data.confirmed_contract ||
                  reason.trim().length < 2 ||
                  (preview.requires_unlock && !allowFixed)
                }
                onClick={async () => {
                  const r = await action(
                    () =>
                      post(path + "/planning", {
                        ...body(),
                        confirm: true,
                        preview_token: preview.preview_token,
                      }),
                    "计划已确认，相关依赖状态已更新",
                  );
                  if (r) setEdit(null);
                }}
              >
                确认计划生效
              </button>
            </div>
          </div>
        </Drawer>
      )}
      {threadEdit && (
        <Drawer wide title="维护承诺与伏笔" onClose={() => setThreadEdit(null)}>
          <div className="mw mw-form">
            {!!threadEdit.removedFields?.length && (
              <p className="mw-alert">
                全局配置已移除部分补充字段。本次按当前字段保存，旧值仍保留在修改记录中。
              </p>
            )}
            <p className="mw-note">
              这里维护作者的意图和预期。正文中是否已埋下、是否已兑现，需在本章新增记录中绑定原文并经作者确认。
            </p>
            <div className="mw-grid">
              <label>
                承诺名称
                <input
                  value={threadEdit.payload.title}
                  onChange={(e) =>
                    setThreadEdit({
                      ...threadEdit,
                      payload: { ...threadEdit.payload, title: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                承诺类型
                <select
                  value={threadEdit.payload.type}
                  onChange={(e) =>
                    setThreadEdit({
                      ...threadEdit,
                      payload: { ...threadEdit.payload, type: e.target.value },
                    })
                  }
                >
                  {Object.entries({
                    question: "问题",
                    conflict: "冲突",
                    promise: "承诺",
                    foreshadow: "伏笔",
                  }).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              问题 / 承诺内容
              <textarea
                value={threadEdit.payload.promise}
                onChange={(e) =>
                  setThreadEdit({
                    ...threadEdit,
                    payload: { ...threadEdit.payload, promise: e.target.value },
                  })
                }
              />
            </label>
            <div className="mw-grid">
              {[
                ["expected_from", "预期兑现起始章"],
                ["expected_to", "预期兑现结束章"],
              ].map(([k, v]) => (
                <label key={k}>
                  {v}
                  <input
                    type="number"
                    min={1}
                    max={99999}
                    value={threadEdit.payload[k] ?? ""}
                    onChange={(e) =>
                      setThreadEdit({
                        ...threadEdit,
                        payload: {
                          ...threadEdit.payload,
                          [k]: e.target.value ? Number(e.target.value) : null,
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                作者意图
                <select
                  value={threadEdit.payload.intention}
                  onChange={(e) =>
                    setThreadEdit({
                      ...threadEdit,
                      payload: {
                        ...threadEdit.payload,
                        intention: e.target.value,
                      },
                    })
                  }
                >
                  {Object.entries(intentions).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <Links
                title="相关人物 / 对象"
                values={threadEdit.payload.entity_ids}
                options={t.data.entities.map((r: any) => ({
                  id: r.id,
                  name: r.name,
                }))}
                change={(ids) =>
                  setThreadEdit({
                    ...threadEdit,
                    payload: { ...threadEdit.payload, entity_ids: ids },
                  })
                }
              />
            </div>
            <label>
              失败风险 / 注意事项
              <textarea
                value={threadEdit.payload.risk}
                onChange={(e) =>
                  setThreadEdit({
                    ...threadEdit,
                    payload: { ...threadEdit.payload, risk: e.target.value },
                  })
                }
              />
            </label>
            <div className="mw-grid">
              <ExtraFields
                fields={threadFields}
                value={threadEdit.payload.attributes}
                change={(v) =>
                  setThreadEdit({
                    ...threadEdit,
                    payload: { ...threadEdit.payload, attributes: v },
                  })
                }
              />
            </div>
            <label>
              修改原因
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="mw-button primary"
              disabled={busy || reason.trim().length < 2}
              onClick={async () => {
                const body = {
                  expected_version: threadEdit.version || null,
                  payload: threadEdit.payload,
                  reason,
                };
                const r = await action(
                  () =>
                    threadEdit.id
                      ? put(path + "/threads/" + threadEdit.id, body)
                      : post(path + "/threads", body),
                  "承诺计划已保存，实际兑现仍以正文证据为准",
                );
                if (r) setThreadEdit(null);
              }}
            >
              保存承诺计划
            </button>
          </div>
        </Drawer>
      )}
      {history && (
        <Drawer
          wide
          title={`历史记录 · ${history.title}`}
          onClose={() => setHistory(null)}
        >
          <div className="mw">
            {h.isPending ? (
              <Spinner />
            ) : h.error ? (
              <ErrorState error={h.error} />
            ) : h.data.items.length ? (
              h.data.items.map((r: any) => (
                <article className="pw-card" key={r.id}>
                  <div className="mw-heading">
                    <strong>{r.payload.title}</strong>
                    <small>
                      {formatTime(r.created_at)} ·{" "}
                      {r.status === "draft" ? "草稿" : "历史保存"}
                    </small>
                  </div>
                  <p>{r.payload.goal || r.payload.promise}</p>
                  {r.payload.ending_state && (
                    <p>结束状态：{r.payload.ending_state}</p>
                  )}
                  <p>原因：{r.reason}</p>
                  <button
                    className="mw-button"
                    onClick={() => {
                      if (history.type === "planning") {
                        openPlan(history.row);
                        setEdit((e: any) => ({
                          ...e,
                          payload: structuredClone(r.payload),
                          schema_id: r.schema_id,
                          schema: h.data.schemas[r.schema_id],
                        }));
                      } else {
                        openThread({ ...history.row, payload: r.payload });
                      }
                      setHistory(null);
                    }}
                  >
                    以此版本继续编辑
                  </button>
                </article>
              ))
            ) : (
              <p className="mw-empty">还没有更早的版本。</p>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
