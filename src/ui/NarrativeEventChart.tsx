import { useLayoutEffect, useRef, useState } from 'react';
import { curveContinuation, curveSegments } from '../shared/narrative-curve';
import { narrativeKindNames, type NarrativeEvent } from '../shared/narrative-events';
import './narrative-events.css';

export const narrativeCharacters = (text: string) => Array.from(text.replace(/^#\s[^\n]*\n?/, '').replace(/\s/g, '')).length;
export function NarrativeEventChart({ events, text, targetWords, finished, writing, chapter, onLocate }: {
  events: NarrativeEvent[]; text: string; targetWords: number; finished: boolean; writing: boolean; chapter: number; onLocate: (event: NarrativeEvent) => void;
}) {
  const root = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 680, height: 220 }), [selectedId, setSelectedId] = useState<string>();
  const { width, height } = size;
  useLayoutEffect(() => {
    if (!root.current) return;
    const resize = () => {
      const next = { width: Math.max(280, Math.round(root.current!.getBoundingClientRect().width)), height: Math.max(180, Math.min(240, Math.round(window.innerHeight * .22))) };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(root.current); window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, []);
  const characters = narrativeCharacters(text), maximum = Math.max(finished ? 1 : targetWords, characters, 1);
  const left = 42, right = width - 18, x = (value: number) => left + value / maximum * (right - left);
  const tensionY = (value: number) => height * .54 - (value - 1) / 4 * (height * .54 - 56), emotionY = (value: number) => height * .8 - value * height * .065;
  const points = events.map(event => ({ ...event, words: narrativeCharacters(text.slice(0, event.end)) }));
  const selected = points.find(event => event.id === selectedId) ?? points.at(-1);
  const tensionPoints = points.map(point => ({ x: x(point.words), y: tensionY(point.intensity) }));
  const emotionPoints = points.map(point => ({ x: x(point.words), y: point.valence === undefined ? null : emotionY(point.valence) }));
  const curves = curveSegments(tensionPoints, true), emotions = curveSegments(emotionPoints, true);
  const tensionTail = curveContinuation(tensionPoints, x(characters)), emotionTail = curveContinuation(emotionPoints, x(characters));
  const latest = points.at(-1);
  const rows = [-Infinity, -Infinity];
  const annotations = points.filter(point => point.kind !== 'beat').flatMap(point => {
    const label = `${narrativeKindNames[point.kind]} · ${point.label.length > 7 ? point.label.slice(0, 7) + '…' : point.label}`;
    const labelWidth = Math.min(130, label.length * 10 + 14), center = Math.max(left + labelWidth / 2, Math.min(right - labelWidth / 2, x(point.words)));
    const row = rows.findIndex(last => center - labelWidth / 2 > last + 6);
    if (row < 0) return []; // The colored node and its labelled chip stay visible.
    rows[row] = center + labelWidth / 2;
    return [{ point, label, labelWidth, center, top: 7 + row * 22 }];
  });
  const locate = (event: NarrativeEvent) => { setSelectedId(event.id); onLocate(event); };
  return <div className="narrative-events" ref={root} data-event-count={events.length} data-visible-characters={characters}>
    <div className="event-heading"><strong>第 {String(chapter).padStart(3, '0')} 章 <span className={writing ? 'event-writing' : ''}>{writing ? '正在展开' : finished ? '正文已生成' : '已暂停'}</span></strong>
      <span>{characters.toLocaleString()} 字 · {events.length} 个节点</span></div>
    <div className="event-legend"><span><i className="event-tension-key" />剧情张力</span><span><i className="event-emotion-key" />情绪走向</span>
      {(tensionTail || emotionTail) && <span title="虚线沿用最近节点的值，延伸至已显示正文；新节点出现后更新"><i className="event-continuation-key" />节点延续</span>}<small>点击节点定位原文</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="随正文展开的叙事事件曲线">
      <desc>实线连接已出现的节点，虚线沿用最近节点并跟随正文进度，不代表新增判断。</desc>
      <rect x={x(characters)} y="52" width={Math.max(0, right - x(characters))} height={height - 67} className="event-unwritten" />
      {[1, 3, 5].map(value => <g key={value}><line className="event-grid" x1={left} x2={right} y1={tensionY(value)} y2={tensionY(value)} /><text x="25" y={tensionY(value) + 3} textAnchor="middle">{value}</text></g>)}
      <text x="8" y="46" className="event-axis-title">张力</text>
      <text x="8" y={height * .64} className="event-axis-title">情绪</text>
      {[2, 0, -2].map(value => <g key={value}><line className={`event-grid ${value === 0 ? 'event-zero' : ''}`} x1={left} x2={right} y1={emotionY(value)} y2={emotionY(value)} /><text x="24" y={emotionY(value) + 3} textAnchor="middle">{{ 2: '正向', 0: '中性', '-2': '负向' }[value]}</text></g>)}
      {curves.map((d, index) => <path key={`t${index}`} d={d} className="event-tension-line" />)}
      {emotions.map((d, index) => <path key={`e${index}`} d={d} className="event-emotion-line" />)}
      {tensionTail && <path d={tensionTail} className="event-tension-line event-continuation" />}
      {emotionTail && <path d={emotionTail} className="event-emotion-line event-continuation" />}
      {text && <g className="event-cursor" transform={`translate(${x(characters)},0)`}><line y1="52" y2={height - 15} />
        {latest && <circle className={`event-tension-head ${writing ? 'is-writing' : ''}`} cy={tensionY(latest.intensity)} r="3.5" />}
        {latest?.valence !== undefined && <circle className="event-emotion-head" cy={emotionY(latest.valence)} r="3" />}
      </g>}
      {annotations.map(({ point, label, labelWidth, center, top }) => <g key={point.id} data-kind={point.kind} className="event-annotation" pointerEvents="none">
        <path d={`M ${center} ${top + 18} L ${x(point.words)} ${tensionY(point.intensity) - 7}`} />
        <rect x={center - labelWidth / 2} y={top} width={labelWidth} height="18" rx="5" />
        <text x={center} y={top + 12} textAnchor="middle">{label}</text>
      </g>)}
      {points.map(point => <g key={point.id} data-kind={point.kind} className={`event-point ${selected?.id === point.id ? 'selected' : ''}`}>
        {point.valence !== undefined && <circle className="event-emotion-dot" cx={x(point.words)} cy={emotionY(point.valence)} r="3.5" />}
        {point.valence !== undefined && <circle className="event-hit" cx={x(point.words)} cy={emotionY(point.valence)} r="10" role="button" tabIndex={0}
          aria-label={`定位情绪：${point.emotion ?? point.label}`} data-prose-end={point.end}
          onMouseEnter={() => setSelectedId(point.id)} onFocus={() => setSelectedId(point.id)} onClick={() => locate(point)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); locate(point); } }} />}
        <circle className="event-node" cx={x(point.words)} cy={tensionY(point.intensity)} r={point.kind === 'beat' ? 3.5 : 5} />
        <circle cx={x(point.words)} cy={tensionY(point.intensity)} r="12" className="event-hit" tabIndex={0} role="button"
          aria-label={`定位原文：${narrativeKindNames[point.kind]}，${point.label}`} data-prose-end={point.end}
          onMouseEnter={() => setSelectedId(point.id)} onFocus={() => setSelectedId(point.id)} onClick={() => locate(point)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); locate(point); } }}>
          <title>{`${narrativeKindNames[point.kind]} · ${point.label}\n张力 ${point.intensity}/5${point.emotion ? '\n' + point.emotion : ''}\n${point.anchor}`}</title>
        </circle>
      </g>)}
      {[0, .25, .5, .75, 1].map(ratio => <text key={ratio} x={x(maximum * ratio)} y={height - 3} textAnchor="middle">{Math.round(maximum * ratio).toLocaleString()}{ratio === 1 ? ' 字' : ''}</text>)}
      {!events.length && <text x={(left + right) / 2} y="104" textAnchor="middle" className="event-empty">{writing ? '关键节点会随对应正文出现' : '这一稿尚无可定位的事件节点'}</text>}
    </svg>
    {!!points.length && <div className="event-chips" aria-label="本章重要节点">{points.map(point => <button key={point.id} data-kind={point.kind}
      aria-pressed={selected?.id === point.id} onClick={() => locate(point)} title={point.anchor} data-prose-end={point.end}>
      <span>{narrativeKindNames[point.kind]}</span>{point.label}</button>)}</div>}
    {selected && <div className="event-evidence"><div><strong>{selected.label}</strong>{selected.emotion && <span>{selected.emotion}</span>}<small>张力 {selected.intensity}/5</small></div><blockquote>{selected.anchor}</blockquote></div>}
    <p className="event-caption">节点随正文保存。情绪走向不代表质量，缓和与低谷也是节奏的一部分。</p>
    <span className="sr-only" role="status">{points.length ? `已出现 ${points.length} 个节点，最新：${narrativeKindNames[points.at(-1)!.kind]}，${points.at(-1)!.label}` : ''}</span>
  </div>;
}
