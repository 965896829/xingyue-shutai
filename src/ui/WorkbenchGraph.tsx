import { useEffect, useId, useRef, useState } from 'react';

export type GraphNode = { id: string; title: string; planned?: boolean; selected?: boolean };
export type GraphEdge = { id: string; from: string; to: string; label: string; planned?: boolean };
type Point = { x: number; y: number };
export function WorkbenchGraph({
  nodes,
  edges,
  storageKey,
  label,
  onSelect,
  onEdge
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  storageKey: string;
  label: string;
  onSelect: (id: string) => void;
  onEdge?: (id: string) => void;
}) {
  const marker = useId().replaceAll(':', ''),
    [positions, setPositions] = useState<Record<string, Point>>({});
  const drag = useRef<{ id: string; start: Point; moved: boolean } | null>(null);
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      setPositions(
        Object.fromEntries(
          Object.entries(parsed).filter(
            ([, p]) =>
              p && typeof p === 'object' && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y)
          )
        ) as Record<string, Point>
      );
    } catch {
      setPositions({});
    }
  }, [storageKey]);
  const height = Math.max(240, Math.ceil(nodes.length / 3) * 104 + 40);
  const point = (id: string) =>
    positions[id] ?? {
      x: 105 + (nodes.findIndex((n) => n.id === id) % 3) * 215,
      y: 70 + Math.floor(nodes.findIndex((n) => n.id === id) / 3) * 104
    };
  const save = (next: Record<string, Point>) => {
    setPositions(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  };
  return (
    <div className="workbench-graph">
      <svg viewBox={`0 0 640 ${height}`} role="group" aria-label={label}>
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
        {edges
          .filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
          .map((e) => {
            const a = point(e.from),
              b = point(e.to),
              length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const dx = (b.x - a.x) / length,
              dy = (b.y - a.y) / length;
            const boundary = 1 / Math.max(Math.abs(dx) / 84, Math.abs(dy) / 26, 0.001);
            const select = () => onEdge?.(e.id);
            return (
              <g
                key={e.id}
                className={e.planned ? 'planned' : ''}
                role={onEdge ? 'button' : undefined}
                pointerEvents={onEdge ? 'bounding-box' : undefined}
                tabIndex={onEdge ? 0 : undefined}
                aria-label={e.label}
                onClick={select}
                onKeyDown={(event) => {
                  if (onEdge && ['Enter', ' '].includes(event.key)) {
                    event.preventDefault();
                    select();
                  }
                }}
              >
                <line
                  x1={a.x + dx * boundary}
                  y1={a.y + dy * boundary}
                  x2={b.x - dx * (boundary + 5)}
                  y2={b.y - dy * (boundary + 5)}
                  markerEnd={`url(#${marker})`}
                />
                <text
                  className="graph-edge-label"
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - (Math.abs(dy) < 0.2 ? 40 : 15)}
                  textAnchor="middle"
                >
                  {e.label.slice(0, 24)}
                  <title>{e.label}</title>
                </text>
              </g>
            );
          })}
        {nodes.map((n) => {
          const p = point(n.id);
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              className={`graph-node${n.selected ? ' selected' : ''}${n.planned ? ' planned' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`选择${n.title}`}
              aria-pressed={!!n.selected}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { id: n.id, start: { x: e.clientX, y: e.clientY }, moved: false };
              }}
              onPointerMove={(e) => {
                if (drag.current?.id !== n.id) return;
                if (Math.hypot(e.clientX - drag.current.start.x, e.clientY - drag.current.start.y) > 5)
                  drag.current.moved = true;
                if (!drag.current.moved) return;
                const svg = e.currentTarget.ownerSVGElement!,
                  matrix = svg.getScreenCTM();
                if (!matrix) return;
                const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
                save({
                  ...positions,
                  [n.id]: {
                    x: Math.max(90, Math.min(550, at.x)),
                    y: Math.max(35, Math.min(height - 35, at.y))
                  }
                });
              }}
              onPointerUp={(e) => {
                if (!drag.current || drag.current.id !== n.id) return;
                const moved = drag.current.moved;
                drag.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
                if (!moved) onSelect(n.id);
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                if (['Enter', ' '].includes(e.key)) {
                  e.preventDefault();
                  onSelect(n.id);
                } else if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                  e.preventDefault();
                  save({
                    ...positions,
                    [n.id]: {
                      x: Math.max(
                        90,
                        Math.min(550, p.x + (e.key === 'ArrowLeft' ? -15 : e.key === 'ArrowRight' ? 15 : 0))
                      ),
                      y: Math.max(
                        35,
                        Math.min(
                          height - 35,
                          p.y + (e.key === 'ArrowUp' ? -15 : e.key === 'ArrowDown' ? 15 : 0)
                        )
                      )
                    }
                  });
                }
              }}
            >
              <rect x="-83" y="-25" width="166" height="50" rx="12" />
              <text y="5" textAnchor="middle">
                {n.title.slice(0, 13)}
                <title>{n.title}</title>
              </text>
            </g>
          );
        })}
      </svg>
      {!!nodes.length && (
        <button className="graph-reset" onClick={() => save({})}>
          重置布局
        </button>
      )}
    </div>
  );
}
