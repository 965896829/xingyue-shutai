import { useManagement } from '../../ManagementContext';
import { Availability, PageBoundary } from '../../Availability';
import { ClientModule, localViews } from '../../ClientModule';
import { LocalPage, localPageKeys } from '../../LocalPages';
"use client";
import { CloudPlatformPage } from "./cloud-platform-form";
import { useState, useEffect, useMemo } from "react";
import Link from "@reference/router-link";
import { usePathname, useRouter } from "@reference/router";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Feather,
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ChartNoAxesCombined,
  Sparkles,
  Network,
  Layers3,
  Users,
  Monitor,
  Wallet,
  Settings2,
  LogOut,
  Menu,
  X,
  Download,
  ArrowUpRight,
  ShieldCheck,
  Eye,
  EyeOff,
  LoaderCircle,
} from "lucide-react";
import {
  api,
  post,
  type Catalog,
  type PageSpec,
  ApiError,
  formatTime,
} from "@reference/lib/api";
import {
  ToastProvider,
  useToast,
  Drawer,
  Spinner,
  ErrorState,
  Empty,
} from "./ui";
import { Dashboard } from "./analytics-dashboard";
import { ResourcePage } from "./resource-page";
import { AgentPage } from "./agent-page";
import { ReferenceTablePage } from "./reference-table-page";
import { NotificationDeliveries } from "./notification-deliveries";
import { PaymentOperations } from "./payment-operations";
import { ExternalLoginOptions } from "./login-providers";
import { referencePages } from "@reference/lib/reference-pages";
import { ReferenceCollection } from "./reference-collections";
import { ModelDiscounts } from "./model-discounts";
import { DesktopWorkbench } from "./desktop-workbench";
import { KnowledgeCreate } from "./knowledge-create";
import { ReferenceSettings } from "./reference-settings";
import { ReferenceMemory } from "./reference-memory";
import { ReferenceSystem, ReferenceCalculator } from "./reference-system";
import { ReferenceTheme } from "./reference-theme";
import { RulesPage } from "./rules-page";
import { WorkflowPage } from "./workflow-page";
import { StructuredContent } from "./structured-content";
import { QualityEvaluations } from "./quality-evaluations";
import { EngineConsole } from "./engine-console";
import { BounceSidebar } from "./interaction/bounce-sidebar";
import { NotificationCenter } from "./interaction/notification-center";
import { AccountMenu } from "./account-menu";
import { ColorModeToggle } from "./color-mode";

const icons: Record<string, typeof Sparkles> = {
  overview: ChartNoAxesCombined,
  agents: Sparkles,
  platform: Network,
  operations: Layers3,
  users: Users,
  desktop: Monitor,
  finance: Wallet,
  system: Settings2,
};
export function AdminApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 10000, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Workspace />
      </ToastProvider>
    </QueryClientProvider>
  );
}
function Login() {
  const cache = useQueryClient(),
    toast = useToast();
  const { data } = useQuery({
    queryKey: ["setup"],
    queryFn: () => api("/auth/status"),
    retry: false,
  });
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false);
  const setup = data?.setup_required;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(setup ? "/auth/setup" : "/auth/login", {
        username,
        password,
        ...(setup ? { nickname: "管理员" } : {}),
      });
      await cache.invalidateQueries();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-landscape">
        <div className="login-brand">
          <Feather size={33} />
          <span>长篇创作</span>
        </div>
        <div className="login-copy">
          <span className="eyebrow">A SPACE FOR EVERY STORY</span>
          <h1>
            故事的背后，
            <br />
            是一个有序的世界。
          </h1>
          <p>让灵感有处安放，让创作持续发生。</p>
          <div className="horizon">
            <i />
            <i />
            <i />
          </div>
        </div>
        <span className="login-footnote">写下更大的世界。</span>
      </div>
      <div className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <div className="login-emblem">
            <ShieldCheck size={28} />
          </div>
          <span className="eyebrow">管理空间</span>
          <h2>{setup ? "开启你的创作平台" : "欢迎回来。"}</h2>
          <p>
            {setup
              ? "创建首位管理员，初始化独立的创作空间。"
              : "登录后，继续照看这个正在生长的世界。"}
          </p>
          <label>
            管理员账号
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入账号"
              minLength={2}
              required
            />
          </label>
          <label>
            密码
            <div className="password-field">
              <input
                type={show ? "text" : "password"}
                autoComplete={setup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={setup ? "至少 10 个字符" : "输入密码"}
                minLength={setup ? 10 : 1}
                required
              />
              <button
                type="button"
                aria-label={show ? "隐藏密码" : "显示密码"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <button className="button primary login-submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : null}
            {setup ? "创建管理空间" : "进入管理空间"}
            <ArrowUpRight size={18} />
          </button>
          {!setup && <ExternalLoginOptions destination="/admin/dashboard" />}
          <div className="login-note">
            <i /> 本地独立部署 · 安全会话
          </div>
        </form>
      </div>
    </main>
  );
}
function Workspace() {
  const management = useManagement();
  const pathname = usePathname(),
    router = useRouter(),
    cache = useQueryClient(),
    toast = useToast();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api("/auth/me"),
    retry: false,
  });
  const catalog = useQuery<Catalog>({
    queryKey: ["catalog"],
    queryFn: () => api("/admin/catalog"),
    enabled: !!session.data,
    retry: false,
  });
  const [expanded, setExpanded] = useState<string[]>([]),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(""),
    [panel, setPanel] = useState<"exports" | null>(null);
  const [original, setOriginal] = useState(false);
  const stateKey = JSON.stringify([management.snapshot?.project?.id, management.snapshot?.project?.revision,
    (management.snapshot?.savedProfiles ?? management.snapshot?.profiles)?.map(p => [p.id, p.version, p.enabled, p.reasoningRevision]),
    management.snapshot?.runs.map(r => [r.id, r.status, r.accepted])]);
  useEffect(() => { void cache.invalidateQueries(); }, [stateKey, cache]);
  useEffect(() => { setOriginal(false); }, [pathname]);
  const page = catalog.data?.pages.find(
    (p) =>
      p.path === pathname ||
      (p.key === "knowledge" &&
        pathname === "/admin/knowledge/create/upload") ||
      (p.key === "cloud" &&
        /^\/admin\/cloud-platform\/(add\/new|edit\/[a-zA-Z0-9-]+)$/.test(
          pathname,
        )),
  );
  useEffect(() => {
    if (page)
      setExpanded((old) =>
        old.includes(page.group) ? old : [...old, page.group],
      );
    setMobile(false);
    setSearch("");
  }, [pathname, page?.group]);
  const sideData = useQuery({
    queryKey: ["side-panel", panel],
    queryFn: () => api("/admin/records/exports"),
    enabled: !!panel,
  });
  if (session.isPending)
    return (
      <div className="startup">
        <Feather size={35} />
        <Spinner text="正在打开管理空间" />
      </div>
    );
  if (session.error) {
    if ((session.error as ApiError).status === 401) return <Login />;
    return (
      <div className="startup">
        <ErrorState error={session.error} retry={() => session.refetch()} />
      </div>
    );
  }
  if (catalog.isPending)
    return (
      <div className="startup">
        <Spinner />
      </div>
    );
  if (catalog.error)
    return (
      <div className="startup">
        <ErrorState error={catalog.error} />
      </div>
    );
  const me = session.data.user;
  const filtered = search.trim()
    ? catalog
        .data!.pages.filter((p) =>
          (p.label + p.description)
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .slice(0, 8)
    : [];
  async function logout() {
    try {
      await post("/auth/logout");
      cache.clear();
      window.location.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  return (
    <div className="app-shell reference-shell">
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Link className="brand" href="/admin/dashboard" aria-label="星月书台，返回数据看板" title="返回数据看板" onClick={() => setMobile(false)}>
          <img src="/brand/app-icon.png" alt="" width="29" height="29" />
          <div>
            <strong>星月书台</strong>
            <span>
              管理空间 <i /> {management.client.version}
            </span>
          </div>
        </Link>
        <div className="nav-caption">工作空间</div>
        <BounceSidebar
          aria-label="管理导航"
          activeKey={`${pathname}:${expanded.join(",")}`}
        >
          {catalog.data!.groups.map((g) => {
            const children = catalog.data!.pages.filter(
              (p) => p.group === g.key,
            );
            if (!children.length) return null;
            const Icon = icons[g.key] || Layers3;
            const isActive = page?.group === g.key;
            if (children.length === 1)
              return (
                <Link
                  key={g.key}
                  href={children[0].path}
                  className={`nav-group single ${isActive ? "active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={20} />
                  <span>{g.source_label}</span>
                </Link>
              );
            return (
              <div className="nav-section" key={g.key}>
                <button
                  className={`nav-group ${isActive ? "active-group" : ""}`}
                  aria-expanded={expanded.includes(g.key)}
                  data-bounce-active={isActive && !expanded.includes(g.key)}
                  onClick={() =>
                    setExpanded((old) =>
                      old.includes(g.key)
                        ? old.filter((k) => k !== g.key)
                        : [...old, g.key],
                    )
                  }
                >
                  <Icon size={20} />
                  <span>{g.source_label}</span>
                  <ChevronDown
                    className={expanded.includes(g.key) ? "rotated" : ""}
                    size={14}
                  />
                </button>
                {expanded.includes(g.key) && (
                  <div className="nav-children">
                    {children.map((p) => (
                      <Link
                        key={p.key}
                        href={p.path}
                        className={`nav-item ${p.key === page?.key ? "active" : ""}`}
                        aria-current={p.key === page?.key ? "page" : undefined}
                      >
                        <span>{p.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </BounceSidebar>
        <div className="sidebar-bottom">
          <div className="space-health">
            <span className="pulse-dot" />
            {management.connected ? "本机客户端已连接" : "连接已断开"}
            <span className="mini-label">
              本机
            </span>
          </div>
          <div className="account">
            <div className="avatar">
              {(me.nickname || me.username).slice(0, 1)}
            </div>
            <div>
              <strong>{me.nickname || me.username}</strong>
              <span>
                {me.role === "superadmin" ? "本机管理员" : "管理成员"}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="退出登录"
              title="退出登录"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
          <p>写下更大的世界。</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="展开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>管理空间</span>
            <ChevronRight size={13} />
            <strong>{page?.label || "页面"}</strong>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={17} />
              <input
                aria-label="搜索功能"
                placeholder="搜索功能、页面…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌕</kbd>
              {search && (
                <div className="search-results">
                  {filtered.length ? (
                    filtered.map((p) => (
                      <Link key={p.key} href={p.path}>
                        {p.label}
                        <ArrowUpRight size={14} />
                      </Link>
                    ))
                  ) : (
                    <span>没有找到相关功能</span>
                  )}
                </div>
              )}
            </div>
            <button
              className={`icon-button ${panel === "exports" ? "selected" : ""}`}
              aria-label="导出中心"
              title="导出中心"
              onClick={() => router.push('/admin/sys/backup-restore')}
            >
              <Download size={20} />
            </button>
            <ColorModeToggle />
            <NotificationCenter userId={me.id} />
            <button className="avatar local-account" onClick={() => router.push("/admin/user/desktop-authorized-users")} aria-label="客户端与授权">本</button>
          </div>
        </header>
        <div className="local-client-context">
          <span>当前作品：{management.snapshot?.project?.title ?? '尚未打开'}</span>
          <button className="text-button" onClick={() => router.push('/admin/novel/projects')}>切换作品</button>
          <span className="ref-spacer" /><span>{management.connected ? '网页与客户端同步' : '连接中断，输入保留'}</span>
          <button className="icon-button" aria-label="刷新客户端状态" onClick={() => void management.refresh()}><RefreshCw size={14} /></button>
        </div>
        {management.error && <div className="local-unavailable" role="alert">{management.error}</div>}
        <main className={`main-content ${page && localViews[page.key] ? 'local-module-page' : ''}`}>
          {page ? <>
            {(localViews[page.key] || localPageKeys.has(page.key)) && !page.key.startsWith('local-') && <div className="local-page-tabs" role="group" aria-label="页面内容">
              <button className={!original ? 'active' : ''} onClick={() => setOriginal(false)}>客户端管理</button>
              <button className={original ? 'active' : ''} onClick={() => setOriginal(true)}>原平台页面 · 尚未接入</button>
            </div>}
            <Availability page={page} force={original} />
            <div hidden={!original && !!localViews[page.key]}><PageBoundary key={`${page.key}:${original}`} page={page}><PageContent page={page} original={original} /></PageBoundary></div></> : (
            <Empty
              title="页面不可访问"
              description="此页面不存在，或当前角色没有访问权限。"
              action={
                <Link className="button primary" href="/admin/dashboard">
                  返回数据看板
                </Link>
              }
            />
          )}
          <ClientModule pageKey={original ? '' : page?.key ?? ''} snapshot={management.snapshot} />
        </main>
        {management.expired && <div className="local-expired" role="alert"><h2>网页授权已失效</h2><p>请从客户端重新打开网页管理后台。未提交的输入暂时保留。</p><button className="button primary" onClick={() => location.reload()}>重新检查授权</button></div>}
        <footer className="workspace-footer">
          <span>长篇创作 · 管理空间</span>
          <span>
            <i /> 版本与规则始终可追溯
          </span>
        </footer>
      </div>
      {panel && (
        <Drawer
          title="导出中心"
          subtitle="文件仅对创建导出的账号开放"
          onClose={() => setPanel(null)}
        >
          {sideData.isPending ? (
            <Spinner />
          ) : sideData.data?.items.length ? (
            <div className="activity-list">
              {sideData.data.items.map((r: any) => (
                <div className="activity-entry" key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <p>
                      {r.data.body ||
                        `${r.data.rows || 0} 条记录 · ${formatTime(r.created_at)}`}
                    </p>
                  </div>
                  {r.data.file_id ? (
                    <a
                      className="button secondary small"
                      href={`/api/v1/files/${r.data.file_id}`}
                    >
                      <Download size={14} />
                      下载
                    </a>
                  ) : (
                    <span className="muted">准备中</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="还没有导出文件"
              description="从列表页面导出后，可以在这里重新下载。"
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
function PageContent({ page, original = false }: { page: PageSpec; original?: boolean }) {
  const pathname = usePathname();
  if (!original && (localViews[page.key] || localPageKeys.has(page.key))) return <LocalPage page={page} />;
  if (page.key === "knowledge" && pathname === "/admin/knowledge/create/upload")
    return <KnowledgeCreate />;
  if (page.key === "cloud" && pathname !== page.path)
    return <CloudPlatformPage />;
  if (page.key === "quality-evaluations") return <QualityEvaluations />;
  if (page.key === "engine-console") return <EngineConsole />;
  if (page.key === "structured-content") return <StructuredContent />;
  if (page.key === "agents") return <AgentPage page={page} />;
  if (page.key === "memory") return <ReferenceMemory page={page} />;
  if (page.key === "model-discounts") return <ModelDiscounts />;
  if (page.key === "desktop-workbench") return <DesktopWorkbench />;
  if (
    ["knowledge", "skills", "models", "providers", "base-models"].includes(
      page.key,
    )
  )
    return <ReferenceCollection page={page} />;
  if (page.view === "settings") return <ReferenceSettings page={page} />;
  if (referencePages[page.key])
    return (
      <>
        <ReferenceTablePage page={page} />
        {page.key === "notifications" && <NotificationDeliveries />}
        {page.key === "orders" && <PaymentOperations />}
      </>
    );
  if (["dashboard", "platform-overview"].includes(page.view))
    return <Dashboard platform={page.view === "platform-overview"} />;
  if (page.view === "rules") return <RulesPage page={page} />;
  if (["workflows", "projects"].includes(page.view))
    return <WorkflowPage page={page} />;
  if (page.view === "theme") return <ReferenceTheme />;
  if (page.view === "calculator") return <ReferenceCalculator />;
  if (["roles", "backups", "logs", "load"].includes(page.view))
    return <ReferenceSystem page={page} />;
  return <ResourcePage page={page} />;
}
