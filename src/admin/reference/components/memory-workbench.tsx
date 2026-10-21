"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put, formatTime } from "@reference/lib/api";
import { Drawer, ErrorState, Spinner, useToast } from "./ui";
import { Modal } from "./reference-ui";
import { ThreadEventEditor } from "./thread-event-editor";
import "./memory-workbench.css";

const stateNames: Record<string, string> = {
  knows: "知道",
  believes: "相信",
  suspects: "怀疑",
  denies: "否认",
  explicitly_unaware: "明确不知",
  unknown_record: "未记录",
};
const typeNames: Record<string, string> = {
  character: "人物",
  item: "物品",
  location: "地点",
  organization: "组织",
  event: "事件 / 秘密",
};
const profileNames: Record<string, string> = {
  identity: "身份",
  goal: "当前目标",
  need: "长期目标",
  fear: "最怕什么",
  resources: "现在有什么可以用",
  boundary: "代价与底线",
  relationships: "关系设定",
  abilities: "能力与限制",
  voice: "说话习惯",
  behavior: "做事习惯",
  initial_emotion: "开篇时的心情",
  evidence: "设定来源 / 行动证据说明",
};
const predicateNames: Record<string, string> = {
  injury: "伤势",
  inventory: "持有物品",
  location: "所在位置",
  identity: "身份",
  goal: "当前目标",
  emotion: "情绪",
  health: "健康状况",
  status: "当前状态",
  owner: "所有者",
  holder: "持有人",
};
function editedPredicate(value: string, current: string): string {
  if (value === (predicateNames[current] || current)) return current;
  return Object.entries(predicateNames).find(([, label]) => label === value)?.[0] || value;
}
const basePath = (pid: string, admin = false) =>
  `${admin ? "/admin/structured" : "/studio"}/projects/${pid}`;

export function ExtraFields({
  fields,
  value,
  change,
}: {
  fields: any[];
  value: any;
  change: (v: any) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.key}>
          补充：{f.label}
          {f.required ? " *" : ""}
          {f.type === "boolean" ? (
            <select
              value={value[f.key] === undefined ? "" : String(value[f.key])}
              onChange={(e) =>
                change({
                  ...value,
                  [f.key]:
                    e.target.value === "" ? null : e.target.value === "true",
                })
              }
            >
              <option value="">未填写</option>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          ) : f.type === "select" ? (
            <select
              value={value[f.key] || ""}
              onChange={(e) => change({ ...value, [f.key]: e.target.value })}
            >
              <option value="">请选择</option>
              {f.options.map((s: string) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              value={
                Array.isArray(value[f.key])
                  ? value[f.key].join("、")
                  : (value[f.key] ?? "")
              }
              onChange={(e) =>
                change({
                  ...value,
                  [f.key]:
                    f.type === "number"
                      ? e.target.value === ""
                        ? null
                        : Number(e.target.value)
                      : f.type === "list"
                        ? e.target.value
                            .split(/[、,，]/)
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : e.target.value,
                })
              }
              placeholder={f.type === "list" ? "用顿号分隔" : ""}
            />
          )}
        </label>
      ))}
    </>
  );
}

export function EntityRegistry({
  pid,
  admin = false,
  defaultType = "character",
}: {
  pid: string;
  admin?: boolean;
  defaultType?: string;
}) {
  const path = basePath(pid, admin),
    cache = useQueryClient(),
    toast = useToast();
  const q = useQuery({
    queryKey: ["story-entities", path],
    queryFn: () => api(path + "/entities"),
  });
  const [edit, setEdit] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const versions = useQuery({
    queryKey: ["story-entity-versions", path, edit?.id],
    queryFn: () => api(path + "/entities/" + edit.id + "/versions"),
    enabled: !!edit?.id,
  });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const fields =
    q.data.schema.modules.find((m: any) => m.key === "characters")?.fields ||
    [];
  return (
    <div className="mw">
      <div className="mw-heading">
        <div>
          <h3>人物与对象档案</h3>
          <p>
            名称和别名共用一个身份；设定档案供作者维护，知道多少需在有证据的提案中确认。
          </p>
        </div>
        <button
          className="mw-button primary"
          onClick={() =>
            setEdit({
              name: "",
              type: defaultType,
              aliases: [],
              aliasesText: "",
              profile: {},
              attributes: {},
              reason: "",
            })
          }
        >
          新建档案
        </button>
      </div>
      {!q.data.items.length ? (
        <p className="mw-empty">
          先登记人物、物品或秘密，再把记忆条目关联到这些对象。
        </p>
      ) : (
        <div className="mw-entities">
          {q.data.items.map((r: any) => (
            <button
              className="mw-entity"
              key={r.id}
              onClick={() =>
                setEdit({
                  id: r.id,
                  name: r.name,
                  version: r.version,
                  ...r.data,
                  aliasesText: r.data.aliases.join("、"),
                  attributes: Object.fromEntries(
                    Object.entries(r.data.attributes || {}).filter(([k]) =>
                      fields.some((f: any) => f.key === k),
                    ),
                  ),
                  reason: "",
                })
              }
            >
              <span>
                {typeNames[r.data.type]} · v{r.version}
              </span>
              <strong>{r.name}</strong>
              <small>{r.data.aliases.join(" / ") || "尚未填写别名"}</small>
              <p>
                {r.data.profile.goal ||
                  r.data.profile.identity ||
                  "点击维护档案"}
              </p>
            </button>
          ))}
        </div>
      )}
      {edit && (
        <Drawer
          wide
          title={edit.id ? `编辑档案 · ${edit.name}` : "新建人物 / 对象档案"}
          onClose={() => setEdit(null)}
        >
          <form
            className="mw mw-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const body = {
                  name: edit.name,
                  type: edit.type,
                  aliases: edit.aliasesText
                    .split(/[、,，]/)
                    .map((s: string) => s.trim())
                    .filter(Boolean),
                  profile: edit.profile,
                  attributes: edit.attributes,
                  reason: edit.reason,
                  expected_version: edit.version,
                  expected_project_version: q.data.project.version,
                };
                await (edit.id
                  ? put(path + "/entities/" + edit.id, body)
                  : post(path + "/entities", body));
                await cache.invalidateQueries();
                setEdit(null);
                toast("档案已保存，历史记录已保留");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="mw-grid">
              <label>
                名称
                <input
                  required
                  maxLength={120}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label>
                对象类型
                <select
                  disabled={!!edit.id}
                  value={edit.type}
                  onChange={(e) => setEdit({ ...edit, type: e.target.value })}
                >
                  {Object.entries(typeNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                别名
                <input
                  value={edit.aliasesText}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      aliasesText: e.target.value,
                    })
                  }
                  placeholder="用顿号分隔"
                />
              </label>
            </div>
            <p className="mw-note">

            </p>
            <div className="mw-grid">
              {Object.entries(profileNames).map(([k, v]) => (
                <label key={k}>
                  {v}
                  <textarea
                    rows={3}
                    value={edit.profile[k] || ""}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        profile: { ...edit.profile, [k]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <h4>全局配置的补充字段</h4>
            {edit.schema_id && edit.schema_id !== q.data.schema.id && (
              <p className="mw-note">
                补充字段将按当前全局版本保存；旧字段保留在档案历史中。
              </p>
            )}
            <div className="mw-grid">
              <ExtraFields
                fields={fields}
                value={edit.attributes}
                change={(v) => setEdit({ ...edit, attributes: v })}
              />
            </div>
            {edit.id && (
              <details className="mw-history">
                <summary>
                  历史档案版本（{versions.data?.items.length || 0}）
                </summary>
                {versions.error && <ErrorState error={versions.error} />}{" "}
                {versions.data?.items.map((v: any) => (
                  <div className="mw-history-row" key={v.version}>
                    <strong>
                      {v.name} · v{v.version}
                    </strong>
                    <small>
                      {formatTime(v.recorded_at)} · {v.reason}
                    </small>
                    <div>
                      {Object.entries(v.data.profile || {}).map(
                        ([k, value]) => (
                          <p key={k}>
                            {profileNames[k] || k}：{String(value)}
                          </p>
                        ),
                      )}
                      {Object.entries(v.data.attributes || {}).map(
                        ([k, value]) => (
                          <p key={k}>
                            补充 {k}：{String(value)}
                          </p>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </details>
            )}
            <label>
              修改原因
              <textarea
                required
                minLength={2}
                value={edit.reason}
                onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
              />
            </label>
            <button className="mw-button primary" disabled={busy}>
              {busy ? "保存中…" : "保存档案"}
            </button>
          </form>
        </Drawer>
      )}
    </div>
  );
}

export function MemoryLens({
  pid,
  admin = false,
  initialChapter = 1,
  initialWorldline = "main",
}: {
  pid: string;
  admin?: boolean;
  initialChapter?: number;
  initialWorldline?: string;
}) {
  const path = basePath(pid, admin),
    [chapter, setChapter] = useState(initialChapter),
    [character, setCharacter] = useState(""),
    [worldline, setWorldline] = useState(initialWorldline),
    [version, setVersion] = useState("");
  const catalog = useQuery({
    queryKey: ["story-entities", path],
    queryFn: () => api(path + "/entities"),
  });
  const params = new URLSearchParams({
    chapter: String(chapter),
    worldline_id: worldline,
  });
  if (character) params.set("character_id", character);
  if (version) params.set("canon_version", version);
  const q = useQuery({
    queryKey: ["story-memory", path, chapter, character, worldline, version],
    queryFn: () => api(path + "/memory-lens?" + params),
  });
  const card = (r: any) => (
    <article
      className={`mw-state ${r.status === "conflict" ? "conflict" : ""}`}
      key={r.id}
    >
      <div className="mw-heading">
        <strong>
          {r.subject} · {r.memory.predicate}
        </strong>
        <span>
          {r.status === "conflict"
            ? "证据冲突"
            : r.memory.epistemic_state
              ? `${r.holder} · ${stateNames[r.memory.epistemic_state]}`
              : "客观记录"}
        </span>
      </div>
      <p>{r.memory.value}</p>
      <small>
        生效：第 {r.memory.valid_from_chapter} 章
        {r.memory.valid_until_chapter
          ? ` 至第 ${r.memory.valid_until_chapter - 1} 章`
          : "起"}{" "}
        · 故事时间：{r.memory.story_time || "未记录"}
      </small>
      <details>
        <summary>证据与版本</summary>
        <blockquote>{r.evidence.quote}</blockquote>
        <small>
          来源：第 {r.source_chapter} 章 · 故事记录 v{r.version} · 系统记录{" "}
          {formatTime(r.recorded_at)}
        </small>
        <p>
          读者获知：
          {r.memory.reader_from_chapter
            ? `第 ${r.memory.reader_from_chapter} 章`
            : "未披露 / 未记录"}{" "}
          · {r.memory.depends_on.length} 条前置依赖
        </p>
      </details>
    </article>
  );
  return (
    <div className="mw">
      <div className="mw-heading">
        <div>
          <h3>谁知道什么</h3>
          <p>
            分别查看客观状态、人物知道的事和读者获知；没有记录不代表人物明确不知道。
          </p>
        </div>
      </div>
      <div className="mw-filters">
        <label>
          截至章节
          <input
            type="number"
            min={0}
            max={99999}
            value={chapter}
            onChange={(e) => setChapter(Number(e.target.value))}
          />
        </label>
        <label>
          视角人物
          <select
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
          >
            <option value="">选择人物</option>
            {catalog.data?.items
              .filter((r: any) => r.data.type === "character")
              .map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          世界线
          <input
            value={worldline}
            onChange={(e) => setWorldline(e.target.value)}
            placeholder="main"
          />
        </label>
        <label>
          故事记录版本
          <input
            type="number"
            min={0}
            placeholder="当前版本"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </label>
      </div>
      {catalog.error && <ErrorState error={catalog.error} />}
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          {!!q.data.needs_recheck.length && (
            <p className="mw-alert">
              {q.data.needs_recheck.length}{" "}
              条状态的前置证据已失效，已从有效台账与生成参考内容中排除。请核对依赖并重新确认。
            </p>
          )}
          <div className="mw-columns">
            {[
              ["actual", "实际情况"],
              ["character", "人物所信"],
              ["reader", "读者已知"],
            ].map(([key, title]) => (
              <section key={key}>
                <h4>
                  {title}
                  <small>
                    {key === "character"
                      ? catalog.data?.items.find((r: any) => r.id === character)
                          ?.name || "请选择人物"
                      : `截至第 ${chapter} 章`}
                  </small>
                </h4>
                {q.data[key].length ? (
                  q.data[key].map(card)
                ) : (
                  <p className="mw-empty">
                    {key === "character" && !character
                      ? "先选择一个人物"
                      : "未记录"}
                  </p>
                )}
                {key === "character" &&
                  character &&
                  q.data.actual
                    .filter(
                      (r: any) =>
                        !q.data.character.some(
                          (c: any) =>
                            c.memory.subject_id === r.memory.subject_id &&
                            c.memory.predicate === r.memory.predicate,
                        ),
                    )
                    .map((r: any) => (
                      <p className="mw-empty" key={r.id}>
                        {r.subject} · {r.memory.predicate}：未记录
                      </p>
                    ))}
              </section>
            ))}
          </div>
          <p className="mw-note">
            故事记录 v{q.data.canon_version} · {q.data.unstructured_count}{" "}
            条普通事实尚未绑定台账字段。普通事实不会自动推断为人物已知。
          </p>
          <details className="mw-history">
            <summary>状态变化记录（{q.data.history.length}）</summary>
            {q.data.history.map((r: any) => (
              <div className="mw-history-row" key={r.id}>
                <strong>
                  {r.subject} · {r.memory.predicate}
                </strong>
                <span>{r.memory.value}</span>
                <small>
                  第 {r.memory.valid_from_chapter} 章 · v{r.version} ·{" "}
                  {r.status === "needs_recheck"
                    ? "依赖失效，待复核"
                    : "已确认的历史事件"}
                </small>
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}

export function MemorySlotEditor({
  pid,
  admin = false,
  fact,
  change,
  chapter = 1,
  excludeEventId,
}: {
  pid: string;
  admin?: boolean;
  fact: any;
  change: (v: any) => void;
  chapter?: number;
  excludeEventId?: string;
}) {
  const path = basePath(pid, admin),
    q = useQuery({
      queryKey: ["story-entities", path],
      queryFn: () => api(path + "/entities"),
    });
  const deps = useQuery({
    queryKey: ["story-dependencies", path, fact.memory?.worldline_id || "main"],
    queryFn: () =>
      api(
        path +
          "/memory-lens?chapter=99999&worldline_id=" +
          encodeURIComponent(fact.memory?.worldline_id || "main"),
      ),
  });
  const m = fact.memory,
    update = (v: any) => change({ ...fact, memory: { ...m, ...v } });
  const validDependencies = (deps.data?.history || []).filter(
    (r: any) =>
      r.status === "confirmed" &&
      r.id !== excludeEventId &&
      r.source_chapter <= chapter,
  );
  const missingDependencies = deps.data
    ? (m?.depends_on || []).filter(
        (id: string) => !validDependencies.some((r: any) => r.id === id),
      )
    : [];
  return (
    <div className="mw mw-slot">
      <label className="mw-check">
        <input
          type="checkbox"
          checked={!!m}
          onChange={(e) =>
            change({
              ...fact,
              ...(e.target.checked ? { thread: null } : {}),
              memory: e.target.checked
                ? {
                    subject_id: "",
                    predicate: "",
                    value: "",
                    valid_from_chapter: chapter,
                    reader_from_chapter: chapter,
                    worldline_id: "main",
                    depends_on: [],
                  }
                : null,
            })
          }
        />
        启用按章状态 / 人物知道的事
      </label>
      {m && (
        <>
          <p className="mw-note">修改记录时，也请核对下面的人物状态。</p>
          {q.error && <ErrorState error={q.error} />}
          <div className="mw-grid">
            <label>
              记忆主体
              <select
                value={m.subject_id}
                onChange={(e) => update({ subject_id: e.target.value })}
              >
                <option value="">选择已登记的对象</option>
                {q.data?.items.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {typeNames[r.data.type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              状态项目
              <input
                aria-label="状态项目"
                value={admin ? m.predicate : predicateNames[m.predicate] || m.predicate}
                onChange={(e) => update({ predicate: admin ? e.target.value : editedPredicate(e.target.value, m.predicate) })}
                placeholder="如：真凶、持有人、当前目标"
              />
            </label>
            <label>
              记录视角
              <select
                value={m.holder_id || ""}
                onChange={(e) =>
                  change({
                    ...fact,
                    category: e.target.value ? "knowledge" : "facts",
                    kind: e.target.value ? "belief" : "canonical",
                    attributes: {},
                    memory: {
                      ...m,
                      holder_id: e.target.value || null,
                      epistemic_state: e.target.value
                        ? m.epistemic_state || "believes"
                        : null,
                    },
                  })
                }
              >
                <option value="">客观状态</option>
                {q.data?.items
                  .filter((r: any) => r.data.type === "character")
                  .map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.name} 的认知
                    </option>
                  ))}
              </select>
            </label>
            {m.holder_id && (
              <label>
                知道多少
                <select
                  value={m.epistemic_state || "believes"}
                  onChange={(e) => update({ epistemic_state: e.target.value })}
                >
                  {Object.entries(stateNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label>
            状态值 / 人物知道的事
            <textarea
              aria-label="状态值 / 人物知道的事"
              rows={3}
              value={m.value}
              onChange={(e) => update({ value: e.target.value })}
              placeholder="只写该视角所知或所信，不要夹带人物不知道的真相。"
            />
          </label>
          <details>
          <summary>生效时间与关联记录</summary>
          <div className="mw-grid">
            <label>
              生效章节
              <input
                type="number"
                min={chapter}
                value={m.valid_from_chapter}
                onChange={(e) =>
                  update({ valid_from_chapter: Number(e.target.value) })
                }
              />
            </label>
            <label>
              失效章节（留空为持续）
              <input
                type="number"
                min={2}
                value={m.valid_until_chapter || ""}
                onChange={(e) =>
                  update({
                    valid_until_chapter: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </label>
            <label>
              读者获知章节（留空未披露）
              <input
                type="number"
                min={chapter}
                value={m.reader_from_chapter || ""}
                onChange={(e) =>
                  update({
                    reader_from_chapter: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </label>
            <label>
              故事时间
              <input
                value={m.story_time || ""}
                onChange={(e) => update({ story_time: e.target.value })}
                placeholder="如：第三轮循环，黎明"
              />
            </label>
            <label>
              对应事件
              <input
                value={m.story_event || ""}
                onChange={(e) => update({ story_event: e.target.value })}
                placeholder="如：钥匙交付"
              />
            </label>
            <label>
              世界线标识
              <input
                value={m.worldline_id}
                onChange={(e) => update({ worldline_id: e.target.value })}
              />
            </label>
          </div>
          <label>
            前置证据（可多选）
            <select
              multiple
              value={m.depends_on || []}
              onChange={(e) =>
                update({
                  depends_on: Array.from(e.target.selectedOptions).map(
                    (o) => o.value,
                  ),
                })
              }
            >
              {validDependencies.map((r: any) => (
                <option key={r.id} value={r.id}>
                  第{r.source_chapter}章 · {r.subject} · {r.memory.predicate}：
                  {r.memory.value}
                </option>
              ))}
            </select>
          </label>
          {!!missingDependencies.length && (
            <div className="mw-alert">
              有 {missingDependencies.length}{" "}
              条依赖已失效或不适用于当前记录。核对原文能独立支持这条状态后，可
              <button
                type="button"
                className="mw-button"
                onClick={() =>
                  update({
                    depends_on: (m.depends_on || []).filter(
                      (id: string) => !missingDependencies.includes(id),
                    ),
                  })
                }
              >
                清除失效依赖
              </button>
              ，再保存修正。
            </div>
          )}
          </details>
        </>
      )}
    </div>
  );
}

export function MemoryProposalEditor({
  pid,
  project,
  source,
  proposal,
  schema,
}: {
  pid: string;
  project: any;
  source: any;
  proposal: any;
  schema: any;
}) {
  const [open, setOpen] = useState(false),
    [facts, setFacts] = useState<any[]>([]),
    [originalFacts, setOriginalFacts] = useState("[]"),
    [confirmClose, setConfirmClose] = useState(false),
    [recoveryMessage, setRecoveryMessage] = useState(""),
    [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    toast = useToast(),
    cache = useQueryClient();
  const f = facts[selected];
  const requestClose = () => {
    if (busy) return;
    if (JSON.stringify(facts) !== originalFacts) setConfirmClose(true);
    else setOpen(false);
  };
  const sourceCharacters = Array.from(source.text as string);
  const invalidRecord = facts.map((item, index) => {
    const evidence = item.evidence;
    const message = !item.content.trim() ? "请填写记录内容" : !evidence?.quote?.trim()
      ? "请填写对应原文" : sourceCharacters.slice(evidence.start, evidence.end).join("") !== evidence.quote
      ? "对应原文与当前正文不一致，请重新选择" : "";
    return { index, message };
  }).find((item) => item.message);
  const update = (v: any) =>
    setFacts((xs) => xs.map((x, i) => (i === selected ? v : x)));
  const empty = () => ({
    id: crypto.randomUUID(),
    content: "",
    category: "facts",
    kind: "canonical",
    attributes: {},
    visible_to: [],
    evidence: { quote: "", start: 0, end: 1 },
  });
  return (
    <>
      <button
        id="chapter-records"
        className="mw-button"
        disabled={
          source.status !== "candidate" ||
          source.base_canon_version !== project.canon_version
        }
        onClick={() => {
          const saved = proposal ? JSON.parse(proposal.text) : [];
          setFacts(saved);
          setOriginalFacts(JSON.stringify(saved));
          setConfirmClose(false);
          setRecoveryMessage("");
          setSelected(0);
          setOpen(true);
        }}
      >
        查看本章新增记录
      </button>
      {open && (
        <Drawer
          wide
          title="查看本章新增记录"
          subtitle={`第 ${source.chapter} 章 · 保存后仍须逐项选择并确认`}
          onClose={requestClose}
        >
          <div className="mw mw-form">
            {!proposal && facts.length === 0 && <button className="mw-button" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const data = await api(`${basePath(pid)}/memory-proposals/received?${new URLSearchParams({source_id:source.id,expected_source_sha256:source.sha256})}`);
                if (data.available) {
                  setFacts(data.facts);setSelected(data.issues?.[0]?.index || 0);setRecoveryMessage(data.message);
                } else setRecoveryMessage("还没有可以载入的记录。可以从本章原文添加，或重新整理故事记录。");
              } catch (error) { toast((error as Error).message,true); }
              finally { setBusy(false); }
            }}>{busy ? "正在读取…" : "载入之前收到的记录"}</button>}
            {recoveryMessage && <p role="status" className="mw-note">{recoveryMessage}</p>}
            <div className="mw-heading">
              <select
                aria-label="选择故事记录"
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {facts.map((f, i) => (
                  <option key={f.id} value={i}>
                    {i + 1}. {f.content.slice(0, 35) || "新条目"}
                  </option>
                ))}
              </select>
              <button
                className="mw-button"
                onClick={() => {
                  setFacts([...facts, empty()]);
                  setSelected(facts.length);
                }}
              >
                新增条目
              </button>
              {f && (
                <DeleteButton
                  confirmation="inline"
                  className="mw-button"
                  onClick={() => {
                    setFacts(facts.filter((_, i) => i !== selected));
                    setSelected(0);
                  }}
                >
                  移除此记录
                </DeleteButton>
              )}
            </div>
            {f ? (
              <>
                <label>
                  内容描述
                  <textarea
                    aria-label="内容描述"
                    rows={3}
                    value={f.content}
                    onChange={(e) => update({ ...f, content: e.target.value })}
                  />
                </label>
                <div className="mw-grid">
                  <label>
                    记录分类
                    <select
                      value={f.category || "facts"}
                      onChange={(e) =>
                        update({
                          ...f,
                          category: e.target.value,
                          attributes: {},
                        })
                      }
                    >
                      {schema?.modules.map((m: any) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    事实性质
                    <select
                      value={f.kind}
                      onChange={(e) => update({ ...f, kind: e.target.value })}
                    >
                      <option value="canonical">客观事实</option>
                      <option value="belief">人物信念</option>
                      <option value="plan">作者计划</option>
                      <option value="prediction">预测</option>
                      <option value="branch_fact">分支事实</option>
                    </select>
                  </label>
                </div>
                <MemorySlotEditor
                  pid={pid}
                  fact={f}
                  change={update}
                  chapter={source.chapter}
                />
                <ThreadEventEditor pid={pid} fact={f} change={update} />
                <div className="mw-grid">
                  <ExtraFields
                    fields={
                      schema?.modules.find(
                        (m: any) => m.key === (f.category || "facts"),
                      )?.fields || []
                    }
                    value={f.attributes || {}}
                    change={(v) => update({ ...f, attributes: v })}
                  />
                </div>
                <label>
                  对应原文
                  <textarea
                    aria-label="对应原文"
                    rows={3}
                    value={f.evidence.quote}
                    onChange={(e) => {
                      const quote = e.target.value,
                        at = source.text.indexOf(quote),
                        start =
                          at >= 0
                            ? Array.from(source.text.slice(0, at)).length
                            : -1;
                      update({
                        ...f,
                        evidence: {
                          quote,
                          start,
                          end: start + Array.from(quote).length,
                        },
                      });
                    }}
                  />
                </label>
                <small>
                  {f.evidence.start >= 0 && f.evidence.quote
                    ? "已找到对应原文"
                    : "请粘贴当前正文中的原文，不得改写引文"}
                </small>
                <details>
                  <summary>查看对应原文</summary>
                  <pre className="mw-source">{source.text}</pre>
                </details>
              </>
            ) : (
              <p className="mw-empty">还没有记录，可以从本章原文中添加。</p>
            )}
            {invalidRecord && <div role="status" className="mw-alert">
              第 {invalidRecord.index + 1} 条：{invalidRecord.message}。
              {invalidRecord.index !== selected && <button type="button" className="mw-button" onClick={() => setSelected(invalidRecord.index)}>前往修改</button>}
            </div>}
            <button
              className="mw-button primary"
              disabled={busy || !!invalidRecord}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(basePath(pid) + "/memory-proposals", {
                    source_id: source.id,
                    expected_source_sha256: source.sha256,
                    expected_project_version: project.version,
                    previous_proposal_id: proposal?.id || null,
                    expected_proposal_sha256: proposal?.sha256 || null,
                    facts,
                  });
                  await cache.invalidateQueries();
                  toast("记录已保存，请选择要确认的条目");
                  setOpen(false);
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "保存中…" : "保存记录修改"}
            </button>
          </div>
          {confirmClose && <Modal
            title="放弃未保存的修改？"
            onClose={() => setConfirmClose(false)}
            footer={<>
              <button type="button" className="button secondary" onClick={() => setConfirmClose(false)}>继续编辑</button>
              <button type="button" className="button danger" onClick={() => { setConfirmClose(false); setOpen(false); }}>放弃修改</button>
            </>}
          ><p>本次修改还没有保存。</p></Modal>}
        </Drawer>
      )}
    </>
  );
}
