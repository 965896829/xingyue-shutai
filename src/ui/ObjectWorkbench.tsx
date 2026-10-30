import { useEffect, useId, useMemo, useState } from 'react';
import type { Snapshot } from '../shared/types';
import type { MemoryScope, SourceRef } from '../shared/studio';
import type { WorkbenchBinding, WorkbenchField, WorkbenchObject, WorkbenchView } from '../shared/workbench';
import { invokeCommand } from '../shared/client';
import { ChatWorkspace } from './ChatWorkspace';
import { PlotWorkbench } from './PlotWorkbench';
import { WorldWorkbench } from './WorldWorkbench';
import { CharacterWorkbench } from './CharacterWorkbench';
import { WorkbenchCandidates } from './WorkbenchCandidates';
import { plotWorkbenchObject } from '../shared/workbench';
import type { PlotNode } from '../shared/workbench-visual';
import './object-workbench.css';

const groups = [
  ['character', '人物'],
  ['relation', '关系'],
  ['plot', '剧情'],
  ['world', '世界']
] as const;
type Group = (typeof groups)[number][0];
const groupOf = (o: WorkbenchObject): Group =>
  o.kind === 'character'
    ? 'character'
    : o.kind === 'relation'
      ? 'relation'
      : ['world', 'term'].includes(o.kind)
        ? 'world'
        : 'plot';
const kindNames: Record<string, string> = {
  timeline: '事件',
  hook: '伏笔',
  promise: '承诺与计划',
  item: '物品',
  injury: '伤势',
  knowledge: '知情',
  behavior: '行动',
  fact: '记录',
  world: '世界设定',
  term: '规则',
  relation: '人物关系',
  character: '人物',
  plot: '剧情'
};

function ObjectRelations({
  objects,
  selected,
  onSelect
}: {
  objects: WorkbenchObject[];
  selected?: WorkbenchObject;
  onSelect: (object: WorkbenchObject) => void;
}) {
  const marker = useId().replaceAll(':', ''),
    [center, setCenter] = useState('');
  const relations = objects.filter((o) => o.kind === 'relation' && o.from && o.to);
  const names = [...new Set(relations.flatMap((o) => [o.from!, o.to!]))];
  const current = names.includes(center) ? center : (selected?.from ?? names[0]);
  const all = relations.filter((o) => o.from === current || o.to === current),
    edges = all.slice(0, 12);
  const nodes = [
    current,
    ...new Set(edges.flatMap((o) => [o.from!, o.to!]).filter((v) => v !== current))
  ].filter(Boolean);
  const character = (name: string) =>
    objects.find((o) => o.kind === 'character' && (o.entityIds.includes(name) || o.title === name));
  const title = (name: string) => character(name)?.title ?? name;
  const point = (name: string) => {
    const i = nodes.indexOf(name);
    return i === 0
      ? { x: 220, y: 145 }
      : {
          x: 220 + Math.cos(((i - 1) * Math.PI * 2) / Math.max(1, nodes.length - 1)) * 160,
          y: 145 + Math.sin(((i - 1) * Math.PI * 2) / Math.max(1, nodes.length - 1)) * 105
        };
  };
  if (!relations.length) return null;
  return (
    <section className="object-relations">
      <label>
        关系中心
        <select aria-label="画布关系中心" value={current} onChange={(e) => setCenter(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {title(n)}
            </option>
          ))}
        </select>
      </label>
      <svg viewBox="0 0 440 290" aria-label="对象关系图" role="group">
        <defs>
          <marker
            id={marker}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 Z" />
          </marker>
        </defs>
        {edges.map((o) => {
          const a = point(o.from!),
            b = point(o.to!),
            distance = Math.hypot(b.x - a.x, b.y - a.y) || 1,
            dx = (b.x - a.x) / distance,
            dy = (b.y - a.y) / distance;
          return (
            <g key={o.id} className={o.track === 'plan' ? 'planned' : ''}>
              <line
                x1={a.x + dx * 28}
                y1={a.y + dy * 28}
                x2={b.x - dx * 32}
                y2={b.y - dy * 32}
                markerEnd={`url(#${marker})`}
              />
              <line
                className="object-edge-hit"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                role="button"
                tabIndex={0}
                aria-label={`选择关系：${o.title}`}
                onClick={() => onSelect(o)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(o);
                  }
                }}
              />
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = point(n);
          return (
            <g
              key={n}
              transform={`translate(${p.x} ${p.y})`}
              role="button"
              tabIndex={0}
              aria-label={`查看人物：${title(n)}`}
              onClick={() => {
                setCenter(n);
                const c = character(n);
                if (c) onSelect(c);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCenter(n);
                  const c = character(n);
                  if (c) onSelect(c);
                }
              }}
            >
              <circle r="27" />
              <text y="5" textAnchor="middle">
                {title(n).slice(0, 7)}
              </text>
            </g>
          );
        })}
      </svg>
      {all.length > edges.length && (
        <small>
          显示 {edges.length} / {all.length} 条直接关系
        </small>
      )}
    </section>
  );
}

export function ObjectWorkbench({
  snapshot,
  profileId,
  setProfileId,
  refresh,
  onRun,
  onSource,
  onDocument,
  onSettings
}: {
  snapshot: Snapshot;
  profileId: string;
  setProfileId: (id: string) => void;
  refresh: () => Promise<void>;
  onRun: (id?: string) => void;
  onSource: (source: SourceRef) => void;
  onDocument: (path: string) => void;
  onSettings: () => void;
}) {
  const project = snapshot.project!;
  const [scope, setScope] = useState<MemoryScope>({
    projectId: project.id,
    chapter: project.chapter,
    mode: 'current',
    viewpoint: 'author',
    worldId: 'main',
    timelineId: 'main'
  });
  const [group, setGroup] = useState<Group>('character'),
    [selected, setSelected] = useState(''),
    [query, setQuery] = useState(''),
    [limit, setLimit] = useState(80);
  const [data, setData] = useState<WorkbenchView>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [nonce, setNonce] = useState(0);
  const [editing, setEditing] = useState<WorkbenchField>(),
    [value, setValue] = useState('');
  const [chats, setChats] = useState<Record<string, string>>({}),
    [chatOpen, setChatOpen] = useState(false);
  const [discussionField, setDiscussionField] = useState<string>(),
    [candidateNonce, setCandidateNonce] = useState(0),
    [candidateId, setCandidateId] = useState<string>();
  const [allFields, setAllFields] = useState(false);
  const [projectedObject, setProjectedObject] = useState<WorkbenchObject>();
  const scopeKey = JSON.stringify(scope);
  const selectionKey = `workbench-selection:${project.id}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(selectionKey) ?? 'null');
      if (saved && groups.some(([g]) => g === saved.group)) {
        setGroup(saved.group);
        setSelected(saved.selected ?? '');
      }
    } catch {}
  }, [selectionKey]);
  useEffect(() => {
    if (selected)
      try {
        localStorage.setItem(selectionKey, JSON.stringify({ group, selected }));
      } catch {}
  }, [selectionKey, group, selected]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setEditing(undefined);
    setDiscussionField(undefined);
    setData(undefined);
    setProjectedObject(undefined);
    setError('');
    if (
      (scope.viewpoint === 'character' && !scope.characterId) ||
      (scope.mode === 'historical' && !scope.snapshotId)
    ) {
      setLoading(false);
      return;
    }
    void invokeCommand('workbench.read', { scope })
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scopeKey, project.revision, snapshot.projectSessionId, nonce]);
  const visible = useMemo(
    () =>
      (data?.objects ?? []).filter(
        (o) =>
          groupOf(o) === group &&
          (!query || o.title.includes(query) || o.fields.some((f) => f.value.includes(query)))
      ),
    [data, group, query]
  );
  const object =
    visible.find((o) => o.id === selected) ??
    (projectedObject?.id === selected && groupOf(projectedObject) === group ? projectedObject : undefined) ??
    visible[0];
  const binding: WorkbenchBinding | undefined =
    data && object
      ? { projectId: data.projectId, snapshotId: data.snapshotId, objectId: object.id, scope: data.scope }
      : undefined;
  const discussionBinding = binding
    ? { ...binding, ...(discussionField ? { fieldId: discussionField } : {}) }
    : undefined;
  const bindingKey = discussionBinding ? JSON.stringify(discussionBinding) : '';
  const conversationId =
    chats[bindingKey] ??
    snapshot.conversations?.find(
      (c) => c.objectBinding && JSON.stringify(c.objectBinding) === bindingKey && !c.archived
    )?.id;
  const acting = loading || busy || !!snapshot.chatBusy || snapshot.runs.some((r) => r.status === 'running');
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectObject = (next: WorkbenchObject) => {
    setGroup(groupOf(next));
    setSelected(next.id);
    setEditing(undefined);
    setQuery('');
    setDiscussionField(undefined);
    setAllFields(false);
  };
  const scopeBinding = data
    ? { projectId: data.projectId, snapshotId: data.snapshotId, scope: data.scope }
    : undefined;
  const madeCandidate = async (id: string) => {
    setCandidateId(id);
    setCandidateNonce((n) => n + 1);
    await refresh();
  };
  const discuss = async (fieldId?: string) => {
    if (!binding) return;
    const next = { ...binding, ...(fieldId ? { fieldId } : {}) };
    const c = await invokeCommand('workbench.discuss', { binding: next });
    setDiscussionField(fieldId);
    setChats((chats) => ({ ...chats, [JSON.stringify(next)]: c.id }));
    setChatOpen(true);
    await refresh();
  };
  const selectId = (id: string, node?: PlotNode) => {
    const next = data?.objects.find((o) => o.id === id);
    if (next) selectObject(next);
    else if (node) {
      const projected = plotWorkbenchObject(node);
      setProjectedObject(projected);
      selectObject(projected);
    } else setSelected(id);
  };
  const characters = [
    ...new Map(
      snapshot.facts
        .filter((f) => f.category === 'character')
        .flatMap((f) => f.entityIds.slice(0, 1).map((id) => [id, f.subject] as const))
    )
  ];
  return (
    <section className="object-workbench" aria-label="共创画布">
      <div className="object-toolbar">
        <label>
          截至章节
          <input
            aria-label="画布章节"
            type="number"
            min={0}
            value={scope.chapter}
            onChange={(e) => setScope({ ...scope, chapter: Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label>
          版本
          <select
            aria-label="画布版本"
            value={scope.mode === 'historical' ? (scope.snapshotId ?? '') : 'current'}
            onChange={(e) =>
              setScope({
                ...scope,
                mode: e.target.value === 'current' ? 'current' : 'historical',
                snapshotId: e.target.value === 'current' ? undefined : e.target.value
              })
            }
          >
            <option value="current">当前版本</option>
            {snapshot.studio?.snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.createdAt).toLocaleString('zh-CN')} · 历史
              </option>
            ))}
          </select>
        </label>
        <label>
          视角
          <select
            aria-label="画布视角"
            value={scope.viewpoint}
            onChange={(e) => setScope({ ...scope, viewpoint: e.target.value as MemoryScope['viewpoint'] })}
          >
            <option value="author">作者</option>
            <option value="reader">读者</option>
            <option value="character">人物</option>
          </select>
        </label>
        {scope.viewpoint === 'character' && (
          <label>
            人物
            <select
              aria-label="画布视角人物"
              value={scope.characterId ?? ''}
              onChange={(e) => setScope({ ...scope, characterId: e.target.value })}
            >
              <option value="">选择人物</option>
              {characters.map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button aria-label="刷新共创画布" disabled={loading} onClick={() => setNonce((n) => n + 1)}>
          刷新
        </button>
        {data && (
          <span className="object-version">
            第 {data.revision} 版{scope.mode === 'historical' ? ' · 历史只读' : ''}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className={`object-layout${chatOpen && conversationId ? ' with-discussion' : ''}`}>
        <nav className="object-navigation" aria-label="创作对象">
          <div className="object-groups">
            {groups.map(([id, title]) => (
              <button
                key={id}
                aria-pressed={group === id}
                className={group === id ? 'active' : ''}
                onClick={() => {
                  setGroup(id);
                  setEditing(undefined);
                  setQuery('');
                  setLimit(80);
                  setDiscussionField(undefined);
                  setAllFields(false);
                }}
              >
                {title}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder="查找对象"
            aria-label="查找创作对象"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(80);
            }}
          />
          <div className="object-list">
            {visible.slice(0, limit).map((o) => (
              <button
                key={o.id}
                aria-pressed={object?.id === o.id}
                className={object?.id === o.id ? 'active' : ''}
                onClick={() => selectObject(o)}
              >
                <strong>{o.title}</strong>
                <small>
                  {kindNames[o.kind]}
                  {o.track === 'plan' ? ' · 计划' : ''}
                </small>
              </button>
            ))}
          </div>
          {visible.length > limit && (
            <button onClick={() => setLimit((n) => n + 80)}>显示更多 · 共 {visible.length} 项</button>
          )}
        </nav>
        <div className="object-canvas">
          {!loading && data?.plot && scopeBinding && group === 'plot' && (
            <PlotWorkbench
              view={data.plot}
              binding={scopeBinding}
              editable={data.editable}
              selected={selected}
              onSelect={selectId}
              onCandidate={madeCandidate}
            />
          )}
          {!loading && data?.world && scopeBinding && group === 'world' && (
            <WorldWorkbench
              model={data.world}
              baseHash={data.worldHash ?? null}
              binding={scopeBinding}
              editable={data.editable}
              selected={object?.id}
              onSelect={selectId}
              onCandidate={madeCandidate}
              onDocument={onDocument}
            />
          )}
          {loading ? (
            <p className="empty-state">正在读取…</p>
          ) : !object ? (
            group === 'world' || group === 'plot' ? null : <p className="empty-state">当前范围没有可用记录</p>
          ) : (
            <>
              <header className="object-heading">
                <div>
                  <small>
                    {kindNames[object.kind]}
                    {object.track === 'plan' ? ' · 计划' : ''}
                  </small>
                  <h2>{object.title}</h2>
                </div>
                <button disabled={acting || !data?.editable} onClick={() => void act(() => discuss())}>
                  讨论此对象
                </button>
              </header>
              {object.kind === 'character' && binding && data && (
                <CharacterWorkbench
                  binding={binding}
                  title={object.title}
                  editable={data.editable}
                  versions={(snapshot.studio?.snapshots ?? []).filter((v) => v.revision < data.revision)}
                  onCandidate={madeCandidate}
                  onSource={onSource}
                />
              )}
              {group === 'relation' && (
                <ObjectRelations objects={data?.objects ?? []} selected={object} onSelect={selectObject} />
              )}
              {object.chapter && (
                <div className="object-story-time">
                  <span>{object.chapter}</span>
                  <span>{object.storyTime || '故事时间未记录'}</span>
                </div>
              )}
              <div className="object-fields">
                {object.fields
                  .filter((field) => !/^(?:ID|标识|编号|人物编号|人物标识|实体ID)$/i.test(field.label))
                  .filter(
                    (field) =>
                      allFields ||
                      (group === 'character'
                        ? /身份|目标|状态|关系|本卷|伤势|位置|所在/.test(field.label)
                        : !['plot', 'world'].includes(group))
                  )
                  .map((field) => (
                    <article key={field.id} className="object-field">
                      <header>
                        <h3>{field.label}</h3>
                        {field.kind === 'plan' && <small>计划</small>}
                        {field.kind === 'belief' && <small>人物认知</small>}
                        {field.unrevealed && <small>尚未揭示</small>}
                        {field.locked && <small>已固定</small>}
                      </header>
                      {editing?.id === field.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act(async () => {
                              if (!binding) return;
                              const id = await invokeCommand('workbench.field', {
                                binding,
                                fieldId: field.id,
                                value
                              });
                              setEditing(undefined);
                              await madeCandidate(id);
                            });
                          }}
                        >
                          <label>
                            修改内容
                            <textarea
                              autoFocus
                              aria-label={`修改${field.label}`}
                              rows={3}
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                            />
                          </label>
                          <div className="object-actions">
                            <button className="primary" disabled={acting || value === field.value}>
                              生成修改候选
                            </button>
                            <button type="button" onClick={() => setEditing(undefined)}>
                              取消
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="object-value">
                          {field.value
                            .replace(/(?:[；;]\s*)?稳定标识\s+CH\d+\s*/g, '')
                            .replace(/^[；;]/, '')
                            .trim() || '未记录'}
                        </p>
                      )}
                      <div className="object-actions">
                        <button onClick={() => onSource(field.source)}>来源</button>
                        <button
                          disabled={acting || !data?.editable}
                          onClick={() => void act(() => discuss(field.id))}
                        >
                          讨论字段
                        </button>
                        {field.editable && (
                          <>
                            <button
                              disabled={acting || field.locked}
                              onClick={() => {
                                setEditing(field);
                                setValue(field.value);
                              }}
                            >
                              修改
                            </button>
                            <button
                              disabled={acting}
                              onClick={() =>
                                void act(async () => {
                                  if (!binding) return;
                                  await invokeCommand('workbench.lock', {
                                    binding,
                                    fieldId: field.id,
                                    locked: !field.locked
                                  });
                                  setNonce((n) => n + 1);
                                })
                              }
                            >
                              {field.locked ? '解除固定' : '固定'}
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
              {!!object.fields.length && (
                <button className="object-more-fields" onClick={() => setAllFields((v) => !v)}>
                  {allFields ? '收起详情' : group === 'character' ? '全部资料与来源' : '字段与来源'}
                </button>
              )}
            </>
          )}
          {scopeBinding && (
            <WorkbenchCandidates
              binding={scopeBinding}
              enabled={!!data?.editable && data.revision === project.revision && !loading}
              nonce={candidateNonce}
              focusId={candidateId}
              profileId={profileId}
              refresh={refresh}
              onRun={onRun}
              onChange={() => {
                setNonce((n) => n + 1);
              }}
            />
          )}
          {!!data?.unavailable.length && (
            <details className="object-unavailable">
              <summary>待核对 · {data.unavailable.length} 项</summary>
              {data.unavailable.map((p) => (
                <p key={p}>{p.split('/').at(-1)}</p>
              ))}
            </details>
          )}
        </div>
        {chatOpen && conversationId && (
          <aside className="object-discussion" aria-label="对象讨论">
            <button
              className="object-close-discussion"
              aria-label="收起对象讨论"
              onClick={() => setChatOpen(false)}
            >
              收起讨论
            </button>
            <ChatWorkspace
              key={conversationId}
              compact
              conversationId={conversationId}
              snapshot={snapshot}
              profileId={profileId}
              setProfileId={setProfileId}
              refresh={refresh}
              onRun={onRun}
              onDocument={onDocument}
              onSettings={onSettings}
            />
          </aside>
        )}
      </div>
    </section>
  );
}
