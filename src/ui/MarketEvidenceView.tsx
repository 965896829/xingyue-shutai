import type { MarketEvidence } from '../shared/market-evidence';
export function MarketEvidenceView({ evidence }: { evidence: MarketEvidence }) {
  return <section className="market-evidence">
    <p role="status">{({ ready: '样本已核验', partial: '部分资料可用', stale: '沿用历史样本', unavailable: '暂无样本', disabled: '未联网' })[evidence.status]} · {evidence.reason}</p>
    {evidence.effective && <p>{evidence.requested.channel === 'male' ? '男频' : '女频'} · {evidence.requested.label}{evidence.match === 'nearby' ? ` · 近邻参考：${evidence.effective.label}` : ''}</p>}
    {evidence.board && <p><a href={evidence.board.url} target="_blank" rel="noreferrer">{evidence.rankType === 'new_book' ? '新书榜' : '阅读榜'}</a> · 统计截止：{evidence.board.statsCutoffRaw ?? '未知'} · 采集：{new Date(evidence.board.observedAt).toLocaleString()}</p>}
    {!!evidence.samples.length && <ul>{evidence.samples.map(sample => <li key={sample.id}>
      <a href={sample.url} target="_blank" rel="noreferrer">{sample.title ? `《${sample.title}》` : '书名待核验'}</a> · 第{sample.rankPosition}名 · 在读 {sample.readCount?.value.toLocaleString() ?? '未知'} · 首发时间未知
    </li>)}</ul>}
    {!!evidence.samples.length && <p>仅采集首批前六名。在读数量不代表销量或书名效果。</p>}
  </section>;
}
