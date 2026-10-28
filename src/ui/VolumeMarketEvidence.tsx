import type { VolumeMarketResearch } from '../shared/volume-style';

export function VolumeMarketEvidence({ research }: { research?: VolumeMarketResearch }) {
  if (!research) return null;
  if (research.status === 'searching') return <p className="muted" role="status">正在核对番茄作品目录，随后生成分卷大纲…</p>;
  return <details className="title-style-reference">
    <summary>{research.status === 'ready' ? `本批卷名参考 · 已核对 ${research.sources.length} 本目录` : '本批卷名参考 · 未取得实时目录'}</summary>
    <p className="muted">检索题材：{[research.genre, ...research.tags].join('、')} · 核对时间：{research.checkedAt ? new Date(research.checkedAt).toLocaleString() : '未记录'}</p>
    {research.sources.map(source => <div key={source.url}>
      <p><a href={source.url} target="_blank" rel="noreferrer">《{source.title}》</a>{source.author && ` · ${source.author}`} · {source.categories.join('、')}</p>
      <p>{source.volumes.join(' / ')}</p>
    </div>)}
    <p className="muted">{research.message}</p>
  </details>;
}
