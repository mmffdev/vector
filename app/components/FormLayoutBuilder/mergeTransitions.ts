// mergeTransitions — pure row/cell transforms for vertical cell merge in the
// Form Layout Builder. No React, no dnd, no fetch (mirrors the discipline of
// useFormBuilderState). The hook wraps these; tests exercise them directly.
//
// Model (see docs/superpowers/specs/2026-05-31-flb-vertical-merge-design.md):
//   A cell can be merged DOWN through adjacent rows whose edge aligns on the
//   shared micro-grid. The TOP cell carries rowSpan > 1; each covered cell below
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

// ── Master micro-column grid ────────────────────────────────────────────────
// Every band renders on the SAME fine grid of MICRO_BASE equal columns, so a
// cell boundary lands on the same x in EVERY row regardless of its template.
// 60 is the magic base: every template percentage maps to a whole number of
// micro-tracks — 25→15, 30→18, 33⅓→20, 50→30, 70→42, 75→45, 100→60.
export const MICRO_BASE = 60;

// microWidths converts a template's percentage spans to integer micro-track
// counts on the MICRO_BASE grid. The "33" spans are the 100/3 thirds, so they
// resolve to MICRO_BASE/3 exactly rather than relying on a rounded percentage.
export function microWidths(spans: number[]): number[] {
  return spans.map((s) => (s === 33 ? MICRO_BASE / 3 : Math.round((s / 100) * MICRO_BASE)));
}

// templateMicro returns the per-template-column micro widths for a band (from the
// canonical template spans, NOT row[0]'s cells which an H-merge may have widened).
export function templateMicro(band: Band): number[] {
  const spans = TEMPLATE_SPANS[band.rows[0].template] ?? band.rows[0].cells.map((c) => c.span);
  return microWidths(spans);
}

export function rowMicro(row: FormRow): number[] {
  const spans = TEMPLATE_SPANS[row.template] ?? row.cells.map((c) => c.span);
  return microWidths(spans);
}

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

// An HSeam is the vertical boundary between column `colIndex` and `colIndex+1`
// in row `rowIndex`. The rotated join handle renders there.
export interface HSeam {
  rowIndex: number;
  colIndex: number;
  side?: "left" | "right"; // edge of this rendered cell; default/right keeps the legacy shape
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

export interface CellBlockRect {
  addr: CellAddr;
  cell: FormCell;
  rowTop: number;
  rowBottom: number;
  rowSpan: number;
  colLeft: number;
  colRight: number;
  colSpan: number;
  microLeft: number;
  microRight: number;
  microSpan: number;
  fields: number;
}

export interface MergeEdge {
  kind: "V" | "H";
  rowIndex: number;
  cellIndex: number;
  key: string;
  top: CellAddr[];
  bottom: CellAddr[];
  left: CellAddr[];
  right: CellAddr[];
}

function uniqueOwnerOf(rows: FormRow[], rowIndex: number, colIndex: number): CellAddr | null {
  const cell = rows[rowIndex]?.cells[colIndex];
  if (!cell) return null;
  if (!isTombstone(cell)) return { rowIndex, cellIndex: colIndex };
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].cells.findIndex((candidate) => candidate.id === cell.absorbedBy);
    if (c >= 0) return { rowIndex: r, cellIndex: c };
  }
  return null;
}

function microStarts(widths: number[]): number[] {
  const starts: number[] = [];
  widths.reduce((acc, width, index) => {
    starts[index] = acc;
    return acc + width;
  }, 0);
  return starts;
}

function cellMicroRect(row: FormRow, cellIndex: number): { microLeft: number; microRight: number } | null {
  const cell = row.cells[cellIndex];
  if (!cell) return null;
  const widths = rowMicro(row);
  const starts = microStarts(widths);
  const microLeft = starts[cellIndex];
  const microSpan = widths
    .slice(cellIndex, cellIndex + effectiveColSpan(cell))
    .reduce((sum, width) => sum + width, 0);
  if (microLeft == null || microSpan <= 0) return null;
  return { microLeft, microRight: microLeft + microSpan };
}

function blockRectFromOwner(owner: CellAddr, rows: FormRow[]): CellBlockRect | null {
  const cell = rows[owner.rowIndex]?.cells[owner.cellIndex];
  if (!cell || isTombstone(cell)) return null;
  const micro = cellMicroRect(rows[owner.rowIndex], owner.cellIndex);
  if (!micro) return null;
  const colSpan = effectiveColSpan(cell);
  const rowSpan = effectiveRowSpan(cell);
  return {
    addr: owner,
    cell,
    rowTop: owner.rowIndex,
    rowBottom: owner.rowIndex + rowSpan - 1,
    rowSpan,
    colLeft: owner.cellIndex,
    colRight: owner.cellIndex + colSpan - 1,
    colSpan,
    microLeft: micro.microLeft,
    microRight: micro.microRight,
    microSpan: micro.microRight - micro.microLeft,
    fields: cell.fieldKey != null ? 1 : 0,
  };
}

export function blockRectOf(rows: FormRow[], rowIndex: number, cellIndex: number): CellBlockRect | null {
  const owner = uniqueOwnerOf(rows, rowIndex, cellIndex);
  if (!owner) return null;
  return blockRectFromOwner(owner, rows);
}

function blockRectsForRows(rows: FormRow[]): CellBlockRect[] {
  const rects: CellBlockRect[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].cells.length; c++) {
      if (isTombstone(rows[r].cells[c])) continue;
      const rect = blockRectFromOwner({ rowIndex: r, cellIndex: c }, rows);
      if (rect) rects.push(rect);
    }
  }
  return rects;
}

function exactMicroTiles(
  candidates: CellBlockRect[],
  microLeft: number,
  microRight: number,
): CellBlockRect[] | null {
  const tiles = candidates
    .filter((rect) => rect.microLeft < microRight && rect.microRight > microLeft)
    .sort((a, b) => a.microLeft - b.microLeft);
  if (tiles.length === 0) return null;
  let cursor = microLeft;
  for (const tile of tiles) {
    if (tile.microLeft !== cursor || tile.microRight > microRight) return null;
    cursor = tile.microRight;
  }
  return cursor === microRight ? tiles : null;
}

function exactRowTiles(
  candidates: CellBlockRect[],
  rowTop: number,
  rowBottom: number,
): CellBlockRect[] | null {
  const tiles = candidates
    .filter((rect) => rect.rowTop <= rowBottom && rect.rowBottom >= rowTop)
    .sort((a, b) => a.rowTop - b.rowTop);
  if (tiles.length === 0) return null;
  let cursor = rowTop;
  for (const tile of tiles) {
    if (tile.rowTop !== cursor || tile.rowBottom > rowBottom) return null;
    cursor = tile.rowBottom + 1;
  }
  return cursor === rowBottom + 1 ? tiles : null;
}

function verticalTilesBelow(rects: CellBlockRect[], boundaryRow: number, owner: CellBlockRect): CellBlockRect[] | null {
  return exactMicroTiles(
    rects.filter((rect) => rect.rowTop === boundaryRow + 1),
    owner.microLeft,
    owner.microRight,
  );
}

function horizontalTilesRight(rects: CellBlockRect[], boundaryMicro: number, owner: CellBlockRect): CellBlockRect[] | null {
  return exactRowTiles(
    rects.filter((rect) => rect.microLeft === boundaryMicro),
    owner.rowTop,
    owner.rowBottom,
  );
}

function horizontalTilesLeft(rects: CellBlockRect[], boundaryMicro: number, owner: CellBlockRect): CellBlockRect[] | null {
  return exactRowTiles(
    rects.filter((rect) => rect.microRight === boundaryMicro),
    owner.rowTop,
    owner.rowBottom,
  );
}

function unionFieldCount(owner: CellBlockRect, tiles: CellBlockRect[]): number {
  return owner.fields + tiles.reduce((sum, tile) => sum + tile.fields, 0);
}

function commonRowSpan(tiles: CellBlockRect[]): number {
  if (tiles.length === 0) return 0;
  const rowSpan = tiles[0].rowSpan;
  return tiles.every((tile) => tile.rowSpan === rowSpan) ? rowSpan : 0;
}

function commonMicroSpan(tiles: CellBlockRect[]): boolean {
  if (tiles.length === 0) return false;
  const { microLeft, microRight } = tiles[0];
  return tiles.every((tile) => tile.microLeft === microLeft && tile.microRight === microRight);
}

function verticalBoundaryAllowed(rows: FormRow[], owner: CellBlockRect, tiles: CellBlockRect[]): boolean {
  const topRow = rows[owner.rowBottom];
  const belowRow = rows[owner.rowBottom + 1];
  if (!topRow || !belowRow) return false;
  return topRow.cells.length === belowRow.cells.length && commonRowSpan(tiles) > 0;
}

function addMergeEdge(edges: Map<string, MergeEdge>, edge: MergeEdge): void {
  if (!edges.has(edge.key)) edges.set(edge.key, edge);
}

// mergeEdgesPass is the single source of truth for offered merge handles. It
// evaluates owner rectangles on the renderer's micro-grid and confirms an edge
// only when the opposite side tiles the full shared segment exactly. The public
// seam adapters below keep returning executable mergeDown/mergeRight addresses.
export function mergeEdgesPass(rows: FormRow[]): MergeEdge[] {
  const edges = new Map<string, MergeEdge>();
  const rects = blockRectsForRows(rows);
  for (const owner of rects) {
    if (owner.rowBottom < rows.length - 1) {
      const tiles = verticalTilesBelow(rects, owner.rowBottom, owner);
      if (
        tiles &&
        verticalBoundaryAllowed(rows, owner, tiles) &&
        unionFieldCount(owner, tiles) <= 1
      ) {
        addMergeEdge(edges, {
          kind: "V",
          rowIndex: owner.rowBottom,
          cellIndex: owner.colLeft,
          key: `V:${owner.rowBottom}:${owner.microLeft}:${owner.microRight}`,
          top: [owner.addr],
          bottom: tiles.map((tile) => tile.addr),
          left: [],
          right: [],
        });
      }
    }

    if (owner.microRight < MICRO_BASE) {
      const tiles = horizontalTilesRight(rects, owner.microRight, owner);
      if (tiles && commonMicroSpan(tiles) && unionFieldCount(owner, tiles) <= 1) {
        addMergeEdge(edges, {
          kind: "H",
          rowIndex: owner.rowTop,
          cellIndex: owner.colRight,
          key: `H:${owner.microRight}:${owner.rowTop}:${owner.rowBottom}`,
          top: [],
          bottom: [],
          left: [owner.addr],
          right: tiles.map((tile) => tile.addr),
        });
      }
    }

    if (owner.microLeft > 0) {
      const tiles = horizontalTilesLeft(rects, owner.microLeft, owner);
      if (tiles && commonMicroSpan(tiles) && unionFieldCount(owner, tiles) <= 1) {
        const firstLeft = tiles[0];
        addMergeEdge(edges, {
          kind: "H",
          rowIndex: firstLeft.rowTop,
          cellIndex: firstLeft.colRight,
          key: `H:${owner.microLeft}:${owner.rowTop}:${owner.rowBottom}`,
          top: [],
          bottom: [],
          left: tiles.map((tile) => tile.addr),
          right: [owner.addr],
        });
      }
    }
  }
  return Array.from(edges.values()).sort((a, b) =>
    a.kind.localeCompare(b.kind) ||
    a.rowIndex - b.rowIndex ||
    a.cellIndex - b.cellIndex ||
    a.key.localeCompare(b.key),
  );
}

// seamsFor returns every executable vertical merge seam. A seam at (rowIndex,
// colIndex) is the address passed to mergeDown().
export function seamsFor(rows: FormRow[]): Seam[] {
  return mergeEdgesPass(rows)
    .filter((edge) => edge.kind === "V")
    .map((edge) => ({ rowIndex: edge.rowIndex, colIndex: edge.cellIndex }));
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

  for (const edge of mergeEdgesPass(rows)) {
    if (edge.kind === "V") {
      for (const owner of edge.top) add(owner.rowIndex, owner.cellIndex, "bottom");
      for (const owner of edge.bottom) add(owner.rowIndex, owner.cellIndex, "top");
    } else {
      for (const owner of edge.left) add(owner.rowIndex, owner.cellIndex, "right");
      for (const owner of edge.right) add(owner.rowIndex, owner.cellIndex, "left");
    }
  }

  return edges;
}

// ─── Horizontal merge (join cells across columns within ONE row) ─────────────

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

// hSeamsFor returns every executable horizontal merge seam. A seam at (rowIndex,
// colIndex) is the address passed to mergeRight().
export function hSeamsFor(rows: FormRow[]): HSeam[] {
  const seen = new Set<string>();
  const seams: HSeam[] = [];
  for (const edge of mergeEdgesPass(rows)) {
    if (edge.kind !== "H") continue;
    const seam = representativeHSeam(rows, edge);
    if (!seam) continue;
    const side = seam.side ?? "right";
    const key = `${seam.rowIndex}:${seam.colIndex}:${side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seams.push(seam);
  }
  return seams.sort((a, b) =>
    a.rowIndex - b.rowIndex ||
    a.colIndex - b.colIndex ||
    (a.side ?? "right").localeCompare(b.side ?? "right"),
  );
}

function representativeHSeam(rows: FormRow[], edge: MergeEdge): HSeam | null {
  const leftRects = edge.left
    .map((addr) => blockRectFromOwner(addr, rows))
    .filter((rect): rect is CellBlockRect => !!rect);
  const rightRects = edge.right
    .map((addr) => blockRectFromOwner(addr, rows))
    .filter((rect): rect is CellBlockRect => !!rect);
  if (leftRects.length === 0 || rightRects.length === 0) return null;

  const largestLeft = largestRect(leftRects);
  const largestRight = largestRect(rightRects);
  if (!largestLeft || !largestRight) return null;

  const leftArea = rectArea(largestLeft);
  const rightArea = rectArea(largestRight);
  if (rightArea > leftArea) {
    return { rowIndex: largestRight.rowTop, colIndex: largestRight.colLeft, side: "left" };
  }
  return { rowIndex: largestLeft.rowTop, colIndex: largestLeft.colRight };
}

function largestRect(rects: CellBlockRect[]): CellBlockRect | null {
  return [...rects].sort((a, b) =>
    rectArea(b) - rectArea(a) ||
    a.rowTop - b.rowTop ||
    a.microLeft - b.microLeft,
  )[0] ?? null;
}

function rectArea(rect: CellBlockRect): number {
  return rect.microSpan * rect.rowSpan;
}

function horizontalEdgeForAddr(rows: FormRow[], addr: CellAddr): MergeEdge | null {
  for (const edge of mergeEdgesPass(rows)) {
    if (edge.kind !== "H") continue;
    for (const leftAddr of edge.left) {
      const rect = blockRectFromOwner(leftAddr, rows);
      if (rect && rect.rowTop === addr.rowIndex && rect.colRight === addr.cellIndex) {
        return edge;
      }
    }
  }
  for (const edge of mergeEdgesPass(rows)) {
    if (edge.kind !== "H") continue;
    for (const rightAddr of edge.right) {
      const rect = blockRectFromOwner(rightAddr, rows);
      if (rect && rect.rowTop === addr.rowIndex && rect.colLeft === addr.cellIndex) {
        return edge;
      }
    }
  }
  return null;
}

function colSpanToMicroRight(row: FormRow, startCol: number, microRight: number): number {
  const widths = rowMicro(row);
  const starts = microStarts(widths);
  let cursor = starts[startCol];
  if (cursor == null) return 0;
  let col = startCol;
  while (col < row.cells.length && cursor < microRight) {
    cursor += widths[col] ?? 0;
    col++;
  }
  return cursor === microRight ? col - startCol : 0;
}

function spanForColumns(row: FormRow, startCol: number, colSpan: number): number {
  const spans = TEMPLATE_SPANS[row.template] ?? row.cells.map((cell) => cell.span);
  return spans.slice(startCol, startCol + colSpan).reduce((sum, span) => sum + span, 0);
}

function mergeHorizontalEdge(rows: FormRow[], edge: MergeEdge): FormRow[] {
  const leftRects = edge.left
    .map((addr) => blockRectFromOwner(addr, rows))
    .filter((rect): rect is CellBlockRect => !!rect);
  const rightRects = edge.right
    .map((addr) => blockRectFromOwner(addr, rows))
    .filter((rect): rect is CellBlockRect => !!rect);
  if (leftRects.length !== edge.left.length || rightRects.length !== edge.right.length) return rows;

  const rects = [...leftRects, ...rightRects];
  const fieldRects = rects.filter((rect) => rect.cell.fieldKey != null);
  if (fieldRects.length > 1) return rows;

  const rowTop = Math.min(...rects.map((rect) => rect.rowTop));
  const rowBottom = Math.max(...rects.map((rect) => rect.rowBottom));
  const microLeft = Math.min(...rects.map((rect) => rect.microLeft));
  const microRight = Math.max(...rects.map((rect) => rect.microRight));
  const owner = [...leftRects].sort((a, b) => a.rowTop - b.rowTop || a.microLeft - b.microLeft)[0];
  if (!owner || owner.microLeft !== microLeft) return rows;

  const ownerRow = rows[owner.addr.rowIndex];
  const nextColSpan = colSpanToMicroRight(ownerRow, owner.addr.cellIndex, microRight);
  if (nextColSpan <= 0) return rows;
  const nextRowSpan = rowBottom - rowTop + 1;
  const nextSpan = spanForColumns(ownerRow, owner.addr.cellIndex, nextColSpan);
  const ownerId = owner.cell.id;
  const fieldKey = owner.cell.fieldKey ?? fieldRects[0]?.cell.fieldKey ?? null;

  return rows.map((row, ri) => ({
    ...row,
    cells: row.cells.map((cell, ci) => {
      if (ri === owner.addr.rowIndex && ci === owner.addr.cellIndex) {
        const next: FormCell = { ...cell, fieldKey, span: nextSpan };
        if (nextColSpan > 1) next.colSpan = nextColSpan;
        else delete next.colSpan;
        if (nextRowSpan > 1) next.rowSpan = nextRowSpan;
        else delete next.rowSpan;
        return next;
      }
      if (ri < rowTop || ri > rowBottom) return cell;
      const micro = cellMicroRect(row, ci);
      const inside =
        micro &&
        micro.microLeft >= microLeft &&
        micro.microRight <= microRight;
      if (!inside) return cell;
      const { rowSpan: _r, colSpan: _c, ...rest } = cell;
      return { id: rest.id, fieldKey: null, span: rest.span, absorbedBy: ownerId };
    }),
  }));
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
  // 1. Map every covered position → the owner id that claims it. Claims use the
  //    shared micro-grid rather than raw column indexes, so a right-half owner in
  //    a 25-25-50 row can legitimately cover cells 2+3 in a 50-25-25 row below.
  //    Later owners do not overwrite earlier claims (the first owner whose
  //    rectangle covers a cell wins — owners never legitimately overlap, but if a
  //    corrupt doc has two, deterministic first-wins keeps it rectangular).
  const claim = new Map<string, string>(); // "ri:ci" -> owner cell id
  rows.forEach((row, ri) => {
    row.cells.forEach((cell, ci) => {
      if (cell.absorbedBy) return; // a tombstone is not an owner
      const rs = effectiveRowSpan(cell);
      const cs = effectiveColSpan(cell);
      if (rs === 1 && cs === 1) return; // a 1×1 cell owns only itself — nothing to claim
      const ownerMicro = cellMicroRect(row, ci);
      if (!ownerMicro) return;
      for (let r = ri; r < ri + rs; r++) {
        const targetRow = rows[r];
        if (!targetRow) continue;
        for (let c = 0; c < targetRow.cells.length; c++) {
          if (r === ri && c === ci) continue; // the owner cell itself
          const targetMicro = cellMicroRect(targetRow, c);
          if (!targetMicro) continue;
          const covered =
            targetMicro.microLeft >= ownerMicro.microLeft &&
            targetMicro.microRight <= ownerMicro.microRight;
          if (!covered) continue;
          const key = `${r}:${c}`;
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
  const edge = horizontalEdgeForAddr(rows, addr);
  if (edge) {
    const merged = mergeHorizontalEdge(rows, edge);
    if (merged !== rows) return merged;
  }

  const ownerRow = vOwnerRow(rows, addr.rowIndex, addr.cellIndex);
  const ownerCol = hOwnerOf(rows, ownerRow, addr.cellIndex);
  if (ownerCol == null) return rows;
  const ownerCell = rows[ownerRow].cells[ownerCol];
  const rSpan = effectiveRowSpan(ownerCell);
  const cSpan = effectiveColSpan(ownerCell);
  const newCol = ownerCol + cSpan; // first column of the strip to absorb

  // same template across every absorbed row (a merge never crosses a template).
  for (let dr = 0; dr < rSpan; dr++) {
    if (rows[ownerRow + dr]?.template !== rows[ownerRow].template) return rows;
  }

  // Determine the field that occupies the merged block: at most one of the two
  // sides may carry a field (2026-06-01 rule). If the LEFT (this owner) is empty
  // and the RIGHT is the filled side, the field migrates LEFT into the owner
  // position so the block reads as that field — "filled left or right doesn't
  // matter, the field occupies the merge".
  const emptyTilesWidth = emptyColStripAbsorbWidth(rows, ownerRow, newCol, rSpan);

  // Case A — RIGHT strip is empty (classic grow-right). Owner keeps its field.
  if (emptyTilesWidth > 0) {
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

  // Case B — LEFT (owner) is EMPTY and the RIGHT is a single filled owner of
  // EQUAL height aligned at this row. Merge so the LEFT position owns the block
  // and carries the RIGHT's field; the right cell tombstones to the left owner.
  // (This is the empty|Colour case — clicking the handle keyed at the empty left
  // cell must pull Colour's field into the 1×2 block.)
  if (ownerCell.fieldKey == null) {
    const rRow = vOwnerRow(rows, ownerRow, newCol);
    const rCol = hOwnerOf(rows, rRow, newCol);
    if (rCol == null) return rows;
    const rightCell = rows[rRow].cells[rCol];
    const equalHeightAligned =
      rRow === ownerRow && rCol === newCol && effectiveRowSpan(rightCell) === rSpan;
    if (!equalHeightAligned || rightCell.fieldKey == null) return rows;
    const rightWidth = rightCell.span ?? 0;
    return rows.map((r, ri) => {
      if (ri < ownerRow || ri > ownerRow + rSpan - 1) return r;
      return {
        ...r,
        cells: r.cells.map((cell, ci) => {
          if (ri === ownerRow && ci === ownerCol) {
            // left position becomes the owner, carrying the right's field.
            return {
              ...cell,
              fieldKey: rightCell.fieldKey,
              colSpan: cSpan + 1,
              span: cell.span + rightWidth,
            };
          }
          if (ci === newCol) {
            return { id: cell.id, fieldKey: null, span: cell.span, absorbedBy: ownerCell.id };
          }
          return cell;
        }),
      };
    });
  }

  return rows;
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

// mergeDown absorbs the micro-aligned region directly below the tall cell that
// owns `addr` into that tall cell. It resolves the owner first (so passing a
// tombstone address extends the existing merge rather than no-opping), grows
// the owner's rowSpan, and tombstones the absorbed cells. No-op unless the
// shared edge forms an exact rectangle with at most one field.
export function mergeDown(rows: FormRow[], addr: CellAddr): FormRow[] {
  const edge = mergeEdgesPass(rows).find(
    (candidate) =>
      candidate.kind === "V" &&
      candidate.rowIndex === addr.rowIndex &&
      candidate.cellIndex === addr.cellIndex,
  );
  if (edge) {
    const merged = mergeVerticalEdge(rows, edge);
    if (merged !== rows) return merged;
  }

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
  const sameTemplateBoundary =
    below && top.template === below.template && top.cells.length === below.cells.length;
  const fullWidthBoundary =
    below && top.cells.length === below.cells.length && col === 0 && oColSpan === top.cells.length;
  const absorbedSpan =
    below && (sameTemplateBoundary || fullWidthBoundary)
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

  // Legacy UP fallback: the clicked cell is EMPTY and the cell directly below is a real
  // (non-tombstone) cell → the empty cell becomes the new owner, extending the
  // run below upward by one. Only valid when the clicked cell has span 1 (it's
  // an empty slot) and the row below shares the template.
  const clicked = rows[addr.rowIndex]?.cells[addr.cellIndex];
  const lowerRow = rows[addr.rowIndex + 1];
  if (
    clicked &&
    isEmptySlot(clicked) &&
    lowerRow &&
    rows[addr.rowIndex].cells.length === lowerRow.cells.length
  ) {
    const lowerCell = lowerRow.cells[addr.cellIndex];
    if (lowerCell && !isTombstone(lowerCell)) {
      const newSpan = effectiveRowSpan(lowerCell) + 1;
      const newOwnerId = clicked.id;
      // If the cell being absorbed is itself a HORIZONTAL owner (colSpan > 1),
      // the vertical merge only claims its left column — its other columns must
      // be SPLIT OFF and revived to standalone empty cells. Without this, those
      // columns keep absorbedBy = the old owner id, which is now a vertical
      // tombstone, so the renderer skips them and they vanish (the "r12c2
      // disappeared after merging the wide cell's left column" bug, 2026-06-01).
      const lowerOwnerId = lowerCell.id;
      const lowerColSpan = effectiveColSpan(lowerCell);
      const clickedColSpan = effectiveColSpan(clicked);
      const sameTemplateBoundary = rows[addr.rowIndex].template === lowerRow.template;
      const fullWidthBoundary =
        addr.cellIndex === 0 &&
        clickedColSpan === rows[addr.rowIndex].cells.length &&
        lowerColSpan === lowerRow.cells.length;
      if (!sameTemplateBoundary && !fullWidthBoundary) return rows;

      // Equal-width upward merge: the empty upper owner takes the lower owner's
      // field/height and preserves the full rectangle. This is the mirror of the
      // down-grow path and is what lets full-width rows merge upward across
      // 25-25-50 ↔ 50-25-25 boundaries.
      if (clickedColSpan === lowerColSpan) {
        const inCols = (ci: number) => ci >= addr.cellIndex && ci < addr.cellIndex + clickedColSpan;
        const lowerSpan = effectiveRowSpan(lowerCell);
        return rows.map((row, ri) => {
          if (ri === addr.rowIndex) {
            return {
              ...row,
              cells: row.cells.map((c, ci) =>
                ci === addr.cellIndex
                  ? { ...c, fieldKey: lowerCell.fieldKey, rowSpan: newSpan }
                  : c,
              ),
            };
          }
          if (ri >= addr.rowIndex + 1 && ri <= addr.rowIndex + lowerSpan) {
            return {
              ...row,
              cells: row.cells.map((c, ci) =>
                inCols(ci) ? { id: c.id, fieldKey: null, span: c.span, absorbedBy: newOwnerId } : c,
              ),
            };
          }
          return row;
        });
      }

      const lowerTmplSpans = TEMPLATE_SPANS[lowerRow.template] ?? [];
      return rows.map((row, ri) => {
        if (ri === addr.rowIndex) {
          // empty cell becomes owner: carries the lower cell's field + new span.
          // (It takes ONLY the lower cell's field, not its width — colSpan stays 1.)
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
          return {
            ...row,
            cells: row.cells.map((c, ci) => {
              // former owner's LEFT column becomes a tombstone of the new owner,
              // shedding any horizontal colSpan marker.
              if (ci === addr.cellIndex) {
                return { id: c.id, fieldKey: null, span: c.span, absorbedBy: newOwnerId };
              }
              // the absorbed wide cell's OTHER columns (its H-tombstones) revive
              // to standalone empty cells at their template width.
              if (lowerColSpan > 1 && c.absorbedBy === lowerOwnerId) {
                const { absorbedBy: _drop, ...rest } = c;
                return { ...rest, fieldKey: null, span: lowerTmplSpans[ci] ?? c.span };
              }
              return c;
            }),
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

function mergeVerticalEdge(rows: FormRow[], edge: MergeEdge): FormRow[] {
  const ownerAddr = edge.top[0];
  if (!ownerAddr) return rows;
  const owner = blockRectFromOwner(ownerAddr, rows);
  if (!owner) return rows;
  const tiles = edge.bottom
    .map((addr) => blockRectFromOwner(addr, rows))
    .filter((rect): rect is CellBlockRect => !!rect);
  if (tiles.length !== edge.bottom.length) return rows;
  const absorbedSpan = commonRowSpan(tiles);
  if (absorbedSpan <= 0) return rows;

  const fieldTiles = [owner, ...tiles].filter((rect) => rect.cell.fieldKey != null);
  if (fieldTiles.length > 1) return rows;
  const fieldKey = owner.cell.fieldKey ?? fieldTiles[0]?.cell.fieldKey ?? null;
  const absorbedOwnerIds = new Set(tiles.map((tile) => tile.cell.id));
  const ownerId = owner.cell.id;
  const nextSpan = owner.rowSpan + absorbedSpan;

  return rows.map((row, ri) => ({
    ...row,
    cells: row.cells.map((cell, ci) => {
      if (ri === owner.addr.rowIndex && ci === owner.addr.cellIndex) {
        return { ...cell, fieldKey, rowSpan: nextSpan };
      }
      if (absorbedOwnerIds.has(cell.id) || (cell.absorbedBy && absorbedOwnerIds.has(cell.absorbedBy))) {
        const { rowSpan: _r, colSpan: _c, ...rest } = cell;
        return { id: rest.id, fieldKey: null, span: rest.span, absorbedBy: ownerId };
      }
      return cell;
    }),
  }));
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

// A Band is a maximal run of adjacent rows sharing one slot count. Within a band,
// merged cells span multiple sub-rows. A band with no merges is just its rows.
export interface Band {
  startRow: number; // index into rows[] of the first row in the band
  rows: FormRow[];
  subRowCount: number; // number of grid rows the band occupies (== rows.length)
}

// bandsOf groups CONTIGUOUS rows that share a column count into one band.
// Critically this is NOT gated on merge-linkage: adjacent 3-slot rows form ONE
// band even when their templates differ, because all templates render on the
// shared 60-track micro-grid. That lets exact rectangles span across a
// 25-25-50 ↔ 50-25-25 boundary once their current merged widths line up.
// subRowCount == row count (tombstones keep every column rectangular). A
// column-count change starts a new band.
export function bandsOf(rows: FormRow[]): Band[] {
  const bands: Band[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (
      j < rows.length &&
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

// rowHasVerticalTombstoneFrom: does `row` (at index `rowIndex`) contain a
// VERTICAL tombstone — a cell covered by an owner in an EARLIER row? Only a
// vertical merge ties a row to the one above; a HORIZONTAL tombstone (owner in
// the SAME row, from mergeRight) does NOT. The old code checked `isTombstone`
// for ANY tombstone, so an H-merged row was wrongly linked to the row above —
// fusing two different-template bands into one merge-group, which dropped the
// lower band's drag/delete aside and let merged cells render out of alignment.
// (Bug origin 2026-06-01: an H-merged 50-50 row above an H-merged 30-30-30 row
// fused; the 30-30-30 band lost its handle.) A vertical tombstone is identified
// by its owner id appearing in the SAME COLUMN of a PRIOR row (vOwnerRow walks up
// the column); a horizontal tombstone's owner is in this same row.
function rowHasVerticalTombstoneFrom(rows: FormRow[], rowIndex: number): boolean {
  const row = rows[rowIndex];
  return row.cells.some((c, ci) => {
    if (!isTombstone(c)) return false;
    // vertical iff the owner resolves to an EARLIER row in this column.
    return vOwnerRow(rows, rowIndex, ci) < rowIndex;
  });
}

// mergeGroupsOf partitions rows into consecutive groups tied by a VERTICAL merge.
// A boundary between row i and i+1 is "linked" iff row i+1 contains a vertical
// tombstone (a cell covered by a merge from a row ABOVE). Horizontal-only merges
// never link rows. Consecutive linked boundaries extend the same group.
export function mergeGroupsOf(rows: FormRow[]): MergeGroup[] {
  const groups: MergeGroup[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    // extend while the NEXT row is tied to the current group by a VERTICAL merge.
    while (j < rows.length && rowHasVerticalTombstoneFrom(rows, j)) j++;
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
