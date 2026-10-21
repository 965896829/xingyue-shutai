"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "@reference/router";
import { api } from "@reference/lib/api";
type SiteConfig = { display: Record<string, any>; loading: boolean };
const SiteContext = createContext<SiteConfig>({ display: {}, loading: true });
export const useSiteDisplay = () => useContext(SiteContext);
export function usableLink(value: unknown) {
  return (
    typeof value === "string" &&
    !/[\\\u0000-\u001f]/.test(value) &&
    (/^\/(?!\/)/.test(value) || /^https?:\/\//i.test(value))
  );
}
export function SiteDisplay({ children }: { children: React.ReactNode }) {
  const [display, setDisplay] = useState<Record<string, any>>({}),
    [loading, setLoading] = useState(true),
    pathname = usePathname(),
    router = useRouter();
  useEffect(() => {
    let alive = true;
    const load = () =>
      api("/public/config")
        .then((data) => {
          if (alive) setDisplay(data.display || {});
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setLoading(false);
        });
    load();
    window.addEventListener("site-display-updated", load);
    return () => {
      alive = false;
      window.removeEventListener("site-display-updated", load);
    };
  }, []);
  useEffect(() => {
    if (pathname.startsWith("/admin") || loading) return;
    if (display.site_title) document.title = display.site_title;
    for (const [name, value] of [
      ["description", display.seo_description],
      ["keywords", display.seo_keywords],
    ]) {
      if (!value) continue;
      let meta = document.head.querySelector<HTMLMetaElement>(
        'meta[name="' + name + '"]',
      );
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = value;
    }
    if (usableLink(display.icon_url)) {
      let icon =
        document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!icon) {
        icon = document.createElement("link");
        icon.rel = "icon";
        document.head.appendChild(icon);
      }
      icon.href = display.icon_url;
    }
    const rule = Array.isArray(display.page_overrides)
      ? display.page_overrides.find(
          (r: any) =>
            r.enabled !== false &&
            (r.source === pathname + window.location.search ||
              r.source === pathname),
        )
      : null;
    if (
      rule &&
      usableLink(rule.target) &&
      rule.target !== pathname &&
      rule.target.startsWith("/") &&
      !pathname.startsWith("/studio/book") &&
      pathname !== "/studio/settings"
    )
      router.replace(rule.target);
  }, [display, loading, pathname, router]);
  return (
    <SiteContext.Provider value={{ display, loading }}>
      {children}
    </SiteContext.Provider>
  );
}
export function ConfiguredHome() {
  const { display, loading } = useSiteDisplay(),
    router = useRouter();
  useEffect(() => {
    if (loading) return;
    const target =
      usableLink(display.custom_home) && display.custom_home !== "/"
        ? display.custom_home
        : "/studio";
    if (target.startsWith("/")) router.replace(target);
    else window.location.replace(target);
  }, [display, loading, router]);
  return <div className="startup">正在打开创作空间…</div>;
}
export function CustomSitePage() {
  const { slug } = useParams<{ slug: string }>(),
    { display, loading } = useSiteDisplay();
  if (loading) return <div className="startup">正在加载页面…</div>;
  const page = Array.isArray(display.custom_pages)
    ? display.custom_pages.find((p: any) => p.path === slug)
    : null;
  if (!page || !usableLink(page.url))
    return (
      <main className="custom-page-empty">
        <h1>页面未配置</h1>
        <a href="/studio">返回创作大厅</a>
      </main>
    );
  return (
    <main className="custom-site-page">
      <header>
        <a href="/studio">返回创作大厅</a>
        <a href={page.url} target="_blank" rel="noreferrer">
          在新窗口打开
        </a>
      </header>
      <iframe
        src={page.url}
        title={page.title || slug}
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        referrerPolicy="no-referrer"
      />
    </main>
  );
}
