"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, recordCollection } from "@reference/lib/api";
import { ErrorState, Status, useToast } from "./ui";
import { RunRecovery } from "./studio/run-recovery";

export function KnowledgeRetrieval({ id }: { id: string }) {
  const toast = useToast(),
    [project, setProject] = useState(""),
    [budget, setBudget] = useState(100),
    [query, setQuery] = useState(""),
    [runId, setRunId] = useState(""),
    [busy, setBusy] = useState(false),
    [remoteResult, setRemoteResult] = useState<any>(null);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api("/projects"),
  });
  const record = useQuery({
    queryKey: ["knowledge-retrieval", id],
    queryFn: async () => {
      const r = await recordCollection("knowledge");
      return r.items.find((x: any) => x.id === id);
    },
  });
  const run = useQuery({
    queryKey: ["knowledge-run", runId],
    queryFn: () => api(`/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.state) ? 1500 : false,
  });
  const result = useQuery({
    queryKey: ["knowledge-report", runId, run.data?.state],
    queryFn: async () => {
      const r = await api(`/projects/${run.data.project_id}/artifacts`);
      const a = r.items.find((x: any) => x.id === run.data.result.artifact_id);
      return a ? JSON.parse(a.text) : null;
    },
    enabled: !!run.data?.result?.artifact_id,
  });
  async function start(operation: string) {
    setBusy(true);
    try {
      const fresh = await record.refetch();
      if (!fresh.data) throw new Error("知识库未找到，请刷新页面");
      const r = await post(`/admin/knowledge/${id}/semantic/${operation}`, {
        project_id: project,
        expected_version: fresh.data.version,
        budget,
        query,
      });
      setRunId(r.id);
      toast("任务已排队，可查看进度与实际用量");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (record.data?.data.service_id)
    return (
      <details className="pw-card">
        <summary>外部知识库检索测试</summary>
        <p>
          {record.data.data.external_environment === "sandbox"
            ? "沙箱知识库：验证本地资料处理和检索流程。"
            : "使用已配置的知识服务检索已完成处理的文档。"}
        </p>
        <div className="ref-toolbar">
          <input
            aria-label="知识检索内容"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入查询内容…"
          />
          <button
            className="button primary"
            disabled={busy || !query.trim()}
            onClick={async () => {
              setBusy(true);
              setRemoteResult(null);
              try {
                setRemoteResult(
                  await post(`/admin/knowledge/${id}/search`, {
                    query,
                    top_k: 5,
                  }),
                );
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            检索测试
          </button>
        </div>
        {remoteResult &&
          (remoteResult.items.length ? (
            remoteResult.items.map((item: any) => (
              <article className="pw-card" key={item.id}>
                <small>相关度 {item.score}</small>
                <p>{item.text}</p>
              </article>
            ))
          ) : (
            <p>没有找到相关资料。</p>
          ))}
      </details>
    );
  return (
    <details className="pw-card">
      <summary>语义索引与重排测试</summary>
      <p>
        在知识库编辑页选择嵌入模型、可选重排模型和助手检索方式。模型须先在「三方
        API 接入」启用对应能力。资料变化后需重建语义索引；沙箱输出会明确标识。
      </p>
      <div className="ref-form two-columns">
        <label className="field">
          费用归属作品
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">选择你的作品</option>
            {projects.data?.items.map((p: any) => (
              <option value={p.id} key={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          本次算力上限
          <input
            type="number"
            min={1}
            max={100000}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="ref-field-help">
        索引和检索共享这本作品的预算与账户余额，逐次记录费用。已完成批次保存检查点；供应商受理不明时停止，等待费用核对。
      </p>
      <div className="ref-toolbar">
        <button
          className="button secondary"
          disabled={
            busy || !project || ["queued", "running"].includes(run.data?.state)
          }
          onClick={() => start("index")}
        >
          生成语义索引
        </button>
        <input
          aria-label="语义检索内容"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入语义查询…"
        />
        <button
          className="button primary"
          disabled={
            busy ||
            !project ||
            !query.trim() ||
            ["queued", "running"].includes(run.data?.state)
          }
          onClick={() => start("search")}
        >
          语义检索与重排
        </button>
      </div>
      {record.error && <ErrorState error={record.error} />}{" "}
      {run.error && <ErrorState error={run.error} />}{" "}
      {run.data && (
        <div className="ref-notice">
          <Status value={run.data.state} /> · 已结算 {run.data.actual_cost} 算力{" "}
          {run.data.result?.completed_chunks !== undefined && (
            <span>
              {" "}
              · {run.data.result.completed_chunks}/
              {run.data.result.total_chunks} 个片段
            </span>
          )}
          {run.data.error && <p>{run.data.error}</p>}
          <RunRecovery run={run.data} onResumed={setRunId} />
        </div>
      )}
      {result.error && <ErrorState error={result.error} />}{" "}
      {result.data && (
        <div>
          {result.data.items ? (
            result.data.items.map((item: any) => (
              <article className="pw-card" key={item.id}>
                <small>
                  {item.retrieval_mode} · {item.reranked ? "已重排 · " : ""}
                  相关度 {item.score}
                </small>
                <p>{item.text}</p>
              </article>
            ))
          ) : (
            <p>
              {result.data.simulated
                ? "沙箱索引已完成，仅验证流程；尚不是真实语义向量。"
                : "语义索引已完成。"}{" "}
              共 {result.data.chunks} 个片段，{result.data.dimensions} 维。
            </p>
          )}
        </div>
      )}
    </details>
  );
}
