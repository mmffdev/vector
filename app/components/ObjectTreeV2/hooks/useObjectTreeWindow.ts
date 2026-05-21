"use client";

// useObjectTreeWindow<T> — generic windowed-fetch + optimistic-patch hook
// for ObjectTreeV2. Slice 1 of the ObjectTree refactor plan
// (docs/c_c_objecttree_refactor_plan.md).
//
// Replaces the artefact-coupled useArtefactItemsWindow in
// work-items-tree-config.tsx with a domain-agnostic core. Three shape
// changes from the original:
//
//   1. Filters arrive as an already-encoded query-string slice (e.g.
//      "&item_type_id=…&owner_id=…"). The caller's config builds it from
//      its own filter state — the hook stays dumb about filter semantics.
//      Work-items keeps its rich multi-value array shape; sprints can
//      ship a simple "&status=active" string; risks layers severity on
//      top — all through the same prop.
//
//   2. Cascade refresh fires when the PATCH body contains ANY key from a
//      caller-supplied `cascadeOnFields: string[]`. Work-items passes
//      ['flow_state_id', 'story_points', 'parent_artefact_id']; sprints
//      passes []; agents can introspect this list from the config.
//
//   3. Source of truth is a flat Map<rowId, T> (`rowsById`). The legacy
//      `windowRoots: T[]` array is derived for ordering. Patches mutate
//      one map entry; downstream selectors can subscribe to a single id
//      without re-rendering siblings. Sets up slice 4.6's memoisation
//      story.
//
// Out of scope for slice 1 (named here so the gap is intentional):
//   - request coalescing/debouncing (slice 4.6)
//   - cache-merge logic for the column-picker back-fill (slice 4.5)
//   - the by-ids endpoint for narrow cascade refresh (slice 4.6)
//   - 409 'parent_flow_state_derived' suppression is kept here as a
//     work-items-specific behaviour, but threaded through an
//     onPatchError callback so other domains can opt out.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiSite, ApiError } from "@/app/lib/api";
import { useScope } from "@/app/contexts/ScopeContext";

// Slice 4.6a — request coalescing window. Rapid prop changes (sort
// flip + filter chip toggle + scope change in close succession) all
// fire refetchWindow effects. Without coalescing each one issues its
// own outgoing request and we race their responses. With this debounce,
// every dep-list change within the window collapses to ONE outgoing
// request after the user settles. Tuned for typical human pacing — 150ms
// is below the perception threshold for "instant", well above keystroke
// debounce overlap.
const REFETCH_DEBOUNCE_MS = 150;

// ── Public types ─────────────────────────────────────────────────────────────

export interface UseObjectTreeWindowOptions<T> {
  /** apiSite path prefix (e.g. "/work-items", "/timeboxes/sprints"). */
  resourceUrl: string;
  /** Numeric page size, or "all" to fetch every root in chunks. */
  pageSize: number | "all";
  /** Zero-based page index; ignored when pageSize === "all". */
  pageIndex: number;
  /**
   * Sort key passed verbatim as `&sort=<key>&dir=<dir>`. Null = canonical
   * server-default order. The backend whitelist gates which keys resolve;
   * unknown keys fall back to canonical order.
   */
  sortKey: string | null;
  sortDir: "asc" | "desc";
  /**
   * Pre-encoded querystring slice for caller-owned filters. Must start
   * with "&" if non-empty (e.g. "&item_type_id=abc,def&owner_id=xyz").
   * Empty string when no filters. The hook concatenates this verbatim
   * onto every request.
   */
  filterQuery: string;
  /**
   * Field-name allow-list for cascade-triggering PATCH bodies. When a
   * PATCH body contains ANY of these keys, the hook re-runs
   * refetchWindow() AND fires onCascadeRefresh() so consumers can refresh
   * expanded sub-trees too. Empty array = no cascade behaviour.
   */
  cascadeOnFields: string[];
  /** Optional id accessor. Defaults to `(row: any) => row.id`. */
  getId?: (row: T) => string;
  /** Fired after every successful PATCH with the patch body. */
  onPatched?: (body: Record<string, unknown>) => void;
  /**
   * Fired right after the optimistic local update in patchAndApply.
   * Hosts use this to forward the same patch into child-row caches
   * outside the hook's view (e.g. ResourceTree's expanded-children map).
   */
  onLocalPatch?: (id: string, body: Record<string, unknown>) => void;
  /**
   * Fired AFTER a successful PATCH whose body matched cascadeOnFields.
   * Hosts use this to re-pull every expanded sub-tree so cascade-touched
   * ancestor rows (e.g. Story → Epic in work-items) repaint without the
   * user collapsing + re-expanding.
   */
  onCascadeRefresh?: () => void;
  /**
   * Optional PATCH-error interceptor. Return true to indicate the hook
   * handled the error (will refetch to revert optimistic state). Return
   * false / undefined to bubble — the hook stays silent otherwise so
   * unrelated patch failures don't gain new behaviour. Used by work-items
   * to handle 409 parent_flow_state_derived; other domains pass nothing.
   */
  onPatchError?: (err: unknown, id: string, body: Record<string, unknown>) => boolean;
}

export interface UseObjectTreeWindowResult<T> {
  /**
   * Flat source of truth. Patches mutate one entry; selectors can read
   * by id without re-rendering siblings.
   */
  rowsById: Map<string, T>;
  /**
   * Rendered window in fetch order. Derived from rowsById on every
   * fetch — preserves the server's ORDER BY result. Reference identity
   * changes whenever the map does.
   */
  windowRoots: T[];
  total: number;
  loadingWindow: boolean;
  refetchWindow: () => Promise<void>;
  /**
   * Optimistic PATCH. Updates rowsById locally, fires onLocalPatch (so
   * non-root caches stay in sync), then POSTs. On success: fires
   * onPatched. If the body matches cascadeOnFields: refetches + fires
   * onCascadeRefresh. On error: invokes onPatchError if provided,
   * otherwise stays silent (preserves existing behaviour).
   */
  patchAndApply: (id: string, body: Record<string, unknown>) => void;
  /**
   * Lazy child loader for tree expansion. Returns whatever the server
   * returns under `items` — caller is responsible for merging into its
   * own child cache.
   */
  fetchChildren: (parentId: string) => Promise<T[]>;
}

// ── Implementation ───────────────────────────────────────────────────────────

const DEFAULT_GET_ID = <T,>(row: T): string => (row as { id: string }).id;

interface FetchResponse<T> {
  items: T[];
  total: number;
}

export function useObjectTreeWindow<T>(
  opts: UseObjectTreeWindowOptions<T>,
): UseObjectTreeWindowResult<T> {
  const {
    resourceUrl,
    pageSize,
    pageIndex,
    sortKey,
    sortDir,
    filterQuery,
    cascadeOnFields,
    getId = DEFAULT_GET_ID,
    onPatched,
    onLocalPatch,
    onCascadeRefresh,
    onPatchError,
  } = opts;

  // Active topology scope clamps every read. The actual ?meg= param is
  // appended by withForwardedMeg (api.ts); the dep list here just makes
  // sure refetchWindow re-fires when the picker flips. Without this dep
  // the tree below the scope picker shows stale rows for the previous
  // clamp (TD-URL-SCOPE-PARAM-CUTOVER).
  const { activeNodeId, direction } = useScope();

  // Flat source of truth. Patches mutate one entry. windowRoots is
  // derived from this map preserving the latest fetch order (recorded
  // in `order` so reorders from sort/filter changes follow the server).
  const [rowsById, setRowsById] = useState<Map<string, T>>(new Map());
  const [order, setOrder] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingWindow, setLoadingWindow] = useState(false);

  // Slice 4.6a — request generation counter. Every refetch bumps it
  // and captures its own generation at start; on response we drop
  // results from any generation older than the most-recent in-flight.
  // Prevents a stale response from overwriting a newer one after rapid
  // dep-list changes (e.g. user flips sort then immediately flips
  // filter — the old sort's response might land second otherwise).
  const reqGenRef = useRef(0);

  // windowRoots is the rendered output — kept as a memoised projection
  // so child re-renders don't churn when an unrelated patch touches a
  // different row.
  const windowRoots = useMemo<T[]>(() => {
    const out: T[] = [];
    for (const id of order) {
      const row = rowsById.get(id);
      if (row !== undefined) out.push(row);
    }
    return out;
  }, [rowsById, order]);

  // Append filterQuery and sort to a request URL. Handles the case
  // where resourceUrl already carries a querystring (e.g.
  // "/work-items?item_type=risk" from p_wizard_risks.json) — without
  // the seq toggle the page collapses to 0 rows because the backend
  // sees `item_type=risk?limit=25`.
  const sep = resourceUrl.includes("?") ? "&" : "?";
  const sortSlice = sortKey ? `&sort=${sortKey}&dir=${sortDir}` : "";

  const refetchWindow = useCallback(async () => {
    // Bump generation + capture our own. On response we'll check that
    // ours is still the latest before applying state — otherwise a
    // stale response would clobber a newer one (Slice 4.6a guard).
    reqGenRef.current += 1;
    const myGen = reqGenRef.current;
    setLoadingWindow(true);
    try {
      // "all" mode: fetch in chunks until total reached. Used by reports
      // / aggregation surfaces that need every root, not by paginated
      // grids.
      if (pageSize === "all") {
        const CHUNK = 1000;
        const first = await apiSite<FetchResponse<T>>(
          `${resourceUrl}${sep}limit=${CHUNK}&offset=0${sortSlice}${filterQuery}`,
        );
        const totalRoots = first.total ?? first.items.length;
        const combined: T[] = [...first.items];
        if (totalRoots > first.items.length) {
          const offsets: number[] = [];
          for (let o = first.items.length; o < totalRoots; o += CHUNK) offsets.push(o);
          const rest = await Promise.all(
            offsets.map((o) =>
              apiSite<FetchResponse<T>>(
                `${resourceUrl}${sep}limit=${CHUNK}&offset=${o}${sortSlice}${filterQuery}`,
              ),
            ),
          );
          for (const page of rest) combined.push(...page.items);
        }
        // Stale-response guard: a newer refetch has started — drop ours.
        if (reqGenRef.current !== myGen) return;
        const nextMap = new Map<string, T>();
        const nextOrder: string[] = [];
        for (const row of combined) {
          const id = getId(row);
          nextMap.set(id, row);
          nextOrder.push(id);
        }
        setRowsById(nextMap);
        setOrder(nextOrder);
        setTotal(totalRoots);
        return;
      }

      // Paginated mode: one request per page.
      const offset = pageIndex * pageSize;
      const res = await apiSite<FetchResponse<T>>(
        `${resourceUrl}${sep}limit=${pageSize}&offset=${offset}${sortSlice}${filterQuery}`,
      );
      // Stale-response guard — see above.
      if (reqGenRef.current !== myGen) return;
      const nextMap = new Map<string, T>();
      const nextOrder: string[] = [];
      for (const row of res.items) {
        const id = getId(row);
        nextMap.set(id, row);
        nextOrder.push(id);
      }
      setRowsById(nextMap);
      setOrder(nextOrder);
      setTotal(res.total ?? res.items.length);
    } finally {
      // Only clear loading if WE are still the latest gen; otherwise a
      // newer refetch is in flight and should own the loading flag.
      if (reqGenRef.current === myGen) setLoadingWindow(false);
    }
  }, [
    resourceUrl,
    sep,
    pageSize,
    pageIndex,
    sortSlice,
    filterQuery,
    activeNodeId,
    direction,
    getId,
  ]);

  // Slice 4.6a — debounced auto-refetch. Rapid dep-list changes (sort
  // flip + filter chip toggle + scope change in close succession) all
  // schedule their own refetch effect; with the debounce they collapse
  // to ONE outgoing request after the user settles. Cleanup cancels a
  // pending timer if the deps change again before fire — exactly the
  // coalescing we want. The first mount fires after the debounce too,
  // which adds a tiny perceived delay (~150ms) on first paint; in
  // exchange we don't burn a fetch on the noisy initial-mount cascade
  // (auth + scope context bootstrap can re-fire deps a few times).
  useEffect(() => {
    const t = setTimeout(() => {
      void refetchWindow();
    }, REFETCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [refetchWindow]);

  const patchAndApply = useCallback(
    (id: string, body: Record<string, unknown>) => {
      // Optimistic: mutate one map entry. Other rows untouched.
      setRowsById((prev) => {
        const existing = prev.get(id);
        if (existing === undefined) return prev;
        const next = new Map(prev);
        next.set(id, { ...existing, ...body } as T);
        return next;
      });
      // Mirror into out-of-hook caches (expanded children in ResourceTree).
      onLocalPatch?.(id, body);

      apiSite<T>(`${resourceUrl}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
        .then(() => {
          onPatched?.(body);
          // Cascade check — generic now, driven by config.
          const cascaded = cascadeOnFields.some((field) => field in body);
          if (cascaded) {
            void refetchWindow();
            onCascadeRefresh?.();
          }
        })
        .catch((err: unknown) => {
          const handled = onPatchError?.(err, id, body) ?? false;
          if (handled) {
            // Caller asked us to recover — refetch to revert optimistic state.
            void refetchWindow();
            return;
          }
          // Silent default: unrelated patch failures stay silent so this
          // hook doesn't gain new behaviour as it generalises. Caller's
          // onPatched is the success path; failures are visible via the
          // network tab + ApiError downstream of the calling component.
          //
          // Touch err to keep ESLint happy without changing behaviour.
          void err;
        });
    },
    [
      resourceUrl,
      cascadeOnFields,
      onPatched,
      refetchWindow,
      onLocalPatch,
      onCascadeRefresh,
      onPatchError,
    ],
  );

  const fetchChildren = useCallback(
    async (parentId: string) => {
      const res = await apiSite<{ items: T[] }>(
        `${resourceUrl}/${parentId}/children`,
      );
      return res.items;
    },
    [resourceUrl],
  );

  return {
    rowsById,
    windowRoots,
    total,
    loadingWindow,
    refetchWindow,
    patchAndApply,
    fetchChildren,
  };
}

// Re-export ApiError so consumers can narrow inside their onPatchError
// callbacks without importing api.ts directly.
export { ApiError };
