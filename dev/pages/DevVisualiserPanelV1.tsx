"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiSite } from "@/app/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

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
type LeftPanelId = "files" | null;

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

// ─── Pure helpers ─────────────────────────────────────────────────────────────

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

// Connected-component map: nodeId → Set<member nodeId>. Used by drag handlers
// to translate the whole cluster as a rigid block.
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

// Fan-in + fan-out score. Cheap proxy for "how connected is this node".
function computeScores(graph: Codegraph): Map<string, number> {
  const scores = new Map<string, number>();
  for (const n of graph.nodes) scores.set(n.id, 0);
  for (const e of graph.edges) {
    scores.set(e.source, (scores.get(e.source) ?? 0) + 1);
    scores.set(e.target, (scores.get(e.target) ?? 0) + 1);
  }
  return scores;
}

// Build the card-face canvas texture. Cached by content key.
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

  ctx.fillStyle = "#1a1f29";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, W, 18);

  ctx.font = "bold 22px ui-monospace, Menlo, monospace";
  ctx.fillStyle = colour;
  ctx.textAlign = "right";
  ctx.fillText(layer.toUpperCase(), W - 16, 56);
  ctx.font = "16px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#9aa4b2";
  ctx.fillText(`${score}`, W - 16, 80);

  ctx.textAlign = "left";
  ctx.fillStyle = "#6b7585";
  ctx.font = "18px ui-monospace, Menlo, monospace";
  const subTrim = sub.length > 40 ? "…" + sub.slice(-37) : sub;
  ctx.fillText(subTrim, 16, 56);

  ctx.fillStyle = "#e6ecf3";
  ctx.font = "bold 36px ui-sans-serif, system-ui, sans-serif";
  const labelTrim = label.length > 22 ? label.slice(0, 21) + "…" : label;
  ctx.fillText(labelTrim, 16, 130);

  ctx.fillStyle = colour;
  ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(layer, 16, 200);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

// Fixed framing geometry — every clicked card lands at the same screen size.
function computeStandoff(camera: any) {
  const CARD_WIDTH = 16;
  const CARD_HEIGHT = 8;
  const MARGIN = 1.6;
  const fovRad = ((camera.fov ?? 60) * Math.PI) / 180;
  const aspect = camera.aspect ?? 16 / 9;
  const fitHeight = (CARD_HEIGHT / 2) / Math.tan(fovRad / 2);
  const fitWidth = (CARD_WIDTH / 2) / (Math.tan(fovRad / 2) * aspect);
  return Math.max(fitHeight, fitWidth) * MARGIN;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DevVisualiserPanelV1() {
  const [graph, setGraph] = useState<Codegraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("folders");
  const [showBridges, setShowBridges] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // Left rail / panel state
  const [leftPanel, setLeftPanel] = useState<LeftPanelId>(null);
  const [fileSearch, setFileSearch] = useState("");

  // Selected node + its source code preview (right side)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<any>(null);
  const textureCacheRef = useRef<Map<string, any>>(new Map());

  // Latest simulation node references — written every effect run so the
  // (long-lived) ForceGraph3D click/drag handlers can read fresh data
  // instead of capturing stale closures from the first mount.
  const liveNodesRef = useRef<any[]>([]);
  const liveClusterRef = useRef<Map<string, Set<string>>>(new Map());

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

  // ── Source-preview loader. Triggered by selectedId changes.
  useEffect(() => {
    if (!selectedId) {
      setSourceCode(null);
      setSourceError(null);
      return;
    }
    // We only request source for FILE-level nodes (path ends with a file
    // extension); folder-level selections show no source.
    if (!/\.[a-z0-9]+$/i.test(selectedId)) {
      setSourceCode(null);
      setSourceError("Select a file (not a folder) to preview source.");
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    setSourceError(null);
    (async () => {
      try {
        // apiSite expects a JSON return; raw text needs fetch direct.
        const res = await fetch(`/_site/admin/dev/source?path=${encodeURIComponent(selectedId)}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          setSourceError(`HTTP ${res.status}: ${await res.text()}`);
          setSourceCode(null);
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        setSourceCode(text);
      } catch (e: any) {
        if (cancelled) return;
        setSourceError(e?.message ?? "Failed to load source.");
        setSourceCode(null);
      } finally {
        if (!cancelled) setSourceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ── Frame a node — pulled out so it can be called from clicks in the
  // canvas AND from clicks in the File Explorer panel.
  const frameNode = useCallback((nodeId: string) => {
    console.log("[viz] frameNode entry", { nodeId });
    const fg = fgRef.current;
    if (!fg) {
      console.warn("[viz] frameNode aborted — no ForceGraph instance");
      return;
    }
    const node = liveNodesRef.current.find(n => n.id === nodeId);
    if (!node) {
      console.warn("[viz] frameNode aborted — node not in liveNodesRef", {
        nodeId,
        liveCount: liveNodesRef.current.length,
        firstThreeIds: liveNodesRef.current.slice(0, 3).map(n => n.id),
      });
      return;
    }
    if (typeof node.x !== "number" || typeof node.y !== "number" || typeof node.z !== "number") {
      console.warn("[viz] frameNode aborted — sim not warm", {
        nodeId,
        x: node.x, y: node.y, z: node.z,
      });
      return;
    }
    const camera = fg.camera() as any;
    const controls = fg.controls() as any;
    camera.up.set(0, 1, 0);
    const standoff = computeStandoff(camera);
    console.log("[viz] frameNode flying camera", {
      nodeId,
      from: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      to: { x: node.x, y: node.y, z: node.z + standoff },
      lookAt: { x: node.x, y: node.y, z: node.z },
      standoff,
    });
    fg.cameraPosition(
      { x: node.x, y: node.y, z: node.z + standoff },
      { x: node.x, y: node.y, z: node.z },
      600,
    );
    setTimeout(() => {
      if (controls?.target?.set) {
        controls.target.set(node.x, node.y, node.z);
        controls.update?.();
        console.log("[viz] frameNode pivot set on controls.target", {
          nodeId,
          target: { x: node.x, y: node.y, z: node.z },
        });
      } else {
        console.warn("[viz] frameNode could not access controls.target", {
          hasControls: !!controls,
        });
      }
    }, 650);
  }, []);

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

      // Fresh per-effect data. We assign these to refs so handlers attached
      // ONCE at mount can still see today's data.
      const nodes = displayGraph.nodes.map(n => ({ ...n })) as any[];
      const links = displayGraph.edges.map(e => ({ ...e })) as any[];
      liveNodesRef.current = nodes;
      liveClusterRef.current = buildClusterMap(nodes, links);

      // Drag state — captured at dragstart, applied per tick, finalised at end.
      let dragCluster: any[] | null = null;
      let dragAnchor: { x: number; y: number; z: number } | null = null;

      const nodeThreeObject = (n: any) => {
        const colour = LAYER_COLOUR[n.layer] ?? "#888";
        const score = scores.get(n.id) ?? 0;
        const depth = Math.max(1, Math.min(6, 1 + Math.log2(score + 1)));
        const tex = buildCardTexture(THREE, cache, n.id, n.layer, score, colour);

        const cardMat = new THREE.MeshBasicMaterial({ map: tex });
        const sideMat = new THREE.MeshBasicMaterial({ color: colour, opacity: 0.85, transparent: true });
        const materials = [sideMat, sideMat, sideMat, sideMat, cardMat, sideMat];
        const geometry = new THREE.BoxGeometry(16, 8, depth);
        const mesh = new THREE.Mesh(geometry, materials);
        return mesh;
      };

      const linkThreeObject = (e: any) => {
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

      const linkPositionUpdate = (sprite: any, { start, end }: any) => {
        if (!sprite) return false;
        sprite.position.set(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          (start.z + end.z) / 2,
        );
        return true;
      };

      // Handlers read through the refs so they get fresh data on every
      // effect re-run. Closures capture refs, refs hold latest values.
      const handleClick = (node: any) => {
        console.log("[viz] onNodeClick fired", {
          id: node?.id,
          x: node?.x, y: node?.y, z: node?.z,
          hasFx: typeof node?.fx === "number",
          liveCount: liveNodesRef.current.length,
        });
        const liveNode = liveNodesRef.current.find(n => n.id === node.id);
        if (!liveNode) {
          console.warn("[viz] handleClick aborted — id not in liveNodesRef", {
            id: node?.id,
            firstThreeIds: liveNodesRef.current.slice(0, 3).map(n => n.id),
          });
          return;
        }
        setSelectedId(node.id);
        if (
          typeof liveNode.x !== "number" ||
          typeof liveNode.y !== "number" ||
          typeof liveNode.z !== "number"
        ) {
          console.log("[viz] handleClick rAF retry — sim not warm", {
            id: node.id,
            liveX: liveNode.x, liveY: liveNode.y, liveZ: liveNode.z,
          });
          requestAnimationFrame(() => frameNode(node.id));
          return;
        }
        frameNode(node.id);
      };

      const handleDrag = (node: any, translate: any) => {
        const cluster = liveClusterRef.current;
        if (!dragCluster) {
          const ids = cluster.get(node.id);
          if (!ids) return;
          dragCluster = liveNodesRef.current.filter(n => ids.has(n.id) && n !== node);
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
      };

      const handleDragEnd = (node: any) => {
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
      };

      if (!fgRef.current) {
        fgRef.current = new ForceGraph3D(containerRef.current)
          .backgroundColor("#0d1117")
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
          .onNodeClick(handleClick)
          .onNodeDrag(handleDrag)
          .onNodeDragEnd(handleDragEnd);
      } else {
        // Re-bind ALL dynamic callbacks — including click + drag — so they
        // close over the fresh nodes/cluster/scores from this effect run.
        // The previous version rebuilt only the visual callbacks, leaving
        // onNodeClick pointing at the first-mount closure (stale x/y/z).
        fgRef.current
          .nodeThreeObject(nodeThreeObject)
          .linkThreeObject(linkThreeObject)
          .linkPositionUpdate(linkPositionUpdate)
          .onNodeClick(handleClick)
          .onNodeDrag(handleDrag)
          .onNodeDragEnd(handleDragEnd);
      }

      fgRef.current.graphData({ nodes, links });

      const rect = containerRef.current.getBoundingClientRect();
      fgRef.current.width(rect.width).height(rect.height);
    })();

    return () => {
      cancelled = true;
    };
  }, [displayGraph, scores, showEdgeLabels, frameNode]);

  const usedLayers = useMemo(() => {
    if (!displayGraph) return [];
    const s = new Set<string>();
    displayGraph.nodes.forEach(n => s.add(n.layer));
    return Array.from(s).sort();
  }, [displayGraph]);

  // ── File Explorer data — grouped by folder, filtered by the search box.
  const fileTree = useMemo(() => {
    if (!graph) return [] as { folder: string; files: GraphNode[] }[];
    const groups = new Map<string, GraphNode[]>();
    for (const n of graph.nodes) {
      const arr = groups.get(n.folder) ?? [];
      arr.push(n);
      groups.set(n.folder, arr);
    }
    const folders = Array.from(groups.keys()).sort();
    const q = fileSearch.trim().toLowerCase();
    return folders
      .map(folder => ({
        folder,
        files: (groups.get(folder) ?? [])
          .filter(f => !q || f.id.toLowerCase().includes(q) || folder.toLowerCase().includes(q))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .filter(g => g.files.length > 0);
  }, [graph, fileSearch]);

  const onFilePick = useCallback((id: string) => {
    setSelectedId(id);
    // If we're in Folders view, switch to Files so the node exists in the
    // current simulation — otherwise frameNode finds no node.
    if (view === "folders" && /\.[a-z0-9]+$/i.test(id)) {
      setView("files");
      // give the new sim a moment to settle before framing
      setTimeout(() => frameNode(id), 300);
    } else {
      frameNode(id);
    }
  }, [view, frameNode]);

  return (
    <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Code Graph</h1>
            <p className="dui-page__subtitle">
              Unified force-directed graph of the codebase: frontend (TS/TSX), backend (Go), and the HTTP bridges between them.
              Click a card to frame it and load its source. Use the File Explorer rail on the left to jump to any node.
              Refresh the snapshot with <code>bash dev/scripts/audit_codegraph.sh</code> (or <code>&lt;audit&gt; -graph</code>).
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

        {/* ── Stage: left rail + canvas + right source panel ────────────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            width: "100%",
            height: "75vh",
            marginTop: 8,
            borderRadius: 6,
            overflow: "hidden",
            background: "#0d1117",
          }}
        >
          {/* Left rail */}
          <div
            style={{
              width: 44,
              flexShrink: 0,
              background: "#090c10",
              borderRight: "1px solid #1a1f29",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "8px 0",
              gap: 4,
            }}
          >
            <RailButton
              active={leftPanel === "files"}
              onClick={() => setLeftPanel(prev => (prev === "files" ? null : "files"))}
              title="File Explorer"
              label="📁"
            />
          </div>

          {/* File Explorer panel */}
          {leftPanel === "files" && (
            <div
              style={{
                width: 320,
                flexShrink: 0,
                background: "#0f1419",
                borderRight: "1px solid #1a1f29",
                display: "flex",
                flexDirection: "column",
                color: "#e6ecf3",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderBottom: "1px solid #1a1f29",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                File Explorer
                <button
                  onClick={() => setLeftPanel(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#6b7585",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                  aria-label="Close panel"
                >
                  ×
                </button>
              </div>
              <div style={{ padding: 10, borderBottom: "1px solid #1a1f29" }}>
                <input
                  type="text"
                  value={fileSearch}
                  onChange={e => setFileSearch(e.target.value)}
                  placeholder="Search files or folders…"
                  style={{
                    width: "100%",
                    background: "#0a0d11",
                    color: "#e6ecf3",
                    border: "1px solid #2dd4bf",
                    borderRadius: 4,
                    padding: "6px 10px",
                    fontSize: 12,
                    fontFamily: "ui-monospace, Menlo, monospace",
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ padding: "6px 10px", fontSize: 11, color: "#6b7585" }}>
                {graph ? `${graph.nodes.length} files` : ""}
              </div>
              <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
                {fileTree.map(group => (
                  <div key={group.folder} style={{ marginBottom: 4 }}>
                    <div
                      style={{
                        padding: "4px 12px",
                        color: "#6b7585",
                        fontFamily: "ui-monospace, Menlo, monospace",
                        fontSize: 11,
                        position: "sticky",
                        top: 0,
                        background: "#0f1419",
                      }}
                    >
                      {group.folder || "(root)"}
                    </div>
                    {group.files.map(f => {
                      const isSelected = selectedId === f.id;
                      const leaf = f.id.split("/").pop() || f.id;
                      return (
                        <button
                          key={f.id}
                          onClick={() => onFilePick(f.id)}
                          style={{
                            display: "flex",
                            width: "100%",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 12px 4px 24px",
                            background: isSelected ? "#1a2a3a" : "transparent",
                            color: isSelected ? "#2dd4bf" : "#bfcfe0",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontFamily: "ui-monospace, Menlo, monospace",
                          }}
                          onMouseEnter={e => {
                            if (!isSelected) e.currentTarget.style.background = "#13191f";
                          }}
                          onMouseLeave={e => {
                            if (!isSelected) e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: LAYER_COLOUR[f.layer] ?? "#888",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {leaf}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {fileTree.length === 0 && (
                  <div style={{ padding: 20, color: "#6b7585", fontSize: 12 }}>
                    No matches.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Canvas */}
          <div
            ref={containerRef}
            style={{
              position: "relative",
              flex: 1,
              background: "#0d1117",
              overflow: "hidden",
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

          {/* Right: source preview panel (shown when a file node is selected) */}
          {selectedId && (
            <div
              style={{
                width: 480,
                flexShrink: 0,
                background: "#0f1419",
                borderLeft: "1px solid #1a1f29",
                display: "flex",
                flexDirection: "column",
                color: "#e6ecf3",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderBottom: "1px solid #1a1f29",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedId}
                </span>
                <button
                  onClick={() => setSelectedId(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#6b7585",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    marginLeft: 8,
                  }}
                  aria-label="Close source panel"
                >
                  ×
                </button>
              </div>
              <div style={{ overflow: "auto", flex: 1 }}>
                {sourceLoading && (
                  <div style={{ padding: 16, color: "#6b7585", fontSize: 12 }}>Loading…</div>
                )}
                {sourceError && (
                  <div style={{ padding: 16, color: "#f85149", fontSize: 12 }}>{sourceError}</div>
                )}
                {sourceCode && (
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      fontFamily: "ui-monospace, Menlo, monospace",
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: "#bfcfe0",
                      whiteSpace: "pre",
                    }}
                  >
                    {sourceCode}
                  </pre>
                )}
              </div>
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
                  borderRadius: 2,
                  background: LAYER_COLOUR[layer] ?? "#888",
                }}
              />
              {layer}
            </span>
          ))}
        </div>
      </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function RailButton({
  active,
  onClick,
  title,
  label,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "#1a2a3a" : "transparent",
        color: active ? "#2dd4bf" : "#6b7585",
        border: active ? "1px solid #2dd4bf40" : "1px solid transparent",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 16,
        lineHeight: 1,
        padding: 0,
      }}
    >
      {label}
    </button>
  );
}
