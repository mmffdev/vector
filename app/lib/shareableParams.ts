// hook-allow-url-query: this file IS the canonical URL param layer for shareable views.
// It reads and writes allowed address-bar params per-route. Not a route file — exempt from
// the block-url-query-state.sh hook which only targets app/**/*.tsx route surfaces.

// TD-URL-SHAREABLE-VIEWS — route-level allow-list for shareable view state.
//
// Each route that opts in declares its allowed params here. The hook
// block-url-query-state.sh consults this list (via the per-file annotation)
// when deciding whether to block a useSearchParams or router.replace write.
//
// WIRE surface vs ADDRESS-BAR surface (PLA-0053):
//   The address bar carries the SHAREABLE view state (e.g. ?type=epic&sort=priority:desc).
//   The wire request carries scope clamps (?meg=, ?limit=, ?scope_dir=) which are NOT
//   the same thing and NOT shown here.
//   Per-user remembered state lives in users.preferences and is the PRIMARY store.
//   URL is the SECONDARY store — present only when a user has a non-default view active.
//
// Pattern on first mount:
//   1. Parse inbound URL params.
//   2. If any are present, override the seeded preference value with the URL value.
//      This lets a shared link land on the sender's view, then persist from there.
//   3. On every filter/sort change, write both to preferences AND to the URL so
//      the address bar stays copy-paste-shareable.

import type { WorkItemsFilters, SortKey, SortDir } from "@/app/components/work-items-tree-config.types";

// ─── Allowed params per route ────────────────────────────────────────────────

// Route paths (no trailing slash) → allowed query param names.
// Only params in this list may appear in the address bar under PLA-0053.
// Adding a new shareable param: add it here AND handle it in the
// parse/build functions below.
export const SHAREABLE_PARAMS: Record<string, ReadonlySet<string>> = {
  "/work-items":       new Set(["type", "status", "priority", "owner", "sort", "meg"]),
  "/portfolio-items":  new Set(["type", "status", "priority", "owner", "sort", "meg"]),
  // /value-sprint hosts TWO ObjectTree instances (sprint-panel + backlog)
  // on one route. Each uses a urlPrefix so their filter URL params don't
  // collide — writing the Type chip on the panel must not change the
  // backlog's Type clamp. Convention: `<prefix>.<param>` for both filters
  // and sort (see parseShareableParams + buildShareableHref overloads).
  "/value-sprint": new Set([
    "panel.type", "panel.status", "panel.priority", "panel.owner", "panel.sort",
    "backlog.type", "backlog.status", "backlog.priority", "backlog.owner", "backlog.sort",
    "meg",
  ]),
};

/**
 * `meg` is the cross-route shareable scope-identity param. The name
 * predates Sentinel (PLA-0053 / TD-URL-SCOPE-PARAM-CUTOVER, named
 * after Rick's daughter Megan) and is preserved across the PLA062
 * Sentinel cut for continuity with old bookmarks + the existing
 * `withForwardedMeg` SQL clamp forwarder in app/lib/api.ts.
 *
 * Encodes the topology node the user is currently focused on, so a
 * bookmarked URL lands the recipient on the same scope clamp the
 * sender was viewing. Listed in the per-route SHAREABLE_PARAMS sets
 * above (route-specific filter+sort still bound to that route), and
 * also recognised globally by `parseMegFromURL` below so the
 * Sentinel provider can read it at boot regardless of route.
 *
 * Procurement narrative: defence/finance buyers ask for
 * "show-me-Alice's-view" links — `meg` is the answer. It only
 * narrows visibility; it never elevates access. The backend Sentinel
 * middleware re-validates the focus against the tenant + grant set on
 * every request, so a forged URL focus surfaces as 403, not a leak.
 */
const MEG_PARAM = "meg";

/** Read the `?meg=<uuid>` param if present and valid; null otherwise. */
export function parseMegFromURL(search: string): string | null {
  const p = new URLSearchParams(search);
  const raw = p.get(MEG_PARAM);
  if (!raw) return null;
  // Loose UUID shape check — backend re-validates against the tenant.
  const isUuid = /^[0-9a-f-]{36}$/i.test(raw);
  return isUuid ? raw : null;
}


// ─── Serialisation ───────────────────────────────────────────────────────────

/**
 * Parse inbound URL search string into filter + sort values. Returns
 * nulls when params absent.
 *
 * `urlPrefix` (optional) — when set, every param name is prefixed
 * (`<prefix>.type`, `<prefix>.status`, etc.). Used by multi-grid pages
 * like /value-sprint where two ObjectTrees share one URL and their
 * filter params must not collide.
 */
export function parseShareableParams(search: string, urlPrefix?: string): {
  filters: Partial<WorkItemsFilters> | null;
  sort: { key: SortKey; dir: SortDir } | null;
} {
  const p = new URLSearchParams(search);
  const pfx = urlPrefix ? `${urlPrefix}.` : "";
  const k = {
    type: `${pfx}type`,
    status: `${pfx}status`,
    priority: `${pfx}priority`,
    owner: `${pfx}owner`,
    sort: `${pfx}sort`,
  };

  const hasFilter =
    p.has(k.type) || p.has(k.status) || p.has(k.priority) || p.has(k.owner);

  const filters: Partial<WorkItemsFilters> | null = hasFilter
    ? {
        type:     p.has(k.type)     ? p.get(k.type)!.split(",").filter(Boolean)     : undefined,
        status:   p.has(k.status)   ? p.get(k.status)!.split(",").filter(Boolean)   : undefined,
        priority: p.has(k.priority) ? p.get(k.priority)!.split(",").filter(Boolean) : undefined,
        owner_id: p.has(k.owner)    ? p.get(k.owner)!.split(",").filter(Boolean)    : undefined,
      }
    : null;

  let sort: { key: SortKey; dir: SortDir } | null = null;
  if (p.has(k.sort)) {
    const [rawKey, rawDir] = p.get(k.sort)!.split(":");
    const VALID_SORT_KEYS: ReadonlySet<string> = new Set([
      "id", "title", "status", "priority", "points", "sprint", "due",
    ]);
    if (rawKey && VALID_SORT_KEYS.has(rawKey)) {
      sort = { key: rawKey as SortKey, dir: rawDir === "desc" ? "desc" : "asc" };
    }
  }

  return { filters, sort };
}

/**
 * Build a URLSearchParams from current filter + sort state. Returns
 * null when all defaults. `urlPrefix` (optional) prefixes every param
 * name (see parseShareableParams).
 */
export function buildShareableParams(
  filters: WorkItemsFilters,
  sort: { key: SortKey | null; dir: SortDir },
  urlPrefix?: string,
): URLSearchParams | null {
  const p = new URLSearchParams();
  const pfx = urlPrefix ? `${urlPrefix}.` : "";

  if (filters.type.length > 0)     p.set(`${pfx}type`,     filters.type.join(","));
  if (filters.status.length > 0)   p.set(`${pfx}status`,   filters.status.join(","));
  if (filters.priority.length > 0) p.set(`${pfx}priority`, filters.priority.join(","));
  if (filters.owner_id.length > 0) p.set(`${pfx}owner`,    filters.owner_id.join(","));
  if (sort.key)                     p.set(`${pfx}sort`,     `${sort.key}:${sort.dir}`);

  return p.size > 0 ? p : null;
}

/**
 * Build the new pathname+search string, preserving non-shareable params
 * (like ?meg=). `urlPrefix` (optional) — wipes only the prefixed slot
 * before re-applying, so a sibling tree's prefixed params survive.
 */
export function buildShareableHref(
  pathname: string,
  currentSearch: string,
  filters: WorkItemsFilters,
  sort: { key: SortKey | null; dir: SortDir },
  urlPrefix?: string,
): string {
  // Start from a copy of current search so ?meg= and other non-shareable
  // infrastructure params are preserved untouched.
  const existing = new URLSearchParams(currentSearch);
  const pfx = urlPrefix ? `${urlPrefix}.` : "";

  // Wipe only the shareable param names in OUR slot before re-applying.
  // A sibling tree's params (other urlPrefix) are untouched.
  for (const name of ["type", "status", "priority", "owner", "sort"]) {
    existing.delete(`${pfx}${name}`);
  }

  const shareable = buildShareableParams(filters, sort, urlPrefix);
  if (shareable) {
    for (const [k, v] of shareable.entries()) {
      existing.set(k, v);
    }
  }

  const qs = existing.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
