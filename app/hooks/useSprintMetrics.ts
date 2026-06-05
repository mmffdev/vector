"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { sprintMetrics, type SprintMetricsModel } from "@/app/lib/apiSite";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";

/**
 * useSprintMetrics — single source for every sprint chart. Fetches the
 * neutral model on demand, auto-refreshes on ledger pushes (best-effort
 * — see TD-SPRINT-BURN-REALTIME-NOTIFY: the rank trigger doesn't yet
 * fire on flow-state/sprint-membership changes, so the 60s poll + manual
 * refetch() are the reliable freshness path for now), and exposes
 * refetch() for a manual refresh button.
 */
export function useSprintMetrics(sprintId: string | null, topic?: string | null) {
  const [model, setModel] = useState<SprintMetricsModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sprintId) { setModel(null); return; }
    setLoading(true); setError(null);
    try { setModel(await sprintMetrics.get(sprintId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load metrics"); }
    finally { setLoading(false); }
  }, [sprintId]);

  useEffect(() => { void load(); }, [load]);

  useRefetchOnPush({ topic: topic ?? null, refetch: load });

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!sprintId) return;
    const t = setInterval(() => void loadRef.current(), 60_000);
    return () => clearInterval(t);
  }, [sprintId]);

  return { model, loading, error, refetch: load };
}
