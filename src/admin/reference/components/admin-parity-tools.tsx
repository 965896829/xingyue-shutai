"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, put, type DataRecord, formatTime, label } from "@reference/lib/api";
import { Modal, SearchBox, RefEmpty } from "./reference-ui";
import { Spinner, ErrorState, useToast } from "./ui";

export function BaseCatalogActions({ refresh }: { refresh: () => void }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    toast = useToast();
  const q = useQuery({
    queryKey: ["base-model-catalog"],
    queryFn: () => api("/admin/base-models/catalog"),
    enabled: open,
  });
  return (
    <>
      <button
        className="button secondary"
        onClick={async () => {
          setOpen(true);
          const result = await q.refetch();
          if (result.data)
            setSelected(
              result.data.items
                .filter((r: any) => r.default)
                .map((r: any) => r.id),
            );
        }}
      >
        重置所有模型
      </button>
      {open && (
        <Modal
          title="基础模型目录"
          onClose={() => setOpen(false)}
          wide
          footer={
            <button
              className="button primary"
              disabled={busy || !selected.length || reason.trim().length < 2}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("/admin/base-models/reset", {
                    entries: q.data.items
                      .filter((r: any) => selected.includes(r.id))
                      .map((r: any) => ({ id: r.id, version: r.version })),
                    reason,
                  });
                  refresh();
                  q.refetch();
                  setSelected([]);
                  toast("所选基础模型已恢复默认值");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              重置所选（{selected.length}）
            </button>
          }
        >
          <p className="ref-description">
            目录版本 {q.data?.version}
            。内置模型使用随系统发布的目录，自建模型使用首次保存的默认快照。接入平台的模型参数可通过单个基础模型的“同步”更新。
          </p>
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            <>
              <button
                className="text-button"
                onClick={() =>
                  setSelected(
                    q.data.items
                      .filter((r: any) => r.default)
                      .map((r: any) => r.id),
                  )
                }
              >
                选择全部可重置模型
              </button>
              <div className="ref-picker">
                {q.data.items.map((r: any) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      disabled={!r.default}
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked
                            ? [...v, r.id]
                            : v.filter((i) => i !== r.id),
                        )
                      }
                    />
                    {r.name} ·{" "}
                    {r.changed
                      ? "与默认值不同"
                      : r.default
                        ? "已是默认值"
                        : "尚无默认快照"}
                  </label>
                ))}
              </div>
            </>
          )}
          <label className="field">
            重置原因
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </Modal>
      )}
    </>
  );
}

export function PlatformIntegrationDownload() {
  return (
    <button
      className="button secondary"
      disabled title="平台接入包下载服务尚未接入"
    >
      下载接入 SKILL · 尚未接入
    </button>
  );
}

export function DesktopCategories({ refresh }: { refresh: () => void }) {
  const [open, setOpen] = useState(false),
    [edit, setEdit] = useState<any>(null),
    [busy, setBusy] = useState(false),
    toast = useToast();
  const q = useQuery({
    queryKey: ["desktop-categories"],
    queryFn: () => api("/admin/desktop/categories"),
    enabled: open,
  });
  return (
    <>
      <button className="button secondary" onClick={() => setOpen(true)}>
        分类管理
      </button>
      {open && (
        <Modal title="技能分类管理" onClose={() => setOpen(false)} wide>
          <button
            className="button primary"
            onClick={() =>
              setEdit({
                id: "new",
                name: "",
                description: "",
                sort: 0,
                expected_version: 0,
              })
            }
          >
            添加分类
          </button>
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            q.data.items.map((c: any) => (
              <div className="ref-toolbar" key={c.id}>
                <strong>{c.name}</strong>
                <span>{c.data.description}</span>
                <small>排序 {c.data.sort}</small>
                <button
                  className="text-button"
                  onClick={() =>
                    setEdit({
                      id: c.id,
                      name: c.name,
                      ...c.data,
                      expected_version: c.version,
                    })
                  }
                >
                  编辑
                </button>
                <DeleteButton
                  confirmation="inline"
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(
                        `/admin/desktop/categories/${c.id}?expected_version=${c.version}`,
                        { method: "DELETE" },
                      );
                      q.refetch();
                      refresh();
                    } catch (e) {
                      toast((e as Error).message, true);
                      return false;
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  删除空分类
                </DeleteButton>
              </div>
            ))
          )}
          {edit && (
            <form
              className="ref-settings-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const { id, ...body } = edit;
                  await put(`/admin/desktop/categories/${id}`, body);
                  setEdit(null);
                  q.refetch();
                  refresh();
                } catch (ex) {
                  toast((ex as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                分类名称
                <input
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <label className="field">
                描述
                <input
                  value={edit.description}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                />
              </label>
              <label className="field">
                排序
                <input
                  type="number"
                  min={0}
                  value={edit.sort}
                  onChange={(e) =>
                    setEdit({ ...edit, sort: Number(e.target.value) })
                  }
                />
              </label>
              <button className="button primary" disabled={busy}>
                保存分类
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function ResourceHistory({ record }: { record: DataRecord }) {
  const q = useQuery({
    queryKey: ["admin-resource-history", record.id, record.version],
    queryFn: () => api(`/admin/resources/${record.id}/history`),
  });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <section>
      <h3>版本与发布历史</h3>
      {record.data.file_id && (
        <a
          className="button secondary"
          href={`/api/v1/desktop/skills/${record.id}/download`}
          download
        >
          下载已发布技能
        </a>
      )}
      {record.data.category && (
        <p>
          下载 {q.data.downloads} 次 · 分类 {record.data.category}
        </p>
      )}
      {q.data.items.length ? (
        q.data.items.map((r: any, i: number) => {
          const next =
            i === 0 ? q.data.current.data : q.data.items[i - 1].data.snapshot;
          const before = r.data.snapshot;
          const changed = [
            ...new Set([...Object.keys(before), ...Object.keys(next)]),
          ].filter(
            (k) =>
              !k.startsWith("_") &&
              JSON.stringify(before[k]) !== JSON.stringify(next[k]),
          );
          return (
            <details key={r.id}>
              <summary>
                v{r.data.version} · {label(r.data.status)} · {r.data.action} ·{" "}
                {formatTime(r.created_at)}
              </summary>
              {changed.length ? (
                changed.map((k) => (
                  <div className="ref-notice" key={k}>
                    <strong>{k}</strong>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      原值：{label(before[k])}
                      {"\n"}后值：{label(next[k])}
                    </pre>
                  </div>
                ))
              ) : (
                <p>内容未变化，记录了状态操作。</p>
              )}
            </details>
          );
        })
      ) : (
        <RefEmpty text="当前为首个版本；之后的编辑、上传和发布操作会保留历史。" />
      )}
    </section>
  );
}

export function BrandImageUpload({
  kind,
  onChange,
}: {
  kind: string;
  onChange: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    toast = useToast();
  return (
    <label className="button secondary">
      {busy ? "上传中…" : "上传图片"}
      <input
        className="file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const body = new FormData();
            body.append("file", file);
            const r = await api(`/admin/brand-assets?kind=${kind}`, {
              method: "POST",
              body,
            });
            onChange(r.url);
          } catch (ex) {
            toast((ex as Error).message, true);
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </label>
  );
}

export function ProcessLogs() {
  const [source, setSource] = useState("service.log"),
    [auto, setAuto] = useState(true),
    [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["process-logs", source],
    queryFn: () =>
      api(
        `/admin/system/process-logs?source=${encodeURIComponent(source)}&lines=500`,
      ),
    refetchInterval: auto ? 3000 : false,
  });
  return (
    <div className="ref-page">
      <div className="ref-toolbar">
        <select
          aria-label="日志来源"
          value={q.data?.source || source}
          onChange={(e) => setSource(e.target.value)}
        >
          {(q.data?.sources || ["service.log"]).map((s: string) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="搜索当前日志…"
        />
        <label>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          自动刷新
        </label>
        <button className="button secondary" onClick={() => q.refetch()}>
          刷新
        </button>
      </div>
      <p className="ref-description">
        读取后端进程日志，常见凭据字段已遮盖。服务日志每 5 MB
        轮转，保留三份历史。
      </p>
      <div className="ref-log-console">
        {q.isPending ? (
          <Spinner />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          q.data.lines
            .filter((line: string) =>
              line.toLowerCase().includes(search.toLowerCase()),
            )
            .map((line: string, i: number) => (
              <pre key={i} style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {line}
              </pre>
            ))
        )}
      </div>
      {q.data?.truncated && (
        <p className="ref-field-help">
          显示最近 500 行；较早记录保留在日志文件中。
        </p>
      )}
    </div>
  );
}
