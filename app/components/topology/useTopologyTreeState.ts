"use client";

// PLA-0006/00332 — tree-derived state and collapse helpers lifted out
// of page.tsx. Owns the collapsed Set, the childrenOf map, and the
// per-node lookup callbacks (hasChildrenLive, archivedDescendantCountFor,
// nodeNameFor, liveAncestorsMap).

import { useCallback, useMemo, useState } from "react";
import type { OrgNode } from "@/app/lib/topologyApi";

export function useTopologyTreeState(tree: OrgNode[] | null) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const root = useMemo(
    () => tree?.find((n) => n.parent_id === null) ?? null,
    [tree],
  );
  const tenantName = root?.name ?? "Topology";

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, OrgNode[]>();
    for (const n of tree ?? []) {
      if (n.archived_at !== null) continue;
      const k = n.parent_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(n);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
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
