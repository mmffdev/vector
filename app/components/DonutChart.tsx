"use client";

import { useState, useEffect } from "react";

// Vector "Donut Chart" — single ring of N segments proportional to value.
// Every slice gets a leader line + label (name + percentage) on the
// nearest side; one slice can be flagged `highlight: true` for the
// accent stroke and bolder callout. Other slices cycle through six
// graduated warm-neutral tones.
//
// Usage:
//   <DonutChart slices={[{label, value, highlight?}, ...]} />
//   <DonutChart randomize />                              // PREVIEW ONLY

export type DonutSlice = {
  label: string;
  value: number;
  highlight?: boolean;
};

const DEFAULT_SLICES: DonutSlice[] = [
  { label: "Operations",  value: 23, highlight: true },
  { label: "Engineering", value: 17 },
  { label: "Design",      value: 6 },
  { label: "Sales",       value: 14 },
  { label: "Marketing",   value: 13 },
  { label: "Support",     value: 4 },
  { label: "Finance",     value: 8 },
  { label: "HR",          value: 15 },
];

const SIZE_W = 700;
const SIZE_H = 480;
const CHART_CX = 350;
const CHART_CY = 240;
const RADIUS = 130;
const STROKE = 32;
const GAP_DEG = 2.4;
const GAP_RAD = (GAP_DEG * Math.PI) / 180;

const ELBOW_OFFSET = 28;
const LABEL_X_RIGHT = 600;
const LABEL_X_LEFT = 100;
const LABEL_MIN_GAP = 34;

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every slice, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • The chart auto-normalises positive integers to percentages,
//     so any positive raw values produce a valid donut — there's
//     no way to generate labels that sum > 100%.
//   • Clamp to [4, 25] integer bounds; floor=4 keeps every slice
//     visually present after the radial gap subtraction.
//   • Exactly one slice gets a random `highlight: true`.
// =============================================================
function randomSlices(): DonutSlice[] {
  const i = Math.floor(Math.random() * DEFAULT_SLICES.length);
  return DEFAULT_SLICES.map((s, idx) => ({
    label: s.label,
    value: 4 + Math.floor(Math.random() * 22),
    ...(idx === i ? { highlight: true } : {}),
  }));
}

function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const f = (n: number) => n.toFixed(2);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  const largeArc = a2 - a1 > Math.PI ? 1 : 0;
  return `M ${f(x1)} ${f(y1)} A ${r} ${r} 0 ${largeArc} 1 ${f(x2)} ${f(y2)}`;
}

type LabelEntry = {
  index: number;
  side: "R" | "L";
  mid: number;
  arcX: number;
  arcY: number;
  elbowX: number;
  elbowY: number;
  labelX: number;
  labelY: number;
  pct: number;
  label: string;
  highlight: boolean;
};

export default function DonutChart({
  slices: slicesProp = DEFAULT_SLICES,
  randomize = false,
}: {
  slices?: DonutSlice[];
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [slices, setSlices] = useState<DonutSlice[]>(slicesProp);

  useEffect(() => {
    if (randomize) setSlices(randomSlices());
  }, [randomize]);

  const N = slices.length;
  if (N === 0) return null;

  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;

  let acc = -Math.PI / 2;
  const segments = slices.map((s, i) => {
    const sweep = (s.value / total) * 2 * Math.PI;
    const a1 = acc + GAP_RAD / 2;
    const a2 = acc + sweep - GAP_RAD / 2;
    const mid = (a1 + a2) / 2;
    acc += sweep;
    const tone = ((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    return { ...s, a1, a2, mid, tone };
  });

  const r1 = RADIUS + STROKE / 2 + 4;
  const r2 = RADIUS + STROKE / 2 + ELBOW_OFFSET;

  const labels: LabelEntry[] = segments.map((s, i) => {
    const onRight = Math.cos(s.mid) >= 0;
    const arcX = CHART_CX + r1 * Math.cos(s.mid);
    const arcY = CHART_CY + r1 * Math.sin(s.mid);
    const elbowX = CHART_CX + r2 * Math.cos(s.mid);
    const elbowY = CHART_CY + r2 * Math.sin(s.mid);
    const labelX = onRight ? LABEL_X_RIGHT : LABEL_X_LEFT;
    return {
      index: i,
      side: onRight ? "R" : "L",
      mid: s.mid,
      arcX,
      arcY,
      elbowX,
      elbowY,
      labelX,
      labelY: elbowY,
      pct: Math.round((s.value / total) * 100),
      label: s.label,
      highlight: !!s.highlight,
    };
  });

  for (const side of ["R", "L"] as const) {
    const arr = labels.filter((l) => l.side === side).sort((a, b) => a.labelY - b.labelY);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].labelY < arr[i - 1].labelY + LABEL_MIN_GAP) {
        arr[i].labelY = arr[i - 1].labelY + LABEL_MIN_GAP;
      }
    }
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i].labelY > arr[i + 1].labelY - LABEL_MIN_GAP) {
        arr[i].labelY = arr[i + 1].labelY - LABEL_MIN_GAP;
      }
    }
  }

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE_W} ${SIZE_H}`}
      className="donut-chart"
      role="img"
      aria-label="Donut chart"
    >
      {segments.map((s, i) => (
        <path
          key={`seg-${i}`}
          d={arcPath(CHART_CX, CHART_CY, RADIUS, s.a1, s.a2)}
          className={
            s.highlight
              ? "donut-chart__seg donut-chart__seg--accent"
              : `donut-chart__seg donut-chart__seg--tone-${s.tone}`
          }
          style={{ strokeWidth: STROKE }}
        />
      ))}

      {labels.map((l) => {
        const tickX = l.side === "R" ? l.labelX - 8 : l.labelX + 8;
        const points = [
          `${l.arcX.toFixed(1)},${l.arcY.toFixed(1)}`,
          `${l.elbowX.toFixed(1)},${l.elbowY.toFixed(1)}`,
          `${tickX.toFixed(1)},${l.labelY.toFixed(1)}`,
        ].join(" ");
        const anchor = l.side === "R" ? "start" : "end";
        const labelClass = l.highlight
          ? "donut-chart__label-name donut-chart__label-name--accent"
          : "donut-chart__label-name";
        const pctClass = l.highlight
          ? "donut-chart__label-pct donut-chart__label-pct--accent"
          : "donut-chart__label-pct";
        return (
          <g key={`label-${l.index}`}>
            <polyline className="donut-chart__leader" points={points} />
            <text
              x={l.labelX}
              y={l.labelY - 2}
              textAnchor={anchor}
              className={pctClass}
            >
              {l.pct}%
            </text>
            <text
              x={l.labelX}
              y={l.labelY + 14}
              textAnchor={anchor}
              className={labelClass}
            >
              {l.label}
            </text>
          </g>
        );
      })}
    </svg>
  );

  if (!randomize) return svg;

  return (
    <div className="chart-demo-host">
      <button
        type="button"
        className="chart-demo-reroll"
        onClick={() => setSlices(randomSlices())}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
