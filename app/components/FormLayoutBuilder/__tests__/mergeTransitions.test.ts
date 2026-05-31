// mergeTransitions tests — vertical cell merge for the Form Layout Builder.
// Pure transforms, no React. Covers mergeDown / splitCell inverse property,
// seam eligibility (same-template + empty-lower only), and band detection.
//
// See docs/superpowers/specs/2026-05-31-flb-vertical-merge-design.md.

import { describe, it, expect } from "vitest";
import type { FormRow } from "@/app/lib/formLayoutsApi";
import {
  mergeDown,
  splitCell,
  seamsFor,
  bandsOf,
  removeRow,
  mergeGroupsOf,
  moveGroup,
  unmergeGroup,
  hSeamsFor,
  mergeRight,
  splitCellH,
  effectiveRowSpan,
  effectiveColSpan,
  isTombstone,
} from "../mergeTransitions";

// ── builders ──────────────────────────────────────────────────────────────

let seq = 0;
const cell = (fieldKey: string | null, span = 33) => ({
  id: `c${seq++}`,
  fieldKey,
  span,
});

// A 3-col (30-30-30) row from three fieldKeys (null = empty slot).
const row3 = (a: string | null, b: string | null, c: string | null): FormRow => ({
  id: `r${seq++}`,
  template: "30-30-30",
  cells: [cell(a), cell(b), cell(c)],
});

const row1 = (a: string | null): FormRow => ({
  id: `r${seq++}`,
  template: "100",
  cells: [cell(a, 100)],
});

// ── seamsFor ────────────────────────────────────────────────────────────────

describe("seamsFor", () => {
  it("offers a seam only where lower cell is empty and templates match", () => {
    const rows = [
      row3("Estimate", "Notes", "Owner"),
      row3("Start", null, "Due"), // only the MIDDLE lower cell is empty
    ];
    const seams = seamsFor(rows);
    expect(seams).toEqual([{ rowIndex: 0, colIndex: 1 }]);
  });

  it("offers no seam across different templates", () => {
    const rows = [row3("A", "B", "C"), row1(null)];
    expect(seamsFor(rows)).toEqual([]);
  });

  it("offers no seam when the lower cell is occupied", () => {
    const rows = [row3("A", "B", "C"), row3("D", "E", "F")];
    expect(seamsFor(rows)).toEqual([]);
  });

  it("offers a tall cell's seam at its BOTTOM edge only (extend downward)", () => {
    // Merge col 0 of rows 0+1; the tall cell now bottoms at row 1. With row 2's
    // col 0 empty, exactly one col-0 seam should appear — at row 1 (the base) —
    // not at row 0 (mid-span).
    const rows = mergeDown(
      [row3("A", null, "C"), row3(null, null, "F"), row3(null, null, "I")],
      { rowIndex: 0, cellIndex: 0 },
    );
    const col0 = seamsFor(rows).filter((s) => s.colIndex === 0);
    expect(col0).toEqual([{ rowIndex: 1, colIndex: 0 }]);
  });
});

// ── mergeDown ────────────────────────────────────────────────────────────────

describe("mergeDown", () => {
  it("grows the top cell rowSpan and tombstones the cell below", () => {
    const rows = [row3("Est", "Notes", "Owner"), row3("Start", null, "Due")];
    const topId = rows[0].cells[1].id;
    const next = mergeDown(rows, { rowIndex: 0, cellIndex: 1 });

    expect(effectiveRowSpan(next[0].cells[1])).toBe(2);
    expect(next[1].cells[1].fieldKey).toBeNull();
    expect(next[1].cells[1].absorbedBy).toBe(topId);
    expect(isTombstone(next[1].cells[1])).toBe(true);
    // other columns untouched
    expect(next[1].cells[0].fieldKey).toBe("Start");
    expect(next[1].cells[2].fieldKey).toBe("Due");
  });

  it("merges down N rows by chaining (rowSpan 3)", () => {
    let rows = [row3("Desc", "B", "C"), row3(null, "E", "F"), row3(null, "H", "I")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 }); // 1+2
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 0 }); // extend into row 2
    expect(effectiveRowSpan(rows[0].cells[0])).toBe(3);
    expect(rows[1].cells[0].absorbedBy).toBe(rows[0].cells[0].id);
    expect(rows[2].cells[0].absorbedBy).toBe(rows[0].cells[0].id);
  });

  it("is a no-op when the lower cell is occupied", () => {
    const rows = [row3("A", "B", "C"), row3("D", "E", "F")];
    expect(mergeDown(rows, { rowIndex: 0, cellIndex: 0 })).toBe(rows);
  });

  it("is a no-op across template boundaries", () => {
    const rows = [row3("A", "B", "C"), row1(null)];
    expect(mergeDown(rows, { rowIndex: 0, cellIndex: 0 })).toBe(rows);
  });
});

// ── splitCell (inverse of merge) ─────────────────────────────────────────────

describe("splitCell", () => {
  it("is the exact inverse of a single mergeDown", () => {
    const rows = [row3("Est", "Notes", "Owner"), row3("Start", null, "Due")];
    const merged = mergeDown(rows, { rowIndex: 0, cellIndex: 1 });
    const split = splitCell(merged, { rowIndex: 0, cellIndex: 1 });

    expect(effectiveRowSpan(split[0].cells[1])).toBe(1);
    expect(split[0].cells[1].rowSpan).toBeUndefined();
    expect(split[1].cells[1].absorbedBy).toBeUndefined();
    expect(split[1].cells[1].fieldKey).toBeNull();
    expect(isTombstone(split[1].cells[1])).toBe(false);
  });

  it("revives ALL tombstones of a 3-row merge", () => {
    let rows = [row3("Desc", "B", "C"), row3(null, "E", "F"), row3(null, "H", "I")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 });
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 0 });
    const split = splitCell(rows, { rowIndex: 0, cellIndex: 0 });

    expect(effectiveRowSpan(split[0].cells[0])).toBe(1);
    expect(split[1].cells[0].absorbedBy).toBeUndefined();
    expect(split[2].cells[0].absorbedBy).toBeUndefined();
    // neighbour columns untouched
    expect(split[1].cells[1].fieldKey).toBe("E");
  });

  it("is a no-op on a 1-row cell", () => {
    const rows = [row3("A", "B", "C")];
    expect(splitCell(rows, { rowIndex: 0, cellIndex: 0 })).toBe(rows);
  });
});

// ── bandsOf ──────────────────────────────────────────────────────────────────

describe("bandsOf (contiguous same-template runs — one grid per run)", () => {
  it("groups ALL contiguous same-template rows into one band (merged or not)", () => {
    // Two 30-30-30 rows + a 100 row → the two 3-col rows are ONE band (so their
    // columns align); the 100 row is its own band. This is the fix for the gap
    // bug: same-template rows share one grid whether or not they're merged.
    const rows = [row3("A", "B", "C"), row3(null, null, null), row1(null)];
    const bands = bandsOf(rows);
    expect(bands).toHaveLength(2);
    expect(bands[0].subRowCount).toBe(2); // the two 30-30-30 rows
    expect(bands[0].startRow).toBe(0);
    expect(bands[1].subRowCount).toBe(1); // the 100 row
    expect(bands[1].startRow).toBe(2);
  });

  it("a template change starts a new band", () => {
    const rows = [row3("A", "B", "C"), row1(null), row3(null, null, null)];
    expect(bandsOf(rows).map((b) => b.subRowCount)).toEqual([1, 1, 1]);
  });

  it("merging within a run does NOT change the band grouping (still one grid)", () => {
    const rows = mergeDown(
      [row3("Desc", "B", "C"), row3(null, "E", "F"), row3(null, "H", "I")],
      { rowIndex: 0, cellIndex: 0 },
    );
    const bands = bandsOf(rows);
    expect(bands).toHaveLength(1); // all three 30-30-30 rows = one grid
    expect(bands[0].subRowCount).toBe(3);
  });
});

// ── merge UPWARD + merge-all-the-way-through ────────────────────────────────

describe("merge upward / full-run merge", () => {
  it("merges a column ALL THE WAY through 4 rows (down-chain)", () => {
    let rows = [row3("X", null, "C"), row3(null, null, "F"), row3(null, null, "I"), row3(null, null, "L")];
    // chain the middle column down through all 4 rows
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 });
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 1 });
    rows = mergeDown(rows, { rowIndex: 2, cellIndex: 1 });
    expect(effectiveRowSpan(rows[0].cells[1])).toBe(4);
    expect(rows[1].cells[1].absorbedBy).toBe(rows[0].cells[1].id);
    expect(rows[3].cells[1].absorbedBy).toBe(rows[0].cells[1].id);
  });

  it("extends a mid-canvas merge UPWARD into the empty cell above", () => {
    // Merge middle of rows 1+2, then grow it up into row 0 (whose middle is empty).
    let rows = [row3("A", null, "C"), row3("D", null, "F"), row3("G", null, "I")];
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 1 }); // owner at row1, span2
    const seams = seamsFor(rows);
    // an up-seam should be offered at the boundary row0→row1, col 1
    expect(seams.some((s) => s.rowIndex === 0 && s.colIndex === 1)).toBe(true);
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 }); // click the up-seam
    // now row 0 owns a span-3 cell covering rows 0,1,2
    expect(effectiveRowSpan(rows[0].cells[1])).toBe(3);
    expect(rows[1].cells[1].absorbedBy).toBe(rows[0].cells[1].id);
    expect(rows[2].cells[1].absorbedBy).toBe(rows[0].cells[1].id);
  });

  it("merges a real cell DOWN into an existing empty tall BLOCK (absorbs whole)", () => {
    // Description (row 1, col 0) above an empty 2-row block (rows 2-3 merged).
    // Merging Description down should absorb the WHOLE block → span 3.
    let rows = [
      row3("Title", "x", "y"),
      row3("Description", "p", "q"),
      row3(null, "r", "s"),
      row3(null, "t", "u"),
    ];
    // first build the empty tall block at col 0, rows 2-3
    rows = mergeDown(rows, { rowIndex: 2, cellIndex: 0 });
    expect(effectiveRowSpan(rows[2].cells[0])).toBe(2);
    // a seam must now be offered between Description (row1) and the block (row2)
    const seams = seamsFor(rows);
    expect(seams.some((s) => s.rowIndex === 1 && s.colIndex === 0)).toBe(true);
    // merge Description down into the block → Description spans rows 1,2,3
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 0 });
    expect(rows[1].cells[0].fieldKey).toBe("Description");
    expect(effectiveRowSpan(rows[1].cells[0])).toBe(3);
    expect(rows[2].cells[0].absorbedBy).toBe(rows[1].cells[0].id);
    expect(rows[3].cells[0].absorbedBy).toBe(rows[1].cells[0].id);
  });
});

// ── merge-aware removeRow ────────────────────────────────────────────────────

describe("removeRow (merge-aware)", () => {
  it("shrinks an owner's span when a covered (tombstone) row is deleted", () => {
    // middle merged across rows 0+1+2 (span 3); delete row 2 → span drops to 2.
    let rows = [row3("Desc", "M", "C"), row3(null, null, "F"), row3(null, null, "I")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 });
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 1 });
    expect(effectiveRowSpan(rows[0].cells[1])).toBe(3);
    const after = removeRow(rows, 2);
    expect(after).toHaveLength(2);
    expect(effectiveRowSpan(after[0].cells[1])).toBe(2);
    expect(after[1].cells[1].absorbedBy).toBe(after[0].cells[1].id);
  });

  it("splits the merge (revives tombstones) when the OWNER row is deleted", () => {
    let rows = [row3("Desc", "M", "C"), row3(null, null, "F")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 }); // owner row0 span2
    const after = removeRow(rows, 0); // delete the owner row
    expect(after).toHaveLength(1);
    // the surviving row's middle cell is a plain empty cell — no dangling ref.
    expect(after[0].cells[1].absorbedBy).toBeUndefined();
    expect(after[0].cells[1].rowSpan).toBeUndefined();
  });
});

// ── merge GROUPS (drag/delete as a unit; no fracturing) ──────────────────────

describe("mergeGroupsOf", () => {
  it("treats unmerged rows as singleton groups", () => {
    const rows = [row3("a", "b", "c"), row3("d", "e", "f")];
    expect(mergeGroupsOf(rows)).toEqual([
      { startRow: 0, count: 1, merged: false },
      { startRow: 1, count: 1, merged: false },
    ]);
  });

  it("groups rows tied by a vertical merge into one unit", () => {
    // left col merged across rows 0-1-2 → one group of 3; row 3 is its own.
    let rows = [row3("Desc", "b", "c"), row3(null, "e", "f"), row3(null, "h", "i"), row3("x", "y", "z")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 });
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 0 });
    expect(mergeGroupsOf(rows)).toEqual([
      { startRow: 0, count: 3, merged: true },
      { startRow: 3, count: 1, merged: false },
    ]);
  });

  it("fuses OVERLAPPING column-merges that share a row into one group", () => {
    // left col merges rows 0-1; right col merges rows 1-2 → rows 0-1-2 one group.
    let rows = [row3("L", "x", "p"), row3(null, "y", null), row3("m", "z", null)];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 }); // left 0-1
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 2 }); // right 1-2
    expect(mergeGroupsOf(rows)).toEqual([{ startRow: 0, count: 3, merged: true }]);
  });
});

describe("moveGroup (no fracture)", () => {
  it("moves a whole merged block together, preserving the merge", () => {
    // rows: [0 plain][1 owner span2][2 tombstone][3 plain]; group = rows 1-2.
    let rows = [row3("A", "a", "1"), row3("Desc", "b", "2"), row3(null, "c", "3"), row3("D", "d", "4")];
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 0 }); // owner row1 span2 over row2
    const groups = mergeGroupsOf(rows);
    const g = groups.find((x) => x.merged)!;
    expect(g).toEqual({ startRow: 1, count: 2, merged: true });
    // move the group to the very top (gap index 0)
    const moved = moveGroup(rows, g.startRow, g.count, 0);
    // Desc owner now at row 0, its tombstone right below at row 1, merge intact
    expect(moved[0].cells[0].fieldKey).toBe("Desc");
    expect(effectiveRowSpan(moved[0].cells[0])).toBe(2);
    expect(moved[1].cells[0].absorbedBy).toBe(moved[0].cells[0].id);
    expect(moved[1].cells[0].fieldKey).toBeNull();
  });
});

describe("unmergeGroup (delete handle = un-merge, keep rows)", () => {
  it("splits all merges in the group back to individual rows, keeping fields", () => {
    let rows = [row3("Desc", "b", "c"), row3(null, "e", "f"), row3(null, "h", "i")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 });
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 0 });
    const after = unmergeGroup(rows, 0, 3);
    expect(after).toHaveLength(3); // rows kept
    expect(effectiveRowSpan(after[0].cells[0])).toBe(1); // un-merged
    expect(after[1].cells[0].absorbedBy).toBeUndefined();
    expect(after[2].cells[0].absorbedBy).toBeUndefined();
    expect(after[0].cells[0].fieldKey).toBe("Desc"); // field preserved on top row
  });
});

// ── horizontal merge (join cells across columns in one row) ──────────────────

describe("hSeamsFor + mergeRight", () => {
  it("offers a horizontal seam only where the RIGHT cell is empty", () => {
    // [A][empty][C] → only the seam between col0 and col1 (right cell empty).
    const rows = [row3("A", null, "C")];
    expect(hSeamsFor(rows)).toEqual([{ rowIndex: 0, colIndex: 0 }]);
  });

  it("merges right: owner colSpan grows, width sums, right cell tombstoned", () => {
    const rows = [row3("A", null, "C")];
    const ownerId = rows[0].cells[0].id;
    const next = mergeRight(rows, { rowIndex: 0, cellIndex: 0 });
    expect(effectiveColSpan(next[0].cells[0])).toBe(2);
    expect(next[0].cells[0].span).toBe(66); // 33 + 33 summed
    expect(next[0].cells[1].absorbedBy).toBe(ownerId);
    expect(next[0].cells[1].fieldKey).toBeNull();
    expect(next[0].cells[2].fieldKey).toBe("C"); // untouched
  });

  it("chains right to span all three columns", () => {
    let rows = [row3("A", null, null)];
    rows = mergeRight(rows, { rowIndex: 0, cellIndex: 0 }); // absorb col1
    rows = mergeRight(rows, { rowIndex: 0, cellIndex: 0 }); // absorb col2 (via owner right edge)
    expect(effectiveColSpan(rows[0].cells[0])).toBe(3);
    expect(rows[0].cells[0].span).toBe(99);
    expect(rows[0].cells[1].absorbedBy).toBe(rows[0].cells[0].id);
    expect(rows[0].cells[2].absorbedBy).toBe(rows[0].cells[0].id);
  });

  it("is a no-op when the right cell is occupied", () => {
    const rows = [row3("A", "B", "C")];
    expect(mergeRight(rows, { rowIndex: 0, cellIndex: 0 })).toBe(rows);
  });

  it("DOES offer a horizontal seam on a tall cell when the right strip is empty (→ 2×2)", () => {
    // vertical-merge col0 across two rows; col1 of both rows empty → can grow right.
    let rows = [row3("A", null, "C"), row3(null, null, "F")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 }); // col0 spans 2 rows
    const h = hSeamsFor(rows);
    expect(h.some((s) => s.rowIndex === 0 && s.colIndex === 0)).toBe(true);
  });
});

// ── 2×2 rectangular block (cross-axis merge) — the corruption repro ──────────

describe("2×2 block: cross-axis merge stays consistent", () => {
  // build a tall (2-row) col0, then grow it right into a full 2×2 block.
  function build2x2() {
    let rows = [row3("A", null, "C"), row3(null, null, "F")];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 });  // col0 rowSpan 2
    rows = mergeRight(rows, { rowIndex: 0, cellIndex: 0 });  // grow right → 2×2
    return rows;
  }

  it("fully tombstones all 3 covered cells of the 2×2", () => {
    const rows = build2x2();
    const owner = rows[0].cells[0];
    expect(effectiveRowSpan(owner)).toBe(2);
    expect(effectiveColSpan(owner)).toBe(2);
    // the other 3 positions of the rectangle are tombstones of the owner
    expect(rows[0].cells[1].absorbedBy).toBe(owner.id); // top-right
    expect(rows[1].cells[0].absorbedBy).toBe(owner.id); // bottom-left
    expect(rows[1].cells[1].absorbedBy).toBe(owner.id); // bottom-right
    // untouched neighbours
    expect(rows[0].cells[2].fieldKey).toBe("C");
    expect(rows[1].cells[2].fieldKey).toBe("F");
  });

  it("vertical split collapses 2×2 → 1×2 wide (no dangling tombstones)", () => {
    const rows = build2x2();
    const after = splitCell(rows, { rowIndex: 0, cellIndex: 0 });
    const owner = after[0].cells[0];
    expect(effectiveRowSpan(owner)).toBe(1);
    expect(effectiveColSpan(owner)).toBe(2); // horizontal merge survives
    expect(after[0].cells[1].absorbedBy).toBe(owner.id); // top-right stays
    // bottom row fully revived to empty cells
    expect(after[1].cells[0].absorbedBy).toBeUndefined();
    expect(after[1].cells[1].absorbedBy).toBeUndefined();
    expect(after[1].cells[0].fieldKey).toBeNull();
  });

  it("horizontal split collapses 2×2 → 2×1 tall (no dangling tombstones)", () => {
    const rows = build2x2();
    const after = splitCellH(rows, { rowIndex: 0, cellIndex: 0 });
    const owner = after[0].cells[0];
    expect(effectiveColSpan(owner)).toBe(1);
    expect(effectiveRowSpan(owner)).toBe(2); // vertical merge survives
    expect(after[1].cells[0].absorbedBy).toBe(owner.id); // bottom-left stays
    // right column fully revived
    expect(after[0].cells[1].absorbedBy).toBeUndefined();
    expect(after[1].cells[1].absorbedBy).toBeUndefined();
  });

  it("both splits in sequence fully un-merge the block (no dangling refs)", () => {
    let rows = build2x2();
    rows = splitCell(rows, { rowIndex: 0, cellIndex: 0 });   // → 1×2
    rows = splitCellH(rows, { rowIndex: 0, cellIndex: 0 });  // → 1×1
    // every cell is now plain: no absorbedBy, no span>1
    for (const r of rows) for (const c of r.cells) {
      expect(c.absorbedBy).toBeUndefined();
      expect(effectiveRowSpan(c)).toBe(1);
      expect(effectiveColSpan(c)).toBe(1);
    }
  });
});

describe("splitCellH (inverse of mergeRight)", () => {
  it("restores colSpan 1 and per-column template widths", () => {
    let rows = [row3("A", null, "C")];
    rows = mergeRight(rows, { rowIndex: 0, cellIndex: 0 }); // span 66, colSpan 2
    const after = splitCellH(rows, { rowIndex: 0, cellIndex: 0 });
    expect(effectiveColSpan(after[0].cells[0])).toBe(1);
    expect(after[0].cells[0].colSpan).toBeUndefined();
    expect(after[0].cells[0].span).toBe(33); // template width restored
    expect(after[0].cells[1].absorbedBy).toBeUndefined();
    expect(after[0].cells[1].span).toBe(33);
    expect(after[0].cells[1].fieldKey).toBeNull();
  });
});
