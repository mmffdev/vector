"use client";

import { useState, useEffect, useCallback } from "react";
import { apiV2, ApiError } from "@/app/lib/api";
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
      const data = await apiV2<Record<string, unknown>>(`${cfg.apiBase}?${params.toString()}`);
      setRows((data[cfg.listKey] ?? []) as TimeboxRow[]);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to load ${kind}s`);
      setRows([]);
    }
  }, [cfg.apiBase, cfg.listKey, kind, workspaceId, orgNodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading: rows === null, reload: load };
}
