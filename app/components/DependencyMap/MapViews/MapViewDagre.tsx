"use client";

/**
 * MapViewDagre — Sugiyama-style layered DAG layout via the dagre
 * library (https://github.com/dagrejs/dagre).
 *
 * Dagre handles longest-path layering, dummy-vertex insertion,
 * barycenter crossing reduction, and coordinate assignment. We feed
 * it our forward edges (parallel skipped — no precedence) and render
 * the positions it returns. Rankdir `LR` so chains read left-to-right,
 * matching the editor's "Requires First → … → Unlocks Next" mental
 * model.
 */

import { useMemo } from "react";
import dagre from "dagre";
import { useElementWidth } from "./types";
import type { MapViewProps } from "./types";

const NODE_W = 110;
const NODE_H = 32;
const RANKSEP = 80;
const NODESEP = 24;
const PAD = 24;

export function MapViewDagre({ nodes, edges }: MapViewProps) {
  const [surfaceRef, containerW] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
      ranksep: RANKSEP,
      nodesep: NODESEP,
      marginx: PAD,
      marginy: PAD,
    });
    g.setDefaultEdgeLabel(() => ({}));
    nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
    edges.forEach((e) => {
      if (e.kind === "parallel") return;
      if (!g.hasNode(e.from) || !g.hasNode(e.to)) return;
      g.setEdge(e.from, e.to, { kind: e.kind });
    });
    dagre.layout(g);
    const w = g.graph().width ?? 0;
    const h = g.graph().height ?? 0;
    const ns = nodes.map((n) => {
      const node = g.node(n.id);
      return { ...n, x: node.x, y: node.y };
    });
    const es = edges
      .filter((e) => e.kind !== "parallel")
      .map((e) => {
        const edge = g.edge(e.from, e.to);
        return { ...e, points: edge?.points ?? [] };
      });
    return { w, h, nodes: ns, edges: es };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className="dependency-map__MapSurface">
        <p className="dependency-map__MapEmpty">
          No relationships found in this topology yet.
        </p>
      </div>
    );
  }
  if (!layout) return null;

  // Fit width when the layout is narrower than the container; allow
  // horizontal scroll if it's wider.
  const renderW = Math.max(layout.w, containerW || layout.w);
  const renderH = layout.h;

  return (
    <div ref={surfaceRef} className="dependency-map__MapSurface" role="region" aria-label="Dagre DAG layout">
      <div
        className="dependency-map__MapInner"
        style={{ width: `${renderW}px`, height: `${renderH}px` }}
      >
        <svg
          className="dependency-map__MapConnectors"
          width={renderW}
          height={renderH}
          viewBox={`0 0 ${renderW} ${renderH}`}
          aria-hidden="true"
        >
          {layout.edges.map((e) => {
            const pts = e.points;
            if (pts.length < 2) return null;
            const d = pts
              .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
              .join(" ");
            return (
              <path
                key={`${e.from}|${e.to}`}
                d={d}
                fill="none"
                className={`dependency-map__MapConnector dependency-map__MapConnector--${e.kind}`}
              />
            );
          })}
        </svg>
        {layout.nodes.map((n) => (
          <div
            key={n.id}
            className="dependency-map__MapNode"
            style={{ left: `${n.x}px`, top: `${n.y}px` }}
            title={`${n.formattedId} ${n.title}`}
          >
            {n.formattedId}
          </div>
        ))}
      </div>
    </div>
  );
}
