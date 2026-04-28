"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface PageHeaderState {
  title: string;
  subtitle?: string;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
}

interface PageHeaderContextValue {
  header: PageHeaderState | null;
  setHeader: (h: PageHeaderState | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = useState<PageHeaderState | null>(null);
  return (
    <PageHeaderContext.Provider value={{ header, setHeader }}>{children}</PageHeaderContext.Provider>
  );
}

export function usePageHeaderState(): PageHeaderState | null {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeaderState must be inside PageHeaderProvider");
  return ctx.header;
}

export function usePageHeader(h: PageHeaderState) {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeader must be inside PageHeaderProvider");
  const { setHeader } = ctx;
  const set = useCallback(setHeader, [setHeader]);
  const { title, subtitle, breadcrumbs, actions } = h;
  useEffect(() => {
    set({ title, subtitle, breadcrumbs, actions });
    return () => set(null);
  }, [set, title, subtitle, breadcrumbs, actions]);
}
