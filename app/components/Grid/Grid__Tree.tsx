"use client";

// Grid__Tree — the CANONICAL SKIN. It owns the look; useTree owns the
// behaviour. This is the single place the tree's appearance is defined; every
// extension (expandable-flyout today, more later) inherits this look by
// composing the primitive's rows, never by re-styling. Change a connector
// constant in CSS here → every consumer changes, no JS edit (the NCY proof).
//
// What it wires:
//   • useColumnManager  → the shared gridTemplateColumns (header + every row),
//                         drag-resize, sort.
//   • Grid__Tree_Head        → labels / sort / resize gutters / expand-all control.
//   • Grid__Tree_Branch * n  → the recursive body; CSS draws the ├ └ connectors off
//                         its DOM nesting (no JS geometry — the bug fix).
//
// Props are CAPABILITIES, never restyling hooks:
//   • loadingStyle="barberpole" → the form-open row paints the diagonal stripe
//     (grid__Tree_Row--formOpen). There is NO Grid__BarberPole component.
//   • dnd                       → opt-in reparent via useResourceRank.
//   • renderRowDetail           → the extension seam: a node renders a flyout
//     (e.g. ArtefactInlineForm) BELOW its own row. openDetailId drives which.
//   • accentOf                  → per-row colour accent (left border).

import { useMemo, useRef, useState } from "react";
import { useColumnManager } from "./useColumnManager";
import { useResourceRank } from "@/app/hooks/useResourceRank";
import { GridTreeHead } from "./Grid__Tree_Head";
import { GridTreeRow } from "./Grid__Tree_Row";
import { GridTreePagination } from "./Grid__Tree_Pagination";
import {
  GridTreeActionBar,
  type GridTreeActionBarConfig,
} from "./Grid__Tree_ActionBar";
import { GridTreeCog } from "./Grid__Tree_Cog";
import type {
  GridColumn,
  GridDnD,
  GridLoadingStyle,
  GridMenuItem,
  GridSelection,
  SortState,
  TreeNode,
  UseTreeResult,
} from "./types";

export interface GridTreeProps<TRow> {
  /**
   * The tree's own title (the data-view identity, e.g. "Tree"). Rendered in
   * the Grid__Tree_Title band, above the column head — the tree owns its own
   * title space; the frame (DataContainer) owns only the page title.
   */
  title?: string;
  /** Sub-line under the tree title (e.g. how parentage is resolved). */
  subtitle?: string;
  /** Optional badge block (the OTV2 num block) shown left of the title. */
  badge?: string;
  /**
   * Action band (search + create-new radial + filter slot), rendered between
   * the title and the column head. Omit → no action bar.
   */
  actionBar?: GridTreeActionBarConfig;
  /** The headless core, already constructed by the consumer via useTree(). */
  tree: UseTreeResult<TRow>;
  columns: GridColumn<TRow>[];
  defaultSort?: SortState | null;
  /** Stripe the open detail row. */
  loadingStyle?: GridLoadingStyle;
  /** Opt-in reparent DnD. */
  dnd?: GridDnD<TRow>;
  /** Opt-in multi-select checkbox column (consumer owns the Set). */
  selection?: GridSelection;
  /** Opt-in per-row cog menu — returns the action items for a row. */
  cogMenu?: (row: TRow) => GridMenuItem[];
  /**
   * Per-row accent colour. Painted as the 10px type-stripe lead cell (OTV2
   * parity). Falls back to the row's left border when no stripe column shows.
   */
  accentOf?: (row: TRow) => string | null;
  /** Extension seam: render a flyout/detail row below the given node. */
  renderRowDetail?: (node: TreeNode<TRow>) => React.ReactNode;
  /** Which node currently has its detail open. */
  openDetailId?: string | null;
  selectedId?: string | null;
  onSelect?: (node: TreeNode<TRow>) => void;
  /** Empty-state node when there are zero roots. */
  empty?: React.ReactNode;
}

// Lead control tracks rendered before the user columns, in OTV2 order:
// type-stripe → selection → drag → cog. Each has a fixed px width that must
// match between the header lead cells and every row's lead cells so the CSS
// grid lines up. The caret lives in the primary (first user) cell, not here.
const STRIPE_COL_PX = 10;
const SELECT_COL_PX = 28;
const DRAG_COL_PX = 28;
const COG_COL_PX = 32;

export function GridTree<TRow>(props: GridTreeProps<TRow>) {
  const {
    title,
    subtitle,
    badge,
    actionBar,
    tree,
    columns,
    defaultSort,
    loadingStyle,
    dnd,
    selection,
    cogMenu,
    accentOf,
    renderRowDetail,
    openDetailId,
    selectedId,
    onSelect,
    empty,
  } = props;

  const hasDnd = !!dnd;
  const accentFn: ((row: TRow) => string | null) | undefined = accentOf;
  const hasStripe = !!accentFn;
  const hasSelection = !!selection;
  const hasCog = !!cogMenu;

  // Which row's cog menu is open (single-open, OTV2 model).
  const [cogOpenId, setCogOpenId] = useState<string | null>(null);
  // Shift-click range anchor for selection.
  const lastSelectedRef = useRef<string | null>(null);

  // Lead-column widths in render order: stripe → selection → drag → cog. Only
  // the enabled ones contribute a track; the render functions below emit cells
  // in the SAME order so widths and DOM align.
  const leadWidths = useMemo(() => {
    const w: number[] = [];
    if (hasStripe) w.push(STRIPE_COL_PX);
    if (hasSelection) w.push(SELECT_COL_PX);
    if (hasDnd) w.push(DRAG_COL_PX);
    if (hasCog) w.push(COG_COL_PX);
    return w;
  }, [hasStripe, hasSelection, hasDnd, hasCog]);

  const cm = useColumnManager<TRow>({ columns, defaultSort, leadWidths });

  const rank = useResourceRank({
    resourceType: dnd?.resourceType ?? "__noop__",
    canReparent: dnd?.canReparent,
    onReparent: dnd?.onReparent,
    getCandidateIds: dnd?.getCandidateIds,
    getDescendants: dnd
      ? (id) => {
          // getDescendants on dnd takes a row; resolve via the node tree.
          const node = findNode(tree.nodes, id);
          return node && dnd.getDescendants ? dnd.getDescendants(node.row) : [];
        }
      : undefined,
  });

  // Expand-all toggle — rendered inside the primary column header (not a track)
  // so it sits at the same x as the per-row carets it mirrors.
  const expandAllControl = (
    <button
      type="button"
      className="grid__Tree_ExpandAll"
      aria-label={tree.allExpanded ? "Collapse all" : "Expand all"}
      aria-pressed={tree.allExpanded}
      onClick={() => (tree.allExpanded ? tree.collapseAll() : tree.expandAll())}
    >
      <span className="grid__Tree_ExpandAllGlyph" aria-hidden="true">
        {tree.allExpanded ? "▾" : "▸"}
      </span>
    </button>
  );

  // Visible row ids in render order — selection shift-click range + the header
  // select-all operate over these (flattened from the nested node tree).
  const visibleIds = useMemo(() => {
    const acc: string[] = [];
    const walk = (nodes: TreeNode<TRow>[]) => {
      for (const n of nodes) {
        acc.push(n.id);
        if (n.children.length) walk(n.children);
      }
    };
    walk(tree.nodes);
    return acc;
  }, [tree.nodes]);

  const toggleRowSelection = (id: string, e: React.MouseEvent) => {
    if (!selection) return;
    e.stopPropagation();
    const next = new Set(selection.selectedIds);
    const anchor = lastSelectedRef.current;
    if (e.shiftKey && anchor && anchor !== id) {
      const a = visibleIds.indexOf(anchor);
      const b = visibleIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(visibleIds[i]);
      }
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastSelectedRef.current = id;
    }
    selection.onSelectionChange(next);
  };

  // Lead cells for one row, in OTV2 order: stripe → selection → drag → cog.
  // Emitted only for enabled capabilities, matching leadWidths above.
  const renderLeadControls =
    hasStripe || hasSelection || hasDnd || hasCog
      ? (node: TreeNode<TRow>) => (
          <>
            {hasStripe && (
              <div className="grid__Tree_Lead" role="cell" aria-hidden="true">
                <span
                  className="grid__Tree_Stripe"
                  style={
                    {
                      ["--row-accent" as string]:
                        accentOf?.(node.row) ?? "transparent",
                    } as React.CSSProperties
                  }
                />
              </div>
            )}
            {hasSelection && (
              <div
                className="grid__Tree_Lead grid__Tree_Select"
                role="cell"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selection!.selectedIds.has(node.id)}
                  onChange={() => undefined}
                  onClick={(e) => toggleRowSelection(node.id, e)}
                  aria-label="Select row"
                />
              </div>
            )}
            {hasDnd && (
              <div className="grid__Tree_Lead" role="cell">
                <span
                  className="grid__Tree_DragGrip"
                  aria-hidden="true"
                  {...rank.handleProps(node.id)}
                >
                  ⋮⋮
                </span>
              </div>
            )}
            {hasCog && (
              <GridTreeCog
                rowId={node.id}
                items={cogMenu!(node.row)}
                open={cogOpenId === node.id}
                onOpenChange={(o) => setCogOpenId(o ? node.id : null)}
              />
            )}
          </>
        )
      : undefined;

  // Header lead cells — same order + widths, so the column tracks line up.
  const allVisibleSelected =
    hasSelection &&
    visibleIds.length > 0 &&
    visibleIds.every((id) => selection!.selectedIds.has(id));
  const someVisibleSelected =
    hasSelection && visibleIds.some((id) => selection!.selectedIds.has(id));
  const headerIndeterminate = !allVisibleSelected && someVisibleSelected;

  const toggleSelectAll = () => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (allVisibleSelected) for (const id of visibleIds) next.delete(id);
    else for (const id of visibleIds) next.add(id);
    selection.onSelectionChange(next);
  };

  const headerLeadControls =
    hasStripe || hasSelection || hasDnd || hasCog ? (
      <>
        {hasStripe && (
          <div className="grid__Tree_Lead" role="columnheader" aria-hidden="true" />
        )}
        {hasSelection && (
          <div className="grid__Tree_Lead grid__Tree_Select" role="columnheader">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = headerIndeterminate;
              }}
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              aria-label="Select all visible rows"
            />
          </div>
        )}
        {hasDnd && (
          <div className="grid__Tree_Lead" role="columnheader" aria-hidden="true" />
        )}
        {hasCog && (
          <div className="grid__Tree_Lead" role="columnheader" aria-hidden="true" />
        )}
      </>
    ) : null;

  const hasTitle = title != null || subtitle != null || badge != null;

  return (
    <div className="grid" ref={cm.containerRef}>
      {hasTitle && (
        <div className="grid__Tree_Title">
          {badge != null && (
            <span className="grid__Tree_Title_Badge" aria-hidden="true">
              {badge}
            </span>
          )}
          <div className="grid__Tree_Title_Body">
            {title != null && (
              <h3 className="grid__Tree_Title_Heading">{title}</h3>
            )}
            {subtitle != null && (
              <p className="grid__Tree_Title_Sub">{subtitle}</p>
            )}
          </div>
        </div>
      )}
      {actionBar && <GridTreeActionBar {...actionBar} />}
      <GridTreeHead
        columns={columns}
        gridTemplateColumns={cm.gridTemplateColumns}
        getHeaderProps={cm.getHeaderProps}
        headerRowRef={cm.headerRowRef}
        primaryControl={expandAllControl}
        leadControls={headerLeadControls}
      />

      <div className="grid__Tree_Rows" role="rowgroup">
        {tree.flatNodes.length === 0
          ? empty ?? null
          : tree.flatNodes.map((node) => {
              const detailOpen = openDetailId === node.id;
              // The cast works around a TS flow-narrowing quirk inside this
              // map closure (the generic memo()-cast on GridTreeRow confuses
              // control-flow analysis so accentFn reads as non-callable even
              // after the `&& accentFn` guard). Logic is guarded; runtime safe.
              const rowAccent: string | null =
                hasStripe || !accentFn
                  ? null
                  : (accentFn as (r: TRow) => string | null)(node.row);
              return (
                <div className="grid__Tree_RowGroup" key={node.id} role="presentation">
                  <GridTreeRow
                    node={node}
                    columns={columns}
                    gridTemplateColumns={cm.gridTemplateColumns}
                    leadControls={renderLeadControls?.(node)}
                    selected={selectedId === node.id}
                    onSelect={onSelect}
                    loadingStyle={loadingStyle}
                    formOpen={detailOpen}
                    accent={rowAccent}
                    registerRowRef={cm.registerBodyRow}
                  />
                  {detailOpen && renderRowDetail ? (
                    <div className="grid__Tree_Branch_Detail" role="presentation">
                      {renderRowDetail(node)}
                    </div>
                  ) : null}
                </div>
              );
            })}
      </div>

      <GridTreePagination tree={tree} />
    </div>
  );
}

function findNode<TRow>(
  nodes: TreeNode<TRow>[],
  id: string,
): TreeNode<TRow> | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}
