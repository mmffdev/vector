/**
 * buildBurndownView — pure model→SVG geometry shaper for the sprint
 * burndown chart. Takes the neutral sprintmetrics.Model and returns
 * ready-to-render SVG path strings + point lists. No React, no DOM,
 * no colour — the chart component is dumb and just spreads these onto
 * <path>/<circle> elements.
 *
 * Viewbox + plot insets are fixed from the design handoff. The actual
 * line skips the -1 "no actual value" sentinels past `today` so the
 * line stops cleanly at the last real measurement.
 */
import type { SprintMetricsModel } from "@/app/lib/apiSite";
import { axisTop } from "@/app/components/charts/sprint/axisScale";

export const VB = {
  W: 560,
  H: 300,
  plotL: 38,
  plotT: 16,
  plotW: 506,
  plotH: 258,
  yMax: 100,
} as const;

export interface BurndownView {
  x(day: number): number;
  y(val: number): number;
  actualPath: string;
  areaPath: string;
  idealPathA: string;
  idealPathB: string;
  idealOriginalPath: string;
  optimisticPath: string;
  pessimisticPath: string;
  conePolygon: string;
  scopePins: { x: number; y: number; label: string }[];
  scopeRegionX: number | null;
  markers: { x: number; y: number }[];
  todayX: number;
  yTop: number;
}

interface Pt { x: number; y: number; }

function polyline(pts: Pt[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

// Catmull-Rom → cubic-bezier smoothing. Must match the reference exactly.
function smoothPath(pts: Pt[]): string {
  if (!pts.length) return "";
  if (pts.length < 3) return polyline(pts);
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} `;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} `;
  }
  return d.trim();
}

export function buildBurndownView(m0: SprintMetricsModel): BurndownView {
  // Normalise array fields against null. Go marshals a nil slice as JSON
  // `null` (not `[]`), so any model facet that is empty server-side —
  // most commonly `scope_changes` for a sprint with no mid-sprint scope
  // change, but also the cone/ideal arrays in edge windows — arrives as
  // null and would crash the `.map` calls below. Coalescing here makes the
  // view-shaper robust for every sprint shape regardless of the wire's
  // nil-vs-empty representation. (The backend also emits `[]` now, but this
  // guard is the durable contract — never trust a slice field to be non-null.)
  const arr = <T,>(v: T[] | null | undefined): T[] => v ?? [];
  const m: SprintMetricsModel = {
    ...m0,
    scope: arr(m0.scope),
    remaining: arr(m0.remaining),
    earned: arr(m0.earned),
    ideal_a: arr(m0.ideal_a),
    ideal_b: arr(m0.ideal_b),
    ideal_original: arr(m0.ideal_original),
    scope_changes: arr(m0.scope_changes),
    cone: {
      optimistic: arr(m0.cone?.optimistic),
      pessimistic: arr(m0.cone?.pessimistic),
    },
  };
  const { sprint_days, today } = m.window;

  // y-axis grows to contain every plotted series + spline-overshoot headroom,
  // so a >100-point sprint (or a spline bulge between points) no longer clips
  // against a fixed ceiling. Scales tightly to the data (floor 1), matching the
  // task chart — a 34-point sprint now uses the full plot height instead of the
  // top third under the old fixed yMax=100.
  const yTop = axisTop(
    [
      ...m.scope,
      ...m.remaining.filter((v) => v >= 0),
      ...m.ideal_a,
      ...m.ideal_b,
      ...m.ideal_original,
      ...m.cone.optimistic,
      ...m.cone.pessimistic,
    ],
    1,
  );

  const x = (day: number) => VB.plotL + (day / sprint_days) * VB.plotW;
  const y = (val: number) => VB.plotT + (1 - val / yTop) * VB.plotH;

  // ── Actual line: remaining[d] for d in 0..today where remaining[d] >= 0.
  //    The -1 sentinels past `today` are skipped entirely.
  const actualPts: Pt[] = [];
  for (let d = 0; d <= today && d < m.remaining.length; d++) {
    const val = m.remaining[d];
    if (val >= 0) actualPts.push({ x: x(d), y: y(val) });
  }
  const actualPath = smoothPath(actualPts);

  // ── Area under the actual line, closed down to the baseline.
  let areaPath = "";
  if (actualPts.length) {
    const first = actualPts[0];
    const last = actualPts[actualPts.length - 1];
    const base = y(0);
    areaPath = `${actualPath} L${last.x.toFixed(1)} ${base.toFixed(1)} L${first.x.toFixed(1)} ${base.toFixed(1)} Z`;
  }

  // ── Ideal guideline, segment A: array index === day index.
  const idealPathA = polyline(m.ideal_a.map((v, i) => ({ x: x(i), y: y(v) })));

  // ── Ideal guideline, segment B: tail days. ideal_b[i] sits at
  //    day = (sprint_days - (ideal_b.length - 1)) + i, so the first
  //    element lands on the scope-change day. Empty array → "".
  let idealPathB = "";
  if (m.ideal_b.length) {
    const startDay = sprint_days - (m.ideal_b.length - 1);
    idealPathB = polyline(m.ideal_b.map((v, i) => ({ x: x(startDay + i), y: y(v) })));
  }

  // ── Faint pre-change original ideal, full length.
  const idealOriginalPath = polyline(m.ideal_original.map((v, i) => ({ x: x(i), y: y(v) })));

  // ── Forecast cone: both arrays start at day `today`; point i → day today+i.
  const opt = m.cone.optimistic;
  const pess = m.cone.pessimistic;
  const optimisticPath = polyline(opt.map((v, i) => ({ x: x(today + i), y: y(v) })));
  const pessimisticPath = polyline(pess.map((v, i) => ({ x: x(today + i), y: y(v) })));

  // ── Cone band polygon: pessimistic forward, then optimistic reversed,
  //    forming a closed area. Empty if either bound is missing.
  let conePolygon = "";
  if (opt.length && pess.length) {
    const fwd = pess.map((v, i) => `${x(today + i).toFixed(1)},${y(v).toFixed(1)}`);
    const rev = opt
      .map((v, i) => `${x(today + i).toFixed(1)},${y(v).toFixed(1)}`)
      .reverse();
    conePolygon = [...fwd, ...rev].join(" ");
  }

  // ── Scope-change pins.
  const scopePins = m.scope_changes.map((sc) => ({
    x: x(sc.day),
    y: VB.plotT + 8,
    label: (sc.delta > 0 ? "+" : "") + sc.delta,
  }));

  const scopeRegionX = m.scope_changes.length ? x(m.scope_changes[0].day) : null;

  const markers = actualPts.map((p) => ({ x: p.x, y: p.y }));

  const todayX = x(today);

  return {
    x,
    y,
    actualPath,
    areaPath,
    idealPathA,
    idealPathB,
    idealOriginalPath,
    optimisticPath,
    pessimisticPath,
    conePolygon,
    scopePins,
    scopeRegionX,
    markers,
    todayX,
    yTop,
  };
}
