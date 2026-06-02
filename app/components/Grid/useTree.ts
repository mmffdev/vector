"use client";

// useTree — the headless tree core for the Grid primitive.
//
// EXTRACTED from app/components/DataGrid/useDataGridTree.ts (NOT greenfielded
// — same state machine, ~80% identical). The whole expand / lazy-fetch /
// cache / expand-all-cascade engine is preserved verbatim. The ONE thing
// removed is the SVG line geometry the old flatten computed inline
// (depth / isLast / continuations[] / getChildrenCount-driven walk) — that
// was the source of the /scope tree-connector bug. Depth and connector lines
// are now a pure function of DOM nesting + CSS (:last-child), so this hook
// returns a NESTED node tree and holds zero geometry.
//
// Owns ALL tree state/behaviour (the headless core of the headless-core +
// styled-skin model). Grid__Tree consumes it and owns the canonical look.
// Extensions add behaviour via options here (e.g. expandable), never by
// re-styling the skin.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode, UseTreeOptions, UseTreeResult } from "./types";

export function useTree<TRow>(
  opts: UseTreeOptions<TRow>,
): UseTreeResult<TRow> {
  const {
    fetchRoots,
    pageSize = 100,
    rowIdOf,
    getChildrenCount,
    fetchChildren,
    expandable = true,
  } = opts;

  // ── Root window (the canopy the hook now owns) ─────────────────────────────
  // roots = the accumulated (loadMore) or replaced (jumpToPage) window.
  // offset = the window's start; total = the server count across all roots.
  const [roots, setRoots] = useState<TRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [rootsLoading, setRootsLoading] = useState(false);
  // Guards a concurrent root fetch (mount-effect + a fast loadMore click).
  const rootsInFlightRef = useRef(false);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  // parentId → its fetched children. Map identity changes on every set so the
  // node memo recomputes.
  const [childrenById, setChildrenById] = useState<Map<string, TRow[]>>(
    () => new Map(),
  );
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());

  // Expand-all latch. While true, an effect drives the cascade: expand every
  // currently-known expandable row, let fetchChildren surface the next level,
  // repeat until no new expandable row appears, then drop the latch. A latch
  // (not an imperative loop) is required because each level's children only
  // become known AFTER its fetchChildren resolves and React re-renders.
  const [expandAllActive, setExpandAllActive] = useState(false);

  // Guard against double-fetching the same parent when a second toggle lands
  // before the first resolves.
  const inFlightRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    setExpandedIds(new Set());
    setChildrenById(new Map());
    setLoadingIds(new Set());
    setExpandAllActive(false);
    inFlightRef.current = new Set();
  }, []);

  // ── Root window loaders ────────────────────────────────────────────────────
  // One private primitive fetches a page and either APPENDS it (loadMore —
  // keeps expansion) or REPLACES the window (jump / refresh / mount — the
  // caller resets expansion first). The rootsInFlightRef guard stops a second
  // loadMore landing before the first resolves from double-appending.
  const loadPage = useCallback(
    async (pageOffset: number, mode: "append" | "replace") => {
      if (rootsInFlightRef.current) return;
      rootsInFlightRef.current = true;
      setRootsLoading(true);
      try {
        const { rows, total: t } = await fetchRoots({
          limit: pageSize,
          offset: pageOffset,
        });
        setTotal(t);
        // Append keeps the window START where it is (offset unchanged) and
        // grows the length; replace moves the window to pageOffset. So only a
        // replace updates offset — this keeps hasMore (offset + length < total)
        // and currentPage correct in both modes.
        if (mode === "replace") setOffset(pageOffset);
        setRoots((prev) => (mode === "append" ? [...prev, ...rows] : rows));
      } catch {
        /* leave the window as-is; a retry can re-attempt */
      } finally {
        rootsInFlightRef.current = false;
        setRootsLoading(false);
      }
    },
    [fetchRoots, pageSize],
  );

  // Append the next page below the current window. offset stays at the window
  // START; we fetch from loadedCount (roots.length) so consecutive loadMores
  // walk forward. Expansion + child caches are untouched.
  const loadMore = useCallback(() => {
    void loadPage(roots.length, "append");
  }, [loadPage, roots.length]);

  // Replace the window with page n. reset() first so no expanded subtree points
  // at a row that's about to leave the window.
  const jumpToPage = useCallback(
    (n: number) => {
      reset();
      void loadPage(Math.max(0, n) * pageSize, "replace");
    },
    [reset, loadPage, pageSize],
  );

  // Post-mutation refresh — reload from the top with a clean slate.
  const refresh = useCallback(() => {
    reset();
    void loadPage(0, "replace");
  }, [reset, loadPage]);

  // Mount — load page 0. Runs once (fetchRoots/pageSize are stable per consumer).
  useEffect(() => {
    void loadPage(0, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch + cache one row's children (idempotent). Shared by toggle (lazy
  // expand) and the expand-all cascade. Mutates the childrenById cache, which
  // re-triggers the node memo + the cascade effect. fetchChildren failures
  // drop the in-flight mark so a retry can re-attempt.
  const ensureChildren = useCallback(
    (row: TRow) => {
      if (!expandable) return;
      const id = rowIdOf(row);
      if (childrenById.has(id) || inFlightRef.current.has(id)) return;
      inFlightRef.current.add(id);
      setLoadingIds((prev) => new Set(prev).add(id));
      fetchChildren(row)
        .then((kids) => {
          setChildrenById((prev) => new Map(prev).set(id, kids));
        })
        .catch(() => {
          /* leave uncached; toggle()'s own catch handles UX collapse */
        })
        .finally(() => {
          inFlightRef.current.delete(id);
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        });
    },
    [expandable, rowIdOf, fetchChildren, childrenById],
  );

  const toggle = useCallback(
    (row: TRow) => {
      if (!expandable) return;
      const id = rowIdOf(row);

      // Collapse — keep the child cache (cheap re-expand), just hide.
      if (expandedIds.has(id)) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }

      // Manual collapse cancels an in-progress expand-all so the cascade
      // doesn't immediately re-expand the row the user just closed.
      setExpandAllActive(false);

      // Expand. If children already cached, just reveal.
      setExpandedIds((prev) => new Set(prev).add(id));
      if (childrenById.has(id) || inFlightRef.current.has(id)) return;

      // First expand for this row → lazy fetch. On failure, drop the
      // expansion so the caret returns to closed and the user can retry
      // (silent — the network tab + apiSite ApiError carry the detail).
      inFlightRef.current.add(id);
      setLoadingIds((prev) => new Set(prev).add(id));
      fetchChildren(row)
        .then((kids) => {
          setChildrenById((prev) => new Map(prev).set(id, kids));
        })
        .catch(() => {
          setExpandedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        })
        .finally(() => {
          inFlightRef.current.delete(id);
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        });
    },
    [expandable, rowIdOf, fetchChildren, expandedIds, childrenById],
  );

  // Build the NESTED node tree (roots → visible descendants), threading the
  // tree geometry the skin needs to indent IN-CELL (ResourceTree model):
  //   • depth          — nesting level (roots = 0)
  //   • isLast         — last among its siblings (└ vs ├)
  //   • continuations  — per-ancestor │ through-line flags (root→parent)
  // The skin renders a FLAT list (flatNodes) so lead columns stay fixed; only
  // the primary cell's SVG indents.
  const nodes = useMemo<TreeNode<TRow>[]>(() => {
    const build = (
      siblings: TRow[],
      depth: number,
      ancestorContinuations: boolean[],
    ): TreeNode<TRow>[] =>
      siblings.map((row, idx) => {
        const id = rowIdOf(row);
        const hasChildren = expandable && getChildrenCount(row) > 0;
        const expanded = expandable && expandedIds.has(id);
        const isLast = idx === siblings.length - 1;
        const kids = expanded ? childrenById.get(id) ?? [] : [];
        // Children's ancestor-continuations = our ancestors + (we continue).
        const childCont = [...ancestorContinuations, !isLast];
        const childNodes =
          kids.length > 0 ? build(kids, depth + 1, childCont) : [];
        return {
          row,
          id,
          hasChildren,
          expanded,
          hasVisibleChildren: childNodes.length > 0,
          loading: loadingIds.has(id),
          children: childNodes,
          toggle: () => toggle(row),
          depth,
          isLast,
          continuations: ancestorContinuations,
        };
      });
    return build(roots, 0, []);
  }, [
    roots,
    expandable,
    getChildrenCount,
    expandedIds,
    childrenById,
    loadingIds,
    rowIdOf,
    toggle,
  ]);

  // Flatten the visible tree depth-first into render order. This is what the
  // skin maps over — flat rows, geometry carried per node.
  const flatNodes = useMemo<TreeNode<TRow>[]>(() => {
    const acc: TreeNode<TRow>[] = [];
    const walk = (ns: TreeNode<TRow>[]) => {
      for (const n of ns) {
        acc.push(n);
        if (n.children.length) walk(n.children);
      }
    };
    walk(nodes);
    return acc;
  }, [nodes]);

  // Every expandable row currently KNOWN — roots plus every already-fetched
  // child subtree — reporting children_count > 0. This is the universe the
  // expand-all control must drive open. It GROWS as fetchChildren resolves:
  // a freshly-revealed child with its own children adds its id here on the
  // next render, which lets the cascade reach deeper levels.
  const knownExpandable = useMemo<{ id: string; row: TRow }[]>(() => {
    if (!expandable) return [];
    const acc: { id: string; row: TRow }[] = [];
    const seen = new Set<string>();
    const walk = (rows: TRow[]) => {
      for (const row of rows) {
        const id = rowIdOf(row);
        if (seen.has(id)) continue;
        seen.add(id);
        if (getChildrenCount(row) > 0) acc.push({ id, row });
        const kids = childrenById.get(id);
        if (kids) walk(kids);
      }
    };
    walk(roots);
    return acc;
  }, [roots, expandable, getChildrenCount, childrenById, rowIdOf]);

  const allExpanded = useMemo(
    () =>
      knownExpandable.length > 0 &&
      knownExpandable.every((e) => expandedIds.has(e.id)),
    [knownExpandable, expandedIds],
  );

  const expandAll = useCallback(() => {
    if (!expandable) return;
    setExpandAllActive(true);
  }, [expandable]);

  const collapseAll = useCallback(() => {
    setExpandAllActive(false);
    setExpandedIds(new Set());
  }, []);

  // Expand-all cascade. Runs whenever the latch is on or the known universe
  // grows. Each pass: expand every known-expandable row not yet expanded, and
  // make sure its children are being fetched. When fetchChildren resolves it
  // mutates childrenById → knownExpandable grows → this effect re-runs and
  // reaches the next level. Once every known-expandable row is expanded AND
  // nothing is in flight, the tree is fully open: drop the latch. Manual
  // collapse (toggle) clears the latch, ending the cascade early.
  useEffect(() => {
    if (!expandAllActive || !expandable) return;

    const pending = knownExpandable.filter((e) => !expandedIds.has(e.id));
    if (pending.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const e of pending) next.add(e.id);
        return next;
      });
      for (const e of pending) ensureChildren(e.row);
      return;
    }

    // Nothing left to expand among known rows. If fetches are still settling,
    // wait for the next render (childrenById will change). Otherwise we've
    // reached a fixed point — drop the latch.
    if (inFlightRef.current.size === 0) setExpandAllActive(false);
  }, [expandAllActive, expandable, knownExpandable, expandedIds, ensureChildren]);

  return {
    nodes,
    flatNodes,
    loadingIds,
    reset,
    expandAll,
    collapseAll,
    allExpanded,
    // Root pagination
    total,
    loadedCount: roots.length,
    pageSize,
    // "Is there a root past the window's END position?" — works for BOTH modes:
    // append grows roots.length from offset 0; a jump sets offset = n×pageSize
    // and replaces, so the window's end is offset + length either way.
    hasMore: offset + roots.length < total,
    currentPage: pageSize > 0 ? Math.floor(offset / pageSize) : 0,
    rootsLoading,
    loadMore,
    jumpToPage,
    refresh,
  };
}
