"use client";

// <ArtefactTree> — horizontal L→R portfolio walk.
//
// Fetches every artefact in the active workspace+meg scope (one call to
// /{resource}?page_size=500) and renders the parent_id graph as a shallow
// tree from L0 (roots) on the left to deepest leaves on the right.
//
// Layout (SVG, fixed-width per level):
//   - Each level (depth from root) gets an invisible vertical "zone" —
//     a column of LEVEL_WIDTH px. Nodes inside a zone are stacked
//     evenly within the available canvas height.
//   - Heights are computed per-level independently, so the same Y
//     coordinate can be reused across levels (a node at L1 row 2 may
//     sit at the same Y as a node at L3 row 2 — that's the whole point
//     of sharing vertical space).
//   - Connectors are smooth cubic beziers from parent right-edge to
//     child left-edge, drawn UNDER the nodes.
//
// Empty states:
//   - Leaf with no children → a `(no children)` sentinel block is placed
//     one level to its right.
//   - Parentless work-scope artefacts → an `orphaned` sentinel block one
//     level to the LEFT of the artefact. (Strategy roots with parent_id
//     === null are NOT orphans — they're legitimate L0 entry points.)
//
// Colour: each node's right-rule comes from its artefact_type's
// `colour` (resolved via ArtefactTypeCatalogue). The node body is
// transparent so the canvas backdrop reads through.
//
// Interaction (expanded mode):
//   - Wheel zooms around the cursor.
//   - Left-drag pans the canvas.
//   - "Expand" button promotes the panel to a fixed overlay sized to
//     `.rd-shell__main-body` (header + nav rail stay visible).
//   - "Close" (X) button collapses back to inline 250px.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MdClose,
  MdOpenInFull,
  MdKeyboardArrowUp,
  MdKeyboardArrowDown,
  MdKeyboardArrowLeft,
  MdKeyboardArrowRight,
  MdZoomIn,
  MdZoomOut,
  MdRefresh,
  MdSwapVert,
  MdSwapHoriz,
  MdSearch,
} from "react-icons/md";

import { apiSite } from "@/app/lib/api";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";

// Minimal wire shape — same projection used by ObjectTreeV2's list path.
// We only need the fields the layout + render touch.
interface ArtefactWire {
  id: string;
  title: string;
  parent_id: string | null;
  artefact_type_id: string;
  type_prefix: string;
  key_num: number;
  // children_count is the backend's authoritative subtree-edge count
  // (cross-scope: counts children EVEN IF they live on another meg
  // node and so aren't in this page's `rows`). When > 0 but no children
  // appear locally, we render an "off-node children" callout.
  children_count?: number;
}

interface LayoutNode {
  // Real artefact ids are UUIDs; sentinel ids use the `__sentinel:` prefix
  // so a hover handler can identify them without re-running graph walks.
  id: string;
  // off-node-parent — fetched parent that lives outside this meg
  //   node's scope; render as a dashed grey placeholder with the
  //   parent's real code label.
  // off-node-children — local artefact has children_count > 0 but
  //   none in scope; placeholder on its right.
  kind: "artefact" | "no-children" | "orphaned" | "off-node-parent" | "off-node-children";
  level: number;
  // y is the centre-of-block Y in viewBox units.
  y: number;
  label: string;
  // Hex colour from the artefact_type catalogue. Sentinels get muted tones.
  colour: string;
  // Pre-computed pixel rectangle for the node body. SVG <rect>'s x/y
  // are top-left; we store top-left here to avoid offsetting at render.
  x: number;
  // Children + parents in LAYOUT space. Includes sentinels so the
  // connector pass can draw to the (no children) blocks too.
  parents: string[];
}

interface LayoutEdge {
  from: string;
  to: string;
}

// Defaults — user can override at runtime via the bottom-left toolbar.
// Reset returns to these values.
const DEFAULT_LEVEL_WIDTH = 300;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 36;
const DEFAULT_MIN_NODE_GAP = 10;
const DEFAULT_ZOOM = 1;
// Stepper increments — picked to feel like one "click" of adjustment.
const LEVEL_WIDTH_STEP = 25;
const NODE_GAP_STEP = 5;
const ZOOM_STEP = 0.1;
// Clamps so the user can't tank readability with the steppers.
const LEVEL_WIDTH_MIN = 180;
const LEVEL_WIDTH_MAX = 1200;
const NODE_GAP_MIN = 0;
const NODE_GAP_MAX = 200;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const INLINE_CANVAS_HEIGHT = 250;
// Connector thickness scales linearly with the subtree weight (node +
// all descendants) of the CHILD end of the edge. Capped so a 100-node
// trunk doesn't drown the diagram.
const EDGE_THICKNESS_MIN = 1;
const EDGE_THICKNESS_MAX = 12;
// NODE_X_PAD derives from the live LEVEL_WIDTH; computed inside
// buildLayout, not as a module-level const.

const SENTINEL_COLOUR = "var(--ink-muted, #6b7280)";
const ORPHAN_COLOUR = "var(--danger, #c83b5b)";

// collectMissingParents — given a batch of rows + the set of artefacts
// we already know about, returns every parent_id that's referenced but
// not present. Used by the climber to build each fetch frontier.
function collectMissingParents(
  batch: ArtefactWire[],
  known: Map<string, ArtefactWire>,
): Set<string> {
  const missing = new Set<string>();
  for (const r of batch) {
    if (r.parent_id != null && !known.has(r.parent_id)) {
      missing.add(r.parent_id);
    }
  }
  return missing;
}

export interface ArtefactTreeProps {
  pageKey?: string;
  resourceUrl?: string;
  // When true, mounts directly in expanded (full page-shell overlay)
  // mode and skips the inline 250px stage entirely. The close button
  // calls onRequestClose so the parent can flip its own toggle —
  // ArtefactTree doesn't try to "collapse to inline" because there is
  // no inline view in this mode.
  forceExpanded?: boolean;
  onRequestClose?: () => void;
}

export default function ArtefactTree({
  resourceUrl = "/portfolio-items",
  forceExpanded = false,
  onRequestClose,
}: ArtefactTreeProps) {
  const { types } = useArtefactTypeCatalogue();
  const [rows, setRows] = useState<ArtefactWire[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = forceExpanded || internalExpanded;
  // Single handler the toolbar uses for the close button — either
  // forwards to the parent (overlay-only mode) or flips the internal
  // toggle (inline-can-expand mode).
  const setExpanded = useCallback((next: boolean) => {
    if (forceExpanded) {
      if (!next && onRequestClose) onRequestClose();
      return;
    }
    setInternalExpanded(next);
  }, [forceExpanded, onRequestClose]);
  // Measured page-shell rect (the area we fill when expanded). Updated
  // on expand + window resize. Falling back to viewport-fill if the
  // shell container isn't present (unlikely on /portfolio-items or
  // /work-items — both render inside .rd-shell__main-body).
  const [shellRect, setShellRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The handler param is ?limit= (not ?page_size= — that's ignored
    // and silently falls back to 50). 2000 is well above any realistic
    // workspace clamp; the meg/scope clamp is what bounds the real
    // result set. If a tenant ever exceeds 2k artefacts in one scope
    // we'll need a pagination loop here, but that's far away.
    apiSite<{ items: ArtefactWire[] }>(`${resourceUrl}?limit=2000`)
      .then((r) => {
        if (cancelled) return;
        setRows(r.items ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load artefacts");
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [resourceUrl]);

  // Measure the shell container so the expanded overlay fills exactly
  // the page-content area (below topbar, right of nav rail). Re-measure
  // on resize. The selector is stable — see app/redesign/layout.tsx.
  useLayoutEffect(() => {
    if (!expanded) return;
    function measure() {
      const el = document.querySelector(".rd-shell__main-body") as HTMLElement | null;
      setShellRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [expanded]);

  // Esc closes the fullscreen overlay — standard modal pattern.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const colourByTypeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of types) {
      m.set(t.id, t.colour ?? SENTINEL_COLOUR);
    }
    return m;
  }, [types]);

  // Slot-based leaf detection — the wrk_task slot is the canonical
  // execution leaf ("leaf execution unit" per migration 078). Using
  // allows_children was wrong: that column defaults to TRUE in the DB
  // and isn't reliably flipped to FALSE for tasks in every tenant.
  // The slot is the project-locked, semantically authoritative marker.
  const isLeafTypeById = useMemo(() => {
    const m = new Map<string, boolean>();
    const LEAF_SLOTS = new Set(["wrk_task"]);
    for (const t of types) m.set(t.id, t.slot != null && LEAF_SLOTS.has(t.slot));
    return m;
  }, [types]);

  // "Top of ladder" types — the very top of the workspace's portfolio
  // model (e.g. Portfolio Runway). A type is top-of-ladder when its
  // own parent_type_id is null. Used by the climber: only artefacts
  // whose chain terminates at a top-type root count as TRACKED. A
  // non-top-type with parent_id=NULL is an orphan (untracked work).
  const isTopTypeById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const t of types) m.set(t.id, t.parent_type_id == null);
    return m;
  }, [types]);

  // Off-node parents resolved via the API (parents we couldn't find
  // in `rows` but the backend does have — they live on another meg
  // node). Keyed by id so the layout can render dashed placeholders
  // with the parent's real code.
  const [offNodeParents, setOffNodeParents] = useState<Map<string, ArtefactWire>>(new Map());

  // Climber — walks the parent chain of every loaded artefact. Any
  // parent_id that doesn't resolve locally is queued for an API fetch.
  // Tries BOTH /work-items/by-ids and /portfolio-items/by-ids in
  // parallel (a strategy parent can sit above a work child or vice
  // versa, depending on where the model splits). Repeats until every
  // chain either reaches a top-type root, a null parent, or a true
  // 404. Capped at MAX_CLIMB iterations as a safety belt against
  // pathological deep chains.
  useEffect(() => {
    if (!rows || rows.length === 0 || types.length === 0) return;
    let cancelled = false;
    const MAX_CLIMB = 6;
    const resolved = new Map<string, ArtefactWire>();

    async function climb() {
      const known = new Map<string, ArtefactWire>();
      for (const r of rows!) known.set(r.id, r);

      let frontier = collectMissingParents(rows!, known);
      for (let pass = 0; pass < MAX_CLIMB && frontier.size > 0; pass++) {
        if (cancelled) return;
        const ids = Array.from(frontier).join(",");
        // Resource paths overlap on the same artefact subscription;
        // the /by-ids handler is subscription-scoped only (not meg-
        // clamped) so it returns artefacts from any node. Try both
        // resource roots so we catch both strategy and work types.
        const [w, p] = await Promise.all([
          apiSite<{ items: ArtefactWire[] }>(`/work-items/by-ids?ids=${ids}`).catch(() => ({ items: [] as ArtefactWire[] })),
          apiSite<{ items: ArtefactWire[] }>(`/portfolio-items/by-ids?ids=${ids}`).catch(() => ({ items: [] as ArtefactWire[] })),
        ]);
        if (cancelled) return;

        const fetched: ArtefactWire[] = [];
        for (const r of w.items ?? []) fetched.push(r);
        for (const r of p.items ?? []) {
          // Dedup if both endpoints somehow returned the same id.
          if (!fetched.some((f) => f.id === r.id)) fetched.push(r);
        }

        if (fetched.length === 0) break; // every remaining parent is a true 404 / orphan

        for (const r of fetched) {
          resolved.set(r.id, r);
          known.set(r.id, r);
        }
        // Re-derive the frontier from the newly fetched rows; their
        // own parent_id values may also be off-node and need fetching.
        frontier = collectMissingParents(fetched, known);
      }

      if (!cancelled) setOffNodeParents(resolved);
    }

    climb();
    return () => {
      cancelled = true;
    };
  }, [rows, types]);

  // Runtime-adjustable layout knobs. The bottom-left toolbar mutates
  // these; reset returns to defaults.
  const [levelWidth, setLevelWidth] = useState(DEFAULT_LEVEL_WIDTH);
  const [minNodeGap, setMinNodeGap] = useState(DEFAULT_MIN_NODE_GAP);
  // Zoom is lifted up from PanZoomCanvas so the toolbar can drive it
  // alongside the wheel handler. Wheel + buttons both call setZoom.
  const [zoom, setZoom] = useState<{ k: number; x: number; y: number }>({
    k: DEFAULT_ZOOM,
    x: 0,
    y: 0,
  });

  const resetView = useCallback(() => {
    setLevelWidth(DEFAULT_LEVEL_WIDTH);
    setMinNodeGap(DEFAULT_MIN_NODE_GAP);
    setZoom({ k: DEFAULT_ZOOM, x: 0, y: 0 });
  }, []);

  const bumpLevelWidth = useCallback((delta: number) => {
    setLevelWidth((v) => Math.max(LEVEL_WIDTH_MIN, Math.min(LEVEL_WIDTH_MAX, v + delta)));
  }, []);
  const bumpNodeGap = useCallback((delta: number) => {
    setMinNodeGap((v) => Math.max(NODE_GAP_MIN, Math.min(NODE_GAP_MAX, v + delta)));
  }, []);
  const bumpZoom = useCallback((delta: number) => {
    setZoom((prev) => ({ ...prev, k: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.k + delta)) }));
  }, []);

  // Canvas height varies with mode. The build pass needs a height to
  // pack columns into; the SVG also uses it for the viewBox.
  const canvasHeight = expanded
    ? Math.max(400, shellRect?.height ?? 600) - 56 /* panel chrome */
    : INLINE_CANVAS_HEIGHT;

  const { nodes, edges } = useMemo(() => {
    return buildLayout(
      rows ?? [],
      colourByTypeId,
      isLeafTypeById,
      isTopTypeById,
      offNodeParents,
      canvasHeight,
      levelWidth,
      minNodeGap,
    );
  }, [rows, colourByTypeId, isLeafTypeById, isTopTypeById, offNodeParents, canvasHeight, levelWidth, minNodeGap]);

  if (rows === null) return <ToolbarShell expanded={expanded} setExpanded={setExpanded}><p className="artefact-tree__empty">Loading…</p></ToolbarShell>;
  if (error) return <ToolbarShell expanded={expanded} setExpanded={setExpanded}><p className="artefact-tree__empty">{error}</p></ToolbarShell>;
  if (rows.length === 0) return <ToolbarShell expanded={expanded} setExpanded={setExpanded}><p className="artefact-tree__empty">No artefacts in scope.</p></ToolbarShell>;

  const canvas = (
    <>
      <PanZoomCanvas
        nodes={nodes}
        edges={edges}
        expanded={expanded}
        zoom={zoom}
        setZoom={setZoom}
      />
      <ArtefactTreeControls
        levelWidth={levelWidth}
        minNodeGap={minNodeGap}
        zoom={zoom.k}
        onLevelWidth={bumpLevelWidth}
        onNodeGap={bumpNodeGap}
        onZoom={bumpZoom}
        onReset={resetView}
      />
    </>
  );

  if (expanded) {
    // Fixed overlay anchored to the page-shell main-body rect. Inline
    // styles only for the rect (it's runtime-measured); everything else
    // is in CSS. Falls back to inset:0 if the rect couldn't be measured.
    const style: React.CSSProperties = shellRect
      ? {
          top: shellRect.top,
          left: shellRect.left,
          width: shellRect.width,
          height: shellRect.height,
        }
      : { inset: 0 };
    return (
      <div className="artefact-tree__Overlay" style={style} role="dialog" aria-modal="true" aria-label="Artefact tree (expanded)">
        <ToolbarShell expanded setExpanded={setExpanded}>
          {canvas}
        </ToolbarShell>
      </div>
    );
  }

  return (
    <ToolbarShell expanded={false} setExpanded={setExpanded}>
      {canvas}
    </ToolbarShell>
  );
}

// ToolbarShell wraps the canvas with the expand/close toolbar so both
// inline and expanded modes share one chrome. Keeping it inline means
// the expand button sits in the same place either way.
function ToolbarShell({
  expanded,
  setExpanded,
  children,
}: {
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={"artefact-tree" + (expanded ? " artefact-tree--expanded" : "")}>
      <div className="artefact-tree__Toolbar">
        {expanded ? (
          <button
            type="button"
            className="artefact-tree__Toolbar_Btn"
            onClick={() => setExpanded(false)}
            aria-label="Close expanded tree"
          >
            <MdClose size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="artefact-tree__Toolbar_Btn"
            onClick={() => setExpanded(true)}
            aria-label="Expand tree"
            title="Expand"
          >
            <MdOpenInFull size={14} />
          </button>
        )}
      </div>
      <div className="artefact-tree__Body">{children}</div>
    </div>
  );
}

// PanZoomCanvas owns the wheel-zoom + drag-pan transform applied to the
// node group. Zoom state lives in the parent so the bottom-left toolbar
// can drive it too; this component just wires wheel + drag handlers.
function PanZoomCanvas({
  nodes,
  edges,
  expanded,
  zoom,
  setZoom,
}: {
  nodes: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  expanded: boolean;
  zoom: { k: number; x: number; y: number };
  setZoom: React.Dispatch<React.SetStateAction<{ k: number; x: number; y: number }>>;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Per-node weight = 1 (the node itself) + recursive sum of children's
  // weights. Drives connector thickness: each edge's stroke-width =
  // weight of the CHILD end (descendant subtree size including the
  // child). A line into a leaf = 1; a line into a parent of a 50-leaf
  // subtree = 50, capped at EDGE_MAX_THICKNESS so no single trunk
  // dominates the canvas.
  const weightById = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    for (const e of edges) {
      if (!childrenByParent.has(e.from)) childrenByParent.set(e.from, []);
      childrenByParent.get(e.from)!.push(e.to);
    }
    const w = new Map<string, number>();
    function compute(id: string, seen: Set<string>): number {
      const cached = w.get(id);
      if (cached != null) return cached;
      if (seen.has(id)) {
        // Cycle protection — bail at 1 so a corrupted graph can't loop.
        w.set(id, 1);
        return 1;
      }
      const kids = childrenByParent.get(id) ?? [];
      if (kids.length === 0) {
        w.set(id, 1);
        return 1;
      }
      seen.add(id);
      let sum = 1; // count the node itself
      for (const k of kids) sum += compute(k, seen);
      seen.delete(id);
      w.set(id, sum);
      return sum;
    }
    for (const n of nodes.keys()) compute(n, new Set());
    return w;
  }, [nodes, edges]);

  // Reset transform when the canvas re-sizes (mode flip). Without this
  // an expand keeps the inline tx/ty and the user has to pan to find
  // the tree.
  useEffect(() => {
    setZoom({ k: 1, x: 0, y: 0 });
  }, [expanded, setZoom]);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Cursor position in viewBox (post-transform) coordinates.
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Trackpad pinch and wheel both arrive as wheel events; clamp the
    // step so a fast spin doesn't catapult past readable zoom levels.
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.001);
    setZoom((prev) => {
      const nextK = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.k * factor));
      // Keep the point under the cursor stationary across the zoom:
      //   px_world = (cx - tx) / k     // unchanged by zoom
      //   newTx = cx - px_world * newK
      const px = (cx - prev.x) / prev.k;
      const py = (cy - prev.y) / prev.k;
      return { k: nextK, x: cx - px * nextK, y: cy - py * nextK };
    });
  }, [setZoom]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    // Only left button initiates a pan. Right-click is reserved (future
    // context menu); middle is left for the browser's autoscroll which
    // some users rely on.
    if (e.button !== 0) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: zoom.x, oy: zoom.y };
  }, [zoom.x, zoom.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setZoom((prev) => ({ ...prev, x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) }));
  }, [setZoom]);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  }, []);

  // The visible SVG fills its container; viewBox math doesn't apply
  // because we're transforming the inner <g>. So width/height are
  // omitted and CSS sizes the SVG to the body.
  return (
    <svg
      ref={svgRef}
      className="artefact-tree__Canvas"
      role="img"
      aria-label="Artefact hierarchy tree"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <defs>
        {/* Barber-pole pattern for sentinel nodes. 40px tile, 20px red
            + 20px transparent diagonal; patternTransform rotates the
            tile so the stripes appear at 45°. Tile is drawn in user-
            space units (matches our SVG transform), so it stays at a
            stable visual size regardless of zoom. */}
        <pattern
          id="artefact-tree-barber"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="40" height="40" fill="transparent" />
          <rect width="20" height="40" fill="var(--danger, #c83b5b)" opacity="0.7" />
        </pattern>
        {/* Arrow head for connector START — flow points from child →
            parent (the arrow lands at the parent side). orient="auto-
            start-reverse" rotates the marker to align with the start
            tangent reversed, so the apex points back at the parent's
            right edge. refX = markerWidth keeps the tip flush with
            the path's origin so it doesn't clip into the parent body. */}
        <marker
          id="artefact-tree-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="artefact-tree__Arrow" />
        </marker>
      </defs>
      <g
        className="artefact-tree__Pan"
        transform={`translate(${zoom.x}, ${zoom.y}) scale(${zoom.k})`}
        style={{ transformOrigin: "0 0" }}
      >
        {/* Connectors first, so node rects render on top. */}
        <g className="artefact-tree__Edges">
          {edges.map((e) => {
            const from = nodes.get(e.from);
            const to = nodes.get(e.to);
            if (!from || !to) return null;
            // Arrow lives at the PARENT side now (markerStart, oriented
            // to point back at the parent). Push x1 a few px right of the
            // parent's right edge so the arrow head doesn't crash into
            // the rule. x2 sits flush at the child's left edge. All
            // child connectors meet at the same point on the parent
            // (centre right edge) — busy parents show as bundles of
            // lines emerging from one spot.
            const ARROW_GAP = 4;
            const x1 = from.x + NODE_WIDTH + ARROW_GAP;
            const y1 = from.y;
            const x2 = to.x;
            const y2 = to.y;
            const dx = (x2 - x1) * 0.5;
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            // Thickness = clamp(child subtree weight, MIN, MAX). Reads
            // as "how much work flows down this line" — a connector
            // into a parent of 50 descendants is fat; a connector into
            // a leaf is thin.
            const childWeight = weightById.get(e.to) ?? 1;
            const strokeW = Math.max(EDGE_THICKNESS_MIN, Math.min(EDGE_THICKNESS_MAX, childWeight));
            return (
              <path
                key={`${e.from}->${e.to}`}
                d={d}
                className="artefact-tree__Edge"
                fill="none"
                strokeWidth={strokeW}
                markerStart="url(#artefact-tree-arrow)"
              />
            );
          })}
        </g>

        <g className="artefact-tree__Nodes">
          {Array.from(nodes.values()).map((n) => {
            // Off-node placeholders (parent or children that exist on
            // a different meg node) — dashed grey rect, label visible
            // directly. Reads as "exists elsewhere", neither hazard
            // (orphan) nor terminal (no children).
            if (n.kind === "off-node-parent" || n.kind === "off-node-children") {
              return (
                <g
                  key={n.id}
                  className="artefact-tree__Node artefact-tree__Node--offnode"
                  transform={`translate(${n.x}, ${n.y - NODE_HEIGHT / 2})`}
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={4}
                    ry={4}
                    className="artefact-tree__Node_OffNode"
                  />
                  <text
                    x={NODE_WIDTH / 2}
                    y={NODE_HEIGHT / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="artefact-tree__Node_Label artefact-tree__Node_Label--offnode"
                  >
                    {n.label}
                  </text>
                </g>
              );
            }
            const isSentinel = n.kind !== "artefact";
            if (isSentinel) {
              // Sentinel (orphaned / no children): red+transparent
              // diagonal barber pole as the fill, plate centred with
              // the label. No three-side black frame, no right-rule —
              // the pole IS the framing, and the plate carries the
              // text on the canvas backdrop.
              const PLATE_W = 110;
              const PLATE_H = 22;
              const plateX = (NODE_WIDTH - PLATE_W) / 2;
              const plateY = (NODE_HEIGHT - PLATE_H) / 2;
              return (
                <g
                  key={n.id}
                  className="artefact-tree__Node artefact-tree__Node--sentinel"
                  transform={`translate(${n.x}, ${n.y - NODE_HEIGHT / 2})`}
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    fill="url(#artefact-tree-barber)"
                    className="artefact-tree__Node_Pole"
                  />
                  <rect
                    x={plateX}
                    y={plateY}
                    width={PLATE_W}
                    height={PLATE_H}
                    rx={3}
                    ry={3}
                    className="artefact-tree__Node_Plate"
                  />
                  <text
                    x={NODE_WIDTH / 2}
                    y={NODE_HEIGHT / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="artefact-tree__Node_Label artefact-tree__Node_Label--plate"
                  >
                    {n.label}
                  </text>
                </g>
              );
            }
            // Real artefact: transparent body, 3-side black frame, 5px
            // type-colour right rule, mono label.
            const RIGHT_RULE = 5;
            return (
              <g
                key={n.id}
                className="artefact-tree__Node"
                transform={`translate(${n.x}, ${n.y - NODE_HEIGHT / 2})`}
              >
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  className="artefact-tree__Node_Body"
                />
                <line x1={0} y1={0} x2={NODE_WIDTH} y2={0} className="artefact-tree__Node_Edge" />
                <line x1={0} y1={NODE_HEIGHT} x2={NODE_WIDTH} y2={NODE_HEIGHT} className="artefact-tree__Node_Edge" />
                <line x1={0} y1={0} x2={0} y2={NODE_HEIGHT} className="artefact-tree__Node_Edge" />
                <rect
                  x={NODE_WIDTH - RIGHT_RULE}
                  width={RIGHT_RULE}
                  height={NODE_HEIGHT}
                  fill={n.colour}
                />
                <text
                  x={(NODE_WIDTH - RIGHT_RULE) / 2}
                  y={NODE_HEIGHT / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="artefact-tree__Node_Label"
                >
                  {n.label}
                </text>
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}

function buildLayout(
  rows: ArtefactWire[],
  colourByTypeId: Map<string, string>,
  isLeafTypeById: Map<string, boolean>,
  isTopTypeById: Map<string, boolean>,
  offNodeParents: Map<string, ArtefactWire>,
  canvasHeight: number,
  levelWidth: number,
  minNodeGap: number,
): { nodes: Map<string, LayoutNode>; edges: LayoutEdge[]; totalLevels: number } {
  const nodeXPad = (levelWidth - NODE_WIDTH) / 2;
  const nodes = new Map<string, LayoutNode>();
  const edges: LayoutEdge[] = [];

  if (rows.length === 0) {
    return { nodes, edges, totalLevels: 0 };
  }

  // Combined index — local rows plus fetched off-node parents. The
  // climber chain walks against THIS index so we can tell true orphans
  // (chain dead-ends) from off-node placements (chain reaches a known
  // parent we just don't have locally).
  const byId = new Map<string, ArtefactWire>();
  for (const r of rows) byId.set(r.id, r);
  for (const [id, r] of offNodeParents.entries()) {
    if (!byId.has(id)) byId.set(id, r);
  }

  // Classify every loaded artefact by walking its parent chain.
  //   tracked    — chain terminates at a top-of-ladder root (e.g. Portfolio Runway)
  //   orphan     — chain dead-ends at a non-top type with parent_id=NULL
  //                OR hits a parent_id we couldn't resolve anywhere
  //   off-node   — chain passes through at least one off-node parent
  //                BEFORE reaching a top root (i.e. fetched, not local)
  type Classification = "tracked" | "orphan" | "off-node";
  const classifyById = new Map<string, Classification>();
  // For off-node artefacts, the nearest off-node ancestor's id —
  // that's what we render the dashed placeholder for.
  const nearestOffNodeAncestorById = new Map<string, string>();
  // O(1) set of locally-loaded ids so classify() doesn't need an
  // O(n) rows.some lookup inside its recursion.
  const localIdSet = new Set<string>(rows.map((r) => r.id));

  function classify(id: string, seen: Set<string>): Classification {
    const cached = classifyById.get(id);
    if (cached != null) return cached;
    if (seen.has(id)) {
      classifyById.set(id, "orphan");
      return "orphan";
    }
    const r = byId.get(id);
    if (!r) {
      classifyById.set(id, "orphan");
      return "orphan";
    }
    // Hit the top of the ladder: tracked.
    if (isTopTypeById.get(r.artefact_type_id) === true && r.parent_id == null) {
      classifyById.set(id, "tracked");
      return "tracked";
    }
    // Non-top type with no parent → untracked work.
    if (r.parent_id == null) {
      classifyById.set(id, "orphan");
      return "orphan";
    }
    // Parent doesn't exist anywhere (neither local nor fetched).
    if (!byId.has(r.parent_id)) {
      classifyById.set(id, "orphan");
      return "orphan";
    }
    seen.add(id);
    const parentClass = classify(r.parent_id, seen);
    seen.delete(id);
    // If parent itself is an off-node row, OR parent is off-node
    // upstream, this node inherits off-node.
    const parentIsLocal = localIdSet.has(r.parent_id);
    if (!parentIsLocal && offNodeParents.has(r.parent_id)) {
      classifyById.set(id, "off-node");
      nearestOffNodeAncestorById.set(id, r.parent_id);
      return "off-node";
    }
    if (parentClass === "off-node") {
      classifyById.set(id, "off-node");
      const ancestor = nearestOffNodeAncestorById.get(r.parent_id);
      if (ancestor) nearestOffNodeAncestorById.set(id, ancestor);
      return "off-node";
    }
    classifyById.set(id, parentClass);
    return parentClass;
  }
  for (const r of rows) classify(r.id, new Set());

  // Level (depth from local root for layout column placement). Uses
  // only LOCAL parents — off-node parents get their own column to the
  // left of their child, computed separately.
  const localById = new Map<string, ArtefactWire>();
  for (const r of rows) localById.set(r.id, r);
  const levelById = new Map<string, number>();
  function levelOf(id: string, seen: Set<string>): number {
    const cached = levelById.get(id);
    if (cached != null) return cached;
    if (seen.has(id)) {
      levelById.set(id, 0);
      return 0;
    }
    const row = localById.get(id);
    if (!row) return 0;
    if (row.parent_id == null || !localById.has(row.parent_id)) {
      levelById.set(id, 0);
      return 0;
    }
    seen.add(id);
    const lvl = levelOf(row.parent_id, seen) + 1;
    levelById.set(id, lvl);
    return lvl;
  }
  for (const r of rows) levelOf(r.id, new Set());

  // Orphan + off-node lists for column placement / sentinel emission.
  const orphanedIds: string[] = [];
  const offNodeChildIds: string[] = []; // local rows whose nearest off-node ancestor is the IMMEDIATE parent
  for (const r of rows) {
    const c = classifyById.get(r.id);
    if (c === "orphan") orphanedIds.push(r.id);
    if (c === "off-node" && r.parent_id != null && offNodeParents.has(r.parent_id)) {
      // Only flag children whose IMMEDIATE parent is off-node — they
      // get a placeholder to their left. Grandchildren of off-node
      // parents are already correctly chained to a local parent so
      // they don't need their own placeholder.
      offNodeChildIds.push(r.id);
    }
  }

  const rowsByLevel = new Map<number, ArtefactWire[]>();
  for (const r of rows) {
    const lvl = levelById.get(r.id) ?? 0;
    if (!rowsByLevel.has(lvl)) rowsByLevel.set(lvl, []);
    rowsByLevel.get(lvl)!.push(r);
  }
  for (const arr of rowsByLevel.values()) {
    arr.sort((a, b) => {
      if (a.type_prefix !== b.type_prefix) return a.type_prefix.localeCompare(b.type_prefix);
      return a.key_num - b.key_num;
    });
  }

  // Identify leaves needing a `No children` sentinel. Skip:
  //   - leaf-type artefacts (wrk_task — definitional leaf)
  //   - rows whose backend children_count > 0 but no local children
  //     (those get an off-node-children block instead)
  const offNodeChildrenSourceIds = new Set<string>();
  const leafIds = new Set<string>();
  for (const r of rows) {
    if (isLeafTypeById.get(r.artefact_type_id) === true) continue;
    let localChildCount = 0;
    for (const other of rows) {
      if (other.parent_id === r.id) localChildCount++;
    }
    if (localChildCount > 0) continue;
    // No local children. Is the backend telling us there ARE children
    // elsewhere? Render the off-node-children block instead of the
    // standard "No children" sentinel.
    if ((r.children_count ?? 0) > 0) {
      offNodeChildrenSourceIds.add(r.id);
      continue;
    }
    leafIds.add(r.id);
  }

  const baseLevel = Math.min(...Array.from(rowsByLevel.keys()));
  // Reserve a column on the left only if we have orphan OR off-node-
  // parent placeholders to render there.
  const hasLeftCallouts = orphanedIds.length > 0 || offNodeChildIds.length > 0;
  const orphanShift = hasLeftCallouts ? 1 : 0;

  // Build the FULL list of nodes per column first, then pack each
  // column exactly once. The previous implementation called placeColumn
  // multiple times for the same column (once for artefacts, once for
  // sentinels) — each call overwrote the previous Y assignments, which
  // is what produced the overlap in the screenshot.
  const columnBuckets = new Map<number, LayoutNode[]>();
  function pushCol(col: number, node: LayoutNode) {
    if (!columnBuckets.has(col)) columnBuckets.set(col, []);
    columnBuckets.get(col)!.push(node);
  }

  // 1) Real artefacts. Real edges follow naturally from parent_id.
  for (const [lvl, list] of rowsByLevel.entries()) {
    const colIdx = (lvl - baseLevel) + orphanShift;
    for (const r of list) {
      pushCol(colIdx, {
        id: r.id,
        kind: "artefact",
        level: colIdx,
        y: 0,
        label: `${r.type_prefix}-${r.key_num}`,
        colour: colourByTypeId.get(r.artefact_type_id) ?? SENTINEL_COLOUR,
        x: colIdx * levelWidth + nodeXPad,
        parents: r.parent_id != null && byId.has(r.parent_id) ? [r.parent_id] : [],
      });
    }
  }
  for (const r of rows) {
    if (r.parent_id != null && byId.has(r.parent_id)) {
      edges.push({ from: r.parent_id, to: r.id });
    }
  }

  // 2) `No children` sentinels — ONE per column, shared across every
  // leaf in the level immediately to its left. Skips rows that have
  // off-node children (those get their own dashed block instead).
  const leavesByCol = new Map<number, string[]>();
  for (const id of leafIds) {
    const leafLvl = levelById.get(id) ?? 0;
    const leafCol = (leafLvl - baseLevel) + orphanShift;
    const sentinelCol = leafCol + 1;
    if (!leavesByCol.has(sentinelCol)) leavesByCol.set(sentinelCol, []);
    leavesByCol.get(sentinelCol)!.push(id);
  }
  for (const [sentinelCol, leafList] of leavesByCol.entries()) {
    const sentinelId = `__sentinel:noc:col${sentinelCol}`;
    pushCol(sentinelCol, {
      id: sentinelId,
      kind: "no-children",
      level: sentinelCol,
      y: 0,
      label: "No children",
      colour: SENTINEL_COLOUR,
      x: sentinelCol * levelWidth + nodeXPad,
      parents: leafList,
    });
    for (const leafId of leafList) {
      edges.push({ from: leafId, to: sentinelId });
    }
  }

  // 3) Orphan sentinels — ONE per column, shared across every truly
  // orphaned artefact (chain dead-ends, not just off-node) whose
  // target sits in the column immediately to its right.
  const orphansByCol = new Map<number, string[]>();
  for (const id of orphanedIds) {
    const lvl = levelById.get(id) ?? 0;
    const targetCol = (lvl - baseLevel) + orphanShift;
    const orphanCol = targetCol - 1;
    if (orphanCol < 0) continue;
    if (!orphansByCol.has(orphanCol)) orphansByCol.set(orphanCol, []);
    orphansByCol.get(orphanCol)!.push(id);
  }
  for (const [orphanCol, targetList] of orphansByCol.entries()) {
    const orphanId = `__sentinel:orp:col${orphanCol}`;
    pushCol(orphanCol, {
      id: orphanId,
      kind: "orphaned",
      level: orphanCol,
      y: 0,
      label: "Orphaned",
      colour: ORPHAN_COLOUR,
      x: orphanCol * levelWidth + nodeXPad,
      parents: [],
    });
    for (const targetId of targetList) {
      edges.push({ from: orphanId, to: targetId });
    }
  }

  // 4) Off-node PARENT placeholders — one block per unique off-node
  // parent we resolved, sitting in the column to the left of its
  // local children. Shows the parent's actual code (e.g. FE-1234) so
  // the user knows where to find it.
  const offNodeParentEmitted = new Set<string>();
  for (const childId of offNodeChildIds) {
    const child = byId.get(childId);
    if (!child || child.parent_id == null) continue;
    const parent = offNodeParents.get(child.parent_id);
    if (!parent) continue;
    const childLvl = levelById.get(childId) ?? 0;
    const childCol = (childLvl - baseLevel) + orphanShift;
    const placeholderCol = childCol - 1;
    if (placeholderCol < 0) continue;
    const placeholderId = `__sentinel:off-parent:${parent.id}`;
    if (!offNodeParentEmitted.has(placeholderId)) {
      offNodeParentEmitted.add(placeholderId);
      pushCol(placeholderCol, {
        id: placeholderId,
        kind: "off-node-parent",
        level: placeholderCol,
        y: 0,
        label: `${parent.type_prefix}-${parent.key_num}`,
        colour: SENTINEL_COLOUR,
        x: placeholderCol * levelWidth + nodeXPad,
        parents: [],
      });
    }
    edges.push({ from: placeholderId, to: childId });
  }

  // 5) Off-node CHILDREN placeholders — one block per source artefact
  // (the local node with children elsewhere), sitting in the column to
  // its right. Label includes the count so the user sees how many
  // children live off-node.
  for (const sourceId of offNodeChildrenSourceIds) {
    const source = byId.get(sourceId);
    if (!source) continue;
    const sourceLvl = levelById.get(sourceId) ?? 0;
    const sourceCol = (sourceLvl - baseLevel) + orphanShift;
    const placeholderCol = sourceCol + 1;
    const placeholderId = `__sentinel:off-children:${sourceId}`;
    const count = source.children_count ?? 0;
    pushCol(placeholderCol, {
      id: placeholderId,
      kind: "off-node-children",
      level: placeholderCol,
      y: 0,
      label: count > 1 ? `→ ${count} off-node` : `→ off-node`,
      colour: SENTINEL_COLOUR,
      x: placeholderCol * levelWidth + nodeXPad,
      parents: [sourceId],
    });
    edges.push({ from: sourceId, to: placeholderId });
  }

  // Barycenter crossing-reduction layout (Sugiyama-style):
  //   1. Seed each column with a deterministic initial order.
  //   2. Pack top→bottom so every node has a Y.
  //   3. Iterate L→R / R→L passes that re-sort each column by the mean
  //      Y of its neighbours in the adjacent column being considered.
  //      Repack after each column reorder so the next pass sees the
  //      new Ys.
  //   4. Stop when no order changes between passes or after a cap.
  //
  // This handles two cases the previous single-pass parent-alignment
  // missed:
  //   - Lexicographic ties (EP-11885 vs RSK-256) are resolved by
  //     connectivity, not alphabetic order — the one connecting to
  //     higher neighbours floats up.
  //   - Right-side influence (EP-11890 has a child in the next column)
  //     pulls EP-11890 upward when the right pass runs, even though
  //     its parent says otherwise.
  void canvasHeight;

  const STRIDE = NODE_HEIGHT + minNodeGap;
  const TOP_OFFSET = minNodeGap / 2 + NODE_HEIGHT / 2;

  const sortedColumns: Array<{ col: number; nodes: LayoutNode[] }> = Array
    .from(columnBuckets.entries())
    .map(([col, list]) => ({ col, nodes: list }))
    .sort((a, b) => a.col - b.col);

  // Edge adjacency for fast neighbour lookup. sourcesByNodeId =
  // parents (left-side neighbours), targetsByNodeId = children
  // (right-side neighbours).
  const sourcesByNodeId = new Map<string, string[]>();
  for (const e of edges) {
    if (!sourcesByNodeId.has(e.to)) sourcesByNodeId.set(e.to, []);
    sourcesByNodeId.get(e.to)!.push(e.from);
  }
  const targetsByNodeId = new Map<string, string[]>();
  for (const e of edges) {
    if (!targetsByNodeId.has(e.from)) targetsByNodeId.set(e.from, []);
    targetsByNodeId.get(e.from)!.push(e.to);
  }

  // Step 1+2: seed each column with the initial order and pack from top.
  // Initial order uses the same rules as before so subsequent barycenter
  // passes have a good starting point.
  for (let i = 0; i < sortedColumns.length; i++) {
    const { nodes: list } = sortedColumns[i];
    list.sort((a, b) => {
      const aIsSentinel = a.kind !== "artefact";
      const bIsSentinel = b.kind !== "artefact";
      if (aIsSentinel !== bIsSentinel) return aIsSentinel ? 1 : -1;
      const ra = byId.get(a.id);
      const rb = byId.get(b.id);
      if (ra && rb) {
        if (ra.type_prefix !== rb.type_prefix) return ra.type_prefix.localeCompare(rb.type_prefix);
        return ra.key_num - rb.key_num;
      }
      return a.id.localeCompare(b.id);
    });
    packColumn(list, nodes, TOP_OFFSET, STRIDE);
  }

  // Step 3: barycenter passes. neighbourCol param selects which side
  // of the bipartite graph drives the sort key. "left" = parents'
  // mean Y; "right" = children's mean Y.
  function meanNeighbourY(node: LayoutNode, side: "left" | "right"): number {
    const ids = (side === "left" ? sourcesByNodeId : targetsByNodeId).get(node.id) ?? [];
    const ys: number[] = [];
    for (const id of ids) {
      const n = nodes.get(id);
      if (n) ys.push(n.y);
    }
    if (ys.length === 0) return node.y; // anchor in place if no neighbours that side
    return ys.reduce((s, y) => s + y, 0) / ys.length;
  }

  function reorderColumn(list: LayoutNode[], side: "left" | "right"): boolean {
    // Stable sort by mean neighbour Y. Sentinels keep their
    // "after artefacts" rule unless their mean-neighbour Y says
    // otherwise — for "Orphaned" / "No children" we honour the
    // barycenter because the user wants those clustered with their
    // logical neighbours (your screenshot's Orphaned wanted to sit
    // mid-column where its targets land, not at the bottom).
    const keyed = list.map((node, idx) => ({
      node,
      idx,
      key: meanNeighbourY(node, side),
    }));
    keyed.sort((a, b) => {
      if (a.key !== b.key) return a.key - b.key;
      return a.idx - b.idx; // stable
    });
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id !== keyed[i].node.id) {
        changed = true;
        break;
      }
    }
    if (changed) {
      for (let i = 0; i < list.length; i++) list[i] = keyed[i].node;
    }
    return changed;
  }

  // 4 sweeps (2 L→R + 2 R→L) is usually enough for graphs this size;
  // each sweep is O(V + E) work.
  const MAX_SWEEPS = 4;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let anyChange = false;
    // L→R pass: each column sorts by its LEFT neighbours' Ys.
    for (let i = 1; i < sortedColumns.length; i++) {
      const { nodes: list } = sortedColumns[i];
      if (reorderColumn(list, "left")) {
        packColumn(list, nodes, TOP_OFFSET, STRIDE);
        anyChange = true;
      }
    }
    // R→L pass: each column sorts by its RIGHT neighbours' Ys.
    for (let i = sortedColumns.length - 2; i >= 0; i--) {
      const { nodes: list } = sortedColumns[i];
      if (reorderColumn(list, "right")) {
        packColumn(list, nodes, TOP_OFFSET, STRIDE);
        anyChange = true;
      }
    }
    if (!anyChange) break;
  }

  let highestLevel = 0;
  for (const col of columnBuckets.keys()) if (col > highestLevel) highestLevel = col;
  const totalLevels = highestLevel + 1;

  return { nodes, edges, totalLevels };
}

// packColumn — write Ys for `list` in current order, top-aligned with
// fixed stride. Used by buildLayout's initial seed AND every barycenter
// reordering pass so the next pass sees the new geometry.
function packColumn(
  list: LayoutNode[],
  nodes: Map<string, LayoutNode>,
  topOffset: number,
  stride: number,
): void {
  let cursor = topOffset;
  for (const node of list) {
    node.y = cursor;
    nodes.set(node.id, node);
    cursor += stride;
  }
}

// Bottom-left toolbar. Three control blocks (vertical gap, horizontal
// gap, zoom) each render an icon + current value + ± steppers. A reset
// button on the right returns all three to defaults.
function ArtefactTreeControls({
  levelWidth,
  minNodeGap,
  zoom,
  onLevelWidth,
  onNodeGap,
  onZoom,
  onReset,
}: {
  levelWidth: number;
  minNodeGap: number;
  zoom: number;
  onLevelWidth: (delta: number) => void;
  onNodeGap: (delta: number) => void;
  onZoom: (delta: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="artefact-tree__Controls" role="toolbar" aria-label="Tree view controls">
      <ControlBlock
        icon={<MdSwapVert size={14} />}
        label="V gap"
        value={`${minNodeGap}px`}
        decIcon={<MdKeyboardArrowDown size={14} />}
        incIcon={<MdKeyboardArrowUp size={14} />}
        onDec={() => onNodeGap(-NODE_GAP_STEP)}
        onInc={() => onNodeGap(NODE_GAP_STEP)}
        decAria="Decrease vertical gap"
        incAria="Increase vertical gap"
      />
      <ControlBlock
        icon={<MdSwapHoriz size={14} />}
        label="H gap"
        value={`${levelWidth}px`}
        decIcon={<MdKeyboardArrowLeft size={14} />}
        incIcon={<MdKeyboardArrowRight size={14} />}
        onDec={() => onLevelWidth(-LEVEL_WIDTH_STEP)}
        onInc={() => onLevelWidth(LEVEL_WIDTH_STEP)}
        decAria="Decrease column width"
        incAria="Increase column width"
      />
      <ControlBlock
        icon={<MdSearch size={14} />}
        label="Zoom"
        value={`${Math.round(zoom * 100)}%`}
        decIcon={<MdZoomOut size={14} />}
        incIcon={<MdZoomIn size={14} />}
        onDec={() => onZoom(-ZOOM_STEP)}
        onInc={() => onZoom(ZOOM_STEP)}
        decAria="Zoom out"
        incAria="Zoom in"
      />
      <button
        type="button"
        className="artefact-tree__Controls_Reset"
        onClick={onReset}
        aria-label="Reset view"
        title="Reset"
      >
        <MdRefresh size={14} />
      </button>
    </div>
  );
}

function ControlBlock({
  icon,
  label,
  value,
  decIcon,
  incIcon,
  onDec,
  onInc,
  decAria,
  incAria,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  decIcon: React.ReactNode;
  incIcon: React.ReactNode;
  onDec: () => void;
  onInc: () => void;
  decAria: string;
  incAria: string;
}) {
  return (
    <div className="artefact-tree__Controls_Block">
      <div className="artefact-tree__Controls_Block_Head">
        <span className="artefact-tree__Controls_Block_Icon">{icon}</span>
        <span className="artefact-tree__Controls_Block_Label">{label}</span>
        <span className="artefact-tree__Controls_Block_Value">{value}</span>
      </div>
      <div className="artefact-tree__Controls_Block_Steppers">
        <button
          type="button"
          className="artefact-tree__Controls_Block_Step"
          onClick={onDec}
          aria-label={decAria}
        >
          {decIcon}
        </button>
        <button
          type="button"
          className="artefact-tree__Controls_Block_Step"
          onClick={onInc}
          aria-label={incAria}
        >
          {incIcon}
        </button>
      </div>
    </div>
  );
}
