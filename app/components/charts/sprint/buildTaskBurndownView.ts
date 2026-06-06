/**
 * buildTaskBurndownView — pure model→SVG geometry shaper for the TASK-count
 * burndown chart. Standalone copy of buildBurndownView (see
 * TD-TASKMETRICS-DUP-PROJECTION): same viewbox + geometry, count units. Takes
 * the neutral taskmetrics.Model and returns ready-to-render SVG path strings +
 * point lists. No React, no DOM, no colour.
 *
 * The math is count-vs-points agnostic — it reads remaining[], scope_changes[],
 * cone, ideal_* — so the body is identical to the points shaper.
 */
import type { TaskMetricsModel } from "@/app/lib/apiSite";
import { axisTop, fmtYMD } from "@/app/components/charts/sprint/axisScale";

export const VB = {
  W: 560,
  H: 300,
  plotL: 38,
  plotT: 16,
  plotW: 506,
  plotH: 258,
  yMax: 100,
} as const;

export interface TaskBurndownView {
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
  // Green optimistic marker: vertical dotted line + baseline circle at the day
  // the optimistic (fastest-recent) trend reaches zero, with its calendar date.
  // null when the optimistic trend never lands (velocity <= 0).
  optMarker: { x: number; date: string } | null;
  // Red pessimistic marker: shown ONLY when the pessimistic trend lands past
  // sprint-end. Always clamped to the right plot edge (the deadline); the date
  // is the TRUE projected landing date (which is past the edge). null otherwise.
  pessMarker: { x: number; date: string } | null;
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

export function buildTaskBurndownView(m0: TaskMetricsModel): TaskBurndownView {
  // Normalise array fields against null. Go marshals a nil slice as JSON `null`,
  // so any empty model facet arrives as null and would crash the .map calls.
  const arr = <T,>(v: T[] | null | undefined): T[] => v ?? [];
  const m: TaskMetricsModel = {
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

  // Count metric: the y-axis GROWS to contain every plotted value — scope,
  // remaining (actual line), ideal guideline, and the forecast cone — plus
  // headroom for the Catmull-Rom spline overshooting above its control points.
  // Without the all-series max + headroom the actual line clips against the top
  // gridline (the spline can bulge above the committed total between points).
  const plotted = [
    ...m.scope,
    ...m.remaining.filter((v) => v >= 0),
    ...m.ideal_a,
    ...m.ideal_b,
    ...m.ideal_original,
    ...m.cone.optimistic,
    ...m.cone.pessimistic,
  ];
  const yTop = axisTop(plotted, 1);

  const x = (day: number) => VB.plotL + (day / sprint_days) * VB.plotW;
  const y = (val: number) => VB.plotT + (1 - val / yTop) * VB.plotH;

  // ── Actual line: remaining[d] for d in 0..today where remaining[d] >= 0.
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

  // ── Ideal guideline, segment B: tail days.
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

  // ── Cone band polygon: pessimistic forward, then optimistic reversed.
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

  // ── Forecast markers (design: 2026-06-06 mockup).
  // GREEN optimistic marker: at the x where the optimistic line reaches zero
  // (opt_landing_day), with its calendar date. Shown whenever it lands; if the
  // landing is past the right edge it's clamped there (the line can't exit the
  // SVG, but the date pill still reads true).
  // RED pessimistic marker: ONLY when the pessimistic trend lands past sprint-end
  // (projected_past_end). ALWAYS clamped to the right plot edge (the deadline);
  // the date is the TRUE projected landing date.
  const fc = m.forecast;
  const rightEdge = x(sprint_days);
  let optMarker: { x: number; date: string } | null = null;
  if (fc && fc.opt_landing_day >= 0 && fc.opt_landing_date) {
    const ox = Math.min(x(fc.opt_landing_day), rightEdge);
    optMarker = { x: ox, date: fmtYMD(fc.opt_landing_date) };
  }
  let pessMarker: { x: number; date: string } | null = null;
  if (fc && fc.projected_past_end && fc.pess_landing_date) {
    pessMarker = { x: rightEdge, date: fmtYMD(fc.pess_landing_date) };
  }

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
    optMarker,
    pessMarker,
  };
}
