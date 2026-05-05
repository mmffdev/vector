"use client";

import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

export interface PageHeaderState {
  title: string;
  subtitle?: string;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  // Optional override for the top header bar's "Vector + …" label.
  // Defaults to `title` when unset. Lets a page show one label in
  // the navigation bar (e.g. the route name) and a different
  // title/subtitle in the in-page title row (e.g. the active tab).
  barTitle?: string;
}

interface StackEntry extends PageHeaderState {
  id: string;
}

interface PageHeaderContextValue {
  push: (id: string, h: PageHeaderState) => void;
  pop: (id: string) => void;
  top: PageHeaderState | null;
  // First push on the stack — the route-level header. Used by
  // PageHeaderBar so the "Vector + …" label keeps showing the
  // route the user navigated to, even when nested PageShells (e.g.
  // an embedded tab) push a more specific section header on top.
  root: PageHeaderState | null;
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
    root: stack.length > 0 ? stack[0] : null,
  }), [stack]);

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

export function usePageHeaderState(): PageHeaderState | null {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeaderState must be inside PageHeaderProvider");
  return ctx.top;
}

// Bottom-of-stack accessor. Returns the route-level header — the
// first PageShell to push, which represents the page the user
// navigated to. Stays stable when nested PageShells push and pop.
export function usePageHeaderRoot(): PageHeaderState | null {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeaderRoot must be inside PageHeaderProvider");
  return ctx.root;
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
  const { title, subtitle, breadcrumbs, actions, barTitle } = h;
  useEffect(() => {
    pushRef.current(id, { title, subtitle, breadcrumbs, actions, barTitle });
    return () => popRef.current(id);
  }, [id, title, subtitle, breadcrumbs, actions, barTitle]);
}
