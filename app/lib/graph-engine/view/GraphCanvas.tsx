"use client";

// GraphCanvas — public entry point of the graph engine for callers.
// Takes a Graph, runs the named layout, and renders nodes + edges with
// the DOM view. Static by default; interactions are flag-gated and live
// in their own files (Story 3).
//
// One stylesheet import keeps engine styles out of globals.css.

import { useMemo } from "react";
import type { Graph, InteractionConfig } from "../types";
import { layoutByName } from "../layout";
import Node from "./Node";
import Edges from "./Edges";
import "../graph-engine.css";

const DEFAULT_INTERACTIONS: InteractionConfig = {
  drag: false,
  hoverHighlight: false,
};

interface GraphCanvasProps {
  graph: Graph;
  ariaLabel?: string;
}

export default function GraphCanvas({ graph, ariaLabel }: GraphCanvasProps) {
  const laid = useMemo(() => layoutByName(graph), [graph]);
  const interactions: InteractionConfig = {
    ...DEFAULT_INTERACTIONS,
    ...(graph.interactions ?? {}),
  };

  if (laid.nodes.length === 0) {
    return <div className="ge-canvas ge-canvas--empty">No nodes to draw.</div>;
  }

  return (
    <div
      className="ge-canvas"
      style={{ width: laid.width, height: laid.height }}
      role="img"
      aria-label={ariaLabel ?? "Graph"}
      data-drag={interactions.drag ? "on" : "off"}
      data-hover={interactions.hoverHighlight ? "on" : "off"}
    >
      <div className="ge-nodes">
        {laid.nodes.map((n) => (
          <Node key={n.id} node={n} />
        ))}
      </div>
      <Edges width={laid.width} height={laid.height} edges={laid.edges} />
    </div>
  );
}
