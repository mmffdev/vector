"use client";

/**
 * MapViewSugiyama — textbook Sugiyama layout, hand-rolled, no
 * external library. Reference: Sugiyama, Tagawa & Toda, 1981.
 *
 * Three passes:
 *   1. Layering — longest-path from sources gives each node its
 *      depth (column when drawn LR).
 *   2. Crossing reduction — barycenter sort within each layer,
 *      iterated until stable (cheap heuristic; not optimal).
 *   3. Coordinate assignment — uniform y stride per row, fixed x
 *      stride per column.
 *
 * Trade-off vs dagre/d3-dag: no dummy vertices for long edges, so
 * connectors are straight diagonals through "skipped" layers. Fine
 * for our shallow DAGs; doesn't scale to graphs where edges span
 * many ranks. The point of including this view is to show what
 * Sugiyama produces WITHOUT the library polish (bend routing,
 * coordinate optimisation, optimal crossing reduction).
 */

import { useMemo } from "react";
import { useElementWidth } from "./types";
import type { MapViewProps } from "./types";

const COL_W = 130;
const ROW_H = 56;
const PAD_X = 24;
const PAD_Y = 24;

export function MapViewSugiyama({ nodes, edges }: MapViewProps) {
  const [surfaceRef, containerW] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    const idSet = new Set(nodes.map((n) => n.id));
    const forward = edges.filter(
      (e) => e.kind !== "parallel" && idSet.has(e.from) && idSet.has(e.to),
    );

    // ── Pass 1: longest-path layering.
    const predecessors = new Map<string, string[]>();
    const successors = new Map<string, string[]>();
    forward.forEach((e) => {
      if (!predecessors.has(e.to)) predecessors.set(e.to, []);
      predecessors.get(e.to)!.push(e.from);
      if (!successors.has(e.from)) successors.set(e.from, []);
      successors.get(e.from)!.push(e.to);
    });
    const depth = new Map<string, number>();
    nodes.forEach((n) => depth.set(n.id, 0));
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false;
      for (const n of nodes) {
        const preds = predecessors.get(n.id);
        if (!preds || preds.length === 0) continue;
        const maxPred = Math.max(...preds.map((p) => depth.get(p) ?? 0));
        const next = maxPred + 1;
        if ((depth.get(n.id) ?? 0) < next) {
          depth.set(n.id, next);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // ── Pass 2: barycenter crossing reduction.
    const layers: string[][] = [];
    nodes.forEach((n) => {
      const d = depth.get(n.id) ?? 0;
      if (!layers[d]) layers[d] = [];
      layers[d].push(n.id);
    });
    layers.forEach((layer) => layer.sort());
    const position = (layer: string[]) =>
      new Map(layer.map((id, i) => [id, i] as const));
    const barycenter = (
      nodeId: string,
      neighbours: string[] | undefined,
      pos: Map<string, number>,
    ): number => {
      if (!neighbours || neighbours.length === 0) return pos.get(nodeId) ?? 0;
      const sum = neighbours.reduce((acc, n) => acc + (pos.get(n) ?? 0), 0);
      return sum / neighbours.length;
    };
    for (let iter = 0; iter < 12; iter++) {
      // Down sweep — order each layer by avg position of predecessors.
      for (let i = 1; i < layers.length; i++) {
        const prev = position(layers[i - 1]);
        layers[i].sort(
          (a, b) =>
            barycenter(a, predecessors.get(a), prev) -
            barycenter(b, predecessors.get(b), prev),
        );
      }
      // Up sweep — order each layer by avg position of successors.
      for (let i = layers.length - 2; i >= 0; i--) {
        const next = position(layers[i + 1]);
        layers[i].sort(
          (a, b) =>
            barycenter(a, successors.get(a), next) -
            barycenter(b, successors.get(b), next),
        );
      }
    }

    // ── Pass 3: coordinate assignment.
    const positions = new Map<string, { x: number; y: number }>();
    layers.forEach((layer, col) => {
      layer.forEach((id, row) => {
        positions.set(id, {
          x: PAD_X + col * COL_W + COL_W / 2,
          y: PAD_Y + row * ROW_H + ROW_H / 2,
        });
      });
    });

    const cols = layers.length;
    const maxRows = layers.reduce((m, l) => Math.max(m, l?.length ?? 0), 1);
    return {
      positions,
      forward,
      w: PAD_X * 2 + cols * COL_W,
      h: PAD_Y * 2 + maxRows * ROW_H,
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
    <div
      ref={surfaceRef}
      className="dependency-map__MapSurface"
      role="region"
      aria-label="Hand-rolled Sugiyama layered DAG layout"
    >
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
          {layout.forward.map((e) => {
            const from = layout.positions.get(e.from);
            const to = layout.positions.get(e.to);
            if (!from || !to) return null;
            return (
              <line
                key={`${e.from}|${e.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={`dependency-map__MapConnector dependency-map__MapConnector--${e.kind}`}
              />
            );
          })}
        </svg>
        {nodes.map((n) => {
          const p = layout.positions.get(n.id);
          if (!p) return null;
          return (
            <div
              key={n.id}
              className="dependency-map__MapNode"
              style={{ left: `${p.x}px`, top: `${p.y}px` }}
              title={`${n.formattedId} ${n.title}`}
            >
              {n.formattedId}
            </div>
          );
        })}
      </div>
    </div>
  );
}
