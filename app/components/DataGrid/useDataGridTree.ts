"use client";

// useDataGridTree — tree-mode state + flatten for <DataGrid>.
//
// When a DataGridConfig declares `tree`, the scaffold delegates here to:
//   1. hold expansion state (which row ids are expanded),
//   2. lazily fetch + cache each expanded row's children,
//   3. DFS-flatten roots + expanded descendants into a single ordered
//      render list, computing per-row geometry (depth / isLast /
//      continuations / hasVisibleChildren) so the primary column can draw
//      the same ├─ / └─ / pass-through lines ResourceTree draws.
//
// The flatten geometry intentionally mirrors ResourceTree's TreeLines
// contract (continuations[] = per-ancestor "has-siblings-below" flags,
// length === depth) so the exported PrimaryCellTreeLines helper renders
// identically across both surfaces.
//
// Flat-mode grids never import this — the scaffold only calls it when
// config.tree is present.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataGridConfig, RowTreeCtx } from "./types";

export interface FlatRow<TRow> {
  row: TRow;
  id: string;
  treeCtx: RowTreeCtx;
}

export interface UseDataGridTreeResult<TRow> {
  /** Roots + expanded descendants, in render order, each with geometry. */
  flatRows: FlatRow<TRow>[];
  /** Row ids whose children fetch is currently in flight (spinner row). */
  loadingIds: Set<string>;
  /** Drop all expansion + child caches — call when roots refetch (sort/filter/scope). */
  reset: () => void;
  /**
   * Expand EVERY currently-known row that has children, recursively, in one
   * shot. Walks the current flatRows-visible set repeatedly until no new
   * expandable row surfaces, fetching each level's children as it goes. Used
   * by the header-row expand-all control. Safe to call repeatedly.
   */
  expandAll: () => void;
  /** Collapse every row (clears expansion; keeps the child cache). */
  collapseAll: () => void;
  /**
   * True when every expandable row currently in the flattened render set is
   * expanded — drives the header control's expanded/collapsed icon + label.
   * False when at least one expandable visible row is still collapsed (or
   * there are no expandable rows at all).
   */
  allExpanded: boolean;
}

export function useDataGridTree<TRow>(
  roots: TRow[],
  tree: NonNullable<DataGridConfig<TRow>["tree"]> | undefined,
  rowIdOf: (row: TRow) => string,
): UseDataGridTreeResult<TRow> {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  // parentId → its fetched children. Map identity changes on every splice
  // so the flatten memo recomputes.
  const [childrenById, setChildrenById] = useState<Map<string, TRow[]>>(
    () => new Map(),
  );
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());

  // Expand-all latch. While true, an effect drives the cascade: expand every
  // currently-known expandable row, let fetchChildren surface the next level,
  // repeat until no new expandable row appears, then drop the latch. A latch
  // (not an imperative loop) is required because each level's children may
  // only become known AFTER its fetchChildren resolves and React re-renders.
  const [expandAllActive, setExpandAllActive] = useState(false);

  // Guard against double-fetching the same parent when a second toggle
  // lands before the first resolves.
  const inFlightRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    setExpandedIds(new Set());
    setChildrenById(new Map());
    setLoadingIds(new Set());
    setExpandAllActive(false);
    inFlightRef.current = new Set();
  }, []);

  // Fetch + cache one row's children (idempotent). Shared by toggle (lazy
  // expand) and the expand-all cascade. Returns nothing — it mutates the
  // childrenById cache, which re-triggers the flatten memo + the cascade
  // effect. fetchChildren failures drop the in-flight mark so a retry can
  // re-attempt; the row simply stays childless in the render.
  const ensureChildren = useCallback(
    (row: TRow) => {
      if (!tree) return;
      const id = rowIdOf(row);
      if (childrenById.has(id) || inFlightRef.current.has(id)) return;
      inFlightRef.current.add(id);
      setLoadingIds((prev) => new Set(prev).add(id));
      tree
        .fetchChildren(row)
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
    [tree, rowIdOf, childrenById],
  );

  const toggle = useCallback(
    (row: TRow) => {
      if (!tree) return;
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
      // (silent — the network tab + apiSite ApiError carry the detail,
      // same posture as the windowed-fetch hook).
      inFlightRef.current.add(id);
      setLoadingIds((prev) => new Set(prev).add(id));
      tree
        .fetchChildren(row)
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
    [tree, rowIdOf, expandedIds, childrenById],
  );

  const flatRows = useMemo<FlatRow<TRow>[]>(() => {
    if (!tree) {
      // Defensive — caller shouldn't invoke flatten without tree, but keep
      // it a no-op rather than throw.
      return roots.map((row) => ({
        row,
        id: rowIdOf(row),
        treeCtx: {
          depth: 0,
          expanded: false,
          hasChildren: false,
          isLast: true,
          hasVisibleChildren: false,
          continuations: [],
          toggle: () => {},
        },
      }));
    }

    const out: FlatRow<TRow>[] = [];

    const walk = (
      siblings: TRow[],
      depth: number,
      continuations: boolean[],
    ) => {
      siblings.forEach((row, idx) => {
        const id = rowIdOf(row);
        const isLast = idx === siblings.length - 1;
        const childCount = tree.getChildrenCount(row);
        const hasChildren = childCount > 0;
        const expanded = expandedIds.has(id);
        const kids = expanded ? childrenById.get(id) ?? [] : [];
        const hasVisibleChildren = expanded && kids.length > 0;

        out.push({
          row,
          id,
          treeCtx: {
            depth,
            expanded,
            hasChildren,
            isLast,
            hasVisibleChildren,
            continuations,
            toggle: () => toggle(row),
          },
        });

        if (hasVisibleChildren) {
          // A child at depth+1 draws a pass-through line for THIS level
          // only when this row is NOT the last sibling (i.e. there are
          // more rows below this subtree at this depth).
          walk(kids, depth + 1, [...continuations, !isLast]);
        }
      });
    };

    walk(roots, 0, []);
    return out;
  }, [roots, tree, expandedIds, childrenById, rowIdOf, toggle]);

  // Every expandable row currently KNOWN — roots plus every already-fetched
  // child subtree — that reports children_count > 0. This is the universe the
  // expand-all control must drive to fully open. It GROWS as fetchChildren
  // resolves: a freshly-revealed child with its own children adds its id here
  // on the next render, which is what lets the cascade effect reach deeper
  // levels. Each entry carries its row so the cascade can call ensureChildren.
  const knownExpandable = useMemo<{ id: string; row: TRow }[]>(() => {
    if (!tree) return [];
    const acc: { id: string; row: TRow }[] = [];
    const seen = new Set<string>();
    const walk = (rows: TRow[]) => {
      for (const row of rows) {
        const id = rowIdOf(row);
        if (seen.has(id)) continue;
        seen.add(id);
        if (tree.getChildrenCount(row) > 0) acc.push({ id, row });
        const kids = childrenById.get(id);
        if (kids) walk(kids);
      }
    };
    walk(roots);
    return acc;
  }, [roots, tree, childrenById, rowIdOf]);

  const allExpanded = useMemo(
    () =>
      knownExpandable.length > 0 &&
      knownExpandable.every((e) => expandedIds.has(e.id)),
    [knownExpandable, expandedIds],
  );

  const expandAll = useCallback(() => {
    if (!tree) return;
    setExpandAllActive(true);
  }, [tree]);

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
    if (!expandAllActive || !tree) return;

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
  }, [expandAllActive, tree, knownExpandable, expandedIds, ensureChildren]);

  return { flatRows, loadingIds, reset, expandAll, collapseAll, allExpanded };
}
