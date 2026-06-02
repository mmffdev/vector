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

import { useMemo } from "react";
import { useColumnManager } from "./useColumnManager";
import { useResourceRank } from "@/app/hooks/useResourceRank";
import { GridTreeHead } from "./Grid__Tree_Head";
import { GridTreeBranch } from "./Grid__Tree_Branch";
import type {
  GridColumn,
  GridDnD,
  GridLoadingStyle,
  SortState,
  TreeNode,
  UseTreeResult,
} from "./types";

export interface GridTreeProps<TRow> {
  /** The headless core, already constructed by the consumer via useTree(). */
  tree: UseTreeResult<TRow>;
  columns: GridColumn<TRow>[];
  defaultSort?: SortState | null;
  /** Stripe the open detail row. */
  loadingStyle?: GridLoadingStyle;
  /** Opt-in reparent DnD. */
  dnd?: GridDnD<TRow>;
  /** Per-row accent colour → left border via --row-accent. */
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

// Lead control tracks rendered before the user columns: [expand-all][drag].
// Width must match the header's lead cells so columns line up. Caret lives in
// the primary cell (Grid__Tree_Row), so the lead column here is just the drag grip
// when dnd is wired; otherwise nothing.
const DRAG_COL_PX = 28;

export function GridTree<TRow>(props: GridTreeProps<TRow>) {
  const {
    tree,
    columns,
    defaultSort,
    loadingStyle,
    dnd,
    accentOf,
    renderRowDetail,
    openDetailId,
    selectedId,
    onSelect,
    empty,
  } = props;

  const hasDnd = !!dnd;
  const leadWidths = useMemo(
    () => (hasDnd ? [DRAG_COL_PX] : []),
    [hasDnd],
  );

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

  const renderLeadControls = hasDnd
    ? (node: TreeNode<TRow>) => (
        <span
          className="grid__Tree_DragGrip"
          aria-hidden="true"
          {...rank.handleProps(node.id)}
        >
          ⋮⋮
        </span>
      )
    : undefined;

  return (
    <div className="grid" ref={cm.containerRef}>
      <GridTreeHead
        columns={columns}
        gridTemplateColumns={cm.gridTemplateColumns}
        getHeaderProps={cm.getHeaderProps}
        headerRowRef={cm.headerRowRef}
        primaryControl={expandAllControl}
        leadControls={
          hasDnd ? (
            <div className="grid__Tree_Head_Lead" role="columnheader" />
          ) : null
        }
      />

      <div className="grid__Tree_Rows" role="rowgroup">
        {tree.nodes.length === 0
          ? empty ?? null
          : tree.nodes.map((node) => (
              <GridTreeBranch
                key={node.id}
                node={node}
                columns={columns}
                gridTemplateColumns={cm.gridTemplateColumns}
                selectedId={selectedId}
                onSelect={onSelect}
                loadingStyle={loadingStyle}
                accentOf={accentOf}
                renderRowDetail={renderRowDetail}
                openDetailId={openDetailId}
                renderLeadControls={renderLeadControls}
                registerRowRef={cm.registerBodyRow}
              />
            ))}
      </div>
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
