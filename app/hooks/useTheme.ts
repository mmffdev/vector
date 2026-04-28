"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

// Module-level singleton: all useTheme instances share one notification channel.
// When any consumer calls toggle(), every other mounted consumer re-renders.
const subscribers = new Set<(t: Theme) => void>();

function applyTheme(next: Theme) {
  localStorage.setItem("theme", next);
  document.documentElement.setAttribute("data-theme", next);
  subscribers.forEach((fn) => fn(next));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const initial = stored || "dark";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
    setMounted(true);

    subscribers.add(setTheme);
    return () => { subscribers.delete(setTheme); };
  }, []);

  const toggle = () => {
    applyTheme(theme === "light" ? "dark" : "light");
  };

  const setMode = (next: Theme) => {
    if (next !== theme) applyTheme(next);
  };

  return { theme, toggle, setMode, mounted };
}
