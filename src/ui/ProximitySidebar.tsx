import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue
} from 'motion/react';

export type ProximitySection = {
  id: string;
  label: string;
  kind?: 'title' | 'subtitle' | 'section' | 'body';
};
const widths = { title: 0.48, subtitle: 0.42, section: 0.34, body: 0.28 };

// Based on the supplied ProximitySidebar. Measure the chat viewport, not the window,
// and scroll only that viewport so the composer and editor stay in place.
function Dash({
  section,
  active,
  mouseY,
  reduced,
  onSelect
}: {
  section: ProximitySection;
  active: boolean;
  mouseY: MotionValue<number>;
  reduced: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const base = widths[section.kind ?? 'body'];
  const target = useTransform(mouseY, (y) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !Number.isFinite(y)) return active ? Math.max(base, 0.6) : base;
    const proximity = Math.max(0, 1 - Math.abs(y - rect.top - rect.height / 2) / 40);
    return base + (1 - base) * proximity;
  });
  const scale = useSpring(target, { stiffness: 320, damping: 34, mass: 0.7 });
  useEffect(() => {
    target.set(active ? Math.max(base, 0.6) : base);
  }, [active, base, target]);
  return (
    <button
      ref={ref}
      type="button"
      className="proximity-dash"
      aria-current={active ? 'location' : undefined}
      aria-label={`跳转到${section.label}`}
      title={section.label}
      onClick={() => onSelect(section.id)}
      onFocus={() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) mouseY.set(r.top + r.height / 2);
      }}
      onBlur={() => mouseY.set(Infinity)}
    >
      <motion.span style={{ scaleX: reduced ? target : scale, transformOrigin: 'left center' }} />
    </button>
  );
}

export function ProximitySidebar({
  sections,
  scrollRef
}: {
  sections: ProximitySection[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const mouseY = useMotionValue(Infinity);
  const reduced = useReducedMotion() ?? false;
  const [activeId, setActiveId] = useState<string | undefined>(sections[0]?.id);
  const key = sections.map((s) => s.id).join('|');
  const find = useCallback(
    (id: string) => {
      const element = document.getElementById(id);
      return element && scrollRef.current?.contains(element) ? element : null;
    },
    [scrollRef]
  );
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    function update() {
      frame = 0;
      if (!root) return;
      const top = root.getBoundingClientRect().top;
      const anchor = top + root.clientHeight * 0.4;
      let best: string | undefined = sections[0]?.id;
      let distance = Infinity;
      for (const s of sections) {
        const r = find(s.id)?.getBoundingClientRect();
        if (!r) continue;
        const d =
          r.top <= anchor && r.bottom >= anchor
            ? 0
            : Math.min(Math.abs(r.top - anchor), Math.abs(r.bottom - anchor));
        if (d < distance) {
          distance = d;
          best = s.id;
        }
      }
      // At the bottom, the final short result may never reach the 40% anchor.
      if (
        root.scrollHeight > root.clientHeight &&
        root.scrollTop + root.clientHeight >= root.scrollHeight - 2
      )
        best = sections.at(-1)?.id;
      setActiveId(best);
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    for (const s of sections) {
      const el = find(s.id);
      if (el) resize.observe(el);
    }
    root.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      resize.disconnect();
      root.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [key, find, scrollRef]);
  function select(id: string) {
    const root = scrollRef.current,
      element = find(id);
    if (!root || !element) return;
    root.scrollTo({
      top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 8,
      behavior: reduced ? 'instant' : 'smooth'
    });
    setActiveId(id);
  }
  if (!sections.length) return null;
  return (
    <nav className="proximity-sidebar" aria-label="对话内容导航">
      <div
        className="proximity-track"
        onPointerMove={(e) => mouseY.set(e.clientY)}
        onPointerLeave={() => mouseY.set(Infinity)}
      >
        {sections.map((section) => (
          <Dash
            key={section.id}
            section={section}
            active={activeId === section.id}
            mouseY={mouseY}
            reduced={reduced}
            onSelect={select}
          />
        ))}
      </div>
    </nav>
  );
}
