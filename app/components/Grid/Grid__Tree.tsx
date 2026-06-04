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

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MdOutlineAddBox, MdOutlineIndeterminateCheckBox } from "react-icons/md";
import { useColumnManager } from "./useColumnManager";
import { useResourceRank } from "@/app/hooks/useResourceRank";
import { GridTreeHead } from "./Grid__Tree_Head";
import { GridTreeRow } from "./Grid__Tree_Row";
import { TREE_STEP } from "./Grid__Tree_Lines";
import { GridTreePagination } from "./Grid__Tree_Pagination";
import {
  GridTreeActionBar,
  type GridTreeActionBarConfig,
} from "./Grid__Tree_ActionBar";
import { GridTreeCog } from "./Grid__Tree_Cog";
import PrefixBlockStripes from "@/app/components/PrefixBlockStripes";
import {
  GridTreeStatsPanel,
  type GridTreeStatsPanelConfig,
} from "./Grid__Tree_StatsPanel";
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
  /** Optional stat band rendered between title and action bar. */
  statsPanel?: GridTreeStatsPanelConfig;
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
   * Opt-in per-row ID text — rendered as its OWN fixed-width lead track,
   * sitting AFTER cog and BEFORE the primary cell (so it lives in front of
   * the caret). Splits artefact identity from the type badge: the badge stays
   * in the primary cell, the ID text moves into this dedicated column.
   */
  rowIdText?: (row: TRow) => string;
  /** Click handler for the rowIdText link (e.g. open the row's edit form). */
  onRowIdClick?: (row: TRow) => void;
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
  /** Optional stable DOM anchor per row, e.g. scope-TA-1234. */
  rowAnchorOf?: (node: TreeNode<TRow>) => string;
  /** Empty-state node when there are zero roots. */
  empty?: React.ReactNode;
}

// Lead control tracks rendered before the user columns, in order:
// drag → type-stripe → selection → cog → idText. Each has a fixed px width
// that must match between the header lead cells and every row's lead cells so
// the CSS grid lines up. Drag sits first (the row-handle convention), and is
// sized 50% wider than the other compact controls to be an obvious grab
// target. The caret lives in the primary (first user) cell, not here.
const STRIPE_COL_PX = 10;
const SELECT_COL_PX = 28;
const DRAG_COL_PX = 42;
const COG_COL_PX = 32;
// Fixed-px track for the per-row ID text (13px light, matching row body
// text). MUST be a single shared px value so the header (its own CSS grid)
// and every body row (each its own CSS grid) line up — "max-content" sizes
// per-grid and de-aligns the header from the rows. 96px fits up to ~10 chars
// (e.g. "TA-1234567") with the lead cell's 8px side padding.
const ID_TEXT_COL_PX = 96;

export function GridTree<TRow>(props: GridTreeProps<TRow>) {
  const {
    title,
    subtitle,
    badge,
    actionBar,
    statsPanel,
    tree,
    columns,
    defaultSort,
    loadingStyle,
    dnd,
    selection,
    cogMenu,
    rowIdText,
    onRowIdClick,
    accentOf,
    renderRowDetail,
    openDetailId,
    selectedId,
    onSelect,
    rowAnchorOf,
    empty,
  } = props;

  const hasDnd = !!dnd;
  const accentFn: ((row: TRow) => string | null) | undefined = accentOf;
  const hasStripe = !!accentFn;
  const hasSelection = !!selection;
  const hasCog = !!cogMenu;
  const hasIdText = !!rowIdText;
  const dndRowIdOf = useCallback(
    (node: TreeNode<TRow>) => dnd?.rowIdOf?.(node.row) ?? node.id,
    [dnd],
  );

  // Our own handle on the .grid container — useColumnManager's containerRef is
  // a callback ref that doesn't expose the element, and the sticky-offset
  // measurement effect needs to read child heights off the DOM.
  const gridEl = useRef<HTMLDivElement | null>(null);

  // Which row's cog menu is open (single-open, OTV2 model).
  const [cogOpenId, setCogOpenId] = useState<string | null>(null);
  // Shift-click range anchor for selection.
  const lastSelectedRef = useRef<string | null>(null);

  // Lead-column widths in render order: drag → stripe → selection → cog →
  // idText. Only the enabled ones contribute a track; the render functions
  // below emit cells in the SAME order so widths and DOM align. Drag sits
  // first (the row-handle convention, oversized for grab affordance); idText
  // lives LAST so it sits directly before the primary cell (in front of the
  // caret), shrink-wrapped to its content via "max-content".
  const leadWidths = useMemo(() => {
    const w: number[] = [];
    if (hasDnd) w.push(DRAG_COL_PX);
    if (hasStripe) w.push(STRIPE_COL_PX);
    if (hasSelection) w.push(SELECT_COL_PX);
    if (hasCog) w.push(COG_COL_PX);
    if (hasIdText) w.push(ID_TEXT_COL_PX);
    return w;
  }, [hasStripe, hasSelection, hasDnd, hasCog, hasIdText]);

  // The primary (first) column hosts the indent SVG, so as rows nest deeper its
  // content needs more room or the id text clips. Grow the primary column's
  // width by the deepest visible indent (maxDepth × step) so it always fits.
  const maxDepth = useMemo(
    () => tree.flatNodes.reduce((m, n) => (n.depth > m ? n.depth : m), 0),
    [tree.flatNodes],
  );
  const indentAllowance = maxDepth * TREE_STEP;
  const columnsWithIndent = useMemo(() => {
    if (indentAllowance <= 0 || columns.length === 0) return columns;
    const [first, ...rest] = columns;
    // Only grow a FIXED-width primary column; if it's the flex column leave it.
    if (first.defaultWidth == null) return columns;
    return [
      { ...first, defaultWidth: first.defaultWidth + indentAllowance },
      ...rest,
    ];
  }, [columns, indentAllowance]);

  const cm = useColumnManager<TRow>({
    columns: columnsWithIndent,
    defaultSort,
    leadWidths,
  });

  const rank = useResourceRank({
    resourceType: dnd?.resourceType ?? "__noop__",
    onMoved: dnd?.onMoved,
    onError: dnd?.onError,
    canReparent: dnd?.canReparent,
    onReparent: dnd?.onReparent,
    getCandidateIds: dnd?.getCandidateIds,
    getDescendants: dnd
      ? (id) => {
          // getDescendants on dnd takes a row; resolve via the node tree.
          const node = tree.flatNodes.find((n) => dndRowIdOf(n) === id);
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
      data-expanded={tree.allExpanded}
      aria-label={tree.allExpanded ? "Collapse all" : "Expand all"}
      aria-pressed={tree.allExpanded}
      onClick={() => (tree.allExpanded ? tree.collapseAll() : tree.expandAll())}
    >
      {tree.allExpanded ? (
        <MdOutlineIndeterminateCheckBox
          className="grid__Tree_ExpandAllGlyph"
          aria-hidden="true"
        />
      ) : (
        <MdOutlineAddBox
          className="grid__Tree_ExpandAllGlyph"
          aria-hidden="true"
        />
      )}
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

  // Lead cells for one row, in render order: drag → stripe → selection → cog
  // → idText. Emitted only for enabled capabilities, matching leadWidths above.
  const renderLeadControls =
    hasStripe || hasSelection || hasDnd || hasCog || hasIdText
      ? (node: TreeNode<TRow>) => (
          <>
            {hasDnd && (
              <div className="grid__Tree_Lead" role="cell">
                <span
                  className="grid__Tree_DragGrip"
                  aria-hidden="true"
                  {...rank.handleProps(dndRowIdOf(node))}
                >
                  ⋮⋮
                </span>
              </div>
            )}
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
            {hasCog && (
              <GridTreeCog
                rowId={node.id}
                items={cogMenu!(node.row)}
                open={cogOpenId === node.id}
                onOpenChange={(o) => setCogOpenId(o ? node.id : null)}
              />
            )}
            {hasIdText && (
              <div
                className="grid__Tree_Lead grid__Tree_IdText"
                role="cell"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="grid__Cell_IdText grid__Cell_IdText--link"
                  aria-label={`Edit ${rowIdText!(node.row)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRowIdClick?.(node.row);
                  }}
                >
                  {rowIdText!(node.row)}
                </button>
              </div>
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
    hasStripe || hasSelection || hasDnd || hasCog || hasIdText ? (
      <>
        {hasDnd && (
          <div className="grid__Tree_Lead" role="columnheader" aria-hidden="true" />
        )}
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
        {hasCog && (
          <div className="grid__Tree_Lead" role="columnheader" aria-hidden="true" />
        )}
        {hasIdText && (
          <div
            className="grid__Tree_Lead grid__Tree_IdText"
            role="columnheader"
            aria-hidden="true"
          />
        )}
      </>
    ) : null;

  const hasTitle = title != null || subtitle != null || badge != null;

  // Keep the sticky-stack offsets exact. The stats band and the action band
  // are both sticky to the scroll container; the column head must stack below
  // both of them. Their pixel heights vary (button sizes, stats-grid wrap), so
  // measure them and publish the live heights as CSS vars on the container
  // rather than guessing a static offset. The head's `top` reads these.
  useLayoutEffect(() => {
    const container = gridEl.current;
    if (!container) return;
    const stats = container.querySelector<HTMLElement>(".grid__Tree_StatsPanel");
    const action = container.querySelector<HTMLElement>(".grid__Tree_ActionBar");
    const publish = () => {
      container.style.setProperty(
        "--grid-tree-stats-stick-h",
        `${stats?.offsetHeight ?? 0}px`,
      );
      container.style.setProperty(
        "--grid-tree-actionbar-stick-h",
        `${action?.offsetHeight ?? 0}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    if (stats) ro.observe(stats);
    if (action) ro.observe(action);
    return () => ro.disconnect();
  }, [statsPanel, actionBar]);

  return (
    <div
      className="grid"
      ref={(el) => {
        gridEl.current = el;
        cm.containerRef(el);
      }}
    >
      {hasTitle && (
        <div className="grid__Tree_Title">
          {badge != null && <PrefixBlockStripes />}
          <div className="grid__Tree_Title_Body">
            {title != null && (
              <h3 className="grid__Tree_Title_Heading">
                <span className="grid__Tree_Title_Heading_Filter">FILTER</span>{" "}
                {title}
              </h3>
            )}
            {subtitle != null && (
              <p className="grid__Tree_Title_Sub">{subtitle}</p>
            )}
          </div>
        </div>
      )}
      {statsPanel && <GridTreeStatsPanel {...statsPanel} />}
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
                !hasStripe || !accentFn
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
                    anchorId={rowAnchorOf?.(node)}
                    rankRowProps={hasDnd ? rank.rowProps(dndRowIdOf(node)) : undefined}
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
