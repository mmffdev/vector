"use client";

// PLA-0006 / 00277 — DiagramCanvas stress harness fixture.
//
// Mounts <DiagramCanvas> with a deterministic 3,000-node tree
// shaped after a typical large-org chart (Lloyds-class). The page
// exposes telemetry on window.__DIAGRAM_PERF__ so the playwright
// spec can assert against the performance contract:
//   • initial load  <1.5s (mount → first paint)
//   • drag FPS      ≥30 sustained
//   • rendered-set  <500   (00275 — collapse + virtualisation; skipped here)
//   • subtree-layout <1s   (00275 — dagre worker; skipped here)
//
// The harness runs whatever it can today and gates the rest behind
// `harness.capabilities` so the spec auto-skips assertions that
// depend on the not-yet-shipped layout/virtualisation work.

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
// 00275 will replace this with a dagre tree layout.
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
    };
  }
}

export default function DiagramCanvasStressPage() {
  const handleRef = useRef<DiagramCanvasHandle>(null);
  const { nodes, edges } = useMemo(() => buildFixture(), []);
  const [paintMs, setPaintMs] = useState<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    window.__DIAGRAM_PERF__ = {
      mountStart: start,
      firstPaintMs: null,
      dragSamples: [],
      capabilities: {
        layoutWorker: false,    // 00275
        virtualisation: false,  // 00275
      },
      ready: false,
    };

    // Two rAF ticks: first for mount → React commit, second for the
    // canvas paint pass to actually run. After that we read the wall
    // clock and consider the canvas "loaded".
    let firstRaf = 0;
    let secondRaf = 0;
    firstRaf = requestAnimationFrame(() => {
      secondRaf = requestAnimationFrame(() => {
        const ms = performance.now() - start;
        const perf = window.__DIAGRAM_PERF__!;
        perf.firstPaintMs = ms;
        perf.ready = true;
        setPaintMs(ms);
      });
    });
    return () => {
      cancelAnimationFrame(firstRaf);
      cancelAnimationFrame(secondRaf);
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
