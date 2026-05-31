"use client";

// Grid__Head — the column header band of the canonical skin.
//
// Consumes useColumnManager.getHeaderProps for sort + resize wiring; renders
// the expand-all / collapse-all control in the lead column when the tree is
// expandable. The header shares the SAME gridTemplateColumns as every body
// row (lead control tracks + user columns), so columns line up exactly and
// the live drag-resize (which mutates gridTemplateColumns on header + rows via
// refs) keeps them locked together.

import type { GridColumn, SortDir } from "./types";
import type { HeaderProps } from "./useColumnManager";

export interface GridHeadProps<TRow> {
  columns: GridColumn<TRow>[];
  gridTemplateColumns: string;
  getHeaderProps: (col: GridColumn<TRow>) => HeaderProps;
  headerRowRef: (el: HTMLDivElement | null) => void;
  /** Lead control header cells — one per leadWidths track (drag column). */
  leadControls?: React.ReactNode;
  /**
   * Control rendered INSIDE the primary (first) column header, before its
   * label — sits at the same x as the row carets so the expand-all toggle
   * aligns with the per-row carets it mirrors. Not a track of its own.
   */
  primaryControl?: React.ReactNode;
}

function sortGlyph(dir: SortDir | undefined): string {
  if (dir === "asc") return "▲";
  if (dir === "desc") return "▼";
  return "";
}

export function GridHead<TRow>({
  columns,
  gridTemplateColumns,
  getHeaderProps,
  headerRowRef,
  leadControls,
  primaryControl,
}: GridHeadProps<TRow>) {
  return (
    <div
      ref={headerRowRef}
      className="grid__Head"
      style={{ gridTemplateColumns }}
      role="row"
    >
      {leadControls}
      {columns.map((col, i) => {
        const hp = getHeaderProps(col);
        return (
          <div
            key={col.id}
            className="grid__Head_Cell"
            role="columnheader"
            data-sort={hp["data-sort"]}
            data-sortable={hp["data-sortable"]}
            aria-sort={
              hp["data-sort"] === "asc"
                ? "ascending"
                : hp["data-sort"] === "desc"
                  ? "descending"
                  : undefined
            }
          >
            {i === 0 && primaryControl ? primaryControl : null}
            <button
              type="button"
              className="grid__Head_Label"
              onClick={hp.onClick}
              disabled={!hp["data-sortable"]}
            >
              {col.renderHeader ? col.renderHeader() : col.label}
              {hp["data-sort"] ? (
                <span className="grid__Head_SortGlyph" aria-hidden="true">
                  {sortGlyph(hp["data-sort"])}
                </span>
              ) : null}
            </button>
            {hp["data-resizable"] ? (
              <span
                className="grid__Head_Resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${col.label}`}
                onMouseDown={hp.onResizeMouseDown}
                onDoubleClick={hp.onDoubleClick}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
