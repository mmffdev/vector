// PLA-0006 / 00274 — DiagramCanvas pure draw + geometry helpers.
//
// Everything here is side-effect-free given a context — no React, no
// state. The component layer composes these into static + overlay
// passes. Snap-to-grid (00276) and dagre layout (00275) compose at the
// data layer; this file just paints what it's given.

import type { DiagramEdge, DiagramNode, RenderNodeFn, Viewport } from "./types";

export interface ViewportSize {
  width: number;
  height: number;
}

export function worldToScreen(x: number, y: number, vp: Viewport): { x: number; y: number } {
  return { x: x * vp.scale + vp.x, y: y * vp.scale + vp.y };
}

export function screenToWorld(x: number, y: number, vp: Viewport): { x: number; y: number } {
  return { x: (x - vp.x) / vp.scale, y: (y - vp.y) / vp.scale };
}

export function pointInNode(node: DiagramNode, wx: number, wy: number): boolean {
  return wx >= node.x && wx <= node.x + node.width && wy >= node.y && wy <= node.y + node.height;
}

export function hitTest(nodes: DiagramNode[], wx: number, wy: number): DiagramNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.hidden) continue;
    if (pointInNode(n, wx, wy)) return n;
  }
  return null;
}

export function nodesBounds(nodes: DiagramNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const n of nodes) {
    if (n.hidden) continue;
    any = true;
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  if (!any) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Read a CSS variable from the canvas element so we follow the active
// theme without hardcoding hex. Falls back to neutral values if unset.
export function readThemeColors(el: HTMLElement): {
  ink: string;
  inkMuted: string;
  surface: string;
  line: string;
  accent: string;
  accentInk: string;
} {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => {
    const raw = cs.getPropertyValue(name).trim();
    return raw || fallback;
  };
  return {
    ink: v("--ink-1", "#1A1A1A"),
    inkMuted: v("--ink-2", "#5C5C5C"),
    surface: v("--surface", "#FFFFFF"),
    line: v("--line-1", "#D8D5CF"),
    accent: v("--accent", "#1A1A1A"),
    accentInk: v("--accent-ink", "#FFFFFF"),
  };
}

// Dotted grid background. Drawn in screen space — we walk world-space
// gridSize intersections and project. Skips draws when scale is so low
// the dots would visually overlap.
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  size: ViewportSize,
  vp: Viewport,
  gridSize: number,
  color: string,
): void {
  const stepScreen = gridSize * vp.scale;
  if (stepScreen < 6) return;
  const startWX = Math.floor(-vp.x / vp.scale / gridSize) * gridSize;
  const startWY = Math.floor(-vp.y / vp.scale / gridSize) * gridSize;
  const endWX = startWX + size.width / vp.scale + gridSize;
  const endWY = startWY + size.height / vp.scale + gridSize;
  ctx.save();
  ctx.fillStyle = color;
  for (let wx = startWX; wx <= endWX; wx += gridSize) {
    for (let wy = startWY; wy <= endWY; wy += gridSize) {
      const sx = wx * vp.scale + vp.x;
      const sy = wy * vp.scale + vp.y;
      ctx.fillRect(sx - 0.5, sy - 0.5, 1, 1);
    }
  }
  ctx.restore();
}

// Default node renderer when consumers don't supply one. Solid-fill
// rectangle with a 1px border and the node id centred. The consumer-
// supplied renderNode replaces this entirely.
export const defaultRenderNode: RenderNodeFn = (node, rc) => {
  const { ctx, selected, hovered, dragging } = rc;
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = selected || dragging ? "#1A1A1A" : hovered ? "#5C5C5C" : "#D8D5CF";
  ctx.lineWidth = selected || dragging ? 2 : 1;
  ctx.fillRect(node.x, node.y, node.width, node.height);
  ctx.strokeRect(node.x, node.y, node.width, node.height);
  ctx.fillStyle = "#1A1A1A";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(node.id, node.x + node.width / 2, node.y + node.height / 2);
  ctx.restore();
};

// Orthogonal edge route — rectilinear "elbow" between source bottom-
// centre and target top-centre. Phase 1 only deals with parent-child
// trees so this geometry is sufficient; bezier is Phase 2.
export function drawOrthogonalEdge(
  ctx: CanvasRenderingContext2D,
  from: DiagramNode,
  to: DiagramNode,
  color: string,
): void {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const midY = y1 + (y2 - y1) / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1, midY);
  ctx.lineTo(x2, midY);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

// Bezier — Phase 2 stub. Wired so consumers can opt in via edgeStyle
// even though Phase 1 only ships orthogonal. Renders as a simple cubic
// between the same anchor points.
export function drawBezierEdge(
  ctx: CanvasRenderingContext2D,
  from: DiagramNode,
  to: DiagramNode,
  color: string,
): void {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const dy = Math.max(40, Math.abs(y2 - y1) / 2);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(x1, y1 + dy, x2, y2 - dy, x2, y2);
  ctx.stroke();
  ctx.restore();
}

// Viewport-space culling. Returns true if any part of the world-space
// rect (x,y,w,h) overlaps the visible canvas. A small padding keeps
// edges that connect to just-off-screen nodes from popping at the
// border.
export function isNodeVisible(
  node: DiagramNode,
  size: ViewportSize,
  vp: Viewport,
  pad = 32,
): boolean {
  const sx = node.x * vp.scale + vp.x;
  const sy = node.y * vp.scale + vp.y;
  const sw = node.width * vp.scale;
  const sh = node.height * vp.scale;
  return (
    sx + sw + pad >= 0 &&
    sy + sh + pad >= 0 &&
    sx - pad <= size.width &&
    sy - pad <= size.height
  );
}

// Top-level static-layer paint: grid → edges → nodes. Caller is
// responsible for the DPR transform and the world transform; this
// function paints in world coordinates after the caller has applied
// them. Returns counts so the harness/dev tools can verify
// virtualisation is doing its job.
export function paintStatic(args: {
  ctx: CanvasRenderingContext2D;
  size: ViewportSize;
  vp: Viewport;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  nodeIndex: Map<string, DiagramNode>;
  renderNode: RenderNodeFn;
  edgeStyle: "orthogonal" | "bezier";
  gridSize: number;
  showGrid: boolean;
  colors: ReturnType<typeof readThemeColors>;
  selectedId: string | null;
  hoveredId: string | null;
  draggingId: string | null;
}): { nodes: number; edges: number } {
  const {
    ctx,
    size,
    vp,
    nodes,
    edges,
    nodeIndex,
    renderNode,
    edgeStyle,
    gridSize,
    showGrid,
    colors,
    selectedId,
    hoveredId,
    draggingId,
  } = args;

  ctx.clearRect(0, 0, size.width, size.height);

  if (showGrid) {
    drawGrid(ctx, size, vp, gridSize, colors.line);
  }

  ctx.save();
  ctx.translate(vp.x, vp.y);
  ctx.scale(vp.scale, vp.scale);

  let edgeCount = 0;
  for (const e of edges) {
    if (e.hidden) continue;
    const from = nodeIndex.get(e.source);
    const to = nodeIndex.get(e.target);
    if (!from || !to) continue;
    if (from.hidden || to.hidden) continue;
    if (!isNodeVisible(from, size, vp) && !isNodeVisible(to, size, vp)) continue;
    if (edgeStyle === "bezier") {
      drawBezierEdge(ctx, from, to, colors.inkMuted);
    } else {
      drawOrthogonalEdge(ctx, from, to, colors.inkMuted);
    }
    edgeCount++;
  }

  let nodeCount = 0;
  for (const n of nodes) {
    if (n.hidden) continue;
    if (!isNodeVisible(n, size, vp)) continue;
    renderNode(n, {
      ctx,
      selected: n.id === selectedId,
      hovered: n.id === hoveredId,
      dragging: n.id === draggingId,
      scale: vp.scale,
    });
    nodeCount++;
  }

  ctx.restore();
  return { nodes: nodeCount, edges: edgeCount };
}
