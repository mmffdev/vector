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
  effectiveRowSpan,
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

describe("bandsOf", () => {
  it("keeps UNMERGED adjacent same-template rows as separate bands", () => {
    // Three rows, no merges → three single-row bands (each gets its own
    // gutter + drag/delete).
    const rows = [row3("A", "B", "C"), row3(null, null, null), row1(null)];
    const bands = bandsOf(rows);
    expect(bands).toHaveLength(3);
    expect(bands.map((b) => b.subRowCount)).toEqual([1, 1, 1]);
  });

  it("groups rows LINKED by a merge into one band", () => {
    // Merge col 0 of rows 0+1 → those two rows become one band; row 2 stays
    // its own band.
    const rows = mergeDown(
      [row3("Desc", "B", "C"), row3(null, "E", "F"), row3(null, "H", "I")],
      { rowIndex: 0, cellIndex: 0 },
    );
    const bands = bandsOf(rows);
    expect(bands).toHaveLength(2);
    expect(bands[0].subRowCount).toBe(2);
    expect(bands[0].startRow).toBe(0);
    expect(bands[1].subRowCount).toBe(1);
    expect(bands[1].startRow).toBe(2);
  });
});
