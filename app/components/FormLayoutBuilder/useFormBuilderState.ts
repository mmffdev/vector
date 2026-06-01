"use client";

// useFormBuilderState — the row/cell mutation engine for the Form Layout
// Builder. Pure state transitions, no dnd, no fetch. The shell wires
// @dnd-kit events to these methods.
//
// Cell IDs are stable within a session; row IDs likewise. We mint new
// ones with a monotonic counter (no Date.now / Math.random in this file
// is fine — it runs in the browser, but a counter is simpler + stable).

import { useCallback, useState } from "react";
import type { FormRow, FormCell, RowTemplate } from "@/app/lib/formLayoutsApi";
import { TEMPLATE_SPANS } from "@/app/lib/formLayoutsApi";
import {
  mergeDown as mergeDownRows,
  splitCell as splitCellRows,
  mergeRight as mergeRightRows,
  splitCellH as splitCellHRows,
  removeRow as removeRowMergeAware,
  moveGroup as moveGroupRows,
  unmergeGroup as unmergeGroupRows,
  normalizeOwnership,
} from "./mergeTransitions";

// _seq mints monotonic suffixes for new row/cell IDs WITHIN a session. It is
// module-level (one counter per page load), so a freshly-loaded DRAFT carries
// IDs minted in a PRIOR session ("cell-2", "row-1", …) that start over from 1.
// If we don't advance _seq past those, the next addRow/placeField mints a
// COLLIDING id — and duplicate IDs silently corrupt ownerOf / hOwnerOf /
// vOwnerRow (they resolve absorbedBy to the FIRST matching id, i.e. the wrong
// cell), which breaks seam placement and every merge on a reloaded draft.
// `bumpSeqPast` (called from reset) closes that hole. Origin: 2026-05-31 —
// reloaded "Blocked" draft had 3× cell-2 / 3× row-1, stranding/​dropping seam
// handles around the Blocked cell.
let _seq = 0;
function nextId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${_seq}`;
}

// bumpSeqPast scans a loaded document's row + cell IDs and advances _seq past
// the highest numeric suffix it finds (matching our "<prefix>-<n>" minting), so
// subsequently-minted IDs can never collide with the loaded ones. IDs that
// don't match the numeric pattern are ignored (they can't collide with our
// counter-based scheme anyway).
function bumpSeqPast(rows: FormRow[]): void {
  let max = _seq;
  const consider = (id: string | undefined) => {
    if (!id) return;
    const m = /-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const r of rows) {
    consider(r.id);
    for (const c of r.cells) consider(c.id);
  }
  _seq = max;
}

// hasDuplicateIds — true if any row or cell id repeats across the document.
// A duplicate makes absorbedBy ambiguous (ownerOf resolves to the FIRST match),
// so a corrupt draft must be re-keyed before use.
function hasDuplicateIds(rows: FormRow[]): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) return true;
    seen.add(r.id);
    for (const c of r.cells) {
      if (seen.has(c.id)) return true;
      seen.add(c.id);
    }
  }
  return false;
}

// repairDuplicateIds re-keys a document so every row + cell id is unique, while
// PRESERVING merge geometry. The challenge: a tombstone's `absorbedBy` points to
// its owner BY ID — but with duplicate IDs that pointer is ambiguous. So we first
// resolve each tombstone's owner POSITIONALLY (the nearest real cell above in the
// same column = vertical owner; if that owner is itself wide, the rectangle's
// top-left cell = the canonical owner), then assign fresh IDs and repoint every
// absorbedBy to its owner's NEW id. Cells with no resolvable owner (orphaned
// tombstones from prior corruption) are revived to empty cells — fail-safe, never
// leave a dangling tombstone. Only called when hasDuplicateIds is true.
function repairDuplicateIds(rows: FormRow[]): FormRow[] {
  // 1. Assign a fresh unique id to every cell, keyed by (rowIndex, colIndex) —
  //    position is unambiguous even when ids collide.
  const newCellId: string[][] = rows.map((r) => r.cells.map(() => nextId("cell")));
  const newRowId: string[] = rows.map(() => nextId("row"));

  // 2. Resolve a tombstone's owner position by walking up the same column to the
  //    nearest non-tombstone cell (its vertical owner). That owner may itself be
  //    horizontally absorbed — but for V-tombstones in a column, the owner is the
  //    real cell directly above. For H-tombstones (absorbed within a row by a
  //    wide cell), walk LEFT to the nearest real cell in the same row.
  const isTomb = (ri: number, ci: number) => !!rows[ri]?.cells[ci]?.absorbedBy;
  const ownerOfPos = (ri: number, ci: number): { r: number; c: number } | null => {
    // vertical tombstone: nearest real cell above in this column.
    for (let r = ri - 1; r >= 0; r--) {
      if (!rows[r]?.cells[ci]) break;
      if (!isTomb(r, ci)) return { r, c: ci };
    }
    // horizontal tombstone: nearest real cell to the left in this row.
    for (let c = ci - 1; c >= 0; c--) {
      if (!rows[ri]?.cells[c]) break;
      if (!isTomb(ri, c)) return { r: ri, c };
    }
    return null;
  };

  return rows.map((row, ri) => ({
    ...row,
    id: newRowId[ri],
    cells: row.cells.map((cell, ci) => {
      if (!cell.absorbedBy) return { ...cell, id: newCellId[ri][ci] };
      const owner = ownerOfPos(ri, ci);
      if (!owner) {
        // orphaned tombstone → revive to a plain empty cell (fail-safe).
        const { absorbedBy: _drop, ...rest } = cell;
        return { ...rest, id: newCellId[ri][ci], fieldKey: null };
      }
      return { ...cell, id: newCellId[ri][ci], absorbedBy: newCellId[owner.r][owner.c] };
    }),
  }));
}

// emptyRow materialises a row from a template: one empty cell per span.
export function emptyRow(template: RowTemplate): FormRow {
  const spans = TEMPLATE_SPANS[template];
  return {
    id: nextId("row"),
    template,
    cells: spans.map((span) => ({ id: nextId("cell"), fieldKey: null, span })),
  };
}

// A cell address within the grid.
export interface CellAddr {
  rowIndex: number;
  cellIndex: number;
}

export interface FormBuilderState {
  rows: FormRow[];
  /** Keys currently placed on the canvas (so the sidebar can grey them). */
  placedKeys: Set<string>;
  addRow: (template: RowTemplate) => void;
  /** Insert an empty template row at a specific position (push existing down). */
  insertRowAt: (template: RowTemplate, rowIndex: number) => void;
  /** Reorder a row from one position to another (drag up/down). */
  moveRow: (fromIndex: number, toIndex: number) => void;
  /** Remove a row (merge-aware: shrinks/splits any column merge touching it). */
  removeRow: (rowIndex: number) => void;
  /** Move a whole merge group (consecutive rows) to a new gap, merges intact. */
  moveGroup: (startRow: number, count: number, toIndex: number) => void;
  /** Un-merge every merge in a group, keeping the rows (group delete handle). */
  unmergeGroup: (startRow: number, count: number) => void;
  /** Place a field from the sidebar into a specific empty cell. */
  placeField: (fieldKey: string, addr: CellAddr) => void;
  /** Move a placed field from one cell to another (swap-aware). */
  moveField: (from: CellAddr, to: CellAddr) => void;
  /** Remove a field from a cell (send it back to the sidebar). */
  clearCell: (addr: CellAddr) => void;
  /** Insert a new single-column row carrying `fieldKey` at rowIndex,
   *  pushing existing rows (and their fields) down. */
  insertFieldAsRow: (fieldKey: string, rowIndex: number) => void;
  /** Fuse the tall cell owning `addr` with the empty cell below it (vertical
   *  merge). No-op unless the lower cell is empty + same-template. */
  mergeDown: (addr: CellAddr) => void;
  /** Un-fuse a tall cell at `addr` back into one cell per row (split). */
  splitCell: (addr: CellAddr) => void;
  /** Fuse the cell owning `addr` with the empty cell to its RIGHT (horizontal
   *  merge). No-op unless the right cell is empty + single-row. */
  mergeRight: (addr: CellAddr) => void;
  /** Un-fuse a wide cell at `addr` back into one cell per column. */
  splitCellH: (addr: CellAddr) => void;
  reset: (rows: FormRow[]) => void;
  /** Undo the last mutation (no-op if nothing to undo). */
  undo: () => void;
  /** Redo the last undone mutation (no-op if nothing to redo). */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// History container — the document is one immutable `rows` value, so undo/redo
// is just a stack of snapshots. `past` holds states we can return to; `future`
// holds states we undid away from (cleared on any fresh edit). Capped so a long
// session can't grow unbounded.
interface History {
  rows: FormRow[];
  past: FormRow[][];
  future: FormRow[][];
}
const HISTORY_CAP = 100;

export function useFormBuilderState(initial: FormRow[]): FormBuilderState {
  const [hist, setHist] = useState<History>({ rows: initial, past: [], future: [] });
  const rows = hist.rows;

  // setRows — every mutation routes through here. It snapshots the PREVIOUS rows
  // onto `past` (one undo step per action) and clears `future`. A no-op update
  // (updater returns the same reference) records no history, so dead clicks don't
  // pollute the stack. Signature matches the old setRows so method bodies below
  // are unchanged.
  const setRows = useCallback((updater: (prev: FormRow[]) => FormRow[]) => {
    setHist((h) => {
      const next = updater(h.rows);
      if (next === h.rows) return h; // no change → no history entry
      const past = [...h.past, h.rows];
      if (past.length > HISTORY_CAP) past.shift();
      return { rows: next, past, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setHist((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      return { rows: prev, past: h.past.slice(0, -1), future: [h.rows, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHist((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      return { rows: next, past: [...h.past, h.rows], future: h.future.slice(1) };
    });
  }, []);

  const placedKeys = collectPlacedKeys(rows);

  const addRow = useCallback((template: RowTemplate) => {
    setRows((prev) => [...prev, emptyRow(template)]);
  }, []);

  // insertRowAt drops an EMPTY template row at a gap, pushing existing
  // rows down — the "add a new row between existing ones" affordance.
  const insertRowAt = useCallback((template: RowTemplate, rowIndex: number) => {
    setRows((prev) => {
      const clamped = Math.max(0, Math.min(rowIndex, prev.length));
      return [...prev.slice(0, clamped), emptyRow(template), ...prev.slice(clamped)];
    });
  }, []);

  // moveRow reorders a row to a new position. toIndex is interpreted in
  // the pre-removal coordinate space (the gap index the user dropped on);
  // we splice after removing the source so the target lands correctly.
  const moveRow = useCallback((fromIndex: number, toIndex: number) => {
    setRows((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      const without = [...prev.slice(0, fromIndex), ...prev.slice(fromIndex + 1)];
      const dest = toIndex > fromIndex ? toIndex - 1 : toIndex;
      const clamped = Math.max(0, Math.min(dest, without.length));
      return [...without.slice(0, clamped), prev[fromIndex], ...without.slice(clamped)];
    });
  }, []);

  // Merge-aware: deleting a row shrinks/splits any column merge that touches it
  // so no dangling rowSpan/tombstone survives.
  const removeRow = useCallback((rowIndex: number) => {
    setRows((prev) => removeRowMergeAware(prev, rowIndex));
  }, []);

  const moveGroup = useCallback((startRow: number, count: number, toIndex: number) => {
    setRows((prev) => moveGroupRows(prev, startRow, count, toIndex));
  }, []);

  const unmergeGroup = useCallback((startRow: number, count: number) => {
    setRows((prev) => unmergeGroupRows(prev, startRow, count));
  }, []);

  const placeField = useCallback((fieldKey: string, addr: CellAddr) => {
    setRows((prev) => editCell(prev, addr, (c) => ({ ...c, fieldKey })));
  }, []);

  const clearCell = useCallback((addr: CellAddr) => {
    setRows((prev) => editCell(prev, addr, (c) => ({ ...c, fieldKey: null })));
  }, []);

  const moveField = useCallback((from: CellAddr, to: CellAddr) => {
    setRows((prev) => {
      const fromCell = prev[from.rowIndex]?.cells[from.cellIndex];
      const toCell = prev[to.rowIndex]?.cells[to.cellIndex];
      if (!fromCell || !toCell) return prev;
      const movedKey = fromCell.fieldKey;
      const displacedKey = toCell.fieldKey; // swap target's content back to source
      let next = editCell(prev, to, (c) => ({ ...c, fieldKey: movedKey }));
      next = editCell(next, from, (c) => ({ ...c, fieldKey: displacedKey }));
      return next;
    });
  }, []);

  // insertFieldAsRow implements the "insertion pushes down" contract:
  // dropping a field between two stacked fields inserts a new full-width
  // row at that position carrying the field, shifting everything below
  // down one grid position — never overwriting an occupied slot.
  const insertFieldAsRow = useCallback((fieldKey: string, rowIndex: number) => {
    setRows((prev) => {
      const row: FormRow = {
        id: nextId("row"),
        template: "100",
        cells: [{ id: nextId("cell"), fieldKey, span: 100 }],
      };
      const clamped = Math.max(0, Math.min(rowIndex, prev.length));
      return [...prev.slice(0, clamped), row, ...prev.slice(clamped)];
    });
  }, []);

  // Every merge/split runs through normalizeOwnership AFTER the raw transform.
  // The transforms grow/shrink one owner rectangle at a time; a transform that
  // touches a cell which was ALSO an owner on the other axis (e.g. a vertical
  // merge into a cell that horizontally owns a wide block) can leave a tombstone
  // pointing at an id that is no longer an owner — the renderer skips it and the
  // cell VANISHES. normalizeOwnership is idempotent + fail-closed: it rebuilds
  // every tombstone from the surviving owners' spans and revives any orphan to a
  // plain empty cell, so the whole orphan-vanish class is closed at the seam,
  // not patched per-path. (Origin 2026-06-01: "merge r1+r2 → r3 vanished",
  // repeatable across columns — same root as the wide-cell-split vanish.)
  // normalizeIfChanged runs normalizeOwnership ONLY when the raw transform
  // actually mutated the document (reference changed). A no-op transform returns
  // `prev` unchanged, so setRows's reference-equality no-op guard still suppresses
  // an empty history entry — normalize must not allocate on a no-op.
  const normalizeIfChanged = (prev: FormRow[], next: FormRow[]) =>
    next === prev ? prev : normalizeOwnership(next);

  const mergeDown = useCallback((addr: CellAddr) => {
    setRows((prev) => normalizeIfChanged(prev, mergeDownRows(prev, addr)));
  }, []);

  const splitCell = useCallback((addr: CellAddr) => {
    setRows((prev) => normalizeIfChanged(prev, splitCellRows(prev, addr)));
  }, []);

  const mergeRight = useCallback((addr: CellAddr) => {
    setRows((prev) => normalizeIfChanged(prev, mergeRightRows(prev, addr)));
  }, []);

  const splitCellH = useCallback((addr: CellAddr) => {
    setRows((prev) => normalizeIfChanged(prev, splitCellHRows(prev, addr)));
  }, []);

  // reset replaces the document wholesale (draft load / reopen) and CLEARS the
  // undo/redo history — you can't undo past a fresh load into a prior document's
  // edits.
  const reset = useCallback((next: FormRow[]) => {
    // Advance the ID counter past the loaded document so new rows/cells can't
    // mint a colliding id (duplicate IDs corrupt owner resolution → broken
    // seams). See bumpSeqPast.
    bumpSeqPast(next);
    // If the loaded document ALREADY contains duplicate IDs (a draft saved by an
    // older build that minted colliding ids), re-key it so owner resolution is
    // unambiguous. bumpSeqPast already ran, so repair mints from a safe high
    // watermark. See repairDuplicateIds.
    const deduped = hasDuplicateIds(next) ? repairDuplicateIds(next) : next;
    // Rebuild tombstone ownership from the owners' spans, so a draft saved with a
    // stale/cross-wired absorbedBy (an overlapping merge / drag / undo left a
    // stolen corner) self-heals on reopen — and can't re-trip the server's
    // rectangle validator on the next save. See normalizeOwnership.
    const clean = normalizeOwnership(deduped);
    setHist({ rows: clean, past: [], future: [] });
  }, []);

  return {
    rows,
    placedKeys,
    addRow,
    insertRowAt,
    moveRow,
    removeRow,
    moveGroup,
    unmergeGroup,
    placeField,
    moveField,
    clearCell,
    insertFieldAsRow,
    mergeDown,
    splitCell,
    mergeRight,
    splitCellH,
    reset,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────

function collectPlacedKeys(rows: FormRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) for (const c of r.cells) if (c.fieldKey) s.add(c.fieldKey);
  return s;
}

function editCell(
  rows: FormRow[],
  addr: CellAddr,
  fn: (c: FormCell) => FormCell,
): FormRow[] {
  return rows.map((r, ri) =>
    ri !== addr.rowIndex
      ? r
      : { ...r, cells: r.cells.map((c, ci) => (ci !== addr.cellIndex ? c : fn(c))) },
  );
}
