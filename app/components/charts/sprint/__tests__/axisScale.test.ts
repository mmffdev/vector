import { describe, it, expect } from "vitest";
import { niceCeil, axisTop, axisTicks } from "../axisScale";

describe("niceCeil", () => {
  it("rounds up to a tidy 1/2/2.5/5/10 × 10^k value", () => {
    expect(niceCeil(10)).toBe(10);
    expect(niceCeil(11)).toBe(20);
    expect(niceCeil(34)).toBe(50);
    expect(niceCeil(101)).toBe(200);
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
  });
});

describe("axisTop", () => {
  it("clears the max value with headroom so a spline can't clip", () => {
    // max 12 + 8% = 12.96 → niceCeil → 20. Always strictly above the data.
    expect(axisTop([12, 12, 0, 12])).toBeGreaterThan(12);
  });
  it("returns the floor verbatim (no headroom) for an all-zero / empty model", () => {
    expect(axisTop([], 100)).toBe(100);
    expect(axisTop([0, 0, 0])).toBe(1);
    expect(axisTop([0, 0, 0], 100)).toBe(100);
  });
  it("grows above the floor when data exceeds it", () => {
    // 34-point sprint, floor 1 → niceCeil(34 × 1.08 = 36.7) → 50.
    expect(axisTop([34, 20, 0], 1)).toBe(50);
  });
  it("ignores the -1 'no actual' sentinels callers are expected to filter", () => {
    // axisTop only sees finite values it's handed; negative inputs never raise top.
    expect(axisTop([5, -1, 3])).toBeGreaterThanOrEqual(5);
  });
});

describe("axisTicks", () => {
  it("returns count+1 evenly-spaced whole-number ticks from 0", () => {
    expect(axisTicks(20, 5)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(axisTicks(50, 5)).toEqual([0, 10, 20, 30, 40, 50]);
  });
  it("collapses duplicate rounded labels for small tops", () => {
    // top=2, 5 steps → 0,0.4,0.8,1.2,1.6,2 → rounds to 0,0,1,1,2,2 → deduped.
    expect(axisTicks(2, 5)).toEqual([0, 1, 2]);
  });
});
