// PLA-0006 / 00275 — shared dagre layout runner.
//
// Same dagre invocation runs in two places:
//   1. layoutWorker.ts (off-main-thread, normal path)
//   2. useDagreLayoutWorker.ts (main-thread fallback when the Worker
//      can't be constructed — Turbopack `new Worker(new URL(...))`
//      occasionally fails to bundle in dev mode).
//
// Returning the same shape from both keeps the call sites identical.

import { graphlib, layout } from "dagre";

export interface DagreLayoutInputNode {
  id: string;
  width: number;
  height: number;
}

export interface DagreLayoutInputEdge {
  source: string;
  target: string;
}

export interface DagreLayoutArgs {
  nodes: DagreLayoutInputNode[];
  edges: DagreLayoutInputEdge[];
  rankdir: "TB" | "LR";
  nodesep: number;
  ranksep: number;
}

export interface DagreLayoutResult {
  positions: Record<string, { x: number; y: number }>;
  ms: number;
}

export function runDagreLayout(args: DagreLayoutArgs): DagreLayoutResult {
  const t0 = performance.now();
  const g = new graphlib.Graph({ directed: true });
  g.setGraph({
    rankdir: args.rankdir,
    nodesep: args.nodesep,
    ranksep: args.ranksep,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of args.nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  for (const e of args.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of g.nodes()) {
    const n = g.node(id) as { x: number; y: number; width: number; height: number };
    if (typeof n?.x === "number" && typeof n?.y === "number") {
      // dagre returns centres — translate to top-left.
      positions[id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 };
    }
  }

  return { positions, ms: performance.now() - t0 };
}
