"use client";

import { useState, useEffect } from "react";

// Chart ref: C-05
// Vector "Concentric Arc Chart" — N concentric rings, each sweeping
// clockwise from 12 o'clock by value/max of a full circle. A faint
// track behind each arc keeps low-fill values legible. Labels stack
// on the left with value + caption + rule mark.
//
// Usage:
//   <ConcentricArcChart arcs={[{label, value}, ...]} max={100} />
//   <ConcentricArcChart randomize />                              // PREVIEW ONLY
//   arcs[0] is outermost; tone slot = (index % 4) + 1, lightest → darkest.

export type ConcentricArc = {
  label: string;
  value: number;
};

const DEFAULT_ARCS: ConcentricArc[] = [
  { label: "Strategic fit", value: 50 },
  { label: "Quality",       value: 62 },
  { label: "Velocity",      value: 75 },
  { label: "Stakeholder",   value: 82 },
];

const SIZE_W = 600;
const SIZE_H = 480;
const CHART_CX = 380;
const CHART_CY = 240;
const OUTER_R = 200;
const RING_GAP = 38;
const STROKE = 22;
const CORE_R = 58;
const LABEL_X = 30;

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// every arc, and the inline ↻ button re-rolls again on click.
// DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape:
//   • Each ring is independent — no sum constraint.
//   • Clamp to [20, 95] integer bounds; floor=20 keeps every arc
//     visibly drawn (>0); ceiling=95 avoids the full-circle case
//     that would be visually indistinguishable from a track ring.
// =============================================================
function randomArcs(): ConcentricArc[] {
  return DEFAULT_ARCS.map((a) => ({
    ...a,
    value: 20 + Math.floor(Math.random() * 76),
  }));
}

function arcPath(cx: number, cy: number, r: number, ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  if (t <= 0) return "";
  if (t >= 0.9999) {
    return [
      `M ${cx} ${cy - r}`,
      `A ${r} ${r} 0 1 1 ${cx} ${cy + r}`,
      `A ${r} ${r} 0 1 1 ${cx} ${cy - r}`,
    ].join(" ");
  }
  const end = -Math.PI / 2 + t * 2 * Math.PI;
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const largeArc = t > 0.5 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function ConcentricArcChart({
  arcs: arcsProp = DEFAULT_ARCS,
  max = 100,
  randomize = false,
}: {
  arcs?: ConcentricArc[];
  max?: number;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [arcs, setArcs] = useState<ConcentricArc[]>(arcsProp);

  useEffect(() => {
    if (randomize) setArcs(randomArcs());
  }, [randomize]);

  const N = arcs.length;
  if (N === 0) return null;

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE_W} ${SIZE_H}`}
      className="concentric-arc-chart"
      role="img"
      aria-label="Concentric arc chart"
    >
      {arcs.map((_, i) => {
        const r = OUTER_R - i * RING_GAP;
        return (
          <circle
            key={`track-${i}`}
            cx={CHART_CX}
            cy={CHART_CY}
            r={r}
            className="concentric-arc-chart__track"
            style={{ strokeWidth: STROKE }}
          />
        );
      })}

      {arcs.map((a, i) => {
        const r = OUTER_R - i * RING_GAP;
        const ratio = a.value / max;
        const tone = ((i % 4) + 1) as 1 | 2 | 3 | 4;
        return (
          <path
            key={`arc-${i}`}
            d={arcPath(CHART_CX, CHART_CY, r, ratio)}
            className={`concentric-arc-chart__arc concentric-arc-chart__arc--tone-${tone}`}
            style={{ strokeWidth: STROKE }}
          />
        );
      })}

      {arcs.map((a, i) => {
        const r = OUTER_R - i * RING_GAP;
        const ty = CHART_CY - r + 8;
        return (
          <g key={`label-${i}`} transform={`translate(${LABEL_X} ${ty})`}>
            <text className="concentric-arc-chart__value" x="0" y="0">
              {Math.round(a.value)}%
            </text>
            <text className="concentric-arc-chart__label" x="0" y="14">
              {a.label}
            </text>
            <line
              x1="0"
              y1="22"
              x2="16"
              y2="22"
              className="concentric-arc-chart__rule"
            />
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
        onClick={() => setArcs(randomArcs())}
        aria-label="Generate new random data"
        title="Generate new random data (preview only)"
      >
        ↻
      </button>
      {svg}
    </div>
  );
}
