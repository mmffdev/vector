"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { PERSPECTIVES, type Perspective, type NavSection } from "@/app/lib/nav-v2";

interface ShellState {
  perspective: Perspective;
  activeSectionId: string;
  setPerspectiveId: (id: string) => void;
  setActiveSectionId: (id: string) => void;
  activeSection: NavSection | undefined;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [perspectiveId, setPerspectiveId] = useState<string>(PERSPECTIVES[0]!.id);
  const perspective = useMemo(
    () => PERSPECTIVES.find((p) => p.id === perspectiveId) ?? PERSPECTIVES[0]!,
    [perspectiveId],
  );
  const [activeSectionId, setActiveSectionIdState] = useState<string>(
    perspective.sections[0]?.id ?? "",
  );

  const setActiveSectionId = useCallback((id: string) => {
    setActiveSectionIdState(id);
  }, []);

  const switchPerspective = useCallback((id: string) => {
    setPerspectiveId(id);
    const next = PERSPECTIVES.find((p) => p.id === id);
    if (next?.sections[0]) setActiveSectionIdState(next.sections[0].id);
  }, []);

  const activeSection = perspective.sections.find((s) => s.id === activeSectionId);

  return (
    <ShellContext.Provider
      value={{
        perspective,
        activeSectionId,
        setPerspectiveId: switchPerspective,
        setActiveSectionId,
        activeSection,
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
