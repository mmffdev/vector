"use client";

import { useState, useEffect } from "react";

// Chart ref: C-08
// Vector raydale chart — radial polygon plot across N categorical axes,
// with one or more overlaid series. Two stub series ship by default;
// replace `series` with real data when wiring up. Colours come from the
// active theme via design tokens, so the chart restyles automatically
// when the user switches theme packs.
//
// Usage: <RaydaleChart />                       // 17 axes, two stub series
//        <RaydaleChart axes={[...]} series={[{name, values}, ...]} max={100} />
//        <RaydaleChart randomize />             // PREVIEW ONLY — see below

export type RaydaleSeries = {
  name: string;
  // One value per axis, in axis order. Range 0..max.
  values: number[];
  // Tone slot — picks a fill/stroke pair from the design system.
  tone: 1 | 2;
};

const DEFAULT_AXES: string[] = [
  "Photo Video",
  "Offline Gaming",
  "Online Gaming",
  "Buy Online",
  "Paying Online",
  "View Shopping sites",
  "Search Engine",
  "News Sportsites",
  "Internet Banking",
  "Social Networks",
  "Email",
  "Other",
  "Sending Money",
  "Listen Radio",
  "Watch TV",
  "Listen Music",
  "Reading",
];

const DEFAULT_SERIES: RaydaleSeries[] = [
  {
    name: "Audience A",
    tone: 1,
    values: [92, 88, 18, 22, 18, 70, 85, 78, 70, 80, 88, 14, 14, 14, 32, 22, 96],
  },
  {
    name: "Audience B",
    tone: 2,
    values: [22, 18, 12, 14, 12, 24, 30, 28, 36, 40, 48, 24, 22, 30, 70, 22, 18],
  },
];

const SIZE = 480;
const CENTER = SIZE / 2;
const MAX_R = 170;          // outer ring radius
const RING_COUNT = 5;
const LABEL_GAP = 26;       // distance from outer ring to label
const TICK_LEN = 4;         // tiny tick where axis meets outer ring

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Clamp a single value into [0, max]; coerce NaN/Infinity to 0.
function clamp(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(max, v));
}

function polygonPoints(values: number[], max: number, axisCount: number): string {
  return values
    .slice(0, axisCount)
    .map((v, i) => {
      const r = (clamp(v, max) / max) * MAX_R;
      const p = polar(CENTER, CENTER, r, (i / axisCount) * 360);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");
}

function labelAnchor(angleDeg: number): "start" | "middle" | "end" {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a < 15 || a > 345 || (a > 165 && a < 195)) return "middle";
  return a < 180 ? "start" : "end";
}

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every series, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • Each value is independent (no sum-to-100 constraint, unlike
//     pie/donut/stacked-percent) — radar axes measure separate
//     dimensions, so per-axis bounds are all that's needed.
//   • Clamp to [floor, max] so polygons never collapse to a point
//     (all-zero) and never spike past the outer ring.
//   • Round to integers so values render cleanly in any tooltip
//     swap-in later.
//   • Pad / truncate to exactly axisCount so polygon never gaps
//     or wraps off-axis.
// If you add a chart type with a sum constraint (donut, stacked
// bars, percent-of-total), write a separate generator that
// distributes a fixed total — do not reuse this one.
// =============================================================
function randomSeries(
  base: RaydaleSeries[],
  axisCount: number,
  max: number,
): RaydaleSeries[] {
  const floor = Math.max(1, Math.round(max * 0.05)); // ≥5% so polygons hold shape
  return base.map((s) => ({
    ...s,
    values: Array.from({ length: axisCount }, () => {
      const raw = floor + Math.random() * (max - floor);
      return clamp(Math.round(raw), max);
    }),
  }));
}

export default function RaydaleChart({
  axes = DEFAULT_AXES,
  series = DEFAULT_SERIES,
  max = 100,
  randomize = false,
}: {
  axes?: string[];
  series?: RaydaleSeries[];
  max?: number;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const N = axes.length;
  const [activeSeries, setActiveSeries] = useState(series);

  useEffect(() => {
    if (randomize) setActiveSeries(randomSeries(series, N, max));
  }, [randomize, series, N, max]);

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="raydale-chart"
      role="img"
      aria-label="Raydale radial chart"
    >
      {/* Concentric grid rings */}
      {Array.from({ length: RING_COUNT }, (_, i) => {
        const r = ((i + 1) / RING_COUNT) * MAX_R;
        return (
          <circle
            key={`ring-${i}`}
            cx={CENTER}
            cy={CENTER}
            r={r}
            className="raydale-chart__ring"
          />
        );
      })}

      {/* Spokes from centre out to each axis label */}
      {axes.map((label, i) => {
        const angle = (i / N) * 360;
        const outer = polar(CENTER, CENTER, MAX_R + LABEL_GAP - 6, angle);
        return (
          <line
            key={`spoke-${label}-${i}`}
            x1={CENTER}
            y1={CENTER}
            x2={outer.x}
            y2={outer.y}
            className="raydale-chart__spoke"
          />
        );
      })}

      {/* Tiny tick where each axis meets the outer ring */}
      {axes.map((label, i) => {
        const angle = (i / N) * 360;
        const a = polar(CENTER, CENTER, MAX_R - TICK_LEN, angle);
        const b = polar(CENTER, CENTER, MAX_R + TICK_LEN, angle);
        return (
          <line
            key={`tick-${label}-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="raydale-chart__tick"
          />
        );
      })}

      {/* Series polygons (drawn back-to-front so tone-1 sits on top) */}
      {[...activeSeries].reverse().map((s) => (
        <polygon
          key={`poly-${s.name}`}
          points={polygonPoints(s.values, max, N)}
          className={`raydale-chart__poly raydale-chart__poly--tone-${s.tone}`}
        />
      ))}

      {/* Vertex dots, drawn last so they overlap the polygons cleanly */}
      {activeSeries.map((s) =>
        s.values.slice(0, N).map((v, i) => {
          const r = (clamp(v, max) / max) * MAX_R;
          const p = polar(CENTER, CENTER, r, (i / N) * 360);
          return (
            <circle
              key={`dot-${s.name}-${i}`}
              cx={p.x}
              cy={p.y}
              r={3.5}
              className={`raydale-chart__dot raydale-chart__dot--tone-${s.tone}`}
            />
          );
        }),
      )}

      {/* Axis labels */}
      {axes.map((label, i) => {
        const angle = (i / N) * 360;
        const p = polar(CENTER, CENTER, MAX_R + LABEL_GAP, angle);
        return (
          <text
            key={`label-${label}-${i}`}
            x={p.x}
            y={p.y}
            className="raydale-chart__label"
            textAnchor={labelAnchor(angle)}
            dominantBaseline="middle"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="raydale-chart-host">
      <button
        type="button"
        className="raydale-chart__reroll"
        onClick={() => setActiveSeries(randomSeries(series, N, max))}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
