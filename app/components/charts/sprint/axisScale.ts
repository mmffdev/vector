/**
 * axisScale — shared y-axis scaling for the burndown charts. Both the
 * story-points and task-count shapers feed their plotted series through this so
 * the axis GROWS to contain the data (plus spline-overshoot headroom) instead of
 * clipping against a fixed ceiling.
 *
 * This is genuinely-shared geometry (not the duplicated projection math behind
 * TD-TASKMETRICS-DUP-PROJECTION) — a pure "what's the axis top + ticks" helper.
 */

/**
 * dayToDate converts a sprint day-offset (may be fractional — a forecast landing
 * day) to a short "Mon D" calendar label, counting whole days from the sprint
 * start "YYYY-MM-DD". Used for the optimistic-finish marker label. Parses the
 * date as UTC to avoid the local-midnight off-by-one.
 */
export function dayToDate(start: string, dayOffset: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + Math.round(dayOffset));
  return fmtDayMonth(d);
}

/** fmtYMD formats a "YYYY-MM-DD" string as "D Mon" (e.g. "6 Jul"). */
export function fmtYMD(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return "";
  return fmtDayMonth(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

function fmtDayMonth(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** niceCeil rounds `v` up to a visually-tidy axis maximum. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  // Choose a step from the {1,2,5}×10^k family just below v, then round up.
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * pow);
  for (const c of candidates) {
    if (v <= c) return c;
  }
  return 10 * pow;
}

/**
 * axisTop returns the y-axis maximum for a set of plotted series. It takes the
 * true max across every finite value the chart draws, adds 8% headroom for the
 * Catmull-Rom spline overshooting above its control points, then rounds up to a
 * nice number. `floor` is a hard minimum returned verbatim when the data is
 * empty or doesn't exceed it — the floor is NOT given headroom, so an empty
 * model renders at exactly `floor` rather than a bumped-up value.
 */
export function axisTop(values: number[], floor = 1): number {
  let max = 0;
  for (const v of values) {
    if (Number.isFinite(v) && v > max) max = v;
  }
  if (max <= 0) return floor;
  return Math.max(floor, niceCeil(max * 1.08));
}

/**
 * axisTicks returns `count`+1 evenly-spaced tick values from 0..top, each
 * rounded to a whole unit (burndowns are integer counts/points). Duplicates
 * from rounding are collapsed so a small `top` doesn't repeat labels.
 */
export function axisTicks(top: number, count = 5): number[] {
  const step = top / count;
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const val = Math.round(i * step);
    if (out.length === 0 || out[out.length - 1] !== val) out.push(val);
  }
  return out;
}
