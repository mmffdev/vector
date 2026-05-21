"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "@/app/components/Panel";
import { apiSite } from "@/app/lib/api";

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

  const edgeKey = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    if (!s || !t) continue;
    if (s.folder === t.folder) continue;
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

// Connected-component map: nodeId → Set<member nodeId>. Reachability is
// undirected — any chain of links counts. Used by drag handlers to translate
// the whole cluster as a rigid block.
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

// Score each node by fan-in + fan-out. Cheap but useful — bigger cube = more
// connected. Mirrors the cheap-and-cheerful first pass of DevLens's scoring
// (no LLM, no percentile normalisation; we can graduate to that later).
function computeScores(graph: Codegraph): Map<string, number> {
  const scores = new Map<string, number>();
  for (const n of graph.nodes) scores.set(n.id, 0);
  for (const e of graph.edges) {
    scores.set(e.source, (scores.get(e.source) ?? 0) + 1);
    scores.set(e.target, (scores.get(e.target) ?? 0) + 1);
  }
  return scores;
}

// Build a card-as-canvas texture: title + type chip + score chip. DPI-aware
// so the text stays crisp at zoom. Cached by content key — rebuilding the
// same texture every frame would tank perf on 300+ node graphs.
function buildCardTexture(
  THREE: any,
  cache: Map<string, any>,
  name: string,
  layer: string,
  score: number,
  colour: string,
): any {
  const label = name.split("/").pop() || name;
  const sub = name.length > label.length ? name.slice(0, -label.length).replace(/\/$/, "") : "";
  const key = `${label}|${sub}|${layer}|${score}|${colour}`;
  if (cache.has(key)) return cache.get(key);

  const W = 512;
  const H = 256;
  const dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // Card body — dark surface, coloured top stripe by layer.
  ctx.fillStyle = "#1a1f29";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, W, 18);

  // Layer + score chips at top-right of the body.
  ctx.font = "bold 22px ui-monospace, Menlo, monospace";
  ctx.fillStyle = colour;
  ctx.textAlign = "right";
  ctx.fillText(layer.toUpperCase(), W - 16, 56);
  ctx.font = "16px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#9aa4b2";
  ctx.fillText(`${score}`, W - 16, 80);

  // Path crumb (folder prefix), small + dim.
  ctx.textAlign = "left";
  ctx.fillStyle = "#6b7585";
  ctx.font = "18px ui-monospace, Menlo, monospace";
  const subTrim = sub.length > 40 ? "…" + sub.slice(-37) : sub;
  ctx.fillText(subTrim, 16, 56);

  // Leaf name — biggest text on the card.
  ctx.fillStyle = "#e6ecf3";
  ctx.font = "bold 36px ui-sans-serif, system-ui, sans-serif";
  const labelTrim = label.length > 22 ? label.slice(0, 21) + "…" : label;
  ctx.fillText(labelTrim, 16, 130);

  // Tiny side stripe by side (frontend/backend) at the bottom — encodes the
  // tier without competing with the layer colour.
  ctx.fillStyle = colour;
  ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(layer, 16, 200);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export default function DevVisualiserCubesPanel() {
  const [graph, setGraph] = useState<Codegraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("folders");
  const [showBridges, setShowBridges] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<any>(null);
  const textureCacheRef = useRef<Map<string, any>>(new Map());

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

  const scores = useMemo(() => {
    if (!displayGraph) return new Map<string, number>();
    return computeScores(displayGraph);
  }, [displayGraph]);

  useEffect(() => {
    if (!displayGraph || !containerRef.current) return;

    let cancelled = false;
    (async () => {
      const [{ default: ForceGraph3D }, THREE, { default: SpriteText }] = await Promise.all([
        import("3d-force-graph"),
        import("three"),
        import("three-spritetext"),
      ]);
      if (cancelled || !containerRef.current) return;

      const cache = textureCacheRef.current;

      // Snapshot the data — same object refs used by drag handlers to
      // translate the whole connected component as a rigid block.
      const nodes = displayGraph.nodes.map(n => ({ ...n })) as any[];
      const links = displayGraph.edges.map(e => ({ ...e })) as any[];
      const clusterOf = buildClusterMap(nodes, links);

      // Drag state — captured at dragstart, applied per tick, finalised at end.
      let dragCluster: any[] | null = null;
      let dragAnchor: { x: number; y: number; z: number } | null = null;

      const nodeThreeObject = (n: any) => {
        const colour = LAYER_COLOUR[n.layer] ?? "#888";
        const score = scores.get(n.id) ?? 0;
        // Cube depth encodes importance: thicker = more connected.
        // Clamp 1–6 so the layout doesn't get crushed by mega-hubs.
        const depth = Math.max(1, Math.min(6, 1 + Math.log2(score + 1)));
        const tex = buildCardTexture(THREE, cache, n.id, n.layer, score, colour);

        // Six-material cube: front face shows the card, the other five get
        // a flat tinted material so the cube reads as a solid coloured slab
        // when seen from any angle other than head-on.
        const cardMat = new THREE.MeshBasicMaterial({ map: tex });
        const sideMat = new THREE.MeshBasicMaterial({ color: colour, opacity: 0.85, transparent: true });
        // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z. We put the
        // card on +Z (the face the camera tends to find first when 3d-force-graph
        // initialises the layout).
        const materials = [sideMat, sideMat, sideMat, sideMat, cardMat, sideMat];
        const geometry = new THREE.BoxGeometry(16, 8, depth);
        const mesh = new THREE.Mesh(geometry, materials);
        return mesh;
      };

      const linkThreeObject = (e: any) => {
        // 3d-force-graph's typings require an Object3D — return an empty
        // Group when labels are off so the type stays happy and nothing
        // renders.
        if (!showEdgeLabels) return new THREE.Group();
        const kind = e.kind as "import" | "bridge";
        const text = new SpriteText(kind);
        text.color = kind === "bridge" ? "#ffffff" : "#7a8aa0";
        text.textHeight = 1.2;
        text.backgroundColor = "rgba(0,0,0,0.6)";
        text.padding = 1;
        text.borderRadius = 1;
        return text;
      };

      // Position the label sprite at the edge midpoint each frame.
      const linkPositionUpdate = (sprite: any, { start, end }: any) => {
        if (!sprite) return false;
        sprite.position.set(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          (start.z + end.z) / 2,
        );
        return true;
      };

      if (!fgRef.current) {
        fgRef.current = new ForceGraph3D(containerRef.current)
          .backgroundColor("#0d1117")
          // Crush the elastic — high velocity decay = no bounce, low cooldown
          // ticks = sim quits fighting back fast.
          .d3VelocityDecay(0.85)
          .cooldownTicks(60)
          .nodeThreeObject(nodeThreeObject)
          .nodeLabel((n: any) => `<div style="background:#111;color:#fff;padding:4px 8px;border-radius:4px;font-family:monospace;font-size:11px">${n.id}<br/><span style="opacity:.6">${n.layer} · ${n.side} · score ${scores.get(n.id) ?? 0}</span></div>`)
          .linkColor((e: any) => (e.kind === "bridge" ? "#ffffff" : "#3a4a5c"))
          .linkOpacity(0.5)
          .linkWidth((e: any) => (e.kind === "bridge" ? 0.6 : 0.2))
          .linkDirectionalArrowLength(3)
          .linkDirectionalArrowRelPos(0.95)
          .linkDirectionalParticles((e: any) => (e.kind === "bridge" ? 2 : 0))
          .linkDirectionalParticleWidth(1.5)
          .linkThreeObjectExtend(true)
          .linkThreeObject(linkThreeObject)
          .linkPositionUpdate(linkPositionUpdate)
          .onNodeHover((n: any) => setHoveredNode(n ?? null))
          // Click a node → re-centre the orbit pivot AND frame the card
          // dead-on. The cube's card face sits on its local +Z; since the
          // force layout never rotates nodes (only translates them), local
          // +Z == world +Z. We position the camera at node.z + standoff and
          // look back at the node, which puts the card centred + facing the
          // viewer. Camera's default up vector is world +Y → the card's
          // top edge maps to screen-up → text reads horizontally.
          .onNodeClick((node: any) => {
            const fg = fgRef.current;
            if (!fg) return;
            const standoff = 60;
            fg.cameraPosition(
              { x: node.x ?? 0, y: node.y ?? 0, z: (node.z ?? 0) + standoff },
              { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
              600,
            );
          })
          // Drag the whole connected component as a rigid block, then pin
          // every member on drag-end so the cluster freezes in place.
          .onNodeDrag((node: any, translate: any) => {
            if (!dragCluster) {
              const ids = clusterOf.get(node.id);
              if (!ids) return;
              dragCluster = nodes.filter(n => ids.has(n.id) && n !== node);
              dragAnchor = { x: translate.x, y: translate.y, z: translate.z };
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
      } else {
        // Re-bind dynamic callbacks so toggles (edge labels, scores) take effect.
        fgRef.current
          .nodeThreeObject(nodeThreeObject)
          .linkThreeObject(linkThreeObject)
          .linkPositionUpdate(linkPositionUpdate);
      }

      fgRef.current.graphData({
        nodes: displayGraph.nodes.map(n => ({ ...n })),
        links: displayGraph.edges.map(e => ({ ...e })),
      });

      const rect = containerRef.current.getBoundingClientRect();
      fgRef.current.width(rect.width).height(rect.height);
    })();

    return () => {
      cancelled = true;
    };
  }, [displayGraph, scores, showEdgeLabels]);

  const usedLayers = useMemo(() => {
    if (!displayGraph) return [];
    const s = new Set<string>();
    displayGraph.nodes.forEach(n => s.add(n.layer));
    return Array.from(s).sort();
  }, [displayGraph]);

  return (
    <Panel name="dev_visualiser_cubes" title="Visualiser (Cubes)">
      <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Code Graph — Cubes</h1>
            <p className="dui-page__subtitle">
              Prototype: cards-on-cubes nodes with billboarded edge-type labels.
              Cube thickness encodes connection count (fan-in + fan-out).
              Side-by-side with the original spheres visualiser; same{" "}
              <code>codegraph.json</code> data.
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
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginLeft: 12 }}>
            <input
              type="checkbox"
              checked={showEdgeLabels}
              onChange={e => setShowEdgeLabels(e.target.checked)}
            />
            Edge labels
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
                {hoveredNode.layer} · {hoveredNode.side} · score {scores.get(hoveredNode.id) ?? 0}
              </span>
            </div>
          )}
        </div>

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
                  borderRadius: 2,
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
