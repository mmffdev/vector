"use client";

// DevVisualiserPanelV4 — 3D code-relationship explorer.
//
// Inspired by mmffdev/emerge's visual language (cluster colouring, criticality
// glow, live multi-term search with fade) but reimplemented on our stack:
// 3d-force-graph + Three.js + graphology-communities-louvain. No GPL deps.
//
// The graph is structural — what connects to what, by type and criticality.
// No time axis, no churn, no git. The four channels:
//
//   position : d3-force-3d simulation (free)
//   size     : node.sloc                  (how big is this file)
//   hue      : Louvain cluster_id          (which community)
//   glow     : node.criticality           (blast radius if it breaks)
//
// Data feed: dev/audits/codegraph.json via /admin/dev/codegraph (apiSite
// prepends /_site).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import * as THREE from "three";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { apiSite } from "@/app/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Side = "frontend" | "backend";

type GraphNode = {
  id: string;
  side: Side;
  folder: string;
  layer: string;
  sloc: number;
  fan_in: number;
  fan_out: number;
  criticality: number;
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

type EnrichedNode = GraphNode & {
  cluster: number;
  x?: number; y?: number; z?: number;
};

type ClusterStat = {
  id: number;
  size: number;
  totalSloc: number;
  avgCriticality: number;
  topNode: EnrichedNode;
  colour: string;
};

type SideFilter = "all" | "frontend" | "backend";

// ─── Cluster palette — distinct hues, evenly spaced ──────────────────────────

const CLUSTER_HUES = [
  "#4ea1ff", "#46c0a0", "#a07ade", "#ffb84d", "#ff6b6b",
  "#7ad9ff", "#ffd34d", "#c87adf", "#ff9559", "#5fd99f",
  "#e87aa8", "#9ec5ff", "#fbe372", "#7ad9c5", "#d9a07a",
  "#bf7adf",
];

function clusterColour(c: number): string {
  return CLUSTER_HUES[c % CLUSTER_HUES.length];
}

// ─── Card texture builder (ported from V2) ───────────────────────────────────
//
// Each node is a thin Three.js box with a CanvasTexture on its front face.
// The texture is a 512×256 dev-card showing filename, folder, layer tag, and
// criticality score. Textures are cached by (label, sub, layer, score-band,
// colour, dimmed) so panning the graph doesn't repaint thousands of canvases.

const CARD_TEXT_PRIMARY = "#e8f0fc";
const CARD_TEXT_DIM = "#6b7d96";
const CARD_TEXT_GHOST = "#4a5870";
const CARD_SURFACE = "#11161f";

function buildCardTexture(
  cache: Map<string, THREE.CanvasTexture>,
  name: string,
  layer: string,
  criticality: number,
  colour: string,
  dimmed: boolean,
): THREE.CanvasTexture {
  const label = name.split("/").pop() || name;
  const sub = name.length > label.length ? name.slice(0, -label.length).replace(/\/$/, "") : "";
  // Bucket criticality so the cache stays small (cards within the same band
  // share a texture).
  const scoreBand = Math.round(criticality / 10) * 10;
  const key = `${label}|${sub}|${layer}|${scoreBand}|${colour}|${dimmed ? "d" : "n"}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const W = 512;
  const H = 256;
  const dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const alpha = dimmed ? 0.35 : 1;
  ctx.globalAlpha = alpha;

  // Card body
  ctx.fillStyle = CARD_SURFACE;
  ctx.fillRect(0, 0, W, H);
  // Cluster-colour top stripe
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, W, 18);

  // Layer tag + criticality, top-right
  ctx.font = "bold 22px ui-monospace, Menlo, monospace";
  ctx.fillStyle = colour;
  ctx.textAlign = "right";
  ctx.fillText(layer.toUpperCase(), W - 16, 56);
  ctx.font = "16px ui-monospace, Menlo, monospace";
  ctx.fillStyle = CARD_TEXT_DIM;
  ctx.fillText(`${Math.round(criticality)}`, W - 16, 80);

  // Folder path, top-left
  ctx.textAlign = "left";
  ctx.fillStyle = CARD_TEXT_GHOST;
  ctx.font = "18px ui-monospace, Menlo, monospace";
  const subTrim = sub.length > 40 ? "…" + sub.slice(-37) : sub;
  ctx.fillText(subTrim, 16, 56);

  // Filename — the dominant label
  ctx.fillStyle = CARD_TEXT_PRIMARY;
  ctx.font = "bold 36px ui-sans-serif, system-ui, sans-serif";
  const labelTrim = label.length > 22 ? label.slice(0, 21) + "…" : label;
  ctx.fillText(labelTrim, 16, 130);

  // Layer (long form), bottom-left
  ctx.fillStyle = colour;
  ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(layer, 16, 200);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

// ─── Louvain clustering — runs once per graph load ───────────────────────────

function computeClusters(graph: Codegraph): Map<string, number> {
  const g = new Graph({ multi: false, allowSelfLoops: false, type: "undirected" });
  for (const n of graph.nodes) g.addNode(n.id);
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (g.hasEdge(e.source, e.target)) continue;
    g.addEdge(e.source, e.target);
  }
  const communities = louvain(g, { resolution: 1.0 });
  return new Map(Object.entries(communities));
}

// ─── Cluster summary stats for the left rail ─────────────────────────────────

function summariseClusters(nodes: EnrichedNode[]): ClusterStat[] {
  const buckets = new Map<number, EnrichedNode[]>();
  for (const n of nodes) {
    if (!buckets.has(n.cluster)) buckets.set(n.cluster, []);
    buckets.get(n.cluster)!.push(n);
  }
  const stats: ClusterStat[] = [];
  for (const [id, members] of buckets) {
    const totalSloc = members.reduce((a, n) => a + n.sloc, 0);
    const avgCriticality =
      members.reduce((a, n) => a + n.criticality, 0) / members.length;
    const topNode = members.reduce((a, b) => (b.criticality > a.criticality ? b : a));
    stats.push({
      id,
      size: members.length,
      totalSloc,
      avgCriticality: Math.round(avgCriticality * 10) / 10,
      topNode,
      colour: clusterColour(id),
    });
  }
  return stats.sort((a, b) => b.size - a.size);
}

// ─── BFS — K-hops neighbourhood from a seed ──────────────────────────────────

function kHopsNeighbourhood(
  seedId: string,
  k: number,
  nodes: EnrichedNode[],
  edges: GraphEdge[],
): Set<string> {
  if (k <= 0) return new Set(nodes.map(n => n.id));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }
  const reached = new Set<string>([seedId]);
  let frontier = new Set<string>([seedId]);
  for (let i = 0; i < k; i++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const nbr of adj.get(id) ?? []) {
        if (!reached.has(nbr)) {
          reached.add(nbr);
          next.add(nbr);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return reached;
}

// ─── Multi-term search ───────────────────────────────────────────────────────

function matchesSearch(node: EnrichedNode, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = node.id.toLowerCase();
  return terms.some(t => hay.includes(t));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DevVisualiserPanelV4() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The library mounts its own DOM into this host — keep it free of React
  // children. Overlays live as siblings stacked above by CSS.
  const fgHostRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraph3DInstance | null>(null);
  // Persistent cache for card textures — keyed on (label, sub, layer, score
  // band, colour, dimmed). Survives re-renders so panning doesn't repaint.
  const textureCacheRef = useRef<Map<string, THREE.CanvasTexture>>(new Map());

  const [graph, setGraph] = useState<Codegraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters / options
  const [search, setSearch] = useState("");
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [layerFilter, setLayerFilter] = useState<string | null>(null);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [kHops, setKHops] = useState(0); // 0 = isolate off
  const [selectedNode, setSelectedNode] = useState<EnrichedNode | null>(null);
  const [linkOpacity, setLinkOpacity] = useState(0.25);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fetch the codegraph snapshot.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiSite<Codegraph>("/admin/dev/codegraph", { method: "GET" })
      .then(g => {
        if (cancelled) return;
        setGraph(g);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Enrich nodes with cluster id (Louvain) — once per graph load.
  const enriched: EnrichedNode[] = useMemo(() => {
    if (!graph) return [];
    const clusters = computeClusters(graph);
    return graph.nodes.map(n => ({ ...n, cluster: clusters.get(n.id) ?? 0 }));
  }, [graph]);

  const clusterStats: ClusterStat[] = useMemo(
    () => (enriched.length ? summariseClusters(enriched) : []),
    [enriched]
  );

  // Distinct layers + their counts, for the layer filter chips.
  const layerStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of enriched) counts.set(n.layer, (counts.get(n.layer) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([layer, count]) => ({ layer, count }))
      .sort((a, b) => b.count - a.count);
  }, [enriched]);

  const searchTerms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search]
  );

  // K-hops isolate set — only populated when both a node is selected AND
  // kHops > 0. Otherwise null = no constraint.
  const isolateSet = useMemo<Set<string> | null>(() => {
    if (!selectedNode || kHops <= 0 || !graph) return null;
    return kHopsNeighbourhood(selectedNode.id, kHops, enriched, graph.edges);
  }, [selectedNode, kHops, enriched, graph]);

  // Single dimming predicate consulted by both node and link encoders.
  const dimNode = useCallback((n: EnrichedNode) => {
    if (!matchesSearch(n, searchTerms)) return true;
    if (selectedClusterId !== null && n.cluster !== selectedClusterId) return true;
    if (layerFilter && n.layer !== layerFilter) return true;
    if (sideFilter !== "all" && n.side !== sideFilter) return true;
    if (isolateSet && !isolateSet.has(n.id)) return true;
    return false;
  }, [searchTerms, selectedClusterId, layerFilter, sideFilter, isolateSet]);

  // Initialise the 3D force-graph (one-time).
  // The host MUST be empty (no React children) at the time we hand it to
  // ForceGraph3D — otherwise React reconciles children the library
  // imperatively inserted and crashes on unmount.
  useEffect(() => {
    const host = fgHostRef.current;
    if (!host || fgRef.current) return;
    const fg = new ForceGraph3D(host);
    fg.backgroundColor("#0a0e14")
      .showNavInfo(false)
      .nodeLabel((n: any) => n.id)
      .linkDirectionalParticles(0)
      .linkColor(() => "rgba(255,255,255,0.35)")
      .onNodeClick((n: any) => {
        setSelectedNode(n as EnrichedNode);
        const dist = 80;
        const distRatio = 1 + dist / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
        fg.cameraPosition(
          { x: (n.x || 0) * distRatio, y: (n.y || 0) * distRatio, z: (n.z || 0) * distRatio },
          n,
          1200
        );
      });
    fgRef.current = fg;

    // Space-bar to pan (Figma / Sketch convention). While space is held,
    // left-drag pans instead of orbiting; releasing space restores rotate.
    // We mutate OrbitControls.mouseButtons directly — that's the only
    // clean way to override Three's default LEFT=ROTATE binding without
    // re-implementing controls.
    const controls = fg.controls() as {
      mouseButtons?: { LEFT?: number; MIDDLE?: number; RIGHT?: number };
    };
    const defaultLeft = controls.mouseButtons?.LEFT;
    let spaceHeld = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || spaceHeld) return;
      // Don't hijack space inside input/textarea (e.g. the search field).
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      spaceHeld = true;
      if (controls.mouseButtons) {
        // THREE.MOUSE.PAN = 2. Inlined so we don't need a THREE import
        // just for the enum value.
        controls.mouseButtons.LEFT = 2;
      }
      host.style.cursor = "grab";
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !spaceHeld) return;
      spaceHeld = false;
      if (controls.mouseButtons && defaultLeft !== undefined) {
        controls.mouseButtons.LEFT = defaultLeft;
      }
      host.style.cursor = "";
    };
    const onMouseDown = () => { if (spaceHeld) host.style.cursor = "grabbing"; };
    const onMouseUp = () => { if (spaceHeld) host.style.cursor = "grab"; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    host.addEventListener("mousedown", onMouseDown);
    host.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      host.removeEventListener("mousedown", onMouseDown);
      host.removeEventListener("mouseup", onMouseUp);
      try {
        const destructor = (fg as unknown as { _destructor?: () => void })._destructor;
        if (typeof destructor === "function") destructor.call(fg);
      } catch { /* noop */ }
      fgRef.current = null;
      if (host) {
        while (host.firstChild) host.removeChild(host.firstChild);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data + visual encoders whenever inputs change.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || enriched.length === 0 || !graph) return;

    fg.graphData({
      nodes: enriched,
      links: graph.edges.map(e => ({ ...e })),
    });

    // V2-style card: 16×8 box with a CanvasTexture on the front face.
    // Depth encodes criticality (was emissive on the sphere); width/height
    // stay fixed so cards read at a consistent size when zoomed in. SLOC is
    // shown numerically on the card rather than via geometry — keeps cards
    // legible at any scale and reserves geometry channels for criticality.
    fg.nodeThreeObject((n: any) => {
      const node = n as EnrichedNode;
      const isDim = dimNode(node);
      const colour = clusterColour(node.cluster);
      const depth = Math.max(1, Math.min(6, 1 + Math.log2(node.criticality + 1)));
      const tex = buildCardTexture(
        textureCacheRef.current,
        node.id,
        node.layer,
        node.criticality,
        colour,
        isDim,
      );
      const cardMat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: isDim ? 0.3 : 1,
      });
      const sideMat = new THREE.MeshBasicMaterial({
        color: colour,
        opacity: isDim ? 0.12 : 0.85,
        transparent: true,
      });
      // Box materials: [+X, -X, +Y, -Y, +Z (front, card), -Z (back)]
      const materials = [sideMat, sideMat, sideMat, sideMat, cardMat, sideMat];
      const geometry = new THREE.BoxGeometry(16, 8, depth);
      return new THREE.Mesh(geometry, materials);
    });

    fg.linkVisibility((l: any) => {
      const s = (typeof l.source === "object" ? l.source : enriched.find(n => n.id === l.source)) as EnrichedNode | undefined;
      const t = (typeof l.target === "object" ? l.target : enriched.find(n => n.id === l.target)) as EnrichedNode | undefined;
      if (!s || !t) return true;
      return !(dimNode(s) && dimNode(t));
    });

    fg.linkOpacity(linkOpacity);
  }, [enriched, graph, dimNode, linkOpacity]);

  // ── Camera helpers ───────────────────────────────────────────────────────

  const focusCluster = useCallback((clusterId: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const members = enriched.filter(n => n.cluster === clusterId);
    if (members.length === 0) return;
    const cx = members.reduce((a, n) => a + (n.x || 0), 0) / members.length;
    const cy = members.reduce((a, n) => a + (n.y || 0), 0) / members.length;
    const cz = members.reduce((a, n) => a + (n.z || 0), 0) / members.length;
    fg.cameraPosition({ x: cx * 1.6, y: cy * 1.6, z: cz * 1.6 + 120 }, { x: cx, y: cy, z: cz }, 1200);
  }, [enriched]);

  const resetView = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 1200);
    setSelectedNode(null);
    setSelectedClusterId(null);
    setLayerFilter(null);
    setSideFilter("all");
    setKHops(0);
    setSearch("");
  }, []);

  // ── Fullscreen ───────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!rootRef.current) return;
    if (document.fullscreenElement === rootRef.current) {
      document.exitFullscreen?.();
      return;
    }
    rootRef.current.requestFullscreen?.();
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  const activeFilterCount =
    (selectedClusterId !== null ? 1 : 0) +
    (layerFilter ? 1 : 0) +
    (sideFilter !== "all" ? 1 : 0) +
    (kHops > 0 && selectedNode ? 1 : 0) +
    (searchTerms.length > 0 ? 1 : 0);

  return (
    <div ref={rootRef} className={`dui-viz-v4${isFullscreen ? " is-fullscreen" : ""}`}>
      <header className="dui-viz-v4__header">
        <div className="dui-viz-v4__brand">
          <span className="dui-viz-v4__brand-mark">V4</span>
          <div>
            <div className="dui-viz-v4__eyebrow">Code Atlas</div>
            <div className="dui-viz-v4__title">Relationships in three dimensions</div>
          </div>
        </div>
        <div className="dui-viz-v4__kpis">
          <Kpi label="Files" value={enriched.length} />
          <Kpi label="Edges" value={graph?.edges.length ?? 0} />
          <Kpi label="Clusters" value={clusterStats.length} />
          <Kpi
            label="Hottest"
            value={
              enriched.length
                ? (enriched.reduce((a, b) => (b.criticality > a.criticality ? b : a)).id.split("/").pop() ?? "—")
                : "—"
            }
            small
          />
        </div>
        <div className="dui-viz-v4__header-actions">
          <button
            type="button"
            className="dui-viz-v4__btn"
            onClick={resetView}
            disabled={activeFilterCount === 0 && !selectedNode}
            title="Clear all filters and recenter camera"
          >
            Reset {activeFilterCount > 0 && <span className="dui-viz-v4__btn-badge">{activeFilterCount}</span>}
          </button>
          <button
            type="button"
            className="dui-viz-v4__btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </header>

      <div className="dui-viz-v4__body">
        <aside className="dui-viz-v4__rail">
          <div className="dui-viz-v4__search">
            <input
              className="dui-viz-v4__search-input"
              placeholder="Search (space = OR)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Side filter */}
          <div className="dui-viz-v4__rail-section-title">Side</div>
          <div className="dui-viz-v4__chips">
            {(["all", "frontend", "backend"] as SideFilter[]).map(s => (
              <button
                key={s}
                type="button"
                className={`dui-viz-v4__chip${sideFilter === s ? " is-active" : ""}`}
                onClick={() => setSideFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Layer filter */}
          <div className="dui-viz-v4__rail-section-title">Layer</div>
          <div className="dui-viz-v4__chips">
            <button
              type="button"
              className={`dui-viz-v4__chip${layerFilter === null ? " is-active" : ""}`}
              onClick={() => setLayerFilter(null)}
            >
              all
            </button>
            {layerStats.map(l => (
              <button
                key={l.layer}
                type="button"
                className={`dui-viz-v4__chip${layerFilter === l.layer ? " is-active" : ""}`}
                onClick={() => setLayerFilter(layerFilter === l.layer ? null : l.layer)}
                title={`${l.count} ${l.layer} file${l.count === 1 ? "" : "s"}`}
              >
                {l.layer}
                <span className="dui-viz-v4__chip-count">{l.count}</span>
              </button>
            ))}
          </div>

          {/* K-hops isolate */}
          <div className="dui-viz-v4__rail-section-title">
            Isolate (K-hops)
            {selectedNode && kHops > 0 && (
              <span className="dui-viz-v4__rail-aside">
                from {selectedNode.id.split("/").pop()}
              </span>
            )}
          </div>
          <div className="dui-viz-v4__chips">
            {[0, 1, 2, 3].map(k => (
              <button
                key={k}
                type="button"
                className={`dui-viz-v4__chip${kHops === k ? " is-active" : ""}`}
                onClick={() => setKHops(k)}
                disabled={k > 0 && !selectedNode}
                title={k === 0 ? "Off" : `Show ${k}-hop neighbours of the selected node`}
              >
                {k === 0 ? "off" : `${k} hop${k > 1 ? "s" : ""}`}
              </button>
            ))}
          </div>

          {/* Clusters */}
          <div className="dui-viz-v4__rail-section-title">Clusters</div>
          <ul className="dui-viz-v4__cluster-list">
            <li
              className={`dui-viz-v4__cluster${selectedClusterId === null ? " is-active" : ""}`}
              onClick={() => setSelectedClusterId(null)}
            >
              <span className="dui-viz-v4__cluster-swatch" style={{ background: "linear-gradient(90deg,#4ea1ff,#a07ade,#ff6b6b)" }} />
              <span className="dui-viz-v4__cluster-label">All clusters</span>
              <span className="dui-viz-v4__cluster-count">{enriched.length}</span>
            </li>
            {clusterStats.map(c => (
              <li
                key={c.id}
                className={`dui-viz-v4__cluster${selectedClusterId === c.id ? " is-active" : ""}`}
                onClick={() => {
                  setSelectedClusterId(c.id);
                  focusCluster(c.id);
                }}
                title={`${c.size} files · ${c.totalSloc.toLocaleString()} SLOC · top: ${c.topNode.id.split("/").pop()}`}
              >
                <span className="dui-viz-v4__cluster-swatch" style={{ background: c.colour }} />
                <span className="dui-viz-v4__cluster-label">Cluster {c.id}</span>
                <span className="dui-viz-v4__cluster-count">{c.size}</span>
              </li>
            ))}
          </ul>

          {/* Edge opacity */}
          <div className="dui-viz-v4__rail-section-title">Edge opacity</div>
          <input
            className="dui-viz-v4__slider"
            type="range"
            min={0.02}
            max={1}
            step={0.02}
            value={linkOpacity}
            onChange={e => setLinkOpacity(parseFloat(e.target.value))}
          />
        </aside>

        <div className="dui-viz-v4__stage">
          {/* React MUST NOT own children of fgHost — ForceGraph3D mounts
              its canvas + helper DOM imperatively into this node. Overlays
              live as siblings, stacked above by CSS. */}
          <div className="dui-viz-v4__stage-host" ref={fgHostRef} />
          {loading && <div className="dui-viz-v4__overlay">Loading code graph…</div>}
          {error && <div className="dui-viz-v4__overlay dui-viz-v4__overlay--error">Failed to load: {error}</div>}
        </div>

        {selectedNode && (
          <aside className="dui-viz-v4__flyout">
            <button
              className="dui-viz-v4__flyout-close"
              onClick={() => setSelectedNode(null)}
              aria-label="Close"
            >
              ×
            </button>
            <div className="dui-viz-v4__flyout-eyebrow">{selectedNode.side} · {selectedNode.layer}</div>
            <div className="dui-viz-v4__flyout-title">{selectedNode.id}</div>
            <dl className="dui-viz-v4__flyout-stats">
              <div><dt>SLOC</dt><dd>{selectedNode.sloc.toLocaleString()}</dd></div>
              <div><dt>Fan-in</dt><dd>{selectedNode.fan_in}</dd></div>
              <div><dt>Fan-out</dt><dd>{selectedNode.fan_out}</dd></div>
              <div><dt>Criticality</dt><dd>{selectedNode.criticality.toFixed(2)}</dd></div>
              <div><dt>Cluster</dt><dd style={{ color: clusterColour(selectedNode.cluster) }}>#{selectedNode.cluster}</dd></div>
              <div><dt>Folder</dt><dd>{selectedNode.folder}</dd></div>
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}

// ─── KPI chip ────────────────────────────────────────────────────────────────

function Kpi({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className={`dui-viz-v4__metric${small ? " dui-viz-v4__metric_small" : ""}`}>
      <div className="dui-viz-v4__metric-value">{value}</div>
      <div className="dui-viz-v4__metric-label">{label}</div>
    </div>
  );
}
