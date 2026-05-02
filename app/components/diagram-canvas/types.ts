// PLA-0006 / 00274 — DiagramCanvas primitive types.
//
// World coordinates are unbounded floats. Node x/y is the top-left in
// world space; viewport transforms world → screen. dagre (00275) writes
// into x/y; snap-to-grid (00276) rounds them to gridSize.

export interface DiagramNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: unknown;
  hidden?: boolean;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  hidden?: boolean;
}

export interface RenderNodeContext {
  ctx: CanvasRenderingContext2D;
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
  scale: number;
}

export type RenderNodeFn = (node: DiagramNode, rc: RenderNodeContext) => void;

export type EdgeStyle = "orthogonal" | "bezier";
export type LayoutMode =
  | "auto-horizontal"
  | "auto-vertical"
  | "auto-radial"
  | "manual";

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface DiagramCanvasHandle {
  fitView: (opts?: { padding?: number }) => void;
  zoomTo: (scale: number) => void;
  centerOn: (nodeId: string) => void;
  getViewport: () => Viewport;
}

export interface DiagramCanvasProps {
  name: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  renderNode?: RenderNodeFn;
  edgeStyle?: EdgeStyle;
  layoutMode?: LayoutMode;
  gridSize?: number;
  showGrid?: boolean;
  miniMap?: boolean;
  controls?: boolean;
  onNodeDragStop?: (nodeId: string, x: number, y: number) => void;
  onNodeSelect?: (nodeId: string | null) => void;
  onDropTarget?: (sourceId: string, targetId: string) => boolean | void;
  className?: string;
}
