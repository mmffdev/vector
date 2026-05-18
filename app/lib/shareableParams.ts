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

import type { WorkItemsFilters } from "@/app/components/work-items-tree-config";
import type { SortKey, SortDir } from "@/app/components/work-items-tree-config";

// ─── Allowed params per route ────────────────────────────────────────────────

// Route paths (no trailing slash) → allowed query param names.
// Only params in this list may appear in the address bar under PLA-0053.
// Adding a new shareable param: add it here AND handle it in the
// parse/build functions below.
export const SHAREABLE_PARAMS: Record<string, ReadonlySet<string>> = {
  "/work-items":       new Set(["type", "status", "priority", "owner", "sort"]),
  "/portfolio-items":  new Set(["type", "status", "priority", "owner", "sort"]),
};

// ─── Serialisation ───────────────────────────────────────────────────────────

/** Parse inbound URL search string into filter + sort values. Returns nulls when params absent. */
export function parseShareableParams(search: string): {
  filters: Partial<WorkItemsFilters> | null;
  sort: { key: SortKey; dir: SortDir } | null;
} {
  const p = new URLSearchParams(search);

  const hasFilter =
    p.has("type") || p.has("status") || p.has("priority") || p.has("owner");

  const filters: Partial<WorkItemsFilters> | null = hasFilter
    ? {
        type:     p.has("type")     ? p.get("type")!.split(",").filter(Boolean)     : undefined,
        status:   p.has("status")   ? p.get("status")!.split(",").filter(Boolean)   : undefined,
        priority: p.has("priority") ? p.get("priority")!.split(",").filter(Boolean) : undefined,
        owner_id: p.has("owner")    ? p.get("owner")!.split(",").filter(Boolean)    : undefined,
      }
    : null;

  let sort: { key: SortKey; dir: SortDir } | null = null;
  if (p.has("sort")) {
    const [rawKey, rawDir] = p.get("sort")!.split(":");
    const VALID_SORT_KEYS: ReadonlySet<string> = new Set([
      "id", "title", "status", "priority", "points", "sprint", "due",
    ]);
    if (rawKey && VALID_SORT_KEYS.has(rawKey)) {
      sort = { key: rawKey as SortKey, dir: rawDir === "desc" ? "desc" : "asc" };
    }
  }

  return { filters, sort };
}

/** Build a URLSearchParams from current filter + sort state. Returns null when all defaults. */
export function buildShareableParams(
  filters: WorkItemsFilters,
  sort: { key: SortKey | null; dir: SortDir },
): URLSearchParams | null {
  const p = new URLSearchParams();

  if (filters.type.length > 0)     p.set("type",     filters.type.join(","));
  if (filters.status.length > 0)   p.set("status",   filters.status.join(","));
  if (filters.priority.length > 0) p.set("priority", filters.priority.join(","));
  if (filters.owner_id.length > 0) p.set("owner",    filters.owner_id.join(","));
  if (sort.key)                     p.set("sort",     `${sort.key}:${sort.dir}`);

  return p.size > 0 ? p : null;
}

/** Build the new pathname+search string, preserving non-shareable params (like ?meg=). */
export function buildShareableHref(
  pathname: string,
  currentSearch: string,
  filters: WorkItemsFilters,
  sort: { key: SortKey | null; dir: SortDir },
): string {
  // Start from a copy of current search so ?meg= and other non-shareable
  // infrastructure params are preserved untouched.
  const existing = new URLSearchParams(currentSearch);

  // Wipe only the shareable param names before re-applying.
  for (const name of ["type", "status", "priority", "owner", "sort"]) {
    existing.delete(name);
  }

  const shareable = buildShareableParams(filters, sort);
  if (shareable) {
    for (const [k, v] of shareable.entries()) {
      existing.set(k, v);
    }
  }

  const qs = existing.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
