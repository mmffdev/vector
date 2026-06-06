"use client";
import { useCallback, useEffect, useState } from "react";
import { sprintMetrics, type TeamVelocity } from "@/app/lib/apiSite";

/**
 * useTeamVelocity — cross-sprint team velocity for the active workspace (mean
 * net-accepted points per completed sprint, rolling window). Workspace-clamped
 * server-side, so it takes no args. Standalone + reusable: the burndown KPI
 * strip is the first consumer, but a velocity chart, capacity planner, or report
 * can reuse this same hook. Distinct from useSprintMetrics, which is per-sprint
 * and carries the burndown's intra-sprint "recent rate".
 *
 * `refresh` lets a consumer re-pull after a sprint closes or an item is
 * accepted. No polling here — team velocity changes only when a sprint ends or
 * acceptance is recorded, both of which the host already knows about.
 */
export function useTeamVelocity() {
  const [data, setData] = useState<TeamVelocity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await sprintMetrics.teamVelocity());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team velocity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
