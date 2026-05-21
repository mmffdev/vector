"use client";

// Legacy hook for the soon-to-be-deleted <TimeboxManager>. Slice 6.5 of
// the ObjectTree refactor removes this entirely once sprints + releases
// pages have swapped to <TimeboxObjectTree>. Until then, this hook +
// TimeboxManager stay alive but read the new {items,total} response
// shape that slice 6.3a put in place — so both pages keep working
// during the transitional period.

import { useState, useEffect, useCallback } from "react";
import { apiSite, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { TIMEBOX_KINDS, TimeboxKind } from "@/app/components/timebox/kinds";
import type { TimeboxRow } from "@/app/components/TimeboxManager";

interface UseTimeboxOptions {
  kind: TimeboxKind;
  workspaceId: string;
  orgNodeId?: string;
}

interface UseTimeboxResult {
  rows: TimeboxRow[] | null;
  loading: boolean;
  reload: () => void;
}

export function useTimebox({ kind, workspaceId, orgNodeId }: UseTimeboxOptions): UseTimeboxResult {
  const cfg = TIMEBOX_KINDS[kind];
  const [rows, setRows] = useState<TimeboxRow[] | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (orgNodeId) params.set("org_node_id", orgNodeId);
    try {
      const data = await apiSite<{ items?: TimeboxRow[] }>(
        `${cfg.apiBase}?${params.toString()}`,
      );
      setRows(data.items ?? []);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to load ${kind}s`);
      setRows([]);
    }
  }, [cfg.apiBase, kind, workspaceId, orgNodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading: rows === null, reload: load };
}
