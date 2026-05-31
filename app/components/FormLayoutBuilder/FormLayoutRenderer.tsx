"use client";

// <FormLayoutRenderer> — the shared WYSIWYG grid. Both the builder and
// the runtime form render through this so the author sees exactly what
// the end user will (per the design spec, "same renderer → WYSIWYG").
//
// It is purely presentational about GEOMETRY. Adjacent rows that share a
// template form a BAND, rendered as ONE CSS grid (columns × sub-rows) so a
// vertically-merged cell (rowSpan > 1) can span sub-rows via `grid-row: span`.
// Tombstone cells (absorbedBy set) are skipped — the spanning cell covers
// their track. WHAT goes inside a cell is delegated to `renderCell`, so the
// builder puts a draggable chip / anchor there and the runtime puts a real
// field input — without either duplicating the grid maths. Vertical merge:
// docs/superpowers/specs/2026-05-31-flb-vertical-merge-design.md.
//
// CSS lives in app/globals.css under the `flb-*` namespace.

import React from "react";
import type { FormRow, FormCell } from "@/app/lib/formLayoutsApi";
import {
  bandsOf,
  isTombstone,
  effectiveRowSpan,
  seamsFor,
  type Band,
} from "./mergeTransitions";

export interface RenderCellArgs {
  row: FormRow;
  cell: FormCell;
  rowIndex: number;
  cellIndex: number;
}

// A seam join control: rendered at the bottom edge of the cell owning
// (rowIndex, colIndex), inviting a merge into the empty cell below.
export interface RenderSeamArgs {
  rowIndex: number;
  colIndex: number;
}

export interface FormLayoutRendererProps {
  rows: FormRow[];
  /** Renders the inner content of one cell (chip / anchor / field input). */
  renderCell: (args: RenderCellArgs) => React.ReactNode;
  /** Optional per-band trailing controls (builder: drag / delete, centred). */
  renderRowAside?: (band: Band, bandIndex: number) => React.ReactNode;
  /** Optional per-band leading gutter (builder: numbered row markers). */
  renderRowGutter?: (band: Band, bandIndex: number) => React.ReactNode;
  /** Optional join-handle renderer for a mergeable seam (builder only). */
  renderSeamJoin?: (args: RenderSeamArgs) => React.ReactNode;
  /** Optional gap renderer between bands (builder: insert-row / reorder drop
   *  target). Receives the rows[] index where an inserted row would land —
   *  i.e. the start of the band below the gap (or rows.length for the last). */
  renderRowGap?: (rowIndex: number) => React.ReactNode;
  /** Extra class on the root (e.g. flb-canvas vs flb-runtime). */
  className?: string;
}

export function FormLayoutRenderer({
  rows,
  renderCell,
  renderRowAside,
  renderRowGutter,
  renderSeamJoin,
  renderRowGap,
  className,
}: FormLayoutRendererProps) {
  const bands = bandsOf(rows);
  // Mergeable seams keyed "rowIndex:colIndex" for O(1) lookup while placing.
  const seamSet = React.useMemo(() => {
    if (!renderSeamJoin) return null;
    const s = new Set<string>();
    for (const seam of seamsFor(rows)) s.add(`${seam.rowIndex}:${seam.colIndex}`);
    return s;
  }, [rows, renderSeamJoin]);

  return (
    <div className={"flb-grid" + (className ? " " + className : "")}>
      {renderRowGap && <React.Fragment key="gap-0">{renderRowGap(0)}</React.Fragment>}
      {bands.map((band, bandIndex) => (
       <React.Fragment key={band.rows[0].id}>
        <div className="flb-grid__Band" data-template={band.rows[0].template}>
          {renderRowGutter && (
            <div className="flb-grid__Band_Gutter">{renderRowGutter(band, bandIndex)}</div>
          )}
          <div
            className="flb-grid__Band_Cells"
            style={bandGridStyle(band)}
            data-subrows={band.subRowCount}
          >
            {band.rows.map((row, localRow) =>
              row.cells.map((cell, cellIndex) => {
                if (isTombstone(cell)) return null; // covered by the spanning cell above
                const rowIndex = band.startRow + localRow;
                const span = effectiveRowSpan(cell);
                const showSeam =
                  seamSet?.has(`${rowIndex}:${cellIndex}`) ?? false;
                return (
                  <div
                    key={cell.id}
                    className="flb-grid__Cell"
                    data-filled={cell.fieldKey ? "true" : "false"}
                    data-tall={span > 1 ? "true" : "false"}
                    style={{
                      gridColumn: `${cellIndex + 1} / span 1`,
                      gridRow: `${localRow + 1} / span ${span}`,
                    }}
                  >
                    {renderCell({ row, cell, rowIndex, cellIndex })}
                    {showSeam && renderSeamJoin && (
                      <div className="flb-grid__Seam">
                        {renderSeamJoin({ rowIndex, colIndex: cellIndex })}
                      </div>
                    )}
                  </div>
                );
              }),
            )}
          </div>
          {renderRowAside && (
            <div className="flb-grid__Band_Aside">{renderRowAside(band, bandIndex)}</div>
          )}
        </div>
        {renderRowGap && (
          <React.Fragment key={`gap-${band.startRow + band.subRowCount}`}>
            {renderRowGap(band.startRow + band.subRowCount)}
          </React.Fragment>
        )}
       </React.Fragment>
      ))}
    </div>
  );
}

// bandGridStyle turns a band into a CSS grid: column tracks from the shared
// template spans (fr units preserve the ratio responsively) and one row track
// per sub-row. A spanning cell's `grid-row` then covers multiple tracks.
function bandGridStyle(band: Band): React.CSSProperties {
  const cols = band.rows[0].cells.map((c) => `${c.span}fr`).join(" ");
  return {
    gridTemplateColumns: cols,
    gridTemplateRows: `repeat(${band.subRowCount}, minmax(72px, auto))`,
  };
}
