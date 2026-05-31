// mergeTransitions — pure row/cell transforms for vertical cell merge in the
// Form Layout Builder. No React, no dnd, no fetch (mirrors the discipline of
// useFormBuilderState). The hook wraps these; tests exercise them directly.
//
// Model (see docs/superpowers/specs/2026-05-31-flb-vertical-merge-design.md):
//   A column can be merged DOWN through adjacent rows that share the SAME
//   template. The TOP cell carries rowSpan > 1; each covered cell below
//   becomes a TOMBSTONE (fieldKey:null + absorbedBy = top cell id). Tombstones
//   keep rows[] rectangular so indices never shift.
//
// Invariants this module upholds:
//   - merge is offered only where the two rows share a template AND the lower
//     cell is EMPTY (no field, not already a tombstone) — so a merge can never
//     displace a placed field.
//   - split is the exact inverse of merge.

import type { FormRow, FormCell } from "@/app/lib/formLayoutsApi";
import type { CellAddr } from "./useFormBuilderState";

/** rowSpan with the omitted (undefined/0) case normalised to 1. */
export function effectiveRowSpan(cell: FormCell): number {
  return cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : 1;
}

/** A tombstone is a cell absorbed by an earlier merged cell. */
export function isTombstone(cell: FormCell): boolean {
  return !!cell.absorbedBy;
}

/** A cell is mergeable-into (a valid merge TARGET) when it is empty and not
 *  already absorbed. */
function isEmptySlot(cell: FormCell): boolean {
  return cell.fieldKey == null && !isTombstone(cell);
}

// A seam is a mergeable boundary: column `colIndex` between `rowIndex` and the
// row directly below it. Only emitted when the two rows share a template, the
// upper cell is a real (non-tombstone) cell, and the lower cell is empty.
export interface Seam {
  rowIndex: number; // the UPPER row of the pair
  colIndex: number;
}

// ownerOf finds the tall cell that controls position (rowIndex, colIndex):
// either the cell itself (if real) or the cell in an earlier row whose id ===
// this cell's absorbedBy. Returns the owner's address, or null if the position
// is out of range.
function ownerOf(rows: FormRow[], rowIndex: number, colIndex: number): CellAddr | null {
  const cell = rows[rowIndex]?.cells[colIndex];
  if (!cell) return null;
  if (!isTombstone(cell)) return { rowIndex, cellIndex: colIndex };
  for (let r = rowIndex - 1; r >= 0; r--) {
    const candidate = rows[r]?.cells[colIndex];
    if (candidate && candidate.id === cell.absorbedBy) {
      return { rowIndex: r, cellIndex: colIndex };
    }
  }
  return null;
}

// bottomRowOf returns the last sub-row a tall cell currently covers (its
// owner's rowIndex + its rowSpan - 1).
function bottomRowOf(rows: FormRow[], owner: CellAddr): number {
  const cell = rows[owner.rowIndex].cells[owner.cellIndex];
  return owner.rowIndex + effectiveRowSpan(cell) - 1;
}

// seamsFor returns every mergeable seam in the layout. A seam at (rowIndex,
// colIndex) means: the cell that OWNS column `colIndex` at `rowIndex` has its
// bottom edge here, and the cell directly below (in rowIndex+1) is empty and
// same-template — so it can be absorbed. The builder renders a ◇ join handle
// at each; clicking one calls mergeDown({rowIndex, cellIndex: colIndex}).
export function seamsFor(rows: FormRow[]): Seam[] {
  const seams: Seam[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const top = rows[r];
    const below = rows[r + 1];
    if (top.template !== below.template) continue;
    if (top.cells.length !== below.cells.length) continue;
    for (let c = 0; c < top.cells.length; c++) {
      const owner = ownerOf(rows, r, c);
      // The seam is offered at the OWNER's bottom edge only — so a 3-row tall
      // cell shows one seam (at its base), not one per covered row.
      if (!owner || bottomRowOf(rows, owner) !== r) continue;
      const belowCell = below.cells[c];
      if (!isEmptySlot(belowCell)) continue; // merge never overwrites a field
      seams.push({ rowIndex: r, colIndex: c });
    }
  }
  return seams;
}

// mergeDown absorbs the empty cell directly below the tall cell that owns
// `addr` into that tall cell. It resolves the owner first (so passing a
// tombstone address extends the existing merge rather than no-opping), grows
// the owner's rowSpan by 1, and tombstones the absorbed cell. No-op unless the
// owner's bottom neighbour is empty and same-template.
export function mergeDown(rows: FormRow[], addr: CellAddr): FormRow[] {
  const owner = ownerOf(rows, addr.rowIndex, addr.cellIndex);
  if (!owner) return rows;
  const col = owner.cellIndex;
  const bottom = bottomRowOf(rows, owner);
  const below = rows[bottom + 1];
  const top = rows[owner.rowIndex];
  if (!below) return rows;
  if (top.template !== below.template) return rows;
  if (top.cells.length !== below.cells.length) return rows;
  const ownerCell = top.cells[col];
  const belowCell = below.cells[col];
  if (!belowCell || !isEmptySlot(belowCell)) return rows;

  const nextSpan = effectiveRowSpan(ownerCell) + 1;
  return rows.map((row, ri) => {
    if (ri === owner.rowIndex) {
      return {
        ...row,
        cells: row.cells.map((c, ci) =>
          ci === col ? { ...c, rowSpan: nextSpan } : c,
        ),
      };
    }
    if (ri === bottom + 1) {
      return {
        ...row,
        cells: row.cells.map((c, ci) =>
          ci === col ? { ...c, fieldKey: null, absorbedBy: ownerCell.id } : c,
        ),
      };
    }
    return row;
  });
}

// splitCell un-fuses a tall cell at `addr`: rowSpan back to 1, and every
// tombstone it owns (absorbedBy === cell.id) becomes a plain empty cell again.
// Exact inverse of the merge sequence that built it. No-op on a 1-row cell.
export function splitCell(rows: FormRow[], addr: CellAddr): FormRow[] {
  const row = rows[addr.rowIndex];
  if (!row) return rows;
  const cell = row.cells[addr.cellIndex];
  if (!cell || effectiveRowSpan(cell) <= 1) return rows;
  const ownerId = cell.id;

  return rows.map((r, ri) => {
    if (ri === addr.rowIndex) {
      return {
        ...r,
        cells: r.cells.map((c, ci) =>
          ci === addr.cellIndex ? { ...stripSpan(c) } : c,
        ),
      };
    }
    // Revive any tombstone owned by this cell back to an empty slot.
    if (r.cells.some((c) => c.absorbedBy === ownerId)) {
      return {
        ...r,
        cells: r.cells.map((c) =>
          c.absorbedBy === ownerId ? revive(c) : c,
        ),
      };
    }
    return r;
  });
}

// stripSpan removes the rowSpan marker (back to a 1-row cell).
function stripSpan(c: FormCell): FormCell {
  const { rowSpan: _drop, ...rest } = c;
  return rest;
}

// revive turns a tombstone back into a plain empty cell.
function revive(c: FormCell): FormCell {
  const { absorbedBy: _drop, ...rest } = c;
  return { ...rest, fieldKey: null };
}

// ─── Band detection (for the renderer) ───────────────────────────────────

// A Band is a maximal run of adjacent rows sharing one template. Within a band,
// merged cells span multiple sub-rows. A band with no merges is just its rows.
export interface Band {
  startRow: number; // index into rows[] of the first row in the band
  rows: FormRow[];
  subRowCount: number; // number of grid rows the band occupies (== rows.length)
}

// rowsAreLinked reports whether `lower` (the row directly below `upper`)
// contains a tombstone absorbed by a cell in `upper` — i.e. a merge physically
// joins the two rows. Only linked rows belong to the same band.
function rowsAreLinked(upper: FormRow, lower: FormRow): boolean {
  const upperIds = new Set(upper.cells.map((c) => c.id));
  return lower.cells.some((c) => c.absorbedBy && upperIds.has(c.absorbedBy));
}

// bandsOf groups rows that are ACTUALLY LINKED BY A MERGE. Two adjacent
// same-template rows with no merge between them are SEPARATE bands (each keeps
// its own gutter marker + drag/delete aside). A band is drawn as one CSS grid
// so a tall cell's grid-row span lands on the right sub-row tracks. Because
// tombstones keep every column rectangular, subRowCount is just the row count.
export function bandsOf(rows: FormRow[]): Band[] {
  const bands: Band[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && rowsAreLinked(rows[j - 1], rows[j])) j++;
    bands.push({ startRow: i, rows: rows.slice(i, j), subRowCount: j - i });
    i = j;
  }
  return bands;
}
