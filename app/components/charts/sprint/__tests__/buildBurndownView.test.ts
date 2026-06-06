import { describe, it, expect } from "vitest";
import { buildBurndownView, VB } from "../buildBurndownView";
import type { SprintMetricsModel } from "@/app/lib/apiSite";

// Handoff dataset: -1 sentinels past `today` (days 8/9/10) and a
// two-segment ideal split at the day-5 scope change (+12).
const model: SprintMetricsModel = {
  window: { start: "2026-01-01", end: "2026-01-11", today: 7, sprint_days: 10 },
  scope: [80, 80, 80, 80, 80, 92, 92, 92, 92, 92, 92],
  remaining: [80, 76, 70, 62, 55, 62, 53, 44, -1, -1, -1],
  earned: [0, 4, 10, 18, 25, 30, 39, 48, 0, 0, 0],
  ideal_a: [80, 72, 64, 56, 48, 40],
  ideal_b: [52, 41.6, 31.2, 20.8, 10.4, 0],
  ideal_original: [80, 72, 64, 56, 48, 40, 32, 24, 16, 8, 0],
  cone: { optimistic: [44, 29.3, 14.7, 0], pessimistic: [44, 36.3, 28.7, 21] },
  velocity: 7.67,
  forecast: {
    optimistic_velocity: 9, average_velocity: 7.667, pessimistic_velocity: 5,
    opt_landing_day: 11.889, avg_landing_day: 12.74, pess_landing_day: 15.8,
    pess_landing_date: "2026-01-16", projected_past_end: true,
  },
  scope_changes: [{ day: 5, delta: 12 }],
  kpis: { committed: 92, remaining: 44, velocity: 7.67, days_left: 3, on_track: false, projected_short: 29 },
};

describe("buildBurndownView", () => {
  const v = buildBurndownView(model);

  it("maps the x axis across the plot width", () => {
    expect(v.x(0)).toBeCloseTo(VB.plotL, 1);
    expect(v.x(10)).toBeCloseTo(VB.plotL + VB.plotW, 1);
  });

  it("maps the y axis (inverted) across the plot height, growing to contain the data", () => {
    // 0 is the baseline (bottom); the resolved axis top maps to plotT.
    expect(v.y(0)).toBeCloseTo(VB.plotT + VB.plotH, 1);
    expect(v.y(v.yTop)).toBeCloseTo(VB.plotT, 1);
    // Axis grew to clear the committed scope (92 here) plus headroom; the max
    // plotted value sits strictly inside the top edge, never clipping it.
    expect(v.yTop).toBeGreaterThanOrEqual(92);
    expect(v.y(92)).toBeGreaterThan(VB.plotT);
  });

  it("plots the actual line only up to `today`, skipping -1 sentinels, with no NaN", () => {
    expect(v.actualPath).not.toContain("NaN");
    expect(v.actualPath.length).toBeGreaterThan(0);
    // Days 0..7 = 8 real points → smoothed path has 1 leading M + at most 7 C
    // segments. The -1 sentinels (days 8/9/10) must never be plotted.
    const segCount =
      (v.actualPath.match(/M/g)?.length ?? 0) + (v.actualPath.match(/C/g)?.length ?? 0);
    expect(segCount).toBeLessThanOrEqual(8);
    // No coordinate may exceed x(7); the line must stop at the last real day.
    const maxX = Math.max(
      ...(v.actualPath.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0),
    );
    expect(maxX).toBeLessThanOrEqual(v.x(7) + 0.5);
  });

  it("emits two separate ideal segments when scope changed", () => {
    expect(v.idealPathA.startsWith("M")).toBe(true);
    expect(v.idealPathB.startsWith("M")).toBe(true);
    expect(v.idealPathB.length).toBeGreaterThan(0);
  });

  it("derives scope pins from scope_changes", () => {
    expect(v.scopePins).toHaveLength(1);
    expect(v.scopePins[0].label).toBe("+12");
    expect(v.scopePins[0].x).toBeCloseTo(v.x(5), 1);
  });

  it("anchors the scope region at the first scope change", () => {
    expect(v.scopeRegionX).not.toBeNull();
    expect(v.scopeRegionX as number).toBeCloseTo(v.x(5), 1);
  });

  it("builds a closed cone polygon with no NaN", () => {
    expect(v.conePolygon.length).toBeGreaterThan(0);
    expect(v.conePolygon).not.toContain("NaN");
  });

  // Regression (2026-06-06): Go marshals a nil slice as JSON `null`, so a
  // sprint with no mid-sprint scope change arrives with scope_changes: null
  // (and, in edge windows, other arrays too). The view-shaper must not crash
  // on `null.map`. Cast through unknown to model the real (untyped) wire.
  it("tolerates null array fields from the wire (nil-slice JSON)", () => {
    const nulled = {
      window: { start: "2026-06-02", end: "2026-06-15", today: 3, sprint_days: 13 },
      scope: [31, 31, 31, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34],
      remaining: [31, 31, 31, 34, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      earned: null,
      ideal_a: [34, 31.4, 28.8, 26.2, 23.5, 20.9, 18.3, 15.7, 13.1, 10.5, 7.8, 5.2, 2.6, 0],
      ideal_b: null,
      ideal_original: [34, 31.4, 28.8, 26.2, 23.5, 20.9, 18.3, 15.7, 13.1, 10.5, 7.8, 5.2, 2.6, 0],
      cone: { optimistic: null, pessimistic: null },
      velocity: 0,
      scope_changes: null,
      kpis: { committed: 34, remaining: 34, velocity: 0, days_left: 10, on_track: false, projected_short: 34 },
    } as unknown as SprintMetricsModel;
    const out = buildBurndownView(nulled);
    expect(out.scopePins).toEqual([]);
    expect(out.scopeRegionX).toBeNull();
    expect(out.conePolygon).toBe("");
    expect(out.idealPathA.length).toBeGreaterThan(0);
    expect(out.actualPath).not.toContain("NaN");
  });
});
