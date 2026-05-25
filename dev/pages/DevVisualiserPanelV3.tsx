"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiSite } from "@/app/lib/api";

type Side = "frontend" | "backend";
type EdgeKind = "import" | "bridge";

type GraphNode = {
  id: string;
  side: Side;
  folder: string;
  layer: string;
};

type GraphEdge = {
  source: string;
  target: string;
  kind: EdgeKind;
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

type Persona = "engineer" | "architect" | "auditor" | "qa";
type ViewMode = "atlas" | "matrix" | "hotspots" | "evidence";
type ClusterMode = "system" | "layer" | "risk" | "side";
type LayoutMode = "orbit" | "phalanx" | "array" | "arc" | "leaf";
type RelationMode = "both" | "incoming" | "outgoing";
type RiskLevel = "critical" | "high" | "medium" | "low";

type GraphIndex = {
  byId: Map<string, GraphNode>;
  incoming: Map<string, GraphEdge[]>;
  outgoing: Map<string, GraphEdge[]>;
  degree: Map<string, number>;
  bridges: Set<string>;
};

type EnrichedNode = GraphNode & {
  system: string;
  domain: string;
  risk: RiskLevel;
  riskScore: number;
  degree: number;
  incomingCount: number;
  outgoingCount: number;
  tags: string[];
};

type SpaceNode = EnrichedNode & {
  cluster: string;
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
};

type Lens = {
  id: Persona;
  label: string;
  subtitle: string;
  match: (node: EnrichedNode) => boolean;
};

const MAX_SPACE_NODES = 420;

const SYSTEM_STOPWORDS = new Set(["app", "backend", "dev", "internal", "cmd", "pages", "components", "lib"]);

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
  accent: "#2dd4bf",
  accentMagenta: "#e879f9",
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

function basename(path: string) {
  return path.split("/").pop() || path;
}

function compactPath(path: string, max = 48) {
  if (path.length <= max) return path;
  return `${path.slice(0, 18)}...${path.slice(-(max - 21))}`;
}

function getSystem(node: GraphNode) {
  const parts = node.folder.split("/").filter(Boolean);
  if (parts[0] === "app" && parts[1] === "components" && parts[2]) return parts[2];
  if (parts[0] === "app" && parts[1]?.startsWith("(") && parts[2]) return parts[2];
  if (parts[0] === "app" && parts[1] === "lib" && parts[2]) return `lib/${parts[2]}`;
  if (parts[0] === "app" && parts[1]) return parts[1];
  if (parts[0] === "backend" && parts[1] === "internal" && parts[2]) return parts[2];
  if (parts[0] === "backend" && parts[1] === "cmd" && parts[2]) return `cmd/${parts[2]}`;
  if (parts[0] === "backend" && parts[1]) return parts[1];
  if (parts[0] === "dev" && parts[1]) return `dev/${parts[1]}`;
  return parts.find(p => !SYSTEM_STOPWORDS.has(p)) || parts.join("/") || "root";
}

function getDomain(node: GraphNode) {
  if (node.id.startsWith("backend/internal/")) return "backend/internal";
  if (node.id.startsWith("backend/cmd/")) return "backend/cmd";
  if (node.id.startsWith("app/(user)/")) return "app/user";
  if (node.id.startsWith("app/(overlay)/")) return "app/overlay";
  if (node.id.startsWith("app/components/")) return "app/components";
  if (node.id.startsWith("app/lib/")) return "app/lib";
  if (node.id.startsWith("app/hooks/")) return "app/hooks";
  if (node.id.startsWith("dev/")) return "dev";
  return node.side;
}

function includesAny(value: string, needles: string[]) {
  const lower = value.toLowerCase();
  return needles.some(needle => lower.includes(needle));
}

function tagNode(node: GraphNode, degree: number, incoming: number, outgoing: number, bridge: boolean) {
  const tags: string[] = [];
  const path = node.id.toLowerCase();
  if (includesAny(path, ["auth", "session", "login", "password", "credential", "token"])) tags.push("identity");
  if (includesAny(path, ["role", "permission", "rbac", "access"])) tags.push("access");
  if (includesAny(path, ["audit", "log", "history", "evidence"])) tags.push("audit");
  if (includesAny(path, ["sql", "migration", "db", "database", "query", "repo"])) tags.push("data");
  if (includesAny(path, ["api", "route", "handler", "client"])) tags.push("api");
  if (includesAny(path, ["test", "spec", "qa", "playwright", "vitest"])) tags.push("test");
  if (includesAny(path, ["dev", "debug", "visualiser", "launcher"])) tags.push("devtool");
  if (includesAny(path, ["sentinel", "security", "csrf", "dpop", "middleware"])) tags.push("security");
  if (bridge) tags.push("bridge");
  if (incoming >= 8) tags.push("fan-in");
  if (outgoing >= 10) tags.push("fan-out");
  if (degree >= 18) tags.push("hub");
  return tags;
}

function riskFor(tags: string[], degree: number, bridge: boolean): RiskLevel {
  const sensitive = tags.some(tag => ["identity", "access", "security", "data"].includes(tag));
  if ((sensitive && (degree >= 8 || bridge)) || degree >= 26) return "critical";
  if (sensitive || bridge || degree >= 16) return "high";
  if (degree >= 7 || tags.includes("api") || tags.includes("devtool")) return "medium";
  return "low";
}

function riskScoreFor(tags: string[], degree: number, incoming: number, outgoing: number, bridge: boolean) {
  let score = degree * 2 + Math.min(incoming, 12) + Math.min(outgoing, 14);
  if (bridge) score += 16;
  if (tags.includes("security")) score += 15;
  if (tags.includes("identity")) score += 14;
  if (tags.includes("access")) score += 12;
  if (tags.includes("data")) score += 10;
  if (tags.includes("api")) score += 6;
  if (tags.includes("test")) score -= 4;
  return Math.max(0, score);
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

function buildIndex(graph: Codegraph): GraphIndex {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  const bridges = new Set<string>();

  for (const node of graph.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
    if (edge.kind === "bridge") {
      bridges.add(edge.source);
      bridges.add(edge.target);
    }
  }

  const degree = new Map<string, number>();
  for (const node of graph.nodes) {
    degree.set(node.id, (incoming.get(node.id)?.length ?? 0) + (outgoing.get(node.id)?.length ?? 0));
  }

  return { byId, incoming, outgoing, degree, bridges };
}

function enrichNodes(graph: Codegraph, index: GraphIndex): EnrichedNode[] {
  return graph.nodes.map(node => {
    const incomingCount = index.incoming.get(node.id)?.length ?? 0;
    const outgoingCount = index.outgoing.get(node.id)?.length ?? 0;
    const degree = incomingCount + outgoingCount;
    const bridge = index.bridges.has(node.id);
    const tags = tagNode(node, degree, incomingCount, outgoingCount, bridge);
    const risk = riskFor(tags, degree, bridge);
    const riskScore = riskScoreFor(tags, degree, incomingCount, outgoingCount, bridge);
    return {
      ...node,
      system: getSystem(node),
      domain: getDomain(node),
      risk,
      riskScore,
      degree,
      incomingCount,
      outgoingCount,
      tags,
    };
  });
}

function connectedSet(index: GraphIndex, seed: string | null, mode: RelationMode, showImports: boolean, showBridges: boolean) {
  if (!seed) return new Set<string>();
  const connected = new Set<string>([seed]);
  const keepKind = (edge: GraphEdge) => {
    if (edge.kind === "import") return showImports;
    if (edge.kind === "bridge") return showBridges;
    return true;
  };

  if (mode === "both" || mode === "outgoing") {
    for (const edge of index.outgoing.get(seed) ?? []) {
      if (keepKind(edge)) connected.add(edge.target);
    }
  }
  if (mode === "both" || mode === "incoming") {
    for (const edge of index.incoming.get(seed) ?? []) {
      if (keepKind(edge)) connected.add(edge.source);
    }
  }
  return connected;
}

function clusterKey(node: EnrichedNode, mode: ClusterMode) {
  if (mode === "layer") return node.layer;
  if (mode === "risk") return node.risk;
  if (mode === "side") return node.side;
  return node.system;
}

function toSpaceNode(node: EnrichedNode, cluster: string, x: number, y: number, z: number): SpaceNode {
  return { ...node, cluster, x, y, z, fx: x, fy: y, fz: z };
}

function sortForLayout(nodes: EnrichedNode[]) {
  return [...nodes].sort((a, b) => b.riskScore - a.riskScore || b.degree - a.degree || a.id.localeCompare(b.id));
}

function dependencyPlane(node: EnrichedNode, selectedId: string | null, index: GraphIndex | null, mode: RelationMode) {
  if (!selectedId || !index || node.id === selectedId) return 0;
  const incoming = index.incoming.get(selectedId)?.some(edge => edge.source === node.id) ?? false;
  const outgoing = index.outgoing.get(selectedId)?.some(edge => edge.target === node.id) ?? false;
  if (mode === "incoming") return incoming ? 1 : 0;
  if (mode === "outgoing") return outgoing ? -1 : 0;
  if (incoming && outgoing) return 0;
  if (incoming) return 1;
  if (outgoing) return -1;
  return 0;
}

function placePhalanx(nodes: EnrichedNode[], clusterMode: ClusterMode, selectedId: string | null, index: GraphIndex | null, relationMode: RelationMode): SpaceNode[] {
  const selected = selectedId ? nodes.find(node => node.id === selectedId) : null;
  const ordered = selected
    ? [selected, ...sortForLayout(nodes.filter(node => node.id !== selectedId))]
    : sortForLayout(nodes);
  const cols = Math.max(4, Math.min(12, Math.ceil(Math.sqrt(Math.max(1, ordered.length)))));
  const xGap = 34;
  const yGap = 18;
  const zGap = 78;
  const slices = new Map<number, EnrichedNode[]>();

  for (const node of ordered) {
    const plane = selected ? dependencyPlane(node, selectedId, index, relationMode) : Array.from(new Set(ordered.map(n => clusterKey(n, clusterMode)))).indexOf(clusterKey(node, clusterMode));
    slices.set(plane, [...(slices.get(plane) ?? []), node]);
  }

  const placed: SpaceNode[] = [];
  const sortedPlanes = Array.from(slices.keys()).sort((a, b) => a - b);
  for (const plane of sortedPlanes) {
    const slice = slices.get(plane) ?? [];
    const rows = Math.max(1, Math.ceil(slice.length / cols));
    const xOrigin = -((cols - 1) * xGap) / 2;
    const yOrigin = ((rows - 1) * yGap) / 2;
    slice.forEach((node, indexInSlice) => {
      const col = indexInSlice % cols;
      const row = Math.floor(indexInSlice / cols);
      const cluster = clusterKey(node, clusterMode);
      placed.push(toSpaceNode(node, cluster, xOrigin + col * xGap, yOrigin - row * yGap, plane * zGap));
    });
  }
  return placed;
}

function placeArray(nodes: EnrichedNode[], clusterMode: ClusterMode): SpaceNode[] {
  const groups = new Map<string, EnrichedNode[]>();
  for (const node of sortForLayout(nodes)) {
    const key = clusterKey(node, clusterMode);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const placed: SpaceNode[] = [];
  const entries = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const cols = 10;
  const xGap = 34;
  const yGap = 18;
  const zGap = 76;
  entries.forEach(([cluster, group], sliceIndex) => {
    const rows = Math.max(1, Math.ceil(group.length / cols));
    const xOrigin = -((cols - 1) * xGap) / 2;
    const yOrigin = ((rows - 1) * yGap) / 2;
    const z = (sliceIndex - (entries.length - 1) / 2) * zGap;
    group.forEach((node, indexInSlice) => {
      const col = indexInSlice % cols;
      const row = Math.floor(indexInSlice / cols);
      placed.push(toSpaceNode(node, cluster, xOrigin + col * xGap, yOrigin - row * yGap, z));
    });
  });
  return placed;
}

function placeArc(nodes: EnrichedNode[], clusterMode: ClusterMode): SpaceNode[] {
  const sorted = sortForLayout(nodes);
  const count = Math.max(1, sorted.length);
  const radius = 280;
  const arcStart = -Math.PI * 0.78;
  const arcEnd = Math.PI * 0.78;
  return sorted.map((node, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angle = arcStart + (arcEnd - arcStart) * t;
    const cluster = clusterKey(node, clusterMode);
    const band = riskRank(node.risk) - 2.5;
    const layerOffset = (index % 9) - 4;
    return toSpaceNode(
      node,
      cluster,
      Math.cos(angle) * radius,
      layerOffset * 15,
      Math.sin(angle) * radius + band * 34,
    );
  });
}

function placeLeaf(nodes: EnrichedNode[], clusterMode: ClusterMode, selectedId: string | null): SpaceNode[] {
  const root = selectedId ? nodes.find(node => node.id === selectedId) : sortForLayout(nodes)[0];
  if (!root) return [];
  const branches = new Map<string, EnrichedNode[]>();
  for (const node of sortForLayout(nodes.filter(n => n.id !== root.id))) {
    const key = clusterKey(node, clusterMode);
    branches.set(key, [...(branches.get(key) ?? []), node]);
  }

  const placed: SpaceNode[] = [toSpaceNode(root, clusterKey(root, clusterMode), 0, 0, 0)];
  const entries = Array.from(branches.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  entries.forEach(([cluster, branch], branchIndex) => {
    const angle = (Math.PI * 2 * branchIndex) / Math.max(1, entries.length);
    branch.forEach((node, nodeIndex) => {
      const reach = 48 + nodeIndex * 22;
      const spread = Math.sin(nodeIndex * 0.85) * 24;
      placed.push(toSpaceNode(
        node,
        cluster,
        Math.cos(angle) * reach + Math.cos(angle + Math.PI / 2) * spread,
        Math.sin(nodeIndex * 0.6) * 18,
        Math.sin(angle) * reach + Math.sin(angle + Math.PI / 2) * spread,
      ));
    });
  });
  return placed;
}

function placeOrbit(nodes: EnrichedNode[], mode: ClusterMode): SpaceNode[] {
  const groups = new Map<string, EnrichedNode[]>();
  for (const node of nodes) {
    const key = clusterKey(node, mode);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }

  const entries = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const clusterCount = Math.max(1, entries.length);
  const orbitRadius = mode === "layer" ? 260 : 230;
  const layerGap = 82;
  const placed: SpaceNode[] = [];

  entries.forEach(([cluster, group], clusterIndex) => {
    const angle = (Math.PI * 2 * clusterIndex) / clusterCount;
    const ring = Math.floor(clusterIndex / 9);
    const radius = orbitRadius + ring * 90;
    const cx = Math.cos(angle) * radius;
    const cy = Math.sin(angle) * radius;
    const cz = mode === "layer"
      ? (clusterIndex - (clusterCount - 1) / 2) * layerGap
      : ((clusterIndex % 5) - 2) * 72;

    const sorted = [...group].sort((a, b) => b.riskScore - a.riskScore || b.degree - a.degree || a.id.localeCompare(b.id));
    sorted.forEach((node, localIndex) => {
      const shell = Math.floor(Math.sqrt(localIndex));
      const slot = localIndex - shell * shell;
      const slots = Math.max(1, shell * 2 + 1);
      const localAngle = (Math.PI * 2 * slot) / slots + shell * 0.62;
      const localRadius = shell === 0 ? 0 : 24 + shell * 18;
      const zWave = ((localIndex % 7) - 3) * 18;
      const x = cx + Math.cos(localAngle) * localRadius;
      const y = cy + Math.sin(localAngle) * localRadius;
      const z = cz + zWave;
      placed.push(toSpaceNode(node, cluster, x, y, z));
    });
  });

  return placed;
}

function placeNodes3D(nodes: EnrichedNode[], clusterMode: ClusterMode, layoutMode: LayoutMode, selectedId: string | null, index: GraphIndex | null, relationMode: RelationMode): SpaceNode[] {
  if (layoutMode === "phalanx") return placePhalanx(nodes, clusterMode, selectedId, index, relationMode);
  if (layoutMode === "array") return placeArray(nodes, clusterMode);
  if (layoutMode === "arc") return placeArc(nodes, clusterMode);
  if (layoutMode === "leaf") return placeLeaf(nodes, clusterMode, selectedId);
  return placeOrbit(nodes, clusterMode);
}

function riskRank(risk: RiskLevel) {
  if (risk === "critical") return 4;
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

const LENSES: Lens[] = [
  {
    id: "engineer",
    label: "Engineer",
    subtitle: "Familiarity, imports, ownership",
    match: node => node.degree >= 4 || ["page", "component", "service", "lib", "handler"].includes(node.layer),
  },
  {
    id: "architect",
    label: "Architect",
    subtitle: "Boundaries, bridges, hubs",
    match: node => node.tags.includes("bridge") || node.tags.includes("hub") || node.side === "backend" || node.layer === "handler",
  },
  {
    id: "auditor",
    label: "Auditor",
    subtitle: "SOC2 evidence and control surfaces",
    match: node => node.tags.some(tag => ["identity", "access", "audit", "data", "security", "api"].includes(tag)),
  },
  {
    id: "qa",
    label: "QA",
    subtitle: "Blast radius and bug magnets",
    match: node => node.risk !== "low" || node.tags.includes("fan-out") || node.tags.includes("bridge"),
  },
];

const VIEW_LABELS: { id: ViewMode; label: string }[] = [
  { id: "atlas", label: "Atlas" },
  { id: "matrix", label: "Matrix" },
  { id: "hotspots", label: "Hotspots" },
  { id: "evidence", label: "Evidence" },
];

const CLUSTER_LABELS: { id: ClusterMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "layer", label: "Layer" },
  { id: "risk", label: "Risk" },
  { id: "side", label: "Side" },
];

const LAYOUT_LABELS: { id: LayoutMode; label: string; hint: string }[] = [
  { id: "phalanx", label: "Phalanx", hint: "Grid slices by dependency depth" },
  { id: "array", label: "Array", hint: "Ordered stacked cluster planes" },
  { id: "arc", label: "Arc", hint: "Wide curved scan path" },
  { id: "leaf", label: "Leaf", hint: "Radial branch pattern" },
  { id: "orbit", label: "Orbit", hint: "Exploratory clustered space" },
];

export default function DevVisualiserPanelV3() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [graph, setGraph] = useState<Codegraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>("engineer");
  const [viewMode, setViewMode] = useState<ViewMode>("atlas");
  const [clusterMode, setClusterMode] = useState<ClusterMode>("layer");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("phalanx");
  const [relationMode, setRelationMode] = useState<RelationMode>("both");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [sideFilter, setSideFilter] = useState<Side | "all">("all");
  const [showImports, setShowImports] = useState(true);
  const [showBridges, setShowBridges] = useState(true);
  const [source, setSource] = useState<string | null>(null);
  const [sourceState, setSourceState] = useState<"idle" | "loading" | "error">("idle");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const index = useMemo(() => (graph ? buildIndex(graph) : null), [graph]);
  const enriched = useMemo(() => (graph && index ? enrichNodes(graph, index) : []), [graph, index]);
  const enrichedById = useMemo(() => new Map(enriched.map(node => [node.id, node])), [enriched]);
  const activeLens = LENSES.find(lens => lens.id === persona) ?? LENSES[0];

  const selected = selectedId ? enrichedById.get(selectedId) ?? null : null;
  const selectedConnections = useMemo(
    () => (index ? connectedSet(index, selectedId, relationMode, showImports, showBridges) : new Set<string>()),
    [index, relationMode, selectedId, showBridges, showImports],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(node => {
      if (sideFilter !== "all" && node.side !== sideFilter) return false;
      if (riskFilter !== "all" && node.risk !== riskFilter) return false;
      if (q && !`${node.id} ${node.layer} ${node.system} ${node.tags.join(" ")}`.toLowerCase().includes(q)) return false;
      return activeLens.match(node);
    });
  }, [activeLens, enriched, riskFilter, search, sideFilter]);

  const atlasNodes = useMemo(() => {
    if (selectedId) {
      const focusNodes = enriched.filter(node => selectedConnections.has(node.id));
      return placeNodes3D(focusNodes, clusterMode, layoutMode, selectedId, index, relationMode);
    }
    const rest = filtered
      .sort((a, b) => b.riskScore - a.riskScore || b.degree - a.degree || a.id.localeCompare(b.id));
    return placeNodes3D(rest.slice(0, MAX_SPACE_NODES), clusterMode, layoutMode, selectedId, index, relationMode);
  }, [clusterMode, enriched, filtered, index, layoutMode, relationMode, selectedConnections, selectedId]);

  const atlasNodeIds = useMemo(() => new Set(atlasNodes.map(node => node.id)), [atlasNodes]);

  const atlasEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter(edge => {
      if (edge.kind === "import" && !showImports) return false;
      if (edge.kind === "bridge" && !showBridges) return false;
      if (!atlasNodeIds.has(edge.source) || !atlasNodeIds.has(edge.target)) return false;
      return true;
    });
  }, [atlasNodeIds, graph, showBridges, showImports]);

  const stats = useMemo(() => {
    const critical = enriched.filter(node => node.risk === "critical").length;
    const high = enriched.filter(node => node.risk === "high").length;
    const auditor = enriched.filter(node => LENSES[2].match(node)).length;
    const qaHotspots = enriched.filter(node => node.riskScore >= 30 && !node.tags.includes("test")).length;
    return {
      nodes: enriched.length,
      edges: graph?.edges.length ?? 0,
      critical,
      high,
      auditor,
      qaHotspots,
      shown: atlasNodes.length,
    };
  }, [atlasNodes.length, enriched, graph]);

  const topHotspots = useMemo(() => {
    return [...filtered]
      .sort((a, b) => b.riskScore - a.riskScore || riskRank(b.risk) - riskRank(a.risk) || a.id.localeCompare(b.id))
      .slice(0, 24);
  }, [filtered]);

  const matrixRows = useMemo(() => {
    const rows = new Map<string, { key: string; nodes: number; edges: number; critical: number; high: number; backend: number; frontend: number }>();
    for (const node of filtered) {
      const key = clusterKey(node, clusterMode);
      const row = rows.get(key) ?? { key, nodes: 0, edges: 0, critical: 0, high: 0, backend: 0, frontend: 0 };
      row.nodes += 1;
      row.edges += node.degree;
      if (node.risk === "critical") row.critical += 1;
      if (node.risk === "high") row.high += 1;
      if (node.side === "backend") row.backend += 1;
      if (node.side === "frontend") row.frontend += 1;
      rows.set(key, row);
    }
    return Array.from(rows.values()).sort((a, b) => b.edges - a.edges || b.nodes - a.nodes || a.key.localeCompare(b.key)).slice(0, 28);
  }, [clusterMode, filtered]);

  const evidenceBuckets = useMemo(() => {
    const bucketDefs = [
      { key: "Identity", tags: ["identity", "security"], control: "Access control and authentication surface" },
      { key: "Authorization", tags: ["access"], control: "RBAC, roles, permissions and privilege boundaries" },
      { key: "Auditability", tags: ["audit"], control: "Audit trail, logs and review evidence" },
      { key: "Data", tags: ["data"], control: "Persistence, migrations, SQL and data handling" },
      { key: "Boundary", tags: ["api", "bridge"], control: "Frontend/backend interfaces and integration seams" },
      { key: "Dev Surface", tags: ["devtool"], control: "Dev-only tooling that must stay gated" },
    ];
    return bucketDefs.map(bucket => ({
      ...bucket,
      nodes: enriched
        .filter(node => node.tags.some(tag => bucket.tags.includes(tag)))
        .sort((a, b) => b.riskScore - a.riskScore || a.id.localeCompare(b.id))
        .slice(0, 8),
    }));
  }, [enriched]);

  useEffect(() => {
    if (!selectedId || !/\.[a-z0-9]+$/i.test(selectedId)) {
      setSource(null);
      setSourceState("idle");
      return;
    }
    let cancelled = false;
    setSourceState("loading");
    fetch(`/_site/admin/dev/source?path=${encodeURIComponent(selectedId)}`, { credentials: "include" })
      .then(async res => {
        if (!res.ok) throw new Error(await res.text());
        return res.text();
      })
      .then(text => {
        if (cancelled) return;
        setSource(text.split("\n").slice(0, 90).join("\n"));
        setSourceState("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setSource(null);
        setSourceState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

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

  function selectNode(id: string) {
    setSelectedId(id);
    setViewMode("atlas");
  }

  if (loading) {
    return <div className="dui-viz-v3 dui-viz-v3--loading">Loading code intelligence atlas...</div>;
  }

  if (error || !graph || !index) {
    return (
      <div className="dui-viz-v3 dui-viz-v3--loading">
        <div className="dui-viz-v3__empty">{error ?? "No graph data available."}</div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`dui-viz-v3${isExpanded ? " is-expanded" : ""}${isFullscreen ? " is-fullscreen" : ""}`}>
      <header className="dui-viz-v3__header">
        <div className="dui-viz-v3__brand">
          <span className="dui-viz-v3__brand-mark" />
          <div>
            <div className="dui-viz-v3__eyebrow">code intelligence atlas</div>
            <h2 className="dui-viz-v3__title">Visualiser V3</h2>
          </div>
        </div>
        <div className="dui-viz-v3__kpis" aria-label="Graph summary">
          <Metric label="Nodes" value={stats.nodes} />
          <Metric label="Edges" value={stats.edges} />
          <Metric label="Critical" value={stats.critical} tone="danger" />
          <Metric label="Audit files" value={stats.auditor} tone="info" />
          <Metric label="QA hotspots" value={stats.qaHotspots} tone="warn" />
          <Metric label="On map" value={stats.shown} />
        </div>
        <div className="dui-viz-v3__header-actions">
          {selectedId && (
            <button className="dui-btn dui-btn--sm dui-btn--primary" type="button" onClick={() => setSelectedId(null)}>
              Release Card
            </button>
          )}
          <button className="dui-btn dui-btn--sm" type="button" onClick={() => setIsExpanded(value => !value)}>
            {isExpanded ? "Dock" : "Expand"}
          </button>
          <button className="dui-btn dui-btn--sm" type="button" onClick={toggleFullscreen}>
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </header>

      <section className="dui-viz-v3__command">
        <div className="dui-viz-v3__lenses" aria-label="Persona lenses">
          {LENSES.map(lens => (
            <button
              key={lens.id}
              className={`dui-viz-v3__lens${persona === lens.id ? " is-active" : ""}`}
              onClick={() => setPersona(lens.id)}
              type="button"
            >
              <span className="dui-viz-v3__lens-label">{lens.label}</span>
              <span className="dui-viz-v3__lens-subtitle">{lens.subtitle}</span>
            </button>
          ))}
        </div>
        <div className="dui-viz-v3__search">
          <input
            className="dui-input dui-viz-v3__search-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search path, system, layer, tag..."
          />
          <select className="dui-form__select" value={sideFilter} onChange={event => setSideFilter(event.target.value as Side | "all")}>
            <option value="all">All sides</option>
            <option value="frontend">Frontend</option>
            <option value="backend">Backend</option>
          </select>
          <select className="dui-form__select" value={riskFilter} onChange={event => setRiskFilter(event.target.value as RiskLevel | "all")}>
            <option value="all">All risk</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </section>

      <section className="dui-viz-v3__workbench">
        <aside className="dui-viz-v3__left">
          <PanelBlock title="Views">
            <div className="dui-viz-v3__button-grid">
              {VIEW_LABELS.map(view => (
                <button
                  key={view.id}
                  className={`dui-btn dui-btn--sm${viewMode === view.id ? " dui-btn--primary" : ""}`}
                  type="button"
                  onClick={() => setViewMode(view.id)}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </PanelBlock>

          <PanelBlock title="Design layout">
            <div className="dui-viz-v3__layout-list">
              {LAYOUT_LABELS.map(layout => (
                <button
                  key={layout.id}
                  className={`dui-viz-v3__layout-btn${layoutMode === layout.id ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setLayoutMode(layout.id)}
                >
                  <span className="dui-viz-v3__layout-label">{layout.label}</span>
                  <span className="dui-viz-v3__layout-hint">{layout.hint}</span>
                </button>
              ))}
            </div>
          </PanelBlock>

          <PanelBlock title="Cluster">
            <div className="dui-viz-v3__button-grid">
              {CLUSTER_LABELS.map(mode => (
                <button
                  key={mode.id}
                  className={`dui-btn dui-btn--sm${clusterMode === mode.id ? " dui-btn--primary" : ""}`}
                  type="button"
                  onClick={() => setClusterMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </PanelBlock>

          <PanelBlock title="Relationships">
            <label className="dui-form__switch">
              <input type="checkbox" checked={showImports} onChange={event => setShowImports(event.target.checked)} />
              Imports
            </label>
            <label className="dui-form__switch">
              <input type="checkbox" checked={showBridges} onChange={event => setShowBridges(event.target.checked)} />
              Bridges
            </label>
            <div className="dui-viz-v3__segmented" aria-label="Relation direction">
              {(["both", "incoming", "outgoing"] as RelationMode[]).map(mode => (
                <button
                  key={mode}
                  className={`dui-viz-v3__segment${relationMode === mode ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setRelationMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            {selectedId && (
              <button className="dui-btn dui-btn--sm" type="button" onClick={() => setSelectedId(null)}>
                Release selected card
              </button>
            )}
          </PanelBlock>

          <PanelBlock title="Saved lenses">
            <button className="dui-viz-v3__lens-row" type="button" onClick={() => { setPersona("auditor"); setRiskFilter("high"); setSideFilter("all"); }}>
              SOC2 high-risk surface
            </button>
            <button className="dui-viz-v3__lens-row" type="button" onClick={() => { setPersona("qa"); setRiskFilter("all"); setClusterMode("risk"); }}>
              QA blast radius
            </button>
            <button className="dui-viz-v3__lens-row" type="button" onClick={() => { setPersona("architect"); setClusterMode("side"); setShowBridges(true); }}>
              Architecture bridges
            </button>
          </PanelBlock>
        </aside>

        <main className="dui-viz-v3__main">
          {viewMode === "atlas" && (
            <Atlas3DView
              clusterMode={clusterMode}
              layoutMode={layoutMode}
              edges={atlasEdges}
              nodes={atlasNodes}
              selectedId={selectedId}
              onSelect={selectNode}
            />
          )}
          {viewMode === "matrix" && <MatrixView rows={matrixRows} onSearch={setSearch} />}
          {viewMode === "hotspots" && <HotspotsView nodes={topHotspots} onSelect={selectNode} />}
          {viewMode === "evidence" && <EvidenceView buckets={evidenceBuckets} onSelect={selectNode} />}
        </main>

        <aside className="dui-viz-v3__right">
          <Inspector
            index={index}
            node={selected}
            relatedCount={Math.max(0, selectedConnections.size - 1)}
            source={source}
            sourceState={sourceState}
            onSelect={selectNode}
            onSetPersona={setPersona}
            onSetViewMode={setViewMode}
          />
        </aside>
      </section>

      <footer className="dui-viz-v3__footer">
        <span>snapshot {graph.generated_at}</span>
        <span>{activeLens.label} lens</span>
        <span>{filtered.length} candidates</span>
        <span>{selected ? compactPath(selected.id, 64) : "select a node to inspect relationships"}</span>
      </footer>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warn" | "info" }) {
  return (
    <div className={`dui-viz-v3__metric${tone ? ` dui-viz-v3__metric--${tone}` : ""}`}>
      <span className="dui-viz-v3__metric-value">{value.toLocaleString()}</span>
      <span className="dui-viz-v3__metric-label">{label}</span>
    </div>
  );
}

function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dui-viz-v3__panel-block">
      <h3 className="dui-viz-v3__panel-title">{title}</h3>
      <div className="dui-viz-v3__panel-body">{children}</div>
    </section>
  );
}

function Atlas3DView({
  nodes,
  edges,
  clusterMode,
  layoutMode,
  selectedId,
  onSelect,
}: {
  nodes: SpaceNode[];
  edges: GraphEdge[];
  clusterMode: ClusterMode;
  layoutMode: LayoutMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<any>(null);
  const textureCacheRef = useRef<Map<string, any>>(new Map());
  const mouseModesRef = useRef({ rotate: 0, pan: 2 });

  const graphData = useMemo(() => {
    const graphNodes = nodes.map(node => ({
      ...node,
      dimmed: false,
      selected: node.id === selectedId,
    }));
    const keep = new Set(graphNodes.map(node => node.id));
    const graphLinks = edges.filter(edge => keep.has(edge.source) && keep.has(edge.target)).map(edge => ({
      ...edge,
      dimmed: false,
    }));
    return { nodes: graphNodes, links: graphLinks };
  }, [edges, nodes, selectedId]);

  const clusterLegend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) counts.set(node.cluster, (counts.get(node.cluster) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([cluster, count]) => ({ cluster, count }))
      .sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster))
      .slice(0, 12);
  }, [nodes]);

  useEffect(() => {
    return () => {
      fgRef.current?._destructor?.();
      fgRef.current = null;
    };
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    };

    const setPanMode = (active: boolean) => {
      const controls = fgRef.current?.controls?.();
      if (controls?.mouseButtons) {
        controls.mouseButtons.LEFT = active ? mouseModesRef.current.pan : mouseModesRef.current.rotate;
        controls.update?.();
      }
      hostRef.current?.classList.toggle("is-space-pan", active);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditableTarget(event.target)) return;
      event.preventDefault();
      setPanMode(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      setPanMode(false);
    };

    const onBlur = () => setPanMode(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setPanMode(false);
    };
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;

    (async () => {
      const [{ default: ForceGraph3D }, THREE] = await Promise.all([
        import("3d-force-graph"),
        import("three"),
      ]);
      if (cancelled || !hostRef.current) return;
      mouseModesRef.current = { rotate: THREE.MOUSE.ROTATE, pan: THREE.MOUSE.PAN };

      const computed = getComputedStyle(hostRef.current);
      const rootComputed = getComputedStyle(document.documentElement);
      const color = (name: string, fallbackVar: string, fallback: string) =>
        computed.getPropertyValue(name).trim() || rootComputed.getPropertyValue(fallbackVar).trim() || fallback;
      const palette = {
        canvas: color("--v3-canvas", "--surface-sunken", "black"),
        surface: color("--v3-surface", "--surface", "black"),
        text: color("--v3-text", "--ink", "white"),
        muted: color("--v3-muted", "--ink-muted", "gray"),
        info: color("--v3-info", "--info", "blue"),
        warn: color("--v3-warn", "--warning", "orange"),
        danger: color("--v3-danger", "--danger", "red"),
        success: color("--v3-success", "--success", "green"),
      };

      const nodeObject = (node: any) => {
        const colour = LAYER_COLOUR[node.layer] ?? "#888";
        const score = node.degree ?? 0;
        const depth = Math.max(1, Math.min(6, 1 + Math.log2(score + 1)));
        const tex = buildCardTexture(THREE, textureCacheRef.current, node.id, node.layer, score, colour, Boolean(node.dimmed));
        const cardMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: node.dimmed ? 0.3 : 1 });
        const sideMat = new THREE.MeshBasicMaterial({
          color: colour,
          opacity: node.dimmed ? 0.12 : 0.85,
          transparent: true,
        });
        const materials = [sideMat, sideMat, sideMat, sideMat, cardMat, sideMat];
        const geometry = new THREE.BoxGeometry(16, 8, depth);
        const mesh = new THREE.Mesh(geometry, materials);
        if (node.selected) {
          const outline = new THREE.Mesh(
            new THREE.BoxGeometry(17, 9, depth + 0.35),
            new THREE.MeshBasicMaterial({ color: palette.info, wireframe: true, transparent: true, opacity: 0.95 }),
          );
          const group = new THREE.Group();
          group.add(mesh);
          group.add(outline);
          return group;
        }
        return mesh;
      };

      if (!fgRef.current) {
        fgRef.current = new ForceGraph3D(hostRef.current)
          .backgroundColor(palette.canvas)
          .d3VelocityDecay(0.92)
          .cooldownTicks(24)
          .nodeThreeObject(nodeObject)
          .nodeLabel((node: any) => `${node.id}\n${node.cluster} | ${node.layer} | ${node.risk} | ${node.degree} links`)
          .linkColor((edge: any) => {
            if (edge.dimmed) return palette.muted;
            return edge.kind === "bridge" ? palette.success : palette.muted;
          })
          .linkOpacity(0.34)
          .linkWidth((edge: any) => (edge.kind === "bridge" ? 1.3 : 0.35))
          .linkDirectionalArrowLength(3)
          .linkDirectionalArrowRelPos(0.94)
          .linkDirectionalParticles((edge: any) => (edge.kind === "bridge" && !edge.dimmed ? 2 : 0))
          .linkDirectionalParticleWidth(1.8)
          .onNodeClick((node: any) => onSelect(node.id));
      } else {
        fgRef.current
          .nodeThreeObject(nodeObject)
          .onNodeClick((node: any) => onSelect(node.id));
      }

      fgRef.current.graphData(graphData);
      const rect = hostRef.current.getBoundingClientRect();
      fgRef.current.width(rect.width).height(rect.height);
    })();

    return () => {
      cancelled = true;
    };
  }, [graphData, onSelect]);

  useEffect(() => {
    if (!hostRef.current) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect || !fgRef.current) return;
      fgRef.current.width(rect.width).height(rect.height);
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedId || !fgRef.current) return;
    const selected = graphData.nodes.find(node => node.id === selectedId);
    if (!selected) return;

    const fg = fgRef.current;
    const camera = fg.camera?.();
    const rect = hostRef.current?.getBoundingClientRect();
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : camera?.aspect ?? 16 / 9;
    const fovRad = (((camera?.fov ?? 60) * Math.PI) / 180);
    const fill = 0.5;
    const cardWidth = 16;
    const cardHeight = 8;
    const fitHeightDistance = (cardHeight / 2) / (Math.tan(fovRad / 2) * fill);
    const fitWidthDistance = (cardWidth / 2) / (Math.tan(fovRad / 2) * aspect * fill);
    const distance = Math.max(24, fitHeightDistance, fitWidthDistance);
    const target = { x: selected.x, y: selected.y, z: selected.z };

    camera?.up?.set?.(0, 1, 0);
    fg.cameraPosition(
      { x: selected.x, y: selected.y, z: selected.z + distance },
      target,
      900,
    );
    const controls = fg.controls?.();
    controls?.target?.set?.(target.x, target.y, target.z);
    controls?.update?.();
  }, [graphData.nodes, selectedId]);

  return (
    <div className="dui-viz-v3__atlas dui-viz-v3__atlas--3d">
      <div ref={hostRef} className="dui-viz-v3__space" aria-label="3D code relationship space" />
      <div className="dui-viz-v3__space-legend" aria-label="Visible 3D clusters">
        <span className="dui-viz-v3__space-legend-title">{layoutMode} by {clusterMode}</span>
        {clusterLegend.map(item => (
          <span key={item.cluster} className="dui-viz-v3__space-legend-item">
            {item.cluster} {item.count}
          </span>
        ))}
      </div>
      <div className="dui-viz-v3__atlas-note">
        <span>Drag to rotate, wheel to zoom, hold Space and drag to pan. Click a card to fly to its dependency neighbourhood.</span>
        <span>3D space is capped to the strongest {MAX_SPACE_NODES} visible candidates for scan speed.</span>
      </div>
    </div>
  );
}

function MatrixView({ rows, onSearch }: { rows: { key: string; nodes: number; edges: number; critical: number; high: number; backend: number; frontend: number }[]; onSearch: (value: string) => void }) {
  return (
    <div className="dui-viz-v3__table-wrap">
      <table className="dui-table dui-viz-v3__table">
        <thead>
          <tr>
            <th>Cluster</th>
            <th>Nodes</th>
            <th>Links</th>
            <th>Critical</th>
            <th>High</th>
            <th>Frontend</th>
            <th>Backend</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td>{row.nodes}</td>
              <td>{row.edges}</td>
              <td>{row.critical}</td>
              <td>{row.high}</td>
              <td>{row.frontend}</td>
              <td>{row.backend}</td>
              <td>
                <button className="dui-btn dui-btn--sm" type="button" onClick={() => onSearch(row.key)}>
                  Focus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HotspotsView({ nodes, onSelect }: { nodes: EnrichedNode[]; onSelect: (id: string) => void }) {
  return (
    <div className="dui-viz-v3__hotspots">
      {nodes.map((node, index) => (
        <button key={node.id} className={`dui-viz-v3__hotspot dui-viz-v3__hotspot--${node.risk}`} type="button" onClick={() => onSelect(node.id)}>
          <span className="dui-viz-v3__hotspot-rank">{index + 1}</span>
          <span className="dui-viz-v3__hotspot-main">
            <strong>{compactPath(node.id, 72)}</strong>
            <span>{node.system} | {node.layer} | {node.incomingCount} in | {node.outgoingCount} out</span>
          </span>
          <span className="dui-viz-v3__hotspot-score">{node.riskScore}</span>
        </button>
      ))}
    </div>
  );
}

function EvidenceView({
  buckets,
  onSelect,
}: {
  buckets: { key: string; tags: string[]; control: string; nodes: EnrichedNode[] }[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="dui-viz-v3__evidence">
      {buckets.map(bucket => (
        <section key={bucket.key} className="dui-viz-v3__evidence-band">
          <div className="dui-viz-v3__evidence-head">
            <h3>{bucket.key}</h3>
            <span>{bucket.control}</span>
          </div>
          <div className="dui-viz-v3__evidence-list">
            {bucket.nodes.length === 0 && <span className="dui-viz-v3__empty">No files matched this control bucket.</span>}
            {bucket.nodes.map(node => (
              <button key={node.id} className="dui-viz-v3__evidence-row" type="button" onClick={() => onSelect(node.id)}>
                <span>{compactPath(node.id, 70)}</span>
                <span className={`dui-pill dui-pill--${node.risk === "critical" ? "critical" : node.risk === "high" ? "fail" : node.risk === "medium" ? "warn" : "neutral"}`}>
                  {node.risk}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Inspector({
  node,
  index,
  relatedCount,
  source,
  sourceState,
  onSelect,
  onSetPersona,
  onSetViewMode,
}: {
  node: EnrichedNode | null;
  index: GraphIndex;
  relatedCount: number;
  source: string | null;
  sourceState: "idle" | "loading" | "error";
  onSelect: (id: string) => void;
  onSetPersona: (persona: Persona) => void;
  onSetViewMode: (mode: ViewMode) => void;
}) {
  if (!node) {
    return (
      <div className="dui-viz-v3__inspector">
        <h3>Inspector</h3>
        <div className="dui-viz-v3__empty">Select a file to inspect fan-in, fan-out, risk tags, source preview and evidence context.</div>
      </div>
    );
  }

  const incoming = index.incoming.get(node.id) ?? [];
  const outgoing = index.outgoing.get(node.id) ?? [];

  return (
    <div className="dui-viz-v3__inspector">
      <div className="dui-viz-v3__inspector-head">
        <h3>{basename(node.id)}</h3>
        <span className={`dui-pill dui-pill--${node.risk === "critical" ? "critical" : node.risk === "high" ? "fail" : node.risk === "medium" ? "warn" : "neutral"}`}>
          {node.risk}
        </span>
      </div>
      <p className="dui-viz-v3__path">{node.id}</p>

      <div className="dui-viz-v3__mini-grid">
        <Metric label="Incoming" value={node.incomingCount} />
        <Metric label="Outgoing" value={node.outgoingCount} />
        <Metric label="Score" value={node.riskScore} tone={node.risk === "critical" || node.risk === "high" ? "danger" : "info"} />
        <Metric label="Connected" value={relatedCount} />
      </div>

      <div className="dui-viz-v3__tag-list">
        {node.tags.map(tag => <span key={tag} className="dui-pill dui-pill--neutral">{tag}</span>)}
      </div>

      <div className="dui-viz-v3__action-row">
        <button className="dui-btn dui-btn--sm" type="button" onClick={() => { onSetPersona("qa"); onSetViewMode("hotspots"); }}>
          QA
        </button>
        <button className="dui-btn dui-btn--sm" type="button" onClick={() => { onSetPersona("auditor"); onSetViewMode("evidence"); }}>
          SOC2
        </button>
        <button className="dui-btn dui-btn--sm" type="button" onClick={() => { onSetPersona("architect"); onSetViewMode("matrix"); }}>
          Boundary
        </button>
      </div>

      <RelationList title="Incoming" edges={incoming.slice(0, 8)} otherSide="source" onSelect={onSelect} />
      <RelationList title="Outgoing" edges={outgoing.slice(0, 8)} otherSide="target" onSelect={onSelect} />

      <div className="dui-viz-v3__source">
        <div className="dui-viz-v3__source-head">Source preview</div>
        {sourceState === "loading" && <div className="dui-viz-v3__empty">Loading source...</div>}
        {sourceState === "error" && <div className="dui-viz-v3__empty">Source preview unavailable.</div>}
        {source && <pre className="dui-viz-v3__source-pre">{source}</pre>}
      </div>
    </div>
  );
}

function RelationList({
  title,
  edges,
  otherSide,
  onSelect,
}: {
  title: string;
  edges: GraphEdge[];
  otherSide: "source" | "target";
  onSelect: (id: string) => void;
}) {
  return (
    <section className="dui-viz-v3__relation-list">
      <h4>{title}</h4>
      {edges.length === 0 && <div className="dui-viz-v3__empty">none</div>}
      {edges.map(edge => {
        const id = edge[otherSide];
        return (
          <button key={`${title}-${edge.source}-${edge.target}-${edge.kind}`} className="dui-viz-v3__relation-row" type="button" onClick={() => onSelect(id)}>
            <span>{compactPath(id, 42)}</span>
            <span className={`dui-viz-v3__edge-pill dui-viz-v3__edge-pill--${edge.kind}`}>{edge.kind}</span>
          </button>
        );
      })}
    </section>
  );
}
