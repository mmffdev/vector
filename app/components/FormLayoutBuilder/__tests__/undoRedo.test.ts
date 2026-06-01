// Undo/redo history for the Form Layout Builder. The document is one immutable
// `rows` value, so history is a snapshot stack. These tests drive the real hook.
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormBuilderState } from "../useFormBuilderState";

describe("useFormBuilderState — undo / redo", () => {
  it("starts with nothing to undo or redo", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo reverses the last action; redo replays it", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("100"));
    act(() => result.current.addRow("50-50"));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].template).toBe("100");
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[1].template).toBe("50-50");
  });

  it("a fresh edit after undo clears the redo stack", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("100"));
    act(() => result.current.addRow("50-50"));
    act(() => result.current.undo()); // back to 1 row, redo available
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.addRow("30-30-30")); // new edit
    expect(result.current.canRedo).toBe(false);
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[1].template).toBe("30-30-30");
  });

  it("a no-op mutation records no history entry", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("30-30-30"));
    // mergeRight on an occupied/edge cell that can't merge → no change
    act(() => result.current.mergeDown({ rowIndex: 0, cellIndex: 0 })); // nothing below → no-op
    // only the addRow should be undoable
    act(() => result.current.undo());
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("reset clears the undo/redo history", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("100"));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.reset([]));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo/redo round-trips a vertical merge", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("30-30-30"));
    act(() => result.current.addRow("30-30-30"));
    act(() => result.current.mergeDown({ rowIndex: 0, cellIndex: 0 }));
    expect(result.current.rows[0].cells[0].rowSpan).toBe(2);
    act(() => result.current.undo());
    expect(result.current.rows[0].cells[0].rowSpan).toBeUndefined();
    act(() => result.current.redo());
    expect(result.current.rows[0].cells[0].rowSpan).toBe(2);
  });
});

// ── corrupt-draft ID repair (reset re-keys duplicate IDs) ────────────────────
// A draft saved by an older build could carry COLLIDING row/cell IDs (the seq
// counter restarted at 1 on reload). Duplicate IDs corrupt ownerOf/absorbedBy
// resolution → broken seams + merges. reset() must re-key to unique IDs while
// preserving merge geometry. Origin: 2026-05-31 "Blocked" draft (3× cell-2).
import { isTombstone, effectiveRowSpan } from "../mergeTransitions";
import type { FormRow } from "@/app/lib/formLayoutsApi";

describe("useFormBuilderState — corrupt-draft repair on reset", () => {
  it("re-keys duplicate IDs and repoints absorbedBy to the right owner", () => {
    // Two rows that BOTH reuse id 'cell-1' for the owner and 'cell-2' for the
    // tombstone — a vertical merge with colliding IDs. The tombstone's
    // absorbedBy ('cell-1') is ambiguous across the document.
    const corrupt: FormRow[] = [
      { id: "row-1", template: "100", cells: [{ id: "cell-1", fieldKey: "Tall", span: 100, rowSpan: 2 }] },
      { id: "row-1", template: "100", cells: [{ id: "cell-2", fieldKey: null, span: 100, absorbedBy: "cell-1" }] },
      { id: "row-1", template: "100", cells: [{ id: "cell-1", fieldKey: "Other", span: 100 }] }, // dup id 'cell-1'
    ];
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.reset(corrupt));
    const rows = result.current.rows;
    // every id is now unique
    const ids = new Set<string>();
    let dup = false;
    rows.forEach((r) => { if (ids.has(r.id)) dup = true; ids.add(r.id); r.cells.forEach((c) => { if (ids.has(c.id)) dup = true; ids.add(c.id); }); });
    expect(dup).toBe(false);
    // geometry preserved: row1's tombstone still absorbed by row0's owner (its NEW id)
    expect(isTombstone(rows[1].cells[0])).toBe(true);
    expect(rows[1].cells[0].absorbedBy).toBe(rows[0].cells[0].id);
    expect(effectiveRowSpan(rows[0].cells[0])).toBe(2);
    // and a fresh addRow can't collide (the real bug): mint a new row, ids stay unique
    act(() => result.current.addRow("100"));
    const ids2 = new Set<string>();
    let dup2 = false;
    result.current.rows.forEach((r) => { if (ids2.has(r.id)) dup2 = true; ids2.add(r.id); r.cells.forEach((c) => { if (ids2.has(c.id)) dup2 = true; ids2.add(c.id); }); });
    expect(dup2).toBe(false);
  });

  it("clean (unique-ID) documents pass through reset unchanged", () => {
    const clean: FormRow[] = [
      { id: "row-10", template: "50-50", cells: [{ id: "cell-20", fieldKey: "A", span: 50 }, { id: "cell-21", fieldKey: null, span: 50 }] },
    ];
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.reset(clean));
    // ids untouched (no needless re-key churn)
    expect(result.current.rows[0].id).toBe("row-10");
    expect(result.current.rows[0].cells[0].id).toBe("cell-20");
  });
});

// ── every merge self-heals: no orphaned tombstone survives a mutation ────────
// Origin 2026-06-01: "merge r1+r2 → r3 vanished", repeatable across columns. A
// raw merge transform can leave a tombstone pointing at a cell that is no longer
// an owner (it became a tombstone on the other axis) → the renderer skips it and
// the cell VANISHES. The hook now runs normalizeOwnership after every merge/split,
// so no orphan can survive to render. These tests drive the real hook and assert
// FULL coverage (no hole) + zero dangling absorbedBy.
import { effectiveColSpan } from "../mergeTransitions";

// coverageHoles: render-faithful sweep of a 3-col band — every non-tombstone
// cell covers rowSpan×colSpan; a position no owner covers is a HOLE (the bug).
function coverageHoles(rows: FormRow[]): string[] {
  const R = rows.length;
  const grid: (string | null)[][] = Array.from({ length: R }, () => [null, null, null]);
  rows.forEach((row, lr) =>
    row.cells.forEach((cell, ci) => {
      if (isTombstone(cell)) return;
      const rs = effectiveRowSpan(cell);
      const cs = effectiveColSpan(cell);
      for (let r = lr; r < lr + rs; r++)
        for (let c = ci; c < ci + cs; c++) if (r < R && c < 3) grid[r][c] = cell.id;
    }),
  );
  const holes: string[] = [];
  grid.forEach((row, r) => row.forEach((v, c) => { if (v === null) holes.push(`r${r}c${c}`); }));
  return holes;
}

// danglingTombstones: any tombstone whose absorbedBy id is not a present owner.
function danglingTombstones(rows: FormRow[]): string[] {
  const ownerIds = new Set<string>();
  rows.forEach((row) => row.cells.forEach((c) => { if (!isTombstone(c)) ownerIds.add(c.id); }));
  const bad: string[] = [];
  rows.forEach((row) => row.cells.forEach((c) => {
    if (isTombstone(c) && !ownerIds.has(c.absorbedBy!)) bad.push(c.id);
  }));
  return bad;
}

describe("useFormBuilderState — merges self-heal (no vanished cell)", () => {
  it("vertical merge into the LEFT owner of a wide cell revives the orphaned column", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("30-30-30"));
    act(() => result.current.addRow("30-30-30"));
    act(() => result.current.addRow("30-30-30"));
    // r1 col0 → 1×2 wide, then merge col0 down from r0 into it.
    act(() => result.current.mergeRight({ rowIndex: 1, cellIndex: 0 }));
    expect(effectiveColSpan(result.current.rows[1].cells[0])).toBe(2);
    act(() => result.current.mergeDown({ rowIndex: 0, cellIndex: 0 }));

    expect(coverageHoles(result.current.rows)).toEqual([]); // r1c1 must NOT vanish
    expect(danglingTombstones(result.current.rows)).toEqual([]);
  });

  it("chained merges across the wide-cell region never leave a hole", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    for (let i = 0; i < 4; i++) act(() => result.current.addRow("30-30-30"));
    // build the is_blocked-style shape: r1 col1 wide, r2 col1 wide, then merge
    // col1 down through them, and merge col0 around the tall cell.
    act(() => result.current.mergeRight({ rowIndex: 1, cellIndex: 1 }));
    act(() => result.current.mergeRight({ rowIndex: 2, cellIndex: 1 }));
    act(() => result.current.mergeDown({ rowIndex: 1, cellIndex: 1 })); // col1 wide r1→r2 (2×2)
    act(() => result.current.mergeDown({ rowIndex: 0, cellIndex: 0 })); // col0 r0→r1
    act(() => result.current.mergeDown({ rowIndex: 1, cellIndex: 0 })); // extend col0 → r2

    expect(coverageHoles(result.current.rows)).toEqual([]);
    expect(danglingTombstones(result.current.rows)).toEqual([]);
  });
});
