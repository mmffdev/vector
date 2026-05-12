"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { PERSPECTIVES, type Perspective, type NavSection, flattenSectionPages } from "@/app/lib/nav-v2";

/** Sentinel ID for the account flyout slot — not a real PERSPECTIVES section. */
export const ACCOUNT_SECTION_ID = "__account";

interface ShellState {
  perspective: Perspective;
  activeSectionId: string;
  setPerspectiveId: (id: string) => void;
  setActiveSectionId: (id: string) => void;
  activeSection: NavSection | undefined;
  /** True when the account flyout should render instead of the section flyout. */
  isAccountActive: boolean;
}

const ShellContext = createContext<ShellState | null>(null);

const PERSPECTIVE_LS_KEY = "vector:redesign:perspective";

/**
 * Find the section in a perspective whose page set contains the given pathname
 * (longest prefix match). Returns undefined when nothing matches.
 */
function sectionForPath(perspective: Perspective, pathname: string): NavSection | undefined {
  let best: { section: NavSection; len: number } | undefined;
  for (const s of perspective.sections) {
    for (const p of flattenSectionPages(s)) {
      if (pathname === p.href || pathname.startsWith(p.href + "/")) {
        if (!best || p.href.length > best.len) best = { section: s, len: p.href.length };
      }
    }
  }
  return best?.section;
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  const [perspectiveId, setPerspectiveId] = useState<string>(() => {
    if (typeof window === "undefined") return PERSPECTIVES[0]!.id;
    const stored = window.localStorage.getItem(PERSPECTIVE_LS_KEY);
    if (stored && PERSPECTIVES.some((p) => p.id === stored)) return stored;
    return PERSPECTIVES[0]!.id;
  });

  const perspective = useMemo(
    () => PERSPECTIVES.find((p) => p.id === perspectiveId) ?? PERSPECTIVES[0]!,
    [perspectiveId],
  );

  const urlSection = sectionForPath(perspective, pathname);
  const [manualSectionId, setManualSectionId] = useState<string>(
    urlSection?.id ?? perspective.sections[0]?.id ?? "",
  );

  useEffect(() => {
    if (urlSection) setManualSectionId(urlSection.id);
  }, [urlSection]);

  const activeSectionId = urlSection?.id ?? manualSectionId;
  const isAccountActive = manualSectionId === ACCOUNT_SECTION_ID && !urlSection;
  const activeSection = isAccountActive
    ? undefined
    : perspective.sections.find((s) => s.id === activeSectionId) ?? perspective.sections[0];

  const switchPerspective = useCallback((id: string) => {
    setPerspectiveId(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PERSPECTIVE_LS_KEY, id);
    }
    const next = PERSPECTIVES.find((p) => p.id === id);
    if (next?.sections[0]) setManualSectionId(next.sections[0].id);
  }, []);

  const setActiveSectionId = useCallback((id: string) => {
    setManualSectionId(id);
  }, []);

  return (
    <ShellContext.Provider
      value={{
        perspective,
        activeSectionId: isAccountActive ? ACCOUNT_SECTION_ID : activeSection?.id ?? "",
        setPerspectiveId: switchPerspective,
        setActiveSectionId,
        activeSection,
        isAccountActive,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within <ShellProvider>");
  return ctx;
}
