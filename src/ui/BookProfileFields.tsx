import { useEffect, useRef, useState } from 'react';
import { invokeCommand } from '../shared/client';
import { comparePublishingSnapshots, publishingGroupLabels, type BookProfile, type PublishingChannel, type PublishingSnapshot } from '../shared/publishing';
import { MarketEvidenceView } from './MarketEvidenceView';
import type { MarketEvidence } from '../shared/market-evidence';

export function BookProfileFields({ value, onChange, snapshots: initialSnapshots, disabled = false }: {
  value: BookProfile; onChange: (value: BookProfile) => void; snapshots: PublishingSnapshot[]; disabled?: boolean;
}) {
  const [snapshots, setSnapshots] = useState(initialSnapshots), [refreshing, setRefreshing] = useState(false), [message, setMessage] = useState('');
  const [genres, setGenres] = useState(value.creativeGenres.join('、'));
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<MarketEvidence | null>(null), [marketBusy, setMarketBusy] = useState(false), [reference, setReference] = useState('');
  const marketSeq = useRef(0);
  useEffect(() => { marketSeq.current++; setMarket(null); setReference(''); setMarketBusy(false); }, [value.publishing?.channel, value.publishing?.reading.main, value.publishing?.snapshotId]);
  const emittedGenres = useRef(value.creativeGenres.join('\0'));
  useEffect(() => { setSnapshots(initialSnapshots); }, [initialSnapshots]);
  useEffect(() => {
    const key = value.creativeGenres.join('\0');
    if (key !== emittedGenres.current) { setGenres(value.creativeGenres.join('、')); emittedGenres.current = key; }
  }, [value.creativeGenres]);
  const latest = snapshots[0], choice = value.publishing;
  const catalog = snapshots.find(s => s.id === choice?.snapshotId) ?? latest;
  const changeChannel = (channel: string) => {
    if (!channel) { onChange({ ...value, publishing: null }); return; }
    if (!catalog) return;
    onChange({ ...value, publishing: { platform: 'fanqie', form: 'original_long', channel: channel as PublishingChannel,
      snapshotId: catalog.id, reading: { main: '', theme: [], role: [], plot: [] } } });
  };
  const changeTag = (field: 'theme' | 'role' | 'plot', id: string) => {
    if (!choice) return;
    const old = choice.reading[field];
    const selected = old.includes(id) ? old.filter(v => v !== id) : old.length < 2 ? [...old, id] : old;
    onChange({ ...value, publishing: { ...choice, reading: { ...choice.reading, [field]: selected } } });
  };
  const diff = catalog && latest && latest.id !== catalog.id ? comparePublishingSnapshots(catalog, latest) : null;
  const main = catalog?.options.find(o => o.id === choice?.reading.main);
  const rank = main && catalog?.ranks.find(r => r.channel === main.channel && r.platformId === main.platformId);
  return <div className="book-profile-fields">
    <label>创作题材（可混搭）<input value={genres} disabled={disabled} maxLength={1200} placeholder="例如：都市日常、悬疑调查，也可自定义"
      onChange={e => { const text = e.target.value; setGenres(text); const next = [...new Set(text.split(/[、,，;；\n]/).map(v => v.trim()).filter(Boolean))]; emittedGenres.current = next.join('\0'); onChange({ ...value, creativeGenres: next }); }} /></label>
    <div className="form-grid">
      <label>番茄发布频道<select aria-label="番茄发布频道" value={choice?.channel ?? ''} disabled={disabled || !catalog} onChange={e => changeChannel(e.target.value)}>
        <option value="">暂不选择</option><option value="male">男频</option><option value="female">女频</option>
      </select></label>
      {choice && catalog && <label>番茄主分类<select aria-label="番茄主分类" required value={choice.reading.main} disabled={disabled}
        onChange={e => onChange({ ...value, publishing: { ...choice, reading: { ...choice.reading, main: e.target.value } } })}>
        <option value="">请选择主分类</option>
        {catalog.options.filter(o => o.channel === choice.channel && o.group === 'reading.main').map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select></label>}
    </div>
    {choice && catalog && <details><summary>补充阅读标签</summary>
      <label>搜索阅读标签<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入主题、角色或情节" /></label>
      {(['theme', 'role', 'plot'] as const).map(field => <details key={field}><summary>{publishingGroupLabels[`reading.${field}`]} · {choice.reading[field].length}/2</summary>
        <div className="tag-options">{catalog.options.filter(o => o.channel === choice.channel && o.group === `reading.${field}` && (o.label.includes(query.trim()) || choice.reading[field].includes(o.id))).map(o => <label key={o.id}>
          <input type="checkbox" checked={choice.reading[field].includes(o.id)} disabled={disabled || (!choice.reading[field].includes(o.id) && choice.reading[field].length >= 2)} onChange={() => changeTag(field, o.id)} />{o.label}
        </label>)}</div>
      </details>)}
    </details>}
    <details className="tag-policy"><summary>分类来源与更新</summary>
      {catalog ? <>
        <p>公开书库分类 · {catalog.observedAt.slice(0, 10)} · 男频 {catalog.options.filter(o => o.channel === 'male').length} 项，女频 {catalog.options.filter(o => o.channel === 'female').length} 项。</p>
        <p>用于番茄原创长篇归类。创作题材可混搭，发布规则以作家后台的实际作品页面为准。</p>
        {main && <p>{rank ? <a href={rank.url} target="_blank" rel="noreferrer">查看{main.label}榜单</a> : '该分类暂无同频道榜单入口。'}</p>}
        {main && choice && <details><summary>书名与榜单样本</summary>
          <label>参考分类<select value={reference} disabled={marketBusy} onChange={e => { setReference(e.target.value); setMarket(null); }}>
            <option value="">使用当前分类</option>{catalog.options.filter(o => o.channel === choice.channel && o.group === 'reading.main' && o.id !== main.id && catalog.ranks.some(r => r.channel === o.channel && r.platformId === o.platformId)).map(o => <option key={o.id} value={o.platformId}>{o.label}（近邻参考）</option>)}
          </select></label>
          <button type="button" disabled={marketBusy || disabled} onClick={async () => {
            const seq = ++marketSeq.current; setMarketBusy(true); setMessage('');
            try { const evidence = await invokeCommand('publishing.market', { catalogId: catalog.id, channel: choice.channel, categoryId: main.platformId, rankType: 'reading', ...(reference ? { referenceCategoryId: reference } : {}) }); if (seq === marketSeq.current) setMarket(evidence); }
            catch (error) { if (seq === marketSeq.current) setMessage((error as Error).message); }
            finally { if (seq === marketSeq.current) setMarketBusy(false); }
          }}>{marketBusy ? '正在读取…' : '读取公开榜单'}</button>
          {market && <MarketEvidenceView evidence={market} />}
        </details>}
        <details><summary>榜单目录 · {catalog.ranks.length} 个入口</summary><div className="tag-options">
          {catalog.ranks.map(r => <a key={r.id} href={r.url} target="_blank" rel="noreferrer">{r.channel === 'male' ? '男频' : '女频'} · {r.label}</a>)}
        </div><p>榜单目录核对于 {catalog.ranksObservedAt.slice(0, 10)}，与书库分类分别保存。</p></details>
      </> : <p role="alert">分类目录暂不可用，可以先填写创作题材。</p>}
      <button type="button" disabled={disabled || refreshing} onClick={async () => {
        setRefreshing(true); setMessage('');
        try { const result = await invokeCommand('publishing.refresh', {}); setMessage(result.message);
          if (result.updated) setSnapshots(old => [result.catalog, ...old.filter(s => s.id !== result.catalog.id)]);
        } catch (error) { setMessage((error as Error).message); } finally { setRefreshing(false); }
      }}>{refreshing ? '正在更新…' : '检查分类更新'}</button>
      {message && <p role="status">{message}</p>}
      {diff && choice && latest && <div>
        <p>新版目录：新增 {diff.added.length} 项，未返回 {diff.removed.length} 项，改名 {diff.renamed.length} 项。当前作品继续使用原目录。</p>
        {(diff.removed.length > 0 || diff.renamed.length > 0) && <p>{[...diff.removed.map(o => `${o.label}（未返回）`), ...diff.renamed.map(o => `${o.label}（改名）`)].join('、')}</p>}
        <button type="button" disabled={disabled} onClick={() => {
          const available = new Set(latest.options.filter(o => o.channel === choice.channel).map(o => o.id));
          onChange({ ...value, publishing: { ...choice, snapshotId: latest.id, reading: {
            main: available.has(choice.reading.main) ? choice.reading.main : '',
            theme: choice.reading.theme.filter(id => available.has(id)), role: choice.reading.role.filter(id => available.has(id)), plot: choice.reading.plot.filter(id => available.has(id))
          } } });
        }}>使用新版目录</button>
      </div>}
    </details>
  </div>;
}
