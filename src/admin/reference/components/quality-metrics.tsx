"use client";
import { useQuery } from "@tanstack/react-query";
import { api, formatNumber } from "@reference/lib/api";
import { ErrorState } from "./ui";

export function QualityMetrics({ days }: { days: number }) {
  const q = useQuery({
    queryKey: ["quality-metrics", days],
    queryFn: () => api(`/admin/quality-metrics?days=${days}`),
    refetchInterval: 30000,
  });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;
  const d = q.data;
  return (
    <section className="ref-chart">
      <h3>创作采用与成本</h3>
      <div className="ref-kpi-grid">
        {[
          ["采用稿字数", d.adopted_characters],
          ["已确认章节", d.confirmed_chapters],
          ["每千字采用稿算力", d.credits_per_1000_adopted_characters],
          ["活跃编辑估计 / 分钟", d.editing_active_minutes],
          ["采用补丁提案", d.adopted_patch_proposals],
          ["费用待核对", d.pending_reconciliation],
        ].map(([name, value]) => (
          <div className="ref-kpi" key={String(name)}>
            <span>{name}</span>
            <strong>{value == null ? "—" : formatNumber(Number(value))}</strong>
          </div>
        ))}
      </div>
      <p>
        供应商成本：
        {d.supplier_costs.length
          ? d.supplier_costs
              .map((c: any) => `${c.currency} ${c.amount}`)
              .join("；")
          : "尚无已登记的真实成本"}
        ；另有 {d.unconfigured_supplier_requests} 次真实请求尚未配置或核对成本。
      </p>
      <p className="ref-data-note">{d.note}</p>
    </section>
  );
}
