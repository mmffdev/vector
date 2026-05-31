// Regression: 4 same-template rows render as ONE grid so columns align across a
// merge (the gap bug). Was: 3 separate grids → misalignment + gaps. Now: 1
// grid, 4 row-tracks, the merged middle cell spans 2 tracks, neighbours stay 1.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FormLayoutRenderer } from "../FormLayoutRenderer";
import { bandsOf, mergeDown } from "../mergeTransitions";
import type { FormRow } from "@/app/lib/formLayoutsApi";

let seq = 0;
const c = (k: string | null) => ({ id: `c${seq++}`, fieldKey: k, span: 33 });
const row3 = (): FormRow => ({ id: `r${seq++}`, template: "30-30-30", cells: [c(null), c(null), c(null)] });

describe("band layout — 4 rows, middle merged across rows 2-3", () => {
  it("renders ONE grid with 4 row-tracks (columns align, no separate grids)", () => {
    let rows = [row3(), row3(), row3(), row3()];
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 1 }); // merge middle of rows 1+2

    const bands = bandsOf(rows);
    expect(bands).toHaveLength(1);
    expect(bands[0].subRowCount).toBe(4);

    const { container } = render(
      <FormLayoutRenderer rows={rows} renderCell={() => <div className="cell" />} />,
    );
    const grids = container.querySelectorAll(".flb-grid__Band_Cells");
    expect(grids).toHaveLength(1); // single grid for the whole run
    expect((grids[0] as HTMLElement).style.gridTemplateRows).toContain("repeat(4,");

    // 11 real cells render (12 minus the one tombstone); the tall one spans 2.
    const cells = container.querySelectorAll(".flb-grid__Cell");
    expect(cells).toHaveLength(11);
    const tall = Array.from(cells).find(
      (el) => (el as HTMLElement).getAttribute("data-tall") === "true",
    ) as HTMLElement;
    expect(tall).toBeTruthy();
    expect(tall.style.gridRow).toContain("span 2");
  });

  it("renders the seam handle at a TALL cell's bottom edge (extend-down through merge)", () => {
    // Description (row 1) merged down into row 2 → tall cell spans rows 1-2.
    // Row 3 below is empty → a seam must render to extend the merge into row 3.
    // The seam lives at the tombstone row (2) but must render from the OWNER's
    // wrapper (whose bottom edge is there) — the regression we just fixed.
    let rows = [row3(), row3(), row3(), row3()];
    rows = mergeDown(rows, { rowIndex: 1, cellIndex: 1 }); // owner row1 span2, tombstone row2
    let seamArgs: { rowIndex: number; colIndex: number } | null = null;
    render(
      <FormLayoutRenderer
        rows={rows}
        renderCell={() => <div />}
        renderSeamJoin={(a) => { if (a.colIndex === 1 && a.rowIndex === 2) seamArgs = a; return <i data-seam={`${a.rowIndex}:${a.colIndex}`} />; }}
      />,
    );
    // the col-1 seam at the tall cell's bottom edge (row 2) must have rendered
    expect(seamArgs).toEqual({ rowIndex: 2, colIndex: 1 });
  });

  it("renders ONE aside per merge group (merged rows share one handle)", () => {
    // 4 rows, middle merged across rows 0-1 → group{0,2} + singleton{2} +
    // singleton{3} = 3 asides, not 4. (No fracturing: the merged pair has one
    // handle spanning both rows.)
    let rows = [row3(), row3(), row3(), row3()];
    rows = mergeDown(rows, { rowIndex: 0, cellIndex: 1 }); // merge middle rows 0-1
    const groupsSeen: number[] = [];
    const { container } = render(
      <FormLayoutRenderer
        rows={rows}
        renderCell={() => <div />}
        renderRowAside={(g) => { groupsSeen.push(g.count); return <i data-grp={g.count} />; }}
      />,
    );
    // 3 asides: one span-2 (the merged group) + two span-1
    expect(groupsSeen.sort()).toEqual([1, 1, 2]);
    const asides = container.querySelectorAll(".flb-grid__Band_Aside_Cell");
    expect(asides).toHaveLength(3);
    const spanning = Array.from(asides).find((el) => (el as HTMLElement).style.gridRow.includes("span 2"));
    expect(spanning).toBeTruthy();
  });
});

// ── barber-pole edges on mergeable seams ─────────────────────────────────────
// Every mergeable boundary draws a 3px stripe on BOTH joining cells (data-pole-*
// on .flb-grid__Cell), with grid-perimeter suppression. Builder-only (gated on a
// seam renderer). Origin: 2026-05-31 — "make it visually clear which can join".
describe("barber-pole edges", () => {
  it("poles BOTH sides of a vertical seam, with perimeter suppression", () => {
    // 2 rows of 30-30-30, all empty. Every column has a ↕ seam between rows 0-1.
    // Each upper cell poles BOTTOM; each lower cell poles TOP. Top row's TOP and
    // bottom row's BOTTOM are perimeter-suppressed, so the only poles are the
    // INTERIOR boundary: upper-bottom + lower-top.
    const rows = [row3(), row3()];
    const { container } = render(
      <FormLayoutRenderer
        rows={rows}
        renderCell={() => <div className="flb-slot" />}
        renderSeamJoin={() => <i />}
        renderHSeamJoin={() => <i />}
      />,
    );
    const cells = Array.from(container.querySelectorAll(".flb-grid__Cell")) as HTMLElement[];
    // 6 cells (2 rows × 3 cols), none tombstone.
    expect(cells).toHaveLength(6);
    // top-row cells: pole BOTTOM (interior seam), NOT top (perimeter).
    const topRow = cells.slice(0, 3);
    for (const el of topRow) {
      expect(el.getAttribute("data-pole-bottom")).toBe("true");
      expect(el.getAttribute("data-pole-top")).toBeNull(); // perimeter
    }
    // bottom-row cells: pole TOP (interior seam), NOT bottom (perimeter).
    const botRow = cells.slice(3);
    for (const el of botRow) {
      expect(el.getAttribute("data-pole-top")).toBe("true");
      expect(el.getAttribute("data-pole-bottom")).toBeNull(); // perimeter
    }
  });

  it("poles horizontal seams left/right, suppressing the outer columns", () => {
    // one 30-30-30 row, all empty → ↔ seams between col0|1 and col1|2.
    // col0 poles RIGHT (not left — perimeter); col1 poles LEFT+RIGHT; col2 poles
    // LEFT (not right — perimeter).
    const rows = [row3()];
    const { container } = render(
      <FormLayoutRenderer
        rows={rows}
        renderCell={() => <div className="flb-slot" />}
        renderHSeamJoin={() => <i />}
      />,
    );
    const cells = Array.from(container.querySelectorAll(".flb-grid__Cell")) as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute("data-pole-left")).toBeNull(); // perimeter
    expect(cells[0].getAttribute("data-pole-right")).toBe("true");
    expect(cells[1].getAttribute("data-pole-left")).toBe("true");
    expect(cells[1].getAttribute("data-pole-right")).toBe("true");
    expect(cells[2].getAttribute("data-pole-left")).toBe("true");
    expect(cells[2].getAttribute("data-pole-right")).toBeNull(); // perimeter
  });

  it("draws NO poles in the runtime (no seam renderers)", () => {
    const rows = [row3(), row3()];
    const { container } = render(
      <FormLayoutRenderer rows={rows} renderCell={() => <div className="flb-slot" />} />,
    );
    const poled = container.querySelectorAll("[data-pole-top],[data-pole-bottom],[data-pole-left],[data-pole-right]");
    expect(poled).toHaveLength(0);
  });
});
