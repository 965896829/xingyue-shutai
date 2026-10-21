"use client";

import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
} from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";

type Props = Omit<ComponentProps<"button">, "onClick"> & {
  onClick?: (
    event: MouseEvent<HTMLButtonElement>,
  ) => unknown | Promise<unknown>;
  /** dialog opens an existing confirmation; commit is its final action. */
  confirmation?: "inline" | "dialog" | "commit";
  destructive?: boolean;
};
const ease = [0.32, 0.72, 0, 1] as const;
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function DeleteButton({ destructive = true, ...props }: Props) {
  if (!destructive) {
    const { confirmation: _confirmation, onClick, ...button } = props;
    return <button type="button" {...button} onClick={onClick} />;
  }
  return <AnimatedDeleteButton {...props} />;
}

function AnimatedDeleteButton({
  confirmation = "inline",
  onClick,
  children,
  className = "",
  disabled,
  ...props
}: Props) {
  const reduced = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false),
    [hover, setHover] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "pending" | "deleted" | "kept" | "error"
  >("idle");
  const [error, setError] = useState("");
  const root = useRef<HTMLSpanElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    confirm = useRef<HTMLButtonElement>(null);
  const pending = useRef(false),
    mounted = useRef(true);
  const id = useId();
  const [triggerWidth, setTriggerWidth] = useState<number>();
  const label =
    props["aria-label"] ||
    (typeof children === "string" ? children.trim() : "删除");
  const expanded = open && confirmation === "inline";
  const top = useMotionValue(6),
    wall = useTransform(top, (y) => 20 - y);
  const bin = useMotionTemplate`M19 ${top}v${wall}a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V${top}`;
  const settle = useMotionValue(1);
  const timing = (duration: number) => ({
    duration: reduced ? 0 : duration,
    ease,
  });
  const locked = disabled || status === "pending" || status === "deleted";

  useIsoLayoutEffect(() => {
    const button = trigger.current;
    if (!button) return;
    const measure = () => { const width = button.getBoundingClientRect().width; if (width > 0) setTriggerWidth(width); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(button);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const control = animate(top, expanded || status === "pending" ? 13.5 : 6, {
      duration: reduced ? 0 : 0.56,
      ease,
    });
    return () => control.stop();
  }, [expanded, status, reduced, top]);
  useEffect(() => {
    if (status !== "kept" && status !== "deleted") return;
    const nudge =
      status === "kept" && !reduced
        ? animate(settle, [1, 0.86, 1], { duration: 0.45, ease })
        : null;
    const timer = setTimeout(
      () => setStatus("idle"),
      status === "kept" ? 600 : 1400,
    );
    return () => {
      clearTimeout(timer);
      nudge?.stop();
    };
  }, [status, settle, reduced]);
  useEffect(() => {
    if (!expanded) return;
    confirm.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!pending.current && !root.current?.contains(e.target as Node)) {
        setOpen(false);
        setStatus("idle");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);

  function cancel() {
    if (pending.current) return;
    setOpen(false);
    setError("");
    setStatus("kept");
    trigger.current?.focus();
  }
  async function execute(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (pending.current || disabled) return;
    pending.current = true;
    setError("");
    setStatus("pending");
    try {
      const result = await onClick?.(event);
      if (!mounted.current) return;
      if (result === false || result === null)
        throw new Error("操作未完成，请检查提示后重试。");
      setOpen(false);
      setStatus("deleted");
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (e) {
      if (mounted.current) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "删除失败，请重试。");
        requestAnimationFrame(() =>
          (confirmation === "inline"
            ? confirm.current
            : trigger.current
          )?.focus(),
        );
      }
    } finally {
      pending.current = false;
    }
  }

  return (
    <motion.span
      ref={root}
      className={`u-delete ${children ? "" : "u-delete-icon-only"}`}
      data-slot="delete-button"
      data-state={expanded ? "open" : "closed"}
      data-status={status}
      initial={false}
      animate={triggerWidth ? { width: triggerWidth + (expanded ? 84 : 0) } : undefined}
      transition={timing(0.62)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && expanded) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onBlur={(e) => {
        if (
          expanded &&
          e.relatedTarget &&
          !e.currentTarget.contains(e.relatedTarget as Node) &&
          !pending.current
        ) {
          setOpen(false);
          setStatus("idle");
        }
      }}
    >
      <button
        {...props}
        ref={trigger}
        type="button"
        className={`u-delete-trigger ${className}`}
        disabled={disabled || status === "pending"}
        aria-disabled={locked}
        aria-label={label}
        aria-expanded={confirmation === "inline" ? expanded : undefined}
        aria-controls={expanded ? id : undefined}
        aria-describedby={error ? `${id}-error` : props["aria-describedby"]}
        aria-busy={status === "pending"}
        onPointerEnter={(e) => {
          setHover(true);
          props.onPointerEnter?.(e);
        }}
        onPointerLeave={(e) => {
          setHover(false);
          props.onPointerLeave?.(e);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (locked) return;
          if (confirmation === "dialog") {
            onClick?.(e);
            return;
          }
          if (confirmation === "commit") {
            void execute(e);
            return;
          }
          if (expanded) cancel();
          else {
            setStatus("idle");
            setError("");
            setOpen(true);
          }
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === "deleted" ? (
            <motion.svg
              key="done"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FF5F2E"
              strokeWidth="2.5"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={timing(0.22)}
            >
              <motion.path
                d="M4 12.5 9.5 18 20 7"
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={timing(0.45)}
              />
            </motion.svg>
          ) : (
            <motion.svg
              key="bin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ scale: settle }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={timing(0.22)}
            >
              <motion.path d={bin} />
              <motion.g
                style={{ transformBox: "view-box", transformOrigin: "3px 6px" }}
                animate={{
                  rotate: reduced
                    ? 0
                    : expanded || status === "pending"
                      ? -35
                      : hover
                        ? -15
                        : 0,
                }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.6, ease: [0.34, 1.1, 0.64, 1] }
                }
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </motion.g>
            </motion.svg>
          )}
        </AnimatePresence>
        {children && <span className="u-delete-label">{children}</span>}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.span
            id={id}
            className="u-delete-panel"
            role="group"
            aria-label={`确认${label}`}
            style={{ width: 84 }}
            initial={{ x: -6, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -6, opacity: 0 }}
            transition={{ ...timing(0.44), delay: reduced ? 0 : .14 }}
          >
            <motion.button
              ref={confirm}
              type="button"
              className="u-delete-circle u-delete-confirm"
              aria-label={`确认${label}`}
              disabled={locked}
              onClick={execute}
              whileHover={reduced ? undefined : { scale: 1.03 }}
              whileTap={reduced ? undefined : { scale: 0.84 }}
              transition={{
                type: "spring",
                stiffness: 520,
                damping: 18,
                mass: 0.5,
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12.5 9.5 18 20 7" />
              </svg>
            </motion.button>
            <motion.button
              type="button"
              className="u-delete-circle"
              aria-label="取消删除"
              disabled={status === "pending"}
              onClick={(e) => {
                e.stopPropagation();
                cancel();
              }}
              whileHover={reduced ? undefined : { scale: 1.03 }}
              whileTap={reduced ? undefined : { scale: 0.84 }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6 18 18M18 6 6 18" />
              </svg>
            </motion.button>
          </motion.span>
        )}
      </AnimatePresence>
      <span className="u-sr-only" role="status" aria-live="polite">
        {status === "pending"
          ? "正在处理，请稍候"
          : status === "deleted"
            ? "操作已完成"
            : status === "kept"
              ? "已取消，内容保留"
              : ""}
      </span>
      {error && (
        <span id={`${id}-error`} className="u-delete-error" role="alert">
          {error}
        </span>
      )}
    </motion.span>
  );
}
