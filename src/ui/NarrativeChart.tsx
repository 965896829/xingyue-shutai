import { useId, useState, useRef, useLayoutEffect } from 'react';
import { curveSegments, type CurveDatum } from '../shared/narrative-curve';

export interface CurveSeries { key: string; label: string; points: CurveDatum[]; dashed?: boolean }
export function NarrativeChart({ series, labels, cursor, onPoint, axis = '场面', empty = '还没有可绘制的强度数据', unit = '情节强度', smooth = true }: {
  series: CurveSeries[]; labels: { x: number; label: string }[]; cursor?: number; onPoint: (point: CurveDatum) => void; axis?: string; empty?: string; unit?: string; smooth?: boolean;
}) {
  const id = useId().replace(/:/g, ''), [hover, setHover] = useState<{ key: string; x: number }>();
  const container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(680);
  useLayoutEffect(() => {
    const element = container.current; if (!element) return;
    const resize = () => setWidth(Math.max(280, Math.round(element.getBoundingClientRect().width)));
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, []);
  const height = 160, left = 35, right = width - 25, top = 18, bottom = 124;
  const values = labels.map(point => point.x), min = Math.min(...values), max = Math.max(...values);
  const x = (value: number) => min === max ? (left + right) / 2 : left + (value - min) / (max - min) * (right - left);
  const y = (value: number) => bottom - (value - 1) / 4 * (bottom - top);
  const hasData = series.some(s => s.points.some(p => p.value !== null));
  const selected = hover && series.find(s => s.key === hover.key)?.points.find(p => p.x === hover.x);
  const stride = Math.max(1, Math.ceil(labels.length / Math.max(3, Math.floor(width / 80))));
  return <div className="narrative-curve" ref={container}>
    <div className="curve-legend"><span className="curve-unit">{unit} · 1—5</span>{series.map(s => <span key={s.key} data-series={s.key} className={s.dashed ? 'dashed' : ''}><i />{s.label}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${axis}起伏曲线，${unit}1到5`}>
      <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--accent)" stopOpacity=".01" /></linearGradient></defs>
      {[1, 2, 3, 4, 5].map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="curve-grid" /><text x="18" y={y(value) + 4} textAnchor="middle">{value}</text></g>)}
      {series.map(s => {
        const segments = curveSegments(s.points.map(p => ({ x: x(p.x), y: p.value === null ? null : y(p.value) })), smooth);
        return <g key={s.key} data-series={s.key}>
          {segments.map((d, index) => <path key={`area${index}`} d={`${d} L ${d.match(/([\d.]+) ([\d.]+)$/)?.[1] ?? left} ${bottom} L ${d.match(/^M ([\d.]+)/)?.[1] ?? left} ${bottom} Z`} fill={`url(#${id}-fill)`} className="curve-area" />)}
          {segments.map((d, index) => <path key={index} d={d} className={`curve-path ${s.dashed ? 'dashed' : ''}`} />)}
          {s.points.map(p => p.value === null ? null : <g key={p.x}>
            <circle cx={x(p.x)} cy={y(p.value)} r={cursor === p.x ? 5 : 3.5} className="curve-dot" />
            <circle cx={x(p.x)} cy={y(p.value)} r="11" className="curve-hit" tabIndex={0} role="button"
              aria-label={`${p.label}，${s.label} ${p.value}/5，查看来源`} onMouseEnter={() => setHover({ key: s.key, x: p.x })}
              onFocus={() => setHover({ key: s.key, x: p.x })} onClick={() => onPoint(p)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPoint(p); } }}>
              <title>{`${p.label} · ${s.label} ${p.value}/5\n${p.note ?? ''}`}</title>
            </circle>
          </g>)}
        </g>;
      })}
      {cursor !== undefined && Number.isFinite(cursor) && values.includes(cursor) && <g className="curve-playhead" style={{ transform: `translateX(${x(cursor)}px)` }}>
        <line y1="10" y2={bottom + 4} /><path d="M -4 5 L 4 5 L 0 10 Z" /><text y="153" textAnchor="middle">当前</text>
      </g>}
      {labels.map((point, i) => (i % stride === 0 || i === labels.length - 1) && <text key={point.x} x={x(point.x)} y="143" textAnchor="middle">{point.label}</text>)}
      {!hasData && <text x={width / 2} y="73" textAnchor="middle" className="curve-empty-label">{empty}</text>}
    </svg>
    <div className="curve-detail" aria-live="polite">{selected ? <><strong>{selected.label} · {selected.value}/5</strong><span>{selected.note || '点击节点查看对应内容'}</span></> : <span>峰谷表示剧情起伏，低强度不代表低质量。点击节点可定位内容。</span>}</div>
  </div>;
}
