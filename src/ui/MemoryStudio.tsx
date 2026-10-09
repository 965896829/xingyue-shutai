import { useEffect, useRef, useState } from 'react';
import type { Fact, Snapshot } from '../shared/types';
import type { EntityState, SourceRef, MemoryScope } from '../shared/studio';
import { Editor } from './Editor';
import { useDialog } from './useDialog';

const kinds: Record<Fact['kind'], string> = {
  event: '事件',
  world_rule: '世界规则',
  author_constraint: '作者约定',
  plan: '计划',
  belief: '人物认知',
  inference: '推断'
};
const categories: Record<Fact['category'], string> = {
  character: '人物',
  relation: '关系',
  timeline: '时间线',
  hook: '伏笔',
  item: '物品',
  injury: '伤势',
  term: '规则',
  knowledge: '知情',
  promise: '承诺'
};
const ledgerNames: Record<string, string> = {
  timeline: '时间线',
  hooks: '伏笔',
  items: '物品与伤势',
  terms: '规则',
  knowledge: '知情'
};
export function SourceDialog({ source, onClose }: { source: SourceRef; onClose: () => void }) {
  const dialog = useRef<HTMLElement | null>(null);
  useDialog(dialog, true, onClose);
  const [data, setData] = useState<SourceRef & { content: string }>(),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window
      .wenxu!.invoke<SourceRef & { content: string }>('memory.trace', { ...source })
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [source]);
  return (
    <div className="scrim">
      <section
        ref={dialog}
        className="modal wide source-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="原文证据"
      >
        <header>
          <div>
            <h2>{source.path.split('/').at(-1)}</h2>
            <small>原文证据</small>
          </div>
          <button onClick={onClose} aria-label="关闭原文">
            ×
          </button>
        </header>
        {error ? (
          <p role="alert">{error}</p>
        ) : data ? (
          <Editor value={data.content} readOnly highlight={{ start: data.start!, end: data.end! }} />
        ) : (
          <p className="empty-state">读取中…</p>
        )}
      </section>
    </div>
  );
}
export function FactCard({
  fact,
  onSource,
  compact = false
}: {
  fact: Fact;
  onSource: (v: SourceRef) => void;
  compact?: boolean;
}) {
  return (
    <article className={`memory-fact ${compact ? 'compact' : ''}`}>
      <div className="memory-fact-title">
        <strong>{compact ? categories[fact.category] : fact.subject}</strong>
        <span>{kinds[fact.kind]}</span>
        {fact.mandatory && <i aria-label="持续约束" />}
      </div>
      <p>
        <span>{fact.predicate}</span>
        {fact.value}
      </p>
      <div className="memory-fact-meta">
        <span>{categories[fact.category]}</span>
        <span>
          第 {fact.fromChapter} 章{fact.toChapter !== null ? `—${fact.toChapter}` : ''}
        </span>
      </div>
      <details>
        <summary>证据 · {fact.evidence.length}</summary>
        {fact.evidence.map((e, i) => (
          <button className="evidence-quote" key={i} onClick={() => onSource(e)}>
            {e.quote}
            <span>查看原文 ↗</span>
          </button>
        ))}
        <dl>
          <dt>时间</dt>
          <dd>{fact.storyTime || '未知'}</dd>
          <dt>知情人物</dt>
          <dd>
            {fact.knowledge
              .filter((k) => k.mode !== 'unknown')
              .map((k) => (fact.entityIds.includes(k.who) ? fact.subject : k.who))
              .join('、') || '未知'}
          </dd>
        </dl>
      </details>
    </article>
  );
}
export function CharacterInspector({
  snapshot,
  onSource
}: {
  snapshot: Snapshot;
  onSource: (v: SourceRef) => void;
}) {
  const entities = [
    ...new Map(
      snapshot.facts.map((f) => [
        f.entityIds[0] || f.subject,
        { id: f.entityIds[0] || f.subject, name: f.subject }
      ])
    ).values()
  ];
  const [selected, setSelected] = useState(''),
    [state, setState] = useState<EntityState>(),
    [error, setError] = useState('');
  const entity = selected || entities[0]?.id;
  useEffect(() => {
    let active = true;
    if (!entity) {
      setState(undefined);
      return;
    }
    void window
      .wenxu!.invoke<EntityState>('state.getCharacter', {
        entityId: entity,
        scope: { chapter: snapshot.project?.chapter }
      })
      .then((v) => {
        if (active) {
          setState(v);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entity, snapshot.studio?.snapshot?.id]);
  return (
    <div className="character-inspector">
      <label className="sr-only" htmlFor="inspector-character">
        人物
      </label>
      <select id="inspector-character" value={entity ?? ''} onChange={(e) => setSelected(e.target.value)}>
        <option value="" disabled>
          选择人物
        </option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      {error && <p role="alert">{error}</p>}
      {state ? (
        <>
          <div className="character-heading">
            <h2>{state.name}</h2>
            <small>第 {state.chapter} 章</small>
          </div>
          {state.aliases.length > 0 && <p className="muted">{state.aliases.join(' · ')}</p>}
          {state.facts.map((f) => (
            <FactCard key={f.id} fact={f} compact onSource={onSource} />
          ))}
          {state.unknown.length > 0 && (
            <dl className="unknown-fields">
              {state.unknown.map((c) => (
                <div key={c}>
                  <dt>{categories[c as Fact['category']]}</dt>
                  <dd>未知</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : (
        <p className="empty-state">暂无人物记录</p>
      )}
    </div>
  );
}
export function MemoryStudio({
  snapshot,
  onSource,
  onRefresh
}: {
  snapshot: Snapshot;
  onSource: (v: SourceRef) => void;
  onRefresh: () => void;
}) {
  const p = snapshot.project!,
    [query, setQuery] = useState(''),
    [chapter, setChapter] = useState(p.chapter),
    [mode, setMode] = useState<'current' | 'historical'>('current'),
    [version, setVersion] = useState(''),
    [viewpoint, setViewpoint] = useState<MemoryScope['viewpoint']>('author'),
    [characterId, setCharacterId] = useState(''),
    [filter, setFilter] = useState('all'),
    [result, setResult] = useState<any>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [correction, setCorrection] = useState(''),
    [correctionKind, setCorrectionKind] = useState('extraction');
  const seq = useRef(0);
  const scope = {
    chapter,
    mode,
    ...(mode === 'historical' ? { snapshotId: version } : {}),
    viewpoint,
    ...(viewpoint === 'character' ? { characterId } : {})
  };
  async function search(append = false) {
    const n = ++seq.current;
    setBusy(true);
    setError('');
    try {
      const v: any = await window.wenxu!.invoke(query.trim() ? 'memory.retrieve' : 'memory.list', {
        query,
        scope,
        category: filter,
        offset: append ? (result?.facts?.length ?? 0) : 0
      });
      if (n === seq.current) setResult(append ? { ...v, facts: [...(result?.facts ?? []), ...v.facts] } : v);
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    void search();
  }, [snapshot.studio?.snapshot?.id, chapter, mode, version, viewpoint, characterId, filter]);
  const facts: Fact[] = (result?.facts ?? [])
    .map((x: any) => x.fact)
    .filter(
      (f: Fact) => filter === 'all' || f.category === filter || (filter === 'obligations' && f.mandatory)
    );
  return (
    <div className="memory-studio">
      <header className="studio-heading">
        <div>
          <span className="eyebrow">MEMORY</span>
          <h1>故事记忆</h1>
        </div>
        <span className="studio-count">{result?.total ?? facts.length} 条记录</span>
      </header>
      <form
        className="studio-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="检索故事记忆"
          placeholder="搜索人物、伏笔、物品…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" disabled={busy}>
          检索
        </button>
      </form>
      <div className="studio-controls">
        <label>
          截至
          <input
            aria-label="记忆章节"
            type="number"
            min={0}
            value={chapter}
            onChange={(e) => setChapter(Math.max(0, Number(e.target.value)))}
          />
          章
        </label>
        <select
          aria-label="回看方式"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            if (!version) setVersion(snapshot.studio?.snapshots[0]?.id ?? '');
          }}
        >
          <option value="current">当前版本</option>
          <option value="historical">历史快照</option>
        </select>
        {mode === 'historical' && (
          <select aria-label="历史快照" value={version} onChange={(e) => setVersion(e.target.value)}>
            {snapshot.studio?.snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.createdAt).toLocaleString()} · {s.revision}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="记忆视角"
          value={viewpoint}
          onChange={(e) => setViewpoint(e.target.value as typeof viewpoint)}
        >
          <option value="author">作者视角</option>
          <option value="reader">读者视角</option>
          <option value="character">人物视角</option>
        </select>
        {viewpoint === 'character' && (
          <select aria-label="视角人物" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
            <option value="">选择人物</option>
            {[...new Map(snapshot.facts.map((f) => [f.entityIds[0] || f.subject, f.subject])).entries()].map(
              ([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              )
            )}
          </select>
        )}
      </div>
      <nav className="memory-filters" aria-label="记忆分类">
        {[
          ['all', '全部'],
          ['character', '人物'],
          ['injury', '伤势'],
          ['item', '物品'],
          ['hook', '伏笔'],
          ['knowledge', '知情'],
          ['obligations', '待兑现']
        ].map(([v, label]) => (
          <button
            key={v}
            aria-pressed={filter === v}
            className={filter === v ? 'active' : ''}
            onClick={() => setFilter(v)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="inline-warning">
          {error}
        </p>
      )}
      {facts.length ? (
        <div className="memory-card-grid">
          {facts.map((f) => (
            <FactCard key={f.id} fact={f} onSource={onSource} />
          ))}
        </div>
      ) : (
        <div className="studio-empty">
          <span>◇</span>
          <p>{query ? '未找到相关记录' : '暂无可用记忆'}</p>
        </div>
      )}
      {result?.hasMore && !query.trim() && (
        <button disabled={busy} onClick={() => void search(true)}>
          加载更多
        </button>
      )}
      {result?.documents?.length > 0 && (
        <section className="memory-passages">
          <h3>相关原文</h3>
          {result.documents.map((d: any) => (
            <button
              key={d.path}
              onClick={() =>
                onSource({ path: d.path, hash: d.hash, quote: d.excerpt, start: d.start, end: d.end })
              }
            >
              <b>{d.path.split('/').at(-1)}</b>
              <p>{d.excerpt}</p>
            </button>
          ))}
        </section>
      )}
      <details className="studio-details">
        <summary>检索详情</summary>
        <div className="ledger-coverage">
          {result?.coverage?.map((c: any) => (
            <span key={c.ledger} data-status={c.status}>
              {ledgerNames[c.ledger]} ·{' '}
              {c.status === 'covered' ? c.count : c.status === 'missing' ? '待核对' : '无适用记录'}
            </span>
          ))}
        </div>
        <p>
          {result?.semantic === 'ready'
            ? '语义检索已启用'
            : result?.semantic === 'degraded'
              ? '语义检索暂不可用，已使用本地检索'
              : '本地检索'}
        </p>
        <div className="button-row">
          <button
            onClick={() =>
              void window
                .wenxu!.invoke('embedding.reindex')
                .then(onRefresh)
                .catch((e) => setError(e.message))
            }
          >
            更新语义索引
          </button>
          <button
            onClick={() => void window.wenxu!.invoke('embedding.cancel').catch((e) => setError(e.message))}
          >
            停止更新
          </button>
          <button
            onClick={() =>
              void window
                .wenxu!.invoke('memory.rebuild')
                .then(() => {
                  onRefresh();
                  void search();
                })
                .catch((e) => setError(e.message))
            }
          >
            核对记忆
          </button>
        </div>
        {snapshot.studio?.index && (
          <p>
            {snapshot.studio.index.count} 个片段 ·{' '}
            {snapshot.studio.index.status === 'ready'
              ? '已就绪'
              : snapshot.studio.index.status === 'building'
                ? '更新中'
                : '待更新'}
          </p>
        )}
        {result?.issues?.map((s: string) => (
          <p key={s}>{s}</p>
        ))}
      </details>
      <details className="studio-details">
        <summary>提出修正</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void window
              .wenxu!.invoke('state.proposeCorrection', { kind: correctionKind, request: correction })
              .then(() => {
                setCorrection('');
                onRefresh();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <select
            aria-label="修正类型"
            value={correctionKind}
            onChange={(e) => setCorrectionKind(e.target.value)}
          >
            <option value="extraction">记忆提取</option>
            <option value="plan">后续计划</option>
            <option value="story">故事修订</option>
            <option value="assessment">评估判断</option>
          </select>
          <textarea
            aria-label="修正内容"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="需要修正的记录与依据"
          />
          <button disabled={busy || !correction.trim()}>生成修正候选</button>
        </form>
      </details>
      {!!p.stale.length && (
        <details className="studio-details">
          <summary>待核对 · {p.stale.length}</summary>
          {p.stale.map((file) => (
            <div className="impact-item" key={file}>
              <span>{file.split('/').at(-1)}</span>
              <button
                onClick={() => {
                  const reason = prompt('核对结果');
                  if (reason)
                    void window
                      .wenxu!.invoke('impact.review', { path: file, reason })
                      .then(onRefresh)
                      .catch((e) => setError(e.message));
                }}
              >
                记录核对
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
