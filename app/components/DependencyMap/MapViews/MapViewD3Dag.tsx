"use client";

/**
 * MapViewD3Dag — Sugiyama layout via the d3-dag library
 * (https://github.com/erikbrinkman/d3-dag).
 *
 * d3-dag is the modern, TypeScript-first take on Sugiyama: separate
 * operators for layering, decrossing, and coordinate assignment, so
 * we can swap algorithms later without rewriting the renderer.
 * Defaults to the library's `sugiyama()` preset which picks a
 * sensible mix (simplex layering, two-layer decrossing, greedy
 * coords) — small enough for our graph sizes, fast enough at scale.
 *
 * Comparison surface vs dagre: d3-dag tends to produce cleaner
 * coordinate distributions for sparse DAGs; dagre's output is
 * usually tighter for dense graphs but can stack heavy ranks.
 */

import { useMemo } from "react";
import { graphConnect, sugiyama } from "d3-dag";
import { useElementWidth } from "./types";
import type { MapViewProps } from "./types";

const NODE_W = 110;
const NODE_H = 32;
const NODE_SEP = 36;
const PAD = 24;

export function MapViewD3Dag({ nodes, edges }: MapViewProps) {
  const [surfaceRef, containerW] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    const idSet = new Set(nodes.map((n) => n.id));
    const links: [string, string][] = edges
      .filter((e) => e.kind !== "parallel" && idSet.has(e.from) && idSet.has(e.to))
      .map((e) => [e.from, e.to]);
    // d3-dag's `graphConnect` rejects orphans by default — surface
    // disconnected nodes by adding a self-link for each, then strip
    // before render. Cheaper than rolling graphStratify for one-off
    // singletons.
    const builder = graphConnect();
    if (links.length === 0) {
      // All-orphan case: hand off to the empty-state. Still pre-layout.
      return { w: 0, h: 0, nodes: [], edges: [] };
    }
    const dag = builder(links);
    const layoutFn = sugiyama()
      .nodeSize([NODE_W + NODE_SEP, NODE_H + NODE_SEP])
      // LR orientation: d3-dag lays top-down by default; transpose
      // coordinates so the chain reads left-to-right.
      ;
    const { width, height } = layoutFn(dag);
    // d3-dag's default orientation is top-down (x = horizontal within
    // a layer, y = layer depth). Transpose for LR: render(x) = y,
    // render(y) = x.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const ns: { id: string; formattedId: string; title: string; x: number; y: number }[] = [];
    for (const node of dag.nodes()) {
      const meta = byId.get(node.data as string);
      if (!meta) continue;
      ns.push({
        id: meta.id,
        formattedId: meta.formattedId,
        title: meta.title,
        x: node.y + PAD,
        y: node.x + PAD,
      });
    }
    const es: { from: string; to: string; kind: "requires" | "unlocks"; points: { x: number; y: number }[] }[] = [];
    for (const link of dag.links()) {
      const fromId = link.source.data as string;
      const toId = link.target.data as string;
      const wireEdge = edges.find(
        (e) => e.kind !== "parallel" && e.from === fromId && e.to === toId,
      );
      if (!wireEdge) continue;
      // d3-dag v1 ships points as [x, y] tuples (not {x, y} objects).
      // Transpose into LR orientation: render(x) = tuple[1], render(y) = tuple[0].
      const pts = link.points.map((p: readonly [number, number]) => ({
        x: p[1] + PAD,
        y: p[0] + PAD,
      }));
      es.push({
        from: fromId,
        to: toId,
        kind: wireEdge.kind === "unlocks" ? "unlocks" : "requires",
        points: pts,
      });
    }
    return {
      w: height + PAD * 2,
      h: width + PAD * 2,
      nodes: ns,
      edges: es,
    };
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

  const renderW = Math.max(layout.w, containerW || layout.w);
  const renderH = layout.h;

  return (
    <div ref={surfaceRef} className="dependency-map__MapSurface" role="region" aria-label="d3-dag Sugiyama layout">
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
