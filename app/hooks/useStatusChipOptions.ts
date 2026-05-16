"use client";

// PLA-0054 / story 00591 — Status chip option resolver.
//
// Behaviour:
//   - No Type selected (or multiple Types): return the 6 project-locked
//     kind primitives (todo / in_progress / in_review / done / accepted /
//     cancelled). Stable enum the backend understands across every type
//     when the chip can't bind to a single flow.
//   - Exactly one Type selected: fetch that type's flow_states via the
//     existing flowsApi (cached) and return them as { value: state.id,
//     label: state.name }. Chip values are UUIDs the backend filters by
//     directly through ?flow_state_id=<uuid>[,<uuid>].
//
// Loading: while the per-flow fetch is in flight, returns the kind
// primitives so the chip stays useful instead of empty.

import { useEffect, useMemo, useState } from "react";

import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { flowStatesApi, type FlowGroup, type FlowsResponse } from "@/app/lib/flowStatesApi";

export interface StatusChipOption {
  value: string;
  label: string;
}

const KIND_PRIMITIVES: StatusChipOption[] = [
  { value: "todo",         label: "To do" },
  { value: "in_progress",  label: "In progress" },
  { value: "in_review",    label: "In review" },
  { value: "done",         label: "Done" },
  { value: "accepted",     label: "Accepted" },
  { value: "cancelled",    label: "Cancelled" },
];

function findGroupByTypeID(flows: FlowsResponse | null, typeID: string): FlowGroup | null {
  if (!flows) return null;
  for (const g of flows.work) {
    if (g.type_id === typeID) return g;
  }
  for (const g of flows.strategy) {
    if (g.type_id === typeID) return g;
  }
  return null;
}

export function useStatusChipOptions(singleTypeId: string | null): StatusChipOption[] {
  const { types } = useArtefactTypeCatalogue();
  const [flows, setFlows] = useState<FlowsResponse | null>(null);

  useEffect(() => {
    if (singleTypeId == null) {
      setFlows(null);
      return;
    }
    let cancelled = false;
    flowStatesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        setFlows(res);
      })
      .catch(() => {
        if (cancelled) return;
        setFlows(null);
      });
    return () => {
      cancelled = true;
    };
  }, [singleTypeId]);

  return useMemo(() => {
    if (singleTypeId == null) return KIND_PRIMITIVES;
    // Sanity: the chosen type must still exist in the workspace catalogue.
    const known = types.find((row) => row.id === singleTypeId);
    if (!known) return KIND_PRIMITIVES;
    const group = findGroupByTypeID(flows, singleTypeId);
    if (!group || group.states.length === 0) return KIND_PRIMITIVES;
    return group.states
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ value: s.id, label: s.name }));
  }, [singleTypeId, types, flows]);
}

// reduceStatusChange is the pure reducer for the "Type changed →
// invalidate Status if it's no longer reachable" rule. Returns the
// new Status value (possibly null) plus a `cleared` flag so callers
// can fire a toast.
export function reduceStatusChange(
  currentStatus: string | null,
  newTypeStates: string[],
): { status: string | null; cleared: boolean } {
  if (currentStatus == null) return { status: null, cleared: false };
  if (newTypeStates.includes(currentStatus)) {
    return { status: currentStatus, cleared: false };
  }
  return { status: null, cleared: true };
}
