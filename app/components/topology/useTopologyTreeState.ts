"use client";

// PLA-0006/00332 — tree-derived state and collapse helpers lifted out
// of page.tsx. Owns the collapsed Set, the childrenOf map, and the
// per-node lookup callbacks (hasChildrenLive, archivedDescendantCountFor,
// nodeNameFor, liveAncestorsMap).

import { useCallback, useMemo, useState } from "react";
import type { OrgNode } from "@/app/lib/topologyApi";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";

export function useTopologyTreeState(tree: OrgNode[] | null) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const root = useMemo(
    () => tree?.find((n) => n.parent_id === null) ?? null,
    [tree],
  );
  const tenantName = root?.name ?? "Topology";

  // PLA-0044: childrenOf is sourced from the shared walker so canvas,
  // flyout, rail, and BFF all bucket children with the same orphan-drop
  // and sibling-sort rules. Archived nodes are dropped via filter — the
  // hook only needs the live tree.
  const childrenOf = useMemo(() => {
    const { childrenOf: cof } = walkTopology(tree ?? [], {
      collapsed: new Set(),
      sort: byPosition,
      filter: (n) => n.archived_at === null,
    });
    return cof;
  }, [tree]);

  const hasChildrenLive = useCallback(
    (id: string) => (childrenOf.get(id) ?? []).length > 0,
    [childrenOf],
  );

  const archivedDescendantCountFor = useCallback(
    (id: string) => {
      const n = (tree ?? []).find((t) => t.id === id);
      return n?.archived_descendant_count ?? 0;
    },
    [tree],
  );

  const nodeNameFor = useCallback(
    (id: string) => (tree ?? []).find((t) => t.id === id)?.name ?? "",
    [tree],
  );

  // Live-only OrgNode index used by ArchiveMapFlyout to walk back from
  // archived twigs to the nearest live ancestor for breadcrumb rows.
  const liveAncestorsMap = useMemo(() => {
    const m = new Map<string, { name: string; parentId: string | null }>();
    for (const n of tree ?? []) {
      if (n.archived_at) continue;
      m.set(n.id, { name: n.name, parentId: n.parent_id });
    }
    return m;
  }, [tree]);

  const onToggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const onCollapseAll = useCallback(() => {
    const next = new Set<string>();
    for (const [parentId, kids] of childrenOf.entries()) {
      if (parentId !== null && kids.length > 0) next.add(parentId);
    }
    setCollapsed(next);
  }, [childrenOf]);

  return {
    collapsed,
    setCollapsed,
    tenantName,
    childrenOf,
    hasChildrenLive,
    archivedDescendantCountFor,
    nodeNameFor,
    liveAncestorsMap,
    onToggleCollapse,
    onExpandAll,
    onCollapseAll,
  };
}
