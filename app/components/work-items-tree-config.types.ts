// Neutral type module extracted from work-items-tree-config.tsx to break
// the type-only back edge with app/lib/shareableParams.ts. Runtime values
// (EMPTY_FILTERS, sortRoots, useWorkItemsFilters, etc.) stay in the .tsx.

export type SortKey =
  | "id" | "title" | "status" | "priority" | "points" | "sprint" | "due";
export type SortDir = "asc" | "desc";

// Multi-value chips (NavigationPie): URL stores comma-joined lists per param.
// `?type=epic,story` → ["epic","story"]. Backend currently only honours the
// first value (see TD-FILTER-MULTI).
export interface WorkItemsFilters {
  type: string[];
  status: string[];
  priority: string[];
  owner_id: string[];
}
