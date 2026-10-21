"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Plus, RefreshCw, Search } from "lucide-react";
import {
  api,
  post,
  type DataRecord,
  type PageSpec,
  formatTime,
} from "@reference/lib/api";
import { Spinner, ErrorState, useToast } from "./ui";
import { SearchBox, Modal, RefEmpty } from "./reference-ui";
import { ReferenceRecordForm } from "./reference-record-form";
const categories = [
  ["profile", "用户画像"],
  ["preference", "偏好"],
  ["assistant", "智能体经验"],
  ["reference", "项目知识"],
  ["other", "其它"],
];
export function ReferenceMemory({ page }: { page: PageSpec }) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [agent, setAgent] = useState(""),
    [owner, setOwner] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [form, setForm] = useState<DataRecord | null | undefined>(),
    [selected, setSelected] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false),
    [question, setQuestion] = useState(""),
    [top, setTop] = useState(8),
    [score, setScore] = useState(0.32),
    [hits, setHits] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const cache = useQueryClient(),
    toast = useToast(),
    filters = {
      category,
      agent_id: agent,
      owner_id: owner,
      created_from: start,
      created_to: end,
    };
  const q = useQuery({
    queryKey: ["memory-view", search, category, agent, owner, start, end],
    queryFn: () =>
      api(
        `/admin/reference/list/memory?${new URLSearchParams({ q: search, filters: JSON.stringify(filters), page_size: "200" })}`,
      ),
  });
  const agents = useQuery({
    queryKey: ["memory-agents"],
    queryFn: () => api("/admin/records/agents?page_size=200"),
  });
  const users = useQuery({
    queryKey: ["memory-users"],
    queryFn: () => api("/admin/users?page_size=200"),
  });
  const items: DataRecord[] = q.data?.items || [],
    refresh = () => cache.invalidateQueries({ queryKey: ["memory-view"] });
  return (
    <div className="ref-page ref-memory-page">
      <header className="ref-memory-hero">
        <div>
          <small>
            <Brain size={15} />
            AGENT MEMORY OBSERVATORY
          </small>
          <h1>智能体记忆管理</h1>
          <p>
            把长期记忆按类型、人、智能体和时间组织成可检索的星图，支持人工校准与召回验证。
          </p>
        </div>
        <div className="ref-actions">
          <button className="button secondary" onClick={() => q.refetch()}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button className="button primary" onClick={() => setForm(null)}>
            <Plus size={15} />
            新增记忆
          </button>
        </div>
      </header>
      <div className="ref-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="搜索记忆内容、分类..."
        />
        <select
          aria-label="记忆分类"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">记忆分类</option>
          {categories.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <select
          aria-label="智能体"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        >
          <option value="">智能体（仅影响经验）</option>
          {agents.data?.items.map((r: DataRecord) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          aria-label="人"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">人</option>
          {users.data?.items.map((r: DataRecord) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input
          aria-label="开始日期"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <input
          aria-label="结束日期"
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      {q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="ref-memory-layout">
          <div>
            <section className="ref-memory-summary ref-box">
              <div className="ref-memory-stats">
                {[
                  ["总量", q.data?.total || 0],
                  ["关联人", new Set(items.map((i) => i.data.owner_id)).size],
                  [
                    "智能体",
                    new Set(items.map((i) => i.data.agent_id).filter(Boolean))
                      .size,
                  ],
                  ["平均置信", "—"],
                ].map(([name, v]) => (
                  <div key={name}>
                    <span>{name}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <div className="ref-memory-categories">
                <h3>分类分布</h3>
                {categories.map(([v, n]) => (
                  <div key={v}>
                    <span>{n}</span>
                    <i>
                      <b
                        style={{
                          width: `${(items.filter((i) => i.data.category === v).length / Math.max(1, items.length)) * 100}%`,
                        }}
                      />
                    </i>
                    <small>
                      {items.filter((i) => i.data.category === v).length}
                    </small>
                  </div>
                ))}
              </div>
            </section>
            <section className="ref-memory-stars ref-box">
              <h3>星云视图</h3>
              <p>悬浮节点查看详情，点击节点定位下方表格</p>
              <div className="ref-star-canvas">
                <div className="ref-memory-center">
                  <Brain size={27} />
                  <strong>{q.data?.total || 0}</strong>
                  <small>memories</small>
                </div>
                <svg viewBox="0 0 720 420" aria-label="记忆分布">
                  {items.map((r, i) => {
                    const angle = i * 2.3999,
                      rad = 75 + Math.sqrt(i) * 12,
                      x = 360 + Math.cos(angle) * rad,
                      y = 210 + Math.sin(angle) * rad * 0.6;
                    return (
                      <g key={r.id}>
                        <line
                          x1={360}
                          y1={210}
                          x2={x}
                          y2={y}
                          stroke="var(--memory-link, #d4ef6818)"
                        />
                        <circle
                          tabIndex={0}
                          role="button"
                          aria-label={`定位记忆 ${r.name}`}
                          cx={x}
                          cy={y}
                          r={4 + Math.min(6, Number(r.data.weight) || 1)}
                          fill={selected.includes(r.id) ? "var(--memory-selected, #fff)" : "var(--lime)"}
                          onClick={() => {
                            setSelected([r.id]);
                            document
                              .getElementById("memory-" + r.id)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "center",
                              });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setSelected([r.id]);
                              document
                                .getElementById("memory-" + r.id)
                                ?.scrollIntoView({ block: "center" });
                            }
                          }}
                        >
                          <title>{r.data.content}</title>
                        </circle>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </section>
            <section className="ref-box">
              <div className="ref-heading">
                <div>
                  <h3>记忆内容</h3>
                  <p>
                    当前筛选共 {q.data?.total || 0} 条，已选 {selected.length}{" "}
                    条
                  </p>
                </div>
                <div className="ref-actions">
                  <button
                    className="text-button"
                    onClick={() => setSelected([])}
                  >
                    取消选择
                  </button>
                  <DeleteButton
                    confirmation="dialog"
                    className="button secondary"
                    disabled={!selected.length}
                    onClick={() => setConfirm(true)}
                  >
                    删除选中
                  </DeleteButton>
                </div>
              </div>
              <div className="ref-table-wrap">
                <table className="ref-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>分类</th>
                      <th>记忆内容</th>
                      <th>人</th>
                      <th>智能体</th>
                      <th>权重</th>
                      <th>创建时间</th>
                      <th>召回</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.isPending ? (
                      <tr>
                        <td colSpan={9}>
                          <Spinner />
                        </td>
                      </tr>
                    ) : items.length ? (
                      items.map((r) => (
                        <tr id={"memory-" + r.id} key={r.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.includes(r.id)}
                              aria-label={`选择 ${r.name}`}
                              onChange={(e) =>
                                setSelected((v) =>
                                  e.target.checked
                                    ? [...v, r.id]
                                    : v.filter((x) => x !== r.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            {categories.find(
                              (c) => c[0] === r.data.category,
                            )?.[1] || r.data.category}
                          </td>
                          <td title={r.data.content}>{r.data.content}</td>
                          <td>
                            {users.data?.items.find(
                              (u: DataRecord) => u.id === r.data.owner_id,
                            )?.name || r.data.owner_id}
                          </td>
                          <td>
                            {agents.data?.items.find(
                              (a: DataRecord) => a.id === r.data.agent_id,
                            )?.name || "—"}
                          </td>
                          <td>{r.data.weight}</td>
                          <td>{formatTime(r.created_at)}</td>
                          <td>
                            {hits?.items.find((h: any) => h.id === r.id)
                              ?.score ?? "—"}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setForm(r)}
                            >
                              编辑
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9}>
                          <RefEmpty />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {q.data?.total > 200 && (
                <p className="ref-field-help">
                  当前显示前 200 条，请按人、智能体或时间缩小范围。
                </p>
              )}
            </section>
          </div>
          <section className="ref-box ref-memory-recall">
            <h3>召回测试</h3>
            <textarea
              rows={5}
              aria-label="召回问题"
              placeholder="输入一段用户问题，测试当前筛选范围内会召回哪些记忆..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <label className="ref-inline-field">
              Top K{" "}
              <input
                aria-label="Top K"
                type="number"
                min={1}
                max={50}
                value={top}
                onChange={(e) => setTop(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>
                最低分 <b>{score}</b>
              </span>
              <input
                aria-label="最低分"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
              />
            </label>
            <button
              className="button primary"
              disabled={busy || !question.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  setHits(
                    await post("/admin/reference/memory/recall", {
                      query: question,
                      top_k: top,
                      threshold: score,
                      filters,
                    }),
                  );
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Brain size={15} />
              测试召回
            </button>
            {hits ? (
              <>
                <p className="ref-field-help">
                  关键词召回 · {hits.items.length} 条结果
                </p>
                {hits.items.length ? (
                  hits.items.map((h: any) => (
                    <div className="ref-notice" key={h.id}>
                      <small>相关度 {h.score}</small>
                      <p>{h.text}</p>
                    </div>
                  ))
                ) : (
                  <RefEmpty text="没有达到阈值的记忆" />
                )}
              </>
            ) : (
              <div className="ref-recall-wait">等待一次召回测试</div>
            )}
          </section>
        </div>
      )}
      {form !== undefined && (
        <ReferenceRecordForm
          page={page}
          record={form || undefined}
          onClose={() => setForm(undefined)}
          onDone={refresh}
        />
      )}
      {confirm && (
        <Modal
          title="删除选中记忆"
          onClose={() => setConfirm(false)}
          footer={
            <DeleteButton
              confirmation="commit"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  for (const r of items.filter((i) => selected.includes(i.id)))
                    await api(
                      `/admin/records/memory/${r.id}?expected_version=${r.version}`,
                      { method: "DELETE" },
                    );
                  setSelected([]);
                  setConfirm(false);
                  toast("记忆已删除");
                } catch (e) {
                  toast((e as Error).message, true);
                  return false;
                } finally {
                  refresh();
                  setBusy(false);
                }
              }}
            >
              确认删除
            </DeleteButton>
          }
        >
          <p>将删除选中的 {selected.length} 条记忆。</p>
        </Modal>
      )}
    </div>
  );
}
