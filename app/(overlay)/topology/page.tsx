"use client";

// PLA-0006 — /topology (overlay redesign, React Flow edition).
//
// Full-viewport overlay org chart inspired by app.orgchart.unaric.com:
//   • Vertical tree (root at top, children fan downward) — laid out by
//     dagre (rankdir TB).
//   • Custom <OrgNodeCard> nodes rendered as real DOM so kebab + chevron
//     are plain buttons — no canvas hit-test math.
//   • Context menu (Add child / Edit / Delete / Duplicate)
//   • Right-side edit flyout (Name / Description / Colour / Label)
//   • "Finish" button top-right returns to previous route
//
// This page lives in the (overlay) route group so it does NOT render
// inside the AppShell — it owns the entire viewport.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import {
  topologyApi,
  type OrgNode,
  type PreviewMoveResult,
} from "@/app/lib/topologyApi";
import {
  workspacesApi,
  WORKSPACES_CHANGED_EVENT,
  type Workspace,
} from "@/app/lib/workspacesApi";
import { useAuth } from "@/app/contexts/AuthContext";
import { useTopologyHandoffs } from "@/app/hooks/useTopologyHandoffs";
import Panel from "@/app/components/Panel";
import ToggleBtnN from "@/app/components/ToggleBtnN";
import TopologyTreeFlyout from "@/app/components/TopologyTreeFlyout";
import InlineEditField from "@/app/components/InlineEditField";
import { TbDots, TbChevronDown, TbChevronUp, TbAlertTriangle } from "react-icons/tb";
import { BsArrowsFullscreen, BsFullscreenExit } from "react-icons/bs";
import ArchiveMapFlyout from "@/app/components/ArchiveMapFlyout";

// ── geometry ────────────────────────────────────────────────────────
const NODE_W = 336;
const NODE_H = 139;
// Selected node renders 40% larger so the focused card stands out from
// its siblings. Layout reserves the bigger box (so neighbours shift) and
// the card itself paints into the bigger wrapper.
const SELECTED_NODE_SCALE = 1.4;
const SELECTED_NODE_W = Math.round(NODE_W * SELECTED_NODE_SCALE);
const SELECTED_NODE_H = Math.round(NODE_H * SELECTED_NODE_SCALE);
const RANK_SEP = 80; // vertical gap between rows
const NODE_SEP = 40; // horizontal gap between siblings

// User-toggleable view modes (toolbar buttons in TopologyPage).
type RankDir = "TB" | "LR";
// React Flow built-in edge types: "default" = parabolic Bezier curves,
// "step" = orthogonal right-angles, "straight" = direct diagonals.
// `smoothstep` is rounded right-angles, NOT parabolic — don't use it here.
type EdgeKind = "default" | "step" | "straight";
// Authoring mode: "sandbox" = scratchpad for laying out / experimenting
// before committing; "live" = the canonical persisted topology that
// drives the rest of the app. Defaults to "sandbox" so users have a
// safe place to plan before hitting live.
type CanvasMode = "sandbox" | "live";

// Two-letter monogram: first letter of the first two whitespace-split tokens,
// uppercased. Strips bracketed segments and non-letter chars first so
// "Retail (copy)" → "RE", not "R(". "ACME Bank" → "AB"; "Sales" → "SA"; empty → "?".
function initialsFor(name: string): string {
  const cleaned = name
    .replace(/\([^)]*\)/g, " ") // drop "(copy)" etc.
    .replace(/[^\p{L}\s]/gu, " "); // drop punctuation, keep letters + whitespace
  const tokens = cleaned.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "?";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[1][0]).toUpperCase();
}

const COLOUR_PALETTE = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#06b6d4", // cyan
  "#6366f1", // indigo
];

// Hash a string to a stable colour from the palette so a node without
// an explicit colour still gets a consistent band.
function paletteColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLOUR_PALETTE[Math.abs(h) % COLOUR_PALETTE.length];
}

// Data the custom node component receives via Node.data
type OrgNodeData = {
  org: OrgNode;
  childCount: number;
  archivedDescendantCount: number;
  collapsed: boolean;
  hasChildren: boolean;
  rankdir: RankDir;
  onToggleCollapse: (id: string) => void;
  onOpenMenu: (id: string, screenX: number, screenY: number) => void;
  onOpenArchiveMap: (id: string, name: string) => void;
  onRename: (id: string, name: string) => Promise<boolean> | boolean;
};

// ──────────────────────────────────────────────────────────────────────
// Custom node — DOM-rendered card
// ──────────────────────────────────────────────────────────────────────

function OrgNodeCard({ id, data, selected }: NodeProps<Node<OrgNodeData>>) {
  const {
    org,
    childCount,
    archivedDescendantCount,
    collapsed,
    hasChildren,
    rankdir,
    onToggleCollapse,
    onOpenMenu,
    onOpenArchiveMap,
    onRename,
  } = data;
  const targetPos = rankdir === "LR" ? Position.Left : Position.Top;
  const sourcePos = rankdir === "LR" ? Position.Right : Position.Bottom;
  const archived = org.archived_at != null;
  // Teams count isn't on the OrgNode model yet. Render the segment only when
  // present so the dot separator stays correct ("2 children" vs "2 children
  // · 14 teams"). Wired to undefined for now.
  const teamCount: number | undefined = undefined;
  const sub = org.label_override || (org.parent_id === null ? "Root organisation" : "Department");
  const initials = initialsFor(org.name);
  const accent = org.colour || paletteColour(org.id);

  const handleKebab = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenMenu(id, e.clientX, e.clientY);
  };
  const handleChevron = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse(id);
  };
  const handleArchiveMap = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenArchiveMap(id, org.name);
  };

  return (
    <div
      className={`org-node-card${selected ? " is-selected" : ""}${archived ? " is-archived" : ""}`}
      style={
        {
          width: selected ? SELECTED_NODE_W : NODE_W,
          height: selected ? SELECTED_NODE_H : NODE_H,
          borderLeftColor: accent,
          // Exposed so the .is-selected ring can match the node's accent
          // colour (or its hashed-palette fallback) without each card
          // having to inline a box-shadow.
          ["--node-accent" as string]: accent,
        } as React.CSSProperties
      }
    >
      {/* Hidden handles so React Flow can draw orthogonal edges TB */}
      <Handle type="target" position={targetPos} className="org-node-card__handle" />
      <Handle type="source" position={sourcePos} className="org-node-card__handle" />

      <header className="org-node-card__header">
        <div className="org-node-card__avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="org-node-card__heading">
          {selected ? (
            <span
              className="org-node-card__name-wrap nodrag"
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <InlineEditField
                value={org.name}
                ariaLabel={`Rename ${org.name}`}
                clickToEdit
                stopPointerOnInput
                displayClassName="org-node-card__name"
                inputClassName="org-node-card__name-input"
                containerClassName="org-node-card__name-edit"
                maxLength={120}
                onCommit={(next) => {
                  // Fire-and-forget — InlineEditField only consumes sync
                  // return values; the parent reload reconciles errors.
                  void onRename(id, next);
                }}
              />
            </span>
          ) : (
            <h3 className="org-node-card__name" title={org.name}>
              {org.name}
            </h3>
          )}
          <p className="org-node-card__sub">{sub}</p>
        </div>
        <div className="org-node-card__actions">
          {archivedDescendantCount > 0 && (
            <button
              type="button"
              className="btn btn--icon btn--xs btn--ghost org-node-card__icon-btn org-node-card__icon-btn--warn nodrag"
              aria-label={`${archivedDescendantCount} archived descendant${archivedDescendantCount === 1 ? "" : "s"} — open archive map`}
              title={`${archivedDescendantCount} archived descendant${archivedDescendantCount === 1 ? "" : "s"}`}
              onClick={handleArchiveMap}
            >
              <TbAlertTriangle aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="btn btn--icon btn--xs btn--ghost org-node-card__icon-btn nodrag"
            aria-label="Open menu"
            onClick={handleKebab}
          >
            <TbDots aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="org-node-card__divider" aria-hidden="true" />

      <footer className="org-node-card__footer">
        <p className="org-node-card__meta">
          {childCount > 0 ? (
            <>
              <strong>{childCount}</strong>{" "}
              {childCount === 1 ? "child" : "children"}
            </>
          ) : (
            <span className="org-node-card__meta-empty">No children</span>
          )}
          {teamCount !== undefined && teamCount > 0 && (
            <>
              {" · "}
              <strong>{teamCount}</strong> {teamCount === 1 ? "team" : "teams"}
            </>
          )}
        </p>
        {hasChildren && (
          <button
            type="button"
            className="btn btn--icon btn--xs btn--ghost org-node-card__icon-btn nodrag"
            aria-label={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            onClick={handleChevron}
          >
            {collapsed ? (
              <TbChevronDown aria-hidden="true" />
            ) : (
              <TbChevronUp aria-hidden="true" />
            )}
          </button>
        )}
      </footer>
    </div>
  );
}

const NODE_TYPES = { orgNode: OrgNodeCard };

// ──────────────────────────────────────────────────────────────────────
// Layout — dagre TB
// ──────────────────────────────────────────────────────────────────────

function layoutWithDagre(
  tree: OrgNode[],
  collapsed: Set<string>,
  childrenOf: Map<string | null, OrgNode[]>,
  rankdir: RankDir,
  edgeKind: EdgeKind,
  selectedId: string | null,
): { nodes: Node<OrgNodeData>[]; edges: Edge[] } {
  if (tree.length === 0) return { nodes: [], edges: [] };

  // Walk visible-only graph: skip subtrees rooted at a collapsed node.
  const visibleIds = new Set<string>();
  const roots = childrenOf.get(null) ?? [];
  const walk = (n: OrgNode) => {
    visibleIds.add(n.id);
    if (collapsed.has(n.id)) return;
    for (const k of childrenOf.get(n.id) ?? []) walk(k);
  };
  for (const r of roots) walk(r);

  const g = new dagre.graphlib.Graph<{}>();
  g.setGraph({ rankdir, ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of visibleIds) {
    const isSel = id === selectedId;
    g.setNode(id, {
      width: isSel ? SELECTED_NODE_W : NODE_W,
      height: isSel ? SELECTED_NODE_H : NODE_H,
    });
  }

  const visibleEdges: Array<{ source: string; target: string }> = [];
  for (const id of visibleIds) {
    const kids = collapsed.has(id) ? [] : childrenOf.get(id) ?? [];
    for (const k of kids) {
      if (!visibleIds.has(k.id)) continue;
      g.setEdge(id, k.id);
      visibleEdges.push({ source: id, target: k.id });
    }
  }

  dagre.layout(g);

  const nodes: Node<OrgNodeData>[] = [];
  for (const id of visibleIds) {
    const pos = g.node(id);
    const org = tree.find((n) => n.id === id);
    if (!org || !pos) continue;
    const liveChildren = (childrenOf.get(id) ?? []).length;
    const isSel = id === selectedId;
    const w = isSel ? SELECTED_NODE_W : NODE_W;
    const h = isSel ? SELECTED_NODE_H : NODE_H;
    nodes.push({
      id,
      type: "orgNode",
      // dagre returns the centre; React Flow positions by top-left.
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
      // dagre owns layout — let users pan the canvas, not the nodes.
      // Drag-reparent will be reinstated via an explicit "Move…" menu
      // action so dropping has a clear target list and undo path.
      draggable: false,
      // Bake selection into the layout so the rfNodes-replacement effect
      // (collapse/expand/rankdir change) doesn't drop the selected ring
      // and resize the node back to its non-selected dimensions.
      selected: isSel,
      data: {
        org,
        childCount: liveChildren,
        archivedDescendantCount: org.archived_descendant_count ?? 0,
        collapsed: collapsed.has(id),
        hasChildren: liveChildren > 0,
        rankdir,
        // wired up by parent via setNodes
        onToggleCollapse: () => {},
        onOpenMenu: () => {},
        onOpenArchiveMap: () => {},
        onRename: () => false,
      },
    });
  }

  const edges: Edge[] = visibleEdges.map((e) => ({
    id: `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    type: edgeKind,
    style: { stroke: "#94a3b8", strokeWidth: 1.5 },
  }));

  return { nodes, edges };
}

// ──────────────────────────────────────────────────────────────────────
// Main page (wrapped in ReactFlowProvider so we can use refs/instance)
// ──────────────────────────────────────────────────────────────────────

export default function TopologyOverlayPage() {
  return (
    <ReactFlowProvider>
      <TopologyOverlayInner />
    </ReactFlowProvider>
  );
}

function TopologyOverlayInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuth();
  // Custom zoom controls render at the canvas's bottom-center as plain
  // floating buttons (see `.topo-overlay__zoom`); we replace React Flow's
  // built-in <Controls> because the tree flyout's left rail covered them.
  const rfInstance = useReactFlow();
  const onZoomIn = useCallback(() => rfInstance.zoomIn({ duration: 150 }), [rfInstance]);
  const onZoomOut = useCallback(() => rfInstance.zoomOut({ duration: 150 }), [rfInstance]);

  const focusId = search.get("focus");
  // ?expanded=1 — the embedded mount (workspace-settings → Topology tab)
  // reads this on first render so a deep-link can land directly in
  // expand-to-fill mode. The standalone /topology route already covers
  // the whole viewport, so the flag is a no-op there but harmless.
  const [expanded, setExpanded] = useState<boolean>(() => search.get("expanded") === "1");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (expanded) url.searchParams.set("expanded", "1");
    else url.searchParams.delete("expanded");
    window.history.replaceState(null, "", url.toString());
  }, [expanded]);

  // PLA-0006/00379 — workspace switcher.
  //
  // The selected workspace is canonicalised in the URL as `?ws=<slug>`.
  // We seed `wsRef` from the query string at mount-time so a deep-link
  // (`/topology?ws=<uuid>` or `/topology?ws=ops`) selects that workspace
  // WITHOUT a flicker on the tenant default first — the very first
  // /api/topology/tree request already carries the ref. The backend
  // accepts either a UUID (canonical, rename-stable) or a slug; new
  // links emitted by this page use UUID. When absent, we let the
  // backend's WorkspaceClampMiddleware fall back to the actor's first
  // live workspace, then display whichever workspace the workspaces
  // list returns first (Default by created_at ASC).
  //
  // Source-of-truth ordering for the picker is the workspaces fetch;
  // the tree fetch is downstream of `wsRef` so changing the picker
  // re-runs the tree query through the existing `reload()` callback.
  const [wsRef, setWsRef] = useState<string | null>(() => search.get("ws"));
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);

  const [tree, setTree] = useState<OrgNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Effective overlay width of the left tree flyout (0 when collapsed).
  // Used to offset the camera-centring target so the focused node lands
  // in the visible right-of-flyout half of the viewport.
  // Default to the collapsed-rail width (44px) so the canvas panel renders
  // correctly inset on the very first paint, before the flyout's
  // useLayoutEffect reports its measured width.
  const [treeFlyoutWidth, setTreeFlyoutWidth] = useState(44);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<
    | { nodeId: string; screenX: number; screenY: number }
    | null
  >(null);
  const [previewState, setPreviewState] = useState<{
    nodeId: string;
    newParentId: string;
    result: PreviewMoveResult | null;
  } | null>(null);
  // Inline name-input modal — replaces window.prompt because dev
  // browsers and embedded webviews routinely suppress prompt().
  const [nameModal, setNameModal] = useState<{
    title: string;
    placeholder: string;
    initial: string;
    onSubmit: (name: string) => void;
  } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    body: string;
    onConfirm: () => void;
    danger?: boolean;
  } | null>(null);

  const rfRef = useRef<ReactFlowInstance<Node<OrgNodeData>, Edge> | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await topologyApi.tree(undefined, wsRef ?? undefined);
      setTree(res);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load topology");
    }
  }, [wsRef]);

  useTopologyHandoffs(user?.id ?? null, () => {
    void reload();
  });

  useEffect(() => {
    void reload();
  }, [reload]);

  // PLA-0006/00379 — fetch the live workspaces list. Drives the
  // picker dropdown; the tree fetch is independent. If `?ws=<ref>`
  // is absent on first load we adopt the first workspace's UUID
  // after the list resolves so the URL matches what the backend's
  // clamp middleware already chose; UUID is canonical so a later
  // rename does not invalidate the deep-link. We only do this when
  // the ref is null so we never clobber a deep-link.
  //
  // We also subscribe to the `workspaces:changed` window event
  // (00381) so mutations from other panels (Manage Workspaces,
  // Archived Workspaces) cause the dropdown to refetch without a
  // page reload.
  const reloadWorkspaces = useCallback(async () => {
    try {
      const res = await workspacesApi.list();
      setWorkspaces(res);
      if (wsRef == null && res.length > 0) {
        const first = res[0]!;
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("ws", first.id);
          window.history.replaceState(null, "", url.toString());
        }
        setWsRef(first.id);
      }
    } catch {
      // Silently leave `workspaces` null — the dropdown hides itself
      // when the list isn't available; tree fetch failure is surfaced
      // via loadError on its own path.
    }
  }, [wsRef]);

  useEffect(() => {
    void reloadWorkspaces();
    if (typeof window === "undefined") return;
    const onChanged = () => {
      void reloadWorkspaces();
    };
    window.addEventListener(WORKSPACES_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(WORKSPACES_CHANGED_EVENT, onChanged);
    };
    // reloadWorkspaces depends on wsRef, but we only care about the
    // first-mount fetch + a stable subscription — re-running this
    // effect on every ref change would double-fire fetches and tear
    // the listener down/up unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit view once after first non-empty layout. Re-armed on
  // workspace switch (see onWorkspaceChange) so the new tree refits
  // its own centre rather than inheriting the previous workspace's
  // viewport.
  const didFitRef = useRef(false);

  // Selecting a workspace from the dropdown — update the URL via
  // router.replace (no full reload, no history entry) and let the
  // wsRef-bound `reload` re-run the tree fetch with the new ref.
  // The dropdown emits the workspace UUID so the URL stays
  // rename-stable.
  const onWorkspaceChange = useCallback(
    (nextRef: string) => {
      if (nextRef === wsRef) return;
      setWsRef(nextRef);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("ws", nextRef);
        // Use router.replace so the back button still returns to the
        // pre-/topology page rather than each workspace toggle.
        router.replace(url.pathname + url.search);
      }
      // Drop the selected node and any in-flight overlays — they
      // belong to the old workspace's tree.
      setSelectedId(null);
      setEditingId(null);
      setCollapsed(new Set());
      // Re-arm the fit-view latch so the next non-empty layout fits
      // the new workspace's tree from scratch.
      didFitRef.current = false;
    },
    [wsRef, router],
  );

  const root = useMemo(() => tree?.find((n) => n.parent_id === null) ?? null, [tree]);
  const tenantName = root?.name ?? "Topology";
  const editingNode = useMemo(
    () => (editingId ? tree?.find((n) => n.id === editingId) ?? null : null),
    [tree, editingId],
  );

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, OrgNode[]>();
    for (const n of tree ?? []) {
      if (n.archived_at !== null) continue;
      const k = n.parent_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(n);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [tree]);

  const hasChildrenLive = useCallback(
    (id: string) => (childrenOf.get(id) ?? []).length > 0,
    [childrenOf],
  );

  const archivedDescendantCountFor = useCallback(
    (id: string) => {
      const n = (tree ?? []).find((t) => t.id === id);
      return n?.archived_descendant_count ?? 0;
    },
    [tree],
  );

  const nodeNameFor = useCallback(
    (id: string) => (tree ?? []).find((t) => t.id === id)?.name ?? "",
    [tree],
  );

  // Map of every loaded live OrgNode keyed by id, used by ArchiveMapFlyout
  // to synthesise breadcrumb rows for live intermediates between archived
  // descendants and the anchor. Memoised so the flyout's row builder
  // doesn't rebuild on unrelated re-renders.
  const liveAncestorsMap = useMemo(() => {
    const m = new Map<string, { name: string; parentId: string | null }>();
    for (const n of tree ?? []) {
      if (n.archived_at) continue;
      m.set(n.id, { name: n.name, parentId: n.parent_id });
    }
    return m;
  }, [tree]);

  const onToggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Expand-all = clear the collapsed set (the tree is fully loaded).
  const onExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  // Collapse-all = mark every node that has children as collapsed.
  const onCollapseAll = useCallback(() => {
    const next = new Set<string>();
    for (const [parentId, kids] of childrenOf.entries()) {
      if (parentId !== null && kids.length > 0) next.add(parentId);
    }
    setCollapsed(next);
  }, [childrenOf]);

  const onOpenMenu = useCallback((id: string, screenX: number, screenY: number) => {
    setContextMenu({ nodeId: id, screenX, screenY });
  }, []);

  const [archiveMap, setArchiveMap] = useState<{ nodeId: string; nodeName: string } | null>(null);
  const onOpenArchiveMap = useCallback((id: string, name: string) => {
    setArchiveMap({ nodeId: id, nodeName: name });
  }, []);

  // Canvas-card inline rename. Mirrors the flyout row's onRename so the
  // single-source-of-truth is still topologyApi.patchFields + reload().
  const onRenameCanvas = useCallback(async (id: string, name: string) => {
    try {
      await topologyApi.patchFields(id, { name });
      await reload();
      return true;
    } catch {
      return false;
    }
  }, [reload]);

  // View-mode toolbar state. Defaults match the previous hard-coded values
  // so existing users see no change until they click a toggle.
  const [rankdir, setRankdir] = useState<RankDir>("TB");
  const [edgeKind, setEdgeKind] = useState<EdgeKind>("default");
  // Authoring mode. UI-only for now; copy/paste between sandbox and live
  // wires up in the next step.
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("sandbox");

  // Compute layout — reflows whenever tree, collapsed, rankdir, edge
  // style, or the selected node changes (the selected card is rendered
  // 40% larger and dagre needs the bigger box reserved).
  const layout = useMemo(
    () => layoutWithDagre(tree ?? [], collapsed, childrenOf, rankdir, edgeKind, selectedId),
    [tree, collapsed, childrenOf, rankdir, edgeKind, selectedId],
  );

  // Inject the live callbacks into each node's data so card buttons
  // can call us.
  const layoutNodes = useMemo<Node<OrgNodeData>[]>(
    () =>
      layout.nodes.map((n) => ({
        ...n,
        data: { ...n.data, onToggleCollapse, onOpenMenu, onOpenArchiveMap, onRename: onRenameCanvas },
      })),
    [layout.nodes, onToggleCollapse, onOpenMenu, onOpenArchiveMap, onRenameCanvas],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<OrgNodeData>>(layoutNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(layout.edges);

  // Re-sync with layout when tree/collapsed/selection change. `layoutNodes`
  // already bakes in the per-node `selected` flag (see layoutWithDagre), so
  // a single wholesale write is enough — we don't need a second effect to
  // toggle `selected`, which used to race the position write and could
  // leave nodes anchored to a stale (pre-resize) layout.
  useEffect(() => {
    setRfNodes(layoutNodes);
    setRfEdges(layout.edges);
  }, [layoutNodes, layout.edges, setRfNodes, setRfEdges]);

  // Fit view once after first non-empty layout. The `didFitRef` is
  // declared higher up next to onWorkspaceChange so the dropdown can
  // re-arm it on workspace switch.
  useEffect(() => {
    if (didFitRef.current) return;
    if (rfNodes.length === 0) return;
    const inst = rfRef.current;
    if (!inst) return;
    requestAnimationFrame(() => {
      inst.fitView({ padding: 0.2, duration: 0 });
    });
    didFitRef.current = true;
  }, [rfNodes.length]);

  // ── interactions ───────────────────────────────────────────────────

  const commitMove = useCallback(async () => {
    if (!previewState) return;
    await topologyApi.move(previewState.nodeId, previewState.newParentId);
    setPreviewState(null);
    void reload();
  }, [previewState, reload]);

  // Right-click on a node → open menu
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node<OrgNodeData>) => {
      e.preventDefault();
      setContextMenu({ nodeId: node.id, screenX: e.clientX, screenY: e.clientY });
    },
    [],
  );

  // Centre the camera on a node at 80% zoom. Two flavours:
  //   • Click-driven (default) — eases out to a wide overview, pans to
  //     the new node mid-flight, then eases back in to the target zoom.
  //     Reads as a deliberate "zoom out, travel, zoom in" — much easier
  //     to follow than a single tween that simultaneously translates
  //     and scales (which can feel like teleportation).
  //   • Resize-driven (`{ duration: 0 }`) — snap-cuts to the new viewport
  //     centre with no animation. Used by the ResizeObserver so the
  //     camera tracks chrome resizes 1:1 instead of tweening behind them.
  const ZOOM = 0.84;
  const ZOOM_OUT = 0.4;
  const FLY_MS = 720;
  // Canvas DOM ref — used both by centerOnNode (to read the viewport's
  // current pixel size when computing the current camera centre in flow
  // coords) and by the resize-observer effect below.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // Handle for the in-flight rAF fly animation so a second click (or
  // selection change) cancels the previous tween cleanly instead of
  // letting both run at once and snapping the camera around.
  const flyRafRef = useRef<number | null>(null);
  const cancelFly = useCallback(() => {
    if (flyRafRef.current != null) {
      cancelAnimationFrame(flyRafRef.current);
      flyRafRef.current = null;
    }
  }, []);
  const centerOnNode = useCallback(
    (
      nodeOrId:
        | string
        | { id?: string; position: { x: number; y: number } },
      opts?: { duration?: number },
    ) => {
      const inst = rfRef.current;
      if (!inst) return;
      // Resolve to a live layout node (post-reflow) so the centre is
      // computed against the actual rendered half-extents — the selected
      // node uses the bigger SELECTED_NODE_W/H box.
      let target:
        | { id?: string; position: { x: number; y: number }; w: number; h: number }
        | null = null;
      if (typeof nodeOrId === "string") {
        const n = layout.nodes.find((x) => x.id === nodeOrId);
        if (!n) return;
        const isSel = n.id === selectedId;
        target = {
          id: n.id,
          position: n.position,
          w: isSel ? SELECTED_NODE_W : NODE_W,
          h: isSel ? SELECTED_NODE_H : NODE_H,
        };
      } else {
        const isSel = nodeOrId.id === selectedId;
        target = {
          id: nodeOrId.id,
          position: nodeOrId.position,
          w: isSel ? SELECTED_NODE_W : NODE_W,
          h: isSel ? SELECTED_NODE_H : NODE_H,
        };
      }
      const cx = target.position.x + target.w / 2;
      const cy = target.position.y + target.h / 2;
      cancelFly();
      // Snap path — used by resize-driven recentre.
      if (opts?.duration === 0) {
        inst.setCenter(cx, cy, { zoom: ZOOM, duration: 0 });
        return;
      }
      // Continuous tween: pan and zoom evolve together so the camera
      // eases out of the current node, drifts toward the destination at
      // a wider zoom near the midpoint, then tightens back in. Pan uses
      // ease-in-out across the full duration; zoom follows a parabola
      // (start → ZOOM_OUT at midpoint → ZOOM) that overlaps the pan
      // instead of running before/after it.
      const start = inst.getViewport();
      const vpW = canvasRef.current?.getBoundingClientRect().width ?? 0;
      const vpH = canvasRef.current?.getBoundingClientRect().height ?? 0;
      const startCenterFlowX = (vpW / 2 - start.x) / start.zoom;
      const startCenterFlowY = (vpH / 2 - start.y) / start.zoom;
      const startZoom = start.zoom;
      const t0 = performance.now();
      const easeInOut = (t: number) =>
        t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const step = (now: number) => {
        const inst2 = rfRef.current;
        if (!inst2) {
          flyRafRef.current = null;
          return;
        }
        const t = Math.min(1, (now - t0) / FLY_MS);
        const e = easeInOut(t);
        const px = startCenterFlowX + (cx - startCenterFlowX) * e;
        const py = startCenterFlowY + (cy - startCenterFlowY) * e;
        // Parabolic zoom: dips to ZOOM_OUT at t=0.5, returns to ZOOM at t=1.
        // s(0)=startZoom, s(0.5)=ZOOM_OUT, s(1)=ZOOM.
        const a = 2 * (startZoom + ZOOM) - 4 * ZOOM_OUT;
        const b = -3 * startZoom - ZOOM + 4 * ZOOM_OUT;
        const c = startZoom;
        const z = a * t * t + b * t + c;
        inst2.setViewport(
          { x: vpW / 2 - px * z, y: vpH / 2 - py * z, zoom: z },
          { duration: 0 },
        );
        if (t < 1) {
          flyRafRef.current = requestAnimationFrame(step);
        } else {
          flyRafRef.current = null;
        }
      };
      flyRafRef.current = requestAnimationFrame(step);
    },
    [cancelFly, layout, selectedId],
  );

  // Cancel any in-flight fly animation when the component unmounts so
  // a late frame doesn't fire against a torn-down instance.
  useEffect(() => () => cancelFly(), [cancelFly]);

  // Recentre the camera on every canvas-viewport resize (AppShell sidebar
  // collapse/expand, tree flyout open/close, window resize, sub-nav
  // show/hide). Strategy: if the user has selected a node, lock the
  // camera onto that node so it stays under the cursor's mental model.
  // Otherwise re-fit the whole graph so all nodes remain visible and
  // centred in the new viewport size — no matter how the surrounding
  // chrome shrinks or grows, the diagram always renders in the middle
  // of whatever space remains.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let firstFire = true;
    const ro = new ResizeObserver(() => {
      // Skip the initial fire — that one happens on mount before fitView,
      // and we don't want it to fight the initial layout-fit animation.
      if (firstFire) {
        firstFire = false;
        return;
      }
      const inst = rfRef.current;
      if (!inst) return;
      if (selectedId) {
        // No animation on resize-driven recentre — the camera should
        // track the resize 1:1 instead of tweening behind it. Pass the
        // id so centerOnNode reads the post-reflow position with the
        // bigger selected-node half-extents.
        centerOnNode(selectedId, { duration: 0 });
        return;
      }
      // No selection — refit the whole graph so it stays visually
      // centred in the new viewport size.
      inst.fitView({ padding: 0.2, duration: 0 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedId, centerOnNode]);

  // Single click: paint the accent ring. The camera fly is driven by the
  // selectedId-change effect below so it runs AFTER the layout has
  // reflowed around the now-bigger selected node — using the pre-reflow
  // position would land the camera off-centre.
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node<OrgNodeData>) => {
      setSelectedId(node.id);
    },
    [],
  );

  // Fly the camera to the selected node whenever selection changes. Runs
  // after layout has reflowed (selectedId is in centerOnNode's deps via
  // `layout`), so we read the post-reflow position with the bigger
  // selected-node half-extents.
  useEffect(() => {
    if (!selectedId) return;
    centerOnNode(selectedId);
    // Intentionally only re-run when selection changes — not on every
    // layout shift (collapse/expand, rankdir change), which would
    // hijack the camera unexpectedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Close menu on outside click / ESC. We check the event target's
  // ancestry for `.topo-ctx-menu` so a click *on* a menu item does not
  // close the menu before the React onClick fires (the click handler
  // closes the menu itself, after running the action).
  useEffect(() => {
    if (!contextMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest(".topo-ctx-menu")) return;
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // ── menu actions ───────────────────────────────────────────────────

  const addChild = useCallback(
    (parentId: string) => {
      setNameModal({
        title: "Add child node",
        placeholder: "e.g. Engineering",
        initial: "",
        onSubmit: async (name) => {
          try {
            await topologyApi.create({ parent_id: parentId, name });
            // Expand parent so the new child is visible.
            setCollapsed((prev) => {
              const n = new Set(prev);
              n.delete(parentId);
              return n;
            });
            await reload();
          } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Failed to add node");
          }
        },
      });
    },
    [reload],
  );

  const duplicateNode = useCallback(
    async (nodeId: string) => {
      try {
        const created = await topologyApi.duplicate(nodeId);
        await reload();
        // If the Edit flyout is open, retarget it to the freshly-created
        // node so the user can keep editing without having to click the
        // new node first.
        setEditingId((prev) => (prev ? created.id : prev));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to duplicate node");
      }
    },
    [reload],
  );

  const archiveNode = useCallback(
    (nodeId: string) => {
      const node = (tree ?? []).find((n) => n.id === nodeId);
      if (!node) return;
      setConfirmModal({
        title: `Delete "${node.name}"?`,
        body: "Archived nodes move to limbo and stop being editable. They can be restored from there.",
        danger: true,
        onConfirm: async () => {
          try {
            await topologyApi.archive(nodeId);
            if (selectedId === nodeId) setSelectedId(null);
            if (editingId === nodeId) setEditingId(null);
            await reload();
          } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Archive failed");
          }
        },
      });
    },
    [tree, selectedId, editingId, reload],
  );

  // ── overlay finish ────────────────────────────────────────────────

  const finish = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  }, [router]);

  // ESC at the page level closes context menu first, then the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenu) return;
        if (editingId) {
          setEditingId(null);
          return;
        }
        if (selectedId) {
          setSelectedId(null);
          return;
        }
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu, editingId, selectedId, finish]);

  const empty = tree !== null && tree.length === 0;

  return (
    <div className={`topo-overlay${expanded ? " is-expanded" : ""}`}>
      {/* Top bar */}
      <header className="topo-overlay__bar">
        <div className="topo-overlay__title">
          <span className="topo-overlay__brand">Vector</span>
          <span className="topo-overlay__sep">/</span>
          <span>{tenantName}</span>
          <span className="topo-overlay__sep">/</span>
          <strong>Topology</strong>
        </div>
        <div className="topo-overlay__actions">
          {/* PLA-0006/00379 — workspace switcher. Renders only when the
              workspaces list has loaded AND the tenant has more than one
              live workspace; a single-workspace tenant would just show
              its own name with nothing to switch to. We use a native
              <select> with the catalog's form__select--sm so the control
              picks up the active theme without a bespoke class. */}
          {workspaces && workspaces.length > 1 && (
            <select
              className="form__select form__select--sm topo-overlay__ws-select"
              aria-label="Switch workspace"
              value={wsRef ?? ""}
              onChange={(e) => onWorkspaceChange(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <ToggleBtnN
            ariaLabel="Authoring mode"
            size="sm"
            value={canvasMode}
            onChange={setCanvasMode}
            className="topo-overlay__mode-toggle"
            options={[
              { value: "sandbox", label: "Sandbox", title: "Practice / plan changes without affecting the live topology" },
              { value: "live", label: "Live", title: "Edit the live topology that drives the rest of the app" },
            ]}
          />
          <ToggleBtnN
            ariaLabel="Layout direction"
            size="sm"
            value={rankdir}
            onChange={setRankdir}
            options={[
              { value: "TB", label: "TB", title: "Top-to-bottom layout" },
              { value: "LR", label: "LR", title: "Left-to-right layout" },
            ]}
          />
          <ToggleBtnN
            ariaLabel="Edge style"
            size="sm"
            value={edgeKind}
            onChange={setEdgeKind}
            options={[
              { value: "default", label: "Curved", title: "Curved (parabolic) connectors" },
              { value: "step", label: "Orthogonal", title: "Orthogonal (right-angle) connectors" },
              { value: "straight", label: "Straight", title: "Straight diagonal connectors" },
            ]}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm topo-overlay__btn"
            onClick={() => rfRef.current?.fitView({ padding: 0.2, duration: 200 })}
            title="Fit all nodes in view"
          >
            Reset view
          </button>
          <button
            type="button"
            className="btn btn--icon btn--sm btn--ghost topo-overlay__btn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse to embedded view" : "Expand to fill the screen"}
            aria-label={expanded ? "Collapse to embedded view" : "Expand to fill the screen"}
          >
            {expanded ? <BsFullscreenExit aria-hidden="true" /> : <BsArrowsFullscreen aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm topo-overlay__btn topo-overlay__btn--primary topo-overlay__finish"
            onClick={finish}
          >
            Finish
          </button>
        </div>
      </header>

      {/* Canvas area — wrapped in <Panel name="topology"> so the addressable
          substrate registers it as samantha._viewport.app._panel.topology
          (or nested under workspace_settings when embedded), exposes the
          help hexagon top-right via Panel chrome, and lets Samantha API
          target the canvas with one stable address in both modes. */}
      <main
        className="topo-overlay__main"
        style={{ "--topo-flyout-w": `${treeFlyoutWidth}px` } as React.CSSProperties}
      >
        <Panel name="topology" className="panel--bare topo-overlay__panel">
        {loadError && (
          <div className="topo-overlay__error">
            <p>{loadError}</p>
            <button type="button" className="btn btn--ghost btn--sm topo-overlay__btn" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        )}

        {!loadError && empty && <TopologyEmptyState onCreated={() => void reload()} />}

        {!loadError && !empty && tree && (
          <div ref={canvasRef} className="topo-overlay__canvas">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onNodeContextMenu={onNodeContextMenu}
              onInit={(inst) => {
                rfRef.current = inst;
              }}
              proOptions={{ hideAttribution: true }}
              minZoom={0.2}
              maxZoom={1.5}
              snapToGrid
              snapGrid={[10, 10]}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              nodesConnectable={false}
              edgesFocusable={false}
              // React Flow's default double-click handler zooms the
              // canvas centred on the click point. That reads as the
              // clicked node "jumping up" by some pixels. We use
              // double-click on the card name for inline rename, so
              // disable RF's behaviour outright.
              zoomOnDoubleClick={false}
            >
              <Background gap={20} size={1} color="#e5e7eb" />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeStrokeColor={(n) => {
                  const data = n.data as OrgNodeData;
                  return data?.org?.colour || paletteColour(data?.org?.id ?? n.id);
                }}
                nodeColor={(n) => {
                  const data = n.data as OrgNodeData;
                  return data?.org?.colour || paletteColour(data?.org?.id ?? n.id);
                }}
              />
            </ReactFlow>
            {/* Canvas zoom controls — pinned to the bottom-center of the
                canvas viewport. Sit OUTSIDE <ReactFlow> so they never
                pan/zoom with the graph, and INSIDE the canvas wrapper
                so they're always positioned against the visible area. */}
            <div className="topo-overlay__zoom" role="group" aria-label="Zoom canvas">
              <button
                type="button"
                className="btn btn--icon btn--ghost btn--sm topo-overlay__zoom-btn"
                onClick={onZoomIn}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.5" y2="16.5" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <button
                type="button"
                className="btn btn--icon btn--ghost btn--sm topo-overlay__zoom-btn"
                onClick={onZoomOut}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16.5" y2="16.5" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
            </div>
          </div>
        )}
        </Panel>

        {/* Tree flyout — top-right rail, peek-on-hover, click-to-pin.
            Lives inside __main so it anchors to the canvas viewport,
            never over the topology toolbar or AppShell header. */}
        <TopologyTreeFlyout
          tree={tree}
          childrenOf={childrenOf}
          collapsed={collapsed}
          selectedId={selectedId}
          onToggleCollapse={onToggleCollapse}
          onExpandAll={onExpandAll}
          onCollapseAll={onCollapseAll}
          onOpenMenu={onOpenMenu}
          onOpenArchiveMap={onOpenArchiveMap}
          onWidthChange={setTreeFlyoutWidth}
          onSelect={(id) => setSelectedId(id)}
          onActivate={(id) => setSelectedId(id)}
          onRename={async (id, name) => {
            try {
              await topologyApi.patchFields(id, { name });
              await reload();
              return true;
            } catch {
              return false;
            }
          }}
        />

        {/* Edit flyout — lives inside __main so it anchors below the topology
            toolbar, never overlapping the AppShell header or the toolbar row. */}
        {editingNode && (
          <EditFlyout
            node={editingNode}
            onClose={() => setEditingId(null)}
            onChange={() => void reload()}
          />
        )}

        {/* Archive-map flyout — right rail, ~50% viewport, dotted-line tree
            of archived descendants reachable via live ancestors. */}
        {archiveMap && (
          <ArchiveMapFlyout
            nodeId={archiveMap.nodeId}
            nodeName={archiveMap.nodeName}
            archivedCount={archivedDescendantCountFor(archiveMap.nodeId)}
            liveAncestors={liveAncestorsMap}
            onClose={() => setArchiveMap(null)}
            onChange={() => void reload()}
          />
        )}
      </main>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.screenX}
          y={contextMenu.screenY}
          hasChildren={hasChildrenLive(contextMenu.nodeId)}
          archivedDescendantCount={archivedDescendantCountFor(contextMenu.nodeId)}
          onAddChild={() => {
            const id = contextMenu.nodeId;
            setContextMenu(null);
            void addChild(id);
          }}
          onEdit={() => {
            setEditingId(contextMenu.nodeId);
            setContextMenu(null);
          }}
          onDuplicate={() => {
            const id = contextMenu.nodeId;
            setContextMenu(null);
            void duplicateNode(id);
          }}
          onViewArchived={() => {
            const id = contextMenu.nodeId;
            const name = nodeNameFor(id);
            setContextMenu(null);
            onOpenArchiveMap(id, name);
          }}
          onDelete={() => {
            const id = contextMenu.nodeId;
            setContextMenu(null);
            void archiveNode(id);
          }}
        />
      )}

      {/* Move-preview modal */}
      {previewState && (
        <PreviewMoveModal
          state={previewState}
          tree={tree ?? []}
          onConfirm={commitMove}
          onCancel={() => setPreviewState(null)}
        />
      )}

      {/* Inline name-input modal (replaces window.prompt) */}
      {nameModal && (
        <NameInputModal
          title={nameModal.title}
          placeholder={nameModal.placeholder}
          initial={nameModal.initial}
          onCancel={() => setNameModal(null)}
          onSubmit={(name) => {
            const fn = nameModal.onSubmit;
            setNameModal(null);
            fn(name);
          }}
        />
      )}

      {/* Inline confirm modal (replaces window.confirm) */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          body={confirmModal.body}
          danger={confirmModal.danger}
          onCancel={() => setConfirmModal(null)}
          onConfirm={() => {
            const fn = confirmModal.onConfirm;
            setConfirmModal(null);
            fn();
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────────

function TopologyEmptyState({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await topologyApi.create({ name: name.trim() });
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create node");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="topo-overlay__empty">
      <div className="topo-overlay__empty-card">
        <h2>Welcome to Topology</h2>
        <p>Add your first office or department to start building your org chart.</p>
        <div className="topo-overlay__empty-row">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Head office"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn--primary btn--sm topo-overlay__btn topo-overlay__btn--primary"
            onClick={() => void submit()}
            disabled={!name.trim() || busy}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
        {error && <p className="topo-overlay__err-text">{error}</p>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Context menu
// ──────────────────────────────────────────────────────────────────────

function ContextMenu({
  x,
  y,
  hasChildren,
  archivedDescendantCount,
  onAddChild,
  onEdit,
  onDuplicate,
  onViewArchived,
  onDelete,
}: {
  x: number;
  y: number;
  hasChildren: boolean;
  archivedDescendantCount: number;
  onAddChild: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onViewArchived: () => void;
  onDelete: () => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      className="topo-ctx-menu"
      style={{ left: x, top: y }}
      onMouseDown={stop}
      role="menu"
    >
      <button type="button" role="menuitem" onClick={onAddChild}>
        <span className="topo-ctx-menu__icon">+</span>
        Add {hasChildren ? "department" : "child"}
      </button>
      <button type="button" role="menuitem" onClick={onEdit}>
        <span className="topo-ctx-menu__icon">✎</span>
        Edit
      </button>
      <button type="button" role="menuitem" onClick={onDuplicate}>
        <span className="topo-ctx-menu__icon">⧉</span>
        Duplicate
      </button>
      {archivedDescendantCount > 0 && (
        <button type="button" role="menuitem" onClick={onViewArchived}>
          <span className="topo-ctx-menu__icon">⚠</span>
          View archived ({archivedDescendantCount})
        </button>
      )}
      <hr />
      <button
        type="button"
        role="menuitem"
        className="topo-ctx-menu__danger"
        onClick={onDelete}
      >
        <span className="topo-ctx-menu__icon">×</span>
        Delete
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit flyout — right side
// ──────────────────────────────────────────────────────────────────────

function EditFlyout({
  node,
  onClose,
  onChange,
}: {
  node: OrgNode;
  onClose: () => void;
  onChange: () => void;
}) {
  const [draftName, setDraftName] = useState(node.name);
  const [draftDescription, setDraftDescription] = useState(node.description ?? "");
  const [draftLabel, setDraftLabel] = useState(node.label_override ?? "");
  const [draftColour, setDraftColour] = useState(node.colour ?? "");
  const [error, setError] = useState<string | null>(null);

  // Resync drafts ONLY when switching to a different node. Resyncing on
  // every node-field change clobbered the user's in-flight typing whenever
  // a save round-tripped through the tree reload — that produced the
  // dropped-character bug ("Back Office" → "Bak Ofice").
  useEffect(() => {
    setDraftName(node.name);
    setDraftDescription(node.description ?? "");
    setDraftLabel(node.label_override ?? "");
    setDraftColour(node.colour ?? "");
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchOne = async (
    field: "name" | "description" | "label_override" | "colour",
    value: string,
  ) => {
    setError(null);
    try {
      await topologyApi.patchFields(node.id, { [field]: value });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Update of ${field} failed`);
    }
  };

  // Save on blur / Enter, not on every keystroke. Typing stays purely local.
  const commitName = () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setDraftName(node.name); // can't clear name; revert
      return;
    }
    if (trimmed === node.name) return;
    void patchOne("name", trimmed);
  };

  const commitDescription = () => {
    if (draftDescription === (node.description ?? "")) return;
    void patchOne("description", draftDescription);
  };

  const commitLabel = () => {
    if (draftLabel === (node.label_override ?? "")) return;
    void patchOne("label_override", draftLabel);
  };

  // Colour comes from a swatch click, not free text — commit immediately.
  const onColourChange = (v: string) => {
    setDraftColour(v);
    void patchOne("colour", v);
  };

  return (
    <aside className="topo-flyout" role="dialog" aria-label={`Edit ${node.name}`}>
      <header className="topo-flyout__head">
        <h2>Edit node</h2>
        <button
          type="button"
          className="btn btn--icon btn--ghost btn--sm topo-flyout__close"
          aria-label="Close panel"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {/* Wrapping the body in <Panel> registers this flyout as an
          addressable in its own right ("edit_node") so its help hexagon
          is scoped to THIS panel — stops the underlying topology panel's
          hexagon bleeding through the z-index. */}
      <Panel name="edit_node" className="panel--bare topo-flyout__panel">
      <div className="topo-flyout__body">
        <label className="topo-flyout__field">
          <span>Name</span>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
        </label>

        <label className="topo-flyout__field">
          <span>Label</span>
          <input
            type="text"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="e.g. Department, Office, Team"
          />
        </label>

        <label className="topo-flyout__field">
          <span>Description</span>
          <textarea
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            onBlur={commitDescription}
            rows={4}
            placeholder="What this node owns, who it serves."
          />
        </label>

        <div className="topo-flyout__field">
          <span>Colour</span>
          <div className="topo-flyout__swatches">
            {COLOUR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`topo-flyout__swatch${draftColour === c ? " is-active" : ""}`}
                style={{ background: c }}
                onClick={() => onColourChange(c)}
                aria-label={`Use colour ${c}`}
              />
            ))}
            <button
              type="button"
              className={`topo-flyout__swatch topo-flyout__swatch--clear${draftColour === "" ? " is-active" : ""}`}
              onClick={() => onColourChange("")}
              aria-label="Clear colour"
              title="Auto colour"
            >
              ⊘
            </button>
          </div>
        </div>

        {error && <p className="topo-overlay__err-text">{error}</p>}
      </div>
      </Panel>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Preview-move modal
// ──────────────────────────────────────────────────────────────────────

function PreviewMoveModal({
  state,
  tree,
  onConfirm,
  onCancel,
}: {
  state: { nodeId: string; newParentId: string; result: PreviewMoveResult | null };
  tree: OrgNode[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const node = tree.find((n) => n.id === state.nodeId);
  const newParent = tree.find((n) => n.id === state.newParentId);
  const result = state.result;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const cycle = result && !result.ok && result.reason === "cycle";

  return (
    <div className="topo-modal-backdrop" onClick={onCancel}>
      <div className="topo-modal" onClick={(e) => e.stopPropagation()}>
        <header className="topo-modal__head">
          <h2>Move {node?.name ?? "node"}</h2>
          <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Close" onClick={onCancel}>×</button>
        </header>
        <div className="topo-modal__body">
          {cycle ? (
            <p className="topo-overlay__err-text">
              This move would create a cycle — you cannot place a node inside its own descendant.
            </p>
          ) : (
            <>
              <p>
                Move <strong>{node?.name}</strong> under <strong>{newParent?.name ?? "(unknown)"}</strong>?
              </p>
              {result?.moving && result.moving.length > 1 && (
                <p>
                  {result.moving.length - 1} descendant
                  {result.moving.length - 1 === 1 ? "" : "s"} will move with it.
                </p>
              )}
            </>
          )}
        </div>
        <footer className="topo-modal__foot">
          <button type="button" className="btn btn--ghost btn--sm topo-overlay__btn" onClick={onCancel}>
            Cancel
          </button>
          {!cycle && (
            <button
              type="button"
              className="btn btn--primary btn--sm topo-overlay__btn topo-overlay__btn--primary"
              onClick={onConfirm}
            >
              Commit move
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function NameInputModal({
  title,
  placeholder,
  initial,
  onCancel,
  onSubmit,
}: {
  title: string;
  placeholder: string;
  initial: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="topo-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div className="topo-modal" onClick={(e) => e.stopPropagation()}>
        <header className="topo-modal__head">
          <h2>{title}</h2>
        </header>
        <div className="topo-modal__body">
          <input
            ref={inputRef}
            type="text"
            className="topo-overlay__input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        <footer className="topo-modal__foot">
          <button type="button" className="btn btn--ghost btn--sm topo-overlay__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm topo-overlay__btn topo-overlay__btn--primary"
            onClick={submit}
            disabled={!value.trim()}
          >
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="topo-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div className="topo-modal" onClick={(e) => e.stopPropagation()}>
        <header className="topo-modal__head">
          <h2>{title}</h2>
        </header>
        <div className="topo-modal__body">
          <p>{body}</p>
        </div>
        <footer className="topo-modal__foot">
          <button type="button" className="btn btn--ghost btn--sm topo-overlay__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={
              danger
                ? "btn btn--danger btn--sm topo-overlay__btn topo-overlay__btn--danger"
                : "btn btn--primary btn--sm topo-overlay__btn topo-overlay__btn--primary"
            }
            onClick={onConfirm}
          >
            Confirm
          </button>
        </footer>
      </div>
    </div>
  );
}
