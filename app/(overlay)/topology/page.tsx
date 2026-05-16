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
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { topologyApi, type PreviewMoveResult } from "@/app/lib/topologyApi";
import { useAuth } from "@/app/contexts/AuthContext";
import { useTopologyHandoffs } from "@/app/hooks/useTopologyHandoffs";
import Panel from "@/app/components/Panel";
import TopologyTreeFlyout from "@/app/components/TopologyTreeFlyout";
import ArchiveMapFlyout from "@/app/components/ArchiveMapFlyout";
import {
  type RankDir,
  type EdgeKind,
  type CanvasMode,
  type OrgNodeData,
} from "@/app/components/topology/types";
import { OrgNodeCard } from "@/app/components/topology/OrgNodeCard";
import { ContextMenu } from "@/app/components/topology/ContextMenu";
import { EditFlyout } from "@/app/components/topology/EditFlyout";
import { PreviewMoveModal } from "@/app/components/topology/PreviewMoveModal";
import { NameInputModal } from "@/app/components/topology/NameInputModal";
import { ConfirmModal } from "@/app/components/topology/ConfirmModal";
import { TopologyEmptyState } from "@/app/components/topology/TopologyEmptyState";
import { TopologyToolbar } from "@/app/components/topology/TopologyToolbar";
import { TopologyCanvas } from "@/app/components/topology/TopologyCanvas";
import { layoutWithDagre } from "@/app/components/topology/layoutWithDagre";
import { useTopologyData } from "@/app/components/topology/useTopologyData";
import { useTopologyCamera } from "@/app/components/topology/useTopologyCamera";
import { useTopologyHandlers } from "@/app/components/topology/useTopologyHandlers";
import { useTopologyTreeState } from "@/app/components/topology/useTopologyTreeState";
import { useGlobalKey } from "@/app/components/topology/useGlobalKey";

const NODE_TYPES = { orgNode: OrgNodeCard };

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
  const { user, switchWorkspace } = useAuth();
  // Custom zoom controls render at the canvas's bottom-center; we
  // replace React Flow's built-in <Controls> because the tree flyout's
  // left rail covered them.
  const rfInstance = useReactFlow();
  const onZoomIn = useCallback(() => rfInstance.zoomIn({ duration: 150 }), [rfInstance]);
  const onZoomOut = useCallback(() => rfInstance.zoomOut({ duration: 150 }), [rfInstance]);

  const focusId = search.get("focus");
  // ?expanded=1 — embedded mount (workspace-settings → Topology tab)
  // reads this on first render so a deep-link can land directly in
  // expand-to-fill mode.
  const [expanded, setExpanded] = useState<boolean>(() => search.get("expanded") === "1");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (expanded) url.searchParams.set("expanded", "1");
    else url.searchParams.delete("expanded");
    window.history.replaceState(null, "", url.toString());
  }, [expanded]);

  const { wsRef, workspaces, tree, loadError, setLoadError, reload } =
    useTopologyData();

  const {
    collapsed,
    setCollapsed,
    tenantName,
    childrenOf,
    hasChildrenLive,
    archivedDescendantCountFor,
    nodeNameFor,
    liveAncestorsMap,
    onToggleCollapse,
    onExpandAll,
    onCollapseAll,
  } = useTopologyTreeState(tree);

  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Effective overlay width of the left tree flyout (0 when collapsed).
  // Default to the collapsed-rail width (44px) so the canvas panel renders
  // correctly inset on the first paint.
  const [treeFlyoutWidth, setTreeFlyoutWidth] = useState(44);
  const mainRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.style.setProperty("--topo-flyout-w", `${treeFlyoutWidth}px`);
  }, [treeFlyoutWidth]);
  const [contextMenu, setContextMenu] = useState<
    | { nodeId: string; screenX: number; screenY: number }
    | null
  >(null);
  const [previewState, setPreviewState] = useState<{
    nodeId: string;
    newParentId: string;
    result: PreviewMoveResult | null;
  } | null>(null);
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

  useTopologyHandoffs(user?.id ?? null, () => {
    void reload();
  });

  // Fit view once after first non-empty layout. Re-armed on workspace
  // switch so the new tree refits its own centre.
  const didFitRef = useRef(false);

  // Workspace dropdown change — PLA-0053 / story 00576.5. Re-mint
  // the JWT via AuthContext.switchWorkspace; AuthContext updates the
  // user payload in-place, useActiveWorkspace re-renders, the
  // topology tree refetches via useTopologyData's reload-on-workspaceId
  // effect. URL state is gone — JWT is the truth.
  //
  // Clears workspace-scoped UI state (selection, expand/collapse,
  // fit-view latch) so the new workspace's canvas starts clean.
  const onWorkspaceChange = useCallback(
    async (nextRef: string) => {
      if (nextRef === wsRef) return;
      try {
        await switchWorkspace(nextRef);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to switch workspace");
        return;
      }
      setSelectedId(null);
      setEditingId(null);
      setCollapsed(new Set());
      didFitRef.current = false;
    },
    [wsRef, switchWorkspace, setCollapsed, setLoadError],
  );

  const editingNode = useMemo(
    () => (editingId ? tree?.find((n) => n.id === editingId) ?? null : null),
    [tree, editingId],
  );

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

  // Camera fly logic (canvasRef, parabolic-zoom tween, cancel-on-unmount)
  // is owned by useTopologyCamera so the page body stays focused on
  // state + JSX. Click-driven flies use the parabolic tween; the
  // ResizeObserver effect below passes { duration: 0 } for snap-cuts.
  const { canvasRef, centerOnNode } = useTopologyCamera(rfRef, layout, selectedId);

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

  // Close menu on outside click. ESC handling now lives inside ContextMenu
  // itself via useGlobalKey (PLA-0006/00335). We keep mousedown here because
  // it's the page that knows whether the click landed inside the menu DOM
  // (.topo-ctx-menu) — the menu can't tell what's outside it.
  useEffect(() => {
    if (!contextMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest(".topo-ctx-menu")) return;
      setContextMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [contextMenu]);

  // ── menu actions ───────────────────────────────────────────────────

  const { addChild, duplicateNode, archiveNode } = useTopologyHandlers({
    tree,
    selectedId,
    editingId,
    reload,
    setLoadError,
    setSelectedId,
    setEditingId,
    setCollapsed,
    setNameModal,
    setConfirmModal,
  });

  // ── overlay finish ────────────────────────────────────────────────

  const finish = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  }, [router]);

  // ESC at the page level falls through after ContextMenu / EditFlyout
  // have had their turn (each owns its own useGlobalKey). The cascade is:
  //   menu open  → its onClose fires (ContextMenu); page ESC is a no-op
  //   editing    → close flyout
  //   selected   → drop selection
  //   otherwise  → finish overlay
  useGlobalKey("Escape", useCallback(() => {
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
  }, [contextMenu, editingId, selectedId, finish]));

  const empty = tree !== null && tree.length === 0;

  return (
    <div className={`topo-overlay${expanded ? " is-expanded" : ""}`}>
      <TopologyToolbar
        tenantName={tenantName}
        workspaces={workspaces}
        wsRef={wsRef}
        onWorkspaceChange={onWorkspaceChange}
        canvasMode={canvasMode}
        onCanvasModeChange={setCanvasMode}
        rankdir={rankdir}
        onRankdirChange={setRankdir}
        edgeKind={edgeKind}
        onEdgeKindChange={setEdgeKind}
        onResetView={() => rfRef.current?.fitView({ padding: 0.2, duration: 200 })}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        onFinish={finish}
      />

      {/* Canvas area — wrapped in <Panel name="topology"> so the addressable
          substrate registers it as samantha._viewport.app._panel.topology
          (or nested under workspace_settings when embedded), exposes the
          help hexagon top-right via Panel chrome, and lets Samantha API
          target the canvas with one stable address in both modes. */}
      <main ref={mainRef} className="topo-overlay__main">
        <Panel name="topology" className="panel--bare topo-overlay__panel">
        {loadError && (
          <div className="topo-overlay__error">
            <p>{loadError}</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        )}

        {!loadError && empty && <TopologyEmptyState onCreated={() => void reload()} />}

        {!loadError && !empty && tree && (
          <TopologyCanvas
            ref={canvasRef}
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
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
          />
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
          onClose={() => setContextMenu(null)}
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

