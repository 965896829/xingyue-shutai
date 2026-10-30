import { useEffect, useState } from 'react';
import type { WorldModel } from '../shared/quality';
import type { WorkbenchScopeBinding } from '../shared/workbench-visual';
import { invokeCommand } from '../shared/client';
import { WorkbenchGraph } from './WorkbenchGraph';
import { GrowthSystems } from './GrowthSystems';

const ruleFields = [
  ['scope', '适用范围'],
  ['trigger', '触发条件'],
  ['boundary', '能力边界'],
  ['cost', '代价'],
  ['exception', '例外'],
  ['evidence', '已发生证据']
] as const;
const emptyRule = { scope: '', trigger: '', boundary: '', cost: '', exception: '', evidence: '' };
type Place = NonNullable<WorldModel['places']>[number];
type Route = NonNullable<WorldModel['routes']>[number];
type Link = NonNullable<WorldModel['links']>[number];
export function WorldWorkbench({
  model,
  baseHash,
  binding,
  editable,
  selected,
  onSelect,
  onCandidate,
  onDocument
}: {
  model: WorldModel;
  baseHash: string | null;
  binding: WorkbenchScopeBinding;
  editable: boolean;
  selected?: string;
  onSelect: (id: string) => void;
  onCandidate: (id: string) => Promise<void>;
  onDocument: (path: string) => void;
}) {
  const [mode, setMode] = useState<'rules' | 'causal' | 'map' | 'growth'>(() => {
    try {
      const saved = sessionStorage.getItem(`world-view:${binding.projectId}`);
      return saved === 'causal' || saved === 'map' || saved === 'growth' ? saved : 'rules';
    } catch { return 'rules'; }
  }),
    [module, setModule] = useState<WorldModel['modules'][number]>(),
    [link, setLink] = useState<Link>(),
    [place, setPlace] = useState<Place>(),
    [route, setRoute] = useState<Route>();
  const [busy, setBusy] = useState(false),
    [showAll, setShowAll] = useState(false),
    [error, setError] = useState(''),
    [impact, setImpact] = useState<{ path: string; reason: string }[]>([]),
    [limit, setLimit] = useState(60);
  const current = model.modules.find((m) => `world:${m.id}` === selected),
    key = JSON.stringify(binding);
  const active = model.modules.filter((m) => m.state === 'enabled'),
    places = model.places ?? [],
    routes = model.routes ?? [];
  useEffect(() => {
    setModule(undefined);
    setLink(undefined);
    setPlace(undefined);
    setRoute(undefined);
    setImpact([]);
    setError('');
  }, [key, model]);
  useEffect(() => {
    let alive = true;
    setImpact([]);
    if (editable && current)
      void invokeCommand('workbench.worldImpact', { binding, moduleId: current.id })
        .then((rows) => {
          if (alive) setImpact(rows);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [key, current?.id, editable]);
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
  const propose = async (next: WorldModel) => {
    const id = await invokeCommand('world.propose', { model: next, baseHash });
    setModule(undefined);
    setLink(undefined);
    setPlace(undefined);
    setRoute(undefined);
    await onCandidate(id);
  };
  const updateModule = () => {
    if (module)
      void act(() =>
        propose({ ...model, modules: model.modules.map((m) => (m.id === module.id ? module : m)) })
      );
  };
  const placeTitle = (id: string) => places.find((p) => p.id === id)?.title ?? id;
  return (
    <section className="world-workbench" aria-label="世界设定画布">
      <div className="object-actions">
        {(
          [
            ['rules', '规则卡'],
            ['causal', '规则因果'],
            ['growth', '成长路线'],
            ['map', '空间示意']
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={mode === id} onClick={() => {
            setMode(id);
            try { sessionStorage.setItem(`world-view:${binding.projectId}`, id); } catch {}
          }}>
            {label}
          </button>
        ))}
        {mode === 'rules' && (
          <button onClick={() => setShowAll((v) => !v)}>{showAll ? '返回当前规则' : '全部模块'}</button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {mode === 'growth' && <GrowthSystems key={key + baseHash} model={model} baseHash={baseHash} editable={editable} storageKey={`${binding.projectId}:growth`} onCandidate={onCandidate} />}
      {mode === 'rules' && (
        <div className="world-rule-cards">
          {model.modules
            .filter((m) => showAll || (current ? m.id === current.id : m.state === 'enabled'))
            .map((m) => (
              <article key={m.id} className={m.id === current?.id ? 'active' : ''}>
                <button className="world-rule-title" onClick={() => onSelect(`world:${m.id}`)}>
                  <h3>{m.title}</h3>
                  <small>
                    {{ enabled: '启用', disabled: '停用', undecided: '待定' }[m.state]}
                    {m.locked ? ' · 已固定' : ''}
                  </small>
                </button>
                <p>{m.content || '未设定'}</p>
                {m.rule && (
                  <dl>
                    {ruleFields.map(([key, title]) => (
                      <div key={key}>
                        <dt>{title}</dt>
                        <dd>{m.rule![key] || '未设定'}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {editable && (
                  <button
                    disabled={busy || m.locked}
                    onClick={() => setModule({ ...m, rule: m.rule ?? { ...emptyRule } })}
                  >
                    编辑规则
                  </button>
                )}
              </article>
            ))}
        </div>
      )}
      {mode === 'causal' && (
        <>
          <WorkbenchGraph
            nodes={active.map((m) => ({ id: m.id, title: m.title, selected: m.id === current?.id }))}
            edges={(model.links ?? []).filter(
              (l) => active.some((m) => m.id === l.from) && active.some((m) => m.id === l.to)
            )}
            storageKey={`world-causal:${binding.projectId}`}
            label="世界规则因果图"
            onSelect={(id) => onSelect(`world:${id}`)}
            onEdge={(id) => setLink(model.links?.find((l) => l.id === id))}
          />
          {!model.links?.length && <p className="empty-state">尚未记录规则间的因果关系</p>}
          {editable && active.length >= 2 && (
            <button
              disabled={busy}
              onClick={() =>
                setLink({
                  id: crypto.randomUUID(),
                  from: active[0].id,
                  to: active[1].id,
                  kind: 'requires',
                  label: ''
                })
              }
            >
              新增规则关系
            </button>
          )}
        </>
      )}
      {mode === 'map' && (
        <>
          <div className="map-heading">
            <h3>空间示意</h3>
            {editable && (
              <button
                disabled={busy}
                onClick={() => setPlace({ id: crypto.randomUUID(), title: '', description: '' })}
              >
                新增地点
              </button>
            )}
          </div>
          {!!places.length && (
            <WorkbenchGraph
              nodes={places
                .slice(0, limit)
                .map((p) => ({ id: p.id, title: p.title, selected: p.id === place?.id }))}
              edges={routes.map((r) => ({
                id: r.id,
                from: r.from,
                to: r.to,
                label: [
                  r.label,
                  r.direction,
                  r.distance ? `${r.distance.value} ${r.distance.unit}` : '距离未设定'
                ]
                  .filter(Boolean)
                  .join(' · ')
              }))}
              storageKey={`world-map:${binding.projectId}`}
              label="空间示意图"
              onSelect={(id) => setPlace(places.find((p) => p.id === id))}
              onEdge={(id) => setRoute(routes.find((r) => r.id === id))}
            />
          )}
          {!places.length && <p className="empty-state">尚未设定地点与路线</p>}
          {places.length > limit && (
            <button onClick={() => setLimit((n) => n + 60)}>显示更多 · 共 {places.length} 个地点</button>
          )}
          {!!routes.length && (
            <details>
              <summary>路线 · {routes.length}</summary>
              {routes.map((r) => (
                <button key={r.id} className="world-route-row" onClick={() => setRoute({ ...r })}>
                  {placeTitle(r.from)} → {placeTitle(r.to)}
                  <span>
                    {r.distance ? `${r.distance.value} ${r.distance.unit}` : '距离未设定'}
                    {r.direction ? ` · ${r.direction}` : ''}
                  </span>
                </button>
              ))}
            </details>
          )}
          {editable && places.length >= 2 && (
            <button
              disabled={busy}
              onClick={() =>
                setRoute({
                  id: crypto.randomUUID(),
                  from: places[0].id,
                  to: places[1].id,
                  label: '',
                  direction: '',
                  distance: null
                })
              }
            >
              新增路线
            </button>
          )}
        </>
      )}
      {current && !!impact.length && (
        <details className="world-impact">
          <summary>关联影响 · {impact.length}</summary>
          {impact.map((row) => (
            <div key={row.path}>
              <button
                onClick={() =>
                  row.path.startsWith('module:')
                    ? onSelect(`world:${row.path.slice(7)}`)
                    : onDocument(row.path)
                }
              >
                {row.path.startsWith('module:')
                  ? model.modules.find((m) => m.id === row.path.slice(7))?.title
                  : row.path.split('/').at(-1)}
              </button>
              <span>{row.reason}</span>
            </div>
          ))}
        </details>
      )}
      {module && (
        <form
          className="workbench-editor"
          aria-label="世界规则编辑"
          onSubmit={(e) => {
            e.preventDefault();
            updateModule();
          }}
        >
          <h3>{module.title}</h3>
          <label>
            状态
            <select
              value={module.state}
              onChange={(e) => setModule({ ...module, state: e.target.value as typeof module.state })}
            >
              <option value="enabled">启用</option>
              <option value="disabled">停用</option>
              <option value="undecided">待定</option>
            </select>
          </label>
          <label>
            规则内容
            <textarea
              value={module.content}
              maxLength={50000}
              onChange={(e) => setModule({ ...module, content: e.target.value })}
            />
          </label>
          <div className="workbench-form-grid">
            {ruleFields.map(([key, title]) => (
              <label key={key}>
                {title}
                <textarea
                  maxLength={4000}
                  value={module.rule?.[key] ?? ''}
                  onChange={(e) =>
                    setModule({ ...module, rule: { ...(module.rule ?? emptyRule), [key]: e.target.value } })
                  }
                />
              </label>
            ))}
          </div>
          <div className="object-actions">
            <button className="primary" disabled={busy}>
              生成规则候选
            </button>
            <button type="button" onClick={() => setModule(undefined)}>
              取消
            </button>
          </div>
        </form>
      )}
      {link && (
        <form
          className="workbench-editor"
          aria-label="世界关系编辑"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              propose({ ...model, links: [...(model.links ?? []).filter((l) => l.id !== link.id), link] })
            );
          }}
        >
          <h3>规则关系</h3>
          <div className="workbench-form-grid">
            {(['from', 'to'] as const).map((key) => (
              <label key={key}>
                {key === 'from' ? '起点规则' : '后续规则'}
                <select
                  disabled={!editable}
                  value={link[key]}
                  onChange={(e) => setLink({ ...link, [key]: e.target.value })}
                >
                  {model.modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
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
                onChange={(e) => setLink({ ...link, kind: e.target.value as Link['kind'] })}
              >
                <option value="requires">依赖</option>
                <option value="enables">允许</option>
                <option value="prevents">阻止</option>
                <option value="causes">导致</option>
                <option value="exception">例外</option>
              </select>
            </label>
            <label>
              关系说明
              <textarea
                required
                disabled={!editable}
                value={link.label}
                onChange={(e) => setLink({ ...link, label: e.target.value })}
              />
            </label>
          </div>
          <div className="object-actions">
            {editable && (
              <button className="primary" disabled={busy || link.from === link.to || !link.label.trim()}>
                生成关系候选
              </button>
            )}
            <button type="button" onClick={() => setLink(undefined)}>
              关闭
            </button>
            {editable && model.links?.some((l) => l.id === link.id) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() => propose({ ...model, links: model.links!.filter((l) => l.id !== link.id) }))
                }
              >
                移除关系
              </button>
            )}
          </div>
        </form>
      )}
      {place && (
        <form
          className="workbench-editor"
          aria-label="地点编辑"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              propose({ ...model, places: [...places.filter((p) => p.id !== place.id), place] })
            );
          }}
        >
          <h3>地点</h3>
          <label>
            地点名称
            <input
              required
              disabled={!editable}
              value={place.title}
              onChange={(e) => setPlace({ ...place, title: e.target.value })}
            />
          </label>
          <label>
            描述
            <textarea
              disabled={!editable}
              value={place.description}
              onChange={(e) => setPlace({ ...place, description: e.target.value })}
            />
          </label>
          <label>
            所属规则
            <select
              disabled={!editable}
              value={place.moduleId ?? ''}
              onChange={(e) => setPlace({ ...place, moduleId: e.target.value || undefined })}
            >
              <option value="">未设定</option>
              {model.modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <div className="object-actions">
            {editable && (
              <button className="primary" disabled={busy || !place.title.trim()}>
                生成地点候选
              </button>
            )}
            <button type="button" onClick={() => setPlace(undefined)}>
              关闭
            </button>
            {editable && places.some((p) => p.id === place.id) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    propose({
                      ...model,
                      places: places.filter((p) => p.id !== place.id),
                      routes: routes.filter((r) => r.from !== place.id && r.to !== place.id)
                    })
                  )
                }
              >
                移除地点及路线
              </button>
            )}
          </div>
        </form>
      )}
      {route && (
        <form
          className="workbench-editor"
          aria-label="路线编辑"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              propose({ ...model, routes: [...routes.filter((r) => r.id !== route.id), route] })
            );
          }}
        >
          <h3>路线</h3>
          <div className="workbench-form-grid">
            {(['from', 'to'] as const).map((key) => (
              <label key={key}>
                {key === 'from' ? '起点' : '终点'}
                <select
                  disabled={!editable}
                  value={route[key]}
                  onChange={(e) => setRoute({ ...route, [key]: e.target.value })}
                >
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              路线说明
              <input
                disabled={!editable}
                value={route.label}
                onChange={(e) => setRoute({ ...route, label: e.target.value })}
              />
            </label>
            <label>
              方位
              <input
                disabled={!editable}
                placeholder="未设定"
                value={route.direction}
                onChange={(e) => setRoute({ ...route, direction: e.target.value })}
              />
            </label>
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              disabled={!editable}
              checked={route.distance !== null}
              onChange={(e) =>
                setRoute({ ...route, distance: e.target.checked ? { value: Number.NaN, unit: '' } : null })
              }
            />
            设定距离
          </label>
          {route.distance && (
            <div className="workbench-form-grid">
              <label>
                距离
                <input
                  type="number"
                  min={0}
                  step="any"
                  disabled={!editable}
                  required
                  value={Number.isNaN(route.distance.value) ? '' : route.distance.value}
                  onChange={(e) =>
                    setRoute({
                      ...route,
                      distance: {
                        ...route.distance!,
                        value: e.target.value === '' ? Number.NaN : Number(e.target.value)
                      }
                    })
                  }
                />
              </label>
              <label>
                单位
                <input
                  required
                  disabled={!editable}
                  value={route.distance.unit}
                  onChange={(e) =>
                    setRoute({ ...route, distance: { ...route.distance!, unit: e.target.value } })
                  }
                />
              </label>
            </div>
          )}
          <div className="object-actions">
            {editable && (
              <button
                className="primary"
                disabled={
                  busy ||
                  route.from === route.to ||
                  (!!route.distance &&
                    (!Number.isFinite(route.distance.value) || !route.distance.unit.trim()))
                }
              >
                生成路线候选
              </button>
            )}
            <button type="button" onClick={() => setRoute(undefined)}>
              关闭
            </button>
            {editable && routes.some((r) => r.id === route.id) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() => propose({ ...model, routes: routes.filter((r) => r.id !== route.id) }))
                }
              >
                移除路线
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
