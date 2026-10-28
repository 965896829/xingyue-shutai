"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Save,
  Send,
  Eye,
  Upload,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Layout,
  Type,
  Folder,
} from "lucide-react";
import { api, post, formatTime, type DataRecord } from "@reference/lib/api";
import { Spinner, ErrorState, useToast, Status } from "./ui";
import { Modal, RefTabs, RefEmpty } from "./reference-ui";
import { useColorMode } from "./color-mode";
type Block = { id: string; type: string; title: string; subtitle?: string };
type Config = {
  name: string;
  accent: string;
  background: string;
  surface: string;
  radius: number;
  font: string;
  blocks: Block[];
};
const blockTypes = [
  ["hero", "标题与引言"],
  ["workspace", "创作工作区"],
  ["books", "作品陈列"],
  ["folders", "灵感文件夹"],
  ["stats", "数据概览"],
  ["text", "文本"],
];
function previewInk(background: string) {
  const rgb = background.replace("#", "").match(/.{2}/g)?.slice(0, 3).map(v => parseInt(v, 16) / 255) || [0, 0, 0];
  const luminance = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const light = luminance > 0.179;
  return { text: light ? "#292621" : "#f5f5ef", muted: light ? "#554e46" : "#c4c8bb", light };
}
export function ReferenceTheme() {
  const { mode } = useColorMode();
  const q = useQuery({
      queryKey: ["theme-versions"],
      queryFn: () => api("/admin/system/themes"),
    }),
    toast = useToast();
  const [config, setConfig] = useState<Config | null>(null),
    [selected, setSelected] = useState(""),
    [tab, setTab] = useState("组件"),
    [history, setHistory] = useState(""),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [previewPalette, setPreviewPalette] = useState("page");
  useEffect(() => {
    if (q.data && !config)
      setConfig(
        structuredClone(
          q.data.items.find((r: DataRecord) => r.status === "active")?.data
            .config || q.data.default,
        ),
      );
  }, [q.data, config]);
  if (q.error) return <ErrorState error={q.error} />;
  if (!config) return <Spinner />;
  const update = (key: string, value: any) => {
    setConfig({ ...config, [key]: value });
    if (["accent", "background", "surface"].includes(key)) setPreviewPalette("configured");
  };
  const block = config.blocks.find((b) => b.id === selected);
  const palette = previewPalette === "page" && mode === "light"
    ? { background: "#fafaf8", surface: "#ffffff", accent: "#ff792d" }
    : config;
  async function save(publish: boolean) {
    setBusy(true);
    try {
      const row = await post("/admin/system/themes", { config });
      if (publish) await post(`/admin/system/themes/${row.id}/publish`);
      await q.refetch();
      toast(publish ? "主题已发布" : "主题草稿已保存");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const renderCanvas = () => (
    <div
      className="ref-theme-canvas"
      data-preview-tone={previewInk(palette.background).light ? "light" : "dark"}
      style={
        {
          background: palette.background,
          color: previewInk(palette.background).text,
          "--lime": palette.accent,
          "--preview-accent": palette.accent,
          "--preview-on-accent": previewInk(palette.accent).text,
        } as CSSProperties
      }
    >
      {config.blocks.map((b) => (
        <div
          key={b.id}
          className={`ref-preview-block block-${b.type} ${b.id === selected ? "selected" : ""}`}
          style={{
            borderRadius: config.radius,
            background: b.type === "hero" ? "transparent" : palette.surface,
            color: previewInk(b.type === "hero" ? palette.background : palette.surface).text,
            "--preview-muted": previewInk(b.type === "hero" ? palette.background : palette.surface).muted,
          } as CSSProperties}
          onClick={() => setSelected(b.id)}
          role="button"
          tabIndex={0}
          aria-label={`选择组件 ${b.title}`}
          onKeyDown={(e) => {
            if (e.key === "Enter") setSelected(b.id);
          }}
        >
          <h2>{b.title}</h2>
          {b.subtitle && <p>{b.subtitle}</p>}
          {b.type === "workspace" && (
            <>
              <p>一个想法，也足够开始</p>
              <div className="ref-theme-input">描述你的故事、人物或世界…</div>
              <span className="button primary">新建作品</span>
            </>
          )}
          {b.type === "books" && (
            <div className="ref-preview-books">
              {["雾城来信", "山海异闻", "长夜回声"].map((t) => (
                <div key={t}>{t}</div>
              ))}
            </div>
          )}
          {b.type === "folders" && (
            <div className="ref-preview-folders">
              {["场景灵感", "人物设定", "世界观设定", "碎片随记"].map((t) => (
                <div key={t}>
                  <Folder size={27} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          )}
          {b.type === "stats" && (
            <div className="ref-preview-folders">
              {["作品", "灵感", "创作进度"].map((t) => (
                <div key={t}>
                  <strong>—</strong>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          )}
          {b.type === "text" && <p>写下更大的世界。</p>}
        </div>
      ))}
    </div>
  );
  return (
    <div className="ref-page ref-theme-page">
      <div className="ref-theme-toolbar">
        <strong>预设主题</strong>
        <label>
          布局：
          <select aria-label="主题布局">
            <option>创作站点首页</option>
          </select>
        </label>
        <label>
          预览：
          <select aria-label="预览配色" value={previewPalette} onChange={e => setPreviewPalette(e.target.value)}>
            <option value="page">跟随当前日夜模式</option>
            <option value="configured">配置中的颜色</option>
          </select>
        </label>
        <label className="button secondary">
          <Upload size={13} />
          导入
          <input
            className="file-input"
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const parsed = JSON.parse(await f.text());
                if (
                  !Array.isArray(parsed.blocks) ||
                  parsed.blocks.length > 30 ||
                  !["accent", "background", "surface"].every((k) =>
                    /^#[a-f\d]{6}$/i.test(parsed[k]),
                  )
                )
                  throw new Error("主题格式或颜色无效");
                setConfig(parsed);
                setPreviewPalette("configured");
                setSelected("");
                toast("已载入主题，可预览后保存");
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          />
        </label>
        <button
          className="button secondary"
          onClick={() => {
            setConfig(structuredClone(q.data.default));
            setPreviewPalette("configured");
            setSelected("");
          }}
        >
          <RotateCcw size={13} />
          重置当前草稿
        </button>
        <button
          className="button secondary"
          onClick={() => setHistory("草稿历史")}
        >
          草稿历史
        </button>
        <button
          className="button secondary"
          onClick={() => setHistory("发布历史")}
        >
          发布历史
        </button>
      </div>
      <div className="ref-theme-subbar">
        <span>用户界面</span>
        <small>{block?.title || "未选择组件"}</small>
        <div className="ref-actions">
          <span>视图比例 100%</span>
          <button className="button secondary" onClick={() => setPreview(true)}>
            <Eye size={14} />
            预览
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => save(false)}
          >
            <Save size={14} />
            保存
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => save(true)}
          >
            <Send size={14} />
            发布
          </button>
        </div>
      </div>
      <div className="ref-theme-layout">
        <aside className="ref-theme-components">
          <RefTabs tabs={["组件", "结构"]} value={tab} onChange={setTab} />
          {tab === "组件" ? (
            <>
              <h3>基础与布局</h3>
              <div className="ref-component-palette">
                {blockTypes.map(([type, name]) => (
                  <button
                    key={type}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      update("blocks", [
                        ...config.blocks,
                        { id, type, title: name },
                      ]);
                      setSelected(id);
                    }}
                  >
                    {type === "text" ? (
                      <Type size={20} />
                    ) : (
                      <Layout size={20} />
                    )}
                    <span>{name}</span>
                    <Plus size={12} />
                  </button>
                ))}
              </div>
              <p className="ref-field-help">
                添加组件后，可在右侧调整标题与属性。
              </p>
            </>
          ) : (
            <div className="ref-theme-structure">
              {config.blocks.map((b, i) => (
                <div key={b.id}>
                  <button
                    className={selected === b.id ? "active" : ""}
                    onClick={() => setSelected(b.id)}
                  >
                    <Layout size={14} />
                    {b.title}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="上移组件"
                    disabled={i === 0}
                    onClick={() => {
                      const blocks = [...config.blocks];
                      [blocks[i], blocks[i - 1]] = [blocks[i - 1], blocks[i]];
                      update("blocks", blocks);
                    }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="下移组件"
                    disabled={i === config.blocks.length - 1}
                    onClick={() => {
                      const blocks = [...config.blocks];
                      [blocks[i], blocks[i + 1]] = [blocks[i + 1], blocks[i]];
                      update("blocks", blocks);
                    }}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
        <section className="ref-theme-preview">{renderCanvas()}</section>
        <aside className="ref-theme-properties">
          <h3>属性编辑</h3>
          {block ? (
            <div className="ref-form">
              <label className="field">
                <span>组件标题</span>
                <input
                  value={block.title}
                  onChange={(e) =>
                    update(
                      "blocks",
                      config.blocks.map((b) =>
                        b.id === selected ? { ...b, title: e.target.value } : b,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>副标题</span>
                <textarea
                  rows={4}
                  value={block.subtitle || ""}
                  onChange={(e) =>
                    update(
                      "blocks",
                      config.blocks.map((b) =>
                        b.id === selected
                          ? { ...b, subtitle: e.target.value }
                          : b,
                      ),
                    )
                  }
                />
              </label>
              <DeleteButton
                confirmation="inline"
                className="button secondary"
                onClick={() => {
                  update(
                    "blocks",
                    config.blocks.filter((b) => b.id !== selected),
                  );
                  setSelected("");
                }}
              >
                删除组件
              </DeleteButton>
            </div>
          ) : (
            <RefEmpty text="请选择一个组件进行编辑" />
          )}
          <h3 className="ref-theme-global-title">全局样式</h3>
          <div className="ref-form">
            <label className="field">
              <span>主题名称</span>
              <input
                value={config.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            {[
              ["accent", "强调色"],
              ["background", "背景色"],
              ["surface", "表面色"],
            ].map(([key, n]) => (
              <label className="field" key={key}>
                <span>{n}</span>
                <input
                  type="color"
                  value={(config as any)[key]}
                  onChange={(e) => update(key, e.target.value)}
                />
              </label>
            ))}
            <label className="field">
              <span>圆角 {config.radius} px</span>
              <input
                type="range"
                min={0}
                max={40}
                value={config.radius}
                onChange={(e) => update("radius", Number(e.target.value))}
              />
            </label>
          </div>
        </aside>
      </div>
      {history && (
        <Modal title={history} onClose={() => setHistory("")} wide>
          {q.data.items.filter((r: DataRecord) =>
            history === "草稿历史"
              ? r.status === "draft"
              : r.status !== "draft",
          ).length ? (
            q.data.items
              .filter((r: DataRecord) =>
                history === "草稿历史"
                  ? r.status === "draft"
                  : r.status !== "draft",
              )
              .map((r: DataRecord) => (
                <div className="ref-theme-history" key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <p>{formatTime(r.created_at)}</p>
                  </div>
                  <Status value={r.status} />
                  <button
                    className="button secondary"
                    onClick={() => {
                      setConfig(structuredClone(r.data.config));
                      setHistory("");
                      setSelected("");
                    }}
                  >
                    载入
                  </button>
                </div>
              ))
          ) : (
            <RefEmpty />
          )}
        </Modal>
      )}
      {preview && (
        <Modal title="用户界面预览" onClose={() => setPreview(false)} wide>
          {renderCanvas()}
        </Modal>
      )}
    </div>
  );
}
