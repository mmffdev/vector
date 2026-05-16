"use client";

// PLA-0055 / story 00598 — useDefaultPriority.
//
// The "default" for new artefacts is the pri_medium row when present,
// else the first by sort_order. Custom-only workspaces (no slotted
// rows) fall back to whatever the gadmin marked as lowest sort_order.
//
// pickDefaultPriority is the pure form used by tests and any non-React
// caller (e.g. a server-side default-resolver in a future story).

import { usePriorityList } from "@/app/hooks/usePriorityList";
import type { ArtefactPriority } from "@/app/lib/artefactPrioritiesApi";

export function pickDefaultPriority(
  priorities: Pick<ArtefactPriority, "id" | "slot" | "sort_order">[],
): { id: string; slot: string | null } | null {
  if (priorities.length === 0) return null;
  for (const p of priorities) {
    if (p.slot === "pri_medium") return { id: p.id, slot: p.slot };
  }
  // No pri_medium row — pick the lowest sort_order. Stable sort: the
  // existing array order breaks ties, mirroring usePriorityList's
  // sort_order-then-name ordering.
  let best = priorities[0];
  for (const p of priorities) {
    if (p.sort_order < best.sort_order) best = p;
  }
  return { id: best.id, slot: best.slot };
}

export function useDefaultPriority(): { id: string; slot: string | null } | null {
  const priorities = usePriorityList();
  return pickDefaultPriority(priorities);
}
