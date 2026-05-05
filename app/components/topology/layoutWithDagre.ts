// PLA-0006/00332 — pure dagre layout function lifted out of page.tsx.
// Returns React Flow Node[] + Edge[] for the visible-only graph (i.e.
// subtrees rooted at a collapsed node are skipped).

import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";
import type { OrgNode } from "@/app/lib/topologyApi";
import {
  NODE_W,
  NODE_H,
  SELECTED_NODE_W,
  SELECTED_NODE_H,
  RANK_SEP,
  NODE_SEP,
  type RankDir,
  type EdgeKind,
  type OrgNodeData,
} from "./types";

export function layoutWithDagre(
  tree: OrgNode[],
  collapsed: Set<string>,
  childrenOf: Map<string | null, OrgNode[]>,
  rankdir: RankDir,
  edgeKind: EdgeKind,
  selectedId: string | null,
): { nodes: Node<OrgNodeData>[]; edges: Edge[] } {
  if (tree.length === 0) return { nodes: [], edges: [] };

  // Walk visible-only graph: skip subtrees rooted at a collapsed node.
  const visibleIds = new Set<string>();
  const roots = childrenOf.get(null) ?? [];
  const walk = (n: OrgNode) => {
    visibleIds.add(n.id);
    if (collapsed.has(n.id)) return;
    for (const k of childrenOf.get(n.id) ?? []) walk(k);
  };
  for (const r of roots) walk(r);

  const g = new dagre.graphlib.Graph<{}>();
  g.setGraph({ rankdir, ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of visibleIds) {
    const isSel = id === selectedId;
    g.setNode(id, {
      width: isSel ? SELECTED_NODE_W : NODE_W,
      height: isSel ? SELECTED_NODE_H : NODE_H,
    });
  }

  const visibleEdges: Array<{ source: string; target: string }> = [];
  for (const id of visibleIds) {
    const kids = collapsed.has(id) ? [] : childrenOf.get(id) ?? [];
    for (const k of kids) {
      if (!visibleIds.has(k.id)) continue;
      g.setEdge(id, k.id);
      visibleEdges.push({ source: id, target: k.id });
    }
  }

  dagre.layout(g);

  const nodes: Node<OrgNodeData>[] = [];
  for (const id of visibleIds) {
    const pos = g.node(id);
    const org = tree.find((n) => n.id === id);
    if (!org || !pos) continue;
    const liveChildren = (childrenOf.get(id) ?? []).length;
    const isSel = id === selectedId;
    const w = isSel ? SELECTED_NODE_W : NODE_W;
    const h = isSel ? SELECTED_NODE_H : NODE_H;
    nodes.push({
      id,
      type: "orgNode",
      // dagre returns the centre; React Flow positions by top-left.
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
      // dagre owns layout — let users pan the canvas, not the nodes.
      // Drag-reparent will be reinstated via an explicit "Move…" menu
      // action so dropping has a clear target list and undo path.
      draggable: false,
      // Bake selection into the layout so the rfNodes-replacement effect
      // (collapse/expand/rankdir change) doesn't drop the selected ring
      // and resize the node back to its non-selected dimensions.
      selected: isSel,
      data: {
        org,
        childCount: liveChildren,
        archivedDescendantCount: org.archived_descendant_count ?? 0,
        collapsed: collapsed.has(id),
        hasChildren: liveChildren > 0,
        rankdir,
        // wired up by parent via setNodes
        onToggleCollapse: () => {},
        onOpenMenu: () => {},
        onOpenArchiveMap: () => {},
        onRename: () => false,
      },
    });
  }

  const edges: Edge[] = visibleEdges.map((e) => ({
    id: `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    type: edgeKind,
    style: { stroke: "#94a3b8", strokeWidth: 1.5 },
  }));

  return { nodes, edges };
}
