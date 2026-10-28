import { useState } from 'react';
import { dimensions, type Dimension, type SourceRef } from '../shared/studio';
import type { Snapshot } from '../shared/types';
import type { CurveDatum, NarrativeData } from '../shared/narrative-curve';
import { narrativeDimensionNames } from '../shared/narrative-dimensions';
import { NarrativeChart } from './NarrativeChart';

export function NarrativeComparison({ snapshot, data, onSource }: { snapshot: Snapshot; data?: NarrativeData; onSource: (source: SourceRef) => void }) {
  const [dimension, setDimension] = useState<Dimension>('pressure');
  const records = snapshot.studio?.assessments.filter(value => !value.stale && value.projectId === snapshot.project?.id) ?? [];
  const chapters = [...new Set([...records.map(value => value.chapter), ...data?.chapters.filter(row => row.planValues || row.actualValues || row.candidateValues).map(row => row.chapter) ?? []])].sort((a, b) => a - b);
  const labels = chapters.flatMap((chapter, index) => index && chapter > chapters[index - 1] + 1 ? [chapters[index - 1] + 1, chapter] : [chapter]);
  const series = (['plan', 'accepted', 'candidate'] as const).map(track => ({ key: track, label: { plan: '计划', accepted: '已采纳正文', candidate: '本章草稿' }[track], dashed: track !== 'accepted',
    points: labels.map(chapter => {
      const record = records.filter(record => record.track === track && record.chapter === chapter).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const row = data?.chapters.find(row => row.chapter === chapter), kind = track === 'accepted' ? 'actual' : track;
      return { x: chapter, label: `第 ${chapter} 章`, value: row?.[`${kind}Values`]?.[dimension] ?? record?.values[dimension] ?? null,
        source: row?.[`${kind}Values`]?.[dimension] != null ? row[`${kind}Source`] : record?.evidence[0], note: record?.note ?? '来自原有生成流程保存的全章判断' } satisfies CurveDatum;
    }) }));
  return <div className="narrative-comparison"><select aria-label="对照维度" value={dimension} onChange={event => setDimension(event.target.value as Dimension)}>{dimensions.map(value => <option value={value} key={value}>{narrativeDimensionNames[value]}</option>)}</select>
    <NarrativeChart axis="章节" unit={narrativeDimensionNames[dimension]} smooth={false} series={series} labels={labels.map(x => ({ x, label: String(x) }))} onPoint={point => { if (point.source) onSource(point.source); }} empty="尚无已保存的维度判断，可在本章起伏查看细纲预估" />
    <p className="curve-caption">仅对照已有判断，缺项留空；此面板不会另外请求模型评估。计划预估与正文判断分开显示。</p>
  </div>;
}
