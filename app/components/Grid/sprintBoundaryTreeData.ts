// app/components/Grid/sprintBoundaryTreeData.ts
"use client";

// sprintBoundaryTreeData — data layer for the Grid__SprintBoundary POC.
//
// Why a NEW file instead of reusing scopeTreeData.fetchScopeRoots: the shared
// queryFilters() there maps only type/status/priority/owner (its
// ScopeTreeFilters = WorkItemsFilters), and that file is imported by /scope,
// /work-items and /value-sprint-review — editing it to add a sprintId clamp is
// forbidden. This thin layer reuses the EXPORTED mapWire + ScopeNode shape and
// only adds the filters.sprintId clamp the POC needs, through the same audited
// POST gateway (workItems.query).

import { workItems } from "@/app/lib/apiSite";
import type { WorkItemQueryBody } from "@/app/lib/apiSite";
import { mapWire, type ScopeNode, type WireWorkItem } from "@/app/(user)/scope/scopeTreeData";

// sprintId: a sprint UUID, or "__none__" for the backlog (no sprint assigned).
// itemTypeIds: optional artefact-type UUID clamp (e.g. story/defect/risk only).
export async function fetchSprintRoots(
  page: { limit: number; offset: number },
  sprintId: string,
  itemTypeIds?: string[],
): Promise<{ rows: ScopeNode[]; total: number }> {
  const filters: NonNullable<WorkItemQueryBody["filters"]> = { sprintId };
  if (itemTypeIds && itemTypeIds.length) filters.itemTypeId = itemTypeIds;
  const body: WorkItemQueryBody = {
    page: { limit: page.limit, offset: page.offset },
    filters,
  };
  const res = await workItems.query(body);
  const rows = (res.items as WireWorkItem[]).map(mapWire);
  return { rows, total: res.total ?? 0 };
}
