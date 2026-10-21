"use client";
import { useState } from "react";
import Link from "@reference/router-link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ArrowUpRight } from "lucide-react";
import { api, formatNumber } from "@reference/lib/api";
import { Spinner, ErrorState } from "./ui";
import { RefTabs, RefEmpty, CompactHeading } from "./reference-ui";
import {
  LineChart,
  BarChart,
  DonutChart,
  chartColors,
} from "./reference-charts";
import { QualityMetrics } from "./quality-metrics";
import { ConsumptionHeatmap } from "./consumption-heatmap";

export function Dashboard({ platform = false }: { platform?: boolean }) {
  return platform ? <PlatformOverview /> : <AnalyticsDashboard />;
}
function AnalyticsDashboard() {
  const [days, setDays] = useState(30),
    [interval, setInterval] = useState("day"),
    [tab, setTab] = useState("业务趋势");
  const q = useQuery({
    queryKey: ["analytics", days, interval],
    queryFn: () => api(`/admin/analytics?days=${days}&interval=${interval}`),
    refetchInterval: 30000,
  });
  const d = q.data;
  const metrics = [
    ["dau", "DAU", ""],
    ["mau", "MAU", ""],
    ["total", "已载入任务", ""],
    ["success_rate", "成功率", "%"],
    ["avg_seconds", "平均生成时长", "秒"],
    ["revenue", "收入", ""],
    ["gpu", "GPU使用率", "%"],
  ];
  return (
    <div className="ref-dashboard">
      <div className="ref-dashboard-range">
        <label>
          时间范围：
          <select
            aria-label="时间范围"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>今天</option>
            <option value={7}>最近7天</option>
            <option value={30}>最近30天</option>
            <option value={90}>最近90天</option>
          </select>
        </label>
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        <>
          <div className="ref-kpi-grid">
            {metrics.map(([key, title, unit], i) => (
              <article
                key={key}
                className="ref-kpi"
                style={{ borderLeftColor: chartColors[i % chartColors.length] }}
                title={
                  key === "avg_seconds"
                    ? d.notes.duration
                    : key === "gpu"
                      ? d.notes.gpu
                      : key === "revenue"
                        ? d.notes.revenue
                        : key === "total"
                          ? d.notes.generation
                          : undefined
                }
              >
                <span>{title}</span>
                <div>
                  <strong>
                    {d.metrics[key] === null
                      ? "—"
                      : (key === "revenue" ? "¥" : "") +
                        formatNumber(d.metrics[key])}
                    {d.metrics[key] !== null && unit && <small> {unit}</small>}
                  </strong>
                  {d.growth[key] !== undefined && d.growth[key] !== null && (
                    <em className={d.growth[key] < 0 ? "negative" : ""}>
                      {d.growth[key] > 0 ? "+" : ""}
                      {d.growth[key]}%
                    </em>
                  )}
                  {key === "gpu" && !d.gpu?.available && (
                    <small className="muted">不可用</small>
                  )}
                </div>
              </article>
            ))}
          </div>
          <RefTabs
            tabs={["业务趋势", "用户分析", "任务监控", "收入与模型"]}
            value={tab}
            onChange={setTab}
          />
          {tab === "业务趋势" && (
            <>
              <div className="ref-chart-switch">
                <button
                  className={interval === "day" ? "active" : ""}
                  onClick={() => setInterval("day")}
                >
                  按天
                </button>
                <button
                  className={interval === "hour" ? "active" : ""}
                  onClick={() => setInterval("hour")}
                >
                  按小时
                </button>
              </div>
              <LineChart
                title="生成任务趋势"
                labels={d.series.map((s: any) => s.label)}
                series={[
                  { name: "生图", values: d.series.map((s: any) => s.image) },
                  { name: "生视频", values: d.series.map((s: any) => s.video) },
                  {
                    name: "文本创作",
                    values: d.series.map((s: any) => s.text),
                  },
                  { name: "总计", values: d.series.map((s: any) => s.total) },
                ]}
              />
              <LineChart
                title="成功率趋势"
                labels={d.series.map((s: any) => s.label)}
                series={[
                  {
                    name: "成功率",
                    values: d.series.map((s: any) => s.success_rate),
                  },
                ]}
                percent
                threshold={95}
              />
              <BarChart title="模型使用偏好" items={d.models} />
            </>
          )}
          {tab === "用户分析" && (
            <>
              <div className="ref-chart-pair">
                <DonutChart
                  title="用户分布"
                  items={[
                    { name: "付费用户", value: d.users.paid },
                    { name: "免费用户", value: d.users.free },
                  ]}
                />
                <section className="ref-chart ref-user-summary">
                  <div>
                    <span>新用户</span>
                    <strong>{d.users.new}</strong>
                  </div>
                  <div>
                    <span>活跃老用户</span>
                    <strong>{d.users.returning}</strong>
                  </div>
                </section>
              </div>
              <BarChart title="功能使用分布" items={d.functions} horizontal />
              <section className="ref-chart">
                <h3>提示词云</h3>
                {d.prompt_topics?.length ? (
                  <div className="ref-topic-cloud">
                    {d.prompt_topics.map((t: any) => (
                      <span
                        key={t.name}
                        title={`${t.value} 次运行`}
                        style={{
                          fontSize: Math.min(
                            32,
                            13 + Math.log2(t.value + 1) * 4,
                          ),
                        }}
                      >
                        {t.name}
                        <small>{t.value}</small>
                      </span>
                    ))}
                  </div>
                ) : (
                  <RefEmpty text="当前区间未出现可统计的通用主题词" />
                )}
                <p className="ref-field-help">
                  只统计预设的题材与写作主题词，不展示作者原始提示、人物名称或正文。
                </p>
              </section>
            </>
          )}
          {tab === "任务监控" && (
            <>
              <p className="ref-notice">
                活动工作流 {d.workflow_capacity?.running} /{" "}
                {d.workflow_capacity?.limit}，排队 {d.workflow_capacity?.queued}
                。达到上限的任务保留预算并等待空位。
              </p>
              {d.gpu?.devices?.length > 0 && (
                <div className="ref-chart">
                  <h3>本机 GPU</h3>
                  {d.gpu.devices.map((g: any) => (
                    <p key={g.index}>
                      {g.name} · 利用率 {g.utilization ?? "—"}% · 显存{" "}
                      {g.memory_used_mb ?? "—"} / {g.memory_total_mb ?? "—"} MB
                      · 温度 {g.temperature_c ?? "—"}°C
                    </p>
                  ))}
                </div>
              )}
              <div className="ref-chart-pair">
                <DonutChart title="任务状态分布" items={d.tasks} pie />
                <BarChart
                  title="生成耗时分位"
                  items={Object.entries(d.latency)
                    .filter(([, v]) => v !== null)
                    .map(([name, value]) => ({ name, value: Number(value) }))}
                />
              </div>
              <div className="ref-latency">
                {Object.entries(d.latency).map(([key, value]) => (
                  <div key={key}>
                    <span>{key}</span>
                    <strong>
                      {value === null ? "—" : String(value)}
                      <small> 秒</small>
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "收入与模型" && (
            <>
              <ConsumptionHeatmap />
              <LineChart
                title="收入趋势"
                labels={d.series.map((s: any) => s.label)}
                series={[
                  { name: "收入", values: d.series.map((s: any) => s.revenue) },
                ]}
                currency
              />
              <BarChart title="按模型生成量" items={d.models} horizontal />
            </>
          )}
          <QualityMetrics days={days} />
          <p className="ref-data-note">
            {d.notes.generation} {d.notes.duration}
          </p>
        </>
      )}
    </div>
  );
}

function PlatformOverview() {
  const q = useQuery({
    queryKey: ["platform-summary"],
    queryFn: () => api("/admin/platform-summary"),
    refetchInterval: 30000,
  });
  const [hours, setHours] = useState(24);
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data,
    c = d.counts,
    chosen = d.calls.filter(
      (r: any) =>
        Date.now() - new Date(r.created_at).getTime() < hours * 3600000,
    ),
    counts: Record<string, number> = {};
  chosen.forEach((r: any) => {
    counts[r.model] = (counts[r.model] || 0) + 1;
  });
  const stats = [
    ["providers", "厂商", "providers"],
    ["models", "模型汇总", "models"],
    ["base-models", "基础模型", "base-models"],
    ["pricing", "定价规则", "pricing-rules"],
    ["runtime-policies", "运行策略", "runtime-policies"],
  ];
  return (
    <div className="ref-page">
      <CompactHeading
        title="API 平台总览"
        description="运行时模型、平台、策略和负载的集中视图。"
        actions={
          <button className="button secondary" onClick={() => q.refetch()}>
            <RefreshCw size={14} />
            刷新
          </button>
        }
      />
      <div className="ref-overview-stats">
        {stats.map(([key, name, path]) => (
          <Link href={`/admin/platform/${path}`} className="ref-kpi" key={key}>
            <span>{name}</span>
            <strong>{c[key] || 0}</strong>
          </Link>
        ))}
        <div className="ref-kpi">
          <span>平台模型</span>
          <strong>
            {d.platforms.reduce((s: number, p: any) => s + p.models.length, 0)}
          </strong>
        </div>
      </div>
      <div className="ref-overview-middle">
        <section className="ref-box">
          <h3>
            平台配置{" "}
            <small>
              {d.platforms.filter((p: any) => p.status === "active").length}{" "}
              个启用
            </small>
          </h3>
          <div className="ref-overview-health">
            <div>
              <span>平台总数</span>
              <strong>{d.platforms.length}</strong>
            </div>
            <div>
              <span>模型绑定</span>
              <strong>
                {d.platforms.reduce(
                  (s: number, p: any) => s + p.models.length,
                  0,
                )}
              </strong>
            </div>
            <div>
              <span>停用平台</span>
              <strong>
                {d.platforms.filter((p: any) => p.status !== "active").length}
              </strong>
            </div>
          </div>
        </section>
        <section className="ref-box">
          <h3>
            高负载模型{" "}
            <Link href="/admin/platform/realtime-load">
              查看实时负载 <ArrowUpRight size={13} />
            </Link>
          </h3>
          <p className="muted">任务负载在实时负载页按本地运行显示。</p>
        </section>
        <section className="ref-box">
          <h3>近 {hours} 小时</h3><p className="ref-field-help">{d.scope}</p>
          <div className="ref-overview-health">
            <div>
              <strong>{chosen.length}</strong>
              <span>个已载入任务</span>
            </div>
            <div>
              <strong>
                {
                  chosen.filter(
                    (r: any) => r.status === "pending_reconciliation",
                  ).length
                }
              </strong>
              <span>次待核对</span>
            </div>
          </div>
        </section>
      </div>
      <div className="ref-toolbar">
        <select
          aria-label="统计区间"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          {[1, 6, 24, 168].map((h) => (
            <option value={h} key={h}>
              近 {h === 168 ? "7 天" : h + " 小时"}
            </option>
          ))}
        </select>
      </div>
      <div className="ref-chart-pair">
        <BarChart
          title="模型负载 · 已载入任务"
          items={Object.entries(counts).map(([name, value]) => ({
            name,
            value,
          }))}
          horizontal
        />
        <DonutChart
          title="当前作品任务状态"
          items={[
            {
              name: "完成",
              value: chosen.filter((r: any) => r.status === "completed").length,
            },
            {
              name: "失败",
              value: chosen.filter((r: any) => r.status === "failed").length,
            },
            {
              name: "待处理",
              value: chosen.filter(
                (r: any) => !["completed", "failed"].includes(r.status),
              ).length,
            },
          ]}
        />
      </div>
    </div>
  );
}
