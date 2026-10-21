"use client";
import { useId, useState } from "react";
import { RefEmpty } from "./reference-ui";
export const chartColors = [
  "var(--chart-1, #d4ef68)",
  "var(--chart-2, #97b98b)",
  "var(--chart-3, #aaa8d8)",
  "var(--chart-4, #d5af75)",
  "var(--chart-5, #91b5c8)",
  "var(--chart-6, #bc9d9a)",
];
type Series = { name: string; values: number[]; color?: string };
export function LineChart({
  title,
  labels,
  series,
  percent = false,
  currency = false,
  threshold,
}: {
  title: string;
  labels: string[];
  series: Series[];
  percent?: boolean;
  currency?: boolean;
  threshold?: number;
}) {
  const id = useId().replace(/:/g, ""),
    [hover, setHover] = useState<number | null>(null);
  const w = 1000,
    h = 330,
    l = 65,
    r = 25,
    t = 25,
    b = 45,
    cw = w - l - r,
    ch = h - t - b,
    max = percent ? 100 : Math.max(1, ...series.flatMap((s) => s.values)) * 1.1;
  const point = (v: number, i: number) => [
    l + (cw * i) / Math.max(1, labels.length - 1),
    t + ch - (ch * v) / max,
  ];
  return (
    <section className="ref-chart">
      <h3>{title}</h3>
      <div className="ref-chart-legend">
        {series.map((s, i) => (
          <span key={s.name}>
            <i style={{ background: s.color || chartColors[i] }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="ref-chart-canvas">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`${title}，${labels.length} 个时间点`}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient
                key={i}
                id={`${id}-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop stopColor={s.color || chartColors[i]} stopOpacity=".16" />
                <stop
                  offset="1"
                  stopColor={s.color || chartColors[i]}
                  stopOpacity="0"
                />
              </linearGradient>
            ))}
          </defs>
          {Array.from({ length: 5 }, (_, i) => {
            const v = (max * i) / 4,
              y = t + ch - (ch * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={l}
                  x2={w - r}
                  y1={y}
                  y2={y}
                  className="chart-gridline"
                />
                <text x={l - 12} y={y + 4} textAnchor="end">
                  {currency ? "¥" : ""}
                  {Number(v.toFixed(max < 5 ? 1 : 0))}
                  {percent ? "%" : ""}
                </text>
              </g>
            );
          })}
          {labels.map((v, i) =>
            i % Math.max(1, Math.ceil(labels.length / 9)) === 0 ||
            i === labels.length - 1 ? (
              <text key={i} x={point(0, i)[0]} y={h - 15} textAnchor="middle">
                {v}
              </text>
            ) : null,
          )}
          {threshold !== undefined && (
            <g>
              <line
                x1={l}
                x2={w - r}
                y1={point(threshold, 0)[1]}
                y2={point(threshold, 0)[1]}
                stroke="var(--chart-negative, #d78d80)"
                strokeDasharray="6 5"
              />
              <text
                x={w - r}
                y={point(threshold, 0)[1] - 7}
                textAnchor="end"
                fill="var(--chart-negative, #d78d80)"
              >
                阈值 {threshold}%
              </text>
            </g>
          )}
          {series.map((s, i) => {
            const points = s.values
              .map((v, j) => point(v, j).join(","))
              .join(" ");
            return (
              <g key={s.name}>
                <polygon
                  points={`${l},${t + ch} ${points} ${point(0, Math.max(0, s.values.length - 1)).join(",")}`}
                  fill={`url(#${id}-${i})`}
                />
                <polyline
                  points={points}
                  fill="none"
                  stroke={s.color || chartColors[i]}
                  strokeWidth="2.3"
                  strokeLinejoin="round"
                />
                {s.values.length === 1 && (
                  <circle
                    cx={point(s.values[0], 0)[0]}
                    cy={point(s.values[0], 0)[1]}
                    r="4"
                    fill={s.color || chartColors[i]}
                  />
                )}
              </g>
            );
          })}
          {labels.map((v, i) => (
            <rect
              key={i}
              x={point(0, i)[0] - cw / Math.max(1, labels.length - 1) / 2}
              y={t}
              width={cw / Math.max(1, labels.length - 1)}
              height={ch}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {v +
                  "\n" +
                  series
                    .map((s) => s.name + "：" + (s.values[i] ?? 0))
                    .join("\n")}
              </title>
            </rect>
          ))}
          {hover !== null && (
            <line
              x1={point(0, hover)[0]}
              x2={point(0, hover)[0]}
              y1={t}
              y2={t + ch}
              stroke="var(--muted)"
              strokeDasharray="3 3"
            />
          )}
        </svg>
        {hover !== null && (
          <div className="ref-chart-tooltip">
            {labels[hover]}
            {series.map((s) => (
              <div key={s.name}>
                {s.name}：{currency ? "¥" : ""}
                {s.values[hover] ?? 0}
                {percent ? "%" : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
export function BarChart({
  title,
  items,
  horizontal = false,
}: {
  title: string;
  items: { name: string; value: number }[];
  horizontal?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <section className="ref-chart">
      <h3>{title}</h3>
      {!items.length ? (
        <RefEmpty />
      ) : horizontal ? (
        <div className="ref-horizontal-bars">
          {items.map((v, i) => (
            <div key={v.name}>
              <span title={v.name}>{v.name}</span>
              <div>
                <i
                  style={{
                    width: `${(v.value / max) * 92}%`,
                    background: chartColors[i % chartColors.length],
                  }}
                />
                <small>{v.value}</small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ref-vertical-bars">
          {items.map((v, i) => (
            <div key={v.name}>
              <span>{v.value}</span>
              <i
                style={{
                  height: `${Math.max(2, (v.value / max) * 245)}px`,
                  background: chartColors[i % chartColors.length],
                }}
              />
              <small title={v.name}>{v.name}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export function DonutChart({
  title,
  items,
  pie = false,
}: {
  title: string;
  items: { name: string; value: number }[];
  pie?: boolean;
}) {
  const sum = items.reduce((a, b) => a + b.value, 0);
  let start = 0;
  return (
    <section className="ref-chart">
      <h3>{title}</h3>
      {sum ? (
        <div className="ref-donut-wrap">
          <svg
            viewBox="0 0 240 240"
            role="img"
            aria-label={items.map((i) => `${i.name} ${i.value}`).join("，")}
          >
            {items.map((v, i) => {
              const fraction = v.value / sum,
                from = start;
              start += fraction;
              return (
                <circle
                  key={v.name}
                  cx="120"
                  cy="120"
                  r={pie ? 50 : 85}
                  fill="none"
                  stroke={chartColors[i]}
                  strokeWidth={pie ? 100 : 38}
                  strokeDasharray={`${fraction * (pie ? 314.159 : 534.07)} ${(1 - fraction) * (pie ? 314.159 : 534.07)}`}
                  strokeDashoffset={-from * (pie ? 314.159 : 534.07)}
                  transform="rotate(-90 120 120)"
                >
                  <title>
                    {v.name}：{v.value}（{(fraction * 100).toFixed(1)}%）
                  </title>
                </circle>
              );
            })}
            {!pie && (
              <text
                x="120"
                y="128"
                textAnchor="middle"
                className="ref-donut-total"
              >
                {sum}
              </text>
            )}
          </svg>
          <div className="ref-chart-legend vertical">
            {items.map((v, i) => (
              <span key={v.name}>
                <i style={{ background: chartColors[i] }} />
                {v.name} {v.value}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <RefEmpty />
      )}
    </section>
  );
}
