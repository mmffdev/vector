"use client";

import { useState, useEffect } from "react";

// Vector petal chart — eight rounded petals radiating from a small core.
// Petal length scales with value; tone slot picks a neutral fill so the
// chart respects the design system rule "no decorative colour".
//
// Usage: <PetalChart />  (uses DEFAULT_PETALS)
//        <PetalChart petals={[{label, value, tone}, ...]} />  // exactly 8
//        <PetalChart randomize />                              // PREVIEW ONLY

export type Petal = {
  label: string;
  value: number;
  tone: 1 | 2 | 3 | 4;
};

const DEFAULT_PETALS: Petal[] = [
  { label: "Strategic fit",   value: 12, tone: 1 },
  { label: "Quality",         value: 10, tone: 2 },
  { label: "Velocity",        value: 5,  tone: 3 },
  { label: "Risk posture",    value: 12, tone: 1 },
  { label: "Stakeholder",     value: 6,  tone: 2 },
  { label: "Cost discipline", value: 4,  tone: 3 },
  { label: "Tech debt",       value: 2,  tone: 4 },
  { label: "Innovation",      value: 5,  tone: 2 },
];

const SIZE = 480;
const CENTER = SIZE / 2;
const INNER_R = 46;
const MIN_LEN = 110;
const MAX_LEN = 215;

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every petal, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • Petal length is per-axis (no sum constraint), so each value
//     is independent — clamp to [2, 14] integer bounds.
//   • Lower bound > 0 keeps every petal visibly drawn (lengthFor
//     scales against the per-roll max, so values still range
//     proportionally even when clustered tight).
//   • Tone + label slots are preserved from DEFAULT_PETALS.
// =============================================================
function randomPetals(): Petal[] {
  return DEFAULT_PETALS.map((p) => ({
    ...p,
    value: 2 + Math.floor(Math.random() * 13),
  }));
}

function octagonPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + i * Math.PI / 4;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

function petalPath(len: number): string {
  const wIn = 22;
  const wOut = 38;
  return [
    `M ${-wIn} 0`,
    `C ${-wIn - 4} ${-len * 0.3}, ${-wOut} ${-len * 0.55}, ${-wOut} ${-len * 0.82}`,
    `Q ${-wOut} ${-len}, 0 ${-len}`,
    `Q ${wOut} ${-len}, ${wOut} ${-len * 0.82}`,
    `C ${wOut} ${-len * 0.55}, ${wIn + 4} ${-len * 0.3}, ${wIn} 0`,
    "Z",
  ].join(" ");
}

export default function PetalChart({
  petals: petalsProp = DEFAULT_PETALS,
  randomize = false,
}: {
  petals?: Petal[];
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [petals, setPetals] = useState<Petal[]>(petalsProp);

  useEffect(() => {
    if (randomize) setPetals(randomPetals());
  }, [randomize]);

  const max = Math.max(...petals.map((p) => p.value));
  const lengthFor = (v: number) =>
    MIN_LEN + (v / max) * (MAX_LEN - MIN_LEN);

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="petal-chart"
      role="img"
      aria-label="Portfolio dimensions petal chart"
    >
      {petals.map((p, i) => {
        const angle = i * 45;
        const len = lengthFor(p.value);
        const pathLen = len - INNER_R;
        return (
          <g
            key={`petal-${p.label}-${i}`}
            transform={`translate(${CENTER} ${CENTER}) rotate(${angle}) translate(0 ${-INNER_R})`}
          >
            <path
              d={petalPath(pathLen)}
              className={`petal-chart__petal petal-chart__petal--tone-${p.tone}`}
            />
          </g>
        );
      })}

      <polygon
        points={octagonPoints(CENTER, CENTER, INNER_R + 2)}
        className="petal-chart__core"
      />

      {petals.map((p, i) => {
        const angle = i * 45;
        const len = lengthFor(p.value);
        const labelDist = INNER_R + (len - INNER_R) * 0.62;
        const rad = ((angle - 90) * Math.PI) / 180;
        const tx = CENTER + labelDist * Math.cos(rad);
        const ty = CENTER + labelDist * Math.sin(rad);
        return (
          <g key={`label-${p.label}-${i}`} transform={`translate(${tx} ${ty})`}>
            <text
              className={`petal-chart__value petal-chart__value--tone-${p.tone}`}
              textAnchor="middle"
              y="0"
            >
              {p.value}
            </text>
            <text
              className={`petal-chart__label petal-chart__label--tone-${p.tone}`}
              textAnchor="middle"
              y="16"
            >
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
