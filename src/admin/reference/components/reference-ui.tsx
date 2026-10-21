"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, Search, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { GooeyNav } from "./interaction/gooey-nav";

const openModals = new Set<HTMLDialogElement>();
let originalOverflow = "";

export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  wide = false,
  fullscreen = false,
  className = "",
  icon,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  fullscreen?: boolean;
  className?: string;
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef(onClose),
    subtitleId = useId();
  close.current = onClose;
  useEffect(() => {
    const el = ref.current,
      previous = document.activeElement as HTMLElement;
    if (!el) return;
    el.showModal();
    if (!openModals.size) originalOverflow = document.body.style.overflow;
    openModals.add(el);
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      openModals.delete(el);
      if (!openModals.size) document.body.style.overflow = originalOverflow;
      const top = Array.from(openModals).at(-1);
      if (previous?.isConnected && (!top || top.contains(previous))) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`ref-modal ${wide ? "wide" : ""} ${fullscreen ? "fullscreen" : ""} ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !fullscreen) {
          const b = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            onClose();
        }
      }}
    >
      <header className="ref-modal-header">
        <div className="ref-modal-title"><h2>
          {icon}
          {title}
        </h2>{subtitle && <p id={subtitleId}>{subtitle}</p>}</div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="ref-modal-body">{children}</div>
      {footer && <footer className="ref-modal-footer">{footer}</footer>}
    </dialog>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "搜索…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="ref-search">
      <Search size={15} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="icon-button"
          aria-label="清空搜索"
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}
export function RefTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <GooeyNav tabMode size="sm" aria-label="模块分类" items={tabs} value={tabs.indexOf(value)} onChange={(i) => onChange(tabs[i])} />
  );
}
export function RefEmpty({ text = "暂无数据" }: { text?: string }) {
  return (
    <div className="ref-empty">
      <Inbox size={34} strokeWidth={1} />
      <span>{text}</span>
    </div>
  );
}
export function RefPagination({
  page,
  size,
  total,
  onPage,
  onSize,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="ref-pagination">
      <span>共 {total} 条</span>
      <button
        className="icon-button"
        aria-label="上一页"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={15} />
      </button>
      {Array.from(
        { length: Math.min(5, pages) },
        (_, i) => Math.min(Math.max(1, page - 2), Math.max(1, pages - 4)) + i,
      ).map((p) => (
        <button
          className={`ref-page-number ${p === page ? "active" : ""}`}
          key={p}
          aria-label={`第 ${p} 页`}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onPage(p)}
        >
          {p}
        </button>
      ))}
      <button
        className="icon-button"
        aria-label="下一页"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={15} />
      </button>
      <select
        aria-label="每页条数"
        value={size}
        onChange={(e) => onSize(Number(e.target.value))}
      >
        {[10, 12, 15, 20, 50, 100].map((n) => (
          <option key={n} value={n}>
            {n} 条/页
          </option>
        ))}
      </select>
    </div>
  );
}
export function CompactHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="ref-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ref-actions">{actions}</div>}
    </div>
  );
}
