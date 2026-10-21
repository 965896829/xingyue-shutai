"use client";
import { DeleteButton } from "./interaction/delete-button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, put } from "@reference/lib/api";
import { Modal, RefTabs, RefEmpty, RefPagination } from "./reference-ui";
import { Spinner, ErrorState, useToast, Status } from "./ui";

export function AgentRuntimePanel({ onClose }: { onClose: () => void }) {
  const q = useQuery({
    queryKey: ["agent-runtime"],
    queryFn: () => api("/admin/agents/runtime"),
    refetchInterval: (q) =>
      q.state.data?.builds?.some((b: any) =>
        ["queued", "running"].includes(b.status),
      )
        ? 3000
        : false,
  });
  const [tab, setTab] = useState("Python"),
    [edit, setEdit] = useState(false),
    [requirements, setRequirements] = useState({ python: "", javascript: "" }),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState('print("sandbox ready")'),
    [output, setOutput] = useState(""),
    [envKey, setEnvKey] = useState("APP_"),
    [envValue, setEnvValue] = useState(""),
    [notebook, setNotebook] = useState<any>(null),
    toast = useToast();
  async function act(fn: () => Promise<any>, message: string) {
    setBusy(true);
    try {
      const result = await fn();
      await q.refetch();
      toast(message);
      return result;
    } catch (e) {
      toast((e as Error).message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function modify() {
    setRequirements({
      python: (q.data.requirements.python || []).join("\n"),
      javascript: (q.data.requirements.javascript || []).join("\n"),
    });
    setEdit(true);
  }
  const [language, setLanguage] = useState("python"),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10);
  const packages = q.data?.packages?.filter((p: any) => p.type === tab) || [];
  const direct = new Set(
    (tab === "Python"
      ? q.data?.requirements.python
      : q.data?.requirements.javascript || []
    )?.map((p: string) =>
      tab === "Python"
        ? p.split("==")[0].toLowerCase().replaceAll("_", "-")
        : p.substring(0, p.lastIndexOf("@")),
    ) || [],
  );
  const removable = (p: any) =>
    direct.has(p.name.toLowerCase().replaceAll("_", "-")) &&
    p.name.toLowerCase() !== "jupyterlab";
  return (
    <Modal title="脚本沙箱环境管理" onClose={onClose} wide>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          <div className="ref-runtime-versions">
            <span>Python：{q.data.python || "未初始化"}</span>
            <span>Node：{q.data.node || "未初始化"}</span>
          </div>
          <RefTabs
            tabs={["Python", "JavaScript", "环境变量", "脚本测试", "构建记录"]}
            value={tab}
            onChange={(t) => {
              setTab(t);
              setSelected([]);
              setPage(1);
            }}
          />
          <p className="ref-notice">{q.data.message}</p>
          <div className="ref-toolbar">
            <button className="button primary" disabled={busy} onClick={modify}>
              {q.data.sandbox_connected ? "安装依赖" : "初始化独立环境"}
            </button>
            <button
              className="button secondary"
              disabled={busy || !selected.length}
              onClick={() =>
                act(
                  () =>
                    post("/admin/agents/runtime/builds", {
                      expected_version: q.data.version,
                      python: q.data.requirements.python.filter(
                        (p: string) => !selected.includes(p.split("==")[0]),
                      ),
                      javascript: q.data.requirements.javascript.filter(
                        (p: string) =>
                          !selected.includes(
                            p.substring(0, p.lastIndexOf("@")),
                          ),
                      ),
                    }),
                  "已提交卸载后的环境构建",
                )
              }
            >
              批量卸载
            </button>
            <button
              className="button secondary"
              disabled={busy || !q.data.sandbox_connected}
              onClick={() =>
                act(async () => {
                  const r = await post("/admin/agents/runtime/notebook");
                  setNotebook(r);
                  return r;
                }, "Jupyter 已启动，仅监听本机地址")
              }
            >
              通过 Jupyter 管理
            </button>
          </div>
          {["Python", "JavaScript"].includes(tab) && (
            <div className="ref-table-wrap">
              <table className="ref-table">
                <thead>
                  <tr>
                    <th>选择</th>
                    <th>包名</th>
                    <th>版本</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.length ? (
                    packages
                      .slice((page - 1) * size, page * size)
                      .map((p: any) => (
                        <tr key={p.name}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`选择 ${p.name}`}
                              disabled={!removable(p)}
                              checked={selected.includes(p.name)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, p.name]
                                    : selected.filter((n) => n !== p.name),
                                )
                              }
                            />
                          </td>
                          <td>{p.name}</td>
                          <td>{p.version}</td>
                          <td>
                            {removable(p)
                              ? "已安装 · 可移除"
                              : "基础或间接依赖"}
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={4}>
                        <RefEmpty text="尚无独立环境的依赖清单" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <RefPagination
                page={page}
                size={size}
                total={packages.length}
                onPage={setPage}
                onSize={(s) => {
                  setSize(s);
                  setPage(1);
                }}
              />
            </div>
          )}
          {tab === "环境变量" && (
            <>
              <p>
                变量仅注入独立脚本容器，值加密保存且不回显。网站密钥不会被复制到沙箱。
              </p>
              {q.data.environment_keys.map((k: string) => (
                <div className="ref-toolbar" key={k}>
                  <code>{k}</code>
                  <span>已配置</span>
                  <DeleteButton
                    confirmation="inline"
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          put("/admin/agents/runtime/environment", {
                            expected_version: q.data.version,
                            values: {},
                            remove: [k],
                          }),
                        "变量已移除",
                      )
                    }
                  >
                    删除
                  </DeleteButton>
                </div>
              ))}
              <label className="field">
                变量名
                <input
                  value={envKey}
                  onChange={(e) => setEnvKey(e.target.value)}
                />
              </label>
              <label className="field">
                变量值
                <input
                  type="password"
                  value={envValue}
                  onChange={(e) => setEnvValue(e.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={busy || !q.data.sandbox_connected}
                onClick={() =>
                  act(async () => {
                    const r = await put("/admin/agents/runtime/environment", {
                      expected_version: q.data.version,
                      values: { [envKey]: envValue },
                      remove: [],
                    });
                    setEnvValue("");
                    return r;
                  }, "变量已保存")
                }
              >
                保存变量
              </button>
            </>
          )}
          {tab === "脚本测试" && (
            <>
              <label className="field">
                语言
                <select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    setCode(
                      e.target.value === "python"
                        ? 'print("sandbox ready")'
                        : 'console.log("sandbox ready")',
                    );
                  }}
                >
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                </select>
              </label>
              <label className="field">
                脚本
                <textarea
                  rows={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={busy || !q.data.sandbox_connected}
                onClick={() =>
                  act(async () => {
                    const r = await post("/admin/agents/runtime/execute", {
                      language: language,
                      code,
                      timeout: 10,
                    });
                    setOutput(
                      `退出码 ${r.exit_code}${r.truncated ? " · 输出截断" : ""}\n${r.output}`,
                    );
                    return r;
                  }, "脚本执行结束")
                }
              >
                运行（最多 10 秒）
              </button>
              <pre>{output}</pre>
            </>
          )}
          {tab === "构建记录" &&
            q.data.builds.map((b: any) => (
              <details className="pw-card" key={b.id}>
                <summary>
                  <Status value={b.status} /> {b.id}
                </summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{b.log}</pre>
              </details>
            ))}
          {edit && (
            <Modal
              title="安装或移除独立环境依赖"
              onClose={() => setEdit(false)}
              footer={
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const r = await post("/admin/agents/runtime/builds", {
                        expected_version: q.data.version,
                        python: requirements.python
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        javascript: requirements.javascript
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                      setEdit(false);
                      setTab("构建记录");
                      return r;
                    }, "构建任务已排队，完成后启用新镜像")
                  }
                >
                  构建并启用
                </button>
              }
            >
              <p>
                每行一个固定版本依赖。修改清单后重建镜像；保留基础 Python、Node
                和 Jupyter。构建需要访问软件包仓库。
              </p>
              <label className="field">
                Python（包名==版本）
                <textarea
                  rows={6}
                  value={requirements.python}
                  onChange={(e) =>
                    setRequirements({ ...requirements, python: e.target.value })
                  }
                />
              </label>
              <label className="field">
                JavaScript（包名@版本）
                <textarea
                  rows={6}
                  value={requirements.javascript}
                  onChange={(e) =>
                    setRequirements({
                      ...requirements,
                      javascript: e.target.value,
                    })
                  }
                />
              </label>
            </Modal>
          )}
          {notebook && (
            <div className="pw-card">
              <a href={notebook.url} target="_blank" rel="noreferrer">
                打开独立 Jupyter
              </a>
              <p>
                笔记本保存在专用容器卷。这里的试验不会修改生产应用环境；通用依赖请通过依赖清单重建。
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await api(
                      `/admin/agents/runtime/notebook/${notebook.id}`,
                      { method: "DELETE" },
                    );
                    setNotebook(null);
                    return r;
                  }, "Jupyter 已停止，笔记本保留")
                }
              >
                停止 Jupyter
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
