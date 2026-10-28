import { useEffect, useState } from 'react';
import type { Run, Snapshot } from '../shared/types';
import type { SourceRef } from '../shared/studio';
import type { CurveDatum, NarrativeData } from '../shared/narrative-curve';
import { invokeCommand } from '../shared/client';
import { NarrativePlayback } from './NarrativePlayback';
import { NarrativeChart } from './NarrativeChart';
import { NarrativeComparison } from './NarrativeComparison';
import './narrative-curve.css';

const pendingReads = new Map<string, Promise<NarrativeData>>();
function readOnce(key: string, input: { chapter: number; runId?: string; scope: 'batch' | 'book' }) {
  let read = pendingReads.get(key);
  if (!read) {
    read = invokeCommand('narrative.read', input); pendingReads.set(key, read);
    void read.catch(() => { pendingReads.delete(key); });
    if (pendingReads.size > 12) pendingReads.delete(pendingReads.keys().next().value!);
  }
  return read;
}

export function NarrativePanel({ snapshot, run, onSource }: { snapshot: Snapshot; run?: Run; onSource: (source: SourceRef) => void }) {
  const playback = run?.pipeline ? run : undefined, chapter = playback?.chapter ?? snapshot.project?.chapter ?? 1;
  const identity = `${snapshot.projectSessionId}:${playback?.id ?? chapter}`;
  const [choice, setChoice] = useState<{ key: string; open: boolean }>();
  const [view, setView] = useState<'chapter' | 'sequence' | 'dimensions'>('chapter'), [scope, setScope] = useState<'batch' | 'book'>('batch');
  const open = choice?.key === identity ? choice.open : !!playback;
  const [loaded, setLoaded] = useState<{ key: string; foundation: string; data?: NarrativeData; error?: string }>();
  const documents = JSON.stringify(snapshot.documents.filter(d => /^(?:05_长篇大纲|06_章节设计|08_章后更新|07_正文章节)\//.test(d.path))
    .map(d => [d.path, d.acceptedHash]));
  const foundation = `${identity}:${scope}:${documents}:${snapshot.project?.stale.join('|')}:${playback?.manifest?.id}`;
  const key = `${foundation}:${playback?.pipeline?.epoch}:${playback?.pipeline?.phase}:${playback?.pipeline?.proseHash}:${playback?.status}`;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void readOnce(key, { chapter, runId: playback?.id, scope }).then(data => {
      if (active) setLoaded({ key, foundation, data });
    }).catch(error => { if (active) setLoaded({ key, foundation, error: error.message }); });
    return () => { active = false; };
  }, [key, open]);
  const data = loaded?.foundation === foundation ? loaded.data : undefined;
  const rows = data?.chapters ?? [];
  const chapters = rows.flatMap((row, index) => index && row.chapter > rows[index - 1].chapter + 1 ? [rows[index - 1].chapter + 1, row.chapter] : [row.chapter]);
  const map = new Map(rows.map(row => [row.chapter, row]));
  const series = (kind: 'plan' | 'actual'): CurveDatum[] => chapters.map(n => ({ x: n, value: map.get(n)?.[kind] ?? null, label: `第 ${n} 章`,
    source: kind === 'plan' ? map.get(n)?.planSource : map.get(n)?.actualSource,
    note: kind === 'plan' ? '来自已保存的章节总纲、节奏或细纲' : '来自已保存的章后强度记录' }));
  return <section className={`narrative-panel ${open ? 'expanded' : ''}`}>
    <button className="narrative-toggle" aria-expanded={open} onClick={() => setChoice({ key: identity, open: !open })}><span>叙事节奏</span><span>{open ? '收起 ⌄' : '展开 ⌃'}</span></button>
    {open && <div className="narrative-content">
      <div className="curve-toolbar"><div className="curve-tabs" aria-label="曲线范围">{(['chapter', 'sequence', 'dimensions'] as const).map(value => <button key={value} aria-pressed={view === value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{{ chapter: '本章起伏', sequence: '章节走势', dimensions: '维度对照' }[value]}</button>)}</div>
        {view === 'sequence' && <select aria-label="章节走势范围" value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="batch">当前批次</option><option value="book">全书</option></select>}</div>
      {view === 'dimensions' ? <NarrativeComparison snapshot={snapshot} data={data} onSource={onSource} /> : data ? view === 'chapter' ? <NarrativePlayback snapshot={snapshot} run={playback} data={data} onSource={onSource} /> : <>
        <NarrativeChart axis="章节" smooth={false} series={[{ key: 'plan', label: '计划强度', points: series('plan'), dashed: true }, { key: 'actual', label: '章后记录', points: series('actual') }]}
          labels={chapters.map(n => ({ x: n, label: String(n) }))} cursor={chapter} onPoint={p => { if (p.source) onSource(p.source); }} />
        <p className="curve-caption">第 {data.range[0]}—{data.range[1]} 章 · 复用已有纲要与章后记录；缺少数据处留空。</p>
      </> : <div className="narrative-empty">{loaded?.key === key && loaded.error ? '曲线资料暂不可用，正文生成不受影响。' : '正在读取本地曲线资料…'}</div>}
      {!!data?.unavailable && <small className="curve-caption">部分资料暂不可用，已保留有来源的曲线节点。</small>}
    </div>}
  </section>;
}
