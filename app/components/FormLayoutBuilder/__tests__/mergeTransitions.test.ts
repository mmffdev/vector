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

// ── Symmetric edge-merge rule (2026-06-01) ──────────────────────────────────
// User rule: for EACH of a cell's 4 edges, a merge is offered iff (a) the two
// regions across that edge have EQUAL extent along the shared edge (clean
// rectangle, no L-shape) AND (b) together they hold ≤1 field. Same test on all
// four sides — filled/empty and which side the field is on don't matter.
// Verified against the real saved Risk draft (realDraftFixture.json).
describe("symmetric edge-merge (real draft fixture)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const draft = require("./realDraftFixture.json") as { rows: FormRow[] };
  const rows = draft.rows;

  it("Error 3: empty|Colour (filled on RIGHT) offers a horizontal merge", () => {
    // r6: empty | empty | colour → col1↔col2 must be offered.
    expect(hSeamsFor(rows).some((s) => s.rowIndex === 6 && s.colIndex === 1)).toBe(true);
  });

  it("Error 1: Sprint (tall 3×1) offers a vertical merge into the empty below", () => {
    // sprint bottoms at row 9; row 10 col0 empty → a valid seam exists. The
    // renderer now draws the join HANDLE from the raw seamsFor set (same set the
    // poles use), so handle and poles agree — no more poles-without-handle.
    expect(seamsFor(rows).some((s) => s.rowIndex === 9 && s.colIndex === 0)).toBe(true);
  });

  it("Error 2/4: a wide 1×2 cell offers a vertical merge into the equal-width empty below", () => {
    // is_blocked[1x2] at r8c1 over empty[1x2] at r9c1 → V merge offered.
    expect(seamsFor(rows).some((s) => s.rowIndex === 8 && s.colIndex === 1)).toBe(true);
  });

  it("Error 3 EXECUTION: clicking empty|Colour actually merges (field moves into the block)", () => {
    // The seam is keyed at the LEFT (empty) cell r6 col1; clicking calls
    // mergeRight there. The result must be a 1×2 block whose owner carries
    // Colour's field, with the right cell tombstoned to it.
    const out = mergeRight(rows, { rowIndex: 6, cellIndex: 1 });
    expect(out).not.toBe(rows); // a merge happened (not a no-op)
    const owner = out[6].cells[1];
    expect(effectiveColSpan(owner)).toBe(2);
    expect(owner.fieldKey).toBe("colour"); // the field occupies the merged block
    expect(out[6].cells[2].fieldKey).toBeNull();
    expect(out[6].cells[2].absorbedBy).toBe(owner.id);
  });
});

describe("hSeamsFor + mergeRight", () => {
  it("offers a horizontal seam where EITHER side is the filled owner (or both empty)", () => {
    // [A][empty][C] → A→right (filled left) AND empty←C? no, C has its own right
    // edge. col0↔col1 (A|empty) and col1↔col2 (empty|C) both offered.
    const rows = [row3("A", null, "C")];
    const h = hSeamsFor(rows);
    expect(h.some((s) => s.colIndex === 0)).toBe(true); // A | empty
    expect(h.some((s) => s.colIndex === 1)).toBe(true); // empty | C  (filled on right)
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

// ── dominant seams (golden rule: one joiner on the widest/tallest) ───────────
// User rule (2026-05-31): "two cells can merge → detect the longest → make that
// the owner → joiner in the centre." When competing seams share one empty band
// at a boundary, only the widest (V) / tallest (H) owner's handle survives.
import { dominantVSeams, dominantHSeams } from "../mergeTransitions";

const row3070 = (l: string | null, r: string | null): FormRow => ({
  id: `r${seq++}`,
  template: "30-70",
  cells: [cell(l, 30), cell(r, 70)],
});

describe("dominantVSeams — widest owner wins a contiguous boundary run", () => {
  it("drops the narrow ↕ when a wider cell competes at the same boundary", () => {
    // wide-right 'Description' tall over rows 0-1; narrow-left stack L1/L2 with an
    // empty cell beneath BOTH columns at row 2 → raw seamsFor offers a narrow ↕
    // (col0, 30%) AND a wide ↕ (col1, 70%) at boundary row 1. Golden rule keeps
    // only the WIDE one.
    let rows = [row3070("L1", "Description"), row3070("L2", null), row3070(null, null)];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 }); // Description spans rows 0-1
    // both seams exist raw…
    expect(seamsFor(rows)).toEqual([
      { rowIndex: 1, colIndex: 0 },
      { rowIndex: 1, colIndex: 1 },
    ]);
    // …but only the wider (col1, span 70) survives the dominance filter.
    expect(dominantVSeams(rows)).toEqual([{ rowIndex: 1, colIndex: 1 }]);
  });

  it("keeps BOTH equal-width ↕ (no dominant when sizes match)", () => {
    // equal thirds F1 | Desc(tall) | F2 over an empty bottom row → the two outer
    // seams are equal width AND separated by the tall middle, so both survive.
    let rows = [row3("F1", "Desc", "F2"), row3(null, null, null)];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 });
    expect(dominantVSeams(rows).sort((a, b) => a.colIndex - b.colIndex)).toEqual([
      { rowIndex: 0, colIndex: 0 },
      { rowIndex: 0, colIndex: 2 },
    ]);
  });

  it("does not let a wide seam suppress a non-adjacent narrow one", () => {
    // Two independent empty bands separated by a filled column must each keep
    // their handle regardless of width — they don't compete.
    const rows = [
      { id: "ra", template: "30-30-30" as const, cells: [cell("A"), cell("KEEP"), cell("C")] },
      { id: "rb", template: "30-30-30" as const, cells: [cell(null), cell("X"), cell(null)] },
    ];
    // col0 and col2 are empty below (independent bands), col1 filled → both ↕ kept
    expect(dominantVSeams(rows).sort((a, b) => a.colIndex - b.colIndex)).toEqual([
      { rowIndex: 0, colIndex: 0 },
      { rowIndex: 0, colIndex: 2 },
    ]);
  });
});

describe("dominantHSeams — tallest owner wins a contiguous boundary run", () => {
  it("keeps a lone horizontal seam untouched", () => {
    // [A,B] / [C,empty]: C can merge right into empty → one ↔, no competitor.
    const c = (k: string | null) => cell(k, 50);
    const rows = [
      { id: "h0", template: "50-50" as const, cells: [c("A"), c("B")] },
      { id: "h1", template: "50-50" as const, cells: [c("C"), c(null)] },
    ];
    expect(dominantHSeams(rows)).toEqual(hSeamsFor(rows));
  });
});

// ── width/height-tiling merges (wide→wide, tall→tall) ────────────────────────
// User rule (2026-05-31): a merge may consume an empty strip that TILES the
// owner's extent — a wide cell into an equally-wide empty, a tall cell into an
// equally-tall empty — not only single 1×1 targets. Origin: the "Blocked" draft
// where a 2-wide Blocked cell sat above a 2-wide empty and offered no ↕.
describe("width-tiling vertical merge (wide → wide)", () => {
  it("offers a ↕ below a WIDE cell sitting above an equally-wide empty, and merges", () => {
    // 30-30-30. Row0 col1 is wide (merged right cols 1-2). Row1 cols 1-2 empty.
    let rows = [row3("A", "Wide", null), row3("B", null, null)];
    rows = mergeRight(rows, { rowIndex: 0, cellIndex: 1 }); // Wide spans cols 1-2
    expect(effectiveColSpan(rows[0].cells[1])).toBe(2);
    // the empty below also wide? after mergeRight on row0 only, row1 is still two
    // 1×1 empties — that already tiles width 2, so a ↕ is offered at {0,1}.
    expect(seamsFor(rows).some((s) => s.rowIndex === 0 && s.colIndex === 1)).toBe(true);
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 }); // Wide grows down → 2×2
    expect(effectiveColSpan(rows[0].cells[1])).toBe(2);
    expect(effectiveRowSpan(rows[0].cells[1])).toBe(2);
    expect(isTombstone(rows[1].cells[1])).toBe(true);
    expect(isTombstone(rows[1].cells[2])).toBe(true);
  });

  it("merges a wide cell down into a WIDE empty (single colSpan-2 empty below)", () => {
    // build a wide empty below: row1 cols1-2 merged into one empty wide cell.
    let rows = [row3("A", "Wide", null), row3("B", null, null)];
    rows = mergeRight(rows, { rowIndex: 0, cellIndex: 1 }); // top Wide cols1-2
    rows = mergeRight(rows, { rowIndex: 1, cellIndex: 1 }); // bottom empty wide cols1-2
    expect(effectiveColSpan(rows[1].cells[1])).toBe(2);
    // ↕ still offered: the strip below is one wide empty that tiles width 2.
    expect(seamsFor(rows).some((s) => s.rowIndex === 0 && s.colIndex === 1)).toBe(true);
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 });
    expect(effectiveRowSpan(rows[0].cells[1])).toBe(2);
    expect(effectiveColSpan(rows[0].cells[1])).toBe(2);
  });
});

describe("height-tiling horizontal merge (tall → tall)", () => {
  it("offers a ↔ beside a TALL cell next to an equally-tall empty, and merges", () => {
    const c = (k: string | null) => cell(k, 50);
    let rows: FormRow[] = [
      { id: "t0", template: "50-50", cells: [c("Left"), c(null)] },
      { id: "t1", template: "50-50", cells: [c(null), c(null)] },
    ];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 0 }); // Left tall rows 0-1
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 }); // right col → tall empty
    expect(effectiveRowSpan(rows[0].cells[1])).toBe(2);
    // ↔ now offered: tall Left can grow right into the tall empty.
    expect(hSeamsFor(rows).some((s) => s.rowIndex === 0 && s.colIndex === 0)).toBe(true);
    rows = mergeRight(rows, { rowIndex: 0, cellIndex: 0 }); // Left grows right → 2×2
    expect(effectiveColSpan(rows[0].cells[0])).toBe(2);
    expect(effectiveRowSpan(rows[0].cells[0])).toBe(2);
    expect(isTombstone(rows[0].cells[1])).toBe(true);
    expect(isTombstone(rows[1].cells[1])).toBe(true);
  });
});

// ── normalizeOwnership (rebuild tombstones from owner spans) ─────────────────
// A corrupt doc (overlapping merge / drag / undo) can leave a tombstone pointing
// at the WRONG owner — e.g. a 2×2 block's corner stolen by an adjacent merge's
// tombstone → the server's rectangle validator 422s. normalizeOwnership rebuilds
// every absorbedBy from the owners' spans so the doc always tiles cleanly.
// Origin: 2026-05-31 — the live "sprint" 2×2 whose top-right corner pointed at
// colour's tombstone (cell-41 -> cell-38 instead of -> cell-40).
import { normalizeOwnership } from "../mergeTransitions";

describe("normalizeOwnership", () => {
  it("repoints a stolen 2×2 corner to its true owner", () => {
    // colour (col2, rowSpan2 over rows 0-1) + sprint (cols1-2, 2×2 over rows 2-3).
    // sprint's corner (row2,col2) is corrupted to point at colour's tombstone.
    const rows: FormRow[] = [
      { id: "r0", template: "30-30-30", cells: [cell("notes", 33), cell("rel", 33), { id: "colour", fieldKey: "colour", span: 33, rowSpan: 2 }] },
      { id: "r1", template: "30-30-30", cells: [cell(null, 33), cell("blk", 33), { id: "ct1", fieldKey: null, span: 33, absorbedBy: "colour" }] },
      { id: "r2", template: "30-30-30", cells: [cell(null, 33), { id: "sprint", fieldKey: "sprint", span: 66, colSpan: 2, rowSpan: 2 }, { id: "corner", fieldKey: null, span: 33, absorbedBy: "ct1" }] }, // STOLEN: -> ct1 (a tombstone)
      { id: "r3", template: "30-30-30", cells: [cell(null, 33), { id: "s2", fieldKey: null, span: 66, absorbedBy: "sprint" }, { id: "s3", fieldKey: null, span: 33, absorbedBy: "sprint" }] },
    ];
    const out = normalizeOwnership(rows);
    // the corner now belongs to sprint, not the colour tombstone
    expect(out[2].cells[2].absorbedBy).toBe("sprint");
    expect(out[2].cells[2].fieldKey).toBeNull();
    // colour still owns its own column tombstone (row1,col2)
    expect(out[1].cells[2].absorbedBy).toBe("colour");
    // owners keep their spans + fields
    expect(out[0].cells[2].fieldKey).toBe("colour");
    expect(effectiveRowSpan(out[0].cells[2])).toBe(2);
    expect(out[2].cells[1].fieldKey).toBe("sprint");
    expect(effectiveColSpan(out[2].cells[1])).toBe(2);
    expect(effectiveRowSpan(out[2].cells[1])).toBe(2);
  });

  it("revives a tombstone covered by no owner (stale absorbedBy → empty)", () => {
    // a lone tombstone whose owner doesn't span it → revived to empty.
    const rows: FormRow[] = [
      { id: "r0", template: "50-50", cells: [cell("A", 50), { id: "ghost", fieldKey: null, span: 50, absorbedBy: "nonexistent" }] },
    ];
    const out = normalizeOwnership(rows);
    expect(out[0].cells[1].absorbedBy).toBeUndefined();
    expect(out[0].cells[1].fieldKey).toBeNull();
  });

  it("is a no-op on an already-clean document", () => {
    const rows: FormRow[] = [
      { id: "r0", template: "30-30-30", cells: [{ id: "o", fieldKey: "x", span: 33, rowSpan: 2 }, cell("y", 33), cell("z", 33)] },
      { id: "r1", template: "30-30-30", cells: [{ id: "t", fieldKey: null, span: 33, absorbedBy: "o" }, cell(null, 33), cell(null, 33)] },
    ];
    const out = normalizeOwnership(rows);
    expect(out[1].cells[0].absorbedBy).toBe("o");
    expect(out[0].cells[0].fieldKey).toBe("x");
  });
});
