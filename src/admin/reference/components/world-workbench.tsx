"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, formatTime } from "@reference/lib/api";
import { Drawer, Spinner, ErrorState, useToast } from "./ui";
import { ExtraFields } from "./memory-workbench";
import "./planning-workbench.css";

const labels: Record<string, string> = {
  title: "规则名称",
  rule_key: "作用键（同类规则使用相同名称）",
  scope: "适用范围",
  trigger: "触发条件",
  effect: "作用 / 结果",
  limits: "限制",
  cost: "使用代价",
  exceptions: "例外说明",
  public_text: "故事中的规则表述",
  mechanism: "真实机制（仅作者 / 导演）",
  writer_constraint: "允许交给写作模型的约束",
};
const blank = () => ({
  title: "",
  rule_key: "",
  scope: "",
  trigger: "",
  effect: "",
  limits: "",
  cost: "",
  exceptions: "",
  public_text: "",
  mechanism: "",
  writer_constraint: "",
  understandings: [],
  entity_ids: [],
  source_ids: [],
  exception_of: null,
  worldline_id: "main",
  chapter_from: 1,
  chapter_to: 99999,
  reveal_from: 1,
  attributes: {},
});

export function WorldWorkbench({
  pid,
  admin = false,
}: {
  pid: string;
  admin?: boolean;
}) {
  const path = `${admin ? "/admin/structured" : "/studio"}/projects/${pid}/world-rules`,
    cache = useQueryClient(),
    toast = useToast();
  const [edit, setEdit] = useState<any>(null),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any>(null);
  const q = useQuery({
    queryKey: ["world-rules", path],
    queryFn: () => api(path),
  });
  const h = useQuery({
    queryKey: ["world-history", path, history?.id],
    queryFn: () => api(`${path}/${history.id}/versions`),
    enabled: !!history,
  });
  function open(row?: any) {
    const r = row?.draft || row?.approved;
    setEdit({
      node_id: row?.id,
      expected_version: row?.version,
      payload: structuredClone(r?.payload || blank()),
      schema_id: r?.schema_id || q.data?.schema.id,
    });
    setReason("");
    setPreview(null);
  }
  function update(changes: any) {
    setEdit((e: any) => ({ ...e, payload: { ...e.payload, ...changes } }));
    setPreview(null);
  }
  async function submit(mode: "preview" | "draft" | "confirm") {
    setBusy(true);
    try {
      const body = {
        ...edit,
        reason,
        confirm: mode === "confirm",
        preview_token: preview?.preview_token,
      };
      const r = await post(path + (mode === "preview" ? "/preview" : ""), body);
      if (mode === "preview") setPreview(r);
      else {
        setEdit(null);
        await cache.invalidateQueries();
        toast(
          mode === "confirm"
            ? "世界规则已确认；关联版本已核对"
            : "草稿已保存，当前生效规则保持原版本",
        );
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const fields =
    (q.data.schemas[edit?.schema_id] || q.data.schema).modules.find(
      (m: any) => m.key === "world",
    )?.fields || [];
  return (
    <section className="mw pw">
      <div className="mw-heading">
        <div>
          <h3>世界规则</h3>
          <p>明确适用条件、代价与例外；规则设定和正文事实分别保留。</p>
        </div>
        <button className="mw-button primary" onClick={() => open()}>
          新建规则
        </button>
      </div>
      {!q.data.items.length && (
        <p className="mw-empty">
          先建立关键规则，再在章节 /
          场景任务书中关联。真实机制不会自动进入人物知道的事。
        </p>
      )}
      <div className="pw-plan-list">
        {q.data.items.map((row: any) => {
          const r = row.draft || row.approved,
            v = r.payload;
          return (
            <article className="pw-card" key={row.id}>
              <span>
                {row.draft ? "待确认草稿" : "已确认"} · {v.worldline_id} · 第{" "}
                {v.chapter_from}–{v.chapter_to} 章
              </span>
              <h4>{v.title}</h4>
              <p>
                {v.trigger} → {v.effect}
              </p>
              <p className="mw-note">
                范围：{v.scope} · 代价：{v.cost || "未填写"}
              </p>
              {(row.needs_recheck || row.conflicts.length > 0) && (
                <p className="mw-alert">
                  依据已变化或存在重叠规则，请复核后重新确认。
                </p>
              )}
              <div className="pw-actions">
                <button className="mw-button" onClick={() => open(row)}>
                  查看 / 修改
                </button>
                <button className="mw-button" onClick={() => setHistory(row)}>
                  版本记录
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {edit && (
        <Drawer wide title="编辑世界规则" onClose={() => setEdit(null)}>
          <div className="mw mw-form">
            <div className="mw-grid">
              {Object.entries(labels).map(([key, label]) => (
                <label key={key}>
                  {label}
                  {["title", "rule_key"].includes(key) ? (
                    <input
                      value={edit.payload[key]}
                      onChange={(e) => update({ [key]: e.target.value })}
                    />
                  ) : (
                    <textarea
                      rows={3}
                      value={edit.payload[key]}
                      onChange={(e) => update({ [key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>
            <p className="mw-note">
              正文只读取“写作约束”及达到揭示章节后的“规则表述”。下方人物理解是作者的设定，必须有正文证据确认后才进入谁知道什么。
            </p>
            <div className="mw-grid">
              <label>
                世界线
                <input
                  value={edit.payload.worldline_id}
                  onChange={(e) => update({ worldline_id: e.target.value })}
                />
              </label>
              <label>
                这是哪条规则的例外
                <select
                  value={edit.payload.exception_of || ""}
                  onChange={(e) =>
                    update({ exception_of: e.target.value || null })
                  }
                >
                  <option value="">独立规则</option>
                  {q.data.items
                    .filter((r: any) => r.approved && r.id !== edit.node_id)
                    .map((r: any) => (
                      <option value={r.id} key={r.id}>
                        {r.approved.payload.title}
                      </option>
                    ))}
                </select>
              </label>
              {[
                ["chapter_from", "生效起始章节"],
                ["chapter_to", "生效结束章节"],
                ["reveal_from", "表述允许揭示章节"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={1}
                    max={99999}
                    value={edit.payload[key]}
                    onChange={(e) => update({ [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <label>
                关联人物 / 对象
                <select
                  multiple
                  value={edit.payload.entity_ids}
                  onChange={(e) =>
                    update({
                      entity_ids: Array.from(e.target.selectedOptions).map(
                        (o) => o.value,
                      ),
                    })
                  }
                >
                  {q.data.entities.map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                已确认来源版本
                <select
                  multiple
                  value={edit.payload.source_ids}
                  onChange={(e) =>
                    update({
                      source_ids: Array.from(e.target.selectedOptions).map(
                        (o) => o.value,
                      ),
                    })
                  }
                >
                  {q.data.sources.map((id: string) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <details>
              <summary>人物对规则的理解</summary>
              {edit.payload.understandings.map((u: any, i: number) => (
                <div className="pw-card mw-grid" key={i}>
                  <label>
                    人物
                    <select
                      value={u.character_id}
                      onChange={(e) =>
                        update({
                          understandings: edit.payload.understandings.map(
                            (x: any, j: number) =>
                              j === i
                                ? { ...x, character_id: e.target.value }
                                : x,
                          ),
                        })
                      }
                    >
                      <option value="">选择人物</option>
                      {q.data.entities
                        .filter((x: any) => x.type === "character")
                        .map((x: any) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    从第几章开始
                    <input
                      type="number"
                      min={1}
                      value={u.from_chapter}
                      onChange={(e) =>
                        update({
                          understandings: edit.payload.understandings.map(
                            (x: any, j: number) =>
                              j === i
                                ? { ...x, from_chapter: Number(e.target.value) }
                                : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    理解内容
                    <textarea
                      value={u.interpretation}
                      onChange={(e) =>
                        update({
                          understandings: edit.payload.understandings.map(
                            (x: any, j: number) =>
                              j === i
                                ? { ...x, interpretation: e.target.value }
                                : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <DeleteButton
                    confirmation="inline"
                    className="mw-button"
                    onClick={() =>
                      update({
                        understandings: edit.payload.understandings.filter(
                          (_: any, j: number) => j !== i,
                        ),
                      })
                    }
                  >
                    移除此理解
                  </DeleteButton>
                </div>
              ))}
              <button
                className="mw-button"
                onClick={() =>
                  update({
                    understandings: [
                      ...edit.payload.understandings,
                      { character_id: "", interpretation: "", from_chapter: 1 },
                    ],
                  })
                }
              >
                添加人物理解
              </button>
            </details>
            <div className="mw-grid">
              <ExtraFields
                fields={fields}
                value={edit.payload.attributes}
                change={(v) => update({ attributes: v })}
              />
            </div>
            <label>
              修改原因
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setPreview(null);
                }}
              />
            </label>
            {preview && (
              <div className="pw-preview">
                <strong>
                  影响 {preview.plan_ids.length} 个关联计划、
                  {preview.artifacts.length} 份正文 / 产物
                </strong>
                <p>已确认原文保留并标记复核；尚未确认的相关方案会过期。</p>
                {preview.conflicts.map((c: any) => (
                  <p className="mw-alert" key={c.id}>
                    重叠规则：{c.title}。请调整作用键 / 范围 / 章节或明确例外。
                  </p>
                ))}
              </div>
            )}
            <div className="pw-actions">
              <button
                className="mw-button"
                disabled={busy || reason.trim().length < 2}
                onClick={() => submit("draft")}
              >
                保存草稿
              </button>
              <button
                className="mw-button"
                disabled={busy || reason.trim().length < 2}
                onClick={() => submit("preview")}
              >
                检查冲突与影响
              </button>
              <button
                className="mw-button primary"
                disabled={busy || !preview || preview.conflicts.length > 0}
                onClick={() => submit("confirm")}
              >
                确认生效
              </button>
            </div>
          </div>
        </Drawer>
      )}
      {history && (
        <Drawer title="规则版本与恢复" wide onClose={() => setHistory(null)}>
          <div className="mw">
            {h.isPending ? (
              <Spinner />
            ) : h.error ? (
              <ErrorState error={h.error} />
            ) : (
              h.data.items.map((v: any) => (
                <article className="pw-card" key={v.id}>
                  <h4>{v.payload.title}</h4>
                  <small>
                    {formatTime(v.created_at)} · {v.reason}
                  </small>
                  <p>{v.payload.effect}</p>
                  <button
                    className="mw-button"
                    onClick={() => {
                      setEdit({
                        node_id: history.id,
                        expected_version: history.version,
                        payload: structuredClone(v.payload),
                        schema_id: v.schema_id,
                      });
                      setReason("基于历史版本恢复规则");
                      setPreview(null);
                      setHistory(null);
                    }}
                  >
                    基于此版本编辑
                  </button>
                </article>
              ))
            )}
          </div>
        </Drawer>
      )}
    </section>
  );
}
