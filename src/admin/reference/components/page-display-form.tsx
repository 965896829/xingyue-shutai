"use client";
import { useState } from "react";
import {
  Plus,
  GripVertical,
  ArrowUp,
  ArrowDown,
  House,
  ChevronRight,
} from "lucide-react";
import { ConfigField, ConfigToggle, TagInput } from "./platform-form";
import { Modal } from "./reference-ui";
import { BrandImageUpload } from "./admin-parity-tools";
import { DeleteButton } from "./interaction/delete-button";
import { useResourceDraft, type FormProps } from "./reference-detail-forms";

type MenuItem = {
  value: string;
  title: string;
  route: string;
  icon: string;
  tag?: string;
  i18n?: Record<string, string>;
  children?: MenuItem[];
};
const languages = [
  ["zh-CN", "中文"],
  ["en-US", "English"],
  ["ko-KR", "한국어"],
  ["ja-JP", "日本語"],
];
function MenuEditor({
  value,
  onChange,
}: {
  value: MenuItem[];
  onChange: (v: MenuItem[]) => void;
}) {
  const [editing, setEditing] = useState<{
      path: number[];
      item: MenuItem;
      locale: boolean;
    } | null>(null),
    [language, setLanguage] = useState("zh-CN"),
    [drag, setDrag] = useState<number[] | null>(null);
  function update(
    path: number[],
    fn: (items: MenuItem[], index: number) => void,
  ) {
    const next = structuredClone(value);
    let parent = next;
    for (const index of path.slice(0, -1)) {
      parent[index].children ??= [];
      parent = parent[index].children!;
    }
    fn(parent, path.at(-1)!);
    onChange(next);
  }
  const newItem = (): MenuItem => ({
    value: "menu_" + crypto.randomUUID().slice(0, 8),
    title: "新菜单项",
    route: "",
    icon: "house",
    children: [],
  });
  function move(path: number[], to: number) {
    update(path, (items, i) => {
      if (to < 0 || to >= items.length) return;
      items.splice(to, 0, items.splice(i, 1)[0]);
    });
  }
  function rows(items: MenuItem[], parent: number[] = []): React.ReactNode {
    return items.map((item, i) => {
      const path = [...parent, i];
      return (
        <div className="nav-edit-node" key={item.value}>
          <div
            className="nav-edit-row"
            draggable
            onDragStart={() => setDrag(path)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (drag && drag.slice(0, -1).join("/") === parent.join("/"))
                move(drag, i);
              setDrag(null);
            }}
          >
            <GripVertical size={15} />
            <span>
              <strong>{item.i18n?.[language] || item.title}</strong>
              <small>({item.value})</small>
            </span>
            <button
              className="text-button"
              onClick={() =>
                setEditing({ path, item: structuredClone(item), locale: true })
              }
            >
              国际化
            </button>
            {parent.length < 3 && (
              <button
                className="text-button"
                onClick={() =>
                  update(path, (xs, n) => {
                    xs[n].children = [...(xs[n].children || []), newItem()];
                  })
                }
              >
                添加子菜单
              </button>
            )}
            <button
              className="text-button"
              onClick={() =>
                setEditing({ path, item: structuredClone(item), locale: false })
              }
            >
              编辑
            </button>
            <button
              className="icon-button"
              aria-label={"上移 " + item.title}
              disabled={i === 0}
              onClick={() => move(path, i - 1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={"下移 " + item.title}
              disabled={i === items.length - 1}
              onClick={() => move(path, i + 1)}
            >
              <ArrowDown size={13} />
            </button>
            <DeleteButton
              aria-label={"删除菜单 " + item.title}
              onClick={() => update(path, (xs, n) => xs.splice(n, 1))}
            >
              删除
            </DeleteButton>
          </div>
          {item.children?.length ? (
            <div className="nav-edit-children">{rows(item.children, path)}</div>
          ) : null}
        </div>
      );
    });
  }
  function preview(items: MenuItem[]): React.ReactNode {
    return items.map((item) => (
      <div key={item.value}>
        <span>
          <House size={14} />
          {item.i18n?.[language] || item.title}
          {item.tag && <small>{item.tag}</small>}
          {!!item.children?.length && <ChevronRight size={12} />}
        </span>
        {!!item.children?.length && <div>{preview(item.children)}</div>}
      </div>
    ));
  }
  return (
    <>
      <div className="nav-editor-layout">
        <aside className="nav-editor-preview">
          <h3>菜单预览</h3>
          {value.length ? (
            preview(value)
          ) : (
            <p className="ref-field-help">添加菜单后预览</p>
          )}
        </aside>
        <section>
          <h3>菜单栏可视化编辑器</h3>
          <p className="ref-description">
            添加、编辑、删除菜单项，以及拖拽排序。左侧可以实时预览效果。
          </p>
          <div className="ref-toolbar">
            <button
              className="button primary"
              onClick={() => onChange([...value, newItem()])}
            >
              <Plus size={14} />
              添加菜单项
            </button>
          </div>
          <div className="nav-language">
            预览语言：
            {languages.map(([code, label]) => (
              <label key={code}>
                <input
                  type="radio"
                  name="nav-language"
                  checked={language === code}
                  onChange={() => setLanguage(code)}
                />
                {label}
              </label>
            ))}
          </div>
          {rows(value)}
        </section>
      </div>
      {editing && (
        <Modal
          title={editing.locale ? "菜单国际化" : "编辑菜单项"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setEditing(null)}
              >
                取 消
              </button>
              <button
                className="button primary"
                disabled={!editing.item.value.trim()}
                onClick={() => {
                  update(editing.path, (xs, i) => {
                    xs[i] = editing.item;
                  });
                  setEditing(null);
                }}
              >
                保 存
              </button>
            </>
          }
        >
          <div className="ref-form">
            {editing.locale
              ? languages.map(([code, label]) => (
                  <ConfigField key={code} title={label}>
                    <input
                      value={editing.item.i18n?.[code] || ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          item: {
                            ...editing.item,
                            i18n: {
                              ...editing.item.i18n,
                              [code]: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </ConfigField>
                ))
              : (["title", "value", "route", "icon", "tag"] as const).map(
                  (key, i) => (
                    <ConfigField
                      key={key}
                      title={
                        [
                          "标题",
                          "值 (value) *",
                          "路由 (route)",
                          "图标 (icon)",
                          "标签 (tag)",
                        ][i]
                      }
                      hint={
                        key === "route"
                          ? "支持站内路径和完整 HTTP(S) 地址"
                          : undefined
                      }
                    >
                      <input
                        list={key === "route" ? "site-known-routes" : undefined}
                        value={editing.item[key] || ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            item: { ...editing.item, [key]: e.target.value },
                          })
                        }
                      />
                    </ConfigField>
                  ),
                )}
          </div>
        </Modal>
      )}
      <datalist id="site-known-routes">
        {[
          "/studio",
          "/studio/works",
          "/studio/ideas",
          "/studio/assistants",
          "/studio/activity",
          "/studio/settings",
          "/studio/help",
        ].map((route) => (
          <option value={route} key={route} />
        ))}
      </datalist>
    </>
  );
}

export function PageDisplayForm(props: FormProps & { section: string }) {
  const d = useResourceDraft(props),
    v = d.values,
    section = props.section;
  const text = (key: string, title: string, multiline = false, hint = "") => (
    <ConfigField title={title} hint={hint}>
      {multiline ? (
        <textarea
          rows={6}
          value={v[key] || ""}
          onChange={(e) => d.set(key, e.target.value)}
        />
      ) : (
        <input
          value={v[key] || ""}
          onChange={(e) => d.set(key, e.target.value)}
        />
      )}
    </ConfigField>
  );
  const image = (key: string, title: string, hint = "") => (
    <ConfigField title={title} hint={hint}>
      <div className="page-image-control">
        {v[key] && <img src={v[key]} alt={title} />}
        <input
          value={v[key] || ""}
          placeholder="图片地址"
          onChange={(e) => d.set(key, e.target.value)}
        />
        <BrandImageUpload
          kind="page-display"
          onChange={(url) => d.set(key, url)}
        />
      </div>
    </ConfigField>
  );
  const gallery = (key: string, title: string, hint = "") => {
    const items: any[] = Array.isArray(v[key]) ? v[key] : [];
    return (
      <ConfigField title={title} hint={hint}>
        <div className="page-gallery">
          {items.map((item, i) => (
            <div key={i}>
              <img
                src={typeof item === "string" ? item : item.url}
                alt={title + " " + (i + 1)}
              />
              <input
                aria-label={title + "跳转地址 " + (i + 1)}
                placeholder="点击跳转地址（可选）"
                value={typeof item === "object" ? item.link || "" : ""}
                onChange={(e) =>
                  d.set(
                    key,
                    items.map((x, n) =>
                      n === i
                        ? {
                            url: typeof x === "string" ? x : x.url,
                            link: e.target.value,
                          }
                        : x,
                    ),
                  )
                }
              />
              <DeleteButton
                aria-label={"删除" + title + (i + 1)}
                onClick={() =>
                  d.set(
                    key,
                    items.filter((_, n) => n !== i),
                  )
                }
              >
                删除
              </DeleteButton>
            </div>
          ))}
          <BrandImageUpload
            kind="page-display"
            onChange={(url) => d.set(key, [...items, { url, link: "" }])}
          />
        </div>
      </ConfigField>
    );
  };
  const switcher = (key: string, title: string, invert = false, hint = "") => (
    <ConfigField title={title} hint={hint}>
      <label className="parity-toggle page-inline-toggle">
        <input
          type="checkbox"
          role="switch"
          aria-label={title}
          checked={invert ? !v[key] : !!v[key]}
          onChange={(e) =>
            d.set(key, invert ? !e.target.checked : e.target.checked)
          }
        />
        <span>
          {key.startsWith("disable_")
            ? v[key]
              ? "禁用"
              : "启用"
            : invert
              ? !v[key]
                ? "隐藏"
                : "显示"
              : v[key]
                ? "显示"
                : "隐藏"}
        </span>
      </label>
    </ConfigField>
  );
  function table(
    key: string,
    columns: {
      key: string;
      title: string;
      placeholder?: string;
      boolean?: boolean;
    }[],
    addTitle: string,
    defaults: Record<string, any>,
  ) {
    const items: any[] = Array.isArray(v[key]) ? v[key] : [];
    return (
      <>
        <button
          className="button secondary"
          onClick={() => d.set(key, [...items, { ...defaults }])}
        >
          <Plus size={14} />
          {addTitle}
        </button>
        <div className="ref-table-wrap page-rules-table">
          <table className="ref-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.title}</th>
                ))}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((item, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key}>
                        {c.boolean ? (
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={c.title + (i + 1)}
                            checked={item[c.key] !== false}
                            onChange={(e) =>
                              d.set(
                                key,
                                items.map((x, n) =>
                                  n === i
                                    ? { ...x, [c.key]: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                        ) : (
                          <input
                            value={item[c.key] || ""}
                            placeholder={c.placeholder}
                            aria-label={c.title + (i + 1)}
                            onChange={(e) =>
                              d.set(
                                key,
                                items.map((x, n) =>
                                  n === i
                                    ? { ...x, [c.key]: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        )}
                      </td>
                    ))}
                    <td>
                      {key === "custom_pages" &&
                        /^[A-Za-z0-9_-]+$/.test(item.path) && (
                          <a
                            href={"/custom/" + item.path}
                            target="_blank"
                            rel="noreferrer"
                          >
                            访问测试
                          </a>
                        )}
                      <DeleteButton
                        aria-label={"删除第" + (i + 1) + "条"}
                        onClick={() =>
                          d.set(
                            key,
                            items.filter((_, n) => n !== i),
                          )
                        }
                      >
                        删除
                      </DeleteButton>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length + 1} className="page-rules-empty">
                    无可用数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  const classic =
    v.classic_carousel && typeof v.classic_carousel === "object"
      ? v.classic_carousel
      : {};
  return (
    <Modal
      title="编辑配置"
      onClose={props.onClose}
      className={
        "page-display-modal " + (section === "菜单栏设置" ? "menu-wide" : "")
      }
      footer={
        <>
          <button
            className="button secondary"
            disabled={d.busy}
            onClick={props.onClose}
          >
            取 消
          </button>
          <button
            className="button primary"
            disabled={d.busy}
            onClick={() => d.save({}, d.name || "网站显示配置")}
          >
            {d.busy ? "保存中…" : "保 存"}
          </button>
        </>
      }
    >
      <div className="ref-form page-display-fields">
        {section === "布局模版" && (
          <>
            <ConfigField title="样式风格版本">
              <select
                value={v.layout}
                onChange={(e) => d.set("layout", e.target.value)}
              >
                <option value="creative">创作风格</option>
                <option value="classic">经典风格</option>
                <option value="dynamic">动感风格</option>
                <option value="custom">自定义</option>
              </select>
            </ConfigField>
            <section className="page-skill-box">
              <strong>站点 PageBuilder SKILL 包</strong>
              <p>用于配置本站的品牌、菜单和自定义页面。</p>
              <a
                className="button secondary"
                href="/api/v1/admin/page-builder/skill.zip"
                download
              >
                下载 SKILL ZIP 包
              </a>
            </section>
            {text("announcements", "公告内容", true, "多条公告请换行输入")}
            {gallery(
              "carousel",
              "首页轮播图",
              "建议尺寸 1440 × 300；顶部搜索布局建议 2400 × 300",
            )}
            <ConfigField title="搜索框位置">
              <select
                value={v.search_position}
                onChange={(e) => d.set("search_position", e.target.value)}
              >
                <option value="top">顶部</option>
                <option value="center">中部</option>
                <option value="hidden">隐藏</option>
              </select>
            </ConfigField>
            <ConfigField title="搜索推荐词" hint="输入推荐词，按回车添加">
              <TagInput
                label="搜索推荐词"
                value={v.search_suggestions || []}
                onChange={(x) => d.set("search_suggestions", x)}
              />
            </ConfigField>
            {gallery("image_navigation", "图片导航", "侧边栏底部图片导航")}
          </>
        )}
        {section === "通用显示设置" && (
          <>
            {image("icon_url", "网站图标", "支持 ICO、PNG、JPEG、WebP")}
            {image("logo_url", "Logo-黑暗模式")}
            {image("logo_light_url", "Logo-明亮模式")}
            {switcher("toolbar", "隐藏顶部工具栏", true)}
            {switcher("show_service_card", "主侧边栏-显示客服卡片")}
            {image("official_qr", "公众号二维码")}
            {text("contact", "侧面滑动栏联系邮箱")}
            {text("service_url", "客服地址")}
            {image("service_image", "客服图片")}
            {text("police_record", "公安备案号")}
            {text("icp_record", "ICP备案号")}
            {text("site_title", "网站标题")}
            {text("seo_description", "SEO描述", true)}
            {text("seo_keywords", "SEO关键词", true)}
            {switcher(
              "disable_app_details",
              "禁用应用详情页",
              false,
              "禁用后点击应用将不再跳转至详情页",
            )}
            {switcher(
              "disable_work_details",
              "禁用作品详情页",
              false,
              "禁用后点击作品将不再跳转至详情页",
            )}
          </>
        )}
        {section === "菜单栏设置" && (
          <MenuEditor
            value={Array.isArray(v.navigation) ? v.navigation : []}
            onChange={(x) => d.set("navigation", x)}
          />
        )}
        {section === "经典布局-轮播图设置" && (
          <>
            {["logo", "background"].map((key, i) => (
              <ConfigField
                key={key}
                title={["轮播图-Logo", "轮播背景图-黑暗模式"][i]}
              >
                <div className="page-image-control">
                  {classic[key] && <img src={classic[key]} alt="轮播图片" />}
                  <input
                    value={classic[key] || ""}
                    onChange={(e) =>
                      d.set("classic_carousel", {
                        ...classic,
                        [key]: e.target.value,
                      })
                    }
                  />
                  <BrandImageUpload
                    kind="page-display"
                    onChange={(url) =>
                      d.set("classic_carousel", { ...classic, [key]: url })
                    }
                  />
                </div>
              </ConfigField>
            ))}
            {[1, 2, 3, 4, 5].map((i) => (
              <ConfigField key={i} title={"轮播图-文字" + i}>
                <input
                  value={classic["text" + i] || ""}
                  onChange={(e) =>
                    d.set("classic_carousel", {
                      ...classic,
                      ["text" + i]: e.target.value,
                    })
                  }
                />
              </ConfigField>
            ))}
            <ConfigField title="按钮1（免费体验）跳转路径">
              <input
                value={classic.button1_route || ""}
                onChange={(e) =>
                  d.set("classic_carousel", {
                    ...classic,
                    button1_route: e.target.value,
                  })
                }
              />
            </ConfigField>
            <ConfigToggle
              title="隐藏按钮2（0基础部署按钮）"
              value={!!classic.hide_button2}
              onChange={(x) =>
                d.set("classic_carousel", { ...classic, hide_button2: x })
              }
            />
          </>
        )}
        {section === "登录页设置" && (
          <>
            {image("login_background", "登录页背景图片（暗）")}
            {image("login_background_light", "登录页背景图片（亮）")}
          </>
        )}
        {section === "服务条款和隐私政策" && (
          <>
            {text("terms", "服务条款", true, "支持 Markdown 格式")}
            {text("privacy", "隐私政策", true, "支持 Markdown 格式")}
            {text("about", "关于我们", true, "支持 Markdown 格式")}
          </>
        )}
        {section === "高级-自定义页面" && (
          <>
            {text(
              "custom_home",
              "自定义首页",
              false,
              "留空时进入创作大厅；支持站内路径或 HTTP(S) 地址。",
            )}
            {table(
              "custom_pages",
              [
                { key: "path", title: "自定义路径", placeholder: "例如 image" },
                {
                  key: "url",
                  title: "自定义网页地址",
                  placeholder: "https://…",
                },
              ],
              "添加自定义页面",
              { path: "", url: "" },
            )}
            <p className="ref-field-help">
              配置后可通过 /custom/自定义路径
              访问嵌入页面。第三方网页需允许被嵌入。
            </p>
          </>
        )}
        {section === "内置页面接管" && (
          <>
            <p className="ref-description">
              访问原页面路径时，跳转到已配置的自定义页面。
            </p>
            {table(
              "page_overrides",
              [
                { key: "enabled", title: "启用", boolean: true },
                {
                  key: "source",
                  title: "原页面路径",
                  placeholder: "例如：/studio/ideas",
                },
                {
                  key: "target",
                  title: "跳转目标自定义页面",
                  placeholder: "例如：/custom/inspiration",
                },
                { key: "remark", title: "备注", placeholder: "可选备注" },
              ],
              "添加接管规则",
              { enabled: true, source: "", target: "", remark: "" },
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
