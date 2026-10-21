"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  BookOpen,
  Check,
  RefreshCw,
  ShieldCheck,
  Workflow,
  ArrowUpRight,
  LoaderCircle,
} from "lucide-react";
import { api, post, put, formatTime, type PageSpec } from "@reference/lib/api";
import {
  PageHeading,
  Drawer,
  Spinner,
  Empty,
  ErrorState,
  Status,
  useToast,
} from "./ui";
import { ResourcePage, RecordForm } from "./resource-page";
import { ProjectWorkbench } from "./project-workbench";

const stages = [
  ["01", "创作合同", "明确故事的方向与边界"],
  ["02", "章节计划", "固定任务与输入版本"],
  ["03", "上下文构建", "只读取获准的有效资料"],
  ["04", "正文候选", "独立保存，不覆盖原稿"],
  ["05", "证据审稿", "先检查，再提出修改"],
  ["06", "候选记忆", "事实与人物认知分开"],
  ["07", "作者确认", "正文与正史一并提交"],
];
export function WorkflowPage({ page }: { page: PageSpec }) {
  const [tab, setTab] = useState(
      page.key === "workflows" ? "flow" : "projects",
    ),
    [creating, setCreating] = useState(false),
    [createConfig, setCreateConfig] = useState(false),
    [project, setProject] = useState<any>(null),
    [title, setTitle] = useState(""),
    [genre, setGenre] = useState("MYSTERY"),
    [premise, setPremise] = useState(""),
    [busy, setBusy] = useState(false);
  const cache = useQueryClient(),
    toast = useToast();
  const own = useQuery({
    queryKey: ["my-projects"],
    queryFn: () => api("/projects"),
  });
  const projects = useQuery({
    queryKey: ["admin-projects"],
    queryFn: () => api("/admin/projects?page_size=100"),
    enabled: page.key === "projects",
  });
  const allRuns = useQuery({
    queryKey: ["admin-runs"],
    queryFn: () => api("/admin/runs?page_size=100"),
    refetchInterval: 5000,
    enabled: tab === "runs",
  });
  async function create() {
    setBusy(true);
    try {
      const p = await post("/projects", {
        title,
        genre,
        contract: { premise },
        profile: { genre_modules: [genre] },
        budget_limit: 2000,
      });
      await put(`/projects/${p.id}/contract`, {
        expected_version: p.version,
        contract: { premise, target_words: 2500 },
        confirm: true,
      });
      toast("作品与创作合同已保存");
      cache.invalidateQueries({ queryKey: ["my-projects"] });
      cache.invalidateQueries({ queryKey: ["admin-projects"] });
      setCreating(false);
      setProject(p);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const myIds = new Set(own.data?.items.map((p: any) => p.id) || []);
  return (
    <>
      <PageHeading
        eyebrow="网文创作 · 版本与运行"
        title={page.label}
        description={page.description}
        actions={
          <>
            {page.key === "workflows" && (
              <button
                className="button secondary"
                onClick={() => setCreateConfig(true)}
              >
                <Workflow size={16} />
                新建流程
              </button>
            )}
            <button
              className="button primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={17} />
              创建演示作品
            </button>
          </>
        }
      />
      <div className="tabs">
        {(page.key === "workflows"
          ? [
              ["flow", "流程与验证"],
              ["config", "流程配置"],
            ]
          : [
              ["projects", "作品"],
              ["runs", "运行记录"],
            ]
        ).map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "config" && <ResourcePage page={page} embedded />}
      {tab === "flow" && (
        <div className="workflow-layout">
          <aside className="panel flow-sidebar">
            <h2>一章的诞生</h2>
            <div style={{ marginTop: 15 }}>
              {stages.map(([n, title, desc]) => (
                <div className="flow-step" key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{title}</strong>
                    <p>{desc}</p>
                  </div>
                  {n === "07" && <ShieldCheck size={16} />}
                </div>
              ))}
            </div>
          </aside>
          <section className="workbench">
            <div className="panel">
              <h2>从一个想法，走到一次确认。</h2>
              <p className="backup-note">
                使用独立作品和作者身份，验证候选、版本、预算与正史提交。沙箱内容明确标识，不代表真实模型写作质量。
              </p>
              <div className="info-strip">
                <ShieldCheck size={17} />
                管理员只可操作自己创建的作品；其他作者的正文需要单独授权。
              </div>
              {own.isPending ? (
                <Spinner />
              ) : own.data?.items.length ? (
                <div className="activity-list">
                  {own.data.items.map((p: any) => (
                    <button
                      className="activity-entry"
                      style={{
                        background: "none",
                        borderLeft: 0,
                        borderRight: 0,
                        borderTop: 0,
                        textAlign: "left",
                      }}
                      key={p.id}
                      onClick={() => {
                        setProject(p);
                      }}
                    >
                      <div className="book-glyph">
                        <BookOpen size={19} />
                      </div>
                      <div>
                        <strong>{p.title}</strong>
                        <p>
                          {p.genre} · 正史版本 {p.canon_version}
                        </p>
                      </div>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  title="先为这个故事取个名字"
                  description="新建演示作品后，可以在这里运行完整章节流程。"
                  action={
                    <button
                      className="button primary"
                      onClick={() => setCreating(true)}
                    >
                      <Plus size={16} />
                      创建作品
                    </button>
                  }
                />
              )}
            </div>
          </section>
        </div>
      )}
      {tab === "projects" &&
        (projects.isPending ? (
          <Spinner />
        ) : projects.error ? (
          <ErrorState error={projects.error} />
        ) : projects.data?.items.length ? (
          <div className="project-grid">
            {projects.data.items.map((p: any) => (
              <article
                key={p.id}
                className="panel project-card"
                onClick={() => {
                  if (!myIds.has(p.id)) {
                    toast("此作品只显示运行元数据，正文需要作者临时授权");
                    return;
                  }
                  setProject(p);
                }}
              >
                <div className="book-glyph">{p.title.slice(0, 1)}</div>
                <h2>{p.title}</h2>
                <p>
                  {p.genre || "题材待定"} · 正史 V{p.canon_version}
                </p>
                <footer>
                  <Status value={p.status} />
                  <span>{myIds.has(p.id) ? "我的测试作品" : "内容受保护"}</span>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="panel">
            <Empty
              title="故事将从这里开始"
              description="作品创建后，可在此追踪章节与运行；作者正文默认受保护。"
              action={
                <button
                  className="button primary"
                  onClick={() => setCreating(true)}
                >
                  <Plus size={16} />
                  创建演示作品
                </button>
              }
            />
          </div>
        ))}
      {tab === "runs" && (
        <section className="panel">
          <div className="table-toolbar">
            <span className="muted">所有创作任务 · 仅展示运行元数据</span>
            <button
              className="icon-button"
              aria-label="刷新任务"
              onClick={() => allRuns.refetch()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {allRuns.isPending ? (
            <Spinner />
          ) : allRuns.data?.items.length ? (
            <div className="recent-list">
              {allRuns.data.items.map((r: any) => (
                <div className="recent-item" key={r.id}>
                  <div className="book-glyph">
                    <Workflow size={18} />
                  </div>
                  <div className="recent-title">
                    <strong>{r.name}</strong>
                    <span>
                      {formatTime(r.created_at)} · {r.id.slice(0, 8)} · 预算{" "}
                      {r.budget}
                    </span>
                  </div>
                  <Status value={r.state} />
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="还没有创作任务"
              description="执行创作流程后，运行记录会显示在这里。"
            />
          )}
        </section>
      )}
      {creating && (
        <Drawer
          title="创建演示作品"
          subtitle="作品属于当前账号；沙箱运行不会调用付费模型"
          onClose={() => setCreating(false)}
          footer={
            <button
              className="button primary"
              disabled={busy || !title.trim() || !premise.trim()}
              onClick={create}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              创建并确认合同
            </button>
          }
        >
          <label className="field">
            <span>暂定书名</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：雾城来信"
              required
            />
          </label>
          <label className="field">
            <span>题材</span>
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="MYSTERY">悬疑</option>
              <option value="URBAN">都市</option>
              <option value="XUAN">玄幻</option>
              <option value="RULEHOR">规则怪谈</option>
            </select>
          </label>
          <label className="field">
            <span>核心前提</span>
            <textarea
              rows={6}
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="一个怎样的人，面对什么冲突，又将付出什么代价？"
            />
          </label>
          <div className="info-strip">
            此处确认的是创作合同；正文与新增事实仍需在生成后分别确认。
          </div>
        </Drawer>
      )}
      {createConfig && (
        <RecordForm
          page={page}
          onClose={() => setCreateConfig(false)}
          onDone={() => cache.invalidateQueries({ queryKey: ["records"] })}
        />
      )}
      {project && (
        <ProjectWorkbench
          key={project.id}
          project={project}
          onClose={() => setProject(null)}
        />
      )}
    </>
  );
}
