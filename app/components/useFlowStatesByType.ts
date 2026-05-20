"use client";

// useFlowStatesByType — bulk-fetches the default flow's states for a set
// of artefact_type_ids and returns a Map keyed by type id.
//
// Used by the ObjectTree's Status column so each row paints the pill row
// for its OWN type's flow (Risk gets the Risk flow, Task gets the Task
// flow, etc.) instead of the legacy "first work-scoped type" fallback
// served by useWorkItemFlowStates.
//
// Implementation: collect the unique type ids visible in the current
// window, hash them into a stable key, and fire one request that asks
// the backend to return states grouped by type. Cached at module level
// so paging within a stable type set is a no-op.

import { useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";
import type { WorkItemFlowState } from "@/app/components/useWorkItemFlowStates";

export type FlowStatesByType = Map<string, WorkItemFlowState[]>;

interface BulkResponse {
  by_type?: Record<string, WorkItemFlowState[]>;
  flow_states?: WorkItemFlowState[];
}

const cache = new Map<string, WorkItemFlowState[]>();
const inFlight = new Map<string, Promise<void>>();

function makeKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

async function fetchMissing(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => !cache.has(id));
  if (missing.length === 0) return;
  const key = makeKey(missing);
  let p = inFlight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const qs = `artefact_type_id=${missing.map(encodeURIComponent).join(",")}`;
        const resp = await apiSite<BulkResponse>(`/work-items/flow-states?${qs}`);
        const byType = resp.by_type ?? {};
        for (const id of missing) {
          cache.set(id, byType[id] ?? []);
        }
      } catch {
        // On failure, prime empty arrays so we don't loop on retry.
        // The pill row will fall back to row.flow_state_name.
        for (const id of missing) {
          if (!cache.has(id)) cache.set(id, []);
        }
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, p);
  }
  await p;
}

export function useFlowStatesByType(typeIds: readonly string[]): FlowStatesByType {
  const [, force] = useState(0);

  // Stable key — useEffect dep so changing the visible set re-fetches.
  const key = makeKey(typeIds.filter(Boolean));

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").filter(Boolean);
    let cancelled = false;
    fetchMissing(ids).then(() => {
      if (!cancelled) force((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [key]);

  // Project the cache into a Map scoped to the requested ids.
  const out: FlowStatesByType = new Map();
  for (const id of typeIds) {
    if (!id) continue;
    const states = cache.get(id);
    if (states) out.set(id, states);
  }
  return out;
}
