// Hierarchy layout — top-down tree, one row per depth.
//
// Reproduces the algorithm from the original SVG <HierarchyTree>: each
// non-root level produces (parent count × fanout) children; nodes sit
// centred inside an evenly-divided slot; per-node width collapses around
// the label so wide rows of small labels stay tight.
//
// Two input modes:
//   1. Pre-built nodes/edges. Each node carries `data.depth` (number) and
//      `data.parentId` (string|null). Levels are derived from depth.
//   2. `options.levels` shorthand: [{ label, fanout }]. The layout fabricates
//      nodes and edges. This matches the legacy ModelHierarchyAccordion
//      caller and keeps the migration mechanical.
//
// Connectors are square (L-shaped): up to mid, across, up into parent.
// Edges with `data.kind === "story"` carry the same path; the view styles
// them differently.

import type {
  Graph,
  GraphEdge,
  GraphNode,
  LaidOutEdge,
  LaidOutGraph,
  LaidOutNode,
} from "../types";

interface LevelSpec {
  label: string;
  fanout: number;
}

const NODE_H = 48;
const ROW_GAP = 72;
const COL_GAP = 14;
const PAD_X = 24;
const PAD_Y = 24;

// Per-node width collapses around the label. 7.5 px/char is a safe
// over-estimate for the system font stack at 13px / 500 weight, plus 24
// px of horizontal padding so the box never clips its text.
const NODE_LABEL_PAD_X = 24;
const NODE_LABEL_CHAR_W = 7.5;
const NODE_W_MIN = 56;
function measureNodeWidth(label: string): number {
  return Math.max(
    NODE_W_MIN,
    Math.ceil(label.length * NODE_LABEL_CHAR_W + NODE_LABEL_PAD_X)
  );
}

function nodesFromLevels(levels: LevelSpec[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  // counts[depth] = how many nodes the depth row holds
  const counts: number[] = [];
  let running = 1;
  for (let i = 0; i < levels.length; i++) {
    if (i === 0) {
      counts.push(1);
      running = 1;
    } else {
      const fanout = Math.max(1, Math.floor(levels[i].fanout));
      running = running * fanout;
      counts.push(running);
    }
  }

  // ids per row, parallel to row indices
  const rowIds: string[][] = [];
  for (let depth = 0; depth < levels.length; depth++) {
    const count = counts[depth];
    const ids: string[] = [];
    const parentCount = depth === 0 ? 0 : counts[depth - 1];
    const childrenPerParent = depth === 0 ? 0 : count / parentCount;
    for (let i = 0; i < count; i++) {
      const id = `n-${depth}-${i}`;
      ids.push(id);
      const parentIdx =
        depth === 0 ? null : Math.floor(i / childrenPerParent);
      const parentId = parentIdx === null ? null : rowIds[depth - 1][parentIdx];
      const isLeaf = depth === levels.length - 1 && depth > 0;
      nodes.push({
        id,
        label: levels[depth].label,
        data: { depth, parentId, isRoot: depth === 0, isLeaf },
      });
      if (parentId) {
        edges.push({
          id: `e-${depth}-${i}`,
          from: id,
          to: parentId,
          data: { kind: isLeaf ? "story" : "tree" },
        });
      }
    }
    rowIds.push(ids);
  }
  return { nodes, edges };
}

export function hierarchyLayout(g: Graph): LaidOutGraph {
  // Resolve nodes/edges. If options.levels is supplied, fabricate.
  let nodes = g.nodes;
  let edges = g.edges;
  const optLevels = g.options?.levels as LevelSpec[] | undefined;
  if ((!nodes || nodes.length === 0) && optLevels && optLevels.length > 0) {
    const built = nodesFromLevels(optLevels);
    nodes = built.nodes;
    edges = built.edges;
  }
  if (!nodes || nodes.length === 0) {
    return { width: 0, height: 0, nodes: [], edges: [] };
  }

  // Bucket by depth.
  const byDepth = new Map<number, GraphNode[]>();
  let maxDepth = 0;
  for (const n of nodes) {
    const d = (n.data?.depth as number) ?? 0;
    if (d > maxDepth) maxDepth = d;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n);
  }

  // The widest row drives the canvas width. Use the legacy slot-width
  // formula: leaf row count × (NODE_W_legacy + COL_GAP). NODE_W_legacy is
  // the slot reservation (150 in the original). Keep it as the slot, then
  // collapse each node inside its slot.
  const SLOT_W = 150;
  const leafCount = byDepth.get(maxDepth)?.length ?? 1;
  const totalWidth = leafCount * SLOT_W + Math.max(0, leafCount - 1) * COL_GAP;
  const width = totalWidth + PAD_X * 2;
  const height =
    (maxDepth + 1) * NODE_H + maxDepth * ROW_GAP + PAD_Y * 2;

  const laidOutById = new Map<string, LaidOutNode>();
  const laidNodes: LaidOutNode[] = [];

  for (let depth = 0; depth <= maxDepth; depth++) {
    const row = byDepth.get(depth) ?? [];
    const count = row.length;
    if (count === 0) continue;
    const slotWidth = totalWidth / count;
    const baseY = PAD_Y + depth * (NODE_H + ROW_GAP);
    for (let i = 0; i < count; i++) {
      const n = row[i];
      const slotCentre = PAD_X + slotWidth * i + slotWidth / 2;
      const w = measureNodeWidth(n.label);
      const laid: LaidOutNode = {
        ...n,
        x: slotCentre - w / 2,
        y: baseY,
        w,
        h: NODE_H,
        depth,
      };
      laidOutById.set(n.id, laid);
      laidNodes.push(laid);
    }
  }

  // Edges: child -> parent, square routing. The view paints edges over
  // nodes so the arrow visually lands on the parent's bottom edge.
  const laidEdges: LaidOutEdge[] = [];
  for (const e of edges ?? []) {
    const child = laidOutById.get(e.from);
    const parent = laidOutById.get(e.to);
    if (!child || !parent) continue;
    const childTopX = child.x + child.w / 2;
    const childTopY = child.y;
    const parentBottomX = parent.x + parent.w / 2;
    const parentBottomY = parent.y + parent.h;
    const midY = (childTopY + parentBottomY) / 2;
    const path =
      Math.abs(childTopX - parentBottomX) < 0.5
        ? `M ${childTopX} ${childTopY} V ${parentBottomY}`
        : `M ${childTopX} ${childTopY} V ${midY} H ${parentBottomX} V ${parentBottomY}`;
    laidEdges.push({
      ...e,
      path,
      fromX: childTopX,
      fromY: childTopY,
      toX: parentBottomX,
      toY: parentBottomY,
    });
  }

  return { width, height, nodes: laidNodes, edges: laidEdges };
}
