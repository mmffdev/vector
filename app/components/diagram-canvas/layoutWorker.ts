// PLA-0006 / 00275 — dagre layout Web Worker.
//
// Runs dagre off the main thread so 3,000-node relayouts don't stall
// pointer events or rAF. The worker is stateless: each message contains
// the full subgraph to lay out, plus the rankdir/spacing knobs from
// LayoutMode. Result is a positions map keyed by node id, in top-left
// coords (dagre stores centres; we translate before posting back).
//
// Wire shape — request:
//   { type: "layout", reqId, nodes:[{id,width,height}], edges:[{source,target}],
//     rankdir, nodesep, ranksep }
// — response:
//   { type: "layout:done", reqId, positions: Record<id,{x,y}>, ms }
//
// The hook on the main thread (useDagreLayoutWorker) pairs reqId so
// stale replies get dropped without state churn.

import { graphlib, layout } from "dagre";

interface LayoutRequestNode {
  id: string;
  width: number;
  height: number;
}

interface LayoutRequestEdge {
  source: string;
  target: string;
}

interface LayoutRequest {
  type: "layout";
  reqId: number;
  nodes: LayoutRequestNode[];
  edges: LayoutRequestEdge[];
  rankdir: "TB" | "LR";
  nodesep: number;
  ranksep: number;
}

interface LayoutResponse {
  type: "layout:done";
  reqId: number;
  positions: Record<string, { x: number; y: number }>;
  ms: number;
}

type IncomingMessage = LayoutRequest;

self.addEventListener("message", (evt: MessageEvent<IncomingMessage>) => {
  const msg = evt.data;
  if (!msg || msg.type !== "layout") return;

  const t0 = performance.now();
  const g = new graphlib.Graph({ directed: true });
  g.setGraph({
    rankdir: msg.rankdir,
    nodesep: msg.nodesep,
    ranksep: msg.ranksep,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of msg.nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  for (const e of msg.edges) {
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

  const out: LayoutResponse = {
    type: "layout:done",
    reqId: msg.reqId,
    positions,
    ms: performance.now() - t0,
  };
  (self as unknown as Worker).postMessage(out);
});

export {};
