"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Database } from "lucide-react";
import { api, post, put, type DataRecord } from "@reference/lib/api";
import { ConfigField, ConfigToggle } from "./platform-form";
import { Modal } from "./reference-ui";
import { useToast, ErrorState, Spinner } from "./ui";
export function KnowledgeServices({ onClose }: { onClose: () => void }) {
  const q = useQuery({
      queryKey: ["knowledge-services"],
      queryFn: () => api("/admin/knowledge-services"),
    }),
    cache = useQueryClient(),
    toast = useToast();
  const [form, setForm] = useState<DataRecord | null | undefined>(),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [url, setUrl] = useState(""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  function edit(row: DataRecord | null) {
    setForm(row);
    setName(row?.name || "");
    setDescription(row?.data.description || "");
    setUrl(row?.data.api_url || "");
    setToken("");
  }
  function refresh() {
    cache.invalidateQueries({ queryKey: ["knowledge-services"] });
  }
  async function save() {
    setBusy(true);
    try {
      const body = {
        name,
        description,
        api_url: url,
        api_token: token,
        enabled: form ? form.status === "active" : true,
        expected_version: form?.version,
      };
      if (form) await put("/admin/knowledge-services/" + form.id, body);
      else await post("/admin/knowledge-services", body);
      refresh();
      setForm(undefined);
      toast("知识库服务已保存");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        form === undefined ? "知识库服务配置" : form ? "编辑服务" : "添加服务"
      }
      onClose={onClose}
      className="knowledge-services-modal"
      footer={
        form !== undefined ? (
          <>
            <button
              className="button secondary"
              onClick={() => setForm(undefined)}
            >
              取 消
            </button>
            <button className="button primary" disabled={busy} onClick={save}>
              {busy ? "保存中…" : form ? "保 存" : "创 建"}
            </button>
          </>
        ) : undefined
      }
    >
      {form === undefined ? (
        <>
          <p className="ref-description">
            配置知识库服务提供商，用于管理和存储知识库数据
          </p>
          <div className="ref-toolbar">
            <span>
              已配置 {(q.data?.items.length || 0) + (q.data?.local ? 1 : 0)}{" "}
              个知识库服务
            </span>
            <span className="ref-spacer" />
            <button className="button primary" onClick={() => edit(null)}>
              <Plus size={14} />
              添加服务
            </button>
          </div>
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            <div className="knowledge-service-list">
              <section className="knowledge-service-card">
                <header>
                  <Database size={24} />
                  <div>
                    <strong>{q.data.local.name}</strong>
                    <p>{q.data.local.description}</p>
                  </div>
                  <span className="ref-setting-badge">内置</span>
                </header>
                <div className="knowledge-service-meta">
                  <div>
                    <small>知识库数量</small>
                    <p>{q.data.local.dataset_count} 个</p>
                  </div>
                  <div>
                    <small>状态</small>
                    <p>启用</p>
                  </div>
                </div>
              </section>
              {q.data.items.map((r: DataRecord & { dataset_count: number }) => (
                <section className="knowledge-service-card" key={r.id}>
                  <header>
                    <Database size={24} />
                    <div>
                      <strong>{r.name}</strong>
                      <p>{r.data.description || "Dify 知识库服务"}</p>
                    </div>
                    <ConfigToggle
                      title="启用"
                      value={r.status === "active"}
                      onChange={async (enabled) => {
                        try {
                          await put("/admin/knowledge-services/" + r.id, {
                            name: r.name,
                            description: r.data.description,
                            api_url: r.data.api_url,
                            enabled,
                            expected_version: r.version,
                          });
                          refresh();
                        } catch (e) {
                          toast((e as Error).message, true);
                        }
                      }}
                    />
                  </header>
                  <div className="knowledge-service-meta">
                    <div>
                      <small>API 地址</small>
                      <p>{r.data.api_url}</p>
                    </div>
                    <div>
                      <small>知识库数量</small>
                      <p>{r.dataset_count} 个</p>
                    </div>
                  </div>
                  <footer>
                    <button
                      className="button secondary"
                      disabled={busy || r.status !== "active"}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const result = await post(
                            "/admin/knowledge-services/" + r.id + "/sync",
                            { expected_version: r.version },
                          );
                          toast(result.message);
                          refresh();
                          await cache.invalidateQueries({
                            queryKey: ["collection"],
                          });
                        } catch (e) {
                          toast((e as Error).message, true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      同步知识库
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const result = await post(
                            "/admin/knowledge-services/" + r.id + "/validate",
                            { expected_version: r.version },
                          );
                          toast(result.message);
                          refresh();
                        } catch (e) {
                          toast((e as Error).message, true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      验证连接
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => edit(r)}
                    >
                      编辑配置
                    </button>
                  </footer>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="ref-form">
          <ConfigField title="服务类型 *" hint="Dify 知识库服务">
            <select aria-label="服务类型" value="dify" onChange={() => {}}>
              <option value="dify">Dify</option>
            </select>
          </ConfigField>
          <ConfigField title="名称 *">
            <input
              placeholder="请输入服务名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </ConfigField>
          <ConfigField title="描述">
            <textarea
              rows={3}
              placeholder="请输入描述信息"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </ConfigField>
          <ConfigField title="API 地址 *" hint="Dify API 服务地址">
            <input
              type="url"
              placeholder="https://api.dify.ai/v1"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </ConfigField>
          <ConfigField
            title="API Token *"
            hint="在 Dify 控制台获取 Dataset API Token"
          >
            <input
              type="password"
              autoComplete="new-password"
              placeholder={
                form?.configured_secrets?.includes("api_token")
                  ? "已配置，留空保留"
                  : "请输入 API Token"
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </ConfigField>
        </div>
      )}
    </Modal>
  );
}
