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
//   • roots  → workItems.query({ page })        → ListWorkItems, roots-only
//              (parent IS NULL is applied because no ScopeNodeID is passed),
//              workspace-clamped by Sentinel from the JWT (server is the gate).
//   • child  → workItems.query({ parentId })    → ListChildren, the TRUE direct
//              children by artefacts_id_parent, same clamp. children_count is
//              therefore AUTHORITATIVE — the caret never over-promises, and
//              there is no in-page recompute. No nestWindow anywhere.
//
// No identifiers in any URL: the parent UUID rides in the POST body.

import { workItems } from "@/app/lib/apiSite";
import type { WorkItemQueryResult } from "@/app/lib/apiSite";

// ── Row shape (salvaged from the old sidecar's WorkItemRow) ─────────────────
export interface ScopeNode {
  id: string; // "US-17357" — `${type_prefix}-${key_num}` (display + React key)
  uuid: string; // artefact UUID — the flyout + child query key
  type: string; // type_prefix ("US","EP","DE","TA","FE"…)
  summary: string;
  status: string; // single-glyph stage ("T"/"I"/"D"/"C") or raw code
  points: number | null;
  owner: string;
  parent: string | null; // display label, e.g. "EP-11885 — Insurance · Claims"
  parentId: string | null; // human id of the parent, e.g. "EP-11885"
  sprint: string | null;
  due: string | null;
  childrenCount: number; // server children_count — authoritative (drives caret)
  colour: string | null; // per-artefact colour → row accent
}

// ── Wire shape (subset of backend WorkItem, verified against types.go) ──────
interface WireWorkItem {
  id: string;
  key_num: number;
  type_prefix: string;
  title: string;
  flow_state_code: string;
  story_points: number | null;
  sprint: { id: string; alias: string } | null;
  parent: { id: string; type_prefix: string; key_num: number; title: string } | null;
  owner: { id: string; display_name: string; avatar_url: string | null } | null;
  due_date: string | null;
  children_count: number;
  colour: string | null;
}

// flow_state_code slug → single-glyph stage. Best-effort (flow states are
// per-node configurable, PLA068); unknown slugs fall through to the raw code.
// Salvaged verbatim from the old sidecar.
const STATUS_GLYPH_BY_CODE: Record<string, string> = {
  todo: "T",
  in_progress: "I",
  doing: "I",
  in_review: "D",
  review: "D",
  completed: "C",
  done: "C",
};

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

function mapWire(w: WireWorkItem): ScopeNode {
  return {
    id: `${w.type_prefix}-${w.key_num}`,
    uuid: w.id,
    type: w.type_prefix,
    summary: w.title,
    status: STATUS_GLYPH_BY_CODE[w.flow_state_code] ?? w.flow_state_code,
    points: w.story_points,
    owner: w.owner?.display_name ?? "—",
    parent: w.parent
      ? `${w.parent.type_prefix}-${w.parent.key_num} — ${w.parent.title}`
      : null,
    parentId: w.parent ? `${w.parent.type_prefix}-${w.parent.key_num}` : null,
    sprint: w.sprint?.alias ?? null,
    due: w.due_date,
    // Authoritative: this is the server's true direct-child count (clamped),
    // not an in-page estimate. >0 ⇒ caret; expanding fetches the real set.
    childrenCount: w.children_count ?? 0,
    colour: w.colour ?? null,
  };
}

function rowsOf(res: WorkItemQueryResult): ScopeNode[] {
  return (res.items as WireWorkItem[]).map(mapWire);
}

export interface FetchRootsOptions {
  sort?: { columnId: string; dir: "asc" | "desc" } | null;
}

// Roots — the canopy. Server returns roots-only under the workspace clamp
// (no ScopeNodeID passed ⇒ parent IS NULL applied). One audited POST.
export async function fetchScopeRoots(
  opts: FetchRootsOptions = {},
): Promise<ScopeNode[]> {
  const body: Parameters<typeof workItems.query>[0] = {
    page: { limit: 200, offset: 0 },
  };
  if (opts.sort) {
    const key = SORT_KEY_BY_COLUMN[opts.sort.columnId];
    if (key) body.sort = { key, dir: opts.sort.dir };
  }
  return rowsOf(await workItems.query(body));
}

// Children — the TRUE direct children of one node, by UUID in the POST body.
// Server-driven + clamped; replaces the old in-page index lookup entirely.
export async function fetchScopeChildren(parentUuid: string): Promise<ScopeNode[]> {
  return rowsOf(await workItems.query({ parentId: parentUuid }));
}
