"use client";

import { useEffect, useMemo, useRef } from "react";
import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import type {
  RelationsEdge,
  RelationsNode,
  RelationsPayload,
} from "@/app/api/v2/work-items/relations/route";
import type { RelationsFilters } from "./index";

// 3d-force-graph's NodeObject is `object & { id?: string|number }`;
// our id is always a UUID string. Re-declare the intersection so the
// chained accessors below stay strongly typed against our wire shape.
type GraphNode = RelationsNode;
type GraphLink = { source: string; target: string; kind: RelationsEdge["kind"] };
type Graph = ForceGraph3DInstance<GraphNode, GraphLink>;

export type FlyToFn = (nodeId: string) => void;

type Props = {
  payload: RelationsPayload;
  filters: RelationsFilters;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called once on mount with the flyTo imperative handle. */
  onFlyToReady?: (fn: FlyToFn) => void;
};

// Fallback colours if the CSS variables are missing — keeps the canvas
// usable on first paint before the theme provider has resolved tokens.
const FALLBACK_TYPE_COLOUR: Record<string, string> = {
  Epic: "#5C5C5C",
  Story: "#8A8A8A",
  Task: "#B8B5AF",
  Defect: "#b91c1c",
};

function readTypeColour(typeName: string): string {
  if (typeof window === "undefined") return FALLBACK_TYPE_COLOUR[typeName] ?? "#888";
  const root = window.getComputedStyle(document.documentElement);
  const key = typeName.toLowerCase(); // "epic" | "story" | …
  const v = root.getPropertyValue(`--tree_accordion-dense-type-${key}`).trim();
  return v || FALLBACK_TYPE_COLOUR[typeName] || "#888";
}

// Hub-size scaling. log2 keeps the largest hub ~4× the radius of a
// leaf — visible without dwarfing the scene. +2 avoids log2(0)/log2(1).
function nodeVal(n: GraphNode): number {
  return Math.log2((n.descendant_count ?? 0) + 2);
}

export function RelationsGraph({ payload, filters, selectedId, onSelect, onFlyToReady }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);

  // Pre-compute a stable type→colour map so the per-frame accessor
  // doesn't poke getComputedStyle on every node.
  const typeColour = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of payload.nodes) {
      if (!map.has(n.type_name)) map.set(n.type_name, readTypeColour(n.type_name));
    }
    return map;
  }, [payload.nodes]);

  // Mount once. Subsequent payload/filter changes update via .graphData().
  useEffect(() => {
    if (!containerRef.current) return;
    const fg = new ForceGraph3D(containerRef.current, {
      controlType: "orbit",
    }) as unknown as Graph;

    // Three.js OrbitControls listens to `pointercancel` on the renderer DOM
    // element via `this._onPointerUp` (a bound closure created at construction).
    // 3d-force-graph also attaches DragControls to the same element. When a
    // drag ends with `pointercancel`, DragControls fires its own event, which
    // then propagates to OrbitControls' `_onPointerUp`. Inside that handler,
    // after removing the cancelled pointer, OrbitControls enters `case 1:` and
    // reads `this._pointerPositions[remainingPointerId].x` — but that slot may
    // be undefined because OrbitControls never recorded the pointer (DragControls
    // owned it), causing "Cannot read properties of undefined (reading 'x')".
    //
    // Fix: replace the *bound* `_onPointerUp` copy that is actually attached as
    // the DOM listener so we can guard `_pointerPositions` access before the
    // `case 1` branch runs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = (fg as any).controls() as any;
    if (controls?._onPointerUp && controls?.domElement) {
      const origBound = controls._onPointerUp as (e: PointerEvent) => void;
      const safeBound = (e: PointerEvent) => {
        // Guard: if OrbitControls hasn't tracked this pointer, it can't safely
        // process the event — skip rather than crash in the case-1 branch.
        if (controls._pointers && controls._pointerPositions) {
          const willBeLeft = controls._pointers.filter((id: number) => id !== e.pointerId);
          if (
            willBeLeft.length === 1 &&
            !(willBeLeft[0] in controls._pointerPositions)
          ) return;
        }
        origBound(e);
      };
      // Swap the listener on the DOM element and keep the reference in sync.
      controls.domElement.removeEventListener("pointercancel", origBound);
      controls.domElement.addEventListener("pointercancel", safeBound);
      // Also replace on ownerDocument in case it was registered there too.
      controls.domElement.ownerDocument?.removeEventListener("pointerup", origBound);
      controls.domElement.ownerDocument?.addEventListener("pointerup", safeBound);
      controls._onPointerUp = safeBound;
    }
    fg
      .backgroundColor("#0b0b0d")
      .nodeId("id")
      .nodeLabel((n: GraphNode) => `${n.prefix}-${n.number} · ${n.title}`)
      .nodeVal((n: GraphNode) => nodeVal(n))
      .nodeColor((n: GraphNode) => typeColour.get(n.type_name) ?? "#888")
      .linkSource("source")
      .linkTarget("target")
      .linkOpacity(0.35)
      .linkWidth(0.6)
      .onNodeClick((n: GraphNode) => onSelect(n.id))
      .onBackgroundClick(() => onSelect(null));
    graphRef.current = fg;

    // Expose imperative fly-to handle to the orchestrator.
    if (onFlyToReady) {
      onFlyToReady((nodeId: string) => {
        const graph = graphRef.current;
        if (!graph) return;
        // Find the live node object (post-simulation, it has x/y/z).
        const node = (graph.graphData().nodes as GraphNode[]).find((n) => n.id === nodeId);
        if (!node) return;
        const distance = 120;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const n = node as any;
        const x = (n.x as number) ?? 0;
        const y = (n.y as number) ?? 0;
        const z = (n.z as number) ?? 0;
        graph.cameraPosition(
          { x: x + distance, y, z },
          { x, y, z },
          1500,
        );
      });
    }

    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el || !graphRef.current) return;
      graphRef.current.width(el.clientWidth).height(el.clientHeight);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      fg._destructor();
      graphRef.current = null;
    };
    // Mount-only — typeColour update path runs in the data effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BFS over the edge list up to `hops` steps from `rootId`.
  // Returns a Set of all node-ids within that neighbourhood.
  function bfsNeighbours(rootId: string, hops: number, edges: readonly RelationsEdge[]): Set<string> {
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    const visited = new Set<string>([rootId]);
    let frontier = [rootId];
    for (let h = 0; h < hops; h++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adj.get(id) ?? []) {
          if (!visited.has(nb)) { visited.add(nb); next.push(nb); }
        }
      }
      frontier = next;
    }
    return visited;
  }

  // Filter + feed data whenever payload or filters change.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const q = filters.q.trim().toLowerCase();
    const allowedTypes = filters.types;
    const maxDepth = filters.maxDepth;

    const visibleNodes: GraphNode[] = [];
    const visibleIds = new Set<string>();
    for (const n of payload.nodes) {
      if (allowedTypes.size > 0 && !allowedTypes.has(n.type_name)) continue;
      if (maxDepth !== null && n.depth > maxDepth) continue;
      if (q) {
        const haystack = `${n.prefix}-${n.number} ${n.title}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      visibleNodes.push(n);
      visibleIds.add(n.id);
    }

    const visibleLinks: GraphLink[] = [];
    for (const e of payload.edges) {
      if (visibleIds.has(e.source) && visibleIds.has(e.target)) {
        visibleLinks.push({ source: e.source, target: e.target, kind: e.kind });
      }
    }

    fg.graphData({ nodes: visibleNodes, links: visibleLinks });
  }, [payload, filters]);

  // Highlight the selected node by punching its size up.
  // In neighbour-mode, dim nodes outside the k-hop BFS neighbourhood.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const inNeighbourhood =
      filters.neighbourMode && selectedId
        ? bfsNeighbours(selectedId, filters.neighbourDepth, payload.edges)
        : null;

    fg.nodeVal((n: GraphNode) =>
      n.id === selectedId ? nodeVal(n) * 2.5 : nodeVal(n),
    );

    if (inNeighbourhood) {
      fg.nodeColor((n: GraphNode) => {
        const base = typeColour.get(n.type_name) ?? "#888";
        if (n.id === selectedId) return base;
        if (inNeighbourhood.has(n.id)) return base;
        // Dim non-neighbours by appending a low-opacity hex alpha.
        return `${base}28`; // ~16% opacity
      });
      // linkVisibility accepts a function; hide links where neither endpoint is in the neighbourhood.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fg.linkVisibility((link: any) => {
        const src: string = typeof link.source === "object" ? (link.source as GraphNode).id : link.source as string;
        const tgt: string = typeof link.target === "object" ? (link.target as GraphNode).id : link.target as string;
        return inNeighbourhood.has(src) || inNeighbourhood.has(tgt);
      });
      fg.linkOpacity(0.35);
    } else {
      fg.nodeColor((n: GraphNode) => typeColour.get(n.type_name) ?? "#888");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fg.linkVisibility(true as any);
      fg.linkOpacity(0.35);
    }

    fg.refresh();
  }, [selectedId, filters.neighbourMode, filters.neighbourDepth, payload.edges, typeColour]);

  return <div ref={containerRef} className="ui-relations__canvas-host" />;
}
