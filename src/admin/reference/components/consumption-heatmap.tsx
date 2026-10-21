"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@reference/lib/api";
import { ErrorState, Spinner } from "./ui";

type Metric = "credits" | "tokens" | "requests";
type Counts = Record<Metric | "unconfirmed_costs" | "unconfirmed_tokens" | "sandbox_requests" | "failed_requests", number>;
export type ConsumptionDay = Counts & { date: string };
type Model = Counts & { name: string };
type Data = { days: ConsumptionDay[]; models: Model[]; total: Counts; today: Counts; start: string; end: string; updated_at: string; note: string };
type MetricLabels = Record<Metric, { label: string; unit: string }>;
const METRICS = { credits: { label: "已确认算力", unit: "算力" }, tokens: { label: "Token 用量", unit: "Token" }, requests: { label: "调用次数", unit: "次请求" } };
const AUTHOR_METRICS = { credits: { label: "已用点数", unit: "点" }, tokens: { label: "Token 用量", unit: "Token" }, requests: { label: "调用次数", unit: "次调用" } };
const OPACITY = [0, .3, .52, .76, 1];
const SPRING = { type: "spring", bounce: .2, duration: .62 } as const;
const FADE = { duration: .2, ease: [.22, 1, .36, 1] } as const;
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const number = (n: number) => n.toLocaleString("zh-CN");
export function consumptionLevel(value: number, peak: number) { return value <= 0 || peak <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(value / peak * 4))); }
function description(day: ConsumptionDay, metric: Metric, labels = METRICS) {
  const pending = metric === "credits" ? day.unconfirmed_costs : metric === "tokens" ? day.unconfirmed_tokens : 0;
  return `${day.date} · ${number(day[metric])} ${labels[metric].unit}${pending ? `，另有 ${pending} 次用量未确认` : ""}${day.sandbox_requests ? `，${metric === "requests" ? "含" : "另有"} ${day.sandbox_requests} 次演示调用` : ""}`;
}

type Hovered = { day: ConsumptionDay; x: number; y: number; bottom: number };
function Tooltip({ hovered, metric, id, labels }: { hovered: Hovered; metric: Metric; id: string; labels: MetricLabels }) {
  const reduced = useReducedMotion(), ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: hovered.x, top: hovered.y, below: false });
  useIsoLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    const half = (rect?.width || 0) / 2, below = hovered.y < (rect?.height || 0) + 16;
    setPosition({ left: Math.max(half + 8, Math.min(window.innerWidth - half - 8, hovered.x)), top: below ? hovered.bottom + 8 : hovered.y - 8, below });
  }, [hovered, metric]);
  return createPortal(<div className="u-consumption-tooltip-anchor" style={{ left: position.left, top: position.top, transform: `translate(-50%, ${position.below ? "0" : "-100%"})` }}>
    <motion.div ref={ref} id={id} role="tooltip" className="u-consumption-tooltip" initial={reduced ? false : { opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={reduced ? { duration: 0 } : { duration: .14 }}>{description(hovered.day, metric, labels)}</motion.div>
  </div>, document.body);
}

export function ConsumptionCalendar({ days, metric, labels = METRICS }: { days: ConsumptionDay[]; metric: Metric; labels?: MetricLabels }) {
  const reduced = useReducedMotion(), root = useRef<HTMLDivElement>(null), id = useId();
  const [columns, setColumns] = useState(53), [hovered, setHovered] = useState<Hovered | null>(null), [focused, setFocused] = useState("");
  const cell = 14, gap = 4;
  useIsoLayoutEffect(() => {
    const el = root.current; if (!el) return;
    const measure = () => setColumns(Math.max(1, Math.floor((el.clientWidth + gap) / (cell + gap))));
    measure(); const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const hide = () => setHovered(null);
    window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, []);
  useEffect(() => setHovered(null), [days, metric]);
  const weeks = useMemo(() => Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);
  const visible = weeks.slice(-columns), flat = visible.flat(), peak = Math.max(0, ...days.map(d => d[metric]));
  const selected = flat.some(d => d.date === focused) ? focused : flat.at(-1)?.date;
  const show = (day: ConsumptionDay, element: HTMLElement) => { const r = element.getBoundingClientRect(); setHovered({ day, x: r.left + r.width / 2, y: r.top, bottom: r.bottom }); };
  return <div ref={root} className="u-consumption-calendar" data-slot="consumption-calendar">
    <div className="u-consumption-weeks" role="group" aria-label={`每日${labels[metric].label}热力图；方向键切换日期`} onPointerLeave={() => { if (!root.current?.contains(document.activeElement)) setHovered(null); }}>
      {visible.map((week, index) => {
        const month = week[0]?.date.slice(0, 7), first = index === 0 || month !== visible[index - 1][0]?.date.slice(0, 7);
        const room = visible.slice(index, index + 3).filter(w => w[0].date.slice(0, 7) === month).length >= 3;
        return <div className="u-consumption-week" key={week[0].date}>
          <motion.span className="u-consumption-month" initial={reduced ? false : { opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={reduced ? { duration: 0 } : { ...FADE, delay: visible.length * .012 }}>{first && room ? `${Number(month?.slice(5))}月` : ""}</motion.span>
          {week.map(day => <motion.button key={day.date} type="button" className="u-consumption-cell" data-date={day.date} data-level={consumptionLevel(day[metric], peak)} tabIndex={day.date === selected ? 0 : -1}
            aria-label={description(day, metric, labels)} aria-describedby={hovered?.day.date === day.date ? id : undefined}
            onPointerEnter={e => show(day, e.currentTarget)} onFocus={e => { setFocused(day.date); show(day, e.currentTarget); }} onBlur={() => setHovered(null)} onClick={e => show(day, e.currentTarget)}
            onKeyDown={e => {
              if (e.key === "Escape") { setHovered(null); return; }
              const offset = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
              if (offset === undefined && !["Home", "End"].includes(e.key)) return;
              e.preventDefault(); const at = flat.findIndex(d => d.date === day.date);
              const next = e.key === "Home" ? 0 : e.key === "End" ? flat.length - 1 : Math.max(0, Math.min(flat.length - 1, at + offset!));
              root.current?.querySelector<HTMLButtonElement>(`[data-date="${flat[next].date}"]`)?.focus();
            }}
            initial={reduced ? false : { opacity: 0, scale: .4 }} animate={{ opacity: 1, scale: 1 }} transition={reduced ? { duration: 0 } : { ...FADE, delay: index * .012 }}>
            <span style={{ opacity: OPACITY[consumptionLevel(day[metric], peak)] }} />
          </motion.button>)}
        </div>;
      })}
    </div>
    <div className="u-consumption-legend"><span>可见 {flat[0]?.date} — {flat.at(-1)?.date}</span><span>少 {OPACITY.map((opacity, i) => <i key={i}><b style={{ opacity }} /></i>)} 多</span></div>
    <AnimatePresence>{hovered && <Tooltip key="tooltip" hovered={hovered} metric={metric} id={id} labels={labels} />}</AnimatePresence>
  </div>;
}

function ModelAvatar({ model, layoutId }: { model: Model; layoutId: string }) {
  const reduced = useReducedMotion();
  return <motion.span className="u-consumption-avatar" title={model.name} aria-hidden="true" layoutId={layoutId} transition={reduced ? { duration: 0 } : SPRING}>{model.name.slice(0, 1).toUpperCase()}</motion.span>;
}

type HeatmapProps = { audience?: "admin"; userId?: never } | { audience: "studio"; userId: string };

export function ConsumptionHeatmap(props: HeatmapProps = {}) {
  const [weeks, setWeeks] = useState(53), [metric, setMetric] = useState<Metric>("credits"), [open, setOpen] = useState(false);
  const reduced = useReducedMotion(), id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const studio = props.audience === "studio", labels = studio ? AUTHOR_METRICS : METRICS;
  const q = useQuery<Data>({ queryKey: ["consumption-heatmap", studio ? "studio" : "admin", props.userId, weeks], queryFn: () => api(`${studio ? "/studio/activity/heatmap" : "/admin/consumption-heatmap"}?weeks=${weeks}`, { suppressErrorNotice: studio }), enabled: !studio || Boolean(props.userId), refetchInterval: 10000 });
  const data = q.data;
  const top = data ? [...data.models].sort((a, b) => b[metric] - a[metric] || b.requests - a.requests || a.name.localeCompare(b.name)).slice(0, 3) : [];
  const pending = data ? metric === "credits" ? data.total.unconfirmed_costs : metric === "tokens" ? data.total.unconfirmed_tokens : 0 : 0;
  const transition = reduced ? { duration: 0 } : SPRING;
  return <section className={`u-consumption-section${studio ? " s-usage-heatmap" : ""}`} aria-labelledby={`${id}-title`}>
    <div className="u-consumption-heading"><div><h2 id={`${id}-title`}>{studio ? "用量热力图" : "实时消耗"}</h2><p>{studio ? "查看每日用量与模型使用情况" : "按日统计 · 北京时间 · 每 10 秒刷新"}</p></div><div className="u-consumption-controls">
      <label>查看指标<select aria-label="查看指标" value={metric} onChange={e => setMetric(e.target.value as Metric)}>{Object.entries(labels).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
      <label>统计范围<select aria-label="统计范围" value={weeks} onChange={e => { setWeeks(Number(e.target.value)); setOpen(false); }}><option value={13}>近 13 周</option><option value={26}>近 26 周</option><option value={53}>近 53 周</option></select></label>
      <button type="button" className={studio ? "s-btn" : "button secondary small"} disabled={q.isFetching} onClick={() => q.refetch()} aria-label={studio ? "刷新用量" : "刷新实时消耗"}>{q.isFetching ? "刷新中…" : "刷新"}</button>
    </div></div>
    {q.isPending ? <Spinner text="正在读取消耗记录" /> : data && <>
      <div className="u-consumption-card" data-slot="consumption-heatmap" data-has-models={top.length > 0}>
        <div className="u-consumption-summary"><p>本期 <strong data-slot="consumption-total">{number(data.total[metric])}</strong> {labels[metric].unit}</p><span>今日 {number(data.today[metric])} {labels[metric].unit}</span></div>
        <div inert={open}><ConsumptionCalendar days={data.days} metric={metric} labels={labels} /></div>
        {data.total.requests === 0 && <p className="u-consumption-empty">本期暂无模型请求，发生调用后将自动显示。</p>}
        {top.length > 0 && <motion.div id={`${id}-models`} className="u-consumption-model-panel" data-state={open ? "open" : "closed"} layout style={{ borderRadius: 18 }} transition={transition}
          onKeyDown={e => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
          <motion.div layout="position" className="u-consumption-model-heading" transition={transition}><span>{studio ? "模型用量排行" : `本期模型${metric === "requests" ? "调用" : "消耗"} TOP 3`}</span><div className="u-consumption-model-actions">
            {!open && <span className="u-consumption-stack">{top.map(model => <ModelAvatar key={model.name} model={model} layoutId={`${id}-${model.name}`} />)}</span>}
            <button ref={trigger} type="button" aria-label={open ? "收起模型消耗排行" : "展开模型消耗排行"} aria-expanded={open} aria-controls={`${id}-models`} onClick={() => setOpen(!open)}>
              <motion.svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} transition={transition}><circle cx="12" cy="12" r="10" /><path d="m16 10-4 4-4-4" /></motion.svg>
            </button></div></motion.div>
          <AnimatePresence initial={false}>{open && <motion.ul className="u-consumption-models" initial={reduced ? false : { opacity: 0, x: 16, y: 16 }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0 }} transition={transition}>
            {top.map(model => <li key={model.name}><ModelAvatar model={model} layoutId={`${id}-${model.name}`} /><span title={model.name}>{model.name}</span><strong>{number(model[metric])} <small>{labels[metric].unit}</small></strong></li>)}
          </motion.ul>}</AnimatePresence>
        </motion.div>}
      </div>
      <div className="u-consumption-notes"><span>统计 {data.start} — {data.end} · 按本期峰值分级</span><span>更新于 {new Date(data.updated_at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span></div>
      {pending > 0 && <p className="u-consumption-notice" role="status">另有 {pending} 次请求的用量未确认，未计入上方合计；{studio ? "可在下方创作任务查看进度。" : "请到调用记录核对。"}</p>}
      {data.total.sandbox_requests > 0 && <p className="u-consumption-notes">本期含 {data.total.sandbox_requests} 次{studio ? "演示调用" : "沙箱请求"}，仅计调用次数，不计入{studio ? "点数" : "算力"}和 Token 消耗。</p>}
      <details className="u-consumption-method"><summary>统计口径</summary><p>{data.note}</p></details>
    </>}
    {q.error && (!studio || !data) && <ErrorState error={studio ? new Error("暂时无法读取用量，请稍后重试。") : q.error} retry={() => q.refetch()} />}
    {q.error && data && <p className="u-consumption-notice" role="status">刷新失败，以上保留的是上次成功读取的数据。</p>}
  </section>;
}
