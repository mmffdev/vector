"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

type DevTab = "setup" | "shortcuts" | "reports" | "research" | "icons" | "plans" | "page-help";

interface DevTabContextValue {
  activeTab: DevTab;
  setActiveTab: (tab: DevTab) => void;
  openResearchPapers: Set<string>;
  toggleResearchPaper: (paperId: string, open: boolean) => void;
}

const DevTabContext = createContext<DevTabContextValue | null>(null);
const TAB_STORAGE_KEY = "dev-setup-active-tab";
const RESEARCH_STORAGE_KEY = "dev-setup-open-research";

export function DevTabProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTabState] = useState<DevTab>("setup");
  const [openResearchPapers, setOpenResearchPapers] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Restore active tab. Migrate legacy "pane-help" → "page-help" (story 00253).
    let savedTab = localStorage.getItem(TAB_STORAGE_KEY);
    if (savedTab === "pane-help") {
      savedTab = "page-help";
      localStorage.setItem(TAB_STORAGE_KEY, savedTab);
    }
    if (savedTab && ["setup", "shortcuts", "reports", "research", "icons", "plans", "page-help"].includes(savedTab)) {
      setActiveTabState(savedTab as DevTab);
    }
    // Restore open research papers
    const savedResearch = localStorage.getItem(RESEARCH_STORAGE_KEY);
    if (savedResearch) {
      try {
        const papers = JSON.parse(savedResearch);
        if (Array.isArray(papers)) {
          setOpenResearchPapers(new Set(papers));
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, []);

  const setActiveTab = (tab: DevTab) => {
    setActiveTabState(tab);
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  };

  const toggleResearchPaper = (paperId: string, open: boolean) => {
    setOpenResearchPapers(prev => {
      const updated = new Set(prev);
      if (open) {
        updated.add(paperId);
      } else {
        updated.delete(paperId);
      }
      localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(Array.from(updated)));
      return updated;
    });
  };

  return (
    <DevTabContext.Provider value={{ activeTab, setActiveTab, openResearchPapers, toggleResearchPaper }}>
      {children}
    </DevTabContext.Provider>
  );
}

export function useDevTab(): DevTabContextValue {
  const ctx = useContext(DevTabContext);
  if (!ctx) throw new Error("useDevTab must be inside DevTabProvider");
  return ctx;
}
