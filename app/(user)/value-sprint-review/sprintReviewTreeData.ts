"use client";

// sprintReviewTreeData — the /value-sprint-review data layer for the Grid
// primitive. Sibling of /scope's scopeTreeData; reuses the SAME wire→row
// mapping (ScopeNode + mapWire, imported) so there is one source of truth for
// the row shape. The ONE difference from scope is the roots clamp:
//
//   roots  → workItems.query({ page, filters: { sprintId, itemTypeId } })
//            — items assigned to the panel sprint AND at the story tier
//            (Story / Defect / Risk + any custom story-tier work type). The
//            server applies the workspace + topology clamp on top; sprint and
//            type ride in the POST body. No identifiers in any URL.
//
//   child  → workItems.query({ parentId })  — the TRUE direct children of a
//            row by artefacts_id_parent, same workspace/topology clamp. The
//            sprint AND type filters are intentionally dropped: a row's
//            children are part of that row regardless of which sprint they sit
//            in or what type they are (a Story's Tasks show even though Tasks
//            are not a root tier). Matches fetchScopeChildren's contract.
//
// children_count from the roots query is therefore authoritative — the caret
// never over-promises.

import { workItems } from "@/app/lib/apiSite";
import type { WorkItemQueryBody } from "@/app/lib/apiSite";
import {
  mapWire,
  type ScopeNode,
  type ScopeTreeFilters,
  type WireWorkItem,
} from "@/app/(user)/scope/scopeTreeData";

// Re-export so the assembler imports row/filter types from one place.
export type { ScopeNode, ScopeTreeFilters };

// The clamp the roots query always carries on this page: the panel sprint plus
// the story-tier type allow-list. Chip filters (status / priority / owner /
// the in-tier Type selection) merge on top.
export interface SprintReviewClamp {
  /** Panel sprint UUID — null while the sprint is still resolving. */
  sprintId: string | null;
  /** Story-tier artefact-type UUIDs (Story / Defect / Risk + custom). */
  typeIds: string[];
}

function rowsOf(items: unknown[]): ScopeNode[] {
  return (items as WireWorkItem[]).map(mapWire);
}

// Build the roots filter block: the page clamp (sprint + tier) intersected
// with the user's chip filters. itemTypeId is the clamp's tier list narrowed
// by the chip's single-type selection when one is active.
function rootFilters(
  clamp: SprintReviewClamp,
  chips: ScopeTreeFilters | undefined,
): NonNullable<WorkItemQueryBody["filters"]> {
  const out: NonNullable<WorkItemQueryBody["filters"]> = {};
  if (clamp.sprintId) out.sprintId = clamp.sprintId;

  // Type: when the chip has a single in-tier selection, honour it; else fall
  // back to the whole tier allow-list. Never widen beyond the tier.
  const chipTypes = (chips?.type ?? []).filter((id) => clamp.typeIds.includes(id));
  const typeIds = chipTypes.length > 0 ? chipTypes : clamp.typeIds;
  if (typeIds.length > 0) out.itemTypeId = typeIds;

  if (chips?.status.length) out.flowStateId = chips.status;
  if (chips?.priority.length) out.priorityId = chips.priority;
  if (chips?.owner_id.length) out.ownerId = chips.owner_id;
  return out;
}

// Roots — the canopy, PAGED, clamped to the sprint + story tier. useTree owns
// the offset/window; this is the loader it calls. Returns null sprint → empty
// (the page gates the tree on a resolved sprint, but guard anyway so a transient
// null never fires an unclamped read).
export async function fetchSprintReviewRoots(
  page: { limit: number; offset: number },
  clamp: SprintReviewClamp,
  chips?: ScopeTreeFilters,
): Promise<{ rows: ScopeNode[]; total: number }> {
  if (!clamp.sprintId) return { rows: [], total: 0 };
  const body: WorkItemQueryBody = {
    page: { limit: page.limit, offset: page.offset },
    filters: rootFilters(clamp, chips),
  };
  const res = await workItems.query(body);
  return { rows: rowsOf(res.items), total: res.total ?? 0 };
}

// Children — the TRUE direct children of one row by UUID in the POST body.
// Sprint + type clamps dropped (see header). Status/priority/owner chips are
// also dropped so an expanded row always shows its full child set, matching
// fetchScopeChildren.
export async function fetchSprintReviewChildren(
  parentUuid: string,
): Promise<ScopeNode[]> {
  const body: WorkItemQueryBody = { parentId: parentUuid };
  const res = await workItems.query(body);
  return rowsOf(res.items);
}
