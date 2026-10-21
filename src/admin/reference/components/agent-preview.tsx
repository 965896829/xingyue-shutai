"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, CirclePlay, Square, CheckCircle2 } from "lucide-react";
import { api, post, type DataRecord, formatTime } from "@reference/lib/api";
import { Spinner, ErrorState, useToast, Status } from "./ui";
import { ToolApprovals } from "./agent-extensions";
import { RefTabs, RefEmpty } from "./reference-ui";

export function AgentPreview({
  record,
  onChanged,
}: {
  record?: DataRecord;
  onChanged: (r: DataRecord) => void;
}) {
  const [instruction, setInstruction] = useState(""),
    [runId, setRunId] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("回答"),
    toast = useToast();
  const readiness = useQuery({
    queryKey: ["agent-readiness", record?.id, record?.version],
    queryFn: () => api(`/admin/agents/${record!.id}/readiness`),
    enabled: !!record,
  });
  const run = useQuery({
    queryKey: ["agent-preview", runId],
    queryFn: () => api(`/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) =>
      q.state.data && ["queued", "running"].includes(q.state.data.state)
        ? 1000
        : false,
  });
  const running = ["queued", "running"].includes(run.data?.state);
  const trace = useQuery({
    queryKey: ["agent-trace", runId, run.data?.state],
    queryFn: () => api(`/runs/${runId}/trace`),
    enabled: !!runId,
    refetchInterval: running ? 1000 : false,
  });
  const artifacts = useQuery({
    queryKey: ["agent-preview-artifacts", runId, run.data?.state],
    queryFn: () => api(`/projects/${run.data.project_id}/artifacts`),
    enabled: !!run.data?.project_id && !running,
  });
  async function start() {
    if (!record) return;
    setBusy(true);
    try {
      const r = await post(`/admin/records/agents/${record.id}/actions/test`, {
        expected_version: record.version,
        values: { instruction },
      });
      setRunId(r.result.run_id);
      setTab("回答");
      onChanged(r.record || { ...record, version: record.version + 1 });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      await post(`/runs/${runId}/cancel`, {});
      await run.refetch();
      toast("已请求停止，已完成的调用仍按实际用量结算");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ref-agent-preview">
      {record && (
        <div className="ref-agent-readiness">
          {readiness.isPending ? (
            <small>正在检查运行配置…</small>
          ) : readiness.error ? (
            <ErrorState error={readiness.error} />
          ) : (
            <>
              <strong>
                <CheckCircle2 size={14} />
                {readiness.data.ready
                  ? readiness.data.environment === "sandbox"
                    ? "沙箱可测试"
                    : "配置检查通过"
                  : "配置需要处理"}
              </strong>
              <p>{readiness.data.message}</p>
              <small>
                {readiness.data.agent_count} 个智能体 ·{" "}
                {readiness.data.tool_count} 个已授权工具
              </small>
              {readiness.data.issues.map((item: any, index: number) => (
                <p
                  className={item.level === "error" ? "error" : "muted"}
                  key={index}
                >
                  {item.message}
                </p>
              ))}
            </>
          )}
        </div>
      )}
      {runId && (
        <RefTabs
          tabs={["回答", "调用过程", "算力"]}
          value={tab}
          onChange={setTab}
        />
      )}
      <div className="ref-preview-output">
        {!runId ? (
          <>
            <Bot size={44} strokeWidth={1.4} />
            <p>
              {record
                ? "输入测试内容，运行已保存的智能体"
                : "保存智能体后，即可在此预览与调试"}
            </p>
          </>
        ) : run.error ? (
          <ErrorState error={run.error} />
        ) : run.isPending ? (
          <Spinner />
        ) : (
          <div className="ref-preview-result">
            <div className="ref-trace-status">
              <Status value={run.data.state} />
              {running && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={cancel}
                >
                  <Square size={12} />
                  停止运行
                </button>
              )}
            </div>
            {run.data.error && <p className="ref-notice">{run.data.error}</p>}
            {tab === "回答" &&
              (artifacts.error ? (
                <ErrorState error={artifacts.error} />
              ) : (
                <>
                  {artifacts.data?.items
                    .filter((a: any) => a.meta?.run_id === runId)
                    .map((a: any) => (
                      <pre key={a.id}>{a.text}</pre>
                    ))}
                  {running && (
                    <p className="muted">
                      正在执行，可在「调用过程」查看进度。
                    </p>
                  )}
                </>
              ))}
            {tab === "调用过程" &&
              (trace.error ? (
                <ErrorState error={trace.error} />
              ) : trace.isPending ? (
                <Spinner />
              ) : trace.data?.items.length ? (
                <ol className="ref-trace-list">
                  {trace.data.items.map((step: any) => (
                    <li key={step.id}>
                      <div>
                        <strong>
                          {step.kind === "model" ? "模型" : "工具"} ·{" "}
                          {step.kind === "model" ? step.model : step.tool}
                        </strong>
                        <Status value={step.status} />
                      </div>
                      <small>
                        {formatTime(step.created_at)} · {step.latency_ms ?? "—"}{" "}
                        ms
                        {step.agent_path?.length > 1
                          ? ` · 子智能体第 ${step.agent_path.length} 层`
                          : ""}
                      </small>
                      {step.kind === "model" && (
                        <p>
                          {step.input_tokens ?? "—"} 输入 /{" "}
                          {step.output_tokens ?? "—"} 输出 Token ·{" "}
                          {step.cost_credits ?? "—"} 算力
                          {step.simulated ? " · 沙箱" : ""}
                        </p>
                      )}
                      {step.error && <p>{step.error}</p>}
                      {step.details_hidden ? (
                        <small>此智能体已隐藏工具详情</small>
                      ) : (
                        step.kind === "tool" &&
                        (step.arguments || step.result) && (
                          <details>
                            <summary>输入与结果</summary>
                            <pre>
                              {JSON.stringify(
                                { input: step.arguments, result: step.result },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        )
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <RefEmpty text="等待第一步调用" />
              ))}
            {tab === "算力" &&
              (trace.error ? (
                <ErrorState error={trace.error} />
              ) : (
                trace.data && (
                  <>
                    <dl className="detail-list">
                      <div>
                        <dt>本次预算上限</dt>
                        <dd>{trace.data.budget}</dd>
                      </div>
                      <div>
                        <dt>已知调用费用</dt>
                        <dd>{trace.data.known_cost}</dd>
                      </div>
                      <div>
                        <dt>已结算算力</dt>
                        <dd>{trace.data.actual_cost}</dd>
                      </div>
                      <div>
                        <dt>输入 / 输出 Token</dt>
                        <dd>
                          {trace.data.input_tokens} / {trace.data.output_tokens}
                        </dd>
                      </div>
                      <div>
                        <dt>模型 / 工具调用</dt>
                        <dd>
                          {
                            trace.data.items.filter(
                              (s: any) => s.kind === "model",
                            ).length
                          }{" "}
                          /{" "}
                          {
                            trace.data.items.filter(
                              (s: any) => s.kind === "tool",
                            ).length
                          }
                        </dd>
                      </div>
                      <div>
                        <dt>账本记录</dt>
                        <dd>{trace.data.ledger_id || "尚未扣费"}</dd>
                      </div>
                    </dl>
                    <p className="ref-field-help">
                      {trace.data.pending_reconciliation
                        ? "存在费用待核对的调用，预算继续预留，不会自动重复请求。"
                        : "沙箱不扣费。真实模型逐次记录用量，主智能体与子智能体合计受本次预算限制。"}
                    </p>
                  </>
                )
              ))}
          </div>
        )}
      </div>
      {runId && (
        <ToolApprovals
          runId={runId}
          budget={run.data?.budget || 100}
          onContinue={(id) => {
            setRunId(id);
            setTab("回答");
          }}
        />
      )}
      {record && (
        <div className="ref-preview-composer">
          <textarea
            aria-label="测试内容"
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="输入本次测试内容…"
          />
          <div>
            <small>使用已保存版本 · 预算 {record.data.budget || 100}</small>
            <button
              className="button primary"
              disabled={busy || running || !readiness.data?.ready}
              onClick={start}
            >
              <CirclePlay size={14} />
              运行测试
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
