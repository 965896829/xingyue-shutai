import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  animate,
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform
} from 'motion/react';

// Adapted from the author's supplied DeleteButton: hinged lid, recessed confirmation panel,
// spring press and kept/deleted feedback. Success waits for the actual asynchronous operation.
const EASE = [0.32, 0.72, 0, 1] as const;
const ICON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const;
type Status = 'idle' | 'pending' | 'deleted' | 'kept';

export function DeleteButton({
  label,
  description,
  onConfirm,
  compact = false,
  disabled = false
}: {
  label: string;
  description: string;
  onConfirm: () => Promise<boolean | void> | boolean | void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const descriptionId = useId();
  const panelId = useId();
  const top = useMotionValue(6);
  const wall = useTransform(top, (y) => 20 - y);
  const bin = useMotionTemplate`M19 ${top}v${wall}a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V${top}`;
  const settle = useMotionValue(1);
  const size = compact ? 32 : 48;
  const panel = compact ? 72 : 84;
  const duration = (seconds: number) => (reduced ? 0 : seconds);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const control = animate(top, open ? 13.5 : 6, { duration: duration(0.56), ease: EASE });
    return () => control.stop();
  }, [open, reduced, top]);
  useEffect(() => {
    if (status !== 'deleted' && status !== 'kept') return;
    const nudge =
      status === 'kept' && !reduced ? animate(settle, [1, 0.86, 1], { duration: 0.45, ease: EASE }) : null;
    const timer = setTimeout(() => setStatus('idle'), status === 'deleted' ? 1400 : 600);
    return () => {
      clearTimeout(timer);
      nudge?.stop();
    };
  }, [status, reduced, settle]);
  function cancel(returnFocus = true) {
    if (pending.current) return;
    setOpen(false);
    setStatus('kept');
    setError('');
    if (returnFocus) trigger.current?.focus();
  }
  async function remove() {
    if (pending.current || disabled) return;
    pending.current = true;
    setStatus('pending');
    setError('');
    try {
      const success = await onConfirm();
      if (success === false) throw new Error('操作未完成，请查看错误提示后重试。');
      if (mounted.current) {
        setOpen(false);
        setStatus('deleted');
        trigger.current?.focus();
      }
    } catch (e) {
      if (mounted.current) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      pending.current = false;
    }
  }
  const circle = (text: string, action: () => void, children: ReactNode, isConfirm = false) => (
    <motion.button
      ref={isConfirm ? confirm : undefined}
      type="button"
      className="delete-circle"
      aria-label={text}
      title={text}
      disabled={disabled || status === 'pending'}
      onClick={action}
      whileHover={reduced ? undefined : { scale: 1.03 }}
      whileTap={reduced ? undefined : { scale: 0.84 }}
      transition={{ type: 'spring', stiffness: 520, damping: 18, mass: 0.5 }}
    >
      <svg {...ICON} width="14" height="14" stroke="currentColor" strokeWidth="3.5">
        {children}
      </svg>
    </motion.button>
  );
  return (
    <motion.div
      className={`delete-control ${compact ? 'compact' : ''}`}
      data-state={open ? 'open' : 'closed'}
      data-status={status}
      style={{ '--delete-size': `${size}px` } as CSSProperties}
      animate={{ width: open ? size + panel : size }}
      transition={{ duration: duration(0.62), ease: EASE }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && open) cancel(false);
      }}
    >
      <motion.button
        ref={trigger}
        type="button"
        className="delete-trigger"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={open ? descriptionId : undefined}
        disabled={disabled || status === 'pending'}
        onClick={() => {
          if (open) cancel();
          else {
            setStatus('idle');
            setError('');
            setOpen(true);
          }
        }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={{ duration: duration(0.2) }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === 'deleted' ? (
            <motion.svg
              key="done"
              {...ICON}
              width="20"
              height="20"
              stroke="var(--delete-accent)"
              strokeWidth="2.5"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: duration(0.22) }}
            >
              <motion.path
                d="M4 12.5 9.5 18 20 7"
                initial={reduced ? undefined : { pathLength: 0 }}
                animate={reduced ? undefined : { pathLength: 1 }}
              />
            </motion.svg>
          ) : (
            <motion.svg
              key="bin"
              {...ICON}
              width="20"
              height="20"
              stroke="currentColor"
              strokeWidth="2"
              style={{ scale: settle, overflow: 'visible' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration(0.22) }}
            >
              <motion.path d={bin} />
              <motion.g
                style={{ transformBox: 'view-box', transformOrigin: '3px 6px' }}
                animate={{ rotate: open ? -35 : 0 }}
                transition={{ duration: duration(0.6), ease: [0.34, 1.1, 0.64, 1] }}
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </motion.g>
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === 'pending'
          ? '正在处理'
          : status === 'deleted'
            ? `${label}已完成`
            : status === 'kept'
              ? '已取消，内容保留'
              : ''}
      </span>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            className="delete-panel"
            style={{ width: panel }}
            initial={{ opacity: 0, x: reduced ? 0 : -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration(0.3) }}
          >
            {circle(
              `确认${label}`,
              () => void remove(),
              <path d="M4 12.5 9.5 18 20 7" stroke="var(--delete-accent)" />,
              true
            )}
            {circle(`取消${label}`, () => cancel(), <path d="M6 6 18 18M18 6 6 18" />)}
          </motion.div>
        )}
      </AnimatePresence>
      {open && (
        <div className="delete-description" id={descriptionId}>
          {description}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </motion.div>
  );
}
