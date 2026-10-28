import type { TitleMarketResearch } from '../shared/title-style';

export function TitleMarketEvidence({ research }: { research?: TitleMarketResearch }) {
  if (!research) return null;
  if (research.status === 'searching') return <p role="status">正在检索番茄同题材书名，完成后继续生成候选…</p>;
  if (research.status !== 'ready') return <p className="muted" role="status">番茄实时参考未取得：{research.message}</p>;
  return <details className="title-style-reference">
    <summary>本批番茄检索资料 · {research.sources.length} 本</summary>
    <p className="muted">检索题材：{[research.genre, ...research.tags].join('、')} · 检索时间：{research.checkedAt ? new Date(research.checkedAt).toLocaleString() : '未记录'}</p>
    <ul>{research.sources.map(source => <li key={source.url}>
      <a href={source.url} target="_blank" rel="noreferrer">《{source.title}》</a>
    </li>)}</ul>
    {research.styleBrief && <details>
      <summary>检索中的表达分析与匹配提醒</summary>
      <p className="muted">以下是检索模型的分析，供命名参考，不是番茄官方结论。</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{research.styleBrief}</p>
    </details>}
    <p className="muted">{research.message} 仅借鉴表达方式，不照搬书名；未进行平台全站查重。</p>
  </details>;
}
