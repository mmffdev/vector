"use client";

// DevVisualiserPanelV2 — the next-gen Vector Relationship Explorer.
//
// Today the data source is dev/audits/codegraph.json (files + imports +
// HTTP bridges). Tomorrow it becomes Vector's artefact/topology/RBAC
// relationship explorer — same chrome, swap the data feed.
//
// Layout (SCADA-grade IA, editorial-dark palette):
//
//   ┌─ topbar ─────────────────────────────────────────────────────────┐
//   │  brand · breadcrumb · KPI strip                          actions │
//   ├──┬────────────────────────────┬───────────────────────────────────┤
//   │ R│  active panel (Files/      │  3D canvas (cubes)                │
//   │ a│  Search/Groups/Diff)       │                                   │
//   │ i│                            │                                   │
//   │ l│                            │                                   │
//   ├──┴────────────────────────────┴───────────────────────────────────┤
//   │  status bar (hover/selection/health)                              │
//   └──────────────────────────────────────────────────────────────────┘
//
// Right side has a slide-in Selected Node panel that appears when a
// node is clicked (path · edges by kind · K-hops · source preview).
// Fullscreen button moves the whole stage to document.fullscreen.

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
type RailPanelId = "files" | "search" | "groups" | "diff" | null;

type Group = {
  id: string;
  name: string;
  colour: string;
  nodeIds: string[];
};

// Predefined group accent palette — used in rotation when the user creates
// a group without picking a colour. Pulls from the editorial-dark palette.
const GROUP_PALETTE = [
  "#e879f9", // magenta
  "#a78bfa", // violet
  "#818cf8", // indigo
  "#2dd4bf", // teal
  "#fbbf24", // amber
  "#f87171", // rose
  "#60a5fa", // sky
  "#34d399", // emerald
];

function loadGroupsFromStorage(): Group[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("viz-v2-groups");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(g => g && typeof g.id === "string" && Array.isArray(g.nodeIds));
  } catch {
    return [];
  }
}

function loadGroupVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("viz-v2-groups-visibility");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, boolean>;
    return {};
  } catch {
    return {};
  }
}

// ─── Editorial-dark palette ──────────────────────────────────────────────────
//
// Inspired by the user's two reference images: Tumblr Q1 2013 infographic
// (magenta/violet/indigo on near-black) + MiScout SCADA (industrial dark
// dashboard). Colours below are intentional — light text on near-black
// surfaces, vivid accents reserved for state and signal.

const C = {
  canvas: "#0a0e14",
  surface1: "#11161f",
  surface2: "#1a2230",
  surface3: "#222d3e",
  borderSubtle: "#1f2a3a",
  borderFocus: "#2dd4bf",
  textPrimary: "#e8f0fc",
  textSecondary: "#9fb0c8",
  textDim: "#6b7d96",
  textGhost: "#4a5870",
  accent: "#2dd4bf",       // teal — primary action / focus
  accentMagenta: "#e879f9", // editorial pop
  accentViolet: "#a78bfa",
  accentIndigo: "#818cf8",
  warn: "#f59e0b",
  danger: "#f85149",
  ok: "#22c55e",
};

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

function buildAdjacency(nodes: any[], links: any[]) {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of links) {
    const s = typeof e.source === "object" ? e.source.id : e.source;
    const t = typeof e.target === "object" ? e.target.id : e.target;
    if (!adj.has(s) || !adj.has(t)) continue;
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  return adj;
}

function buildClusterMap(nodes: any[], links: any[]): Map<string, Set<string>> {
  const adj = buildAdjacency(nodes, links);
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

// K-hops reachability for the K-hops isolate behaviour. Returns the set of
// node ids within `k` undirected edge steps of `seed`.
function bfsKHops(adj: Map<string, Set<string>>, seed: string, k: number): Set<string> {
  const visited = new Set<string>([seed]);
  if (k <= 0) return visited;
  let frontier: Set<string> = new Set([seed]);
  for (let depth = 0; depth < k; depth++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbour of adj.get(id) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          next.add(neighbour);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return visited;
}

function computeScores(graph: Codegraph): Map<string, number> {
  const scores = new Map<string, number>();
  for (const n of graph.nodes) scores.set(n.id, 0);
  for (const e of graph.edges) {
    scores.set(e.source, (scores.get(e.source) ?? 0) + 1);
    scores.set(e.target, (scores.get(e.target) ?? 0) + 1);
  }
  return scores;
}

function buildCardTexture(
  THREE: any,
  cache: Map<string, any>,
  name: string,
  layer: string,
  score: number,
  colour: string,
  dimmed: boolean,
): any {
  const label = name.split("/").pop() || name;
  const sub = name.length > label.length ? name.slice(0, -label.length).replace(/\/$/, "") : "";
  const key = `${label}|${sub}|${layer}|${score}|${colour}|${dimmed ? "d" : "n"}`;
  if (cache.has(key)) return cache.get(key);

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

  ctx.fillStyle = "#11161f";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, W, 18);

  ctx.font = "bold 22px ui-monospace, Menlo, monospace";
  ctx.fillStyle = colour;
  ctx.textAlign = "right";
  ctx.fillText(layer.toUpperCase(), W - 16, 56);
  ctx.font = "16px ui-monospace, Menlo, monospace";
  ctx.fillStyle = C.textDim;
  ctx.fillText(`${score}`, W - 16, 80);

  ctx.textAlign = "left";
  ctx.fillStyle = C.textGhost;
  ctx.font = "18px ui-monospace, Menlo, monospace";
  const subTrim = sub.length > 40 ? "…" + sub.slice(-37) : sub;
  ctx.fillText(subTrim, 16, 56);

  ctx.fillStyle = C.textPrimary;
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

export default function DevVisualiserPanelV2() {
  const [graph, setGraph] = useState<Codegraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("folders");
  const [showBridges, setShowBridges] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);

  // Rail / panel state
  const [railPanel, setRailPanel] = useState<RailPanelId>("files");
  const [fileSearch, setFileSearch] = useState("");

  // Selected node + analyses
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kHops, setKHops] = useState(0); // 0 = isolate off
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Multi-selection (shift-click accumulator) + saved groups.
  // Groups persist to localStorage under key 'viz-v2-groups'.
  const [selectionSet, setSelectionSet] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<Group[]>(() => loadGroupsFromStorage());
  const [groupVisibility, setGroupVisibility] = useState<Record<string, boolean>>(() => loadGroupVisibility());
  const [newGroupName, setNewGroupName] = useState("");

  // Hover + status
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // Diff panel — prior snapshot uploaded by the user (local-only compare).
  const [priorGraph, setPriorGraph] = useState<Codegraph | null>(null);
  const [priorName, setPriorName] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<any>(null);
  const textureCacheRef = useRef<Map<string, any>>(new Map());

  // Latest sim refs — written every effect run so the (long-lived) click
  // and drag handlers see today's data without stale closures.
  const liveNodesRef = useRef<any[]>([]);
  const liveAdjRef = useRef<Map<string, Set<string>>>(new Map());
  const liveClusterRef = useRef<Map<string, Set<string>>>(new Map());

  // ── Data fetch
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

  // K-hops isolate — when selectedId + kHops > 0, only nodes in the K-hop
  // set render at full opacity; everything else gets the dimmed texture.
  const isolateSet = useMemo<Set<string> | null>(() => {
    if (!selectedId || kHops <= 0) return null;
    return bfsKHops(liveAdjRef.current, selectedId, kHops);
  }, [selectedId, kHops, displayGraph]);

  // ── Frame a node in the 3D canvas
  const frameNode = useCallback((nodeId: string) => {
    console.log("[viz-v2] frameNode entry", { nodeId });
    const fg = fgRef.current;
    if (!fg) {
      console.warn("[viz-v2] frameNode aborted — no ForceGraph instance");
      return;
    }
    const node = liveNodesRef.current.find(n => n.id === nodeId);
    if (!node) {
      console.warn("[viz-v2] frameNode aborted — node not in liveNodesRef", { nodeId });
      return;
    }
    if (typeof node.x !== "number" || typeof node.y !== "number" || typeof node.z !== "number") {
      console.warn("[viz-v2] frameNode aborted — sim not warm", { nodeId, x: node.x, y: node.y, z: node.z });
      return;
    }
    const camera = fg.camera() as any;
    const controls = fg.controls() as any;
    camera.up.set(0, 1, 0);
    const standoff = computeStandoff(camera);
    console.log("[viz-v2] frameNode flying camera", {
      nodeId,
      to: { x: node.x, y: node.y, z: node.z + standoff },
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
      }
    }, 650);
  }, []);

  // ── Source-preview loader
  useEffect(() => {
    if (!selectedId) {
      setSourceCode(null);
      setSourceError(null);
      return;
    }
    if (!/\.[a-z0-9]+$/i.test(selectedId)) {
      setSourceCode(null);
      setSourceError(null);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    setSourceError(null);
    (async () => {
      try {
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

  // ── Persist groups to localStorage on every change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("viz-v2-groups", JSON.stringify(groups));
    } catch {
      /* quota / private mode — silent */
    }
  }, [groups]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("viz-v2-groups-visibility", JSON.stringify(groupVisibility));
    } catch {
      /* silent */
    }
  }, [groupVisibility]);

  // Map nodeId → group colour for the active groups. Last-write-wins when a
  // node belongs to multiple groups; we keep this simple intentionally.
  const groupColourByNode = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      const visible = groupVisibility[g.id] !== false; // default visible
      if (!visible) continue;
      for (const id of g.nodeIds) m.set(id, g.colour);
    }
    return m;
  }, [groups, groupVisibility]);

  // Groups that are hidden — their nodes get dimmed/skipped at render time.
  const hiddenNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) {
      const visible = groupVisibility[g.id] !== false;
      if (visible) continue;
      for (const id of g.nodeIds) s.add(id);
    }
    return s;
  }, [groups, groupVisibility]);

  const createGroupFromSelection = useCallback(() => {
    if (selectionSet.size === 0) return;
    const id = `g_${Date.now().toString(36)}`;
    const name = newGroupName.trim() || `Group ${groups.length + 1}`;
    const colour = GROUP_PALETTE[groups.length % GROUP_PALETTE.length];
    setGroups(prev => [...prev, { id, name, colour, nodeIds: Array.from(selectionSet) }]);
    setNewGroupName("");
    setSelectionSet(new Set());
  }, [selectionSet, newGroupName, groups.length]);

  const deleteGroup = useCallback((id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
    setGroupVisibility(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const toggleGroupVisibility = useCallback((id: string) => {
    setGroupVisibility(prev => ({ ...prev, [id]: prev[id] === false ? true : false }));
  }, []);

  const clearSelection = useCallback(() => setSelectionSet(new Set()), []);

  // ── Diff computation
  //
  // Computes per-node diff status against `priorGraph` if loaded:
  //   - 'added'   : in current, not in prior
  //   - 'removed' : in prior, not in current
  //   - 'score↑'  / 'score↓' : score delta of ±2 or more
  // Used to colour-overlay the canvas while a prior snapshot is loaded.
  const priorScores = useMemo(() => {
    if (!priorGraph) return null;
    return computeScores(priorGraph);
  }, [priorGraph]);

  const diffByNode = useMemo(() => {
    if (!priorGraph || !graph) return null;
    const priorIds = new Set(priorGraph.nodes.map(n => n.id));
    const curIds = new Set(graph.nodes.map(n => n.id));
    const status = new Map<string, "added" | "removed" | "score-up" | "score-down">();
    for (const id of curIds) {
      if (!priorIds.has(id)) {
        status.set(id, "added");
        continue;
      }
      const before = priorScores?.get(id) ?? 0;
      const after = scores.get(id) ?? 0;
      const delta = after - before;
      if (delta >= 2) status.set(id, "score-up");
      else if (delta <= -2) status.set(id, "score-down");
    }
    // Removed nodes aren't in current graph so they won't render, but we
    // track them for the summary count.
    for (const id of priorIds) {
      if (!curIds.has(id)) status.set(id, "removed");
    }
    return status;
  }, [priorGraph, graph, priorScores, scores]);

  const diffSummary = useMemo(() => {
    if (!diffByNode) return null;
    let added = 0, removed = 0, up = 0, down = 0;
    for (const v of diffByNode.values()) {
      if (v === "added") added++;
      else if (v === "removed") removed++;
      else if (v === "score-up") up++;
      else if (v === "score-down") down++;
    }
    return { added, removed, up, down };
  }, [diffByNode]);

  // Override colour by diff status — replaces group colour when diff active.
  const diffColourByNode = useMemo(() => {
    if (!diffByNode) return null;
    const m = new Map<string, string>();
    for (const [id, status] of diffByNode) {
      if (status === "added") m.set(id, "#22c55e");
      else if (status === "score-up") m.set(id, "#34d399");
      else if (status === "score-down") m.set(id, "#fbbf24");
      // removed isn't in current graph so won't render anyway
    }
    return m;
  }, [diffByNode]);

  const onLoadPriorSnapshot = useCallback((file: File) => {
    setDiffError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          setDiffError("Not a valid codegraph.json (missing nodes / edges arrays).");
          return;
        }
        setPriorGraph(parsed as Codegraph);
        setPriorName(file.name);
      } catch (e: any) {
        setDiffError(e?.message ?? "Failed to parse JSON.");
      }
    };
    reader.onerror = () => setDiffError("File read failed.");
    reader.readAsText(file);
  }, []);

  const clearPriorSnapshot = useCallback(() => {
    setPriorGraph(null);
    setPriorName(null);
    setDiffError(null);
  }, []);

  // ── Fullscreen handlers
  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      stageRef.current.requestFullscreen?.();
    }
  }, []);

  // ── Render the 3D canvas
  useEffect(() => {
    if (!displayGraph || !canvasContainerRef.current) return;

    let cancelled = false;
    (async () => {
      const [{ default: ForceGraph3D }, THREE, { default: SpriteText }] = await Promise.all([
        import("3d-force-graph"),
        import("three"),
        import("three-spritetext"),
      ]);
      if (cancelled || !canvasContainerRef.current) return;

      const cache = textureCacheRef.current;

      const nodes = displayGraph.nodes.map(n => ({ ...n })) as any[];
      const links = displayGraph.edges.map(e => ({ ...e })) as any[];
      liveNodesRef.current = nodes;
      liveAdjRef.current = buildAdjacency(nodes, links);
      liveClusterRef.current = buildClusterMap(nodes, links);

      let dragCluster: any[] | null = null;
      let dragAnchor: { x: number; y: number; z: number } | null = null;

      const nodeThreeObject = (n: any) => {
        // Diff colour wins when a prior snapshot is loaded — that's the
        // story this view is telling. Otherwise group colour, otherwise
        // layer colour.
        const diffColour = diffColourByNode?.get(n.id);
        const groupColour = groupColourByNode.get(n.id);
        const baseColour = LAYER_COLOUR[n.layer] ?? "#888";
        const colour = diffColour ?? groupColour ?? baseColour;
        const score = scores.get(n.id) ?? 0;
        const depth = Math.max(1, Math.min(6, 1 + Math.log2(score + 1)));
        // Dimmed if isolate is on AND not in K-hop set, OR if the node is
        // in a hidden group, OR if shift-click selection is non-empty and
        // this node isn't part of it.
        const isolated = isolateSet !== null && !isolateSet.has(n.id);
        const hiddenByGroup = hiddenNodeIds.has(n.id);
        const outOfSelection = selectionSet.size > 0 && !selectionSet.has(n.id) && !groupColour;
        const dimmed = isolated || hiddenByGroup || outOfSelection;
        const tex = buildCardTexture(THREE, cache, n.id, n.layer, score, colour, dimmed);
        const cardMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: dimmed ? 0.3 : 1 });
        const sideMat = new THREE.MeshBasicMaterial({
          color: colour,
          opacity: dimmed ? 0.12 : 0.85,
          transparent: true,
        });
        const materials = [sideMat, sideMat, sideMat, sideMat, cardMat, sideMat];
        const geometry = new THREE.BoxGeometry(16, 8, depth);
        return new THREE.Mesh(geometry, materials);
      };

      const linkThreeObject = (e: any) => {
        if (!showEdgeLabels) return new THREE.Group();
        const kind = e.kind as "import" | "bridge";
        const text = new SpriteText(kind);
        text.color = kind === "bridge" ? C.accent : C.textDim;
        text.textHeight = 1.2;
        text.backgroundColor = "rgba(0,0,0,0.55)";
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

      const handleClick = (node: any, event?: MouseEvent) => {
        console.log("[viz-v2] onNodeClick fired", {
          id: node?.id,
          x: node?.x, y: node?.y, z: node?.z,
          shift: event?.shiftKey,
        });
        const liveNode = liveNodesRef.current.find(n => n.id === node.id);
        if (!liveNode) {
          console.warn("[viz-v2] handleClick aborted — id not in liveNodesRef", { id: node?.id });
          return;
        }

        // Shift-click → toggle into the multi-selection set (used to seed
        // a new group via the Groups panel). Don't frame the camera in
        // this mode; the user is curating, not navigating.
        if (event?.shiftKey) {
          setSelectionSet(prev => {
            const next = new Set(prev);
            if (next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            return next;
          });
          return;
        }

        setSelectedId(node.id);
        if (
          typeof liveNode.x !== "number" ||
          typeof liveNode.y !== "number" ||
          typeof liveNode.z !== "number"
        ) {
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
        fgRef.current = new ForceGraph3D(canvasContainerRef.current)
          .backgroundColor(C.canvas)
          .d3VelocityDecay(0.85)
          .cooldownTicks(60)
          .nodeThreeObject(nodeThreeObject)
          .nodeLabel((n: any) => `<div style="background:${C.surface2};color:${C.textPrimary};padding:6px 10px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid ${C.borderSubtle}">${n.id}<br/><span style="opacity:.6">${n.layer} · ${n.side} · score ${scores.get(n.id) ?? 0}</span></div>`)
          .linkColor((e: any) => (e.kind === "bridge" ? C.accent : "#2a3a4f"))
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
        fgRef.current
          .nodeThreeObject(nodeThreeObject)
          .linkThreeObject(linkThreeObject)
          .linkPositionUpdate(linkPositionUpdate)
          .onNodeClick(handleClick)
          .onNodeDrag(handleDrag)
          .onNodeDragEnd(handleDragEnd);
      }

      fgRef.current.graphData({ nodes, links });

      const rect = canvasContainerRef.current.getBoundingClientRect();
      fgRef.current.width(rect.width).height(rect.height);
    })();

    return () => {
      cancelled = true;
    };
  }, [displayGraph, scores, showEdgeLabels, frameNode, isolateSet, groupColourByNode, hiddenNodeIds, selectionSet, diffColourByNode]);

  // Window resize → re-size the renderer
  useEffect(() => {
    const handler = () => {
      if (!fgRef.current || !canvasContainerRef.current) return;
      const rect = canvasContainerRef.current.getBoundingClientRect();
      fgRef.current.width(rect.width).height(rect.height);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Files panel data
  const fileTree = useMemo(() => {
    if (!graph) return [] as { folder: string; files: GraphNode[] }[];
    const groups = new Map<string, GraphNode[]>();
    for (const n of graph.nodes) {
      const arr = groups.get(n.folder) ?? [];
      arr.push(n);
      groups.set(n.folder, arr);
    }
    const q = fileSearch.trim().toLowerCase();
    return Array.from(groups.keys()).sort().map(folder => ({
      folder,
      files: (groups.get(folder) ?? [])
        .filter(f => !q || f.id.toLowerCase().includes(q) || folder.toLowerCase().includes(q))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })).filter(g => g.files.length > 0);
  }, [graph, fileSearch]);

  const onFilePick = useCallback((id: string) => {
    setSelectedId(id);
    if (view === "folders" && /\.[a-z0-9]+$/i.test(id)) {
      setView("files");
      setTimeout(() => frameNode(id), 300);
    } else {
      frameNode(id);
    }
  }, [view, frameNode]);

  // ── Selected node — edges in/out by kind for the detail panel
  const selectedEdges = useMemo(() => {
    if (!selectedId || !graph) return null;
    const incoming: GraphEdge[] = [];
    const outgoing: GraphEdge[] = [];
    for (const e of graph.edges) {
      if (e.source === selectedId) outgoing.push(e);
      if (e.target === selectedId) incoming.push(e);
    }
    return { incoming, outgoing };
  }, [selectedId, graph]);

  const selectedNode = useMemo(() => {
    if (!selectedId || !graph) return null;
    return graph.nodes.find(n => n.id === selectedId)
        ?? { id: selectedId, side: "frontend" as Side, folder: "", layer: "unknown" };
  }, [selectedId, graph]);

  const allLayers = useMemo(() => {
    if (!graph) return [] as string[];
    const s = new Set<string>();
    for (const n of graph.nodes) s.add(n.layer);
    return Array.from(s).sort();
  }, [graph]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="dui-viz-v2" ref={stageRef}>
      {/* TOPBAR */}
      <div className="dui-viz-v2__topbar">
        <div className="dui-viz-v2__brand">
          <span className="dui-viz-v2__brand-dot" />
          <span className="dui-viz-v2__brand-name">Relationship Explorer</span>
          <span className="dui-viz-v2__brand-sub">codegraph · v2</span>
        </div>

        <div className="dui-viz-v2__kpis">
          <KPI label="TS files" value={graph?.stats.ts_files ?? "—"} colour={C.accentIndigo} />
          <KPI label="Go files" value={graph?.stats.go_files ?? "—"} colour={C.accentViolet} />
          <KPI label="Imports" value={graph?.stats.import_edges ?? "—"} colour={C.textSecondary} />
          <KPI label="Bridges" value={graph?.stats.bridge_edges ?? "—"} colour={C.accent} />
          <KPI label="Nodes (view)" value={displayGraph?.nodes.length ?? "—"} colour={C.textPrimary} />
        </div>

        <div className="dui-viz-v2__topbar-actions">
          <div className="dui-viz-v2__seg" role="group" aria-label="View mode">
            <button
              className={`dui-viz-v2__seg-btn${view === "folders" ? " is-active" : ""}`}
              onClick={() => setView("folders")}
            >
              Folders
            </button>
            <button
              className={`dui-viz-v2__seg-btn${view === "files" ? " is-active" : ""}`}
              onClick={() => setView("files")}
            >
              Files
            </button>
          </div>
          <label className="dui-viz-v2__toggle">
            <input
              type="checkbox"
              checked={showBridges}
              onChange={e => setShowBridges(e.target.checked)}
            />
            <span>Bridges</span>
          </label>
          <label className="dui-viz-v2__toggle">
            <input
              type="checkbox"
              checked={showEdgeLabels}
              onChange={e => setShowEdgeLabels(e.target.checked)}
            />
            <span>Edge labels</span>
          </label>
          <button className="dui-viz-v2__icon-btn" onClick={load} disabled={loading} title="Refresh">
            {loading ? "…" : "↻"}
          </button>
          <button className="dui-viz-v2__icon-btn" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {isFullscreen ? "⤢" : "⤡"}
          </button>
        </div>
      </div>

      {/* BODY: rail + panel + canvas + selected panel */}
      <div className="dui-viz-v2__body">
        {/* Left icon rail */}
        <div className="dui-viz-v2__rail">
          <RailButton id="files" icon="📁" label="Files" active={railPanel === "files"} onToggle={setRailPanel} />
          <RailButton id="search" icon="🔍" label="Search" active={railPanel === "search"} onToggle={setRailPanel} />
          <RailButton id="groups" icon="◆" label="Groups" active={railPanel === "groups"} onToggle={setRailPanel} />
          <RailButton id="diff" icon="⇄" label="Diff" active={railPanel === "diff"} onToggle={setRailPanel} />
        </div>

        {/* Active panel */}
        {railPanel && (
          <div className="dui-viz-v2__panel">
            <div className="dui-viz-v2__panel-head">
              <span>{panelTitle(railPanel)}</span>
              <button className="dui-viz-v2__icon-btn dui-viz-v2__icon-btn--ghost" onClick={() => setRailPanel(null)}>×</button>
            </div>

            {railPanel === "files" && (
              <>
                <div className="dui-viz-v2__panel-search">
                  <input
                    type="text"
                    value={fileSearch}
                    onChange={e => setFileSearch(e.target.value)}
                    placeholder="Search files or folders…"
                  />
                </div>
                <div className="dui-viz-v2__panel-meta">
                  {graph ? `${graph.nodes.length} files` : ""}
                </div>
                <div className="dui-viz-v2__panel-list">
                  {fileTree.map(group => (
                    <div key={group.folder} className="dui-viz-v2__file-group">
                      <div className="dui-viz-v2__file-group-head">{group.folder || "(root)"}</div>
                      {group.files.map(f => {
                        const isSel = selectedId === f.id;
                        const leaf = f.id.split("/").pop() || f.id;
                        return (
                          <button
                            key={f.id}
                            className={`dui-viz-v2__file-item${isSel ? " is-selected" : ""}`}
                            onClick={() => onFilePick(f.id)}
                          >
                            <span className="dui-viz-v2__file-swatch" style={{ background: LAYER_COLOUR[f.layer] ?? "#888" }} />
                            <span className="dui-viz-v2__file-leaf">{leaf}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}

            {railPanel === "search" && (
              <div className="dui-viz-v2__panel-empty">
                Coming next: full-text node + edge search with results that highlight on canvas.
              </div>
            )}

            {railPanel === "groups" && (
              <div className="dui-viz-v2__groups">
                <div className="dui-viz-v2__groups-help">
                  Shift-click cards to build a selection, then save it as a named group.
                  Groups recolour their members and can be toggled or removed.
                </div>

                <div className="dui-viz-v2__groups-selection">
                  <div className="dui-viz-v2__groups-selection-head">
                    Working selection · {selectionSet.size}
                    {selectionSet.size > 0 && (
                      <button
                        className="dui-viz-v2__inline-btn"
                        onClick={clearSelection}
                      >
                        clear
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    placeholder="Name this group…"
                    disabled={selectionSet.size === 0}
                  />
                  <button
                    className="dui-viz-v2__primary-btn"
                    onClick={createGroupFromSelection}
                    disabled={selectionSet.size === 0}
                  >
                    Save {selectionSet.size > 0 ? `${selectionSet.size} ` : ""}as group
                  </button>
                </div>

                <div className="dui-viz-v2__groups-list">
                  {groups.length === 0 && (
                    <div className="dui-viz-v2__panel-empty">No groups yet.</div>
                  )}
                  {groups.map(g => {
                    const visible = groupVisibility[g.id] !== false;
                    return (
                      <div key={g.id} className={`dui-viz-v2__group-row${!visible ? " is-hidden" : ""}`}>
                        <span
                          className="dui-viz-v2__group-swatch"
                          style={{ background: g.colour }}
                        />
                        <span className="dui-viz-v2__group-name" title={g.name}>{g.name}</span>
                        <span className="dui-viz-v2__group-count">{g.nodeIds.length}</span>
                        <button
                          className="dui-viz-v2__inline-btn"
                          onClick={() => toggleGroupVisibility(g.id)}
                          title={visible ? "Hide group" : "Show group"}
                        >
                          {visible ? "👁" : "—"}
                        </button>
                        <button
                          className="dui-viz-v2__inline-btn"
                          onClick={() => deleteGroup(g.id)}
                          title="Delete group"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {railPanel === "diff" && (
              <div className="dui-viz-v2__diff">
                <div className="dui-viz-v2__groups-help">
                  Upload a prior <code>codegraph.json</code> to compare against the current snapshot.
                  Added nodes glow green, score-changed nodes amber-up or amber-down. Removed nodes
                  no longer render (they're gone) but are counted below.
                </div>

                {!priorGraph && (
                  <div className="dui-viz-v2__diff-upload">
                    <label className="dui-viz-v2__primary-btn">
                      Load prior snapshot…
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) onLoadPriorSnapshot(f);
                        }}
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                )}

                {diffError && (
                  <div className="dui-viz-v2__source-status dui-viz-v2__source-status--err">
                    {diffError}
                  </div>
                )}

                {priorGraph && diffSummary && (
                  <div className="dui-viz-v2__diff-summary">
                    <div className="dui-viz-v2__diff-summary-head">
                      <span className="dui-viz-v2__diff-name" title={priorName ?? ""}>
                        {priorName ?? "prior snapshot"}
                      </span>
                      <button
                        className="dui-viz-v2__inline-btn"
                        onClick={clearPriorSnapshot}
                      >
                        clear
                      </button>
                    </div>
                    <div className="dui-viz-v2__diff-stats">
                      <DiffStat label="Added" value={diffSummary.added} colour="#22c55e" />
                      <DiffStat label="Removed" value={diffSummary.removed} colour="#f85149" />
                      <DiffStat label="Score ↑" value={diffSummary.up} colour="#34d399" />
                      <DiffStat label="Score ↓" value={diffSummary.down} colour="#fbbf24" />
                    </div>
                    <div className="dui-viz-v2__diff-meta">
                      {priorGraph.stats.ts_files + priorGraph.stats.go_files} files in prior · vs
                      {" "}{(graph?.stats.ts_files ?? 0) + (graph?.stats.go_files ?? 0)} now
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Canvas */}
        <div className="dui-viz-v2__canvas-host">
          <div ref={canvasContainerRef} className="dui-viz-v2__canvas" />
          {error && <div className="dui-viz-v2__canvas-error">{error}</div>}
          {hoveredNode && (
            <div className="dui-viz-v2__canvas-tip">
              <span>{hoveredNode.id}</span>
              <span className="dui-viz-v2__canvas-tip-sub">
                {hoveredNode.layer} · {hoveredNode.side} · score {scores.get(hoveredNode.id) ?? 0}
              </span>
            </div>
          )}
        </div>

        {/* Right-side Selected panel */}
        {selectedNode && (
          <div className="dui-viz-v2__selected">
            <div className="dui-viz-v2__panel-head">
              <span className="dui-viz-v2__selected-title">{selectedNode.id}</span>
              <button className="dui-viz-v2__icon-btn dui-viz-v2__icon-btn--ghost" onClick={() => { setSelectedId(null); setKHops(0); }}>×</button>
            </div>

            <div className="dui-viz-v2__selected-meta">
              <span className="dui-viz-v2__chip" style={{ borderColor: LAYER_COLOUR[selectedNode.layer] ?? "#888", color: LAYER_COLOUR[selectedNode.layer] ?? "#888" }}>
                {selectedNode.layer}
              </span>
              <span className="dui-viz-v2__chip dui-viz-v2__chip--dim">{selectedNode.side}</span>
              <span className="dui-viz-v2__chip dui-viz-v2__chip--dim">score {scores.get(selectedNode.id) ?? 0}</span>
            </div>

            <div className="dui-viz-v2__khops">
              <label>
                K-Hops isolate: <strong>{kHops === 0 ? "off" : `${kHops}`}</strong>
                {isolateSet && <span className="dui-viz-v2__khops-count"> · {isolateSet.size} nodes</span>}
              </label>
              <input
                type="range"
                min={0}
                max={5}
                value={kHops}
                onChange={e => setKHops(parseInt(e.target.value, 10))}
              />
            </div>

            {selectedEdges && (
              <div className="dui-viz-v2__edges">
                <EdgeList
                  title="Incoming"
                  edges={selectedEdges.incoming}
                  otherSide="source"
                  onPick={onFilePick}
                />
                <EdgeList
                  title="Outgoing"
                  edges={selectedEdges.outgoing}
                  otherSide="target"
                  onPick={onFilePick}
                />
              </div>
            )}

            <div className="dui-viz-v2__source">
              <div className="dui-viz-v2__source-head">Source</div>
              {sourceLoading && <div className="dui-viz-v2__source-status">Loading…</div>}
              {sourceError && <div className="dui-viz-v2__source-status dui-viz-v2__source-status--err">{sourceError}</div>}
              {sourceCode && (
                <pre className="dui-viz-v2__source-pre">{sourceCode}</pre>
              )}
              {!sourceLoading && !sourceCode && !sourceError && (
                <div className="dui-viz-v2__source-status">Select a file node to preview source.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* STATUS BAR */}
      <div className="dui-viz-v2__status">
        <span className="dui-viz-v2__status-cell">
          {loading ? "loading…" : graph ? `snapshot · ${graph.generated_at}` : "no data"}
        </span>
        <span className="dui-viz-v2__status-cell">{allLayers.length} layer kinds</span>
        <span className="dui-viz-v2__status-cell">
          {selectedNode ? `selected · ${selectedNode.id}` : "no selection"}
        </span>
        <span className="dui-viz-v2__status-spacer" />
        <span className="dui-viz-v2__status-cell dui-viz-v2__status-cell--ok">● online</span>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function KPI({ label, value, colour }: { label: string; value: number | string; colour: string }) {
  return (
    <div className="dui-viz-v2__kpi">
      <span className="dui-viz-v2__kpi-value" style={{ color: colour }}>{value}</span>
      <span className="dui-viz-v2__kpi-label">{label}</span>
    </div>
  );
}

function RailButton({
  id,
  icon,
  label,
  active,
  onToggle,
}: {
  id: RailPanelId;
  icon: string;
  label: string;
  active: boolean;
  onToggle: (id: RailPanelId) => void;
}) {
  return (
    <button
      className={`dui-viz-v2__rail-btn${active ? " is-active" : ""}`}
      onClick={() => onToggle(active ? null : id)}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <span className="dui-viz-v2__rail-icon">{icon}</span>
      <span className="dui-viz-v2__rail-label">{label}</span>
    </button>
  );
}

function EdgeList({
  title,
  edges,
  otherSide,
  onPick,
}: {
  title: string;
  edges: GraphEdge[];
  otherSide: "source" | "target";
  onPick: (id: string) => void;
}) {
  if (edges.length === 0) {
    return (
      <div className="dui-viz-v2__edge-list dui-viz-v2__edge-list--empty">
        <span className="dui-viz-v2__edge-list-title">{title}</span>
        <span className="dui-viz-v2__edge-list-empty">none</span>
      </div>
    );
  }
  return (
    <div className="dui-viz-v2__edge-list">
      <span className="dui-viz-v2__edge-list-title">{title} ({edges.length})</span>
      <div className="dui-viz-v2__edge-list-items">
        {edges.slice(0, 30).map((e, i) => {
          const id = otherSide === "source" ? e.source : e.target;
          return (
            <button key={i} className="dui-viz-v2__edge-item" onClick={() => onPick(id)} title={id}>
              <span className={`dui-viz-v2__edge-kind dui-viz-v2__edge-kind--${e.kind}`}>{e.kind}</span>
              <span className="dui-viz-v2__edge-target">{id.split("/").pop() || id}</span>
            </button>
          );
        })}
        {edges.length > 30 && <div className="dui-viz-v2__edge-more">+{edges.length - 30} more</div>}
      </div>
    </div>
  );
}

function DiffStat({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="dui-viz-v2__diff-stat">
      <span className="dui-viz-v2__diff-stat-value" style={{ color: colour }}>{value}</span>
      <span className="dui-viz-v2__diff-stat-label">{label}</span>
    </div>
  );
}

function panelTitle(id: NonNullable<RailPanelId>) {
  switch (id) {
    case "files":   return "File Explorer";
    case "search":  return "Search";
    case "groups":  return "Groups";
    case "diff":    return "Snapshot Diff";
  }
}
