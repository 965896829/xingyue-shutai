"use client";
import { DeleteButton } from "./interaction/delete-button";
import { RemoteSkillImport } from "./remote-skill-import";
import { WritingRuntimePanel } from "./writing-runtime-panel";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Settings2,
  Upload,
  Puzzle,
  Database,
  Pencil,
  FileText,
  Globe,
  Cpu,
  Building2,
  SlidersHorizontal,
} from "lucide-react";
import {
  api,
  recordCollection,
  post,
  type PageSpec,
  type DataRecord,
  label,
} from "@reference/lib/api";
import { Spinner, ErrorState, Status, useToast } from "./ui";
import {
  Modal,
  SearchBox,
  CompactHeading,
  RefTabs,
  RefEmpty,
  RefPagination,
} from "./reference-ui";
import { BaseCatalogActions, ResourceHistory } from "./admin-parity-tools";
import { ModelCatalogUpdate, BaseModelOperation } from "./model-catalog-update";
import { modelAbilities } from "./base-model-form";
import { KnowledgeDocuments } from "./knowledge-documents";
import { KnowledgeServices } from "./knowledge-services";
import { ReferenceRecordForm } from "./reference-record-form";
import { SkillPackageUpload } from "./knowledge-create";
import { navigate } from '../router';

export function ReferenceCollection({ page }: { page: PageSpec }) {
  const q = useQuery({
      queryKey: ["collection", page.key],
      queryFn: () => recordCollection(page.key),
    }),
    toast = useToast(),
    cache = useQueryClient();
  const related = useQuery({
    queryKey: ["collection-models"],
    queryFn: () => recordCollection("models"),
    enabled: ["providers", "models", "base-models"].includes(page.key),
  });
  const providers = useQuery({
    queryKey: ["collection-provider-names"],
    queryFn: () => recordCollection("providers"),
    enabled: page.key === "models",
  });
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [vendor, setVendor] = useState(""),
    [ability, setAbility] = useState(""),
    [scene, setScene] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [tab, setTab] = useState("可用"),
    [form, setForm] = useState<DataRecord | null | undefined>(),
    [detail, setDetail] = useState<DataRecord | null>(null),
    [panel, setPanel] = useState(""),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [pageNo, setPageNo] = useState(1),
    [size, setSize] = useState(20);
  const key = page.key,
    items: DataRecord[] = q.data?.items || [],
    isKnowledge = key === "knowledge",
    isModel = key === "models",
    isProvider = key === "providers",
    isBase = key === "base-models",
    isSkills = key === "skills";
  const filtered = items.filter(
    (r) =>
      (!search ||
        JSON.stringify([
          r.name,
          r.data.description,
          r.data.model_id,
          r.data.canonical_key,
        ])
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!filter || r.data.capability === filter) &&
      (!vendor || (r.data.provider_id || r.data.vendor) === vendor) &&
      (!isBase ||
        ((!ability || r.data.model_types?.includes(ability)) &&
          (!scene ||
            !r.data.usage_scenes?.length ||
            r.data.usage_scenes.includes(scene)))) &&
      (!isKnowledge ||
        (tab === "可用"
          ? r.status === "active"
          : tab === "待启用"
            ? ["draft", "disabled"].includes(r.status)
            : !["draft", "disabled", "active"].includes(r.status))),
  );
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ["collection"] });
    cache.invalidateQueries({ queryKey: ["records"] });
    cache.invalidateQueries({ queryKey: ["collection-models"] });
  };
  async function action(r: DataRecord, name: string) {
    setBusy(true);
    try {
      if (name === "delete")
        await api(
          `/admin/records/${key}/${r.id}?expected_version=${r.version}`,
          { method: "DELETE" },
        );
      else
        await post(`/admin/records/${key}/${r.id}/actions/${name}`, {
          expected_version: r.version,
        });
      refresh();
      setDetail(null);
      toast("操作已完成");
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const tools = (
    <>
      <button className="button primary" onClick={() => isProvider ? navigate('/admin/platform/platforms') : setForm(null)}>
        <Plus size={14} />
        {isProvider
          ? "新增厂商"
          : isBase
            ? "新增模型"
            : isSkills
              ? "上传技能"
              : "新增模型"}
      </button>
      <button className="button secondary" onClick={() => q.refetch()}>
        <RefreshCw size={14} />
        刷新
      </button>
      {(isModel || isBase || isProvider) && <button className="button secondary" onClick={() => { navigate('/admin/local/workspace'); setTimeout(() => window.dispatchEvent(new CustomEvent('management:navigate', { detail: 'models' })), 0); }}>客户端高级模型设置</button>}
    </>
  );
  return (
    <div className={`ref-page ref-collection ref-collection-${key}`}>
      {isSkills && <WritingRuntimePanel skills={items}/>}
      {isProvider && (
        <CompactHeading
          title="厂商管理"
          description="维护基础模型归属的厂商与原生接入协议。"
          actions={tools}
        />
      )}
      {isBase && (
        <>
          <ModelCatalogUpdate refresh={refresh} />
          <div className="ref-toolbar">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPageNo(1);
              }}
              placeholder="搜索模型名称 / canonical key"
            />
            <select
              aria-label="全部厂商"
              value={vendor}
              onChange={(e) => {
                setVendor(e.target.value);
                setPageNo(1);
              }}
            >
              <option value="">全部厂商</option>
              {[...new Set(items.map((i) => i.data.vendor))]
                .filter(Boolean)
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
            <select
              aria-label="全部能力"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPageNo(1);
              }}
            >
              <option value="">全部能力</option>
              {["text", "image", "video", "audio", "embedding", "rerank"].map(
                (v) => (
                  <option value={v} key={v}>
                    {label(v)}
                  </option>
                ),
              )}
            </select>
            <span className="ref-spacer" />
            <select
              aria-label="全部类型"
              value={ability}
              onChange={(e) => {
                setAbility(e.target.value);
                setPageNo(1);
              }}
            >
              <option value="">全部类型</option>
              {modelAbilities.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              aria-label="全部场景"
              value={scene}
              onChange={(e) => {
                setScene(e.target.value);
                setPageNo(1);
              }}
            >
              <option value="">全部场景</option>
              <option value="canvas_model_node">画布模型节点</option>
              <option value="desktop">桌面端</option>
            </select>
            <label className="check-field">
              <input
                type="checkbox"
                checked={
                  !!filtered.length &&
                  filtered.every((r) => selected.includes(r.id))
                }
                onChange={(e) =>
                  setSelected(e.target.checked ? filtered.map((r) => r.id) : [])
                }
              />
              全选
            </label>
            <span>
              已选 {items.filter((r) => selected.includes(r.id)).length}
            </span>
            <BaseModelOperation
              rows={items.filter((r) => selected.includes(r.id))}
              kind="delete"
              refresh={() => {
                setSelected([]);
                refresh();
              }}
            />
            <BaseCatalogActions refresh={refresh} />
            {tools}
          </div>
        </>
      )}
      {isSkills && (
        <div className="ref-toolbar">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPageNo(1);
            }}
            placeholder="搜索技能..."
          />
          <span className="ref-spacer" />
          <button
            className="button secondary"
            onClick={() => navigate("/admin/desktop-skill-store")}
          >
            <Puzzle size={14} />
            桌面技能商店中心
          </button>
          <RemoteSkillImport />
          <SkillPackageUpload onDone={() => refresh()} />
        </div>
      )}
      {isKnowledge && (
        <>
          <div className="ref-toolbar">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPageNo(1);
              }}
              placeholder="搜索知识库..."
            />
            <span className="ref-spacer" />
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  const services = await api("/admin/knowledge-services");
                  for (const service of services.items.filter(
                    (s: any) => s.status === "active",
                  ))
                    await post(`/admin/knowledge-services/${service.id}/sync`, {
                      expected_version: service.version,
                    });
                  await q.refetch();
                  toast("知识库目录已同步");
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              <RefreshCw size={14} />
              同步
            </button>
            <button
              className="button secondary"
              onClick={() => setPanel("knowledge-config")}
            >
              <Settings2 size={14} />
              管理服务配置
            </button>
          </div>
          <RefTabs
            tabs={["可用", "待启用", "异常"]}
            value={tab}
            onChange={(v) => {
              setTab(v);
              setPageNo(1);
            }}
          />
        </>
      )}
      {isModel && (
        <div className="ref-model-toolbar">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPageNo(1);
            }}
            placeholder="模型名称、能力或厂商"
          />
          <button className="button secondary" onClick={() => { navigate('/admin/local/workspace'); setTimeout(() => window.dispatchEvent(new CustomEvent('management:navigate', { detail: 'models' })), 0); }}>客户端高级模型设置</button>
          <button
            className="button primary"
            onClick={() => setPanel("model-config")}
          >
            <SlidersHorizontal size={14} />
            全局模型配置
          </button>
        </div>
      )}
      <div className={isModel ? "ref-model-layout" : ""}>
        {isModel && (
          <aside className="ref-model-filters">
            <h3>模型能力</h3>
            <div className="ref-capability-filters">
              {[
                ["", "全部"],
                ["text", "文本生成"],
                ["image", "图像生成"],
                ["video", "视频生成"],
                ["audio", "音频生成"],
                ["embedding", "Embedding"],
                ["rerank", "文本重排"],
              ].map(([v, n]) => (
                <button
                  className={filter === v ? "active" : ""}
                  key={v}
                  onClick={() => {
                    setFilter(v);
                    setPageNo(1);
                  }}
                >
                  <span>{n}</span>
                  <small>
                    {v
                      ? items.filter((i) => i.data.capability === v).length
                      : items.length}
                  </small>
                </button>
              ))}
            </div>
            <h3>模型厂商</h3>
            <div className="ref-vendor-filters">
              <button
                className={!vendor ? "active" : ""}
                onClick={() => {
                  setVendor("");
                  setPageNo(1);
                }}
              >
                全部 <small>{items.length}</small>
              </button>
              {[
                ...new Set(
                  items.map((i) => i.data.provider_id).filter(Boolean),
                ),
              ].map((v) => (
                <button
                  className={vendor === v ? "active" : ""}
                  key={v}
                  onClick={() => {
                    setVendor(v);
                    setPageNo(1);
                  }}
                >
                  {providers.data?.items.find((p: DataRecord) => p.id === v || p.data.code === v)?.name || "未命名厂商"}{" "}
                  <small>
                    {items.filter((i) => i.data.provider_id === v).length}
                  </small>
                </button>
              ))}
            </div>
          </aside>
        )}
        <div>
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            <div
              className={`ref-collection-grid ${isModel ? "model-cards" : ""}`}
            >
              {isKnowledge && (
                <button
                  className="ref-knowledge-create"
                  onClick={() =>
                    navigate("/admin/knowledge/create/upload")
                  }
                >
                  <span>
                    <Plus size={22} />
                  </span>
                  <strong>创建知识库</strong>
                  <p>导入自己的文本数据以增强 LLM 上下文</p>
                  <footer>
                    <span>
                      <Upload size={13} />
                      上传文档
                    </span>
                    <span>
                      <FileText size={13} />
                      文本输入
                    </span>
                    <span>
                      <Globe size={13} />
                      网页抓取
                    </span>
                  </footer>
                </button>
              )}
              {filtered.slice((pageNo - 1) * size, pageNo * size).map((r) => (
                <article
                  className={`ref-collection-card ${isModel ? "ref-model-card" : ""}`}
                  key={r.id}
                >
                  {isBase && (
                    <div className="ref-toolbar">
                      <input
                        aria-label={`选择模型 ${r.name}`}
                        type="checkbox"
                        checked={selected.includes(r.id)}
                        onChange={(e) =>
                          setSelected((v) =>
                            e.target.checked
                              ? [...v, r.id]
                              : v.filter((id) => id !== r.id),
                          )
                        }
                      />
                      <span className="ref-spacer" />
                      {r.data._defaults && (
                        <BaseModelOperation
                          rows={[r]}
                          kind="reset"
                          refresh={refresh}
                        />
                      )}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => action(r, "toggle")}
                      >
                        {r.status === "active" ? "停用" : "启用"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setForm(r)}
                      >
                        修改
                      </button>
                      <BaseModelOperation
                        rows={[r]}
                        kind="delete"
                        refresh={refresh}
                      />
                    </div>
                  )}
                  <div className="ref-collection-card-head">
                    <span className="ref-collection-icon">
                      {isKnowledge ? (
                        <Database size={23} />
                      ) : isProvider ? (
                        <Building2 size={23} />
                      ) : isSkills ? (
                        <Puzzle size={23} />
                      ) : (
                        <Cpu size={23} />
                      )}
                    </span>
                    <div>
                      <strong>{r.name}</strong>
                      <small>
                        {r.data.model_id ||
                          r.data.canonical_key ||
                          r.data.code ||
                          r.data.version ||
                          ""}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`编辑 ${r.name}`}
                      onClick={() => setForm(r)}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                  {r.data.description && (
                    <p className="ref-collection-description">
                      {r.data.description}
                    </p>
                  )}
                  {isProvider ? (
                    <>
                      <div className="ref-provider-meta">
                        <span>
                          规范 <b>{r.data.protocol}</b>
                        </span>
                        <span>
                          模型{" "}
                          <b>
                            {related.data?.items.filter(
                              (m: DataRecord) =>
                                m.data.provider_id === r.id ||
                                m.data.provider_id === r.data.code,
                            ).length || 0}
                          </b>
                        </span>
                      </div>
                      <div className="ref-card-tags">
                        <span>{r.data.protocol}</span>
                      </div>
                    </>
                  ) : isModel ? (
                    <>
                      <div className="ref-card-tags">
                        <span>{label(r.data.capability)}</span>
                        {(r.data.stages || []).map((s: string) => (
                          <span key={s}>{label(s)}</span>
                        ))}
                      </div>
                      <div className="ref-model-detail">
                        <div>
                          <span>源</span>
                          <strong>
                            {r.data.platform_id ? "1 个源" : "按平台调度"}
                          </strong>
                        </div>
                        <div>
                          <span>上下文</span>
                          <strong>{r.data.context_window || "—"}</strong>
                        </div>
                        <div className="full">
                          <span>
                            计费{" "}
                            <button
                              className="text-button"
                              onClick={() => setDetail(r)}
                            >
                              查看模型配置
                            </button>
                          </span>
                          <strong>
                        本机估算单价；平台折扣尚未接入
                          </strong>
                        </div>
                      </div>
                    </>
                  ) : isBase ? (
                    <>
                      <div className="ref-card-tags">
                        {(r.data.model_types?.length
                          ? r.data.model_types
                          : [r.data.capability]
                        ).map((t: string) => (
                          <span key={t}>
                            {modelAbilities.find((a) => a.key === t)?.name ||
                              label(t)}
                          </span>
                        ))}
                        {r.data._catalog_offline && <span>目录下线</span>}
                      </div>
                      <div className="ref-base-meta">
                        <span>可选场景</span>
                        <strong>
                          {r.data.usage_scenes?.length
                            ? r.data.usage_scenes
                                .map((s: string) =>
                                  s === "desktop" ? "桌面端" : "画布模型节点",
                                )
                                .join("、")
                            : "不限制"}
                        </strong>
                        <span>厂商</span>
                        <strong>{r.data.vendor || "—"}</strong>
                        <span>上下文窗口</span>
                        <strong>{r.data.context_window || "—"}</strong>
                      </div>
                    </>
                  ) : (
                    <p className="ref-collection-description">
                      {isKnowledge
                        ? `${label(r.data.scope)} · ${r.data.chunk_count || 0} 个片段`
                        : `版本 ${r.data.version || "1.0.0"} · ${(r.data.surfaces || []).map(label).join(" / ")}`}
                    </p>
                  )}
                  {
                    <footer>
                      <Status value={r.status} />
                      {isModel && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setDetail(r);
                            setPanel("model-enable");
                          }}
                        >
                          {r.status === "active" ? "停用" : "确认能力并启用"}
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setDetail(r)}
                      >
                        {isKnowledge
                          ? "管理文档"
                          : isProvider
                            ? "详情"
                            : "管理"}{" "}
                        →
                      </button>
                    </footer>
                  }
                </article>
              ))}
              {!isKnowledge && !filtered.length && (
                <div className="ref-collection-empty">
                  <RefEmpty
                    text={
                      isSkills
                        ? "暂无技能，上传 ZIP 或创建技能指令"
                        : "暂无匹配内容"
                    }
                  />
                </div>
              )}
            </div>
          )}
          {(q.data?.total || 0) > size && (
            <RefPagination
              page={pageNo}
              size={size}
              total={filtered.length}
              onPage={setPageNo}
              onSize={(n) => {
                setPageNo(1);
                setSize(n);
              }}
            />
          )}
        </div>
      </div>
      {form !== undefined && (
        <ReferenceRecordForm
          page={page}
          record={form || undefined}
          onClose={() => setForm(undefined)}
          onDone={refresh}
        />
      )}
      {detail && (
        <Modal
          title={detail.name}
          onClose={() => {
            setDetail(null);
            setHits(null);
          }}
          wide
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => {
                  if (isProvider) { navigate('/admin/platform/platforms'); return; }
                  setForm(detail);
                  setDetail(null);
                }}
              >
                编辑
              </button>
              {page.actions.includes("toggle") && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => action(detail, "toggle")}
                >
                  {detail.status === "active" ? "停用" : "启用"}
                </button>
              )}
              {page.actions.includes("delete") && (
                <DeleteButton
                  confirmation="dialog"
                  className="button danger"
                  onClick={() => setPanel("delete")}
                >
                  删除
                </DeleteButton>
              )}
            </>
          }
        >
          <p className="ref-description">
            {detail.data.description || page.description}
          </p>
          {isKnowledge ? (
            <>
              <KnowledgeDocuments id={detail.id} onChanged={refresh} />
              <form
                className="ref-toolbar"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    setHits(
                      await post(`/admin/knowledge/${detail.id}/search`, {
                        query,
                        top_k: 5,
                        mode: "lexical",
                      }),
                    );
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <SearchBox
                  value={query}
                  onChange={setQuery}
                  placeholder="输入检索内容…"
                />
                <button className="button secondary" disabled={busy}>
                  检索测试
                </button>
              </form>
              {hits &&
                (hits.items.length ? (
                  hits.items.map((h: any) => (
                    <div className="ref-notice" key={h.id}>
                      <small>相关度 {h.score}</small>
                      <p>{h.text}</p>
                    </div>
                  ))
                ) : (
                  <RefEmpty text="未检索到相关片段" />
                ))}
              <p className="ref-field-help">
                支持
                TXT、Markdown、DOCX、手动文本及公开网页。停用文档后，其片段不再参与新的检索。
              </p>
            </>
          ) : (
            <dl className="detail-list">
              {page.fields
                .filter((f) => f.type !== "secret")
                .map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{label(detail.data[f.key])}</dd>
                  </div>
                ))}
            </dl>
          )}
          {["base-models", "skills", "models"].includes(key) && (
            <ResourceHistory record={detail} />
          )}
        </Modal>
      )}
      {panel === "delete" && detail && (
        <Modal
          title="删除记录"
          onClose={() => setPanel("")}
          footer={
            <DeleteButton
              confirmation="commit"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                const result = await action(detail, "delete");
                if (result !== false) setPanel("");
                return result;
              }}
            >
              确认删除
            </DeleteButton>
          }
        >
          <p>将删除「{detail.name}」，已有引用可能阻止此操作。</p>
        </Modal>
      )}
      {panel === "model-enable" && detail && (
        <Modal
          title={detail.status === "active" ? "停用模型" : "确认模型能力"}
          onClose={() => setPanel("")}
          footer={
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                await action(detail, "toggle");
                setPanel("");
              }}
            >
              确认{detail.status === "active" ? "停用" : "启用"}
            </button>
          }
        >
          <p>
            {detail.name} · {label(detail.data.capability)}
          </p>
          <p className="ref-field-help">
            请核对模型标识和能力类型。智能体只允许调用已启用的文本模型；可先返回编辑能力字段。
          </p>
        </Modal>
      )}
      {panel === "model-config" && (
        <Modal title="全局模型配置" onClose={() => setPanel("")} wide>
          <p className="ref-description">
            选择模型配置其名称、调用标识、能力、上下文窗口与价格。
          </p>
          <div className="ref-picker">
            {items.map((r) => (
              <button
                className="ref-config-entry"
                key={r.id}
                onClick={() => {
                  setPanel("");
                  setForm(r);
                }}
              >
                <Cpu size={18} />
                <span>
                  {r.name}
                  <small>{r.data.model_id}</small>
                </span>
                <Pencil size={14} />
              </button>
            ))}
            <button
              className="button primary"
              onClick={() => {
                setPanel("");
                setForm(null);
              }}
            >
              <Plus size={14} />
              新增模型
            </button>
          </div>
        </Modal>
      )}
      {panel === "knowledge-config" && (
        <KnowledgeServices onClose={() => setPanel("")} />
      )}
    </div>
  );
}
