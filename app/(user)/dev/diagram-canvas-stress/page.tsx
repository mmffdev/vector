"use client";

// PLA-0006 / 00277 — DiagramCanvas stress harness fixture.
//
// Mounts <DiagramCanvas> with a deterministic 3,000-node tree
// shaped after a typical large-org chart (Lloyds-class). The page
// exposes telemetry on window.__DIAGRAM_PERF__ so the playwright
// spec can assert against the performance contract:
//   • initial load  <1.5s (mount → first paint)
//   • drag FPS      ≥30 sustained
//   • rendered-set  <500   (00275 — collapse + virtualisation)
//   • subtree-layout <1s   (00275 — dagre worker)
//
// 00275 flipped both capabilities to true: virtualisation is built
// into paintStatic, and the dagre worker drives relayoutSubtree.
// The page exposes window.__DIAGRAM_HARNESS__ so the spec can drive
// a known node (drag FPS) and trigger relayout (subtree budget).

import { useEffect, useMemo, useRef, useState } from "react";
import { DiagramCanvas } from "@/app/components/diagram-canvas";
import type {
  DiagramCanvasHandle,
  DiagramEdge,
  DiagramNode,
} from "@/app/components/diagram-canvas";

const TARGET_NODES = 3000;
const NODE_W = 100;
const NODE_H = 40;
const COL_GAP = 30;
const ROW_GAP = 30;
const COLS_PER_ROW = 60;

interface FixtureGraph {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

// Deterministic tree — root + breadth-first children, each parent gets
// 4 children until we hit 3,000 nodes. Manual layout: grid in row-major
// order so the static paint has work to do across the whole viewport.
// 00275 lets the harness call relayoutSubtree() to run dagre over the
// same graph and assert against the <1s budget.
function buildFixture(): FixtureGraph {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const FAN = 4;

  for (let i = 0; i < TARGET_NODES; i++) {
    const col = i % COLS_PER_ROW;
    const row = Math.floor(i / COLS_PER_ROW);
    nodes.push({
      id: `n${i}`,
      x: col * (NODE_W + COL_GAP),
      y: row * (NODE_H + ROW_GAP),
      width: NODE_W,
      height: NODE_H,
    });
    if (i > 0) {
      const parent = Math.floor((i - 1) / FAN);
      edges.push({ id: `e${i}`, source: `n${parent}`, target: `n${i}` });
    }
  }
  return { nodes, edges };
}

declare global {
  interface Window {
    __DIAGRAM_PERF__?: {
      mountStart: number;
      firstPaintMs: number | null;
      dragSamples: number[];
      capabilities: {
        layoutWorker: boolean;
        virtualisation: boolean;
      };
      ready: boolean;
      lastSubtreeMs?: number;
    };
    __DIAGRAM_RENDERED_COUNT__?: number;
    __DIAGRAM_RENDERED_EDGES__?: number;
    __DIAGRAM_HARNESS__?: {
      relayoutSubtree: (rootId?: string) => Promise<number>;
      getNodeScreenCenter: (id: string) => { x: number; y: number } | null;
      zoomTo: (scale: number) => void;
      centerOn: (id: string) => void;
      getViewport: () => { x: number; y: number; scale: number } | null;
    };
  }
}

const TARGET_DRAG_NODE_ID = "n1530";

export default function DiagramCanvasStressPage() {
  const handleRef = useRef<DiagramCanvasHandle>(null);
  const { nodes, edges } = useMemo(() => buildFixture(), []);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [paintMs, setPaintMs] = useState<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    window.__DIAGRAM_PERF__ = {
      mountStart: start,
      firstPaintMs: null,
      dragSamples: [],
      capabilities: {
        layoutWorker: true,    // 00275 — dagre web worker shipped
        virtualisation: true,  // 00275 — paintStatic culls off-screen
      },
      ready: false,
    };

    window.__DIAGRAM_HARNESS__ = {
      relayoutSubtree: (rootId?: string) =>
        handleRef.current?.relayoutSubtree(rootId) ?? Promise.resolve(0),
      getNodeScreenCenter: (id: string) => {
        const n = nodesRef.current.find((x) => x.id === id);
        if (!n) return null;
        const root = document.querySelector(".diagram-canvas") as HTMLElement | null;
        if (!root || !handleRef.current) return null;
        const vp = handleRef.current.getViewport();
        const rect = root.getBoundingClientRect();
        const cx = (n.x + n.width / 2) * vp.scale + vp.x + rect.left;
        const cy = (n.y + n.height / 2) * vp.scale + vp.y + rect.top;
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
        return { x: cx, y: cy };
      },
      zoomTo: (scale: number) => {
        handleRef.current?.zoomTo(scale);
      },
      centerOn: (id: string) => {
        handleRef.current?.centerOn(id);
      },
      getViewport: () => handleRef.current?.getViewport() ?? null,
    };

    // Wait for the canvas to mount, paint, and run its auto-fitView
    // before declaring ready. fitView produces a non-identity viewport
    // (scale ≠ 1 for the 3,000-node fixture), which is the signal we
    // poll against. The first frame this becomes true is what we
    // record as `firstPaintMs`.
    let raf = 0;
    let cancelled = false;
    const checkReady = () => {
      if (cancelled) return;
      const handle = handleRef.current;
      if (!handle) {
        raf = requestAnimationFrame(checkReady);
        return;
      }
      const vp = handle.getViewport();
      if (vp.scale === 1 && vp.x === 0 && vp.y === 0) {
        raf = requestAnimationFrame(checkReady);
        return;
      }
      const ms = performance.now() - start;
      const perf = window.__DIAGRAM_PERF__!;
      perf.firstPaintMs = ms;
      perf.ready = true;
      setPaintMs(ms);
    };
    raf = requestAnimationFrame(checkReady);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.__DIAGRAM_HARNESS__ = undefined;
    };
  }, []);

  return (
    <main className="diagram-canvas-stress" data-testid="diagram-canvas-stress">
      <header className="diagram-canvas-stress__header">
        <span className="diagram-canvas-stress__metric">
          Nodes: {nodes.length.toLocaleString()}
        </span>
        <span className="diagram-canvas-stress__metric">
          Edges: {edges.length.toLocaleString()}
        </span>
        <span className="diagram-canvas-stress__metric">
          Drag target: {TARGET_DRAG_NODE_ID}
        </span>
        <span className="diagram-canvas-stress__metric" data-testid="paint-ms">
          First paint: {paintMs === null ? "…" : `${Math.round(paintMs)}ms`}
        </span>
      </header>
      <div className="diagram-canvas-stress__canvas">
        <DiagramCanvas
          ref={handleRef}
          name="stress_3000"
          nodes={nodes}
          edges={edges}
          gridSize={10}
          showGrid
          miniMap
          controls
        />
      </div>
    </main>
  );
}
