"use client";

// PLA-0006 / 00274 — DiagramCanvas primitive (Phase 1).
//
// Two-layer Canvas2D renderer:
//   • static layer  → grid + edges + nodes; only redraws when data,
//                     viewport, or theme changes (dirty flag).
//   • overlay layer → hover/select/drag affordances; cheap to repaint
//                     each rAF tick during interaction.
//
// 00274 ships pan-by-drag-on-empty and trackpad-wheel zoom inline so
// the primitive works on its own. 00275 will replace those with d3-zoom
// + a Web Worker dagre layout. 00276 will turn the gridSize prop into
// behaviour (commit-rounded snap).
//
// Addressable substrate: registers as
// `samantha._viewport.<slot>._diagram_canvas.<name>` via the substrate
// hook. Consumers pass `name` (snake_case) — the same shape Panel uses.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import {
  defaultRenderNode,
  hitTest,
  nodesBounds,
  paintStatic,
  readThemeColors,
  screenToWorld,
  type ViewportSize,
} from "./render";
import type {
  DiagramCanvasHandle,
  DiagramCanvasProps,
  DiagramNode,
  Viewport,
} from "./types";
import MiniMap from "./MiniMap";
import Controls from "./Controls";

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
const DRAG_COMMIT_DEBOUNCE_MS = 120;

interface DragState {
  nodeId: string;
  // Pointer offset from node origin in world coords — keeps the grab
  // point stable while dragging.
  offsetX: number;
  offsetY: number;
  // The position when drag started, for the cancel/escape path.
  startX: number;
  startY: number;
  // Live world position the overlay reads each frame.
  liveX: number;
  liveY: number;
  moved: boolean;
}

interface PanState {
  startVpX: number;
  startVpY: number;
  startSx: number;
  startSy: number;
}

const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(function DiagramCanvas(
  {
    name,
    nodes,
    edges,
    renderNode,
    edgeStyle = "orthogonal",
    gridSize = 10,
    showGrid = true,
    miniMap: miniMapEnabled = true,
    controls: controlsEnabled = true,
    onNodeDragStop,
    onNodeSelect,
    onDropTarget,
    className,
  },
  ref,
) {
  const { address, addressable_id, Provider } = useRegisterAddressable({
    kind: "diagram_canvas",
    name,
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const viewportRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const [, forceRender] = useState(0);
  const bumpRender = useCallback(() => forceRender((n) => n + 1), []);

  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const dirtyRef = useRef<boolean>(true);
  const overlayDirtyRef = useRef<boolean>(true);
  const commitTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Stable node index keyed by id — used by the static painter for edge
  // endpoints and by hit-test results to look up live drag positions.
  const nodeIndex = useMemo(() => {
    const m = new Map<string, DiagramNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const renderFn = renderNode ?? defaultRenderNode;

  // Resize observer on the root container — drives both canvas backing
  // store sizes and triggers a static repaint.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const w = Math.floor(e.contentRect.width);
      const h = Math.floor(e.contentRect.height);
      if (w > 0 && h > 0) {
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // Apply DPR-aware backing-store sizing whenever logical size changes.
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const cv of [staticCanvasRef.current, overlayCanvasRef.current]) {
      if (!cv) continue;
      cv.width = Math.max(1, size.width * dpr);
      cv.height = Math.max(1, size.height * dpr);
      const ctx = cv.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    dirtyRef.current = true;
    overlayDirtyRef.current = true;
  }, [size]);

  // Mark static dirty whenever inputs change.
  useEffect(() => {
    dirtyRef.current = true;
    overlayDirtyRef.current = true;
  }, [nodes, edges, renderFn, edgeStyle, gridSize, showGrid]);

  // Single rAF loop driving both layers.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const root = rootRef.current;
      const sCv = staticCanvasRef.current;
      const oCv = overlayCanvasRef.current;
      if (root && sCv && oCv && size.width > 0 && size.height > 0) {
        const colors = readThemeColors(root);
        const drag = dragRef.current;

        if (dirtyRef.current) {
          const ctx = sCv.getContext("2d");
          if (ctx) {
            // While dragging, render the dragged node at its live
            // position so the static layer stays consistent.
            const effectiveNodes =
              drag !== null
                ? nodes.map((n) =>
                    n.id === drag.nodeId ? { ...n, x: drag.liveX, y: drag.liveY } : n,
                  )
                : nodes;
            const effectiveIndex =
              drag !== null
                ? new Map(effectiveNodes.map((n) => [n.id, n] as const))
                : nodeIndex;
            paintStatic({
              ctx,
              size,
              vp: viewportRef.current,
              nodes: effectiveNodes,
              edges,
              nodeIndex: effectiveIndex,
              renderNode: renderFn,
              edgeStyle,
              gridSize,
              showGrid,
              colors,
              selectedId,
              hoveredId,
              draggingId: drag?.nodeId ?? null,
            });
          }
          dirtyRef.current = false;
        }

        if (overlayDirtyRef.current) {
          const ctx = oCv.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, size.width, size.height);
            // Selection ring drawn in screen space so 2px lines stay
            // crisp regardless of zoom.
            const targetId = drag?.nodeId ?? selectedId;
            if (targetId) {
              const baseNode = nodeIndex.get(targetId);
              if (baseNode) {
                const wx = drag ? drag.liveX : baseNode.x;
                const wy = drag ? drag.liveY : baseNode.y;
                const vp = viewportRef.current;
                const sx = wx * vp.scale + vp.x;
                const sy = wy * vp.scale + vp.y;
                ctx.save();
                ctx.strokeStyle = colors.accent;
                ctx.lineWidth = 2;
                ctx.strokeRect(
                  sx - 1,
                  sy - 1,
                  baseNode.width * vp.scale + 2,
                  baseNode.height * vp.scale + 2,
                );
                ctx.restore();
              }
            }
          }
          overlayDirtyRef.current = false;
        }
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [
    nodes,
    edges,
    nodeIndex,
    renderFn,
    edgeStyle,
    gridSize,
    showGrid,
    size,
    selectedId,
    hoveredId,
  ]);

  // ─────────────────────────────────────────────────────────────────
  // Imperative API
  // ─────────────────────────────────────────────────────────────────

  const fitView = useCallback(
    (opts?: { padding?: number }) => {
      const padding = opts?.padding ?? 32;
      const bounds = nodesBounds(nodes);
      if (!bounds || size.width === 0 || size.height === 0) return;
      const innerW = Math.max(1, size.width - padding * 2);
      const innerH = Math.max(1, size.height - padding * 2);
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min(innerW / bounds.width, innerH / bounds.height)),
      );
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      viewportRef.current = {
        scale,
        x: size.width / 2 - cx * scale,
        y: size.height / 2 - cy * scale,
      };
      dirtyRef.current = true;
      overlayDirtyRef.current = true;
      bumpRender();
    },
    [nodes, size, bumpRender],
  );

  const zoomTo = useCallback(
    (scale: number) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      const vp = viewportRef.current;
      const cx = size.width / 2;
      const cy = size.height / 2;
      const wx = (cx - vp.x) / vp.scale;
      const wy = (cy - vp.y) / vp.scale;
      viewportRef.current = {
        scale: next,
        x: cx - wx * next,
        y: cy - wy * next,
      };
      dirtyRef.current = true;
      overlayDirtyRef.current = true;
      bumpRender();
    },
    [size, bumpRender],
  );

  const centerOn = useCallback(
    (nodeId: string) => {
      const n = nodeIndex.get(nodeId);
      if (!n) return;
      const vp = viewportRef.current;
      const cx = n.x + n.width / 2;
      const cy = n.y + n.height / 2;
      viewportRef.current = {
        scale: vp.scale,
        x: size.width / 2 - cx * vp.scale,
        y: size.height / 2 - cy * vp.scale,
      };
      dirtyRef.current = true;
      overlayDirtyRef.current = true;
      bumpRender();
    },
    [nodeIndex, size, bumpRender],
  );

  useImperativeHandle(
    ref,
    (): DiagramCanvasHandle => ({
      fitView,
      zoomTo,
      centerOn,
      getViewport: () => ({ ...viewportRef.current }),
    }),
    [fitView, zoomTo, centerOn],
  );

  // First-paint fitView once we have nodes and a measured viewport.
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    if (size.width === 0 || size.height === 0) return;
    if (nodes.length === 0) return;
    fitView();
    didFitRef.current = true;
  }, [size, nodes.length, fitView]);

  // ─────────────────────────────────────────────────────────────────
  // Pointer handling
  // ─────────────────────────────────────────────────────────────────

  const localPointer = useCallback((evt: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return { sx: 0, sy: 0 };
    const rect = root.getBoundingClientRect();
    return { sx: evt.clientX - rect.left, sy: evt.clientY - rect.top };
  }, []);

  const onPointerDown = (evt: React.PointerEvent<HTMLDivElement>) => {
    if (evt.button !== 0) return;
    const { sx, sy } = localPointer(evt);
    const vp = viewportRef.current;
    const { x: wx, y: wy } = screenToWorld(sx, sy, vp);
    const hit = hitTest(nodes, wx, wy);
    rootRef.current?.setPointerCapture(evt.pointerId);
    if (hit) {
      const offsetX = wx - hit.x;
      const offsetY = wy - hit.y;
      dragRef.current = {
        nodeId: hit.id,
        offsetX,
        offsetY,
        startX: hit.x,
        startY: hit.y,
        liveX: hit.x,
        liveY: hit.y,
        moved: false,
      };
      setSelectedId(hit.id);
      onNodeSelect?.(hit.id);
      dirtyRef.current = true;
      overlayDirtyRef.current = true;
    } else {
      panRef.current = { startVpX: vp.x, startVpY: vp.y, startSx: sx, startSy: sy };
      if (selectedId !== null) {
        setSelectedId(null);
        onNodeSelect?.(null);
        overlayDirtyRef.current = true;
      }
    }
  };

  const onPointerMove = (evt: React.PointerEvent<HTMLDivElement>) => {
    const { sx, sy } = localPointer(evt);
    const vp = viewportRef.current;

    const drag = dragRef.current;
    if (drag) {
      const { x: wx, y: wy } = screenToWorld(sx, sy, vp);
      drag.liveX = wx - drag.offsetX;
      drag.liveY = wy - drag.offsetY;
      drag.moved = true;
      dirtyRef.current = true;
      overlayDirtyRef.current = true;
      return;
    }

    const pan = panRef.current;
    if (pan) {
      viewportRef.current = {
        scale: vp.scale,
        x: pan.startVpX + (sx - pan.startSx),
        y: pan.startVpY + (sy - pan.startSy),
      };
      dirtyRef.current = true;
      overlayDirtyRef.current = true;
      return;
    }

    // Hover hit-test only when idle.
    const { x: wx, y: wy } = screenToWorld(sx, sy, vp);
    const hit = hitTest(nodes, wx, wy);
    const nextHover = hit?.id ?? null;
    if (nextHover !== hoveredId) {
      setHoveredId(nextHover);
      overlayDirtyRef.current = true;
    }
  };

  const onPointerUp = (evt: React.PointerEvent<HTMLDivElement>) => {
    rootRef.current?.releasePointerCapture(evt.pointerId);
    const drag = dragRef.current;
    dragRef.current = null;
    panRef.current = null;

    if (drag && drag.moved) {
      // Drop-target detection: hit-test under release point, excluding
      // the dragged node itself. onDropTarget can return false to reject
      // (in which case we still emit the position commit at the drop
      // point — the parent decides what to do).
      const { sx, sy } = localPointer(evt);
      const { x: wx, y: wy } = screenToWorld(sx, sy, viewportRef.current);
      const target = hitTest(
        nodes.filter((n) => n.id !== drag.nodeId),
        wx,
        wy,
      );
      if (target && onDropTarget) {
        onDropTarget(drag.nodeId, target.id);
      }

      // Debounced commit so a rapid second drag doesn't fire two writes.
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      const id = drag.nodeId;
      const x = drag.liveX;
      const y = drag.liveY;
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        onNodeDragStop?.(id, x, y);
      }, DRAG_COMMIT_DEBOUNCE_MS);
    }
    dirtyRef.current = true;
    overlayDirtyRef.current = true;
  };

  // Wheel zoom — zoom around the cursor so the world point under the
  // pointer stays put. d3-zoom (00275) will replace this with the
  // canonical implementation; this is an interim so 00274 is usable.
  const onWheel = (evt: React.WheelEvent<HTMLDivElement>) => {
    if (!evt.ctrlKey && !evt.metaKey && Math.abs(evt.deltaY) < 1) return;
    evt.preventDefault();
    const { sx, sy } = (() => {
      const root = rootRef.current;
      if (!root) return { sx: 0, sy: 0 };
      const rect = root.getBoundingClientRect();
      return { sx: evt.clientX - rect.left, sy: evt.clientY - rect.top };
    })();
    const vp = viewportRef.current;
    const factor = Math.exp(-evt.deltaY * 0.0015);
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * factor));
    const wx = (sx - vp.x) / vp.scale;
    const wy = (sy - vp.y) / vp.scale;
    viewportRef.current = { scale: next, x: sx - wx * next, y: sy - wy * next };
    dirtyRef.current = true;
    overlayDirtyRef.current = true;
  };

  // Cleanup pending commit on unmount so callers don't see late writes.
  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    },
    [],
  );

  const rootClassName = className ? `diagram-canvas ${className}` : "diagram-canvas";

  return (
    <Provider>
      <div
        ref={rootRef}
        className={rootClassName}
        data-addressable-id={addressable_id ?? undefined}
        data-address={address}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        role="application"
        aria-label={`Diagram ${name}`}
      >
        <canvas ref={staticCanvasRef} className="diagram-canvas__layer diagram-canvas__layer--static" />
        <canvas ref={overlayCanvasRef} className="diagram-canvas__layer diagram-canvas__layer--overlay" />
        {miniMapEnabled && (
          <MiniMap nodes={nodes} viewport={viewportRef.current} canvasSize={size} />
        )}
        {controlsEnabled && (
          <Controls
            onZoomIn={() => zoomTo(viewportRef.current.scale * 1.2)}
            onZoomOut={() => zoomTo(viewportRef.current.scale / 1.2)}
            onFit={() => fitView()}
          />
        )}
      </div>
    </Provider>
  );
});

export default DiagramCanvas;
