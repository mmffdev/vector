"use client";

// PLA-0055 / story 00598 — ArtefactPriorityCatalogueProvider.
//
// Parallel to ArtefactTypeCatalogueContext from PLA-0054. Fetches the
// per-workspace priorities catalogue once on mount and on workspace
// switch; exposes the list via context so chips / inline-edit
// selectors / sort comparators all read from one source.
//
// Cache key rotates per workspace via priorityCatalogueCacheKey so
// SWR/React Query (when added) naturally invalidates on switch.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { artefactPrioritiesApi, type ArtefactPriority } from "@/app/lib/artefactPrioritiesApi";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";

interface CatalogueState {
  workspaceId: string | null;
  priorities: ArtefactPriority[];
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<CatalogueState>({
  workspaceId: null,
  priorities: [],
  loading: false,
  error: null,
});

// priorityCatalogueCacheKey rotates per workspace so caches keyed on
// it invalidate naturally on workspace switch. Exported for any
// future SWR/React Query integration + the F9 cache test.
export function priorityCatalogueCacheKey(workspaceId: string | null): string {
  return workspaceId == null
    ? "artefact-priorities::no-workspace"
    : `artefact-priorities::ws::${workspaceId}`;
}

export function ArtefactPriorityCatalogueProvider({ children }: { children: React.ReactNode }) {
  const workspaceId = useActiveWorkspace();
  const [priorities, setPriorities] = useState<ArtefactPriority[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId == null) {
      setPriorities([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    artefactPrioritiesApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        setPriorities(rows);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load priorities");
        setPriorities([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const value = useMemo<CatalogueState>(
    () => ({ workspaceId, priorities, loading, error }),
    [workspaceId, priorities, loading, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useArtefactPriorityCatalogue(): CatalogueState {
  return useContext(Ctx);
}
