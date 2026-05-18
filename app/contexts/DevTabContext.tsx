"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

type DevTab = "setup" | "shortcuts" | "reports" | "research" | "operations" | "icons" | "plans" | "page-help" | "retros" | "ui-catalog" | "api-v2-tests" | "api-changelog" | "scope" | "security-audits";

interface DevTabContextValue {
  activeTab: DevTab;
  setActiveTab: (tab: DevTab) => void;
  openResearchPapers: Set<string>;
  toggleResearchPaper: (paperId: string, open: boolean) => void;
  openOperations: Set<string>;
  toggleOperation: (operationId: string, open: boolean) => void;
}

const DevTabContext = createContext<DevTabContextValue | null>(null);
const RESEARCH_STORAGE_KEY = "dev-setup-open-research";
const OPERATIONS_STORAGE_KEY = "dev-setup-open-operations";

const VALID_TABS = new Set<DevTab>([
  "setup", "shortcuts", "reports", "research", "operations", "icons",
  "plans", "page-help", "retros", "ui-catalog", "api-v2-tests", "api-changelog", "scope",
  "security-audits",
]);

function tabFromPath(pathname: string): DevTab {
  const segments = pathname.split("/").filter(Boolean);
  const devIdx = segments.indexOf("dev");
  if (devIdx >= 0) {
    const seg = segments[devIdx + 1] as DevTab | undefined;
    if (seg && VALID_TABS.has(seg)) return seg;
  }
  return "setup";
}

export function DevTabProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [openResearchPapers, setOpenResearchPapers] = useState<Set<string>>(new Set());
  const [openOperations, setOpenOperations] = useState<Set<string>>(new Set());

  useEffect(() => {
    const savedResearch = localStorage.getItem(RESEARCH_STORAGE_KEY);
    if (savedResearch) {
      try {
        const papers = JSON.parse(savedResearch);
        if (Array.isArray(papers)) setOpenResearchPapers(new Set(papers));
      } catch { /* ignore */ }
    }
    const savedOperations = localStorage.getItem(OPERATIONS_STORAGE_KEY);
    if (savedOperations) {
      try {
        const ops = JSON.parse(savedOperations);
        if (Array.isArray(ops)) setOpenOperations(new Set(ops));
      } catch { /* ignore */ }
    }
  }, []);

  // Active tab is derived from the URL; setActiveTab pushes a new route.
  const activeTab = tabFromPath(pathname);

  const setActiveTab = useCallback((tab: DevTab) => {
    router.push(`/dev/${tab}`);
  }, [router]);

  const toggleResearchPaper = useCallback((paperId: string, open: boolean) => {
    setOpenResearchPapers(prev => {
      const updated = new Set(prev);
      if (open) updated.add(paperId); else updated.delete(paperId);
      localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(Array.from(updated)));
      return updated;
    });
  }, []);

  const toggleOperation = useCallback((operationId: string, open: boolean) => {
    setOpenOperations(prev => {
      const updated = new Set(prev);
      if (open) updated.add(operationId); else updated.delete(operationId);
      localStorage.setItem(OPERATIONS_STORAGE_KEY, JSON.stringify(Array.from(updated)));
      return updated;
    });
  }, []);

  return (
    <DevTabContext.Provider value={{ activeTab, setActiveTab, openResearchPapers, toggleResearchPaper, openOperations, toggleOperation }}>
      {children}
    </DevTabContext.Provider>
  );
}

export function useDevTab(): DevTabContextValue {
  const ctx = useContext(DevTabContext);
  if (!ctx) throw new Error("useDevTab must be inside DevTabProvider");
  return ctx;
}
