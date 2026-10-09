import { useState } from 'react';
import type { Snapshot } from '../shared/types';
import { dimensions, type Dimension, type SourceRef, type Assessment } from '../shared/studio';
const labels: Record<Dimension, string> = {
  pressure: '压力',
  payoff: '回报',
  emotion: '情绪',
  revelation: '揭示',
  relationship: '关系'
};
const tracks: Record<Assessment['track'], string> = { plan: '计划', accepted: '已接受', candidate: '候选' };
export function NarrativePanel({
  snapshot,
  onSource
}: {
  snapshot: Snapshot;
  onSource: (v: SourceRef) => void;
}) {
  const [open, setOpen] = useState(false),
    [dimension, setDimension] = useState<Dimension>('pressure'),
    [selected, setSelected] = useState<Assessment>();
  const rows = (snapshot.studio?.assessments ?? []).filter((a) => !a.stale),
    latest = [...new Map([...rows].reverse().map((a) => [`${a.chapter}:${a.track}`, a])).values()].sort(
      (a, b) => a.chapter - b.chapter
    );
  const chapters = [...new Set(latest.map((a) => a.chapter))],
    width = 680,
    height = 132,
    x = (chapter: number) =>
      chapters.length < 2
        ? width / 2
        : 24 + (chapters.indexOf(chapter) * (width - 48)) / (chapters.length - 1),
    y = (n: number) => height - 18 - (n - 1) * 24;
  return (
    <section className={`narrative-panel ${open ? 'expanded' : ''}`}>
      <button className="narrative-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>叙事节奏</span>
        <span>
          {open ? '收起' : '展开'} {open ? '⌄' : '⌃'}
        </span>
      </button>
      {open && (
        <div className="narrative-content">
          <div className="narrative-toolbar">
            <div>
              {dimensions.map((d) => (
                <button
                  key={d}
                  aria-pressed={dimension === d}
                  className={dimension === d ? 'active' : ''}
                  onClick={() => setDimension(d)}
                >
                  {labels[d]}
                </button>
              ))}
            </div>
            <div className="chart-legend">
              {Object.entries(tracks).map(([key, label]) => (
                <span key={key} data-track={key}>
                  {label}
                </span>
              ))}
            </div>
          </div>
          {latest.length ? (
            <>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={`${labels[dimension]}变化，评分 1 到 5`}
              >
                {[1, 3, 5].map((n) => (
                  <g key={n}>
                    <line x1="22" x2={width - 12} y1={y(n)} y2={y(n)} className="chart-grid" />
                    <text x="3" y={y(n) + 3}>
                      {n}
                    </text>
                  </g>
                ))}
                {(Object.keys(tracks) as Assessment['track'][]).map((track) => {
                  let pen = false;
                  let previous = 0;
                  const path = chapters
                    .map((chapter) => {
                      const a = latest.find((a) => a.track === track && a.chapter === chapter),
                        n = a?.values[dimension];
                      if (n === null || n === undefined) {
                        pen = false;
                        return '';
                      }
                      if (previous && chapter !== previous + 1) pen = false;
                      const s = `${pen ? 'L' : 'M'}${x(chapter)},${y(n)}`;
                      pen = true;
                      previous = chapter;
                      return s;
                    })
                    .join(' ');
                  return <path key={track} d={path} data-track={track} className="chart-line" />;
                })}
                {latest.map(
                  (a) =>
                    a.values[dimension] !== null && (
                      <circle
                        key={a.id}
                        cx={x(a.chapter)}
                        cy={y(a.values[dimension]!)}
                        r="4"
                        data-track={a.track}
                        tabIndex={0}
                        role="button"
                        aria-label={`第 ${a.chapter} 章 ${tracks[a.track]} ${labels[dimension]} ${a.values[dimension]}`}
                        onClick={() => setSelected(a)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelected(a);
                        }}
                      />
                    )
                )}
                {chapters.map((c) => (
                  <text key={c} x={x(c)} y={height - 2} textAnchor="middle">
                    {c}
                  </text>
                ))}
              </svg>
              {selected && (
                <div className="assessment-note">
                  <span>
                    第 {selected.chapter} 章 · {tracks[selected.track]}
                  </span>
                  <p>{selected.note}</p>
                  {selected.evidence.map((e, i) => (
                    <button key={i} onClick={() => onSource(e)}>
                      {e.quote}
                    </button>
                  ))}
                </div>
              )}
              <details>
                <summary>数据</summary>
                <table>
                  <thead>
                    <tr>
                      <th>章节</th>
                      <th>版本</th>
                      {dimensions.map((d) => (
                        <th key={d}>{labels[d]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((a) => (
                      <tr key={a.id}>
                        <td>{a.chapter}</td>
                        <td>{tracks[a.track]}</td>
                        {dimensions.map((d) => (
                          <td key={d}>{a.values[d] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <div className="narrative-empty">暂无评估</div>
          )}
        </div>
      )}
    </section>
  );
}
