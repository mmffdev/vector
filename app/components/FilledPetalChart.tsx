"use client";

import { useState, useEffect } from "react";

// Chart ref: C-04
// Vector filled-petal chart — N equilateral outer petals (one per data
// point) with an inner petal whose uniform scale equals value/max.
// All outer petals are identical regardless of value; the inner petal
// shows fill level. Stroke width is preserved on the inner shape via
// non-scaling-stroke so the edge weight matches the outer.
//
// Usage:
//   <FilledPetalChart petals={[{label, value}, ...]} max={100} />
//   <FilledPetalChart randomize />                              // PREVIEW ONLY
//   N (petal count) is derived from petals.length — supports any N >= 3.

export type FilledPetal = {
  label: string;
  value: number;
};

const DEFAULT_PETALS: FilledPetal[] = [
  { label: "Engineering", value: 84 },
  { label: "Product",     value: 92 },
  { label: "Design",      value: 58 },
  { label: "Sales",       value: 71 },
  { label: "Marketing",   value: 76 },
  { label: "Support",     value: 45 },
];

const SIZE = 480;
const CENTER = SIZE / 2;
const INNER_R = 32;
const OUTER_R = 210;
const FULL_LEN = OUTER_R - INNER_R;

// At N=8 this resolves to wOut≈38, matching the original petal chart's
// shape; for any other N the petal width scales with the angular slot.
const GAP_FACTOR = 0.46;
const W_RATIO_IN = 22 / 38; // taper inner edge to ~58% of outer width

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every petal, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • Each axis is independent — no sum constraint.
//   • Clamp to [25, 100] integer bounds; floor=25 keeps the inner
//     petal visibly drawn (ratio = value/max, scaled inside outer).
//   • Label slots preserved from DEFAULT_PETALS.
// =============================================================
function randomPetals(): FilledPetal[] {
  return DEFAULT_PETALS.map((p) => ({
    ...p,
    value: 25 + Math.floor(Math.random() * 76),
  }));
}


function petalWidthsFor(N: number): { wIn: number; wOut: number } {
  const slotHalf = Math.PI / N;
  const wOut = OUTER_R * Math.sin(slotHalf) * GAP_FACTOR;
  const wIn = wOut * W_RATIO_IN;
  return {
    wIn: Math.max(4, wIn),
    wOut: Math.max(8, wOut),
  };
}

function petalPath(len: number, wIn: number, wOut: number): string {
  return [
    `M ${-wIn} 0`,
    `C ${-wIn - 4} ${-len * 0.3}, ${-wOut} ${-len * 0.55}, ${-wOut} ${-len * 0.82}`,
    `Q ${-wOut} ${-len}, 0 ${-len}`,
    `Q ${wOut} ${-len}, ${wOut} ${-len * 0.82}`,
    `C ${wOut} ${-len * 0.55}, ${wIn + 4} ${-len * 0.3}, ${wIn} 0`,
    "Z",
  ].join(" ");
}

export default function FilledPetalChart({
  petals: petalsProp = DEFAULT_PETALS,
  max = 100,
  randomize = false,
}: {
  petals?: FilledPetal[];
  max?: number;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [petals, setPetals] = useState<FilledPetal[]>(petalsProp);

  useEffect(() => {
    if (randomize) setPetals(randomPetals());
  }, [randomize]);

  const N = petals.length;
  if (N === 0) return null;

  const angleStep = 360 / N;
  const { wIn, wOut } = petalWidthsFor(N);
  const path = petalPath(FULL_LEN, wIn, wOut);

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="filled-petal-chart"
      role="img"
      aria-label="Filled petal chart"
    >
      {petals.map((p, i) => {
        const angle = i * angleStep;
        return (
          <g
            key={`outer-${i}`}
            transform={`translate(${CENTER} ${CENTER}) rotate(${angle}) translate(0 ${-INNER_R})`}
          >
            <path d={path} className="filled-petal-chart__outer" />
          </g>
        );
      })}

      {petals.map((p, i) => {
        const angle = i * angleStep;
        const ratio = Math.max(0, Math.min(1, p.value / max));
        if (ratio <= 0) return null;
        return (
          <g
            key={`inner-${i}`}
            transform={`translate(${CENTER} ${CENTER}) rotate(${angle}) translate(0 ${-INNER_R})`}
          >
            <g transform={`scale(${ratio})`}>
              <path
                d={path}
                className="filled-petal-chart__inner"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </g>
        );
      })}

      <circle
        cx={CENTER}
        cy={CENTER}
        r={42}
        className="filled-petal-chart__core"
      />

      {petals.map((p, i) => {
        const angle = i * angleStep;
        const labelDist = INNER_R + FULL_LEN * 0.58;
        const rad = ((angle - 90) * Math.PI) / 180;
        const tx = CENTER + labelDist * Math.cos(rad);
        const ty = CENTER + labelDist * Math.sin(rad);
        return (
          <g key={`label-${i}`} transform={`translate(${tx} ${ty})`}>
            <text className="filled-petal-chart__value" textAnchor="middle" y="0">
              {p.value}
            </text>
            <text className="filled-petal-chart__label" textAnchor="middle" y="16">
              {p.label}
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
        onClick={() => setPetals(randomPetals())}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
