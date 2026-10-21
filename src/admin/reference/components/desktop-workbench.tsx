"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppWindow, File, Folder, RefreshCw, Tags } from "lucide-react";
import { api, post } from "@reference/lib/api";
import { ErrorState, Spinner, useToast } from "./ui";
import { CompactHeading, Modal, RefEmpty, SearchBox } from "./reference-ui";
import { DeleteButton } from "./interaction/delete-button";
import "./desktop-workbench.css";

type Release = {
  id: string;
  version: string;
  revision: number;
  status: string;
  title: string;
  kind: string;
  release_notes: string;
  reject_reason: string;
  manifest: Record<string, unknown>;
  package_size: number;
  package_hash: string;
  file_paths: string[];
};
type WorkbenchApp = {
  id: string;
  app_id: string;
  owner_id: string;
  revision: number;
  title: string;
  description: string;
  kind: string;
  listed: boolean;
  category: string;
  versions: Release[];
};
type Category = { id: string; name: string; revision: number };
type Data = { items: WorkbenchApp[]; categories: Category[] };
const root = "/admin/desktop-workbench-store";
const statuses: Record<string, string> = {
  pending_review: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  unlisted: "已下架",
};
const pathFor = (app: string, version?: string) =>
  `${root}/items/${encodeURIComponent(app)}${version ? `/versions/${encodeURIComponent(version)}` : ""}`;
const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });

export function DesktopWorkbench() {
  const toast = useToast();
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [categoryOpen, setCategoryOpen] = useState(false),
    [categoryName, setCategoryName] = useState(""),
    [deleting, setDeleting] = useState<Category | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [reject, setReject] = useState<{ app: string; release: Release } | null>(
      null,
    ),
    [reason, setReason] = useState("");
  const pending = useRef(false);
  const query = useQuery<Data>({
    queryKey: ["desktop-workbench", search, status],
    queryFn: () =>
      api(`${root}/items?${new URLSearchParams({ q: search, status })}`),
  });
  async function run(
    action: () => Promise<unknown>,
    message: string,
    done?: () => void,
  ) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      await action();
      done?.();
      toast(message);
      await query.refetch();
      return true;
    } catch (error) {
      toast((error as Error).message, true);
      await query.refetch();
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const data = query.data;
  const opened = data?.items.find((app) => app.app_id === detail);
  return (
    <section className="desktop-workbench-page">
      <CompactHeading
        title="工作台应用管理"
        description="审核发布版本并管理应用上架状态"
        actions={
          <button
            className="button secondary"
            disabled={busy || query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={15} />
            刷新
          </button>
        }
      />
      <div className="workbench-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="搜索应用" />
        <select
          value={status}
          aria-label="审核状态"
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">全部状态</option>
          <option value="pending_review">待审核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已拒绝</option>
        </select>
        <button
          className="button secondary"
          onClick={() => setCategoryOpen(true)}
        >
          <Tags size={15} />
          分类管理
        </button>
      </div>
      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !data?.items.length ? (
        <RefEmpty text="暂无工作台应用" />
      ) : (
        <div className="workbench-apps">
          {data.items.map((app) => (
            <article className="workbench-app" key={app.id}>
              <header>
                <div className="workbench-app-identity">
                  <span className="workbench-app-icon">
                    <AppWindow size={24} />
                  </span>
                  <div>
                    <h2>{app.title}</h2>
                    <p>{app.description || "暂无描述"}</p>
                    <small>
                      发布者：{app.owner_id} ·{" "}
                      {app.kind === "external-url" ? "公网 URL" : "本地应用"} ·{" "}
                      {app.category || "未分类"}
                    </small>
                  </div>
                </div>
                <div className="ref-actions">
                  <select
                    aria-label={`${app.title} 应用分类`}
                    value={app.category}
                    disabled={busy}
                    onChange={(event) =>
                      void run(
                        () =>
                          patch(`${pathFor(app.app_id)}/category`, {
                            category: event.target.value,
                            expected_version: app.revision,
                          }),
                        event.target.value
                          ? `已将应用归入「${event.target.value}」`
                          : "已将应用设为未分类",
                      )
                    }
                  >
                    <option value="">未分类</option>
                    {app.category &&
                      !data.categories.some(
                        (category) => category.name === app.category,
                      ) && (
                        <option value={app.category}>
                          {app.category}（当前）
                        </option>
                      )}
                    {data.categories.map((category) => (
                      <option value={category.name} key={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary"
                    onClick={() => setDetail(app.app_id)}
                  >
                    版本详情
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          patch(`${pathFor(app.app_id)}/visibility`, {
                            listed: !app.listed,
                            expected_version: app.revision,
                          }),
                        app.listed ? "应用已下架" : "应用已上架",
                      )
                    }
                  >
                    {app.listed ? "下架应用" : "上架应用"}
                  </button>
                </div>
              </header>
              <div className="workbench-releases">
                {app.versions.map((release) => (
                  <div className="workbench-release" key={release.id}>
                    <p>
                      <strong>v{release.version}</strong>
                      <span>·</span>
                      <span className={`workbench-status is-${release.status}`}>
                        {statuses[release.status] || release.status}
                      </span>
                      <span>·</span>
                      <span>{release.release_notes || "无更新说明"}</span>
                    </p>
                    <div className="ref-actions">
                      {release.status === "pending_review" && (
                        <>
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  patch(
                                    `${pathFor(app.app_id, release.version)}/review`,
                                    {
                                      status: "approved",
                                      expected_version: release.revision,
                                    },
                                  ),
                                "版本已通过审核",
                              )
                            }
                          >
                            通过
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => {
                              setReject({ app: app.app_id, release });
                              setReason("");
                            }}
                          >
                            拒绝
                          </button>
                        </>
                      )}
                      {["approved", "unlisted"].includes(release.status) && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                patch(
                                  `${pathFor(app.app_id, release.version)}/visibility`,
                                  {
                                    listed: release.status === "unlisted",
                                    expected_version: release.revision,
                                  },
                                ),
                              release.status === "unlisted"
                                ? "版本已重新上架"
                                : "版本已下架",
                            )
                          }
                        >
                          {release.status === "unlisted"
                            ? "重新上架"
                            : "下架版本"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {categoryOpen && (
        <Modal title="分类管理" onClose={() => !busy && setCategoryOpen(false)}>
          <p className="workbench-help">
            新建分类后，可在应用列表中为每个应用选择分类。删除分类后，相关应用将变为未分类。
          </p>
          <form
            className="workbench-category-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (categoryName.trim())
                void run(
                  () =>
                    post(`${root}/categories`, { name: categoryName.trim() }),
                  "分类已添加",
                  () => setCategoryName(""),
                );
            }}
          >
            <input
              aria-label="新分类名称"
              placeholder="输入新分类名称"
              maxLength={80}
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              disabled={busy}
            />
            <button
              className="button primary"
              disabled={busy || !categoryName.trim()}
            >
              添加
            </button>
          </form>
          {!data?.categories.length ? (
            <RefEmpty text="暂无分类，请先添加" />
          ) : (
            <div className="workbench-category-list">
              <h3>已有分类</h3>
              {data.categories.map((category) => (
                <div key={category.id}>
                  <span>{category.name}</span>
                  <DeleteButton
                    confirmation="dialog"
                    className="button danger small"
                    disabled={busy}
                    aria-label={`删除分类 ${category.name}`}
                    onClick={() => setDeleting(category)}
                  >
                    删除
                  </DeleteButton>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      {deleting && (
        <Modal
          title="删除分类"
          onClose={() => !busy && setDeleting(null)}
          footer={
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                取消
              </button>
              <DeleteButton
                confirmation="commit"
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(
                    () =>
                      api(
                        `${root}/categories/${deleting.id}?expected_version=${deleting.revision}`,
                        { method: "DELETE" },
                      ),
                    "分类已删除，相关应用已设为未分类",
                    () => setDeleting(null),
                  );
                  if (!ok) throw new Error("分类未删除，请刷新后重试");
                }}
              >
                删除
              </DeleteButton>
            </>
          }
        >
          <p>使用该分类的应用将变为未分类。</p>
          <p className="workbench-help">{deleting.name}</p>
        </Modal>
      )}
      {reject && (
        <Modal
          title="拒绝版本"
          onClose={() => !busy && setReject(null)}
          footer={
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setReject(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(
                    () =>
                      patch(
                        `${pathFor(reject.app, reject.release.version)}/review`,
                        {
                          status: "rejected",
                          reject_reason: reason.trim(),
                          expected_version: reject.release.revision,
                        },
                      ),
                    "版本已拒绝",
                    () => setReject(null),
                  )
                }
              >
                确定
              </button>
            </>
          }
        >
          <textarea
            className="workbench-reject"
            aria-label="拒绝原因"
            rows={4}
            maxLength={2000}
            placeholder="说明拒绝原因，发布者可在我的发布中查看"
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </Modal>
      )}
      {detail && (
        <Modal title="版本详情" wide onClose={() => setDetail(null)}>
          {opened ? (
            opened.versions.map((release) => (
              <section className="workbench-version-detail" key={release.id}>
                <h3>
                  v{release.version}
                  <span className={`workbench-status is-${release.status}`}>
                    {statuses[release.status] || release.status}
                  </span>
                </h3>
                <p>{release.release_notes || "无更新说明"}</p>
                {release.reject_reason && (
                  <p className="workbench-rejection">
                    拒绝原因：{release.reject_reason}
                  </p>
                )}
                <p className="workbench-package">
                  ZIP 发行包 {release.package_size ?? 0} 字节 · SHA-256{" "}
                  {release.package_hash || "无本地安装包"}
                </p>
                <div className="workbench-files">
                  <strong>安装文件（{release.file_paths?.length ?? 0}）</strong>
                  {release.file_paths?.length ? (
                    <FileTree paths={release.file_paths} />
                  ) : (
                    <p>公网 URL 接入，无需下载安装文件</p>
                  )}
                </div>
                <pre>{JSON.stringify(release.manifest, null, 2)}</pre>
              </section>
            ))
          ) : (
            <RefEmpty text="应用列表已变化，请关闭后刷新" />
          )}
        </Modal>
      )}
    </section>
  );
}

type Branch = { children: Map<string, Branch>; file: boolean };
function FileTree({ paths }: { paths: string[] }) {
  const tree: Branch = { children: new Map(), file: false };
  for (const path of paths) {
    let branch = tree;
    for (const segment of path.split("/")) {
      if (!branch.children.has(segment))
        branch.children.set(segment, { children: new Map(), file: false });
      branch = branch.children.get(segment)!;
    }
    branch.file = true;
  }
  function nodes(branch: Branch, depth = 0) {
    return (
      <ul>
        {[...branch.children].map(([name, next]) => (
          <li key={name}>
            {next.children.size ? (
              <details open={depth === 0}>
                <summary>
                  <Folder size={14} />
                  {name}
                </summary>
                {nodes(next, depth + 1)}
              </details>
            ) : (
              <span>
                <File size={14} />
                {name}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return <div className="workbench-file-tree">{nodes(tree)}</div>;
}
