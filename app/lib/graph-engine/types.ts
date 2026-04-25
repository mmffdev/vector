// Graph engine — pure data types. No React, no DOM, no SVG.
//
// The engine separates three concerns:
//   1. Graph        — the input: nodes + edges, plus hints (layout, view).
//   2. Layout       — a function that takes a Graph and returns a LaidOutGraph
//                     (every node has x/y/w/h; every edge has a routed path).
//   3. View         — renderer (DOM today, SVG/canvas later).
//
// Interactions (drag, hover) are layered on top of the view and read from
// the same LaidOutGraph. They are flag-gated; static graphs ignore them.

export type GraphLayoutName = "hierarchy";
export type GraphViewName = "dom";

export interface GraphNode {
  id: string;
  label: string;
  // Free-form bag for view/layout hints. The hierarchy layout reads
  // `depth` and `parentId`; views read whatever class/role hints they need.
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string; // GraphNode.id
  to: string;   // GraphNode.id
  // Free-form bag — e.g. { kind: "story" } for the red-dashed style.
  data?: Record<string, unknown>;
}

export interface InteractionConfig {
  drag: boolean;
  hoverHighlight: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: GraphLayoutName;
  view: GraphViewName;
  interactions?: Partial<InteractionConfig>;
  // Layout-specific options. The hierarchy layout reads `levels` (label +
  // fanout per row) when nodes/edges are not pre-built.
  options?: Record<string, unknown>;
}

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

// Routed edge — `path` is an SVG path-data string. The DOM view renders
// edges as a single SVG overlay on top of the absolutely-positioned node
// divs, so a precomputed path keeps the view dumb.
export interface LaidOutEdge extends GraphEdge {
  path: string;
  // Anchors for animation / interaction handles.
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface LaidOutGraph {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

export type LayoutFn = (g: Graph) => LaidOutGraph;
