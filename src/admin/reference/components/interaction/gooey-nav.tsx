"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Link from "@reference/router-link";
import { usePathname } from "@reference/router";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";

const SPRING = { type: "spring", stiffness: 200, damping: 28, mass: 1 } as const;
const SIZES = { xs: { radius: 8, separation: 12 }, sm: { radius: 10, separation: 16 }, md: { radius: 12, separation: 20 }, lg: { radius: 14, separation: 24 } };
type Item = { label: string; href?: string; icon?: ReactNode; suffix?: ReactNode };
export type GooeyNavItem = string | Item;
const toItem = (item: GooeyNavItem): Item => typeof item === "string" ? { label: item } : item;

// The supplied pinching seam, expressed with the project's ordinary CSS.
function neckPath(gap: number, span: number) {
  if (!Number.isFinite(gap) || !Number.isFinite(span) || gap <= 0 || span <= 0) return "";
  const waist = 100 * (1 - gap / (span * 0.22));
  if (waist <= 0) return "";
  const start = span - gap, mid = start + gap / 2;
  return `M${start} 0 Q${mid} ${100 - waist} ${span} 0 L${span} 100 Q${mid} ${waist} ${start} 100 Z`;
}

function Segment({ gap, span, first, leftFill, rightFill, radii, reduced, active, children }: {
  gap: number; span: number; first: boolean; leftFill: string; rightFill: string;
  radii: Record<string, number>; reduced: boolean; active: boolean; children: ReactNode;
}) {
  const marginLeft = useSpring(gap, SPRING);
  const gradientId = `gooey-neck-${useId().replace(/:/g, "")}`;
  useEffect(() => { if (reduced) marginLeft.jump(gap); else marginLeft.set(gap); }, [gap, marginLeft, reduced]);
  const d = useTransform(marginLeft, (g) => neckPath(g, span));
  return <motion.li className="u-gooey-segment" data-active={active} style={{ marginLeft }} initial={false} animate={radii} transition={reduced ? { duration: 0 } : SPRING}>
    {!first && <svg aria-hidden="true" width={span} viewBox={`0 0 ${span} 100`} preserveAspectRatio="none" className="u-gooey-neck">
      <defs><linearGradient id={gradientId} x1="0" x2="1"><stop offset="0" stopColor={leftFill} /><stop offset="1" stopColor={rightFill} /></linearGradient></defs>
      <motion.path d={d} fill={`url(#${gradientId})`} />
    </svg>}
    {children}
  </motion.li>;
}

export function GooeyNav({ items, value, defaultValue = 0, onChange, size = "md", activeColor = "var(--lime)", activeLabelColor = "#20251a", className = "", tabMode = false, ...props }: Omit<ComponentProps<"nav">, "onChange"> & {
  items: GooeyNavItem[]; value?: number; defaultValue?: number; onChange?: (index: number) => void;
  size?: keyof typeof SIZES; activeColor?: string; activeLabelColor?: string; tabMode?: boolean;
}) {
  const pathname = usePathname(), reduced = useReducedMotion() ?? false;
  const routeIndex = items.findIndex((item) => toItem(item).href?.split("#")[0] === pathname);
  const [internal, setInternal] = useState(defaultValue);
  const active = value ?? (routeIndex >= 0 ? routeIndex : internal);
  const nav = useRef<HTMLElement>(null);
  const { radius, separation: span } = SIZES[size];
  const open = (seam: number) => seam === 0 || seam === items.length || seam === active || seam - 1 === active;
  const fill = (i: number) => i === active ? activeColor : "var(--surface-high)";
  useEffect(() => {
    const root = nav.current, selected = root?.querySelector<HTMLElement>("[aria-current], [aria-pressed='true'], [aria-selected='true']");
    if (!root || !selected) return;
    const a = root.getBoundingClientRect(), b = selected.getBoundingClientRect();
    if (b.left < a.left || b.right > a.right) root.scrollTo({ left: root.scrollLeft + b.left - a.left - (a.width - b.width) / 2, behavior: reduced ? "instant" : "smooth" });
  }, [active, reduced]);
  return <nav {...props} ref={nav} data-slot="gooey-nav" data-size={size} className={`u-gooey-nav ${className}`} style={{ ...props.style, "--gooey-active": activeColor, "--gooey-label": activeLabelColor } as React.CSSProperties}>
    <ul role={tabMode ? "tablist" : undefined} aria-label={tabMode ? props["aria-label"] || "模块分类" : undefined}>{items.map((item, i) => {
      const { label, href, icon, suffix } = toItem(item), isActive = i === active;
      const common = { className: "u-gooey-label", "data-slot": "gooey-nav-item", "data-active": isActive, onClick: () => { if (value === undefined) setInternal(i); onChange?.(i); } };
      const content = <>{icon}<span>{label}</span>{suffix}</>;
      return <Segment key={href || label} gap={i === 0 ? 0 : open(i) ? span : -1} span={span} first={i === 0} leftFill={fill(i - 1)} rightFill={fill(i)} active={isActive} reduced={reduced} radii={{ borderTopLeftRadius: open(i) ? radius : 0, borderBottomLeftRadius: open(i) ? radius : 0, borderTopRightRadius: open(i + 1) ? radius : 0, borderBottomRightRadius: open(i + 1) ? radius : 0 }}>
        {href ? <Link {...common} href={href} aria-current={isActive ? "page" : undefined}>{content}</Link> : <button {...common} type="button" role={tabMode ? "tab" : undefined} aria-selected={tabMode ? isActive : undefined} aria-pressed={tabMode ? undefined : isActive} tabIndex={tabMode ? isActive ? 0 : -1 : undefined} onKeyDown={(e) => {
          if (!tabMode || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault(); const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
          if (value === undefined) setInternal(next); onChange?.(next); nav.current?.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus();
        }}>{content}</button>}
      </Segment>;
    })}</ul>
  </nav>;
}
