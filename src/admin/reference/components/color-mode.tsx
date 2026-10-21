"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MoonStar, Sun } from "lucide-react";

type ColorMode = "dark" | "light";
const storageKey = "novel-color-mode";
const ColorModeContext = createContext({ mode: "dark" as ColorMode, toggle: () => {} });

export const useColorMode = () => useContext(ColorModeContext);

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>("dark");
  useEffect(() => {
    setMode(document.documentElement.dataset.colorMode === "light" ? "light" : "dark");
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const next = event.newValue === "light" ? "light" : "dark";
      document.documentElement.dataset.colorMode = next;
      setMode(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function toggle() {
    const next = document.documentElement.dataset.colorMode === "light" ? "dark" : "light";
    document.documentElement.dataset.colorMode = next;
    setMode(next);
    try { localStorage.setItem(storageKey, next); } catch { /* The current tab still keeps the choice. */ }
  }
  return <ColorModeContext.Provider value={{ mode, toggle }}>{children}</ColorModeContext.Provider>;
}

export function ColorModeToggle() {
  const { mode, toggle } = useColorMode();
  const title = mode === "dark" ? "切换到日间模式" : "切换到夜间模式";
  const Icon = mode === "dark" ? Sun : MoonStar;
  return <button type="button" className="color-mode-toggle" onClick={toggle} aria-label={title} title={title}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /></button>;
}
