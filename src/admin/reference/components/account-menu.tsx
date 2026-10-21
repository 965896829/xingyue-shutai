"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "@reference/router";
import Link from "@reference/router-link";
import { LogOut, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { useToast } from "./ui";
import { usableLink } from "./site-display";

type Account = {
  username: string;
  nickname?: string;
  role: string;
  balance: number;
  reserved: number;
  meta?: { avatar_url?: string; avatar?: string };
};

export function AccountMenu({ user, onLogout, onOpen }: { user: Account; onLogout: () => Promise<void>; onOpen?: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [failedAvatar, setFailedAvatar] = useState("");
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const pathname = usePathname(), id = useId(), toast = useToast();
  const name = user.nickname || user.username;
  const avatar = user.meta?.avatar_url || user.meta?.avatar;
  const hasAvatar = usableLink(avatar) && avatar !== failedAvatar;
  const admin = ["superadmin", "manager", "operator", "evaluator"].includes(user.role);
  const available = Math.max(0, user.balance - user.reserved);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  function navigate(event: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
  const picture = hasAvatar ? <img src={avatar} alt="" onError={() => setFailedAvatar(avatar!)} /> : <UserRound size={20} strokeWidth={1.6} aria-hidden="true" />;
  return <div className="account-menu" ref={root} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="account-menu-trigger" aria-label="打开账户菜单" title={name} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => {
      if (!open) onOpen?.();
      setOpen(!open);
    }} onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) onOpen?.(); setOpen(true); }
    }}>{picture}</button>
    {open && <div className="account-menu-popover" ref={menu} id={id} role="menu" aria-label="账户菜单" onKeyDown={navigate}>
      <div className="account-menu-summary" role="presentation">
        <span className="account-menu-avatar">{picture}</span>
        <div className="account-menu-identity"><div><strong title={name}>{name}</strong><span className="account-menu-status"><i />已登录</span></div><p>可用点数 <strong>{available.toLocaleString("zh-CN")} <small>点</small></strong></p></div>
      </div>
      <div className="account-menu-links" role="presentation">
        <Link href="/studio/settings" role="menuitem" onClick={() => setOpen(false)}><UserRound size={17} />个人空间</Link>
        <Link href="/studio/wallet" role="menuitem" onClick={() => setOpen(false)}><Wallet size={17} />我的钱包</Link>
        {admin && <Link href="/admin/dashboard" role="menuitem" onClick={() => setOpen(false)}><ShieldCheck size={17} />管理后台</Link>}
      </div>
      <div className="account-menu-footer" role="presentation"><button type="button" role="menuitem" disabled={busy} onClick={async () => {
        if (busy) return;
        setBusy(true);
        try { await onLogout(); } catch (error) { toast((error as Error).message, true); } finally { setBusy(false); }
      }}><LogOut size={17} />{busy ? "正在退出…" : "退出登录"}</button></div>
    </div>}
  </div>;
}
