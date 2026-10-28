import { useId, useState } from 'react';
import type { Run, Snapshot } from '../shared/types';
import type { SourceRef } from '../shared/studio';
import { projectionCategoryNames, type ProjectionCharacter, type ProjectionEntry, type ProjectionField } from '../shared/manuscript-view';
import { useManuscriptView } from './useManuscriptView';
import './manuscript-inspector.css';

type Props = { snapshot: Snapshot; run?: Run; onSource: (source: SourceRef) => void };
const fieldNames = ['稳定档案', '目标与情绪', '当前状态与限制', '后续计划'] as const;
const group = (label: string) => /后续|未来|爽点/.test(label) ? 3 : /目标|心情|情绪|动机/.test(label) ? 1 : /地点|伤势|物品|能力|限制|最后行动|当前状态|当前身份/.test(label) ? 2 : 0;
const kindNames: Record<string, string> = { event: '正文事件', plan: '计划', author_constraint: '作者设定', world_rule: '世界规则', belief: '人物认知', inference: '推断', record_note: '资料说明' };
const matchesCharacter = (entry: ProjectionEntry, character: ProjectionCharacter) => [character.name, character.id, ...character.aliases].some(name =>
  name && [entry.title, entry.from, entry.to, ...entry.fields.filter(field => /角色|人物|持有|所属|对象/.test(field.label)).map(field => field.value)].some(text => text?.includes(name)));

function Fields({ fields, onSource }: { fields: ProjectionField[]; onSource: Props['onSource'] }) {
  return <dl className="projection-fields">{fields.map((field, index) => <div key={`${field.label}:${index}`} className={field.previous ? 'changed' : ''}>
    <dt>{field.label}{field.previous && <span>本章变化</span>}</dt>
    <dd><button className="projection-value" onClick={() => onSource(field.source)} title="查看这条内容的原文来源">{field.value}</button>
      {field.previous && <details><summary>原记录</summary><p>{field.previous}</p></details>}</dd>
  </div>)}</dl>;
}
function Entry({ entry, onSource }: { entry: ProjectionEntry; onSource: Props['onSource'] }) {
  return <article className={`projection-entry ${entry.track}`}><header><strong>{entry.title}</strong><span>{entry.track === 'draft' ? '本章草稿' : '已保存档案'}{entry.kind ? ` · ${kindNames[entry.kind] ?? entry.kind}` : ''}</span></header>
    <Fields fields={entry.fields} onSource={onSource} /></article>;
}
function ScopeHeader({ snapshot, draft, setDraft, available }: { snapshot: Snapshot; draft: boolean; setDraft: (value: boolean) => void; available?: boolean }) {
  return <div className="projection-scope"><div><strong>第 {String(snapshot.project?.chapter ?? 1).padStart(3, '0')} 章</strong><span>作者视图</span></div>
    <label><input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />显示本章草稿变化</label>
    {draft && available && <small>草稿与已保存资料一同展示，尚未写入正式记忆。</small>}</div>;
}

export function CharacterInspector({ snapshot, run, onSource }: Props) {
  const [selected, setSelected] = useState(''), [draft, setDraft] = useState(true);
  const result = useManuscriptView(snapshot, run, draft), data = result?.data;
  const character = data?.characters.find(character => character.id === selected) ?? data?.characters[0];
  const related = character ? data?.entries.filter(entry => matchesCharacter(entry, character)) ?? [] : [];
  return <div className="manuscript-inspector"><ScopeHeader snapshot={snapshot} draft={draft} setDraft={setDraft} available={data?.draftAvailable} />
    {!data ? <p className="empty-state">{result?.error ? `人物资料读取失败：${result.error}` : '正在读取人物资料…'}</p> : !character ? <p className="empty-state">还没有可读取的人物档案。生成角色卡后会在这里自动展示。</p> : <>
      <label className="sr-only" htmlFor="inspector-character">人物</label><select id="inspector-character" value={character.id} onChange={event => setSelected(event.target.value)}>
        {data.characters.map(character => <option value={character.id} key={character.id}>{character.name}</option>)}
      </select>
      <div className="projection-character-heading"><div><h2>{character.name}</h2><small>{character.aliases.join(' · ') || character.id}</small></div>
        <span className={`projection-track ${character.track}`}>{character.track === 'draft' ? '含草稿变化' : '已保存档案'}</span></div>
      {([1, 2, 0, 3] as const).map(index => { const title = fieldNames[index], fields = character.fields.filter(field => group(field.label) === index); return fields.length > 0 && <details className="projection-group" key={title} open={index === 1 || index === 2}>
        <summary>{title}<span>{fields.length}</span></summary><Fields fields={fields} onSource={onSource} /></details>; })}
      {(['fact', 'behavior', 'relation', 'item', 'injury', 'knowledge', 'hook', 'promise'] as const).map(category => {
        const entries = related.filter(entry => entry.category === category);
        return entries.length > 0 && <details className="projection-group" key={category}><summary>{projectionCategoryNames[category]}<span>{entries.length}</span></summary>
          {entries.map(entry => <Entry key={entry.id} entry={entry} onSource={onSource} />)}</details>;
      })}
      {!related.some(entry => ['item', 'injury', 'knowledge'].includes(entry.category)) && <p className="projection-note">尚无可对应的物品、伤势或知情记录，未补填默认状态。</p>}
    </>}
    {!!data?.unavailable.length && <p className="projection-note">{data.unavailable.length} 份资料暂不可用或已过期；其内容未作为当前状态展示。</p>}
  </div>;
}

function RelationshipGraph({ entries, selected, onSelect, onSource }: { entries: ProjectionEntry[]; selected: string; onSelect: (value: string) => void; onSource: Props['onSource'] }) {
  const id = useId().replace(/:/g, ''), all = [...new Set(entries.flatMap(entry => [entry.from!, entry.to!]))];
  const center = all.includes(selected) ? selected : all[0];
  const edges = entries.filter(entry => entry.from === center || entry.to === center).slice(0, 12);
  const nodes = [center, ...new Set(edges.flatMap(entry => [entry.from!, entry.to!]).filter(name => name !== center))].filter(Boolean);
  const position = (name: string) => { const index = nodes.indexOf(name); return index === 0 ? { x: 210, y: 140 } : { x: 210 + Math.cos((index - 1) * Math.PI * 2 / Math.max(1, nodes.length - 1) - Math.PI / 2) * 151, y: 140 + Math.sin((index - 1) * Math.PI * 2 / Math.max(1, nodes.length - 1) - Math.PI / 2) * 102 }; };
  return <div className="relationship-view"><label>关系中心<select aria-label="关系中心人物" value={center ?? ''} onChange={event => onSelect(event.target.value)}>{all.map(name => <option key={name}>{name}</option>)}</select></label>
    <svg viewBox="0 0 420 280" role="group" aria-label="人物有向关系图"><defs><marker id={`${id}-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 Z" /></marker></defs>
      {edges.map(entry => { const a = position(entry.from!), b = position(entry.to!), dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1;
        return <g key={entry.id} className={`relationship-edge ${entry.track}`}><line x1={a.x + dx / distance * 26} y1={a.y + dy / distance * 26} x2={b.x - dx / distance * 30} y2={b.y - dy / distance * 30} markerEnd={`url(#${id}-arrow)`} />
          <line className="relationship-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} role="button" tabIndex={0} aria-label={`${entry.title}，查看关系来源`} onClick={() => onSource(entry.source)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSource(entry.source); } }}><title>{entry.title}</title></line></g>; })}
      {nodes.map(name => { const p = position(name); return <g key={name} transform={`translate(${p.x},${p.y})`} className={name === center ? 'relationship-node selected' : 'relationship-node'} role="button" tabIndex={0} aria-label={`查看${name}的关系`} onClick={() => onSelect(name)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(name); } }}>
        <circle r="25" /><text textAnchor="middle" y="4">{name.replace(/[（(].*$/, '').slice(0, 6)}</text></g>; })}
    </svg><p className="projection-note">箭头按档案 A→B 展示；虚线为草稿关系。仅展示所选人物的直接关系，不推断未记录的关系或信任数值。</p>
    {edges.map(entry => <Entry key={entry.id} entry={entry} onSource={onSource} />)}</div>;
}

export function StoryInspector({ snapshot, run, onSource }: Props) {
  const [draft, setDraft] = useState(true), [tab, setTab] = useState<ProjectionEntry['category']>('relation'), [person, setPerson] = useState('');
  const result = useManuscriptView(snapshot, run, draft), data = result?.data;
  const entries = data?.entries.filter(entry => entry.category === tab) ?? [];
  const relations = entries.filter(entry => entry.from && entry.to);
  return <div className="manuscript-inspector story-inspector"><ScopeHeader snapshot={snapshot} draft={draft} setDraft={setDraft} available={data?.draftAvailable} />
    <div className="story-view-tabs" aria-label="故事资料类型">{(['relation', 'timeline', 'hook', 'promise', 'item', 'injury', 'knowledge', 'term'] as const).map(category => <button key={category} aria-pressed={tab === category} className={tab === category ? 'active' : ''} onClick={() => setTab(category)}>{projectionCategoryNames[category]}<small>{data?.entries.filter(entry => entry.category === category).length ?? '…'}</small></button>)}</div>
    {!data ? <p className="empty-state">{result?.error ? `故事资料读取失败：${result.error}` : '正在读取故事资料…'}</p> : !entries.length ? <p className="empty-state">当前资料尚无{projectionCategoryNames[tab]}记录。已有内容更新后会自动展示。</p> : tab === 'relation' && relations.length ? <><RelationshipGraph entries={relations} selected={person} onSelect={setPerson} onSource={onSource} />{entries.filter(entry => !entry.from || !entry.to).map(entry => <Entry key={entry.id} entry={entry} onSource={onSource} />)}</> : tab === 'timeline' ?
      <ol className="story-timeline">{entries.map(entry => <li key={entry.id}><div className="story-time-label"><span>阅读顺序 · {entry.chapter || '未注明章节'}</span><span>故事时间 · {entry.storyTime || '未注明'}</span></div><Entry entry={entry} onSource={onSource} /></li>)}</ol> : entries.map(entry => <Entry key={entry.id} entry={entry} onSource={onSource} />)}
  </div>;
}

export function ManuscriptCoverage({ snapshot, run }: Omit<Props, 'onSource'>) {
  const result = useManuscriptView(snapshot, run, true), data = result?.data, index = snapshot.studio?.index;
  return <section className="manuscript-coverage"><h3>资料连接</h3>
    <p>{data ? `${data.characters.length} 位人物 · ${data.entries.length} 条可追溯资料` : '正在读取本地资料…'}</p>
    <dl className="coverage-counts">{(['relation', 'timeline', 'hook', 'item', 'knowledge'] as const).map(category => <div key={category}><dt>{projectionCategoryNames[category]}</dt><dd>{data?.entries.filter(entry => entry.category === category).length ?? '—'}</dd></div>)}</dl>
    <p>正式记忆 {snapshot.facts.length} 条 · 过期资料 {snapshot.project?.stale.length ?? 0} 份</p>
    <p>{index ? `检索索引：${index.count} 块 · ${index.watermark === snapshot.studio?.snapshot?.id ? '已同步当前版本' : '尚未同步当前版本'}` : '检索索引尚未建立；档案展示仍可直接读取本地文件。'}</p>
    {!!data?.unavailable.length && <details><summary>未参与当前展示的资料（{data.unavailable.length}）</summary>{data.unavailable.map(path => <p key={path}>{path}</p>)}</details>}
  </section>;
}
