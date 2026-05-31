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

// emptyStripAbsorbHeight — for a vertical merge DOWN, inspect the cell strip in
// `row` starting at column `startCol` that should tile EXACTLY `colSpan` columns
// of empty space. Returns the number of ROWS the merge would absorb (the tiles'
// common rowSpan), or 0 if the strip can't be cleanly absorbed.
//
// The strip may be ONE wide empty cell (colSpan === owner's), several 1×1
// empties, or any mix summing to the owner's width — a wide cell can thus grow
// down into an equally-wide empty cell. To stay rectangular, every tile must be
// empty AND share the SAME rowSpan (so a colSpan-1 owner can still absorb a tall
// empty block beneath it — rowSpan N — while a wide owner absorbs a single row).
// Returns 0 on: out-of-range, a non-empty/tombstone cell, mixed tile heights, or
// a tiling that overshoots the owner width.
function emptyStripAbsorbHeight(row: FormRow, startCol: number, colSpan: number): number {
  let covered = 0;
  let c = startCol;
  let height = 0;
  while (covered < colSpan) {
    const cell = row.cells[c];
    if (!cell || !isEmptyTarget(cell)) return 0;
    const h = effectiveRowSpan(cell);
    if (height === 0) height = h;
    else if (h !== height) return 0; // mixed heights would break the rectangle
    covered += effectiveColSpan(cell);
    c += effectiveColSpan(cell);
  }
  return covered === colSpan ? height : 0; // exact tiling required
}

// emptyColStripAbsorbWidth — the horizontal mirror of emptyStripAbsorbHeight, for
// a merge RIGHT. Inspects the cell strip going DOWN column `col` from row
// `startRow` that should tile EXACTLY `rowSpan` rows of empty space. Returns the
// columns absorbed (the tiles' common colSpan), or 0 if it can't be cleanly
// absorbed. The strip may be ONE tall empty cell (rowSpan === owner's), several
// 1×1 empties, or any mix summing to the owner's height — so a tall cell can grow
// right into an equally-tall empty cell. Every tile must be empty AND share the
// same colSpan (so the result stays rectangular).
function emptyColStripAbsorbWidth(rows: FormRow[], startRow: number, col: number, rowSpan: number): number {
  let covered = 0;
  let r = startRow;
  let width = 0;
  while (covered < rowSpan) {
    const cell = rows[r]?.cells[col];
    if (!cell || !isEmptyTarget(cell)) return 0;
    const w = effectiveColSpan(cell);
    if (width === 0) width = w;
    else if (w !== width) return 0; // mixed widths would break the rectangle
    covered += effectiveRowSpan(cell);
    r += effectiveRowSpan(cell);
  }
  return covered === rowSpan ? width : 0; // exact tiling required
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
      // and the strip directly below — across the owner's full colSpan — is empty
      // and TILES the owner's width (one wide empty cell, several 1×1s, or any
      // mix). A wide cell can thus grow down into an equally-wide empty cell.
      const owner = ownerOf(rows, r, c);
      let downOk = false;
      if (owner != null && bottomRowOf(rows, owner) === r) {
        const oCell = rows[owner.rowIndex].cells[owner.cellIndex];
        const cSpan = effectiveColSpan(oCell);
        // only at the owner's left column (so one handle for a wide owner)
        if (owner.cellIndex === c) {
          downOk = emptyStripAbsorbHeight(below, c, cSpan) > 0;
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

// ─── Dominant-seam policy (one joiner on the widest/tallest) ──────────────────
//
// GOLDEN RULE (user, 2026-05-31): "two cells can merge → detect the longest →
// make that the owner → place the joiner in its centre." When several seams sit
// at the SAME boundary over ONE contiguous empty band, the user wants a SINGLE
// handle, on the WIDEST cell (vertical) / TALLEST cell (horizontal), centred on
// it — not one stranded handle per narrow column. Equal sizes keep every handle
// (there's no dominant cell, so each centres on its own equal column/row).
//
// This is a PRESENTATION policy: it never changes what mergeDown/mergeRight do
// (each surviving handle still merges its own clean rectangle — no L-shapes). It
// only suppresses the non-dominant, co-located handles so the eye sees the
// joiner where the merge will actually land.

// seamOwnerWidth — the column weight (span) of the cell that owns a vertical
// seam, i.e. the width the merged rectangle will have. Used to pick the widest.
function seamOwnerWidth(rows: FormRow[], seam: Seam): number {
  const owner = ownerOf(rows, seam.rowIndex, seam.colIndex);
  // UP seams own from the empty top cell; DOWN seams from the tall owner. Either
  // way the rectangle's width is the owning cell's span.
  const addr = owner ?? { rowIndex: seam.rowIndex, cellIndex: seam.colIndex };
  return rows[addr.rowIndex]?.cells[addr.cellIndex]?.span ?? 0;
}

// dominantVSeams keeps, per contiguous run of competing vertical seams at one
// boundary row, only the widest owner's seam (ties keep all). Seams at the same
// boundary row `r` COMPETE when their owner columns are adjacent (form one run
// of side-by-side seams) — i.e. they would otherwise strand a narrow handle next
// to a wide one over the same empty band. Seams at different boundary rows, or
// separated by a non-seam column, never compete.
export function dominantVSeams(rows: FormRow[]): Seam[] {
  const all = seamsFor(rows);
  if (all.length <= 1) return all;
  // bucket by boundary row, then split each bucket into contiguous-column runs.
  const byRow = new Map<number, Seam[]>();
  for (const s of all) {
    const list = byRow.get(s.rowIndex) ?? [];
    list.push(s);
    byRow.set(s.rowIndex, list);
  }
  const kept: Seam[] = [];
  for (const list of byRow.values()) {
    list.sort((a, b) => a.colIndex - b.colIndex);
    let run: Seam[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const maxW = Math.max(...run.map((s) => seamOwnerWidth(rows, s)));
      // keep every seam whose owner is the widest in the run (ties → all kept).
      for (const s of run) if (seamOwnerWidth(rows, s) === maxW) kept.push(s);
      run = [];
    };
    for (const s of list) {
      if (run.length === 0) { run = [s]; continue; }
      const prev = run[run.length - 1];
      // adjacent if the previous seam's owner rectangle ends exactly where this
      // one begins (no gap, no filled column between two competing seams).
      const prevOwner = ownerOf(rows, prev.rowIndex, prev.colIndex);
      const prevSpan = prevOwner ? effectiveColSpan(rows[prevOwner.rowIndex].cells[prevOwner.cellIndex]) : 1;
      const prevRight = (prevOwner?.cellIndex ?? prev.colIndex) + prevSpan - 1;
      if (s.colIndex === prevRight + 1) { run.push(s); } else { flush(); run = [s]; }
    }
    flush();
  }
  return kept;
}

// dominantHSeams — the horizontal mirror: per contiguous run of competing
// horizontal seams at one boundary COLUMN, keep only the TALLEST owner's seam
// (ties keep all). Competition is along the row axis (seams stacked over one
// empty band on the same column boundary).
function hSeamOwnerHeight(rows: FormRow[], seam: HSeam): number {
  const oRow = vOwnerRow(rows, seam.rowIndex, seam.colIndex);
  const oCol = hOwnerOf(rows, oRow, seam.colIndex);
  if (oCol == null) return 0;
  return effectiveRowSpan(rows[oRow].cells[oCol]);
}

export function dominantHSeams(rows: FormRow[]): HSeam[] {
  const all = hSeamsFor(rows);
  if (all.length <= 1) return all;
  const byCol = new Map<number, HSeam[]>();
  for (const s of all) {
    const list = byCol.get(s.colIndex) ?? [];
    list.push(s);
    byCol.set(s.colIndex, list);
  }
  const kept: HSeam[] = [];
  for (const list of byCol.values()) {
    list.sort((a, b) => a.rowIndex - b.rowIndex);
    let run: HSeam[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const maxH = Math.max(...run.map((s) => hSeamOwnerHeight(rows, s)));
      for (const s of run) if (hSeamOwnerHeight(rows, s) === maxH) kept.push(s);
      run = [];
    };
    for (const s of list) {
      if (run.length === 0) { run = [s]; continue; }
      const prev = run[run.length - 1];
      const pRow = vOwnerRow(rows, prev.rowIndex, prev.colIndex);
      const pCol = hOwnerOf(rows, pRow, prev.colIndex);
      const pSpan = pCol == null ? 1 : effectiveRowSpan(rows[pRow].cells[pCol]);
      const prevBottom = pRow + pSpan - 1;
      if (s.rowIndex === prevBottom + 1) { run.push(s); } else { flush(); run = [s]; }
    }
    flush();
  }
  return kept;
}

// ─── Barber-pole edges (mergeable-boundary borders) ──────────────────────────
//
// Every mergeable seam draws a barber-pole stripe on BOTH cells it joins, the
// two stripes facing each other (the seam reads as "these two can merge"). This
// is computed from the RAW seam sets (every mergeable boundary, not the dominant
// glyph set): a vertical seam poles the upper cell's BOTTOM + the lower cell's
// TOP; a horizontal seam poles the left cell's RIGHT + the right cell's LEFT.
//
// Keyed by the RENDERED cell's owner position ("rowIndex:cellIndex" — the same
// (rowIndex, cellIndex) the renderer iterates), each value a set of edges. The
// renderer reads its four edges off this map. Grid-perimeter suppression (a
// first-column cell never poles LEFT, etc.) is applied by the RENDERER, since it
// alone knows the band's column count + top/bottom rows.

export type PoleEdge = "top" | "right" | "bottom" | "left";

// poleEdgesFor returns the per-cell barber-pole edges for every mergeable seam.
// For a vertical seam {r,c}: resolve the upper owner (bottoms at r) → its BOTTOM
// edge; resolve the lower cell at (r+1,c)'s owner → its TOP edge. For a
// horizontal seam {r,c}: the left owner → RIGHT edge; the right cell at (r,c+1)'s
// owner → LEFT edge. Owner resolution means a wide/tall cell gets ONE pole on the
// shared boundary, keyed at its top-left position (where the renderer draws it).
export function poleEdgesFor(rows: FormRow[]): Map<string, Set<PoleEdge>> {
  const edges = new Map<string, Set<PoleEdge>>();
  const add = (rowIndex: number, colIndex: number, edge: PoleEdge) => {
    const key = `${rowIndex}:${colIndex}`;
    let set = edges.get(key);
    if (!set) { set = new Set(); edges.set(key, set); }
    set.add(edge);
  };

  // vertical seams → upper BOTTOM + lower TOP
  for (const seam of seamsFor(rows)) {
    const upper = ownerOf(rows, seam.rowIndex, seam.colIndex);
    if (upper) add(upper.rowIndex, upper.cellIndex, "bottom");
    // the lower cell sits at (r+1, c); resolve its owner so a wide lower target
    // poles once at its left column.
    const lowerRow = seam.rowIndex + 1;
    const lowerOwner = ownerOf(rows, lowerRow, seam.colIndex);
    if (lowerOwner) add(lowerOwner.rowIndex, lowerOwner.cellIndex, "top");
  }

  // horizontal seams → left RIGHT + right LEFT
  for (const seam of hSeamsFor(rows)) {
    const leftRow = vOwnerRow(rows, seam.rowIndex, seam.colIndex);
    const leftCol = hOwnerOf(rows, leftRow, seam.colIndex);
    if (leftCol != null) add(leftRow, leftCol, "right");
    // the right cell sits at (r, c+1); resolve its owner.
    const rightCol0 = seam.colIndex + 1;
    const rRow = vOwnerRow(rows, seam.rowIndex, rightCol0);
    const rCol = hOwnerOf(rows, rRow, rightCol0);
    if (rCol != null) add(rRow, rCol, "left");
  }

  return edges;
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
      // the right strip [oRow..oRow+rSpan-1][newCol] must be empty and TILE the
      // owner's height — one tall empty cell, several 1×1s, or any mix (a tall
      // cell can grow right into an equally-tall empty cell).
      if (emptyColStripAbsorbWidth(rows, oRow, newCol, rSpan) > 0) {
        seams.push({ rowIndex, colIndex: c });
      }
    }
  });
  return seams;
}

// normalizeOwnership makes OWNER cells the single source of truth and rebuilds
// every tombstone's absorbedBy from the owners' spans — so a stale/cross-wired
// absorbedBy (left by an overlapping merge, a drag, an undo, or any edit that
// didn't fully re-tombstone) is corrected. The model: a cell is an OWNER iff it
// has a fieldKey OR a span marker (rowSpan/colSpan > 1) and is not itself a
// tombstone. Each owner claims its rowSpan×colSpan rectangle; every covered
// non-owner cell becomes a tombstone pointing at THAT owner. Any cell left
// uncovered by every owner is revived to a plain empty cell (its stale
// absorbedBy dropped). This is idempotent and fail-closed: it can only ever
// produce a document whose tombstones exactly tile each owner's rectangle — the
// invariant the server's validateMergeGeometry enforces. Origin: 2026-05-31 —
// the "sprint" 2×2 whose top-right corner pointed at colour's tombstone (a
// stolen corner) → server 422; normalizing on load/save closes the class.
export function normalizeOwnership(rows: FormRow[]): FormRow[] {
  // 1. Map every covered position → the owner id that claims it. Later owners do
  //    not overwrite earlier claims (the first owner whose rectangle covers a
  //    cell wins — owners never legitimately overlap, but if a corrupt doc has
  //    two, deterministic first-wins keeps it rectangular).
  const claim = new Map<string, string>(); // "ri:ci" -> owner cell id
  rows.forEach((row, ri) => {
    row.cells.forEach((cell, ci) => {
      if (cell.absorbedBy) return; // a tombstone is not an owner
      const rs = effectiveRowSpan(cell);
      const cs = effectiveColSpan(cell);
      if (rs === 1 && cs === 1) return; // a 1×1 cell owns only itself — nothing to claim
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (dr === 0 && dc === 0) continue; // the owner cell itself
          const key = `${ri + dr}:${ci + dc}`;
          if (!claim.has(key)) claim.set(key, cell.id);
        }
      }
    });
  });
  // 2. Rewrite each cell from the claim map. A claimed cell → tombstone of its
  //    claimer; an unclaimed cell that still carries absorbedBy → revived empty.
  return rows.map((row, ri) => ({
    ...row,
    cells: row.cells.map((cell, ci) => {
      const owner = claim.get(`${ri}:${ci}`);
      if (owner) {
        // covered → tombstone of the claiming owner (drop any field/span markers)
        const { rowSpan: _r, colSpan: _c, ...rest } = cell;
        return { id: rest.id, fieldKey: null, span: rest.span, absorbedBy: owner };
      }
      if (cell.absorbedBy) {
        // uncovered but still tombstoned → stale; revive to empty.
        const { absorbedBy: _drop, ...rest } = cell;
        return { ...rest, fieldKey: null };
      }
      return cell;
    }),
  }));
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

  // the right strip [ownerRow..ownerRow+rSpan-1] × [newCol] must be empty and
  // TILE the owner's height — one tall empty cell, several 1×1s, or any mix (a
  // tall cell can grow right into an equally-tall empty cell). 0 = not mergeable.
  if (emptyColStripAbsorbWidth(rows, ownerRow, newCol, rSpan) === 0) return rows;
  // same template across every absorbed row (a merge never crosses a template).
  for (let dr = 0; dr < rSpan; dr++) {
    if (rows[ownerRow + dr]?.template !== rows[ownerRow].template) return rows;
  }
  // the new column's display width (the absorbed strip's left tile span).
  const absorbedWidth = rows[ownerRow].cells[newCol]?.span ?? 0;

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
  // the strip below must be empty and TILE the owner's width — one wide empty
  // cell, several 1×1s, or any mix (a wide cell can grow down into a wide empty).
  // Returns the rows absorbed (1 for a slot row, N when the tile(s) are a tall
  // empty block); 0 = not mergeable.
  const absorbedSpan =
    below && top.template === below.template && top.cells.length === below.cells.length
      ? emptyStripAbsorbHeight(below, col, oColSpan)
      : 0;
  if (below && absorbedSpan > 0) {
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
