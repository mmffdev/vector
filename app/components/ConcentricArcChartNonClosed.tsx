"use client";

import { useState, useEffect } from "react";

// Vector "Concentric Arc Chart, Non-Closed" — same geometry as
// ConcentricArcChart, but with no background track rings. Each arc
// sweeps clockwise from 12 o'clock by value/max of a full circle and
// reads as an open arc rather than a partially-filled ring.
//
// Usage:
//   <ConcentricArcChartNonClosed arcs={[{label, value}, ...]} max={100} />
//   <ConcentricArcChartNonClosed randomize />                              // PREVIEW ONLY
//   arcs[0] is outermost; tone slot = (index % 4) + 1, lightest → darkest.

export type ConcentricArcNonClosed = {
  label: string;
  value: number;
};

const DEFAULT_ARCS: ConcentricArcNonClosed[] = [
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
const CORE_R = 36;
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
//   • Clamp to [15, 92] integer bounds; floor=15 keeps every arc
//     visibly drawn (>0); ceiling=92 preserves the open-arc look
//     (no full-circle case where the open feel is lost).
// =============================================================
function randomArcs(): ConcentricArcNonClosed[] {
  return DEFAULT_ARCS.map((a) => ({
    ...a,
    value: 15 + Math.floor(Math.random() * 78),
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

export default function ConcentricArcChartNonClosed({
  arcs: arcsProp = DEFAULT_ARCS,
  max = 100,
  randomize = false,
}: {
  arcs?: ConcentricArcNonClosed[];
  max?: number;
  /** PREVIEW ONLY — generate random values on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [arcs, setArcs] = useState<ConcentricArcNonClosed[]>(arcsProp);

  useEffect(() => {
    if (randomize) setArcs(randomArcs());
  }, [randomize]);

  const N = arcs.length;
  if (N === 0) return null;

  const svg = (
    <svg
      viewBox={`0 0 ${SIZE_W} ${SIZE_H}`}
      className="concentric-arc-nc-chart"
      role="img"
      aria-label="Concentric arc chart, non-closed"
    >
      {arcs.map((a, i) => {
        const r = OUTER_R - i * RING_GAP;
        const ratio = a.value / max;
        const tone = ((i % 4) + 1) as 1 | 2 | 3 | 4;
        return (
          <path
            key={`arc-${i}`}
            d={arcPath(CHART_CX, CHART_CY, r, ratio)}
            className={`concentric-arc-nc-chart__arc concentric-arc-nc-chart__arc--tone-${tone}`}
            style={{ strokeWidth: STROKE }}
          />
        );
      })}

      <circle
        cx={CHART_CX}
        cy={CHART_CY}
        r={CORE_R}
        className="concentric-arc-nc-chart__core"
      />

      {arcs.map((a, i) => {
        const r = OUTER_R - i * RING_GAP;
        const ty = CHART_CY - r + 8;
        return (
          <g key={`label-${i}`} transform={`translate(${LABEL_X} ${ty})`}>
            <text className="concentric-arc-nc-chart__value" x="0" y="0">
              {Math.round(a.value)}%
            </text>
            <text className="concentric-arc-nc-chart__label" x="0" y="14">
              {a.label}
            </text>
            <line
              x1="0"
              y1="22"
              x2="16"
              y2="22"
              className="concentric-arc-nc-chart__rule"
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
