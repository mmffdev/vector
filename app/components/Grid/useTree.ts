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
  roots: TRow[],
  opts: UseTreeOptions<TRow>,
): UseTreeResult<TRow> {
  const { rowIdOf, getChildrenCount, fetchChildren, expandable = true } = opts;

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

  // Build the NESTED node tree (roots → visible descendants). No depth, no
  // isLast, no continuations — DOM nesting + CSS draw the connectors.
  const nodes = useMemo<TreeNode<TRow>[]>(() => {
    const build = (siblings: TRow[]): TreeNode<TRow>[] =>
      siblings.map((row) => {
        const id = rowIdOf(row);
        const hasChildren = expandable && getChildrenCount(row) > 0;
        const expanded = expandable && expandedIds.has(id);
        const kids = expanded ? childrenById.get(id) ?? [] : [];
        const childNodes = kids.length > 0 ? build(kids) : [];
        return {
          row,
          id,
          hasChildren,
          expanded,
          hasVisibleChildren: childNodes.length > 0,
          loading: loadingIds.has(id),
          children: childNodes,
          toggle: () => toggle(row),
        };
      });
    return build(roots);
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

  return { nodes, loadingIds, reset, expandAll, collapseAll, allExpanded };
}
