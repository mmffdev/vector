"use client";

import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

export interface PageHeaderState {
  title: string;
  subtitle?: string;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
}

interface StackEntry extends PageHeaderState {
  id: string;
}

interface PageHeaderContextValue {
  push: (id: string, h: PageHeaderState) => void;
  pop: (id: string) => void;
  top: PageHeaderState | null;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

// Stack model: every PageShell pushes its header on mount and pops on unmount.
// The visible header is the top of the stack. This survives nested PageShells
// (e.g. Workspace Settings tab mounts a standalone page with its own PageShell),
// because popping the inner one restores the outer one rather than wiping it.
export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<StackEntry[]>([]);

  const value = useMemo<PageHeaderContextValue>(() => ({
    push: (id, h) =>
      setStack((prev) => {
        const without = prev.filter((e) => e.id !== id);
        return [...without, { id, ...h }];
      }),
    pop: (id) => setStack((prev) => prev.filter((e) => e.id !== id)),
    top: stack.length > 0 ? stack[stack.length - 1] : null,
  }), [stack]);

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

export function usePageHeaderState(): PageHeaderState | null {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeaderState must be inside PageHeaderProvider");
  return ctx.top;
}

export function usePageHeader(h: PageHeaderState) {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeader must be inside PageHeaderProvider");
  const id = useId();
  const { push, pop } = ctx;
  const pushRef = useRef(push);
  const popRef = useRef(pop);
  pushRef.current = push;
  popRef.current = pop;
  const { title, subtitle, breadcrumbs, actions } = h;
  useEffect(() => {
    pushRef.current(id, { title, subtitle, breadcrumbs, actions });
    return () => popRef.current(id);
  }, [id, title, subtitle, breadcrumbs, actions]);
}
