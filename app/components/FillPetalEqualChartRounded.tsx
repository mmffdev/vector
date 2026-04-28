"use client";

import { useState, useEffect } from "react";

// Vector "Fill Petal Equal Chart Rounded" — same pie-wedge geometry as
// FillPetalEqualChart, but every corner of every petal (outer and inner)
// is filleted with a uniform radius. Adjacent petals share radial
// boundaries and the rounded corners create a soft, scalloped flower.
//
// Corner radius is clamped per-petal so the fillet always fits within
// the available radial span and angular slot — keeps small inner petals
// from rendering as broken paths.
//
// Usage:
//   <FillPetalEqualChartRounded petals={[{label, value}, ...]} max={100} />
//   <FillPetalEqualChartRounded randomize />                              // PREVIEW ONLY

export type FillPetalEqualRounded = {
  label: string;
  value: number;
};

const DEFAULT_PETALS: FillPetalEqualRounded[] = [
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
const CORNER_R = 10;

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every petal, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • Each axis is independent — no sum constraint.
//   • Clamp to [22, 100] integer bounds; floor=22 keeps the inner
//     petal large enough that the corner radius can render a valid
//     rounded path (the per-petal clamp inside roundedSectorPath
//     also auto-shrinks the radius if the radial span is small).
//   • Slot width = 360°/N regardless of value, so randomising
//     values cannot break angular geometry.
// =============================================================
function randomPetals(): FillPetalEqualRounded[] {
  return DEFAULT_PETALS.map((p) => ({
    ...p,
    value: 22 + Math.floor(Math.random() * 79),
  }));
}

function roundedSectorPath(
  a1: number,
  a2: number,
  rIn: number,
  rOut: number,
  cr: number,
): string {
  const f = (n: number) => n.toFixed(2);
  const slot = a2 - a1;
  const radialSpan = rOut - rIn;
  const maxArcCorner = (slot / 2) * rIn * 0.9;
  const maxRad = (radialSpan / 2) * 0.9;
  const r = Math.max(0, Math.min(cr, maxArcCorner, maxRad));

  if (r <= 0.5) {
    const pIsX = rIn * Math.cos(a1), pIsY = rIn * Math.sin(a1);
    const pIeX = rIn * Math.cos(a2), pIeY = rIn * Math.sin(a2);
    const pOsX = rOut * Math.cos(a1), pOsY = rOut * Math.sin(a1);
    const pOeX = rOut * Math.cos(a2), pOeY = rOut * Math.sin(a2);
    return [
      `M ${f(pIsX)} ${f(pIsY)}`,
      `A ${rIn} ${rIn} 0 0 1 ${f(pIeX)} ${f(pIeY)}`,
      `L ${f(pOeX)} ${f(pOeY)}`,
      `A ${rOut} ${rOut} 0 0 0 ${f(pOsX)} ${f(pOsY)}`,
      "Z",
    ].join(" ");
  }

  const angIn = r / rIn;
  const angOut = r / rOut;

  const isR = { x: (rIn + r) * Math.cos(a1), y: (rIn + r) * Math.sin(a1) };
  const isA = { x: rIn * Math.cos(a1 + angIn), y: rIn * Math.sin(a1 + angIn) };
  const ieA = { x: rIn * Math.cos(a2 - angIn), y: rIn * Math.sin(a2 - angIn) };
  const ieR = { x: (rIn + r) * Math.cos(a2), y: (rIn + r) * Math.sin(a2) };
  const oeR = { x: (rOut - r) * Math.cos(a2), y: (rOut - r) * Math.sin(a2) };
  const oeA = { x: rOut * Math.cos(a2 - angOut), y: rOut * Math.sin(a2 - angOut) };
  const osA = { x: rOut * Math.cos(a1 + angOut), y: rOut * Math.sin(a1 + angOut) };
  const osR = { x: (rOut - r) * Math.cos(a1), y: (rOut - r) * Math.sin(a1) };

  return [
    `M ${f(isR.x)} ${f(isR.y)}`,
    `A ${r} ${r} 0 0 0 ${f(isA.x)} ${f(isA.y)}`,
    `A ${rIn} ${rIn} 0 0 1 ${f(ieA.x)} ${f(ieA.y)}`,
    `A ${r} ${r} 0 0 0 ${f(ieR.x)} ${f(ieR.y)}`,
    `L ${f(oeR.x)} ${f(oeR.y)}`,
    `A ${r} ${r} 0 0 0 ${f(oeA.x)} ${f(oeA.y)}`,
    `A ${rOut} ${rOut} 0 0 0 ${f(osA.x)} ${f(osA.y)}`,
    `A ${r} ${r} 0 0 0 ${f(osR.x)} ${f(osR.y)}`,
    "Z",
  ].join(" ");
}

export default function FillPetalEqualChartRounded({
  petals: petalsProp = DEFAULT_PETALS,
  max = 100,
  randomize = false,
}: {
  petals?: FillPetalEqualRounded[];
  max?: number;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [petals, setPetals] = useState<FillPetalEqualRounded[]>(petalsProp);

  useEffect(() => {
    if (randomize) setPetals(randomPetals());
  }, [randomize]);

  const N = petals.length;
  if (N === 0) return null;

  const slotAngle = (2 * Math.PI) / N;

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="fill-petal-equal-rounded-chart"
      role="img"
      aria-label="Fill petal equal rounded chart"
    >
      <g transform={`translate(${CENTER} ${CENTER})`}>
        {petals.map((p, i) => {
          const centerAngle = -Math.PI / 2 + i * slotAngle;
          const a1 = centerAngle - slotAngle / 2;
          const a2 = centerAngle + slotAngle / 2;
          return (
            <path
              key={`outer-${i}`}
              d={roundedSectorPath(a1, a2, INNER_R, OUTER_R, CORNER_R)}
              className="fill-petal-equal-rounded-chart__outer"
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
              d={roundedSectorPath(a1, a2, INNER_R, innerOuter, CORNER_R)}
              className="fill-petal-equal-rounded-chart__inner"
            />
          );
        })}

        <circle
          cx={0}
          cy={0}
          r={INNER_R - 14}
          className="fill-petal-equal-rounded-chart__core"
        />
      </g>

      {petals.map((p, i) => {
        const centerAngle = -Math.PI / 2 + i * slotAngle;
        const labelDist = INNER_R + FULL_LEN * 0.55;
        const tx = CENTER + labelDist * Math.cos(centerAngle);
        const ty = CENTER + labelDist * Math.sin(centerAngle);
        return (
          <g key={`label-${i}`} transform={`translate(${tx} ${ty})`}>
            <text className="fill-petal-equal-rounded-chart__value" textAnchor="middle" y="0">
              {p.value}
            </text>
            <text className="fill-petal-equal-rounded-chart__label" textAnchor="middle" y="16">
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
