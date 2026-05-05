"use client";

// PLA-0006/00332 — data hook lifted out of page.tsx.
//
// Owns workspaces fetch (with workspaces:changed subscription),
// tree fetch, and the wsRef state. The setters return so the page
// body can clear selection / re-arm fitView on workspace switch.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { topologyApi, type OrgNode } from "@/app/lib/topologyApi";
import {
  workspacesApi,
  WORKSPACES_CHANGED_EVENT,
  type Workspace,
} from "@/app/lib/workspacesApi";

export function useTopologyData() {
  const search = useSearchParams();
  const [wsRef, setWsRef] = useState<string | null>(() => search.get("ws"));
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [tree, setTree] = useState<OrgNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await topologyApi.tree(undefined, wsRef ?? undefined);
      setTree(res);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load topology");
    }
  }, [wsRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Adopts the first workspace's UUID into ?ws= when none is provided
  // so deep-links survive renames; subscribes to workspaces:changed so
  // dropdown stays in sync with mutations from other panels.
  const reloadWorkspaces = useCallback(async () => {
    try {
      const res = await workspacesApi.list();
      setWorkspaces(res);
      if (wsRef == null && res.length > 0) {
        const first = res[0]!;
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("ws", first.id);
          window.history.replaceState(null, "", url.toString());
        }
        setWsRef(first.id);
      }
    } catch {
      // Silently leave workspaces null — dropdown hides when unavailable.
    }
  }, [wsRef]);

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
    wsRef,
    setWsRef,
    workspaces,
    tree,
    setTree,
    loadError,
    setLoadError,
    reload,
  };
}
