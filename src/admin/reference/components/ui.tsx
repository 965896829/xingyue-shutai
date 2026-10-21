"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Inbox,
  ChevronRight,
} from "lucide-react";
import { label } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import type { AuthorProblem } from "@reference/lib/author-copy";

const ToastContext = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
    id: number;
    problem?: AuthorProblem;
  } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.problem ? 15000 : 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const show = (event: Event) => { const problem=(event as CustomEvent<AuthorProblem>).detail; setToast({message:problem.message,error:true,id:Date.now(),problem}); };
    window.addEventListener("novel:api-error",show);
    return () => window.removeEventListener("novel:api-error",show);
  }, []);
  return (
    <ToastContext.Provider
      value={(message, error = false) =>
        setToast(old => ({ message, error, id: Date.now(),problem:old?.message===message ? old.problem : undefined }))
      }
    >
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          {toast.problem && (toast.problem.action.href ? <a className="text-button" href={toast.problem.action.href}>{toast.problem.action.label}</a> : <button className="text-button" onClick={() => {
            const fields=toast.problem?.fields || [];
            const target=fields.map(f=>document.querySelector<HTMLElement>(`[name="${CSS.escape(f)}"], [name="${CSS.escape(f.split('.').at(-1) || f)}"]`)).find(Boolean) || document.querySelector<HTMLElement>('input:invalid,textarea:invalid,select:invalid,form input,form textarea');
            target?.scrollIntoView({block:"center",behavior:"smooth"});target?.focus();
          }}>{toast.problem.action.label}</button>)}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <i />
      {label(value)}
    </span>
  );
}
export function Spinner({ text = "正在读取…" }: { text?: string }) {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
export function Empty({
  title = "这里还没有内容",
  description = "新建第一条记录，让这个空间开始运转。",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Inbox size={32} strokeWidth={1.2} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div className="error-state">
      <AlertCircle size={26} />
      <h3>暂时无法读取</h3>
      <p>{error.message}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          重新尝试
        </button>
      )}
    </div>
  );
}
export function Drawer({
  title,
  subtitle,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  // Keep existing callers while using the same centered window as the admin forms.
  return (
    <Modal title={title} subtitle={subtitle} footer={footer} onClose={onClose} wide={wide}>
      {children}
    </Modal>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function Pagination({
  page,
  size,
  total,
  setPage,
}: {
  page: number;
  size: number;
  total: number;
  setPage: (n: number) => void;
}) {
  return (
    <footer className="pagination">
      <span>共 {total} 条记录</span>
      <div>
        <span>
          {page} / {Math.max(1, Math.ceil(total / size))}
        </span>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
        </button>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={page * size >= total}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </footer>
  );
}
