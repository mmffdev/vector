"use client";

// Adapter hook: fetches the org topology tree (offices/teams/reporting
// lines) and reshapes it into a `RelationsPayload` so the
// `<MapRelationship3D>` primitive can render it with the same Three.js
// engine used by the work-items relations graph.
//
// One data shape, two sources: work-items (parent_artefact_id) and
// topology (org_nodes.parent_id).

import { useCallback, useEffect, useMemo, useState } from "react";
import { topologyApi, type OrgNode } from "@/app/lib/topologyApi";
import type {
  RelationsEdge,
  RelationsNode,
  RelationsPayload,
} from "@/app/api/v2/work-items/relations/route";

export type UseTopologyRelationsPayloadResult = {
  data: RelationsPayload | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

// Compute depth + descendant_count in a single pass over the flat tree.
function annotate(nodes: OrgNode[]): Map<string, { depth: number; descendants: number }> {
  const byId = new Map<string, OrgNode>();
  for (const n of nodes) byId.set(n.id, n);

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    const arr = childrenOf.get(n.parent_id ?? "") ?? [];
    arr.push(n.id);
    childrenOf.set(n.parent_id ?? "", arr);
  }

  const depthCache = new Map<string, number>();
  function depthOf(id: string): number {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n || !n.parent_id || !byId.has(n.parent_id)) {
      depthCache.set(id, 0);
      return 0;
    }
    const d = depthOf(n.parent_id) + 1;
    depthCache.set(id, d);
    return d;
  }

  const descCache = new Map<string, number>();
  function descOf(id: string): number {
    const cached = descCache.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf.get(id) ?? [];
    let total = kids.length;
    for (const k of kids) total += descOf(k);
    descCache.set(id, total);
    return total;
  }

  const out = new Map<string, { depth: number; descendants: number }>();
  for (const n of nodes) {
    out.set(n.id, { depth: depthOf(n.id), descendants: descOf(n.id) });
  }
  return out;
}

function adapt(nodes: OrgNode[]): RelationsPayload {
  const live = nodes.filter((n) => n.archived_at == null);
  const liveIds = new Set(live.map((n) => n.id));
  const ann = annotate(live);

  const relNodes: RelationsNode[] = live.map((n, i) => {
    const a = ann.get(n.id) ?? { depth: 0, descendants: 0 };
    return {
      id: n.id,
      number: i + 1,
      // Two-letter type prefix borrowed from work-items shape; the graph
      // uses it only for sidebar display.
      prefix: "OF",
      type_name: a.depth === 0 ? "Office" : a.descendants > 0 ? "Team" : "Member",
      title: n.label_override?.trim() || n.name,
      state_name: null,
      state_kind: null,
      parent_id: n.parent_id && liveIds.has(n.parent_id) ? n.parent_id : null,
      depth: a.depth,
      descendant_count: a.descendants,
    };
  });

  const relEdges: RelationsEdge[] = [];
  for (const n of live) {
    if (n.parent_id && liveIds.has(n.parent_id)) {
      relEdges.push({ source: n.parent_id, target: n.id, kind: "parent" });
    }
  }

  return {
    nodes: relNodes,
    edges: relEdges,
    meta: {
      subscription_id: live[0]?.subscription_id ?? "",
      generated_at: new Date().toISOString(),
      node_count: relNodes.length,
      edge_count: relEdges.length,
      edge_kinds: relEdges.length > 0 ? ["parent"] : [],
      truncated: false,
      cap: 60_000,
    },
  };
}

export function useTopologyRelationsPayload(
  wsRef?: string,
): UseTopologyRelationsPayloadResult {
  const [tree, setTree] = useState<OrgNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // PLA-0053: tree() now reads workspace from JWT, not URL param.
      void wsRef;
      const res = await topologyApi.tree();
      setTree(res);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setTree(null);
    } finally {
      setLoading(false);
    }
  }, [wsRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const data = useMemo(() => (tree ? adapt(tree) : null), [tree]);

  return { data, loading, error, refetch };
}
