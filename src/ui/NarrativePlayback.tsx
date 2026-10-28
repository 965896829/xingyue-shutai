import { useMemo, useState } from 'react';
import type { Run, Snapshot } from '../shared/types';
import type { SourceRef } from '../shared/studio';
import type { CurveDatum, NarrativeData } from '../shared/narrative-curve';
import { narrativePlan, narrativeProgress, SceneLocator } from '../shared/narrative-playback';
import { narrativeDimensionNames, sceneDimension, type NarrativeDimension } from '../shared/narrative-dimensions';
import { proseBinding, useLiveStream, useLiveNarrative } from './useLiveStream';
import { NarrativeChart } from './NarrativeChart';
import { visibleNarrativeEvents, type NarrativeEvent } from '../shared/narrative-events';
import { NarrativeEventChart } from './NarrativeEventChart';

type PlaybackProps = { snapshot: Snapshot; run?: Run; data: NarrativeData; onSource: (source: SourceRef) => void };
export function NarrativePlayback(props: PlaybackProps) {
  const { snapshot, run, data, onSource } = props;
  const binding = run ? proseBinding(snapshot.projectSessionId, run) : { session: snapshot.projectSessionId, kind: 'prose' as const,
    id: `saved:${data.chapter}:${data.savedProse?.hash ?? ''}`, text: data.savedProse?.content ?? '', running: false };
  const text = useLiveStream(binding), live = useLiveNarrative(binding, run?.pipeline?.narrative);
  const writing = run?.status === 'running' && run.pipeline?.phase === 'prose';
  const finished = run ? !!run.pipeline?.proseHash && run.pipeline.phase !== 'prose' : !!data.savedProse;
  const saved = data.eventRecord && (!run || finished && data.eventRecord.source.hash === run.pipeline?.proseHash) ? data.eventRecord : undefined;
  const events = visibleNarrativeEvents(run ? live.length ? live : saved?.events ?? [] : saved?.events ?? [], text);
  const locate = (point: NarrativeEvent) => {
    if (run) {
      const event = new CustomEvent('wenxu:locate-prose', { cancelable: true, detail: { runId: run.id, quote: point.anchor } });
      window.dispatchEvent(event);
      if (event.defaultPrevented) return;
    }
    if (saved) onSource({ ...saved.source, quote: point.anchor });
  };
  if (writing || run?.pipeline?.narrative || saved || live.length) return <div className="narrative-playback" data-stream-length={text.length} data-stream-id={run?.id}>
    <NarrativeEventChart chapter={data.chapter} events={events} text={text} targetWords={snapshot.project?.config.chapterWords ?? 2500}
      writing={!!writing} finished={finished} onLocate={locate} />
  </div>;
  return <LegacyNarrativePlayback {...props} text={text} />;
}

function LegacyNarrativePlayback({ snapshot, run, data, onSource, text }: PlaybackProps & { text: string }) {
  const [dimension, setDimension] = useState<NarrativeDimension>('intensity'), [smooth, setSmooth] = useState(false);
  const plan = useMemo(() => narrativePlan(data.detail?.content ?? ''), [data.detail?.hash]);
  const locator = useMemo(() => new SceneLocator(plan.scenes), [plan, run?.id, run?.pipeline?.epoch]);
  const writing = run?.status === 'running' && run.pipeline?.phase === 'prose';
  const finished = run ? !!run.pipeline?.proseHash && run.pipeline.phase !== 'prose' : !!data.savedProse;
  const actual = data.actual && (!run || finished && data.actual.source.hash === run.pipeline?.proseHash) ? data.actual : undefined;
  const matches = locator.update(text.replace(/\r\n/g, '\n'), finished);
  const current = matches.at(-1)?.scene;
  const progress = narrativeProgress(text, snapshot.project?.config.chapterWords ?? 2500, plan.scenes.length, finished);
  const judged = actual && (dimension === 'intensity' || actual.points.some(point => point.values?.[dimension] != null)) ? actual : undefined;
  const draft = !!run && !run.accepted;
  const points: CurveDatum[] = judged ? judged.points.map((point, index) => ({
    x: index + 1, value: dimension === 'intensity' ? point.strength : point.values?.[dimension] ?? null,
    label: point.label, source: { ...judged.source, quote: point.anchor }, note: point.anchor
  })) : plan.scenes.map((scene, index) => {
    const model = data.plan?.points.find(point => point.anchor === scene.title), estimate = sceneDimension(scene, dimension);
    const value = dimension === 'intensity' ? model?.strength : model?.values?.[dimension];
    return { x: index + 1, value: value ?? estimate.value, label: scene.title.replace(/^(?:场面|场景)\s*[一二三四五六七八九十\d]+[：:、.\s]*/, ''),
      source: data.detail ? { path: data.detail.path, hash: data.detail.hash, quote: scene.title } : undefined,
      estimated: value == null && estimate.estimated, note: value != null ? '来自本章细纲的场面计划' : estimate.reason };
  });
  const actualCursor = judged ? judged.points.findLastIndex(point => text.includes(point.anchor)) : -1;
  const onPoint = (point: CurveDatum) => {
    const match = !judged ? matches.find(value => value.scene === point.x - 1) : undefined;
    const quote = match?.quote ?? (judged ? point.source?.quote : undefined);
    if (run && quote && text.includes(quote)) {
      const event = new CustomEvent('wenxu:locate-prose', { cancelable: true, detail: { runId: run.id, quote } });
      window.dispatchEvent(event);
      if (!event.defaultPrevented && point.source) onSource(point.source);
    }
    else if (point.source) onSource(point.source);
  };
  return <div className="narrative-playback" data-stream-length={text.length} data-stream-id={run?.id} data-scene={current ?? -1}>
    <div className="playback-heading"><strong>第 {String(data.chapter).padStart(3, '0')} 章<span className={writing ? 'playback-live' : ''}>{writing ? text ? '正在写作' : '等待正文' : finished ? '正文已生成' : text ? '已暂停' : '细纲预览'}</span></strong>
      <span>{progress.characters.toLocaleString()} 字{plan.strength && <> · 计划强度 {plan.strength}/5</>}</span></div>
    <div className="curve-toolbar"><select aria-label="本章曲线维度" value={dimension} onChange={event => setDimension(event.target.value as NarrativeDimension)}>{Object.entries(narrativeDimensionNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <label className="curve-option"><input type="checkbox" checked={smooth} onChange={event => setSmooth(event.target.checked)} />平滑曲线</label></div>
    <NarrativeChart unit={narrativeDimensionNames[dimension]} smooth={smooth} series={[{ key: judged ? draft ? 'candidate' : 'actual' : 'plan', label: judged ? draft ? '草稿判断' : '正文判断' : points.some(p => p.estimated) ? '细纲预估' : '细纲计划',
      points, dashed: !judged || draft }]} labels={points.map(p => ({ x: p.x, label: `场面 ${p.x}` }))}
      cursor={judged ? actualCursor >= 0 ? actualCursor + 1 : undefined : current === undefined ? undefined : current + 1} onPoint={onPoint} />
    <div className="curve-position"><i className={writing ? 'live' : ''} /><span>{judged && actualCursor >= 0 ? `正文节点：${judged.points[actualCursor].label}` : current === undefined ? '尚未匹配到明确的正文场面' : `正文线索定位：${plan.scenes[current]?.title ?? ''}`}</span></div>
    <p className="curve-caption">{judged ? draft ? '草稿判断尚未采纳；数据随原有生成流程保存。' : '实线依据已采纳正文的场面判断。' : '虚线为细纲计划或本地规则预估，不代表正文评分。位置随已显示的完整段落线索更新。'}</p>
    <details className="curve-values"><summary>节点与依据</summary>{points.map(point => <button key={point.x} disabled={!point.source} onClick={() => onPoint(point)}><span>{point.x}. {point.label}</span><b>{point.value ?? '未记录'}{point.value !== null && '/5'}</b><small>{point.note}</small></button>)}</details>
  </div>;
}
