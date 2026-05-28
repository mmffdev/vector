"use client";

/**
 * useNextSprint — picks the "current sprint" for a workspace + optional
 * topology node clamp. Selection rule:
 *
 *   1. First `status=planned` sprint whose start date is in the future
 *      (start_date >= today, ISO compare).
 *   2. Else the currently `status=active` sprint, if any.
 *   3. Else null.
 *
 * Reads via `apiSite.sprints.list(...)` which hits
 * GET /_site/timeboxes/sprints?workspace_id=…[&org_node_id=…]. The wire
 * response is `{ items: SprintWire[], total: number }`; each SprintWire
 * row carries `timeboxes_sprints_*` keys (see backend
 * internal/timeboxsprints/types.go — verified by reading handler.go's
 * List() encoder at L208 + the Go struct's JSON tags).
 *
 * NOTE — the legacy `Timebox` interface exported from app/lib/apiSite
 * (`id`, `label`, `start_date`, …) is stale relative to the live wire.
 * Updating that interface is a wider cutover; this hook intentionally
 * defines its own narrow row shape so the wire is read at face value.
 */

import { useCallback, useEffect, useState } from "react";
import { sprints } from "@/app/lib/apiSite";

// Narrow wire shape — only the fields this hook reads. Keep optional so
// a wire change that drops a column doesn't crash the page; failure mode
// is "no sprint picked" rather than runtime throw.
export interface SprintWireRow {
  timeboxes_sprints_id: string;
  timeboxes_sprints_name?: string;
  timeboxes_sprints_suffix?: string | null;
  timeboxes_sprints_id_workspace?: string;
  timeboxes_sprints_id_topology_node?: string | null;
  timeboxes_sprints_date_start?: string;
  timeboxes_sprints_date_end?: string;
  timeboxes_sprints_status?: string;
  timeboxes_sprints_scope?: number;
  timeboxes_sprints_velocity?: number;
  timeboxes_sprints_estimate?: number;
}

export interface UseNextSprintResult {
  /** Picked "current" sprint per the selection rule above. */
  sprint: SprintWireRow | null;
  /**
   * Next-up-to-N candidate sprints (planned + future-or-today, plus any
   * status=active) sorted ascending by start_date. Sliced to
   * `upcomingLimit` (default 8). Used by the "Target Sprint" radial
   * picker. Derived from the SAME fetch as `sprint` so the page makes
   * one API call instead of two.
   */
  upcoming: SprintWireRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Returns the next-up sprint AND the next N upcoming sprints for
 * (workspaceId, optional orgNodeId) — both derived from a single
 * /timeboxes/sprints fetch. Re-fires on any argument changing.
 * Tolerates 4xx/5xx by surfacing `error`.
 *
 * PERF (2026-05-28) — collapsed what used to be two hooks
 * (useNextSprint + useUpcomingSprints) into one. Real-browser waterfall
 * profiling on /value-sprint showed the same endpoint being hit twice
 * with identical params; the two hooks shared no data even though their
 * input sets were 100% overlapping.
 */
export function useNextSprint(
  workspaceId: string | null,
  orgNodeId?: string | null,
  upcomingLimit = 8,
): UseNextSprintResult {
  const [sprint, setSprint] = useState<SprintWireRow | null>(null);
  const [upcoming, setUpcoming] = useState<SprintWireRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setSprint(null);
      setUpcoming([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (orgNodeId) params.set("org_node_id", orgNodeId);
      const data = await sprints.list(params.toString()) as unknown as {
        items?: SprintWireRow[];
        total?: number;
      };
      const items = data.items ?? [];

      // YYYY-MM-DD ISO compare is lexicographic-safe, so a string >= is
      // a true date >= when both sides are calendar dates with no zone.
      const todayIso = new Date().toISOString().slice(0, 10);

      // Pick "current sprint" — planned + future-or-today start date wins,
      // sorted ascending; fall back to status=active if no planned future
      // candidate; else null.
      const planned = items
        .filter(
          (s) =>
            s.timeboxes_sprints_status === "planned" &&
            typeof s.timeboxes_sprints_date_start === "string" &&
            s.timeboxes_sprints_date_start >= todayIso,
        )
        .sort((a, b) =>
          (a.timeboxes_sprints_date_start ?? "").localeCompare(
            b.timeboxes_sprints_date_start ?? "",
          ),
        );
      if (planned.length) {
        setSprint(planned[0]);
      } else {
        const active = items.find((s) => s.timeboxes_sprints_status === "active");
        setSprint(active ?? null);
      }

      // Upcoming list — planned-future + active, sorted ascending, sliced.
      // Active included so a user mid-sprint can still target it explicitly.
      const upcomingList = items
        .filter((s) => {
          const st = s.timeboxes_sprints_status;
          if (st === "active") return true;
          if (
            st === "planned" &&
            typeof s.timeboxes_sprints_date_start === "string" &&
            s.timeboxes_sprints_date_start >= todayIso
          ) {
            return true;
          }
          return false;
        })
        .sort((a, b) =>
          (a.timeboxes_sprints_date_start ?? "").localeCompare(
            b.timeboxes_sprints_date_start ?? "",
          ),
        )
        .slice(0, upcomingLimit);
      setUpcoming(upcomingList);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load sprints";
      setError(msg);
      setSprint(null);
      setUpcoming([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, orgNodeId, upcomingLimit]);

  useEffect(() => {
    void load();
  }, [load]);

  return { sprint, upcoming, loading, error, refetch: load };
}
