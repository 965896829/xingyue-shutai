import { useEffect, useState } from 'react';
import type {
  PlotDocument,
  PlotMutation,
  PlotNode,
  PlotView,
  ReorderDecision,
  ReorderPreview,
  WorkbenchScopeBinding
} from '../shared/workbench-visual';
import { invokeCommand } from '../shared/client';
import { WorkbenchGraph } from './WorkbenchGraph';

const fields = [
  ['goal', '目标'],
  ['obstacle', '阻力'],
  ['choice', '选择'],
  ['outcome', '结果'],
  ['promise', '承诺'],
  ['storyTime', '故事时间']
] as const;
const levelNames = { project: '作品', volume: '卷', chapter: '章', scene: '场景' };
export function PlotWorkbench({
  view,
  binding,
  editable,
  selected,
  onSelect,
  onCandidate
}: {
  view: PlotView;
  binding: WorkbenchScopeBinding;
  editable: boolean;
  selected?: string;
  onSelect: (id: string, node?: PlotNode) => void;
  onCandidate: (id: string) => Promise<void>;
}) {
  const [parent, setParent] = useState('project'),
    [mode, setMode] = useState<'cards' | 'chain' | 'order'>('cards'),
    [limit, setLimit] = useState(60);
  const [expanded, setExpanded] = useState<PlotView>(),
    [order, setOrder] = useState<number[]>([]),
    [drag, setDrag] = useState<number>(),
    [preview, setPreview] = useState<ReorderPreview>();
  const [decisions, setDecisions] = useState<Record<string, ReorderDecision>>({}),
    [scene, setScene] = useState<PlotDocument['scenes'][number]>(),
    [link, setLink] = useState<PlotDocument['links'][number]>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = JSON.stringify(binding);
  useEffect(() => {
    setExpanded(undefined);
    setPreview(undefined);
    setOrder([]);
    setScene(undefined);
    setLink(undefined);
  }, [key, view]);
  useEffect(() => {
    let active = true;
    const node = view.nodes.find((n) => n.id === selected) ?? expanded?.nodes.find((n) => n.id === selected);
    const target = node?.level === 'scene' ? node.parentId : node?.id;
    if (target) setParent(target);
    setLimit(60);
    setOrder([]);
    setPreview(undefined);
    setError('');
    const chapter = node?.chapter ?? Number(selected?.match(/^legacy-scene:(\d+):/)?.[1]);
    if (
      chapter &&
      (node?.level === 'chapter' || node?.level === 'scene' || selected?.startsWith('legacy-scene:'))
    ) {
      setParent(`chapter:${chapter}`);
      setBusy(true);
      void invokeCommand('workbench.plot', { scope: binding.scope, chapter })
        .then((full) => {
          if (active) setExpanded(full);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    } else setBusy(false);
    return () => {
      active = false;
    };
  }, [selected, key, view]);
  const plot = expanded ?? view,
    current = plot.nodes.find((n) => n.id === parent) ?? plot.nodes[0];
  const children = plot.nodes.filter((n) => n.parentId === current?.id);
  const chapters = children.filter((n) => n.level === 'chapter').map((n) => n.chapter!);
  const shownOrder =
    order.length && order.every((n) => chapters.includes(n)) && order.length === chapters.length
      ? order
      : chapters;
  const changed = shownOrder.some((n, i) => n !== chapters[i]);
  const act = async (work: () => Promise<void>) => {
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
  const select = (id: string) => {
    const node = plot.nodes.find((n) => n.id === id);
    if (!node) return;
    onSelect(id, node);
  };
  const ancestors: PlotNode[] = [];
  let at: PlotNode | undefined = current;
  const seen = new Set<string>();
  while (at && !seen.has(at.id)) {
    ancestors.unshift(at);
    seen.add(at.id);
    at = plot.nodes.find((n) => n.id === at!.parentId);
  }
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...shownOrder],
      i = next.indexOf(from),
      j = next.indexOf(to);
    if (i < 0 || j < 0) return;
    next.splice(i, 1);
    next.splice(j, 0, from);
    setOrder(next);
    setPreview(undefined);
    setDecisions({});
  };
  const candidate = async (mutation: PlotMutation) => {
    const id = await invokeCommand('workbench.plotPropose', { binding, baseHash: plot.baseHash, mutation });
    setScene(undefined);
    setLink(undefined);
    await onCandidate(id);
  };
  const active = plot.nodes.find((n) => n.id === selected),
    activeScene = plot.document?.scenes.find((s) => `scene:${s.id}` === selected);
  const choices = plot.nodes.filter((n) => n.level === 'chapter' || !!n.sceneId);
  const linkStart = choices.find((n) => n.id === active?.id)?.id ?? choices[0]?.id;
  const graphIds = new Set([...children.map((n) => n.id), ...(active ? [active.id] : [])]);
  const graphLinks = plot.links.filter((l) => graphIds.has(l.from) || graphIds.has(l.to));
  for (const edge of graphLinks) {
    graphIds.add(edge.from);
    graphIds.add(edge.to);
  }
  const graphNodes = plot.nodes.filter((n) => graphIds.has(n.id)).slice(0, 60);
  return (
    <section className="plot-workbench" aria-label="剧情结构画布">
      <div className="workbench-subnav" aria-label="剧情层级">
        {ancestors.map((n) => (
          <button
            key={n.id}
            aria-current={n.id === current?.id ? 'location' : undefined}
            onClick={() => select(n.id)}
          >
            {levelNames[n.level]} · {n.title}
          </button>
        ))}
      </div>
      <div className="object-actions">
        {(
          [
            ['cards', '剧情卡'],
            ['chain', '因果链'],
            ['order', '章节列表']
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
        {editable && current?.level === 'chapter' && (
          <button
            disabled={busy}
            onClick={() =>
              setScene({
                id: crypto.randomUUID(),
                chapter: current.chapter!,
                title: '',
                goal: '',
                obstacle: '',
                choice: '',
                outcome: '',
                promise: '',
                storyTime: '',
                protected: false
              })
            }
          >
            新增场景
          </button>
        )}
        {editable && activeScene && (
          <button disabled={busy || activeScene.protected} onClick={() => setScene({ ...activeScene })}>
            修改场景
          </button>
        )}
        {editable && activeScene?.protected && (
          <button
            disabled={busy}
            onClick={() =>
              void act(() => candidate({ kind: 'scene', scene: { ...activeScene, protected: false } }))
            }
          >
            解除场景固定
          </button>
        )}
        {editable && choices.length > 1 && (
          <button
            disabled={busy}
            onClick={() =>
              setLink({
                id: crypto.randomUUID(),
                from: linkStart!,
                to: choices.find((n) => n.id !== linkStart)!.id,
                kind: 'causes',
                label: '',
                nonlinear: false
              })
            }
          >
            连接剧情
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {mode === 'cards' && (
        <div className="plot-cards">
          {children.slice(0, limit).map((n) => (
            <button
              key={n.id}
              className={`plot-card${n.id === selected ? ' active' : ''}`}
              onClick={() => select(n.id)}
            >
              <small>
                {levelNames[n.level]}
                {n.track === 'plan' ? ' · 计划' : ''}
              </small>
              <h3>{n.title}</h3>
              {fields
                .filter(([id]) => id !== 'storyTime')
                .map(([id, label]) => (
                  <span key={id}>
                    <b>{label}</b>
                    {n[id] || '未设定'}
                  </span>
                ))}
            </button>
          ))}
          {!children.length && <p className="empty-state">此层尚无场景记录</p>}
          {children.length > limit && (
            <button onClick={() => setLimit((n) => n + 60)}>显示更多 · 共 {children.length} 项</button>
          )}
        </div>
      )}
      {mode === 'chain' && (
        <>
          <WorkbenchGraph
            nodes={graphNodes.map((n) => ({
              id: n.id,
              title: n.title,
              planned: n.track === 'plan',
              selected: n.id === selected
            }))}
            edges={graphLinks.map((l) => ({ ...l, planned: l.nonlinear }))}
            storageKey={`plot-layout:${binding.projectId}:${parent}`}
            label="剧情因果链"
            onSelect={select}
            onEdge={(id) => {
              const edge = plot.links.find((l) => l.id === id);
              if (edge) setLink({ ...edge });
            }}
          />
          {graphIds.size > graphNodes.length && (
            <p>
              显示 {graphNodes.length} / {graphIds.size} 个节点
            </p>
          )}
          {!graphLinks.length && <p className="empty-state">尚未记录因果连接</p>}
        </>
      )}
      {mode === 'order' && (
        <>
          {!chapters.length && <p className="empty-state">选择卷后查看章节顺序</p>}
          <ol className="chapter-order">
            {shownOrder.slice(0, limit).map((n, i) => (
              <li
                key={n}
                draggable={editable && !busy}
                onDragStart={(e) => {
                  setDrag(n);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(n));
                }}
                onDragEnd={() => setDrag(undefined)}
                onDragOver={(e) => {
                  if (drag !== undefined) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag !== undefined) move(drag, n);
                  setDrag(undefined);
                }}
              >
                <span>{i + 1}</span>
                <button className="chapter-order-title" onClick={() => select(`chapter:${n}`)}>
                  {plot.nodes.find((node) => node.id === `chapter:${n}`)?.title}
                </button>
                {editable && (
                  <>
                    <button
                      aria-label={`上移第${n}章`}
                      disabled={busy || i === 0}
                      onClick={() => move(n, shownOrder[i - 1])}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`下移第${n}章`}
                      disabled={busy || i === shownOrder.length - 1}
                      onClick={() => move(n, shownOrder[i + 1])}
                    >
                      ↓
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {shownOrder.length > limit && (
            <button onClick={() => setLimit((n) => n + 60)}>显示更多 · 共 {shownOrder.length} 章</button>
          )}
          {editable && changed && (
            <div className="object-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setPreview(
                      await invokeCommand('workbench.reorderPreview', { binding, order: shownOrder })
                    );
                    setDecisions({});
                  })
                }
              >
                预览调序影响
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setOrder([]);
                  setPreview(undefined);
                }}
              >
                还原顺序
              </button>
            </div>
          )}
          {preview && (
            <section className="reorder-preview" aria-label="章节调序影响">
              <h3>影响预览</h3>
              <p>
                {preview.paths.length} 份文稿{preview.requiresRevision ? ' · 需核对正文与记忆' : ''}
              </p>
              {preview.issues.map((issue) => (
                <article key={issue.id}>
                  <p className={issue.severity === 'error' ? 'error' : ''}>{issue.message}</p>
                  {issue.severity === 'review' && (
                    <div className="workbench-form-grid">
                      <label>
                        处理方式
                        <select
                          value={decisions[issue.id]?.action ?? 'nonlinear'}
                          onChange={(e) =>
                            setDecisions((v) => ({
                              ...v,
                              [issue.id]: {
                                issueId: issue.id,
                                reason: v[issue.id]?.reason ?? '',
                                action: e.target.value as ReorderDecision['action']
                              }
                            }))
                          }
                        >
                          <option value="nonlinear">保留倒叙或并行叙事</option>
                          {preview.requiresRevision && <option value="revise">核对并修订正文</option>}
                        </select>
                      </label>
                      <label>
                        处理说明
                        <textarea
                          aria-label={`处理说明：${issue.message}`}
                          value={decisions[issue.id]?.reason ?? ''}
                          onChange={(e) =>
                            setDecisions((v) => ({
                              ...v,
                              [issue.id]: {
                                issueId: issue.id,
                                action: v[issue.id]?.action ?? 'nonlinear',
                                reason: e.target.value
                              }
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                </article>
              ))}
              {!preview.issues.length && <p>未发现顺序冲突</p>}
              <button
                className="primary"
                disabled={
                  busy ||
                  preview.issues.some(
                    (i) =>
                      i.severity === 'error' || !decisions[i.id] || decisions[i.id].reason.trim().length < 2
                  )
                }
                onClick={() =>
                  void act(async () => {
                    const id = await invokeCommand('workbench.reorderPropose', {
                      binding,
                      order: preview.after,
                      fingerprint: preview.fingerprint,
                      decisions: Object.values(decisions)
                    });
                    setPreview(undefined);
                    await onCandidate(id);
                  })
                }
              >
                生成调序候选
              </button>
            </section>
          )}
        </>
      )}
      {scene && (
        <form
          className="workbench-editor"
          aria-label="场景编辑"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => candidate({ kind: 'scene', scene }));
          }}
        >
          <h3>{activeScene?.id === scene.id ? '修改场景' : '新增场景'}</h3>
          <label>
            场景名称
            <input
              required
              maxLength={500}
              value={scene.title}
              onChange={(e) => setScene({ ...scene, title: e.target.value })}
            />
          </label>
          <div className="workbench-form-grid">
            {fields.map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  maxLength={12000}
                  value={scene[key]}
                  onChange={(e) => setScene({ ...scene, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={scene.protected}
              onChange={(e) => setScene({ ...scene, protected: e.target.checked })}
            />
            固定场景
          </label>
          <div className="object-actions">
            <button className="primary" disabled={busy || !scene.title.trim()}>
              生成场景候选
            </button>
            <button type="button" onClick={() => setScene(undefined)}>
              取消
            </button>
            {activeScene?.id === scene.id && !scene.protected && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => candidate({ kind: 'deleteScene', id: scene.id }))}
              >
                移除场景
              </button>
            )}
          </div>
        </form>
      )}
      {link && (
        <form
          className="workbench-editor"
          aria-label="剧情连接编辑"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => candidate({ kind: 'link', link }));
          }}
        >
          <h3>剧情连接</h3>
          <div className="workbench-form-grid">
            {(['from', 'to'] as const).map((key) => (
              <label key={key}>
                {key === 'from' ? '起点' : '后续'}
                <select
                  disabled={!editable}
                  value={link[key]}
                  onChange={(e) => setLink({ ...link, [key]: e.target.value })}
                >
                  {choices.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              关系
              <select
                disabled={!editable}
                value={link.kind}
                onChange={(e) => setLink({ ...link, kind: e.target.value as typeof link.kind })}
              >
                <option value="causes">导致</option>
                <option value="requires">依赖</option>
                <option value="reveals">揭示</option>
                <option value="echoes">呼应</option>
              </select>
            </label>
            <label>
              连接说明
              <textarea
                required
                disabled={!editable}
                value={link.label}
                onChange={(e) => setLink({ ...link, label: e.target.value })}
              />
            </label>
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              disabled={!editable}
              checked={link.nonlinear}
              onChange={(e) => setLink({ ...link, nonlinear: e.target.checked })}
            />
            倒叙或并行叙事
          </label>
          <div className="object-actions">
            {editable && (
              <button className="primary" disabled={busy || link.from === link.to || !link.label.trim()}>
                生成连接候选
              </button>
            )}
            <button type="button" onClick={() => setLink(undefined)}>
              关闭
            </button>
            {editable && plot.links.some((l) => l.id === link.id) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => candidate({ kind: 'deleteLink', id: link.id }))}
              >
                移除连接
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
