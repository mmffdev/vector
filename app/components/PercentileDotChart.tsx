"use client";

import { useState, useEffect } from "react";

// Chart ref: C-15
// PercentileDot chart — distribution of a metric across many entities
// (cities, regions, products, etc.) shown as three dots per row: a low
// percentile (e.g. p20), a median (p50), and a high percentile (p95).
// A connector line spans the low-to-high range so the eye can read
// the spread at a glance. Rows sort top-down by spread, so the most
// uneven distributions land at the top.
//
// Stub data ships by default; pass `rows` to wire real values.
// Colors come from the active theme via design tokens, so the chart
// restyles automatically when the user switches theme packs.
//
// Usage: <PercentileDotChart />                 // stub data, normal use
//        <PercentileDotChart rows={[...]} />    // real data
//        <PercentileDotChart randomize />       // PREVIEW ONLY — see banner below

export type PercentileRow = {
  label: string;
  /** Low-tail percentile value (e.g. 20th). */
  low: number;
  /** Median value (e.g. 50th). */
  mid: number;
  /** High-tail percentile value (e.g. 95th). */
  high: number;
};

// Replace `DEFAULT_ROWS` with API data when wiring up.
const DEFAULT_ROWS: PercentileRow[] = [
  { label: "San Francisco",  low:  32000, mid:  98000, high: 358000 },
  { label: "Washington DC",  low:  28000, mid:  95000, high: 322000 },
  { label: "New York",       low:  24000, mid:  78000, high: 295000 },
  { label: "Boston",         low:  29000, mid:  88000, high: 268000 },
  { label: "Seattle",        low:  34000, mid:  92000, high: 254000 },
  { label: "Los Angeles",    low:  22000, mid:  72000, high: 232000 },
  { label: "Denver",         low:  30000, mid:  82000, high: 198000 },
  { label: "Chicago",        low:  24000, mid:  68000, high: 192000 },
  { label: "Austin",         low:  28000, mid:  76000, high: 184000 },
  { label: "Miami",          low:  20000, mid:  56000, high: 172000 },
  { label: "Philadelphia",   low:  22000, mid:  62000, high: 158000 },
  { label: "Atlanta",        low:  21000, mid:  60000, high: 148000 },
  { label: "Phoenix",        low:  24000, mid:  62000, high: 132000 },
  { label: "Detroit",        low:  18000, mid:  50000, high: 118000 },
];

const DEFAULT_AXIS_MIN = 0;
const DEFAULT_AXIS_MAX = 360000;
const DEFAULT_AXIS_TICKS = 5;

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function formatTick(n: number) {
  if (n === 0) return "$0";
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

function buildTicks(min: number, max: number, count: number) {
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every row, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape (per-row dot triple
// with ordering constraint, closest match to the matrix's
// "Grouped bar / line / scatter — Per-point bounds" row plus
// an extra ordering rule):
//   • Each row generates 3 raw values within [axisMin+floor, axisMax].
//   • Values are sorted ascending so low ≤ mid ≤ high (the visual
//     contract of a percentile triple — never let median fall
//     outside the [p20, p95] range).
//   • Floor enforced at 5% of axisMax so the leftmost dot is
//     always visibly off the y-axis.
//   • All values rounded to the nearest $1000 so a future tooltip
//     reads cleanly.
//   • NaN / Infinity coerced to floor.
//   • Rows are sorted by spread (high − low) descending so the
//     most unequal entities float to the top, mirroring the
//     "Greater inequality" reading order of the source diagram.
//   • Labels are preserved across rolls — we shuffle values, not
//     row identities — so the y-axis stays meaningful.
// If you add a chart type with different constraints, write a
// separate generator — do not reuse this one.
// =============================================================
function randomRows(seed: PercentileRow[], axisMin: number, axisMax: number): PercentileRow[] {
  const floor = axisMin + Math.round(axisMax * 0.05);
  const rolled = seed.map((row) => {
    const raw = [
      Math.random() * (axisMax - floor) + floor,
      Math.random() * (axisMax - floor) + floor,
      Math.random() * (axisMax - floor) + floor,
    ]
      .map((v) => clamp(v, floor, axisMax))
      .map((v) => Math.round(v / 1000) * 1000)
      .sort((a, b) => a - b);
    return { label: row.label, low: raw[0], mid: raw[1], high: raw[2] };
  });
  rolled.sort((a, b) => (b.high - b.low) - (a.high - a.low));
  return rolled;
}

export default function PercentileDotChart({
  rows = DEFAULT_ROWS,
  axisMin = DEFAULT_AXIS_MIN,
  axisMax = DEFAULT_AXIS_MAX,
  axisTicks = DEFAULT_AXIS_TICKS,
  axisLabel = "Annual household income",
  topLabel = "Greater inequality",
  bottomLabel = "Less inequality",
  randomize = false,
}: {
  rows?: PercentileRow[];
  axisMin?: number;
  axisMax?: number;
  axisTicks?: number;
  axisLabel?: string;
  topLabel?: string;
  bottomLabel?: string;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activeRows, setActiveRows] = useState(rows);

  useEffect(() => {
    if (randomize) setActiveRows(randomRows(rows, axisMin, axisMax));
    else setActiveRows(rows);
  }, [randomize, rows, axisMin, axisMax]);

  // Layout — coordinates in viewBox units; SVG scales to container.
  const labelGutter = 140;     // left margin for city labels
  const rightPad = 28;
  const topPad = 56;           // axis ticks + axis label
  const bottomPad = 28;
  const rowH = 22;
  const chartW = 760;
  const plotW = chartW - labelGutter - rightPad;
  const chartH = topPad + rowH * activeRows.length + bottomPad;

  const xOf = (v: number) =>
    labelGutter + (clamp(v, axisMin, axisMax) - axisMin) / (axisMax - axisMin) * plotW;
  const yOf = (i: number) => topPad + rowH * (i + 0.5);

  const ticks = buildTicks(axisMin, axisMax, axisTicks);

  const svg = (
    <svg
      className="pctdot-chart"
      viewBox={`0 0 ${chartW} ${chartH}`}
      role="img"
      aria-label="Percentile distribution dot plot"
    >
      {/* Axis label (top-left) */}
      <text x={labelGutter} y={18} className="pctdot-chart__axis-label">
        {axisLabel}
      </text>

      {/* Top inequality marker */}
      <text x={labelGutter - 12} y={18} className="pctdot-chart__bracket pctdot-chart__bracket--top">
        ↑ {topLabel}
      </text>

      {/* Bottom inequality marker */}
      <text x={labelGutter - 12} y={chartH - 8} className="pctdot-chart__bracket pctdot-chart__bracket--bot">
        ↓ {bottomLabel}
      </text>

      {/* Grid lines + tick labels */}
      {ticks.map((t, i) => {
        const x = xOf(t);
        return (
          <g key={`tick-${i}`}>
            <line
              className="pctdot-chart__grid"
              x1={x}
              x2={x}
              y1={topPad - 8}
              y2={chartH - bottomPad + 4}
            />
            <text className="pctdot-chart__tick" x={x} y={topPad - 14} textAnchor="middle">
              {formatTick(t)}
            </text>
          </g>
        );
      })}

      {/* Rows */}
      {activeRows.map((r, i) => {
        const y = yOf(i);
        const xLow = xOf(r.low);
        const xMid = xOf(r.mid);
        const xHigh = xOf(r.high);
        return (
          <g key={`row-${r.label}-${i}`} className="pctdot-chart__row">
            {/* Row label (right-aligned in left gutter) */}
            <text
              className="pctdot-chart__rowlabel"
              x={labelGutter - 12}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {r.label}
            </text>

            {/* Connector line spanning low → high */}
            <line
              className="pctdot-chart__connector"
              x1={xLow}
              x2={xHigh}
              y1={y}
              y2={y}
            />

            {/* Three dots — low, mid, high. Drawn in this z-order so
                the median sits between the spread endpoints. */}
            <circle
              className="pctdot-chart__dot pctdot-chart__dot--tone-1"
              cx={xLow}
              cy={y}
              r={5.5}
            />
            <circle
              className="pctdot-chart__dot pctdot-chart__dot--tone-2"
              cx={xMid}
              cy={y}
              r={5.5}
            />
            <circle
              className="pctdot-chart__dot pctdot-chart__dot--tone-3"
              cx={xHigh}
              cy={y}
              r={5.5}
            />
          </g>
        );
      })}
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="pctdot-chart-host">
      <button
        type="button"
        className="pctdot-chart__reroll"
        onClick={() => setActiveRows(randomRows(rows, axisMin, axisMax))}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
