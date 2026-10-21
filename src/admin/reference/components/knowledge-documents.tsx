"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Globe, Upload } from "lucide-react";
import { api, post, formatTime } from "@reference/lib/api";
import { Spinner, ErrorState, useToast, Status } from "./ui";
import { Modal, RefEmpty } from "./reference-ui";
import { KnowledgeRetrieval } from "./knowledge-retrieval";
import { KnowledgeReconciliation } from "./knowledge-reconciliation";

export function KnowledgeDocuments({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const cache = useQueryClient(),
    toast = useToast();
  const q = useQuery({
    queryKey: ["knowledge-documents", id],
    queryFn: () => api(`/admin/knowledge/${id}/documents`),
  });
  const [mode, setMode] = useState(""),
    [name, setName] = useState(""),
    [text, setText] = useState(""),
    [url, setUrl] = useState("");
  const [authorized, setAuthorized] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [remove, setRemove] = useState<any>(null);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["knowledge-documents", id] });
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <KnowledgeReconciliation
        id={id}
        onChanged={() => {
          q.refetch();
          onChanged();
        }}
      />
      <KnowledgeRetrieval id={id} />
      <div className="ref-toolbar">
        <label className="button primary">
          <Upload size={14} />
          上传文档
          <input
            className="file-input"
            disabled={busy}
            type="file"
            accept=".pdf,.docx,.txt,.md,.xlsx,.csv,.html,.htm,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const body = new FormData();
              body.append("file", f);
              await action(() =>
                api(`/admin/records/knowledge/${id}/upload`, {
                  method: "POST",
                  body,
                }),
              );
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="button secondary"
          onClick={() => {
            setMode("text");
            setAuthorized(false);
          }}
        >
          <FileText size={14} />
          文本输入
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setMode("web");
            setAuthorized(false);
          }}
        >
          <Globe size={14} />
          网页抓取
        </button>
        <button
          className="button secondary"
          disabled={busy || !q.data}
          onClick={() =>
            action(() =>
              post(`/admin/records/knowledge/${id}/actions/sync`, {
                expected_version: q.data.version,
              }),
            )
          }
        >
          {q.data?.external ? "同步处理状态" : "重建索引"}
        </button>
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data.items.length ? (
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>文档名称</th>
                <th>来源</th>
                <th>大小</th>
                <th>状态</th>
                <th>添加时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>
                    {d.source_url ? (
                      <span title={d.source_url}>网页</span>
                    ) : (
                      "文件 / 文本"
                    )}
                  </td>
                  <td>{(d.size / 1024).toFixed(1)} KB</td>
                  <td>
                    <Status value={d.status} />
                    {d.error && <small title={d.error}> · {d.error}</small>}
                  </td>
                  <td>{formatTime(d.created_at)}</td>
                  <td>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        action(async () =>
                          setPreview(
                            await api(
                              `/admin/knowledge/${id}/documents/${d.id}/content`,
                            ),
                          ),
                        )
                      }
                    >
                      内容
                    </button>{" "}
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        action(() =>
                          post(
                            `/admin/knowledge/${id}/documents/${d.id}/action`,
                            {
                              expected_version: q.data.version,
                              action:
                                d.status === "active" ? "disable" : "enable",
                            },
                          ),
                        )
                      }
                    >
                      {d.status === "active" ? "停用" : "启用"}
                    </button>{" "}
                    <DeleteButton
                      confirmation="dialog"
                      className="text-button"
                      disabled={busy}
                      onClick={() => setRemove(d)}
                    >
                      移除
                    </DeleteButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <RefEmpty text="还没有文档，可上传文件、输入文本或导入网页。" />
      )}
      {mode && (
        <Modal
          title={mode === "web" ? "从网页导入" : "输入资料文本"}
          onClose={() => setMode("")}
          footer={
            <button
              className="button primary"
              disabled={
                busy ||
                !name.trim() ||
                !authorized ||
                !(mode === "web" ? url.trim() : text.trim())
              }
              onClick={async () => {
                if (
                  await action(() =>
                    post(`/admin/knowledge/${id}/documents`, {
                      expected_version: q.data.version,
                      name,
                      text: mode === "text" ? text : "",
                      url: mode === "web" ? url : "",
                      authorized,
                    }),
                  )
                ) {
                  setMode("");
                  setName("");
                  setText("");
                  setUrl("");
                }
              }}
            >
              导入并索引
            </button>
          }
        >
          <label className="field">
            文档名称
            <input
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {mode === "web" ? (
            <label className="field">
              公开网页地址
              <input
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <small>
                提取网页正文；需要登录或由脚本动态加载的内容可改用文本导入。
              </small>
            </label>
          ) : (
            <label className="field">
              资料正文
              <textarea
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
            />{" "}
            我有权将这份资料用于当前知识库
          </label>
        </Modal>
      )}
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} wide>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              maxHeight: "60vh",
              overflow: "auto",
            }}
          >
            {preview.text}
          </pre>
        </Modal>
      )}
      {remove && (
        <Modal
          title="移除文档"
          onClose={() => setRemove(null)}
          footer={
            <DeleteButton
              confirmation="commit"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                const ok = await action(() =>
                  post(`/admin/knowledge/${id}/documents/${remove.id}/action`, {
                    expected_version: q.data.version,
                    action: "remove",
                  }),
                );
                if (ok) setRemove(null);
                return ok;
              }}
            >
              确认移除
            </DeleteButton>
          }
        >
          <p>
            从当前知识库移除「{remove.name}
            」及其检索片段。已有运行保留原来的引用记录。
          </p>
        </Modal>
      )}
    </section>
  );
}
