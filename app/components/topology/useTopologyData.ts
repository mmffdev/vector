"use client";

// PLA-0006/00332 — data hook lifted out of page.tsx.
//
// Owns workspaces fetch (with workspaces:changed subscription) and
// tree fetch. The active workspace is sourced from useActiveWorkspace
// (the JWT-anchored truth), NOT a URL param — PLA-0053 / story 00576.5
// moved workspace switching to AuthContext.switchWorkspace which
// re-mints the JWT. The tree re-fetches whenever the active workspace
// changes because workspaceId is in the reload deps.

import { useCallback, useEffect, useState } from "react";
import { topologyApi, type OrgNode } from "@/app/lib/topologyApi";
import {
  workspacesApi,
  WORKSPACES_CHANGED_EVENT,
  type Workspace,
} from "@/app/lib/workspacesApi";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";

export function useTopologyData() {
  const workspaceId = useActiveWorkspace();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [tree, setTree] = useState<OrgNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await topologyApi.tree();
      setTree(res);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load topology");
    }
  }, []);

  // Tree narrows server-side via the JWT claim; refetch on workspace switch.
  useEffect(() => {
    void reload();
  }, [reload, workspaceId]);

  // Workspaces dropdown — fetch list, subscribe to mutations from
  // other panels. Active workspace tracking moved to useActiveWorkspace
  // / AuthContext; this list is purely the dropdown's option set.
  const reloadWorkspaces = useCallback(async () => {
    try {
      const res = await workspacesApi.list();
      setWorkspaces(res);
    } catch {
      // Silently leave workspaces null — dropdown hides when unavailable.
    }
  }, []);

  useEffect(() => {
    void reloadWorkspaces();
    if (typeof window === "undefined") return;
    const onChanged = () => {
      void reloadWorkspaces();
    };
    window.addEventListener(WORKSPACES_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(WORKSPACES_CHANGED_EVENT, onChanged);
    };
    // First-mount fetch + stable subscription only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // wsRef is now the active workspace from the JWT-anchored hook.
    // Kept as `wsRef` rather than renamed because the topology page
    // already destructures it under that name; rename is a follow-up.
    wsRef: workspaceId,
    workspaces,
    tree,
    setTree,
    loadError,
    setLoadError,
    reload,
  };
}
