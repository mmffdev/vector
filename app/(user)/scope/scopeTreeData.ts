"use client";

// scopeTreeData — the /scope data layer for the new Grid primitive.
//
// THIS is the other half of the connector-bug fix. The old sidecar
// (p_workItems_dataGridConfig.tsx) reconstructed parentage CLIENT-SIDE from a
// single page window via nestWindow(): roots = "rows whose parent isn't on
// this page", children = an in-page index. Under a scope clamp the LIST
// returns the whole in-scope subtree FLAT, so split siblings landed in the
// wrong sets and the ├/└ connectors broke.
//
// Here parentage is SERVER-DRIVEN through the audited POST read-gateway:
//   • roots  → workItems.query({ page })        → ListWorkItems, page-windowed
//              under the active workspace/topology clamp (server is the gate).
//   • child  → workItems.query({ parentId })    → ListChildren, the TRUE direct
//              children by artefacts_id_parent, same clamp. children_count is
//              therefore AUTHORITATIVE — the caret never over-promises, and
//              there is no in-page recompute. No nestWindow anywhere.
//
// No identifiers in any URL: the parent UUID rides in the POST body.

import { workItems } from "@/app/lib/apiSite";
import type {
  WorkItemQueryBody,
  WorkItemQueryResult,
} from "@/app/lib/apiSite";
import type { WorkItemsFilters } from "@/app/components/work-items-tree-config.types";

// ── Row shape (salvaged from the old sidecar's WorkItemRow) ─────────────────
export interface ScopeNode {
  id: string; // "US-17357" — `${type_prefix}-${key_num}` (display + React key)
  uuid: string; // artefact UUID — the flyout + child query key
  type: string; // type_prefix ("US","EP","DE","TA","FE"…)
  artefactTypeId: string; // artefacts_types UUID — drives per-type flow rendering
  summary: string;
  flowStateId: string;
  flowStateName: string;
  flowStateCode: string;
  points: number | null;
  owner: string;
  parent: string | null; // display label, e.g. "EP-11885 — Insurance · Claims"
  parentId: string | null; // human id of the parent, e.g. "EP-11885"
  parentUuid: string | null; // artefact UUID of the parent — DnD/write key
  sprint: string | null;
  due: string | null;
  childrenCount: number; // server children_count — authoritative (drives caret)
  colour: string | null; // per-artefact colour → row accent
  prio: number | null;
}

// ── Wire shape (subset of backend WorkItem, verified against types.go) ──────
// Exported so sibling assemblers (e.g. /value-sprint-review's
// sprintReviewTreeData) reuse the SAME wire→row mapping rather than
// duplicating it — one source of truth for the ScopeNode shape.
export interface WireWorkItem {
  id: string;
  key_num: number;
  type_prefix: string;
  artefact_type_id: string;
  title: string;
  flow_state_id: string;
  flow_state_name: string;
  flow_state_code: string;
  story_points: number | null;
  sprint: { id: string; alias: string } | null;
  parent: { id: string; type_prefix: string; key_num: number; title: string } | null;
  owner: { id: string; display_name: string; avatar_url: string | null } | null;
  due_date: string | null;
  children_count: number;
  colour: string | null;
  prio: number | null;
}

// columnId → backend SortKey whitelist. Columns with no server key
// (owner, parent) map to null → no sort param.
export const SORT_KEY_BY_COLUMN: Record<string, string | null> = {
  id: "id",
  summary: "title",
  status: "status",
  points: "points",
  sprint: "sprint",
  due: "due",
  owner: null,
  parent: null,
};

// Exported (see WireWorkItem note) so sibling data layers reuse the mapping.
export function mapWire(w: WireWorkItem): ScopeNode {
  return {
    id: `${w.type_prefix}-${w.key_num}`,
    uuid: w.id,
    type: w.type_prefix,
    artefactTypeId: w.artefact_type_id,
    summary: w.title,
    flowStateId: w.flow_state_id,
    flowStateName: w.flow_state_name,
    flowStateCode: w.flow_state_code,
    points: w.story_points,
    owner: w.owner?.display_name ?? "—",
    parent: w.parent
      ? `${w.parent.type_prefix}-${w.parent.key_num} — ${w.parent.title}`
      : null,
    parentId: w.parent ? `${w.parent.type_prefix}-${w.parent.key_num}` : null,
    parentUuid: w.parent?.id ?? null,
    sprint: w.sprint?.alias ?? null,
    due: w.due_date,
    // Authoritative: this is the server's true direct-child count (clamped),
    // not an in-page estimate. >0 ⇒ caret; expanding fetches the real set.
    childrenCount: w.children_count ?? 0,
    colour: w.colour ?? null,
    prio: w.prio ?? null,
  };
}

function rowsOf(res: WorkItemQueryResult): ScopeNode[] {
  return (res.items as WireWorkItem[]).map(mapWire);
}

export type ScopeTreeFilters = WorkItemsFilters;

function queryFilters(
  filters?: ScopeTreeFilters,
  opts: { includeType?: boolean } = {},
): WorkItemQueryBody["filters"] | undefined {
  if (!filters) return undefined;
  const includeType = opts.includeType ?? true;
  const out: NonNullable<WorkItemQueryBody["filters"]> = {};
  if (includeType && filters.type.length) out.itemTypeId = filters.type;
  if (filters.status.length) out.flowStateId = filters.status;
  if (filters.priority.length) out.priorityId = filters.priority;
  if (filters.owner_id.length) out.ownerId = filters.owner_id;
  return Object.keys(out).length > 0 ? out : undefined;
}

// Roots — the canopy, PAGED. Server applies the workspace clamp and, when
// ?meg= is present, the active topology clamp forwarded by apiSite. useTree
// owns the offset/window; this is the loader it calls. One audited POST per
// page. Shape matches RootPage<ScopeNode>.
export async function fetchScopeRoots(page: {
  limit: number;
  offset: number;
}, filters?: ScopeTreeFilters, api: {
  query: (body: WorkItemQueryBody) => Promise<WorkItemQueryResult>;
} = workItems): Promise<{ rows: ScopeNode[]; total: number }> {
  const body: WorkItemQueryBody = {
    page: { limit: page.limit, offset: page.offset },
  };
  const f = queryFilters(filters);
  if (f) body.filters = f;
  const res = await api.query(body);
  return { rows: rowsOf(res), total: res.total ?? 0 };
}

// Children — the TRUE direct children of one node, by UUID in the POST body.
// Server-driven + clamped; replaces the old in-page index lookup entirely.
export async function fetchScopeChildren(
  parentUuid: string,
  filters?: ScopeTreeFilters,
  api: {
    query: (body: WorkItemQueryBody) => Promise<WorkItemQueryResult>;
  } = workItems,
): Promise<ScopeNode[]> {
  const body: WorkItemQueryBody = { parentId: parentUuid };
  // Type chips choose the primary rows in the scope view. Once a row is
  // expanded, its direct children are part of that row's shape regardless of
  // their artefact type, so parentId queries must not carry itemTypeId.
  const f = queryFilters(filters, { includeType: false });
  if (f) body.filters = f;
  return rowsOf(await api.query(body));
}
