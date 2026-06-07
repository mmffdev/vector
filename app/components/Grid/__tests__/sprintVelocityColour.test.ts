import { describe, it, expect } from "vitest";
import { velocityRatio, velocityColour } from "../sprintVelocityColour";

const GREEN = "var(--grid-tree-artefact-divider-green)";
const AMBER = "var(--grid-tree-artefact-divider-amber)";
const RED = "var(--grid-tree-artefact-divider-red)";

describe("velocityRatio", () => {
  it("is points/cap when the cap is a positive number", () => {
    expect(velocityRatio(20, 40)).toBe(0.5);
    expect(velocityRatio(40, 40)).toBe(1);
    expect(velocityRatio(60, 40)).toBe(1.5);
  });

  it("is null when there is no usable cap (guards divide-by-zero)", () => {
    expect(velocityRatio(20, null)).toBeNull();
    expect(velocityRatio(20, undefined)).toBeNull();
    expect(velocityRatio(20, 0)).toBeNull();
    expect(velocityRatio(20, -5)).toBeNull();
    expect(velocityRatio(20, NaN)).toBeNull();
  });
});

describe("velocityColour", () => {
  it("is solid green with no cap set (never escalates, never NaNs)", () => {
    expect(velocityColour(999, null)).toBe(GREEN);
    expect(velocityColour(999, 0)).toBe(GREEN);
  });

  it("is solid green at zero points", () => {
    expect(velocityColour(0, 40)).toBe(GREEN);
  });

  it("blends green→amber below 80% of the cap", () => {
    // 40% of cap → halfway to amber (80% is the amber anchor) → 50% amber mix.
    const c = velocityColour(16, 40); // ratio 0.4 → t = 0.4/0.8 = 0.5
    expect(c).toBe(`color-mix(in srgb, ${AMBER} 50%, ${GREEN})`);
  });

  it("reaches pure amber at 80% of the cap", () => {
    // ratio exactly 0.8 → 100% amber mix over green = amber.
    const c = velocityColour(32, 40); // ratio 0.8
    expect(c).toBe(`color-mix(in srgb, ${AMBER} 100%, ${GREEN})`);
  });

  it("blends amber→red between 80% and 100% of the cap", () => {
    // ratio 0.9 → halfway between amber(0.8) and red(1.0) → 50% red mix.
    const c = velocityColour(36, 40); // ratio 0.9 → t = (0.9-0.8)/0.2 = 0.5
    expect(c).toBe(`color-mix(in srgb, ${RED} 50%, ${AMBER})`);
  });

  it("is solid red at or over the cap", () => {
    expect(velocityColour(40, 40)).toBe(RED); // exactly at cap
    expect(velocityColour(80, 40)).toBe(RED); // over cap
  });
});
