"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
  type AnimationPlaybackControls,
} from "motion/react";

function DigitColumn({ value, reduced }: { value: number; reduced: boolean }) {
  const position = useSpring(value, { stiffness: 400, damping: 30, mass: 0.9 });
  const y = useTransform(position, (p) => `${-p * 100}%`);
  const velocity = useVelocity(position);
  const mask = useTransform(velocity, (v) => {
    const fade = Math.min(34, (Math.abs(v) / 9) * 34);
    return `linear-gradient(to bottom, transparent 0%, #000 ${fade}%, #000 ${100 - fade}%, transparent 100%)`;
  });
  useEffect(() => {
    const gap = value - position.get();
    if (Math.abs(gap) > 2) position.jump(value - Math.sign(gap) * 2);
    if (reduced) position.jump(value);
    else position.set(value);
  }, [value, reduced, position]);
  return (
    <motion.span
      className="u-bell-digit"
      style={{
        maskImage: reduced ? undefined : mask,
        WebkitMaskImage: reduced ? undefined : mask,
      }}
    >
      <motion.span className="u-bell-column" style={{ y }}>
        {Array.from({ length: 7 }, (_, i) => {
          const tile = value - 3 + i;
          return (
            <span key={tile} style={{ top: `${tile * 100}%` }}>
              {((tile % 10) + 10) % 10}
            </span>
          );
        })}
      </motion.span>
    </motion.span>
  );
}

export function NotificationBell({
  count = 0,
  max = 99,
  ready = true,
  size = 40,
  className = "",
  style,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  count?: number;
  max?: number;
  ready?: boolean;
  size?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const limit = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 99;
  const swing = useMotionValue(0),
    velocity = useVelocity(swing);
  const lag = useTransform(velocity, [-450, 0, 450], [13, 0, -13], {
    clamp: true,
  });
  const clapper = useSpring(lag, { stiffness: 300, damping: 14, mass: 1 });
  const previous = useRef<number | null>(null),
    ringing = useRef<AnimationPlaybackControls | null>(null);
  useEffect(() => {
    if (!ready) return;
    const delta = previous.current === null ? 0 : total - previous.current;
    previous.current = total;
    if (reduced) {
      ringing.current?.stop();
      swing.jump(0);
      clapper.jump(0);
      return;
    }
    if (delta <= 0) return;
    const moving = swing.getVelocity();
    const weight = 0.7 + (0.6 * Math.min(delta, 5)) / 5;
    const impulse = moving + (moving > 1 ? 1 : -1) * 500 * weight;
    ringing.current?.stop();
    ringing.current = animate(swing, 0, {
      type: "spring",
      stiffness: 220,
      damping: 10,
      mass: 1,
      restDelta: 0.01,
      velocity: Math.max(-900, Math.min(900, impulse)),
    });
  }, [total, ready, reduced, swing, clapper]);
  useEffect(() => () => ringing.current?.stop(), []);
  const side = size * 0.4,
    places = String(total).length;
  const inset = size / 2 - (0.9 * size * Math.SQRT1_2) / 2 - side / 2;

  return (
    <button
      {...props}
      type="button"
      className={`u-notification-bell ${className}`}
      data-slot="notification-bell"
      data-unread={ready ? total : undefined}
      style={{ width: size, height: size, ...style }}
    >
      <span role="status" className="u-sr-only">
        {ready
          ? total
            ? `消息通知，${total} 条未读`
            : "消息通知，暂无未读"
          : "消息通知"}
      </span>
      <motion.svg
        viewBox="0 0 18 18"
        fill="currentColor"
        aria-hidden="true"
        width={size * 0.56}
        height={size * 0.56}
        style={{ rotate: swing, transformOrigin: "50% 12%" }}
      >
        <path
          fillOpacity={0.65}
          d="M3.5 6.5C3.5 3.46279 5.96279 1 9 1C12.0372 1 14.5 3.46279 14.5 6.5V10.75C14.5 11.4408 15.0592 12 15.75 12C16.1642 12 16.5 12.3358 16.5 12.75C16.5 13.1642 16.1642 13.5 15.75 13.5H2.25C1.83579 13.5 1.5 13.1642 1.5 12.75C1.5 12.3358 1.83579 12 2.25 12C2.94079 12 3.5 11.4408 3.5 10.75V6.5Z"
        />
        <motion.path
          style={{
            rotate: reduced ? 0 : clapper,
            transformBox: "fill-box",
            transformOrigin: "50% 0%",
          }}
          d="M10.2 15H7.80099C7.64999 15 7.50799 15.068 7.41299 15.185C7.31799 15.302 7.28099 15.456 7.31199 15.603C7.48499 16.425 8.17999 17 9.00099 17C9.82199 17 10.517 16.425 10.69 15.603C10.721 15.456 10.684 15.302 10.589 15.185C10.494 15.068 10.351 15 10.2 15Z"
        />
      </motion.svg>
      <AnimatePresence initial={false}>
        {ready && total > 0 && (
          <motion.span
            className="u-bell-badge"
            aria-hidden="true"
            layout={!reduced}
            style={{
              top: inset,
              right: inset,
              minWidth: side,
              height: side,
              fontSize: Math.max(10, size * 0.21),
            }}
            initial={{ opacity: 0, scale: reduced ? 1 : 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0 }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: "spring", stiffness: 600, damping: 20 }
            }
          >
            {total > limit
              ? `${limit}+`
              : Array.from({ length: places }, (_, i) => {
                  const place = places - 1 - i;
                  return (
                    <DigitColumn
                      key={place}
                      value={Math.floor(total / 10 ** place)}
                      reduced={reduced}
                    />
                  );
                })}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
