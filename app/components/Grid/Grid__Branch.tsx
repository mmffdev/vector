"use client";

// Grid__Branch — the recursive tree-node renderer. THIS is where the
// connector bug is actually fixed.
//
// Each node renders as:
//
//   <div .grid__Branch>
//     <Grid__Row/>                         ← the node's own row
//     [renderRowDetail(node)]              ← optional flyout-below (extension)
//     <div .grid__Branch_Children>         ← only when expanded w/ children
//       <Grid__Branch/> * n                ← recursion
//     </div>
//   </div>
//
// The ├ / └ / through-line connectors are drawn ENTIRELY by CSS off this DOM
// shape (`.grid__Branch_Children > .grid__Branch::before` = elbow,
// `:not(:last-child)::after` = through-drop). There is NO depth, isLast, or
// continuations[] anywhere — :last-child + real nesting carry all of it. The
// detail/form node sits BETWEEN the row and _Children, inside this Branch, so
// it never becomes a `.grid__Branch_Children > .grid__Branch` and thus never
// grows an elbow or disturbs a sibling's :last-child.

import { memo } from "react";
import { GridRow } from "./Grid__Row";
import type { GridColumn, GridLoadingStyle, TreeNode } from "./types";

export interface GridBranchProps<TRow> {
  node: TreeNode<TRow>;
  columns: GridColumn<TRow>[];
  gridTemplateColumns: string;
  selectedId?: string | null;
  onSelect?: (node: TreeNode<TRow>) => void;
  loadingStyle?: GridLoadingStyle;
  accentOf?: (row: TRow) => string | null;
  /** Render a detail/form row BELOW this node's row (the extension seam). */
  renderRowDetail?: (node: TreeNode<TRow>) => React.ReactNode;
  /** Which node currently has its detail open (drives barber-pole + render). */
  openDetailId?: string | null;
  /** Lead controls (drag handle) for this specific row, if any. */
  renderLeadControls?: (node: TreeNode<TRow>) => React.ReactNode;
  registerRowRef?: (id: string, el: HTMLDivElement | null) => void;
}

function GridBranchInner<TRow>(props: GridBranchProps<TRow>) {
  const {
    node,
    columns,
    gridTemplateColumns,
    selectedId,
    onSelect,
    loadingStyle,
    accentOf,
    renderRowDetail,
    openDetailId,
    renderLeadControls,
    registerRowRef,
  } = props;

  const detailOpen = openDetailId === node.id;

  return (
    <div className="grid__Branch" role="presentation">
      <GridRow
        node={node}
        columns={columns}
        gridTemplateColumns={gridTemplateColumns}
        leadControls={renderLeadControls?.(node)}
        selected={selectedId === node.id}
        onSelect={onSelect}
        loadingStyle={loadingStyle}
        formOpen={detailOpen}
        accent={accentOf?.(node.row) ?? null}
        registerRowRef={registerRowRef}
      />

      {detailOpen && renderRowDetail ? (
        <div className="grid__Branch_Detail" role="presentation">
          {renderRowDetail(node)}
        </div>
      ) : null}

      {node.hasVisibleChildren ? (
        <div className="grid__Branch_Children" role="presentation">
          {node.children.map((child) => (
            <GridBranch
              key={child.id}
              {...props}
              node={child}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const GridBranch = memo(GridBranchInner) as typeof GridBranchInner;
