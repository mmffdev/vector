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
  sprint: SprintWireRow | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Returns the next-up sprint for (workspaceId, optional orgNodeId).
 * Re-fires on either argument changing. Tolerates 4xx/5xx by surfacing
 * `error` — callers render a fallback state in that case.
 */
export function useNextSprint(
  workspaceId: string | null,
  orgNodeId?: string | null,
): UseNextSprintResult {
  const [sprint, setSprint] = useState<SprintWireRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setSprint(null);
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

      // Pass 1 — planned + future-or-today start date, sorted ascending.
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
        return;
      }

      // Pass 2 — fall back to the active sprint, if any.
      const active = items.find((s) => s.timeboxes_sprints_status === "active");
      setSprint(active ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load sprints";
      setError(msg);
      setSprint(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, orgNodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { sprint, loading, error, refetch: load };
}

/**
 * useUpcomingSprints — returns the next-up-to-N planned sprints with
 * start_date >= today, sorted ascending by start_date. Used by the
 * "Target Sprint" radial pill menu on the value-sprint backlog: the
 * user picks one of the next 8 sprints to assign a work item to.
 *
 * Same workspace + topology clamp + tolerance as useNextSprint; differs
 * only in returning the list (sliced to `limit`) instead of picking one.
 */
export interface UseUpcomingSprintsResult {
  sprints: SprintWireRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useUpcomingSprints(
  workspaceId: string | null,
  orgNodeId?: string | null,
  limit = 8,
): UseUpcomingSprintsResult {
  const [list, setList] = useState<SprintWireRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setList([]);
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
      const todayIso = new Date().toISOString().slice(0, 10);

      // Planned + future-or-today + active. Active included so a user
      // mid-sprint can still target it explicitly from the menu.
      const candidates = items
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
        .slice(0, limit);

      setList(candidates);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load sprints";
      setError(msg);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, orgNodeId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return { sprints: list, loading, error, refetch: load };
}
