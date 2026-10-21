"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";
import { arc } from "motion";
import { useAnimate, useReducedMotion } from "motion/react";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The supplied arc indicator, measured against the existing navigation layout. */
export function BounceSidebar({
  children,
  className = "",
  activeKey,
  orientation = "vertical",
  ...props
}: ComponentProps<"nav"> & {
  activeKey: string;
  orientation?: "vertical" | "horizontal";
}) {
  const nav = useRef<HTMLElement>(null);
  const [dot, animate] = useAnimate<HTMLSpanElement>();
  const reduced = useReducedMotion();
  const previous = useRef<{ x: number; y: number } | null>(null);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  useEffect(() => () => animation.current?.stop(), []);

  useClientLayoutEffect(() => {
    const root = nav.current;
    if (!root) return;
    let cancelled = false;
    let frame = 0;
    const measure = () => {
      if (cancelled || !dot.current) return;
      const target = root.querySelector<HTMLElement>(
        "[aria-current='page'], [data-bounce-active='true']",
      );
      if (!target || !target.getClientRects().length) {
        animation.current?.stop();
        dot.current.style.opacity = "0";
        previous.current = null;
        return;
      }
      const rect = target.getBoundingClientRect(),
        parent = root.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const snap = (v: number) => Math.round(v * dpr) / dpr;
      const next =
        orientation === "horizontal"
          ? {
              x: snap(
                rect.left - parent.left + root.scrollLeft + rect.width / 2 - 3,
              ),
              y: snap(rect.bottom - parent.top + root.scrollTop - 5),
            }
          : {
              x: 5,
              y: snap(
                rect.top - parent.top + root.scrollTop + rect.height / 2 - 3,
              ),
            };
      const old = previous.current;
      previous.current = next;
      dot.current.style.opacity = "1";
      if (!reduced && old && old.x === next.x && old.y === next.y) return;
      // Capture the painted position before stopping an interrupted animation.
      // The last destination is not necessarily where a rapid second click starts.
      const matrix = typeof DOMMatrixReadOnly !== "undefined"
        ? new DOMMatrixReadOnly(getComputedStyle(dot.current).transform)
        : null;
      const from = matrix ? { x: matrix.m41, y: matrix.m42 } : old;
      animation.current?.stop();
      if (!old || reduced) {
        dot.current.style.transform = `translateX(${next.x}px) translateY(${next.y}px)`;
        return;
      }
      const delta = old
        ? orientation === "horizontal"
          ? next.x - old.x
          : next.y - old.y
        : 0;
      animation.current = animate(
        dot.current,
        { x: [from?.x ?? old.x, next.x], y: [from?.y ?? old.y, next.y] },
          {
              duration: 0.25,
              ease: "easeOut",
              path: arc({
                strength: Math.min(0.8, 14 / Math.max(1, Math.abs(delta))),
                direction: delta > 0 ? "ccw" : "cw",
              }),
            },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    root.querySelectorAll("a, button").forEach((el) => resize.observe(el));
    const mutation = new MutationObserver(schedule);
    mutation.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current", "data-bounce-active", "aria-expanded"],
    });
    document.fonts?.ready.then(schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [activeKey, orientation, reduced, animate, dot]);

  return (
    <nav
      {...props}
      ref={nav}
      className={`u-bounce-nav ${className}`}
      data-slot="bounce-sidebar"
      data-orientation={orientation}
    >
      <span ref={dot} className="u-bounce-dot" aria-hidden="true" />
      {children}
    </nav>
  );
}
