// sprintVelocityColour — pure ratio→colour mapping for the sprint-boundary
// velocity line. Given the points committed above the line and the sprint's
// Planned Velocity cap, returns a CSS colour string that blends continuously
// green → amber → red as load approaches and exceeds the cap.
//
// The blend is anchored on the three user-supplied tokens (defined in
// primitives.css): --grid-tree-artefact-divider-green / -amber / -red. We emit
// a `color-mix(in srgb, …)` expression (the project's established blending
// idiom — 80+ existing uses) so the browser interpolates between the token
// values; the caller writes the result to a custom property the line/pills read.
//
// Bands (continuous, NOT snapped):
//   ratio 0   → 0.8 : green → amber   (well under → approaching the cap)
//   ratio 0.8 → 1.0 : amber → red     (approaching → at the cap)
//   ratio ≥ 1.0     : solid red       (at/over the cap)
//   no cap (null/0) : solid green/neutral — never divides by zero, never escalates
//
// Returned string is a `color-mix()` so the actual colour is resolved against
// the live token values at paint time (theme-correct). The two endpoints of
// each mix are token var() references; the weight is the only computed part.

const GREEN = "var(--grid-tree-artefact-divider-green)";
const AMBER = "var(--grid-tree-artefact-divider-amber)";
const RED = "var(--grid-tree-artefact-divider-red)";

const AMBER_AT = 0.8; // ratio at which the blend reaches pure amber

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * The numeric ratio of committed points to the Planned Velocity cap.
 * Returns null when there is no usable cap (unset, zero, or non-finite) — the
 * caller treats null as "neutral / green, no escalation".
 */
export function velocityRatio(
  pointsAbove: number,
  plannedVelocity: number | null | undefined,
): number | null {
  if (
    plannedVelocity == null ||
    !Number.isFinite(plannedVelocity) ||
    plannedVelocity <= 0
  ) {
    return null;
  }
  return pointsAbove / plannedVelocity;
}

/**
 * Map points-above + cap to a continuous green→amber→red `color-mix` string.
 * Pure + deterministic → unit-testable. The mix weights are rounded to whole
 * percents to keep the emitted string stable and readable.
 */
export function velocityColour(
  pointsAbove: number,
  plannedVelocity: number | null | undefined,
): string {
  const ratio = velocityRatio(pointsAbove, plannedVelocity);

  // No cap → stay green; never escalate, never divide by zero.
  if (ratio == null) return GREEN;

  if (ratio <= 0) return GREEN;
  if (ratio >= 1) return RED;

  if (ratio <= AMBER_AT) {
    // green → amber across 0 … 0.8
    const t = clamp(ratio / AMBER_AT, 0, 1);
    const amberPct = Math.round(t * 100);
    return `color-mix(in srgb, ${AMBER} ${amberPct}%, ${GREEN})`;
  }

  // amber → red across 0.8 … 1.0
  const t = clamp((ratio - AMBER_AT) / (1 - AMBER_AT), 0, 1);
  const redPct = Math.round(t * 100);
  return `color-mix(in srgb, ${RED} ${redPct}%, ${AMBER})`;
}
