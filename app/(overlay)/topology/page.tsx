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
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
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
import { useAuth } from "@/app/contexts/AuthContext";
import { useTopologyHandoffs } from "@/app/hooks/useTopologyHandoffs";

// ── geometry ────────────────────────────────────────────────────────
const NODE_W = 240;
const NODE_H = 96;
const RANK_SEP = 70; // vertical gap between rows
const NODE_SEP = 32; // horizontal gap between siblings

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
  collapsed: boolean;
  hasChildren: boolean;
  onToggleCollapse: (id: string) => void;
  onOpenMenu: (id: string, screenX: number, screenY: number) => void;
};

// ──────────────────────────────────────────────────────────────────────
// Custom node — DOM-rendered card
// ──────────────────────────────────────────────────────────────────────

function OrgNodeCard({ id, data, selected }: NodeProps<Node<OrgNodeData>>) {
  const { org, childCount, collapsed, hasChildren, onToggleCollapse, onOpenMenu } = data;
  const archived = org.archived_at != null;
  const colour = org.colour || paletteColour(org.id);
  const sub = org.label_override || (org.parent_id === null ? "Root" : "Department");

  const handleKebab = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenMenu(id, e.clientX, e.clientY);
  };
  const handleChevron = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse(id);
  };

  return (
    <div
      className={`org-node-card${selected ? " is-selected" : ""}${archived ? " is-archived" : ""}`}
      style={{ width: NODE_W, height: NODE_H }}
    >
      {/* Hidden handles so React Flow can draw orthogonal edges TB */}
      <Handle type="target" position={Position.Top} className="org-node-card__handle" />
      <Handle type="source" position={Position.Bottom} className="org-node-card__handle" />

      {/* drag handle dots (left side) */}
      <div className="org-node-card__drag" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>

      <div className="org-node-card__main">
        <h3 className="org-node-card__name" title={org.name}>
          {org.name}
        </h3>
        <p className="org-node-card__sub">{sub}</p>
        {childCount > 0 && (
          <span className="org-node-card__pill">
            {childCount} {childCount === 1 ? "child" : "children"}
          </span>
        )}
      </div>

      <button
        type="button"
        className="org-node-card__kebab nodrag"
        aria-label="Open menu"
        onClick={handleKebab}
      >
        <span />
        <span />
        <span />
      </button>

      {hasChildren && (
        <button
          type="button"
          className="org-node-card__chevron nodrag"
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={handleChevron}
        >
          {collapsed ? "▶" : "▼"}
        </button>
      )}

      <div className="org-node-card__band" style={{ background: colour }} />
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
  g.setGraph({ rankdir: "TB", ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of visibleIds) g.setNode(id, { width: NODE_W, height: NODE_H });

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
    nodes.push({
      id,
      type: "orgNode",
      // dagre returns the centre; React Flow positions by top-left.
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      // dagre owns layout — let users pan the canvas, not the nodes.
      // Drag-reparent will be reinstated via an explicit "Move…" menu
      // action so dropping has a clear target list and undo path.
      draggable: false,
      data: {
        org,
        childCount: liveChildren,
        collapsed: collapsed.has(id),
        hasChildren: liveChildren > 0,
        // wired up by parent via setNodes
        onToggleCollapse: () => {},
        onOpenMenu: () => {},
      },
    });
  }

  const edges: Edge[] = visibleEdges.map((e) => ({
    id: `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    type: "smoothstep",
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

  const focusId = search.get("focus");

  const [tree, setTree] = useState<OrgNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
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
      const res = await topologyApi.tree();
      setTree(res);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load topology");
    }
  }, []);

  useTopologyHandoffs(user?.id ?? null, () => {
    void reload();
  });

  useEffect(() => {
    void reload();
  }, [reload]);

  const root = useMemo(() => tree?.find((n) => n.parent_id === null) ?? null, [tree]);
  const tenantName = root?.name ?? "Topology";
  const selectedNode = useMemo(
    () => (selectedId ? tree?.find((n) => n.id === selectedId) ?? null : null),
    [tree, selectedId],
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

  const onToggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onOpenMenu = useCallback((id: string, screenX: number, screenY: number) => {
    setContextMenu({ nodeId: id, screenX, screenY });
  }, []);

  // Compute layout — reflows whenever tree or collapsed changes.
  const layout = useMemo(
    () => layoutWithDagre(tree ?? [], collapsed, childrenOf),
    [tree, collapsed, childrenOf],
  );

  // Inject the live callbacks into each node's data so card buttons
  // can call us.
  const layoutNodes = useMemo<Node<OrgNodeData>[]>(
    () =>
      layout.nodes.map((n) => ({
        ...n,
        data: { ...n.data, onToggleCollapse, onOpenMenu },
      })),
    [layout.nodes, onToggleCollapse, onOpenMenu],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<OrgNodeData>>(layoutNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(layout.edges);

  // Re-sync with layout when tree/collapsed change.
  useEffect(() => {
    setRfNodes(layoutNodes);
    setRfEdges(layout.edges);
  }, [layoutNodes, layout.edges, setRfNodes, setRfEdges]);

  // Fit view once after first non-empty layout.
  const didFitRef = useRef(false);
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

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node<OrgNodeData>) => {
    setSelectedId(node.id);
  }, []);

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
      const src = (tree ?? []).find((n) => n.id === nodeId);
      if (!src) return;
      try {
        await topologyApi.create({
          parent_id: src.parent_id,
          name: `${src.name} (copy)`,
          description: src.description || undefined,
          label_override: src.label_override || undefined,
          colour: src.colour || undefined,
        });
        await reload();
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to duplicate node");
      }
    },
    [tree, reload],
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
            await reload();
          } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Archive failed");
          }
        },
      });
    },
    [tree, selectedId, reload],
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
        if (selectedId) {
          setSelectedId(null);
          return;
        }
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu, selectedId, finish]);

  const empty = tree !== null && tree.length === 0;

  return (
    <div className="topo-overlay">
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
          <button
            type="button"
            className="topo-overlay__btn"
            onClick={() => rfRef.current?.fitView({ padding: 0.2, duration: 200 })}
            title="Fit all nodes in view"
          >
            Reset view
          </button>
          <button
            type="button"
            className="topo-overlay__btn topo-overlay__btn--primary topo-overlay__finish"
            onClick={finish}
          >
            Finish
          </button>
        </div>
      </header>

      {/* Canvas area */}
      <main className="topo-overlay__main">
        {loadError && (
          <div className="topo-overlay__error">
            <p>{loadError}</p>
            <button type="button" className="topo-overlay__btn" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        )}

        {!loadError && empty && <TopologyEmptyState onCreated={() => void reload()} />}

        {!loadError && !empty && tree && (
          <div className="topo-overlay__canvas">
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
            >
              <Background gap={20} size={1} color="#e5e7eb" />
              <Controls position="bottom-left" showInteractive={false} />
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
          </div>
        )}
      </main>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.screenX}
          y={contextMenu.screenY}
          hasChildren={hasChildrenLive(contextMenu.nodeId)}
          onAddChild={() => {
            const id = contextMenu.nodeId;
            setContextMenu(null);
            void addChild(id);
          }}
          onEdit={() => {
            setSelectedId(contextMenu.nodeId);
            setContextMenu(null);
          }}
          onDuplicate={() => {
            const id = contextMenu.nodeId;
            setContextMenu(null);
            void duplicateNode(id);
          }}
          onDelete={() => {
            const id = contextMenu.nodeId;
            setContextMenu(null);
            void archiveNode(id);
          }}
        />
      )}

      {/* Edit flyout */}
      {selectedNode && (
        <EditFlyout
          node={selectedNode}
          onClose={() => setSelectedId(null)}
          onChange={() => void reload()}
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
            className="topo-overlay__btn topo-overlay__btn--primary"
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
  onAddChild,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  x: number;
  y: number;
  hasChildren: boolean;
  onAddChild: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
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

  useEffect(() => {
    setDraftName(node.name);
    setDraftDescription(node.description ?? "");
    setDraftLabel(node.label_override ?? "");
    setDraftColour(node.colour ?? "");
  }, [node.id, node.name, node.description, node.label_override, node.colour]);

  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (nameTimer.current) clearTimeout(nameTimer.current);
      if (descTimer.current) clearTimeout(descTimer.current);
      if (labelTimer.current) clearTimeout(labelTimer.current);
    };
  }, [node.id]);

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

  const onNameChange = (v: string) => {
    setDraftName(v);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      const trimmed = v.trim();
      if (!trimmed || trimmed === node.name) return;
      void patchOne("name", trimmed);
    }, 250);
  };

  const onDescriptionChange = (v: string) => {
    setDraftDescription(v);
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => {
      if (v === (node.description ?? "")) return;
      void patchOne("description", v);
    }, 250);
  };

  const onLabelChange = (v: string) => {
    setDraftLabel(v);
    if (labelTimer.current) clearTimeout(labelTimer.current);
    labelTimer.current = setTimeout(() => {
      if (v === (node.label_override ?? "")) return;
      void patchOne("label_override", v);
    }, 250);
  };

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
          className="topo-flyout__close"
          aria-label="Close panel"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="topo-flyout__body">
        <label className="topo-flyout__field">
          <span>Name</span>
          <input
            type="text"
            value={draftName}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>

        <label className="topo-flyout__field">
          <span>Label</span>
          <input
            type="text"
            value={draftLabel}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="e.g. Department, Office, Team"
          />
        </label>

        <label className="topo-flyout__field">
          <span>Description</span>
          <textarea
            value={draftDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
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
          <button type="button" aria-label="Close" onClick={onCancel}>×</button>
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
          <button type="button" className="topo-overlay__btn" onClick={onCancel}>
            Cancel
          </button>
          {!cycle && (
            <button
              type="button"
              className="topo-overlay__btn topo-overlay__btn--primary"
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
          <button type="button" className="topo-overlay__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="topo-overlay__btn topo-overlay__btn--primary"
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
          <button type="button" className="topo-overlay__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={
              danger
                ? "topo-overlay__btn topo-overlay__btn--danger"
                : "topo-overlay__btn topo-overlay__btn--primary"
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
