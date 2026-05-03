// PLA-0006 / 00275 — dagre layout Web Worker.
//
// Runs dagre off the main thread so 3,000-node relayouts don't stall
// pointer events or rAF. The worker is stateless: each message contains
// the full subgraph to lay out, plus the rankdir/spacing knobs from
// LayoutMode.
//
// Wire shape — request:
//   { type: "layout", reqId, nodes:[{id,width,height}], edges:[{source,target}],
//     rankdir, nodesep, ranksep }
// — response:
//   { type: "layout:done", reqId, positions: Record<id,{x,y}>, ms }
//
// The hook on the main thread (useDagreLayoutWorker) pairs reqId so
// stale replies get dropped without state churn. Actual dagre call
// lives in runDagreLayout.ts so the hook can fall back to running it
// in-thread when the worker can't be constructed (Turbopack dev mode).

import { runDagreLayout } from "./runDagreLayout";

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

  const { positions, ms } = runDagreLayout({
    nodes: msg.nodes,
    edges: msg.edges,
    rankdir: msg.rankdir,
    nodesep: msg.nodesep,
    ranksep: msg.ranksep,
  });

  const out: LayoutResponse = {
    type: "layout:done",
    reqId: msg.reqId,
    positions,
    ms,
  };
  (self as unknown as Worker).postMessage(out);
});

export {};
