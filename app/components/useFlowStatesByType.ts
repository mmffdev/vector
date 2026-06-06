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

// Module-level subscribers so a cache bust re-renders every live consumer.
const subscribers = new Set<() => void>();
function notifyAll() {
  for (const cb of subscribers) cb();
}

// invalidateFlowStatesByType drops cached states so the next render refetches.
// Pass specific type ids to bust just those (e.g. after a commit 400 that means
// the cached state ids are stale — a flow was edited/reseeded underneath the
// open page); pass nothing to clear everything. Without this the module cache
// never expires, so a flow reseed strands open pages with dead state ids that
// 400 on commit. Origin: 2026-06-06 flow-baseline reseed.
export function invalidateFlowStatesByType(typeIds?: readonly string[]) {
  if (!typeIds || typeIds.length === 0) {
    cache.clear();
  } else {
    for (const id of typeIds) cache.delete(id);
  }
  notifyAll();
}

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

  // Re-render + refetch when the module cache is busted (a flow edit/reseed
  // invalidated the cached state ids). The fetch re-runs because fetchMissing
  // sees the now-missing ids.
  useEffect(() => {
    const cb = () => {
      const ids = makeKey(typeIds.filter(Boolean)).split(",").filter(Boolean);
      if (ids.length) void fetchMissing(ids).then(() => force((n) => n + 1));
      else force((n) => n + 1);
    };
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
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
