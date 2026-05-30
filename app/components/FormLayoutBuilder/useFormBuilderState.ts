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

let _seq = 0;
function nextId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${_seq}`;
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
  removeRow: (rowIndex: number) => void;
  /** Place a field from the sidebar into a specific empty cell. */
  placeField: (fieldKey: string, addr: CellAddr) => void;
  /** Move a placed field from one cell to another (swap-aware). */
  moveField: (from: CellAddr, to: CellAddr) => void;
  /** Remove a field from a cell (send it back to the sidebar). */
  clearCell: (addr: CellAddr) => void;
  /** Insert a new single-column row carrying `fieldKey` at rowIndex,
   *  pushing existing rows (and their fields) down. */
  insertFieldAsRow: (fieldKey: string, rowIndex: number) => void;
  reset: (rows: FormRow[]) => void;
}

export function useFormBuilderState(initial: FormRow[]): FormBuilderState {
  const [rows, setRows] = useState<FormRow[]>(initial);

  const placedKeys = collectPlacedKeys(rows);

  const addRow = useCallback((template: RowTemplate) => {
    setRows((prev) => [...prev, emptyRow(template)]);
  }, []);

  const removeRow = useCallback((rowIndex: number) => {
    setRows((prev) => prev.filter((_, i) => i !== rowIndex));
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

  const reset = useCallback((next: FormRow[]) => setRows(next), []);

  return {
    rows,
    placedKeys,
    addRow,
    removeRow,
    placeField,
    moveField,
    clearCell,
    insertFieldAsRow,
    reset,
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
