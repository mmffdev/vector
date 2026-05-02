"use client";

// PLA-0006 / 00274 + 00275 — DiagramCanvas primitive.
//
// Two-layer Canvas2D renderer:
//   • static layer  → grid + edges + nodes; only redraws when data,
//                     viewport, or theme changes (dirty flag).
//   • overlay layer → hover/select/drag affordances; cheap to repaint
//                     each rAF tick during interaction.
//
// 00274 shipped Canvas2D, hit-test, drag, MiniMap, fitView.
// 00275 added d3-zoom for wheel + bg pan, a Web Worker dagre layout,
//   and viewport virtualisation in the static painter.
// 00276 turned the gridSize prop into snap behaviour: drag commits
//   round to the nearest gridSize, and dagre output is snapped before
//   becoming an override. Live drag still tracks the raw pointer so
//   feedback feels analog — only the commit lands on the lattice.
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
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
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
import { useDagreLayoutWorker } from "./useDagreLayoutWorker";

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

// 00276 — round a world coord to the nearest gridSize multiple. Used
// for both drag commits and dagre output so positions stay aligned to
// the visible dotted grid.
function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(function DiagramCanvas(
  {
    name,
    nodes,
    edges,
    renderNode,
    edgeStyle = "orthogonal",
    layoutMode = "manual",
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
  const dirtyRef = useRef<boolean>(true);
  const overlayDirtyRef = useRef<boolean>(true);
  const commitTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Layout overrides — written by dagre worker (00275) and by drag
  // commits when the consumer doesn't take the value back through props.
  // Keyed by node id; supersedes node.x/y when present.
  const [overrides, setOverrides] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );

  // Effective nodes = base merged with overrides. Recomputed on either
  // input change. The dragged node's live position layers on top of
  // this in the rAF tick so it doesn't churn the memo.
  const effectiveNodes = useMemo(() => {
    if (overrides.size === 0) return nodes;
    return nodes.map((n) => {
      const o = overrides.get(n.id);
      return o ? { ...n, x: o.x, y: o.y } : n;
    });
  }, [nodes, overrides]);

  // Stable node index keyed by id — used by the static painter for edge
  // endpoints and by hit-test results to look up live drag positions.
  const nodeIndex = useMemo(() => {
    const m = new Map<string, DiagramNode>();
    for (const n of effectiveNodes) m.set(n.id, n);
    return m;
  }, [effectiveNodes]);

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
  }, [effectiveNodes, edges, renderFn, edgeStyle, gridSize, showGrid]);

  // ─────────────────────────────────────────────────────────────────
  // d3-zoom — owns wheel zoom and background pan. Filter rejects
  // pointerdown that lands on a node so the React drag handler keeps
  // ownership of node movement.
  // ─────────────────────────────────────────────────────────────────

  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  // Fresh handle on the latest effective nodes for the zoom .filter()
  // closure (which is bound once and would otherwise see stale data).
  const effectiveNodesRef = useRef<DiagramNode[]>(effectiveNodes);
  useEffect(() => {
    effectiveNodesRef.current = effectiveNodes;
  }, [effectiveNodes]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const behavior = d3zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .filter((event: Event) => {
        // Default d3-zoom filter: ignore secondary buttons and ctrl-click
        // (so right-click can still surface a context menu later). Wheel
        // and touchstart always pass.
        const me = event as MouseEvent;
        if (me.button !== undefined && me.button !== 0) return false;
        if (event.type === "wheel" || event.type === "touchstart") return true;
        // mousedown — let d3-zoom pan unless it would steal a node click
        // out from under the React drag handler.
        const rect = root.getBoundingClientRect();
        const sx = me.clientX - rect.left;
        const sy = me.clientY - rect.top;
        const vp = viewportRef.current;
        const wx = (sx - vp.x) / vp.scale;
        const wy = (sy - vp.y) / vp.scale;
        const hit = hitTest(effectiveNodesRef.current, wx, wy);
        return hit === null;
      })
      .on("zoom", (event) => {
        const t = event.transform as { x: number; y: number; k: number };
        viewportRef.current = { x: t.x, y: t.y, scale: t.k };
        dirtyRef.current = true;
        overlayDirtyRef.current = true;
      });
    zoomBehaviorRef.current = behavior;
    select(root).call(behavior);
    return () => {
      select(root).on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
  }, []);

  // Apply a viewport programmatically by routing through d3-zoom so
  // its internal transform stays in sync with viewportRef.
  const applyViewport = useCallback((next: Viewport) => {
    const root = rootRef.current;
    const behavior = zoomBehaviorRef.current;
    if (!root || !behavior) {
      viewportRef.current = next;
      dirtyRef.current = true;
      overlayDirtyRef.current = true;
      bumpRender();
      return;
    }
    const t = zoomIdentity.translate(next.x, next.y).scale(next.scale);
    select(root).call(behavior.transform, t);
  }, [bumpRender]);

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
            const paintNodes =
              drag !== null
                ? effectiveNodes.map((n) =>
                    n.id === drag.nodeId ? { ...n, x: drag.liveX, y: drag.liveY } : n,
                  )
                : effectiveNodes;
            const paintIndex =
              drag !== null
                ? new Map(paintNodes.map((n) => [n.id, n] as const))
                : nodeIndex;
            const counts = paintStatic({
              ctx,
              size,
              vp: viewportRef.current,
              nodes: paintNodes,
              edges,
              nodeIndex: paintIndex,
              renderNode: renderFn,
              edgeStyle,
              gridSize,
              showGrid,
              colors,
              selectedId,
              hoveredId,
              draggingId: drag?.nodeId ?? null,
            });
            // Expose rendered counts so the stress harness can verify
            // virtualisation is doing its job.
            (window as unknown as {
              __DIAGRAM_RENDERED_COUNT__?: number;
              __DIAGRAM_RENDERED_EDGES__?: number;
            }).__DIAGRAM_RENDERED_COUNT__ = counts.nodes;
            (window as unknown as {
              __DIAGRAM_RENDERED_COUNT__?: number;
              __DIAGRAM_RENDERED_EDGES__?: number;
            }).__DIAGRAM_RENDERED_EDGES__ = counts.edges;
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
    effectiveNodes,
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
  // dagre layout (00275)
  // ─────────────────────────────────────────────────────────────────

  const { runLayout } = useDagreLayoutWorker();

  // Run a layout over a chosen node set and apply snapped positions as
  // overrides. Returns elapsed milliseconds so the harness can assert
  // against the perf budget.
  const layoutSet = useCallback(
    async (subset: DiagramNode[], rankdir: "TB" | "LR"): Promise<number> => {
      if (subset.length === 0) return 0;
      const idSet = new Set(subset.map((n) => n.id));
      const subsetEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
      const result = await runLayout({
        nodes: subset.map((n) => ({ id: n.id, width: n.width, height: n.height })),
        edges: subsetEdges.map((e) => ({ source: e.source, target: e.target })),
        rankdir,
        nodesep: Math.max(gridSize * 3, 30),
        ranksep: Math.max(gridSize * 6, 60),
      });
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const [id, p] of Object.entries(result.positions)) {
          next.set(id, {
            x: snapToGrid(p.x, gridSize),
            y: snapToGrid(p.y, gridSize),
          });
        }
        return next;
      });
      return result.ms;
    },
    [edges, runLayout, gridSize],
  );

  // BFS the subtree rooted at `rootId` over the directed edge set.
  // Falls back to the whole graph when omitted.
  const collectSubtree = useCallback(
    (rootId: string | undefined): DiagramNode[] => {
      if (!rootId) return effectiveNodes;
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        const list = adj.get(e.source);
        if (list) list.push(e.target);
        else adj.set(e.source, [e.target]);
      }
      const seen = new Set<string>([rootId]);
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop()!;
        const children = adj.get(id);
        if (!children) continue;
        for (const c of children) {
          if (!seen.has(c)) {
            seen.add(c);
            stack.push(c);
          }
        }
      }
      return effectiveNodes.filter((n) => seen.has(n.id));
    },
    [edges, effectiveNodes],
  );

  // Run layout once on mount when layoutMode is auto-* and nodes have
  // no overrides yet. Subsequent prop changes re-run via the same
  // effect — auto-* layouts treat consumer x/y as a hint that's fine
  // to overwrite.
  const lastLayoutKeyRef = useRef<string>("");
  useEffect(() => {
    if (layoutMode !== "auto-horizontal" && layoutMode !== "auto-vertical") return;
    if (nodes.length === 0) return;
    const key = `${layoutMode}|${nodes.length}|${edges.length}`;
    if (key === lastLayoutKeyRef.current) return;
    lastLayoutKeyRef.current = key;
    const rankdir = layoutMode === "auto-horizontal" ? "LR" : "TB";
    void layoutSet(nodes, rankdir);
  }, [layoutMode, nodes, edges, layoutSet]);

  // ─────────────────────────────────────────────────────────────────
  // Imperative API
  // ─────────────────────────────────────────────────────────────────

  const fitView = useCallback(
    (opts?: { padding?: number }) => {
      const padding = opts?.padding ?? 32;
      const bounds = nodesBounds(effectiveNodes);
      if (!bounds || size.width === 0 || size.height === 0) return;
      const innerW = Math.max(1, size.width - padding * 2);
      const innerH = Math.max(1, size.height - padding * 2);
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min(innerW / bounds.width, innerH / bounds.height)),
      );
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      applyViewport({
        scale,
        x: size.width / 2 - cx * scale,
        y: size.height / 2 - cy * scale,
      });
    },
    [effectiveNodes, size, applyViewport],
  );

  const zoomTo = useCallback(
    (scale: number) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      const vp = viewportRef.current;
      const cx = size.width / 2;
      const cy = size.height / 2;
      const wx = (cx - vp.x) / vp.scale;
      const wy = (cy - vp.y) / vp.scale;
      applyViewport({
        scale: next,
        x: cx - wx * next,
        y: cy - wy * next,
      });
    },
    [size, applyViewport],
  );

  const centerOn = useCallback(
    (nodeId: string) => {
      const n = nodeIndex.get(nodeId);
      if (!n) return;
      const vp = viewportRef.current;
      const cx = n.x + n.width / 2;
      const cy = n.y + n.height / 2;
      applyViewport({
        scale: vp.scale,
        x: size.width / 2 - cx * vp.scale,
        y: size.height / 2 - cy * vp.scale,
      });
    },
    [nodeIndex, size, applyViewport],
  );

  const relayoutSubtree = useCallback(
    async (rootId?: string): Promise<number> => {
      const rankdir = layoutMode === "auto-horizontal" ? "LR" : "TB";
      const subset = collectSubtree(rootId);
      const ms = await layoutSet(subset, rankdir);
      // Stamp the most recent measurement on the global perf object so
      // the playwright harness can assert against the budget without
      // round-tripping through React.
      (window as unknown as {
        __DIAGRAM_PERF__?: { lastSubtreeMs?: number };
      }).__DIAGRAM_PERF__ = {
        ...(window as unknown as { __DIAGRAM_PERF__?: object }).__DIAGRAM_PERF__,
        lastSubtreeMs: ms,
      };
      return ms;
    },
    [collectSubtree, layoutSet, layoutMode],
  );

  useImperativeHandle(
    ref,
    (): DiagramCanvasHandle => ({
      fitView,
      zoomTo,
      centerOn,
      getViewport: () => ({ ...viewportRef.current }),
      relayoutSubtree,
    }),
    [fitView, zoomTo, centerOn, relayoutSubtree],
  );

  // First-paint fitView once we have nodes and a measured viewport.
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    if (size.width === 0 || size.height === 0) return;
    if (effectiveNodes.length === 0) return;
    fitView();
    didFitRef.current = true;
  }, [size, effectiveNodes.length, fitView]);

  // ─────────────────────────────────────────────────────────────────
  // Pointer handling — node drag only. d3-zoom owns wheel + bg pan.
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
    const hit = hitTest(effectiveNodes, wx, wy);
    if (!hit) {
      // Empty space — d3-zoom handles it (synthetic pointer-only events
      // still land here, harmlessly). Clear selection if the user tapped
      // out of a node.
      if (selectedId !== null) {
        setSelectedId(null);
        onNodeSelect?.(null);
        overlayDirtyRef.current = true;
      }
      return;
    }
    rootRef.current?.setPointerCapture(evt.pointerId);
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

    // Hover hit-test only when idle.
    const { x: wx, y: wy } = screenToWorld(sx, sy, vp);
    const hit = hitTest(effectiveNodes, wx, wy);
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

    if (drag && drag.moved) {
      // 00276 — snap commit to the lattice. Live drag tracked the raw
      // pointer so feedback felt analog; the drop lands on grid.
      const x = snapToGrid(drag.liveX, gridSize);
      const y = snapToGrid(drag.liveY, gridSize);
      // Persist as local override so the drop position survives until
      // the consumer round-trips through props.
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(drag.nodeId, { x, y });
        return next;
      });

      // Drop-target detection: hit-test under release point, excluding
      // the dragged node itself. onDropTarget can return false to reject
      // (in which case we still emit the position commit at the drop
      // point — the parent decides what to do).
      const { sx, sy } = localPointer(evt);
      const { x: dwx, y: dwy } = screenToWorld(sx, sy, viewportRef.current);
      const target = hitTest(
        effectiveNodes.filter((n) => n.id !== drag.nodeId),
        dwx,
        dwy,
      );
      if (target && onDropTarget) {
        onDropTarget(drag.nodeId, target.id);
      }

      // Debounced commit so a rapid second drag doesn't fire two writes.
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      const id = drag.nodeId;
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        onNodeDragStop?.(id, x, y);
      }, DRAG_COMMIT_DEBOUNCE_MS);
    }
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
        role="application"
        aria-label={`Diagram ${name}`}
      >
        <canvas ref={staticCanvasRef} className="diagram-canvas__layer diagram-canvas__layer--static" />
        <canvas ref={overlayCanvasRef} className="diagram-canvas__layer diagram-canvas__layer--overlay" />
        {miniMapEnabled && (
          <MiniMap nodes={effectiveNodes} viewport={viewportRef.current} canvasSize={size} />
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
