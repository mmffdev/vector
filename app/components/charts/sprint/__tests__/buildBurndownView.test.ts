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
  scope_changes: [{ day: 5, delta: 12 }],
  kpis: { committed: 92, remaining: 44, velocity: 7.67, days_left: 3, on_track: false, projected_short: 21 },
};

describe("buildBurndownView", () => {
  const v = buildBurndownView(model);

  it("maps the x axis across the plot width", () => {
    expect(v.x(0)).toBeCloseTo(VB.plotL, 1);
    expect(v.x(10)).toBeCloseTo(VB.plotL + VB.plotW, 1);
  });

  it("maps the y axis (inverted) across the plot height", () => {
    expect(v.y(0)).toBeCloseTo(VB.plotT + VB.plotH, 1);
    expect(v.y(100)).toBeCloseTo(VB.plotT, 1);
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
});
