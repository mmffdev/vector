"use client";

// PLA-0006 — Topology tree flyout (left rail inside the canvas viewport).
//
// Layout copies the work-items tree exactly:
//   • drag-grip column (six-dot) on the far left — placeholder for future DnD
//   • expander column — chevrons aligned in a single column (NOT staggered
//     by depth) so the eye reads them as a vertical control strip
//   • tag column with inline SVG that paints the tree spine + elbows so
//     children visually connect to their parent
//   • name column with colour swatch + node name
//
// Behaves like AppSidebar_2 for open/close: collapsed by default (narrow
// rail with a single chevron toggle), hover peeks open, click latches.
// No pin / no close — the chevron is the one and only control. When open
// the body is wrapped in <Panel name="tree"> so it gets its own help
// hexagon (top-right of the panel header) instead of leaking through to
// the panel below.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OrgNode } from "@/app/lib/topologyApi";
import Panel from "@/app/components/Panel";
import { TbAlertTriangle, TbDots } from "react-icons/tb";

// Width per depth level in the SVG tree-line cell. Matches the work-items
// tree (24px) so the visual cadence is identical.
const STEP = 24;

// Row height — matches work-items rows (which use --row-height: 48px).
// Hard-coded here so the SVG geometry doesn't drift if --row-height is
// themed elsewhere; the SVG must match the row exactly to avoid gaps.
const ROW_H = 48;

// Same palette + hash used by the topology canvas (page.tsx). Inlined here
// so the tree row's swatch + grip-border fall back to a stable colour for
// nodes whose `colour` field hasn't been set, matching what the user sees
// on the canvas card border.
const COLOUR_PALETTE = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#ef4444", "#06b6d4", "#6366f1",
];
function paletteColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLOUR_PALETTE[Math.abs(h) % COLOUR_PALETTE.length];
}

export type TopologyTreeFlyoutProps = {
  tree: OrgNode[] | null;
  childrenOf: Map<string | null, OrgNode[]>;
  collapsed: Set<string>;
  selectedId: string | null;
  onToggleCollapse: (id: string) => void;
  // Single click — select only (paints the accent ring on the canvas).
  onSelect: (id: string) => void;
  // Double click — pan the canvas to the node (smooth, preserves zoom).
  onActivate: (id: string) => void;
  // Admin-row toggle: clear (expand) or fill (collapse) the collapsed set.
  onExpandAll: () => void;
  onCollapseAll: () => void;
  // Per-row kebab — opens the same context menu as the canvas card.
  onOpenMenu: (id: string, screenX: number, screenY: number) => void;
  // Triangle (only rendered when the row's archived_descendant_count > 0).
  onOpenArchiveMap: (id: string, name: string) => void;
  // Effective overlay width in CSS px (0 when collapsed). Parent uses this
  // to offset its setCenter target so a clicked node lands in the visible
  // (right-of-flyout) half of the viewport, not behind the flyout.
  onWidthChange?: (px: number) => void;
};

type FlattenedRow = {
  node: OrgNode;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  isFirst: boolean;
  isLast: boolean;
  hasVisibleChildren: boolean;
  // ancestorMoreChildren[d] = true means the ancestor at depth d (along
  // this row's path to the root) has more visible children below the
  // subtree containing this row. We paint a vertical at column
  // d*STEP + STEP/2 (= ancestor d's child-spine column) through this row
  // so the connection between sibling subtrees of that ancestor remains
  // visually continuous, no matter how many descendant rows lie between
  // them. Length = depth; entry for the immediate parent (index depth-1)
  // is omitted because the row's own elbow connector handles that column.
  ancestorMoreChildren: boolean[];
};

function flatten(
  childrenOf: Map<string | null, OrgNode[]>,
  collapsed: Set<string>,
): FlattenedRow[] {
  const out: FlattenedRow[] = [];
  // `pathMoreChildren` at depth D has length D and encodes, for each
  // ancestor depth d < D, whether the ancestor's child along this path
  // (at depth d+1) is NOT the last visible child of that ancestor —
  // i.e. there is a later sibling subtree to connect to.
  const walk = (
    parentId: string | null,
    depth: number,
    pathMoreChildren: boolean[],
  ) => {
    const kids = childrenOf.get(parentId) ?? [];
    kids.forEach((node, idx) => {
      const childKids = childrenOf.get(node.id) ?? [];
      const hasChildren = childKids.length > 0;
      const isCollapsed = collapsed.has(node.id);
      const isFirst = idx === 0;
      const isLast = idx === kids.length - 1;
      const hasVisibleChildren = hasChildren && !isCollapsed;
      out.push({
        node,
        depth,
        hasChildren,
        collapsed: isCollapsed,
        isFirst,
        isLast,
        hasVisibleChildren,
        ancestorMoreChildren: pathMoreChildren,
      });
      if (hasVisibleChildren) {
        // Build the children's pathMoreChildren array. Each child sits at
        // depth `depth+1`; their ancestor at depth `depth` is THIS row.
        // The ancestor at depth `depth` has more children below an
        // individual child's subtree iff this row is not the last sibling
        // — encoded as `!isLast` at index `depth-1` of the child's array
        // (column (depth-1)*STEP + STEP/2 = this row's elbow column).
        //
        // Roots (depth 0) have no parent column, so for root children
        // (depth 1) the array is empty: depth-1 rows attach to the root
        // spine which is drawn separately and don't need a through-line.
        // For deeper children we append `!isLast` to extend the chain.
        const childPath = depth === 0 ? [] : [...pathMoreChildren, !isLast];
        walk(node.id, depth + 1, childPath);
      }
    });
  };
  walk(null, 0, []);
  return out;
}

export default function TopologyTreeFlyout({
  tree,
  childrenOf,
  collapsed,
  selectedId,
  onToggleCollapse,
  onSelect,
  onActivate,
  onExpandAll,
  onCollapseAll,
  onOpenMenu,
  onOpenArchiveMap,
  onWidthChange,
}: TopologyTreeFlyoutProps) {
  // Mirrors AppSidebar_2: two boolean states. `pinned` (latched open by
  // click) + `peeked` (transient hover-open). The flyout is open when
  // either is true.
  const [pinned, setPinned] = useState(true);
  const [peeked, setPeeked] = useState(false);
  const open = pinned || peeked;

  // User-resizable width. Defaults to 50% of viewport on first open;
  // dragging the right-edge handle adjusts it. Clamped to [360, 90vw].
  // Stored as a number of pixels so the inline style is a single source.
  const [width, setWidth] = useState<number | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Tracks the user's manual drag intent so the auto-grow effect doesn't
  // fight it: once the user drags the handle, we stop auto-growing on
  // expand. They've expressed an explicit width preference.
  const userResizedRef = useRef(false);

  const onResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!asideRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const startWidth = asideRef.current.getBoundingClientRect().width;
    dragStateRef.current = { startX: e.clientX, startWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s) return;
    const delta = e.clientX - s.startX;
    const min = 360;
    const max = Math.max(min, window.innerWidth * 0.9);
    const next = Math.min(max, Math.max(min, s.startWidth + delta));
    userResizedRef.current = true;
    setWidth(next);
  }, []);

  const onResizeUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, []);

  // Reset peek-blocking while dragging: don't let mouseleave snap shut.
  useEffect(() => {
    const onUp = () => { dragStateRef.current = null; };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  // Report effective overlay width to the parent so it can offset its
  // camera-centring target AND inset the floating canvas panel's left
  // edge. Uses ResizeObserver so we capture every intermediate frame of
  // the CSS width transition (200ms ease) — without this, the floating
  // canvas panel jumps to the post-transition width instantly OR, worse,
  // sticks at a stale width when collapsing because the layout effect
  // measured mid-transition before the aside finished shrinking.
  useLayoutEffect(() => {
    if (!onWidthChange) return;
    const el = asideRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Use getBoundingClientRect for the outer width (includes borders).
      // When the aside is open, also include the 10px resize handle that
      // sits at right: -10px (extending past the aside) so the parent
      // positions the canvas panel clear of the handle as well.
      const base = el.getBoundingClientRect().width;
      const handle = el.classList.contains("is-open") ? 10 : 0;
      onWidthChange(base + handle);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onWidthChange]);

  const rows = useMemo(
    () => (tree ? flatten(childrenOf, collapsed) : []),
    [tree, childrenOf, collapsed],
  );

  // Auto-fit panel width to the widest visible row whenever the row set
  // changes (expand/collapse). The panel ALWAYS tracks the widest visible
  // node — there is no fixed-width default it snaps back to. Grows when
  // an expanded child reveals a longer name, shrinks when that child is
  // collapsed away. Capped at 90vw, floored at a small absolute minimum
  // (240px) so the toolbar/chrome stays usable when the tree is empty
  // or every name is very short. Skipped after a manual resize.
  useLayoutEffect(() => {
    if (!open) return;
    if (userResizedRef.current) return;
    const body = bodyRef.current;
    if (!body) return;
    const table = body.querySelector<HTMLTableElement>(".topo-tree-table");
    if (!table) return;
    const max = window.innerWidth * 0.9;
    const ABSOLUTE_MIN = 240;

    // Read the table's natural content width. The table's CSS is
    // `width: max-content; min-width: 100%` so its rendered width is
    // max(natural, container). To learn the real natural width — which
    // is what we need so the panel can SHRINK as well as grow — we
    // temporarily release the `min-width: 100%` floor via a data attr.
    // forceLayout via getBoundingClientRect ensures the browser commits
    // the new layout before we read the natural width.
    table.setAttribute("data-measuring", "true");
    table.getBoundingClientRect();
    const naturalWidth = table.scrollWidth;
    table.removeAttribute("data-measuring");
    if (naturalWidth === 0) return;

    // Small buffer for borders / sub-pixel rounding / scrollbar gutter
    // so a vertical scrollbar appearing later doesn't immediately push
    // content past the right edge.
    const BUFFER = 12;
    const needed = naturalWidth + BUFFER;

    const next = Math.min(max, Math.max(ABSOLUTE_MIN, needed));
    setWidth((prev) => {
      if (prev != null && Math.abs(next - prev) <= 1) return prev;
      return next;
    });
  }, [rows, open]);

  // Admin-row toggle state: "all expanded" iff no parent with children is
  // currently in the collapsed set. Empty tree counts as fully expanded.
  const allExpanded = useMemo(() => {
    for (const [parentId, kids] of childrenOf.entries()) {
      if (parentId !== null && kids.length > 0 && collapsed.has(parentId)) {
        return false;
      }
    }
    return true;
  }, [childrenOf, collapsed]);

  const onMouseEnter = useCallback(() => {
    if (!pinned) setPeeked(true);
  }, [pinned]);
  const onMouseLeave = useCallback(() => {
    // Don't collapse mid-resize-drag — the cursor will routinely leave the
    // aside as the user drags rightward.
    if (dragStateRef.current) return;
    if (!pinned) setPeeked(false);
  }, [pinned]);

  // Single chevron toggle: clicking flips the latched (pinned) state and
  // clears the transient peek so the rail returns to its idle width when
  // unpinning. Matches sidebar-collapse-toggle behaviour exactly.
  const onChevronClick = useCallback(() => {
    setPinned((p) => !p);
    setPeeked(false);
  }, []);

  return (
    <aside
      ref={asideRef}
      className={`topo-tree${open ? " is-open" : ""}${pinned ? " is-pinned" : ""}`}
      data-collapsed={open ? "false" : "true"}
      aria-label="Topology tree"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={open && width != null ? { width: `${width}px` } : undefined}
    >
      {/* Collapsed-state toolbar — when closed there is no Panel body to
          host the chevron, so we render a sibling toolbar that holds just
          the chevron. When open this is hidden and the toolbar is rendered
          INSIDE the body (below) so it scrolls with the table. */}
      {!open && (
        <div className="topo-tree__toolbar topo-tree__toolbar--rail">
          <button
            type="button"
            className="topo-tree__collapse-toggle"
            onClick={onChevronClick}
            title="Expand tree"
            aria-label="Expand tree"
            aria-expanded={false}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      )}

      {open && (
        // No title — Panel renders the help hexagon in floating mode,
        // and CSS pulls it down onto the toolbar row alongside the
        // chevron so the row reads as one control strip. The toolbar is
        // rendered as a SIBLING of (and BEFORE) the scroll body so it
        // stays pinned at the top of the panel; the admin row inside
        // the table scrolls away with the body content.
        <Panel name="tree" className="panel--bare topo-tree__panel">
          <div className="topo-tree__toolbar">
            <button
              type="button"
              className="topo-tree__collapse-toggle"
              onClick={onChevronClick}
              title="Collapse tree"
              aria-label="Collapse tree"
              aria-expanded={true}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
          <div className="topo-tree__body" ref={bodyRef}>
            {tree === null ? (
              <p className="topo-tree__empty">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="topo-tree__empty">No nodes yet.</p>
            ) : (
              <table className="table topo-tree-table">
                {/* Caption row — "Topology Tree Structure" + expand-all
                    toggle. Rendered FIRST so it scrolls away with the
                    body content; the toolbar below is sticky and stays
                    pinned at top when scrolling. */}
                <thead>
                  <tr className="topo-tree-table__admin-row">
                    <th
                      className="drag-handle-cell topo-tree-table__grip-cell topo-tree-table__admin-grip"
                      aria-hidden="true"
                    />
                    <th className="table__cell topo-tree-table__toggle-cell">
                      <span className="topo-tree-table__toggle-inner">
                        <button
                          type="button"
                          className="btn btn--icon btn--row-expander"
                          aria-label={allExpanded ? "Collapse all" : "Expand all"}
                          title={allExpanded ? "Collapse all" : "Expand all"}
                          onClick={() => (allExpanded ? onCollapseAll() : onExpandAll())}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={"topo-tree-table__expander-icon" + (allExpanded ? " topo-tree-table__expander-icon--open" : "")}
                            aria-hidden="true"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      </span>
                    </th>
                    <th className="table__cell topo-tree-table__actions-cell" aria-hidden="true" />
                    <th className="table__cell topo-tree-table__tag-cell topo-tree-table__admin-title">
                      Topology Tree Structure
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <TreeRow
                      key={row.node.id}
                      row={row}
                      selected={row.node.id === selectedId}
                      onToggle={() => onToggleCollapse(row.node.id)}
                      onSelect={() => onSelect(row.node.id)}
                      onActivate={() => onActivate(row.node.id)}
                      onOpenMenu={(x, y) => onOpenMenu(row.node.id, x, y)}
                      onOpenArchiveMap={() => onOpenArchiveMap(row.node.id, row.node.name)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      )}

      {open && (
        // Right-edge resize handle. Drag anywhere along its 10px column to
        // grow/shrink the flyout. The dots in the middle render as a
        // button-style affordance but the entire vertical strip is the
        // hit-target.
        <div
          className="topo-tree__resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize tree"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
        >
          <span className="topo-tree__resize-grip" aria-hidden="true">⋮</span>
        </div>
      )}

    </aside>
  );
}

function TreeRow({
  row,
  selected,
  onToggle,
  onSelect,
  onActivate,
  onOpenMenu,
  onOpenArchiveMap,
}: {
  row: FlattenedRow;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onActivate: () => void;
  onOpenMenu: (screenX: number, screenY: number) => void;
  onOpenArchiveMap: () => void;
}) {
  const { node, depth, hasChildren, collapsed: rowCollapsed, isFirst, isLast, hasVisibleChildren, ancestorMoreChildren } = row;
  const archivedDescendantCount = node.archived_descendant_count ?? 0;
  // Per-row colour drives both the swatch fill and the 5px left bar on
  // the drag-grip cell. Mirrors the canvas card: explicit `colour` wins,
  // otherwise hash to a stable palette colour so every node carries a
  // consistent accent without needing a manual colour assigned.
  const accent = node.colour || paletteColour(node.id);
  return (
    <tr
      className={`table__row topo-tree-table__row${selected ? " table__row--selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onActivate}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? !rowCollapsed : undefined}
      style={{ ["--node-accent" as string]: accent }}
    >
      {/* Drag-grip — placeholder; six-dot affordance for future reorder. */}
      <td
        className="drag-handle-cell topo-tree-table__grip-cell"
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="drag-handle" aria-hidden="true">⋮⋮</span>
      </td>

      {/* Expander — same column for every depth so chevrons line up. */}
      <td className="table__cell topo-tree-table__toggle-cell">
        <span className="topo-tree-table__toggle-inner">
          {hasChildren ? (
            <button
              type="button"
              className="btn btn--icon btn--row-expander"
              aria-label={rowCollapsed ? "Expand" : "Collapse"}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={"topo-tree-table__expander-icon" + (!rowCollapsed ? " topo-tree-table__expander-icon--open" : "")}
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ) : (
            <span className="btn btn--icon btn--row-expander" aria-hidden="true" />
          )}
        </span>
      </td>

      {/* Actions cell — moved BEFORE the tag cell so the warn + kebab
          buttons sit in a fixed-width column adjacent to the chevron and
          never get pushed off when the tag is long. The triangle only
          appears when the row's archived-descendant count is non-zero;
          the kebab is always present so every row carries the same row-
          menu affordance as the canvas card. */}
      <td
        className="table__cell topo-tree-table__actions-cell"
        onClick={(e) => e.stopPropagation()}
      >
        {archivedDescendantCount > 0 && (
          <button
            type="button"
            className="btn btn--icon btn--xs btn--ghost topo-tree-table__action-btn topo-tree-table__action-btn--warn"
            aria-label={`${archivedDescendantCount} archived descendant${archivedDescendantCount === 1 ? "" : "s"} — open archive map`}
            title={`${archivedDescendantCount} archived descendant${archivedDescendantCount === 1 ? "" : "s"}`}
            onClick={(e) => { e.stopPropagation(); onOpenArchiveMap(); }}
          >
            <TbAlertTriangle aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="btn btn--icon btn--xs btn--ghost topo-tree-table__action-btn"
          aria-label="Open menu"
          onClick={(e) => { e.stopPropagation(); onOpenMenu(e.clientX, e.clientY); }}
        >
          <TbDots aria-hidden="true" />
        </button>
      </td>

      {/* Tag cell — paints the tree spine (root-level vertical) and the
          per-row elbow / pass-through verticals so children visually
          connect to their parent. Logic mirrors work-items WorkItemRow. */}
      <td className="table__cell topo-tree-table__tag-cell">
        <div className="topo-tree-table__tag-inner">
          {depth === 0 && (() => {
            // Root spine: a 1px-wide SVG with overflow:visible draws
            // verticals at x=12 (where children's lineX lands) so the
            // spine flows continuously from one root row to the next.
            const H = ROW_H;
            const MID = H / 2;
            const X = 12;
            const STUB_GAP = 10;
            const paths: string[] = [];
            if (!isFirst) paths.push(`M${X} 0 L${X} ${MID - STUB_GAP}`);
            if (!isLast || hasVisibleChildren) paths.push(`M${X} ${MID + STUB_GAP} L${X} ${H}`);
            if (paths.length === 0) return null;
            return (
              <svg
                width={1}
                height={H}
                viewBox={`0 0 1 ${H}`}
                className="topo-tree-table__svg topo-tree-table__svg--root-spine"
                aria-hidden="true"
              >
                {paths.map((d, i) => (
                  <path key={`r${i}`} d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                ))}
              </svg>
            );
          })()}

          {depth > 0 && (() => {
            const H = ROW_H;
            const MID = H / 2;
            const W = depth * STEP;
            const lineX = (depth - 1) * STEP + STEP / 2;
            const childLineX = depth * STEP + STEP / 2;

            const throughPaths: string[] = [];
            const paths: string[] = [];

            // Pass-through verticals for EVERY ancestor that still has
            // siblings below this subtree — including the immediate parent.
            // The parent's vertical at our `lineX` is also drawn by our own
            // connector below, but the overlap is harmless (identical path)
            // and is essential when we render as └ (renderAsLast cuts the
            // own connector at MID; the through-line carries the parent's
            // spine the rest of the way down so the next ancestor sibling
            // visually connects).
            ancestorMoreChildren.forEach((cont, i) => {
              if (cont) {
                const x = i * STEP + STEP / 2;
                throughPaths.push(`M${x} 0 L${x} ${H}`);
              }
            });

            // Own connector. A last-sibling always renders as └ — the
            // parent's spine terminates at this row's MID regardless of
            // whether this row has its own children (those connect via the
            // independent child stub at `childLineX`, drawn below).
            // Non-last siblings render as ├ (vertical passes through).
            if (isLast) {
              paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
            } else {
              paths.push(`M${lineX} 0 L${lineX} ${H}`);
              paths.push(`M${lineX} ${MID} L${W} ${MID}`);
            }
            if (hasVisibleChildren) {
              paths.push(`M${childLineX} ${MID + 10} L${childLineX} ${H}`);
            }

            return (
              <svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                className="topo-tree-table__svg"
                aria-hidden="true"
              >
                {throughPaths.map((d, i) => (
                  <path key={`t${i}`} d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                ))}
                {paths.map((d, i) => (
                  <path key={`c${i}`} d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                ))}
              </svg>
            );
          })()}

          <span className="topo-tree-table__tag" title={node.name}>
            {/* Swatch fill comes from --node-accent on the row, same
                source as the 5px grip-cell bar — single source of truth
                so they always match. */}
            <span className="topo-tree-table__swatch" aria-hidden="true" />
            <span className="topo-tree-table__name">{node.name}</span>
          </span>
        </div>
      </td>
    </tr>
  );
}
