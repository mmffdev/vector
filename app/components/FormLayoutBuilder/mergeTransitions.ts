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
import { TEMPLATE_SPANS } from "@/app/lib/formLayoutsApi";
import type { CellAddr } from "./useFormBuilderState";

/** rowSpan with the omitted (undefined/0) case normalised to 1. */
export function effectiveRowSpan(cell: FormCell): number {
  return cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : 1;
}

/** colSpan with the omitted (undefined/0) case normalised to 1. */
export function effectiveColSpan(cell: FormCell): number {
  return cell.colSpan && cell.colSpan > 1 ? cell.colSpan : 1;
}

/** A tombstone is a cell absorbed by an earlier merged cell. */
export function isTombstone(cell: FormCell): boolean {
  return !!cell.absorbedBy;
}

/** A single empty SLOT: no field, not a tombstone, span 1. */
function isEmptySlot(cell: FormCell): boolean {
  return cell.fieldKey == null && !isTombstone(cell) && effectiveRowSpan(cell) === 1;
}

/** An empty merge TARGET: no field + not a tombstone, of ANY span — i.e. either
 *  a single empty slot OR the empty owner of a tall block. A cell can merge
 *  down into such a target, absorbing the whole block. */
function isEmptyTarget(cell: FormCell): boolean {
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
// colIndex) is the boundary between row `rowIndex` and `rowIndex+1` in column
// `colIndex`, where a click extends a cell into an EMPTY neighbour — so a
// column can be merged all the way through a same-template run, growing a tall
// cell DOWNWARD or UPWARD. Two mergeable shapes per boundary:
//
//   (a) merge DOWN — the cell owning (r,c) bottoms at row r AND the cell at
//       (r+1,c) is empty → absorb it downward.
//   (b) merge UP   — the cell at (r,c) is empty AND the cell at (r+1,c) is the
//       TOP (owner) of a tall cell → absorb the empty cell upward into it.
//
// Each unique boundary is emitted once; the builder renders one ◇ handle and
// mergeDown() resolves which direction applies. clicking calls
// mergeDown({rowIndex, cellIndex}).
export function seamsFor(rows: FormRow[]): Seam[] {
  const seams: Seam[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const top = rows[r];
    const below = rows[r + 1];
    if (top.template !== below.template) continue;
    if (top.cells.length !== below.cells.length) continue;
    for (let c = 0; c < top.cells.length; c++) {
      const topCell = top.cells[c];
      const belowCell = below.cells[c];

      // (a) DOWN: the rectangle owning (r,c) bottoms here at its LEFT column,
      // and the strip directly below — across the owner's full colSpan — is all
      // empty 1×1 targets (colSpan-aware → a wide cell can grow down into a 2×2).
      const owner = ownerOf(rows, r, c);
      let downOk = false;
      if (owner != null && bottomRowOf(rows, owner) === r) {
        const oCell = rows[owner.rowIndex].cells[owner.cellIndex];
        const cSpan = effectiveColSpan(oCell);
        // only at the owner's left column (so one handle for a wide owner)
        if (owner.cellIndex === c) {
          downOk = Array.from({ length: cSpan }, (_, k) => below.cells[c + k]).every(
            (cc) => cc != null && isEmptyTarget(cc) && effectiveColSpan(cc) === 1,
          );
        }
      }

      // (b) UP: this cell empty, the cell below is a real (non-tombstone) cell.
      // (A merge upward absorbs THIS empty cell into the run below — see
      // mergeUp in mergeDown's resolution.)
      const upOk = isEmptySlot(topCell) && !isTombstone(belowCell);

      if (downOk || upOk) seams.push({ rowIndex: r, colIndex: c });
    }
  }
  return seams;
}

// ─── Horizontal merge (join cells across columns within ONE row) ─────────────

// An HSeam is the vertical boundary between column `colIndex` and `colIndex+1`
// in row `rowIndex`. The rotated join handle renders there.
export interface HSeam {
  rowIndex: number;
  colIndex: number; // the LEFT cell of the pair
}

// rightEdgeColOf returns the last column track a (possibly wide) cell occupies:
// its own colIndex + colSpan - 1.
function rightEdgeColOf(cell: FormCell, colIndex: number): number {
  return colIndex + effectiveColSpan(cell) - 1;
}

// hOwnerOf finds the cell that controls column position (rowIndex, colIndex) —
// either the cell itself, or an earlier cell IN THE SAME ROW whose id ===
// this cell's absorbedBy (a horizontal tombstone).
function hOwnerOf(rows: FormRow[], rowIndex: number, colIndex: number): number | null {
  const row = rows[rowIndex];
  const cell = row?.cells[colIndex];
  if (!cell) return null;
  if (!isTombstone(cell)) return colIndex;
  for (let c = colIndex - 1; c >= 0; c--) {
    if (row.cells[c]?.id === cell.absorbedBy) return c;
  }
  return null;
}

// hSeamsFor returns every horizontal-mergeable seam: a boundary where the LEFT
// cell (or the wide cell owning that column) has its right edge at colIndex and
// the cell to its right is an empty target to absorb. Multi-row (rowSpan>1)
// cells are NOT horizontally mergeable (keeps the rectangle clean) — only span-1
// rows participate.
export function hSeamsFor(rows: FormRow[]): HSeam[] {
  const seams: HSeam[] = [];
  rows.forEach((row, rowIndex) => {
    for (let c = 0; c < row.cells.length - 1; c++) {
      // resolve the rectangle owner of this position (V-owner row, then H-owner
      // col) so a tall cell can also grow right (building a 2×2 block).
      const oRow = vOwnerRow(rows, rowIndex, c);
      const oCol = hOwnerOf(rows, oRow, c);
      if (oCol == null) continue;
      const ownerCell = rows[oRow].cells[oCol];
      const rSpan = effectiveRowSpan(ownerCell);
      const rightEdge = rightEdgeColOf(ownerCell, oCol);
      // seam offered once, at the rectangle's RIGHT edge on its TOP row.
      if (rightEdge !== c || oRow !== rowIndex) continue;
      const newCol = rightEdge + 1;
      // the whole right strip [oRow..oRow+rSpan-1][newCol] must be empty + 1×1.
      let ok = true;
      for (let dr = 0; dr < rSpan; dr++) {
        const cell = rows[oRow + dr]?.cells[newCol];
        if (!cell || !isEmptyTarget(cell) || effectiveColSpan(cell) > 1 || effectiveRowSpan(cell) > 1) { ok = false; break; }
      }
      if (ok) seams.push({ rowIndex, colIndex: c });
    }
  });
  return seams;
}

// A merged cell owns a rectangle [ownerRow .. ownerRow+rowSpan-1] ×
// [ownerCol .. ownerCol+colSpan-1]. Every position in that rectangle except the
// owner is a TOMBSTONE (fieldKey:null, absorbedBy = owner id). mergeRight /
// mergeDown grow the rectangle one strip at a time and tombstone the WHOLE new
// strip (across the owner's full extent on the other axis), so a 2×2 block is
// always fully covered — no under-tombstoned gaps.

// mergeRight grows the owner rectangle by one column strip to the right. The
// absorbed column strip must be empty across ALL rows the owner spans; each of
// those cells becomes a tombstone. No-op unless the strip is a clean empty
// target (so a merge never overwrites a placed field).
export function mergeRight(rows: FormRow[], addr: CellAddr): FormRow[] {
  const ownerRow = vOwnerRow(rows, addr.rowIndex, addr.cellIndex);
  const ownerCol = hOwnerOf(rows, ownerRow, addr.cellIndex);
  if (ownerCol == null) return rows;
  const ownerCell = rows[ownerRow].cells[ownerCol];
  const rSpan = effectiveRowSpan(ownerCell);
  const cSpan = effectiveColSpan(ownerCell);
  const newCol = ownerCol + cSpan; // first column of the strip to absorb

  // the strip [ownerRow..ownerRow+rSpan-1] × [newCol] must all be empty + in
  // range + same template throughout.
  let absorbedWidth = 0;
  for (let dr = 0; dr < rSpan; dr++) {
    const r = rows[ownerRow + dr];
    const cell = r?.cells[newCol];
    if (!cell || !isEmptyTarget(cell) || effectiveColSpan(cell) > 1 || effectiveRowSpan(cell) > 1) return rows;
    if (r.template !== rows[ownerRow].template) return rows;
    if (dr === 0) absorbedWidth = cell.span;
  }

  return rows.map((r, ri) => {
    if (ri < ownerRow || ri > ownerRow + rSpan - 1) return r;
    return {
      ...r,
      cells: r.cells.map((cell, ci) => {
        if (ri === ownerRow && ci === ownerCol) {
          return { ...cell, colSpan: cSpan + 1, span: cell.span + absorbedWidth };
        }
        if (ci === newCol) {
          return { id: cell.id, fieldKey: null, span: cell.span, absorbedBy: ownerCell.id };
        }
        return cell;
      }),
    };
  });
}

// splitCellH collapses the owner rectangle's COLUMNS back to 1 (a 2×2 → 2×1
// tall, a 1×N wide → 1×1). Cells in the owner's columns ownerCol+1.. across ALL
// owner rows revive to individual empty cells with their template width; the
// owner keeps its rowSpan.
export function splitCellH(rows: FormRow[], addr: CellAddr): FormRow[] {
  const ownerRow = vOwnerRow(rows, addr.rowIndex, addr.cellIndex);
  const ownerCol = hOwnerOf(rows, ownerRow, addr.cellIndex);
  if (ownerCol == null) return rows;
  const ownerCell = rows[ownerRow].cells[ownerCol];
  if (effectiveColSpan(ownerCell) <= 1) return rows;
  const ownerId = ownerCell.id;
  const rSpan = effectiveRowSpan(ownerCell);

  return rows.map((r, ri) => {
    if (ri < ownerRow || ri > ownerRow + rSpan - 1) return r;
    const spans = TEMPLATE_SPANS[r.template] ?? [];
    return {
      ...r,
      cells: r.cells.map((c, ci) => {
        if (ri === ownerRow && ci === ownerCol) {
          const { colSpan: _drop, ...rest } = c;
          return { ...rest, span: spans[ci] ?? c.span };
        }
        // revive horizontal tombstones owned by this cell (cols to the right),
        // but NOT the vertical tombstones in ownerCol (those belong to the
        // surviving vertical merge).
        if (c.absorbedBy === ownerId && ci !== ownerCol) {
          const { absorbedBy: _drop, ...rest } = c;
          return { ...rest, fieldKey: null, span: spans[ci] ?? c.span };
        }
        return c;
      }),
    };
  });
}

// vOwnerRow resolves the row of the cell that vertically owns position
// (rowIndex, colIndex) — the cell itself, or the owner above if it's a vertical
// tombstone. (Mirror of hOwnerOf on the row axis.)
function vOwnerRow(rows: FormRow[], rowIndex: number, colIndex: number): number {
  const cell = rows[rowIndex]?.cells[colIndex];
  if (!cell || !isTombstone(cell)) return rowIndex;
  for (let r = rowIndex - 1; r >= 0; r--) {
    if (rows[r]?.cells[colIndex]?.id === cell.absorbedBy) return r;
  }
  return rowIndex;
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
  const ownerCell = top.cells[col];

  // DOWN case: owner's bottom-edge neighbour row is an empty target strip across
  // ALL the owner's columns (colSpan-aware → supports 2×2 blocks). Absorb the
  // whole strip (which may itself be a tall block) and tombstone every cell in
  // the owner's column range across the absorbed rows.
  const oColSpan = effectiveColSpan(ownerCell);
  const stripEmpty =
    below &&
    top.template === below.template &&
    top.cells.length === below.cells.length &&
    Array.from({ length: oColSpan }, (_, k) => below.cells[col + k]).every(
      (cc) => cc != null && isEmptyTarget(cc) && effectiveColSpan(cc) === 1,
    );
  if (below && stripEmpty) {
    const absorbedSpan = effectiveRowSpan(below.cells[col]); // 1 for a slot, N for a block
    const nextSpan = effectiveRowSpan(ownerCell) + absorbedSpan;
    const absorbedStart = bottom + 1;
    const absorbedEnd = bottom + absorbedSpan; // inclusive last absorbed row
    const inCols = (ci: number) => ci >= col && ci < col + oColSpan;
    return rows.map((row, ri) => {
      if (ri === owner.rowIndex) {
        return { ...row, cells: row.cells.map((c, ci) => (ci === col ? { ...c, rowSpan: nextSpan } : c)) };
      }
      if (ri >= absorbedStart && ri <= absorbedEnd) {
        return {
          ...row,
          cells: row.cells.map((c, ci) =>
            inCols(ci) ? { id: c.id, fieldKey: null, span: c.span, absorbedBy: ownerCell.id } : c,
          ),
        };
      }
      return row;
    });
  }

  // UP case: the clicked cell is EMPTY and the cell directly below is a real
  // (non-tombstone) cell → the empty cell becomes the new owner, extending the
  // run below upward by one. Only valid when the clicked cell has span 1 (it's
  // an empty slot) and the row below shares the template.
  const clicked = rows[addr.rowIndex]?.cells[addr.cellIndex];
  const lowerRow = rows[addr.rowIndex + 1];
  if (
    clicked &&
    isEmptySlot(clicked) &&
    lowerRow &&
    rows[addr.rowIndex].template === lowerRow.template &&
    rows[addr.rowIndex].cells.length === lowerRow.cells.length
  ) {
    const lowerCell = lowerRow.cells[addr.cellIndex];
    if (lowerCell && !isTombstone(lowerCell)) {
      const newSpan = effectiveRowSpan(lowerCell) + 1;
      const newOwnerId = clicked.id;
      return rows.map((row, ri) => {
        if (ri === addr.rowIndex) {
          // empty cell becomes owner: carries the lower cell's field + new span.
          return {
            ...row,
            cells: row.cells.map((c, ci) =>
              ci === addr.cellIndex
                ? { ...c, fieldKey: lowerCell.fieldKey, rowSpan: newSpan }
                : c,
            ),
          };
        }
        if (ri === addr.rowIndex + 1) {
          // former owner becomes a tombstone of the new owner; any deeper
          // tombstones get repointed to the new owner id.
          return {
            ...row,
            cells: row.cells.map((c, ci) =>
              ci === addr.cellIndex
                ? { id: c.id, fieldKey: null, span: c.span, absorbedBy: newOwnerId }
                : c,
            ),
          };
        }
        // repoint deeper tombstones that belonged to the old owner.
        if (row.cells.some((c, ci) => ci === addr.cellIndex && c.absorbedBy === lowerCell.id)) {
          return {
            ...row,
            cells: row.cells.map((c, ci) =>
              ci === addr.cellIndex && c.absorbedBy === lowerCell.id
                ? { ...c, absorbedBy: newOwnerId }
                : c,
            ),
          };
        }
        return row;
      });
    }
  }

  return rows;
}

// splitCell collapses the owner rectangle's ROWS back to 1 (a 2×2 → 1×2 wide, a
// N×1 tall → 1×1). rowSpan drops to 1; cells in the owner's rows BELOW the owner
// row (any column) revive to individual empty cells with their template width.
// The owner-row's horizontal tombstones (to the right) are kept — a surviving
// horizontal merge. No-op on a 1-row cell.
export function splitCell(rows: FormRow[], addr: CellAddr): FormRow[] {
  const ownerRow = addr.rowIndex;
  const row = rows[ownerRow];
  if (!row) return rows;
  const cell = row.cells[addr.cellIndex];
  if (!cell || effectiveRowSpan(cell) <= 1) return rows;
  const ownerId = cell.id;

  return rows.map((r, ri) => {
    if (ri === ownerRow) {
      // owner row: only drop the rowSpan on the owner; keep H-tombstones intact.
      return {
        ...r,
        cells: r.cells.map((c, ci) => (ci === addr.cellIndex ? stripSpan(c) : c)),
      };
    }
    if (ri > ownerRow && r.cells.some((c) => c.absorbedBy === ownerId)) {
      const spans = TEMPLATE_SPANS[r.template] ?? [];
      return {
        ...r,
        cells: r.cells.map((c, ci) =>
          c.absorbedBy === ownerId ? { ...revive(c), span: spans[ci] ?? c.span } : c,
        ),
      };
    }
    return r;
  });
}

// removeRow deletes a row, keeping all merge geometry consistent:
//   - if a column's cell in the deleted row is a TOMBSTONE, its owner's rowSpan
//     shrinks by 1 (the merge loses one covered row);
//   - if a column's cell is an OWNER (rowSpan > 1), that column's whole merge
//     is first SPLIT (so its tombstones revive) before the row is removed —
//     deleting the cell that holds the field shouldn't silently re-home it.
// Returns a layout with the row gone and no dangling spans/tombstones.
export function removeRow(rows: FormRow[], rowIndex: number): FormRow[] {
  const target = rows[rowIndex];
  if (!target) return rows;

  // 1. Split any merge OWNED by a cell in the row being deleted.
  let work = rows;
  target.cells.forEach((cell, ci) => {
    if (effectiveRowSpan(cell) > 1) {
      work = splitCell(work, { rowIndex, cellIndex: ci });
    }
  });

  // 2. For every tombstone in the (possibly updated) target row, shrink the
  //    owner above it by one.
  const updatedTarget = work[rowIndex];
  updatedTarget.cells.forEach((cell, ci) => {
    if (!isTombstone(cell)) return;
    const owner = ownerOf(work, rowIndex, ci);
    if (!owner) return;
    work = work.map((r, ri) =>
      ri === owner.rowIndex
        ? {
            ...r,
            cells: r.cells.map((c, cc) =>
              cc === ci ? shrinkSpan(c) : c,
            ),
          }
        : r,
    );
  });

  // 3. Drop the row.
  return work.filter((_, i) => i !== rowIndex);
}

// shrinkSpan decrements a cell's rowSpan, dropping the marker at 1.
function shrinkSpan(c: FormCell): FormCell {
  const next = effectiveRowSpan(c) - 1;
  return next > 1 ? { ...c, rowSpan: next } : stripSpan(c);
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

// bandsOf groups CONTIGUOUS rows that share a template + column count into one
// band. Critically this is NOT gated on merge-linkage: two adjacent 30-30-30
// rows form ONE band whether or not a column is merged between them. That is
// what keeps every column aligned across a merge — the whole run is a single
// CSS grid with one track per row, so a merged cell just spans tracks while its
// unmerged neighbours stay on their own track (no separate grids → no gaps, and
// a column can be merged all the way through the run). subRowCount == row count
// (tombstones keep every column rectangular). A template change starts a new
// band (merge can't cross it, by the same-template rule).
export function bandsOf(rows: FormRow[]): Band[] {
  const bands: Band[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (
      j < rows.length &&
      rows[j].template === rows[i].template &&
      rows[j].cells.length === rows[i].cells.length
    ) {
      j++;
    }
    bands.push({ startRow: i, rows: rows.slice(i, j), subRowCount: j - i });
    i = j;
  }
  return bands;
}

// ─── Merge groups (for the drag/delete handle) ────────────────────────────

// A MergeGroup is a maximal run of CONSECUTIVE rows tied together by at least
// one vertical merge — so they move and delete as ONE unit (you can't drag a
// single row out of a merge and fracture it). An unmerged row is its own
// singleton group. Overlapping column-merges that share a row fuse into one
// group (transitive closure over the merge-link relation).
export interface MergeGroup {
  startRow: number;
  count: number;       // rows spanned
  merged: boolean;     // true if the group is held together by a vertical merge
}

// rowsMergeLinked: do rows `a` (upper) and `b` (the row directly below) share a
// vertical merge across their boundary? True iff some column in `b` is a
// tombstone whose owner sits in `a` or above AND that owner's span reaches `b`.
// Equivalently: some column has a cell at row index `bIdx` that is a tombstone
// (covered from above). Since a tombstone is always covered by an owner above,
// any tombstone in row b means a merge crosses the a|b boundary in that column.
function rowHasTombstone(row: FormRow): boolean {
  return row.cells.some((c) => isTombstone(c));
}

// mergeGroupsOf partitions rows into consecutive groups. A boundary between row
// i and i+1 is "linked" iff row i+1 contains a tombstone (a cell covered by a
// merge from above) — that merge ties the two rows together. Consecutive linked
// boundaries extend the same group (transitive closure).
export function mergeGroupsOf(rows: FormRow[]): MergeGroup[] {
  const groups: MergeGroup[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    // extend while the NEXT row is tied to the current group by a merge.
    while (j < rows.length && rowHasTombstone(rows[j])) j++;
    groups.push({ startRow: i, count: j - i, merged: j - i > 1 });
    i = j;
  }
  return groups;
}

// moveGroup relocates a whole consecutive block of rows (startRow..startRow+
// count-1) to a new position, preserving every merge inside it. toIndex is the
// gap index in the PRE-removal coordinate space (where an inserted row lands).
export function moveGroup(rows: FormRow[], startRow: number, count: number, toIndex: number): FormRow[] {
  if (startRow < 0 || count < 1 || startRow + count > rows.length) return rows;
  const block = rows.slice(startRow, startRow + count);
  const without = [...rows.slice(0, startRow), ...rows.slice(startRow + count)];
  // map the drop gap index from pre-removal space into without-space.
  const dest = toIndex > startRow ? toIndex - count : toIndex;
  const clamped = Math.max(0, Math.min(dest, without.length));
  return [...without.slice(0, clamped), ...block, ...without.slice(clamped)];
}

// unmergeGroup splits EVERY vertical merge within a group back into individual
// rows (keeping each owner's field on its top row), leaving the rows in place.
// Used by the group's delete/un-merge handle (un-merge, don't bulk-delete).
export function unmergeGroup(rows: FormRow[], startRow: number, count: number): FormRow[] {
  let work = rows;
  for (let r = startRow; r < startRow + count; r++) {
    const row = work[r];
    if (!row) continue;
    row.cells.forEach((cell, ci) => {
      if (effectiveRowSpan(cell) > 1) {
        work = splitCell(work, { rowIndex: r, cellIndex: ci });
      }
    });
  }
  return work;
}
