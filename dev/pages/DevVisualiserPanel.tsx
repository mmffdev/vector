"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "@/app/components/Panel";
import { apiSite } from "@/app/lib/api";
import DevVisualiserCubesPanel from "./DevVisualiserCubesPanel";

type Renderer = "spheres" | "cubes";

type Side = "frontend" | "backend";

type GraphNode = {
  id: string;
  side: Side;
  folder: string;
  layer: string;
};

type GraphEdge = {
  source: string;
  target: string;
  kind: "import" | "bridge";
};

type Codegraph = {
  generated_at: string;
  stats: {
    ts_files: number;
    go_files: number;
    import_edges: number;
    bridge_edges: number;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type View = "folders" | "files";

const LAYER_COLOUR: Record<string, string> = {
  page: "#4ea1ff",
  layout: "#7ab8ff",
  component: "#46c0a0",
  lib: "#a07ade",
  hook: "#c87adf",
  "shadow-api": "#ffb84d",
  "dev-panel": "#ffd34d",
  "dev-component": "#fbe372",
  "dev-other": "#fff0a8",
  "app-other": "#9ec5ff",
  "ts-other": "#bfcfe0",
  handler: "#ff6b6b",
  service: "#ff9559",
  sql: "#d35a2e",
  types: "#e8a07a",
  main: "#ffd6cc",
  cmd: "#ffd6cc",
  "go-other": "#cba79a",
  bridge: "#ffffff",
};

function rollupToFolder(graph: Codegraph): Codegraph {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodeMap.set(n.id, n);

  // Folder node id = folder path. Side derived from members (homogeneous in
  // practice — frontend folders only contain TS, backend folders only Go).
  const folderNodes = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (!folderNodes.has(n.folder)) {
      folderNodes.set(n.folder, {
        id: n.folder,
        side: n.side,
        folder: n.folder,
        layer: n.layer,
      });
    }
  }

  // Roll edges to folder-level, collapsing duplicates.
  const edgeKey = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    if (s.folder === t.folder) continue; // skip intra-folder edges
    const key = `${s.folder}->${t.folder}:${e.kind}`;
    if (!edgeKey.has(key)) {
      edgeKey.set(key, { source: s.folder, target: t.folder, kind: e.kind });
    }
  }

  return {
    ...graph,
    nodes: Array.from(folderNodes.values()),
    edges: Array.from(edgeKey.values()),
  };
}

// Connected-component map: for each node id, the Set of all node ids in the
// same connected component (reachable via any chain of links, treating edges
// as undirected). Used by drag handlers to translate the whole cluster as a
// rigid block when you grab any of its members.
function buildClusterMap(nodes: any[], links: any[]): Map<string, Set<string>> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of links) {
    const s = typeof e.source === "object" ? e.source.id : e.source;
    const t = typeof e.target === "object" ? e.target.id : e.target;
    if (!adj.has(s) || !adj.has(t)) continue;
    adj.get(s)!.push(t);
    adj.get(t)!.push(s);
  }

  const seen = new Set<string>();
  const map = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    // BFS the component starting at n.
    const component = new Set<string>();
    const queue: string[] = [n.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (component.has(id)) continue;
      component.add(id);
      seen.add(id);
      for (const next of adj.get(id) ?? []) {
        if (!component.has(next)) queue.push(next);
      }
    }
    for (const id of component) map.set(id, component);
  }
  return map;
}

// Top-level dispatcher: picks Spheres (original) or Cubes (prototype) view.
// The control is a thin segmented toggle above the panel so both renderers
// stay fully independent — ripping the cubes branch later is a 4-line revert.
export default function DevVisualiserPanel() {
  const [renderer, setRenderer] = useState<Renderer>("spheres");

  return (
    <>
      <div className="dui-toolbar" style={{ marginBottom: 8 }}>
        <div className="dui-pager__sizes" role="group" aria-label="Renderer">
          <button
            className={`dui-pager__size${renderer === "spheres" ? " is-active" : ""}`}
            onClick={() => setRenderer("spheres")}
            aria-pressed={renderer === "spheres"}
          >
            Spheres
          </button>
          <button
            className={`dui-pager__size${renderer === "cubes" ? " is-active" : ""}`}
            onClick={() => setRenderer("cubes")}
            aria-pressed={renderer === "cubes"}
          >
            Cubes
          </button>
        </div>
      </div>
      {renderer === "spheres" ? <SpheresView /> : <DevVisualiserCubesPanel />}
    </>
  );
}

function SpheresView() {
  const [graph, setGraph] = useState<Codegraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("folders");
  const [showBridges, setShowBridges] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<any>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiSite<Codegraph>("/admin/dev/codegraph");
      setGraph(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load code graph.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const displayGraph = useMemo(() => {
    if (!graph) return null;
    const base = view === "folders" ? rollupToFolder(graph) : graph;
    if (showBridges) return base;
    return { ...base, edges: base.edges.filter(e => e.kind === "import") };
  }, [graph, view, showBridges]);

  // Mount 3d-force-graph once, replace data on toggle.
  useEffect(() => {
    if (!displayGraph || !containerRef.current) return;

    let cancelled = false;
    (async () => {
      const { default: ForceGraph3D } = await import("3d-force-graph");
      if (cancelled || !containerRef.current) return;

      // Snapshot the data we'll feed in — same object refs are used by the
      // drag handlers below to compute connected components and translate
      // the whole cluster as a rigid block.
      const nodes = displayGraph.nodes.map(n => ({ ...n })) as any[];
      const links = displayGraph.edges.map(e => ({ ...e })) as any[];

      // Connected-component map: nodeId → Set<member nodeId>. Computed once
      // per data load; reused across every drag of any node in the cluster.
      const clusterOf = buildClusterMap(nodes, links);

      // Drag state — captured at dragstart, applied per tick, finalised at end.
      let dragCluster: any[] | null = null;
      let dragAnchor: { x: number; y: number; z: number } | null = null;

      if (!fgRef.current) {
        fgRef.current = new ForceGraph3D(containerRef.current)
          .backgroundColor("#0d1117")
          .nodeRelSize(3)
          // Crush the elastic — high velocity decay = no bounce, low cooldown
          // ticks = sim quits fighting back fast. Combined with fx/fy/fz pins
          // on drag-end, dragged nodes stay exactly where you put them.
          .d3VelocityDecay(0.85)
          .cooldownTicks(60)
          .nodeColor((n: any) => LAYER_COLOUR[n.layer] ?? "#888")
          .nodeLabel((n: any) => `<div style="background:#111;color:#fff;padding:4px 8px;border-radius:4px;font-family:monospace;font-size:11px">${n.id}<br/><span style="opacity:.6">${n.layer} · ${n.side}</span></div>`)
          .linkColor((e: any) => (e.kind === "bridge" ? "#ffffff" : "#3a4a5c"))
          .linkOpacity(0.4)
          .linkWidth((e: any) => (e.kind === "bridge" ? 0.6 : 0.2))
          .linkDirectionalParticles((e: any) => (e.kind === "bridge" ? 2 : 0))
          .linkDirectionalParticleWidth(1.5)
          .onNodeHover((n: any) => setHoveredNode(n ?? null))
          // Click a node → re-centre orbit pivot, reset up to world +Y so
          // the framing isn't skewed by prior camera tumble, fly to a
          // standardised distance, and repin OrbitControls.target so
          // post-flight orbit pivots around the clicked node.
          .onNodeClick((node: any) => {
            const fg = fgRef.current;
            if (!fg) return;
            const camera = fg.camera() as any;
            const controls = fg.controls() as any;

            camera.up.set(0, 1, 0);

            // Sphere "size" is approximate — nodeRelSize(3) renders ~ r=4.
            // We frame as if it were a card of similar footprint so the
            // zoom feels identical to the cubes view.
            const FOOTPRINT = 12;
            const MARGIN = 1.6;
            const fovRad = ((camera.fov ?? 60) * Math.PI) / 180;
            const aspect = camera.aspect ?? 16 / 9;
            const fitHeight = (FOOTPRINT / 2) / Math.tan(fovRad / 2);
            const fitWidth  = (FOOTPRINT / 2) / (Math.tan(fovRad / 2) * aspect);
            const standoff = Math.max(fitHeight, fitWidth) * MARGIN;

            const nx = node.x ?? 0;
            const ny = node.y ?? 0;
            const nz = node.z ?? 0;

            fg.cameraPosition(
              { x: nx, y: ny, z: nz + standoff },
              { x: nx, y: ny, z: nz },
              600,
            );

            setTimeout(() => {
              if (controls?.target?.set) {
                controls.target.set(nx, ny, nz);
                controls.update?.();
              }
            }, 650);
          })
          // onNodeDrag fires every tick while dragging. translate is the
          // *cumulative* delta from drag-start. We want to drag the whole
          // connected component as a rigid block, so we offset every
          // cluster member by translate − previous-translate each tick.
          .onNodeDrag((node: any, translate: any) => {
            if (!dragCluster) {
              // First tick of this drag — snapshot the cluster and its anchor.
              const ids = clusterOf.get(node.id);
              if (!ids) return;
              dragCluster = nodes.filter(n => ids.has(n.id) && n !== node);
              dragAnchor = { x: translate.x, y: translate.y, z: translate.z };
              // Pin cluster members in place at their CURRENT positions so
              // the simulation can't fight us mid-drag.
              for (const m of dragCluster) {
                m.fx = m.x;
                m.fy = m.y;
                m.fz = m.z;
              }
              return;
            }
            if (!dragAnchor) return;
            const dx = translate.x - dragAnchor.x;
            const dy = translate.y - dragAnchor.y;
            const dz = translate.z - dragAnchor.z;
            for (const m of dragCluster) {
              m.fx = (m.fx ?? m.x) + dx;
              m.fy = (m.fy ?? m.y) + dy;
              m.fz = (m.fz ?? m.z) + dz;
            }
            dragAnchor = { x: translate.x, y: translate.y, z: translate.z };
          })
          // onNodeDragEnd — pin the dragged node *and* every cluster member
          // so the whole sub-graph stays as a frozen constellation around
          // where you dropped it. Pinning = set fx/fy/fz to the current x/y/z.
          .onNodeDragEnd((node: any) => {
            node.fx = node.x;
            node.fy = node.y;
            node.fz = node.z;
            if (dragCluster) {
              for (const m of dragCluster) {
                m.fx = m.x;
                m.fy = m.y;
                m.fz = m.z;
              }
            }
            dragCluster = null;
            dragAnchor = null;
          });
      }

      fgRef.current.graphData({ nodes, links });

      // Resize to container.
      const rect = containerRef.current.getBoundingClientRect();
      fgRef.current.width(rect.width).height(rect.height);
    })();

    return () => {
      cancelled = true;
    };
  }, [displayGraph]);

  const usedLayers = useMemo(() => {
    if (!displayGraph) return [];
    const s = new Set<string>();
    displayGraph.nodes.forEach(n => s.add(n.layer));
    return Array.from(s).sort();
  }, [displayGraph]);

  return (
    <Panel name="dev_visualiser" title="Visualiser">
      <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Code Graph</h1>
            <p className="dui-page__subtitle">
              Unified force-directed graph of the codebase: frontend (TS/TSX) files, backend (Go) files,
              and the HTTP bridges between them. Run <code>bash dev/scripts/audit_codegraph.sh</code> (or{" "}
              <code>&lt;audit&gt; -graph</code>) to refresh the snapshot.
            </p>
          </div>
          <button onClick={load} disabled={loading} className="dui-pager__btn">
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        <div className="dui-toolbar">
          <div className="dui-pager__sizes" role="group" aria-label="View mode">
            <button
              className={`dui-pager__size${view === "folders" ? " is-active" : ""}`}
              onClick={() => setView("folders")}
              aria-pressed={view === "folders"}
            >
              Folders
            </button>
            <button
              className={`dui-pager__size${view === "files" ? " is-active" : ""}`}
              onClick={() => setView("files")}
              aria-pressed={view === "files"}
            >
              Files
            </button>
          </div>
          <div className="dui-toolbar__spacer" />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showBridges}
              onChange={e => setShowBridges(e.target.checked)}
            />
            Bridges (TS → Go)
          </label>
          {graph && (
            <span style={{ marginLeft: 12, fontSize: 12, opacity: 0.7 }}>
              {graph.stats.ts_files} TS · {graph.stats.go_files} Go ·{" "}
              {graph.stats.import_edges} imports · {graph.stats.bridge_edges} bridges
            </span>
          )}
        </div>

        {error && <div className="dui-empty">{error}</div>}

        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            height: "70vh",
            background: "#0d1117",
            borderRadius: 6,
            overflow: "hidden",
            marginTop: 8,
          }}
        >
          {hoveredNode && (
            <div
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 4,
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              {hoveredNode.id}
              <br />
              <span style={{ opacity: 0.6 }}>
                {hoveredNode.layer} · {hoveredNode.side}
              </span>
            </div>
          )}
        </div>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 10,
            fontSize: 11,
          }}
        >
          {usedLayers.map(layer => (
            <span
              key={layer}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                background: "var(--surface-2, #f0f0f0)",
                borderRadius: 3,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: LAYER_COLOUR[layer] ?? "#888",
                }}
              />
              {layer}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}
