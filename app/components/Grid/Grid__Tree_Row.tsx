"use client";

// Grid__Tree_Row — one rendered data row of the canonical skin.
//
// A pure presentation component: a CSS-grid row sharing the column template
// supplied by useColumnManager (via gridTemplateColumns), with a caret in the
// PRIMARY cell (column index 0) when the node can expand. Colour accent is a
// left border driven by the --row-accent custom property (runtime value →
// custom property, per the CSS rule). loadingStyle="barberpole" adds the
// form-open stripe modifier.
//
// It owns NO tree logic — expansion is node.toggle(), state is node.expanded.
// The skin (Grid__Tree) decides which rows render; this just paints one.

import { memo } from "react";
import type { HTMLAttributes } from "react";
import { GridTreeLines } from "./Grid__Tree_Lines";
import type { GridColumn, GridLoadingStyle, TreeNode } from "./types";

export interface GridTreeRowProps<TRow> {
  node: TreeNode<TRow>;
  columns: GridColumn<TRow>[];
  gridTemplateColumns: string;
  /** Lead control tracks rendered before the user columns (caret / drag). */
  leadControls?: React.ReactNode;
  selected?: boolean;
  onSelect?: (node: TreeNode<TRow>) => void;
  /** Stripe the row when its detail/form is open (the barber-pole prop). */
  loadingStyle?: GridLoadingStyle;
  formOpen?: boolean;
  /** Per-row accent colour → drawn as the left border via --row-accent. */
  accent?: string | null;
  /** Stable DOM anchor for deep-linking / scroll-to-row behaviours. */
  anchorId?: string;
  /** Drag/drop row props from useResourceRank; merged onto the row root. */
  rankRowProps?: HTMLAttributes<HTMLDivElement> & {
    "data-rank-row-id"?: string;
  };
  registerRowRef?: (id: string, el: HTMLDivElement | null) => void;
}

function GridTreeRowInner<TRow>({
  node,
  columns,
  gridTemplateColumns,
  leadControls,
  selected,
  onSelect,
  loadingStyle,
  formOpen,
  accent,
  anchorId,
  rankRowProps,
  registerRowRef,
}: GridTreeRowProps<TRow>) {
  const stripe = loadingStyle === "barberpole" && formOpen;
  const cls = [
    "grid__Tree_Row",
    rankRowProps?.className ?? "",
    selected ? "grid__Tree_Row--selected" : "",
    stripe ? "grid__Tree_Row--formOpen" : "",
    node.hasChildren ? "grid__Tree_Row--parent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      {...rankRowProps}
      id={anchorId}
      ref={registerRowRef ? (el) => registerRowRef(node.id, el) : undefined}
      className={cls}
      style={
        {
          gridTemplateColumns,
          ...(accent ? { ["--row-accent" as string]: accent } : {}),
        } as React.CSSProperties
      }
      data-row-id={node.id}
      data-row-anchor={anchorId}
      role="row"
      onClick={onSelect ? () => onSelect(node) : undefined}
    >
      {leadControls}
      {columns.map((col, i) => (
        <div
          className={
            i === 0 ? "grid__Tree_Cell grid__Tree_Cell--primary" : "grid__Tree_Cell"
          }
          role="cell"
          key={col.id}
        >
          {i === 0 ? (
            // Primary cell — the ONLY place that indents. The TreeLines SVG
            // (width = depth × step) provides the indent + ├└│ rails; the caret
            // sits right after it. Lead columns are outside this cell, so they
            // never shift with depth (ResourceTree model).
            <>
              <GridTreeLines
                depth={node.depth}
                isLast={node.isLast}
                hasVisibleChildren={node.hasVisibleChildren}
                continuations={node.continuations}
              />
              {node.hasChildren ? (
                <button
                  type="button"
                  className="grid__Tree_Caret"
                  data-expanded={node.expanded}
                  aria-label={node.expanded ? "Collapse" : "Expand"}
                  aria-expanded={node.expanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    node.toggle();
                  }}
                >
                  <span className="grid__Tree_CaretGlyph" aria-hidden="true" />
                </button>
              ) : (
                <span className="grid__Tree_CaretSpacer" aria-hidden="true" />
              )}
            </>
          ) : null}
          {col.renderCell
            ? col.renderCell(node.row, i === 0 ? node : undefined)
            : null}
        </div>
      ))}
    </div>
  );
}

export const GridTreeRow = memo(GridTreeRowInner) as typeof GridTreeRowInner;
