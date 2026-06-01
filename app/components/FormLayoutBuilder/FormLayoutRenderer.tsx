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
import { TEMPLATE_SPANS } from "@/app/lib/formLayoutsApi";
import {
  bandsOf,
  isTombstone,
  effectiveRowSpan,
  effectiveColSpan,
  seamsFor,
  hSeamsFor,
  poleEdgesFor,
  mergeGroupsOf,
  type Band,
  type MergeGroup,
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
  /** Optional PER-GROUP trailing controls (builder: drag / delete). A merge
   *  group (consecutive rows tied by a vertical merge) gets ONE aside spanning
   *  its rows, centred — so the group drags/deletes as a unit and can't be
   *  fractured. Unmerged rows are singleton groups. */
  renderRowAside?: (group: MergeGroup) => React.ReactNode;
  /** Optional PER-ROW leading gutter (builder: numbered row marker), aligned to
   *  the row's track. Receives the absolute rows[] index. */
  renderRowGutter?: (rowIndex: number) => React.ReactNode;
  /** Optional join-handle renderer for a VERTICAL mergeable seam (builder). */
  renderSeamJoin?: (args: RenderSeamArgs) => React.ReactNode;
  /** Optional join-handle renderer for a HORIZONTAL mergeable seam (builder).
   *  Rendered on the right edge of the cell owning (rowIndex, colIndex). */
  renderHSeamJoin?: (args: RenderSeamArgs) => React.ReactNode;
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
  renderHSeamJoin,
  renderRowGap,
  className,
}: FormLayoutRendererProps) {
  const bands = bandsOf(rows);
  // Merge groups (consecutive rows tied by a vertical merge) — drive the
  // per-group drag/delete aside. A group never crosses a band (a merge can't
  // cross a template change), so each group lies fully within one band.
  const groups = React.useMemo(() => mergeGroupsOf(rows), [rows]);
  // Vertical mergeable seams keyed "rowIndex:colIndex" for O(1) lookup. The join
  // HANDLE appears wherever a valid edge-merge exists — the SAME raw set the
  // barber poles use (2026-06-01: handles and poles must agree; every valid
  // merge on any of a cell's 4 edges is offered). The old "dominant" filter is
  // retired here because it hid valid merge handles while their poles still
  // showed (e.g. a tall filled cell beside a wide empty cell).
  const seamSet = React.useMemo(() => {
    if (!renderSeamJoin) return null;
    const s = new Set<string>();
    for (const seam of seamsFor(rows)) s.add(`${seam.rowIndex}:${seam.colIndex}`);
    return s;
  }, [rows, renderSeamJoin]);
  // Horizontal mergeable seams keyed "rowIndex:colIndex" (the LEFT cell) — raw
  // set, same as the poles (see seamSet above).
  const hSeamSet = React.useMemo(() => {
    if (!renderHSeamJoin) return null;
    const s = new Set<string>();
    for (const seam of hSeamsFor(rows)) s.add(`${seam.rowIndex}:${seam.colIndex}`);
    return s;
  }, [rows, renderHSeamJoin]);
  // Barber-pole edges: every mergeable boundary draws a stripe on BOTH cells it
  // joins (the RAW seam sets, not the dominant glyph set). Builder-only — gated
  // on a seam renderer being present, same as the join handles. Keyed
  // "rowIndex:cellIndex" → the edges that cell shows. Perimeter suppression is
  // applied per-cell below (the renderer knows the band geometry).
  const poleEdges = React.useMemo(() => {
    if (!renderSeamJoin && !renderHSeamJoin) return null;
    return poleEdgesFor(rows);
  }, [rows, renderSeamJoin, renderHSeamJoin]);

  return (
    <div className={"flb-grid" + (className ? " " + className : "")}>
      {renderRowGap && <React.Fragment key="gap-0">{renderRowGap(0)}</React.Fragment>}
      {bands.map((band) => {
        // All three sub-grids (gutter | cells | aside) share the SAME row-track
        // template so a per-row number / handle lines up exactly with its row,
        // and a merged cell spans tracks without knocking neighbours out of
        // alignment. One grid for the whole same-template run = columns always
        // align (no inter-band gaps).
        const rowTracks = `repeat(${band.subRowCount}, minmax(72px, auto))`;
        return (
         <React.Fragment key={band.rows[0].id}>
          <div className="flb-grid__Band" data-template={band.rows[0].template}>
            {renderRowGutter && (
              <div
                className="flb-grid__Band_Gutter"
                style={{ display: "grid", gridTemplateRows: rowTracks }}
              >
                {band.rows.map((row, localRow) => (
                  <div key={row.id} className="flb-grid__Band_Gutter_Cell" style={{ gridRow: `${localRow + 1}` }}>
                    {renderRowGutter(band.startRow + localRow)}
                  </div>
                ))}
              </div>
            )}
            <div
              className="flb-grid__Band_Cells"
              style={{
                gridTemplateColumns: bandColumnTracks(band),
                gridTemplateRows: rowTracks,
              }}
              data-subrows={band.subRowCount}
            >
              {band.rows.map((row, localRow) =>
                row.cells.map((cell, cellIndex) => {
                  if (isTombstone(cell)) return null; // covered by a spanning cell (V or H)
                  const rowIndex = band.startRow + localRow;
                  const span = effectiveRowSpan(cell);
                  const colSpan = effectiveColSpan(cell);
                  // A seam sits at the cell's BOTTOM edge. For a tall cell that
                  // edge is at row (rowIndex + span - 1) — which is a tombstone
                  // position that doesn't render its own wrapper. So look up the
                  // seam by the cell's bottom row, and render it from THIS (the
                  // owner) wrapper, whose bottom edge is exactly there.
                  const bottomRow = rowIndex + span - 1;
                  const showSeam = seamSet?.has(`${bottomRow}:${cellIndex}`) ?? false;
                  // Horizontal seam sits at the cell's RIGHT edge.
                  const rightCol = cellIndex + colSpan - 1;
                  const showHSeam = hSeamSet?.has(`${rowIndex}:${rightCol}`) ?? false;
                  // Barber-pole edges for this cell, with GRID-PERIMETER
                  // suppression: a first-column cell never poles LEFT, a
                  // last-column never poles RIGHT, the top row never poles TOP,
                  // the bottom row never poles BOTTOM (spec hard rules). The
                  // renderer is the only place that knows the band column count +
                  // the layout's top/bottom rows, so suppression lives here.
                  const cellPoles = poleEdges?.get(`${rowIndex}:${cellIndex}`);
                  const lastCol = row.cells.length - 1;
                  const isTopRow = rowIndex === 0;
                  const isBottomRow = bottomRow === rows.length - 1;
                  const poleTop = !!cellPoles?.has("top") && !isTopRow;
                  const poleBottom = !!cellPoles?.has("bottom") && !isBottomRow;
                  const poleLeft = !!cellPoles?.has("left") && cellIndex !== 0;
                  const poleRight = !!cellPoles?.has("right") && rightCol !== lastCol;
                  return (
                    <div
                      key={cell.id}
                      className="flb-grid__Cell"
                      data-filled={cell.fieldKey ? "true" : "false"}
                      data-tall={span > 1 ? "true" : "false"}
                      data-wide={colSpan > 1 ? "true" : "false"}
                      data-pole-top={poleTop ? "true" : undefined}
                      data-pole-bottom={poleBottom ? "true" : undefined}
                      data-pole-left={poleLeft ? "true" : undefined}
                      data-pole-right={poleRight ? "true" : undefined}
                      style={{
                        gridColumn: `${cellIndex + 1} / span ${colSpan}`,
                        gridRow: `${localRow + 1} / span ${span}`,
                      }}
                    >
                      {renderCell({ row, cell, rowIndex, cellIndex })}
                      {showHSeam && renderHSeamJoin && (
                        <div className="flb-grid__HSeam">
                          {renderHSeamJoin({ rowIndex, colIndex: rightCol })}
                        </div>
                      )}
                      {showSeam && renderSeamJoin && (
                        <div className="flb-grid__Seam">
                          {renderSeamJoin({ rowIndex: bottomRow, colIndex: cellIndex })}
                        </div>
                      )}
                    </div>
                  );
                }),
              )}
            </div>
            {renderRowAside && (
              <div
                className="flb-grid__Band_Aside"
                style={{ display: "grid", gridTemplateRows: rowTracks }}
              >
                {groups
                  .filter((g) => g.startRow >= band.startRow && g.startRow < band.startRow + band.subRowCount)
                  .map((g) => {
                    const localStart = g.startRow - band.startRow;
                    return (
                      <div
                        key={`grp-${g.startRow}`}
                        className="flb-grid__Band_Aside_Cell"
                        style={{ gridRow: `${localStart + 1} / span ${g.count}` }}
                      >
                        {renderRowAside(g)}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
          {renderRowGap && (
            <React.Fragment key={`gap-${band.startRow + band.subRowCount}`}>
              {renderRowGap(band.startRow + band.subRowCount)}
            </React.Fragment>
          )}
         </React.Fragment>
        );
      })}
    </div>
  );
}

// bandColumnTracks derives the band's column tracks from the CANONICAL template
// spans (not row[0]'s cells, which a horizontal merge may have widened). Fixed
// tracks mean a horizontally-merged cell just spans tracks via grid-column —
// keeping every row's columns aligned. Falls back to the row's own spans if the
// template isn't in the table (defensive).
function bandColumnTracks(band: Band): string {
  const tmplSpans = TEMPLATE_SPANS[band.rows[0].template];
  const spans = tmplSpans ?? band.rows[0].cells.map((c) => c.span);
  return spans.map((s) => `${s}fr`).join(" ");
}
