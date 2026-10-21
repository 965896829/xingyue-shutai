"use client";
import { QualityGovernance } from "./quality-governance";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  ShieldCheck,
  BookOpen,
  Layers3,
  Sparkles,
  Play,
  Code2,
  Check,
  History,
  FileText,
  ArrowUpRight,
  LoaderCircle,
} from "lucide-react";
import { api, post, put, label, formatTime, type PageSpec } from "@reference/lib/api";
import {
  PageHeading,
  Drawer,
  Spinner,
  ErrorState,
  Empty,
  Pagination,
  Status,
  useToast,
} from "./ui";

const layerNames: Record<string, string> = {
  core: "通用文本",
  genre: "题材",
  tag: "叙事标签",
  scene: "场景",
  relationship: "关系合同",
  tone: "风格",
  form: "篇幅形式",
  governance: "工程治理",
};
export function RulesPage({ page }: { page: PageSpec }) {
  const [tab, setTab] = useState("rules"),
    [q, setQ] = useState(""),
    [module, setModule] = useState(""),
    [layer, setLayer] = useState(""),
    [pageNo, setPage] = useState(1),
    [release, setRelease] = useState("");
  const [detail, setDetail] = useState<any>(null),
    [showReleases, setShowReleases] = useState(false),
    [showCreate, setShowCreate] = useState(false),
    [version, setVersion] = useState("3.1.1"),
    [busy, setBusy] = useState(false);
  const [lintText, setLintText] = useState(""),
    [genre, setGenre] = useState("URBAN"),
    [lint, setLint] = useState<any>(null),
    [prompt, setPrompt] = useState<any>(null),
    [editing, setEditing] = useState(false),
    [edited, setEdited] = useState("");
  const toast = useToast(),
    cache = useQueryClient();
  const rules = useQuery({
    queryKey: ["rules", q, module, layer, pageNo, release],
    queryFn: () =>
      api(
        `/admin/rules?q=${encodeURIComponent(q)}&module=${module}&layer=${layer}&page=${pageNo}&page_size=15${release ? `&release=${release}` : ""}`,
      ),
  });
  const releases = useQuery({
    queryKey: ["rule-releases"],
    queryFn: () => api("/admin/rules/releases"),
  });
  const prompts = useQuery({
    queryKey: ["prompts", release],
    queryFn: () =>
      api(`/admin/rules/prompts${release ? "?release=" + release : ""}`),
    enabled: tab === "prompts",
  });
  function refresh() {
    cache.invalidateQueries({ queryKey: ["rules"] });
    cache.invalidateQueries({ queryKey: ["rule-releases"] });
    cache.invalidateQueries({ queryKey: ["prompts"] });
  }
  async function runLint() {
    setBusy(true);
    try {
      setLint(
        await post("/admin/rules/lint", { text: lintText, genres: [genre] }),
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function createVersion() {
    setBusy(true);
    try {
      await post("/admin/rules/releases", {
        source: rules.data?.release.id || "3.1.0",
        version,
      });
      setRelease(version);
      refresh();
      setShowCreate(false);
      toast("规则草稿已创建");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function releaseAction(id: string, action: string) {
    setBusy(true);
    try {
      await post(`/admin/rules/releases/${id}/${action}`);
      refresh();
      toast("版本操作已完成");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function saveRule() {
    try {
      const changes = JSON.parse(edited);
      await put(
        `/admin/rules/releases/${rules.data.release.id}/rule/${detail.id}`,
        { expected_digest: rules.data.release.digest, changes },
      );
      refresh();
      setDetail(null);
      toast("规则草稿已保存");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  const catalog = rules.data;
  return (
    <>
      <details><summary>规则质量与审稿模型</summary><QualityGovernance/></details>
      <PageHeading
        eyebrow="创作引擎 · 质量与表达"
        title="提示词与规则"
        description="让每条建议都有依据，让不同的故事保留自己的声音。"
        actions={
          <>
            <button
              className="button secondary"
              onClick={() => setShowReleases(true)}
            >
              <History size={16} />
              版本记录
            </button>
            <button
              className="button primary"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={17} />
              新建规则版本
            </button>
          </>
        }
      />
      <div className="rule-summary">
        <div>
          <ShieldCheck size={17} />
          <strong>{catalog?.release.id || "3.1.0"}</strong>
          <span>当前查看</span>
        </div>
        <div>
          <strong>905</strong>
          <span>条规则</span>
        </div>
        <div>
          <strong>145</strong>
          <span>个模块</span>
        </div>
        <span>43 项本地候选检查 · 语义审稿按预算执行</span>
      </div>
      <div className="tabs">
        {[
          ["rules", "规则库"],
          ["prompts", "专业提示词"],
          ["test", "规则测试"],
        ].map(([id, title]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "rules" && (
        <section className="panel data-panel">
          <div className="table-toolbar">
            <div className="table-search">
              <Search size={17} />
              <input
                placeholder="搜索规则编号、标题或适用条件…"
                aria-label="搜索规则"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="table-filters">
              <select
                aria-label="规则层级"
                value={layer}
                onChange={(e) => {
                  setLayer(e.target.value);
                  setModule("");
                  setPage(1);
                }}
              >
                <option value="">全部层级</option>
                {Object.entries(layerNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                aria-label="适用模块"
                value={module}
                onChange={(e) => {
                  setModule(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部模块</option>
                {catalog?.modules
                  .filter((m: any) => !layer || m.layer === layer)
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {rules.isPending ? (
            <Spinner />
          ) : rules.error ? (
            <ErrorState error={rules.error} />
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>规则编号</th>
                      <th>规则与适用情境</th>
                      <th>所属层级</th>
                      <th>模块</th>
                      <th>检查方式</th>
                      <th className="align-right">详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.items.map((rule: any) => (
                      <tr
                        key={rule.id}
                        onClick={() => {
                          setDetail(rule);
                          setEditing(false);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <span className="rule-id">{rule.id}</span>
                        </td>
                        <td>
                          <span className="rule-title">{rule.title}</span>
                        </td>
                        <td>
                          <span className="layer-tag">
                            {layerNames[rule.layer]}
                          </span>
                        </td>
                        <td className="rule-id">{rule.module_id}</td>
                        <td>
                          <span className="status">
                            <i />
                            {["presence", "density"].includes(
                              rule.detector.kind,
                            )
                              ? "本地候选检查"
                              : "模型 / 人工审查"}
                          </span>
                        </td>
                        <td className="align-right">
                          <button
                            className="icon-button"
                            aria-label={`查看规则 ${rule.id}`}
                          >
                            <ArrowUpRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={pageNo}
                size={15}
                total={catalog.total}
                setPage={setPage}
              />
            </>
          )}
        </section>
      )}
      {tab === "prompts" &&
        (prompts.isPending ? (
          <Spinner />
        ) : (
          <div className="prompt-list">
            {prompts.data?.items.map((p: any) => (
              <button
                className="panel prompt-card"
                style={{ textAlign: "left" }}
                key={p.name}
                onClick={() => setPrompt(p)}
              >
                <FileText size={25} strokeWidth={1.2} />
                <h3>{p.name.replace(/^\d+_/, "").replaceAll("_", " ")}</h3>
                <p>
                  {p.content
                    .split("\n")
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(" ")
                    .slice(0, 95)}
                  …
                </p>
              </button>
            ))}
          </div>
        ))}
      {tab === "test" && (
        <div className="lint-grid">
          <section className="panel lint-panel">
            <h2>先用一段文字试试。</h2>
            <p>本地检查定位词句候选，不自动判断文学质量，也不会改写原文。</p>
            <label className="field" style={{ marginTop: 20 }}>
              <span>题材</span>
              <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                {catalog?.modules
                  .filter((m: any) => m.layer === "genre")
                  .map((m: any) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <textarea
              value={lintText}
              onChange={(e) => setLintText(e.target.value)}
              placeholder="粘贴有权使用的测试正文…"
              aria-label="测试正文"
            />
            <button
              className="button primary"
              onClick={runLint}
              disabled={busy || !lintText.trim()}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Play size={16} />
              )}
              运行本地检查
            </button>
          </section>
          <section className="panel lint-panel">
            <h2>检查范围与结果</h2>
            {lint ? (
              <>
                <div className="info-strip">
                  <ShieldCheck size={16} />
                  已路由 {lint.selected_count} 条规则，划分为 {lint.batches} 批
                </div>
                <p>本轮仅执行本地检测；语义检查尚未执行，不能视为全部通过。</p>
                {lint.report.findings?.length ? (
                  lint.report.findings.map((f: any, i: number) => (
                    <div className="finding" key={i}>
                      <strong>
                        {f.rule_id} · {f.title || f.message || "候选问题"}
                      </strong>
                      <p>{f.reason || f.explanation || JSON.stringify(f)}</p>
                    </div>
                  ))
                ) : (
                  <Empty
                    title="本地未发现候选问题"
                    description="这不代表语义审查通过；前文、人物与题材仍需要进一步审查。"
                  />
                )}
              </>
            ) : (
              <Empty
                title="等待你的测试文字"
                description="结果会保留规则版本、正文哈希和实际检查范围。"
              />
            )}
          </section>
        </div>
      )}
      {detail && (
        <Drawer
          title={detail.title}
          subtitle={`${detail.id} · ${layerNames[detail.layer]} · ${detail.module_id}`}
          onClose={() => setDetail(null)}
          footer={
            catalog?.release.state === "draft" ? (
              <>
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditing(!editing);
                    setEdited(
                      JSON.stringify(
                        Object.fromEntries(
                          [
                            "title",
                            "trigger",
                            "why_it_matters",
                            "exceptions",
                            "repair",
                            "preserve",
                            "do_not",
                            "context_required",
                          ].map((k) => [k, detail[k]]),
                        ),
                        null,
                        2,
                      ),
                    );
                  }}
                >
                  编辑草稿
                </button>
                {editing && (
                  <button className="button primary" onClick={saveRule}>
                    <Check size={15} />
                    保存规则
                  </button>
                )}
              </>
            ) : (
              <span className="muted" style={{ fontSize: 11 }}>
                已发布版本保持不可变；修改请先创建新版本。
              </span>
            )
          }
        >
          {editing ? (
            <textarea
              className="code-input"
              style={{ width: "100%", minHeight: 500 }}
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              aria-label="规则草稿 JSON"
            />
          ) : (
            Object.entries({
              trigger: "触发条件",
              why_it_matters: "阅读影响",
              context_required: "所需上下文",
              exceptions: "适用例外",
              preserve: "应当保留",
              do_not: "避免误改",
              repair: "最小修复建议",
            }).map(([key, title]) => (
              <section className="rule-detail-section" key={key}>
                <h3>{title}</h3>
                <p>
                  {Array.isArray(detail[key])
                    ? detail[key].join("\n")
                    : typeof detail[key] === "object"
                      ? JSON.stringify(detail[key], null, 2)
                      : detail[key] || "—"}
                </p>
              </section>
            ))
          )}
        </Drawer>
      )}
      {prompt && (
        <Drawer
          title={prompt.name}
          subtitle="仅限管理员查看 · 不出现在普通用户响应中"
          onClose={() => setPrompt(null)}
          footer={
            prompts.data?.release.state === "draft" ? (
              <button
                className="button primary"
                onClick={async () => {
                  try {
                    await put(
                      `/admin/rules/releases/${prompts.data.release.id}/prompts/${prompt.name}`,
                      {
                        expected_digest: prompts.data.release.digest,
                        content: prompt.content,
                      },
                    );
                    refresh();
                    setPrompt(null);
                    toast("提示词草稿已保存，发布后对新运行生效");
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                保存提示词草稿
              </button>
            ) : (
              <span className="muted">
                已发布版本保持不可变；先创建规则草稿即可编辑。
              </span>
            )
          }
        >
          {prompts.data?.release.state === "draft" ? (
            <textarea
              aria-label="提示词内容"
              className="code-input"
              style={{ width: "100%", minHeight: 500 }}
              value={prompt.content}
              onChange={(e) =>
                setPrompt({ ...prompt, content: e.target.value })
              }
            />
          ) : (
            <pre className="json-block">{prompt.content}</pre>
          )}
        </Drawer>
      )}
      {showCreate && (
        <Drawer
          title="新建规则版本"
          subtitle="从当前版本复制草稿，校验后再发布"
          onClose={() => setShowCreate(false)}
          footer={
            <button
              className="button primary"
              disabled={busy}
              onClick={createVersion}
            >
              创建草稿
            </button>
          }
        >
          <label className="field">
            <span>新版本号</span>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="例如 3.1.1"
            />
          </label>
          <div className="info-strip">
            现有运行继续绑定原版本；发布新版本不会改写已有记录。
          </div>
        </Drawer>
      )}
      {showReleases && (
        <Drawer
          title="规则版本记录"
          subtitle="校验、发布与恢复都有审计记录"
          onClose={() => setShowReleases(false)}
        >
          {releases.data?.items.map((r: any) => (
            <article
              className="setting-card panel"
              key={r.id}
              style={{ marginBottom: 15 }}
            >
              <div className="setting-top">
                <h2>{r.id}</h2>
                <Status value={r.state} />
              </div>
              <p>
                {formatTime(r.created_at)} · {r.checks.rule_count || 905} 条规则
              </p>
              <div className="action-grid" style={{ marginTop: 18 }}>
                <button
                  className="button secondary small"
                  onClick={() => {
                    setRelease(r.id);
                    setShowReleases(false);
                    setTab("rules");
                  }}
                >
                  查看此版本
                </button>
                {r.state === "draft" ? (
                  <>
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => releaseAction(r.id, "validate")}
                    >
                      校验
                    </button>
                    <button
                      className="button primary small"
                      disabled={busy || !r.checks.bundle_verified}
                      onClick={() => releaseAction(r.id, "publish")}
                    >
                      发布
                    </button>
                  </>
                ) : r.state === "archived" ? (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => releaseAction(r.id, "activate")}
                  >
                    恢复启用
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </Drawer>
      )}
    </>
  );
}
