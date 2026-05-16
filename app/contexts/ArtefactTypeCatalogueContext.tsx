"use client";

// PLA-0054 / story 00588 — ArtefactTypeCatalogueProvider.
//
// Fetches the per-workspace artefact_types list once at mount and
// exposes it via context. Consumers (chip option hooks, sidecar slot
// resolvers, the catalogue-aware filter UIs) read from this single
// source rather than each holding their own copy.
//
// Cache key rotates per workspace_id so a workspace switch invalidates
// the cached list without explicit teardown. While the active
// workspace is unresolved (AuthContext loading, JWT pre-PLA-0053),
// the provider holds an empty catalogue and consumers degrade
// gracefully — a chip that depends on the catalogue renders disabled
// rather than crashing.
//
// Backend route: `/artefact-types` is workspace-clamped by
// WorkspaceClampMiddleware (story 00578), so a single GET returns the
// active workspace's types regardless of subscription size.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { artefactTypesApi, type ArtefactType } from "@/app/lib/artefactTypesApi";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";

interface CatalogueState {
  workspaceId: string | null;
  types: ArtefactType[];
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<CatalogueState>({
  workspaceId: null,
  types: [],
  loading: false,
  error: null,
});

// catalogueCacheKey rotates per workspace so SWR / React Query and
// any other caching layer naturally invalidate on switch. Exported
// for F6's cache-key test and any future consumers that key off it.
export function catalogueCacheKey(workspaceId: string | null): string {
  return workspaceId == null
    ? "artefact-types::no-workspace"
    : `artefact-types::ws::${workspaceId}`;
}

export function ArtefactTypeCatalogueProvider({ children }: { children: React.ReactNode }) {
  const workspaceId = useActiveWorkspace();
  const [types, setTypes] = useState<ArtefactType[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId == null) {
      setTypes([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    artefactTypesApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        setTypes(rows);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load artefact types");
        setTypes([]);
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
    () => ({ workspaceId, types, loading, error }),
    [workspaceId, types, loading, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useArtefactTypeCatalogue(): CatalogueState {
  return useContext(Ctx);
}
