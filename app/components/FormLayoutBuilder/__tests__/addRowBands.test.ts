// Guard: adding an empty template row must produce a NEW single-row band, and
// the renderer's bandsOf must see it. Pins that the band restructure didn't
// break the basic add-row path (regression caught during Playwright verify).
import { describe, it, expect } from "vitest";
import { bandsOf } from "../mergeTransitions";
import { emptyRow } from "../useFormBuilderState";
const emptyRowFor = emptyRow;

describe("addRow → bandsOf", () => {
  it("a fresh empty 30-30-30 row becomes its own 1-row band", () => {
    const rows = [emptyRowFor("100"), emptyRowFor("30-30-30")];
    const bands = bandsOf(rows);
    expect(bands).toHaveLength(2);
    expect(bands[1].subRowCount).toBe(1);
    expect(bands[1].rows[0].cells).toHaveLength(3);
  });

  it("two adjacent unmerged 30-30-30 rows are two separate bands", () => {
    const rows = [emptyRowFor("30-30-30"), emptyRowFor("30-30-30")];
    expect(bandsOf(rows)).toHaveLength(2);
  });
});
