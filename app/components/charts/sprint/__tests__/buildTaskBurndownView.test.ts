import { describe, it, expect } from "vitest";
import { buildTaskBurndownView, VB } from "../buildTaskBurndownView";
import type { TaskMetricsModel } from "@/app/lib/apiSite";

const model: TaskMetricsModel = {
  window: { start: "2026-01-01", end: "2026-01-11", today: 2, sprint_days: 10 },
  scope: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  remaining: [10, 8, 6, -1, -1, -1, -1, -1, -1, -1, -1],
  earned: [0, 2, 4],
  ideal_a: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ideal_b: [],
  ideal_original: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  cone: { optimistic: [], pessimistic: [] },
  rate: 2,
  scope_changes: [],
  kpis: { total: 10, completed: 4, remaining: 6, days_left: 8, on_track: true, projected_short: 0 },
};

describe("buildTaskBurndownView", () => {
  it("plots the actual line only up to today and skips -1 sentinels", () => {
    const v = buildTaskBurndownView(model);
    expect(v.markers).toHaveLength(3); // days 0,1,2
    expect(v.actualPath.startsWith("M")).toBe(true);
    expect(v.todayX).toBeCloseTo(VB.plotL + (2 / 10) * VB.plotW, 1);
  });

  it("grows the y-axis to contain the data with headroom (no clipping)", () => {
    const v = buildTaskBurndownView(model);
    // Axis top sits ABOVE the max plotted value (10) so the spline can't clip.
    expect(v.yTop).toBeGreaterThanOrEqual(10);
    // 0 is the baseline (bottom of the plot).
    expect(v.y(0)).toBeCloseTo(VB.plotT + VB.plotH, 1);
    // The max data value (10) plots STRICTLY INSIDE the top edge, not on it.
    expect(v.y(10)).toBeGreaterThan(VB.plotT);
    // And every plotted point stays within the plot box [plotT, plotT+plotH].
    expect(v.y(v.yTop)).toBeCloseTo(VB.plotT, 1);
  });

  it("tolerates null array fields from the wire", () => {
    const bad = {
      ...model,
      scope_changes: null as unknown as [],
      cone: { optimistic: null, pessimistic: null } as unknown as TaskMetricsModel["cone"],
    };
    expect(() => buildTaskBurndownView(bad)).not.toThrow();
  });
});
