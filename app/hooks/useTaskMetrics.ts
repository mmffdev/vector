"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { taskMetrics, type TaskMetricsModel } from "@/app/lib/apiSite";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";

/**
 * useTaskMetrics — single source for the task-count burndown. Sibling of
 * useSprintMetrics: fetches the neutral count model on demand, auto-refreshes
 * on ledger pushes (best-effort — same TD-SPRINT-BURN-REALTIME-NOTIFY gap), and
 * a 60s poll + manual refetch() are the reliable freshness path.
 */
export function useTaskMetrics(sprintId: string | null, topic?: string | null) {
  const [model, setModel] = useState<TaskMetricsModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sprintId) { setModel(null); return; }
    setLoading(true); setError(null);
    try { setModel(await taskMetrics.get(sprintId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load task metrics"); }
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
