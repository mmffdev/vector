"use client";

import { useState, useEffect } from "react";

// Vector "Fill Petal Equal" chart — N pie-wedge petals filling the
// full 360° around the core. Adjacent petals touch on shared radial
// boundaries (no spokes). Inner petal occupies the same angular slot
// and grows radially with value/max.
//
// Slot width = 360°/N exactly, regardless of value.
// Usage:
//   <FillPetalEqualChart petals={[{label, value}, ...]} max={100} />
//   <FillPetalEqualChart randomize />                              // PREVIEW ONLY

export type FillPetalEqual = {
  label: string;
  value: number;
};

const DEFAULT_PETALS: FillPetalEqual[] = [
  { label: "Strategic fit",   value: 84 },
  { label: "Quality",         value: 92 },
  { label: "Velocity",        value: 58 },
  { label: "Risk posture",    value: 71 },
  { label: "Stakeholder",     value: 76 },
  { label: "Cost discipline", value: 45 },
  { label: "Tech debt",       value: 32 },
  { label: "Innovation",      value: 67 },
];

const SIZE = 480;
const CENTER = SIZE / 2;
const INNER_R = 46;
const OUTER_R = 215;
const FULL_LEN = OUTER_R - INNER_R;

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every petal, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • Each axis is independent — no sum constraint.
//   • Clamp to [20, 100] integer bounds; floor=20 keeps the inner
//     fill visibly present in every slot.
//   • Slot width is 360°/N regardless of value, so randomising
//     values cannot break geometry.
// =============================================================
function randomPetals(): FillPetalEqual[] {
  return DEFAULT_PETALS.map((p) => ({
    ...p,
    value: 20 + Math.floor(Math.random() * 81),
  }));
}

function sectorPath(a1: number, a2: number, rIn: number, rOut: number): string {
  const f = (n: number) => n.toFixed(2);
  const pIsX = rIn * Math.cos(a1), pIsY = rIn * Math.sin(a1);
  const pIeX = rIn * Math.cos(a2), pIeY = rIn * Math.sin(a2);
  const pOsX = rOut * Math.cos(a1), pOsY = rOut * Math.sin(a1);
  const pOeX = rOut * Math.cos(a2), pOeY = rOut * Math.sin(a2);
  const largeArc = a2 - a1 > Math.PI ? 1 : 0;
  return [
    `M ${f(pIsX)} ${f(pIsY)}`,
    `A ${rIn} ${rIn} 0 ${largeArc} 1 ${f(pIeX)} ${f(pIeY)}`,
    `L ${f(pOeX)} ${f(pOeY)}`,
    `A ${rOut} ${rOut} 0 ${largeArc} 0 ${f(pOsX)} ${f(pOsY)}`,
    "Z",
  ].join(" ");
}

export default function FillPetalEqualChart({
  petals: petalsProp = DEFAULT_PETALS,
  max = 100,
  randomize = false,
}: {
  petals?: FillPetalEqual[];
  max?: number;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [petals, setPetals] = useState<FillPetalEqual[]>(petalsProp);

  useEffect(() => {
    if (randomize) setPetals(randomPetals());
  }, [randomize]);

  const N = petals.length;
  if (N === 0) return null;

  const slotAngle = (2 * Math.PI) / N;

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="fill-petal-equal-chart"
      role="img"
      aria-label="Fill petal equal chart"
    >
      <g transform={`translate(${CENTER} ${CENTER})`}>
        {petals.map((p, i) => {
          const centerAngle = -Math.PI / 2 + i * slotAngle;
          const a1 = centerAngle - slotAngle / 2;
          const a2 = centerAngle + slotAngle / 2;
          return (
            <path
              key={`outer-${i}`}
              d={sectorPath(a1, a2, INNER_R, OUTER_R)}
              className="fill-petal-equal-chart__outer"
            />
          );
        })}

        {petals.map((p, i) => {
          const centerAngle = -Math.PI / 2 + i * slotAngle;
          const a1 = centerAngle - slotAngle / 2;
          const a2 = centerAngle + slotAngle / 2;
          const ratio = Math.max(0, Math.min(1, p.value / max));
          if (ratio <= 0) return null;
          const innerOuter = INNER_R + ratio * FULL_LEN;
          return (
            <path
              key={`inner-${i}`}
              d={sectorPath(a1, a2, INNER_R, innerOuter)}
              className="fill-petal-equal-chart__inner"
            />
          );
        })}

        <circle
          cx={0}
          cy={0}
          r={INNER_R - 14}
          className="fill-petal-equal-chart__core"
        />
      </g>

      {petals.map((p, i) => {
        const centerAngle = -Math.PI / 2 + i * slotAngle;
        const labelDist = INNER_R + FULL_LEN * 0.55;
        const tx = CENTER + labelDist * Math.cos(centerAngle);
        const ty = CENTER + labelDist * Math.sin(centerAngle);
        return (
          <g key={`label-${i}`} transform={`translate(${tx} ${ty})`}>
            <text className="fill-petal-equal-chart__value" textAnchor="middle" y="0">
              {p.value}
            </text>
            <text className="fill-petal-equal-chart__label" textAnchor="middle" y="16">
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
