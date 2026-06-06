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
  forecast: {
    optimistic_velocity: 2, average_velocity: 2, pessimistic_velocity: 2,
    opt_landing_day: 5, avg_landing_day: 5, pess_landing_day: 5,
    opt_landing_date: "2026-01-06", pess_landing_date: "", projected_past_end: false,
  },
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

  it("places the green optimistic marker at the optimistic-landing x with its date", () => {
    const v = buildTaskBurndownView(model);
    // opt_landing_day = 5 → marker at x(5); date formatted "6 Jan".
    expect(v.optMarker).not.toBeNull();
    expect(v.optMarker!.x).toBeCloseTo(VB.plotL + (5 / 10) * VB.plotW, 1);
    expect(v.optMarker!.date).toBe("6 Jan");
  });

  it("hides the optimistic marker when the trend never lands", () => {
    const noLand = { ...model, forecast: { ...model.forecast, opt_landing_day: -1, opt_landing_date: "" } };
    expect(buildTaskBurndownView(noLand).optMarker).toBeNull();
  });

  it("clamps the optimistic marker to the right edge when it lands past it", () => {
    const past = { ...model, forecast: { ...model.forecast, opt_landing_day: 14 } };
    const v = buildTaskBurndownView(past);
    expect(v.optMarker!.x).toBeCloseTo(VB.plotL + VB.plotW, 1); // right edge (day 10)
  });

  it("shows the red pessimistic marker at the right edge only when past-end", () => {
    expect(buildTaskBurndownView(model).pessMarker).toBeNull();
    const late = {
      ...model,
      forecast: { ...model.forecast, projected_past_end: true, pess_landing_date: "2026-01-18" },
    };
    const v = buildTaskBurndownView(late);
    expect(v.pessMarker!.x).toBeCloseTo(VB.plotL + VB.plotW, 1); // clamped to right edge
    expect(v.pessMarker!.date).toBe("18 Jan");
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
