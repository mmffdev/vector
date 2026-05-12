"use client";

import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from "react";

interface ActiveLabel {
  level: number;
  label: string;
}

interface ActiveNavValue {
  publish: (level: number, label: string | null) => void;
  deepestLabel: string | null;
}

const ActiveNavContext = createContext<ActiveNavValue | null>(null);

export function ActiveNavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ActiveLabel[]>([]);

  const publish = useCallback((level: number, label: string | null) => {
    setStack((prev) => {
      const filtered = prev.filter((e) => e.level !== level);
      if (!label) return filtered;
      return [...filtered, { level, label }].sort((a, b) => a.level - b.level);
    });
  }, []);

  const deepestLabel = stack.length > 0 ? stack[stack.length - 1].label : null;

  const value = useMemo(() => ({ publish, deepestLabel }), [publish, deepestLabel]);
  return <ActiveNavContext.Provider value={value}>{children}</ActiveNavContext.Provider>;
}

export function useActiveNav(): ActiveNavValue {
  const ctx = useContext(ActiveNavContext);
  if (!ctx) {
    return { publish: () => {}, deepestLabel: null };
  }
  return ctx;
}
